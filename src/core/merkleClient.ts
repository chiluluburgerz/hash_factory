// ============================================================================
// File: src/core/merkleClient.ts
// Version: 1.0-hash-factory-merkle-client | 2026-03-06
// Purpose:
//   Hash Factory -> Core "Merkle operational" client.
//   - Default auth: service key via CoreClient (CORE_SERVICE_API_KEY)
//   - Optional per-request auth override via CoreRequestCtx
//     (coreAuthHeader/coreApiKey) for user pass-through
//   - Strict input normalization for Merkle operational write routes
//   - No retries by default; Merkle writes are not retried automatically
// Notes:
//   - Distinct from Merkle Anchor client. This client targets:
//       /v1/merkle/root/publish
//       /v1/merkle/root/public/publish
//       /v1/merkle/root/public/unpublish
//       /v1/merkle/proof/build-store
// ============================================================================

import { CoreClient, CoreClientError, CoreRequestCtx } from "./coreClient.js";

export class MerkleClientError extends Error {
  statusCode: number;
  code: string;
  detail?: unknown;
  requestId?: string | null;

  constructor(
    message: string,
    opts: { statusCode: number; code: string; detail?: unknown; requestId?: string | null }
  ) {
    super(message);
    this.name = "MerkleClientError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.detail = opts.detail;
    this.requestId = opts.requestId ?? null;
  }
}

type JsonObject = Record<string, unknown>;

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;

const RE_MERKLE_DOMAIN =
  /^(jobs|results|payments|nfts|daily_rollup|global|([a-z]+:[A-Za-z0-9._:-]+)(\|[a-z]+:[A-Za-z0-9._:-]+)*)$/;

const PUBLIC_VISIBILITY = new Set(["public", "unlisted"]);

function isPlainObject(v: unknown): v is JsonObject {
  if (!v || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isUuid(v: unknown): boolean {
  return typeof v === "string" && RE_UUID.test(v);
}

function normalizeUuid(v: unknown, field: string): string {
  const s = String(v ?? "").trim();
  if (!isUuid(s)) {
    throw new MerkleClientError(`invalid_${field}`, {
      statusCode: 400,
      code: `INVALID_${field.toUpperCase()}`,
    });
  }
  return s;
}

function normalizeOptionalUuid(v: unknown, field: string): string | null {
  if (v == null || v === "") return null;
  return normalizeUuid(v, field);
}

function normalizeYmd(v: unknown, field: string): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (!RE_YMD.test(s)) {
    throw new MerkleClientError(`invalid_${field}`, {
      statusCode: 400,
      code: `INVALID_${field.toUpperCase()}`,
    });
  }
  return s;
}

function normalizeDomain(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s || !RE_MERKLE_DOMAIN.test(s)) {
    throw new MerkleClientError("invalid_domain", {
      statusCode: 400,
      code: "INVALID_DOMAIN",
    });
  }
  return s;
}

function normalizeOptionalDomain(v: unknown): string | null {
  if (v == null || v === "") return null;
  return normalizeDomain(v);
}

function normalizeNonEmpty(v: unknown, field: string, max = 512): string {
  const s = String(v ?? "").trim();
  if (!s) {
    throw new MerkleClientError(`invalid_${field}`, {
      statusCode: 400,
      code: `INVALID_${field.toUpperCase()}`,
    });
  }
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeOptionalVisibility(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (!PUBLIC_VISIBILITY.has(s)) {
    throw new MerkleClientError("invalid_visibility", {
      statusCode: 400,
      code: "INVALID_VISIBILITY",
    });
  }
  return s;
}

function normalizeOptionalString(v: unknown, field: string, max = 256): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) {
    throw new MerkleClientError(`invalid_${field}`, {
      statusCode: 400,
      code: `INVALID_${field.toUpperCase()}`,
    });
  }
  return s;
}

function readEnvInt(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function clampInt(v: unknown, min: number, max: number, d: number): number {
  const n = Number(v);
  const i = Number.isFinite(n) ? Math.trunc(n) : d;
  return Math.max(min, Math.min(max, i));
}

function buildQueryString(q: Record<string, string | number | boolean | null | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === null || v === undefined) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

function buildMerkleWriteCtx(
  ctx: CoreRequestCtx | undefined,
  timeoutEnv: string,
  timeoutDefaultMs: number
): CoreRequestCtx {
  const timeoutMs = readEnvInt(timeoutEnv, timeoutDefaultMs, 15_000, 300_000);
  return {
    ...(ctx || {}),
    timeoutMs,
  };
}

function mapCoreError(err: unknown): Error {
  if (err instanceof MerkleClientError) return err;

  if (err instanceof CoreClientError) {
    const status = err.status;
    const code = err.code || null;
    const detail = (err as any).detail;
    const requestId = err.requestId ?? null;

    if (status === 400) {
      return new MerkleClientError("bad_request", {
        statusCode: 400,
        code: code ?? "BAD_REQUEST",
        detail,
        requestId,
      });
    }
    if (status === 401) {
      return new MerkleClientError("unauthorized", {
        statusCode: 401,
        code: code ?? "AUTH_REQUIRED",
        detail,
        requestId,
      });
    }
    if (status === 403) {
      return new MerkleClientError("forbidden", {
        statusCode: 403,
        code: code ?? "FORBIDDEN",
        detail,
        requestId,
      });
    }
    if (status === 404) {
      return new MerkleClientError("not_found", {
        statusCode: 404,
        code: code ?? "NOT_FOUND",
        detail,
        requestId,
      });
    }
    if (status === 409) {
      return new MerkleClientError("conflict", {
        statusCode: 409,
        code: code ?? "CONFLICT",
        detail,
        requestId,
      });
    }
    if (status === 422) {
      return new MerkleClientError("unprocessable_entity", {
        statusCode: 422,
        code: code ?? "UNPROCESSABLE_ENTITY",
        detail,
        requestId,
      });
    }
    if (status === 504) {
      return new MerkleClientError("gateway_timeout", {
        statusCode: 504,
        code: code ?? "GATEWAY_TIMEOUT",
        detail,
        requestId,
      });
    }

    return new MerkleClientError("upstream_error", {
      statusCode: 502,
      code: code ?? "UPSTREAM_ERROR",
      detail,
      requestId,
    });
  }

  return new MerkleClientError("internal_error", {
    statusCode: 500,
    code: "INTERNAL_ERROR",
  });
}

function unwrapResult(res: unknown): unknown {
  return (res as any)?.result ?? res;
}

export type MerkleClient = Readonly<{
  getRoot: (
    q?: { domain?: unknown } | null,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<JsonObject>;
  getTree: (
    q: { proofDate?: unknown; domain?: unknown },
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<JsonObject>;
  getProof: (
    q: { proofDate?: unknown; domain?: unknown; entityId?: unknown },
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<JsonObject>;
  getProofByLeafHash: (
    leafHash: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<JsonObject>;
  buildRoot: (body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  publishRoot: (body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  publishRootPublic: (body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  unpublishRootPublic: (body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  buildAndStoreProof: (body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
}>;

export function makeCoreMerkle(core: CoreClient): MerkleClient {
  if (!core) throw new Error("makeCoreMerkle requires core client");

  async function getRoot(
    q?: { domain?: unknown } | null,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<JsonObject> {
    try {
      const domain = normalizeOptionalDomain(q?.domain);
      const qs = buildQueryString({ domain: domain ?? undefined });
      const res = await core.get<any>(`/v1/merkle/root${qs}`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getTree(
    q: { proofDate?: unknown; domain?: unknown },
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<JsonObject> {
    try {
      const proofDate = normalizeYmd(q?.proofDate, "proof_date");
      const domain = normalizeOptionalDomain(q?.domain);
      if (!proofDate || !domain) {
        throw new MerkleClientError("invalid_request", {
          statusCode: 400,
          code: "INVALID_REQUEST",
          detail: { message: "proofDate and domain are required" },
        });
      }
      const qs = buildQueryString({ proofDate, domain });
      const res = await core.get<any>(`/v1/merkle/tree${qs}`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getProof(
    q: { proofDate?: unknown; domain?: unknown; entityId?: unknown },
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<JsonObject> {
    try {
      const proofDate = normalizeYmd(q?.proofDate, "proof_date");
      const domain = normalizeOptionalDomain(q?.domain);
      const entityId = normalizeNonEmpty(q?.entityId, "entity_id", 512);
      if (!proofDate || !domain) {
        throw new MerkleClientError("invalid_request", {
          statusCode: 400,
          code: "INVALID_REQUEST",
          detail: { message: "proofDate and domain are required" },
        });
      }
      const qs = buildQueryString({ proofDate, domain, entityId });
      const res = await core.get<any>(`/v1/merkle/proof${qs}`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getProofByLeafHash(
    leafHash: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<JsonObject> {
    try {
      const hash = normalizeNonEmpty(leafHash, "leaf_hash", 1024);
      const res = await core.get<any>(
        `/v1/merkle/proof/by-hash/${encodeURIComponent(hash)}`,
        ctx,
        retry ?? undefined
      );
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function buildRoot(body: JsonObject, ctx?: CoreRequestCtx): Promise<JsonObject> {
    try {
      if (!isPlainObject(body)) {
        throw new MerkleClientError("invalid_body", {
          statusCode: 400,
          code: "INVALID_BODY",
        });
      }

      const proofDate = normalizeYmd(body.proofDate, "proof_date");
      const domain = normalizeOptionalDomain(body.domain);

      if (!proofDate || !domain) {
        throw new MerkleClientError("invalid_request", {
          statusCode: 400,
          code: "INVALID_REQUEST",
          detail: { message: "proofDate and domain are required" },
        });
      }

      const payload: JsonObject = {
        proofDate,
        domain,
      };

      const effectiveCtx = buildMerkleWriteCtx(
        ctx,
        "HF_CORE_MERKLE_BUILD_TIMEOUT_MS",
        60_000
      );

      const res = await core.post<any>("/v1/merkle/root/build", payload, effectiveCtx, { maxRetries: 0 });
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function publishRoot(body: JsonObject, ctx?: CoreRequestCtx): Promise<JsonObject> {
    try {
      if (!isPlainObject(body)) {
        throw new MerkleClientError("invalid_body", {
          statusCode: 400,
          code: "INVALID_BODY",
        });
      }

      const rootId = normalizeOptionalUuid(body.rootId, "root_id");
      const proofDate = normalizeYmd(body.proofDate, "proof_date");
      const domain = normalizeOptionalDomain(body.domain);

      if (!rootId && !domain) {
        throw new MerkleClientError("invalid_request", {
          statusCode: 400,
          code: "INVALID_REQUEST",
          detail: { message: "At least one of rootId or domain is required" },
        });
      }

      const payload: JsonObject = {};
      if (rootId) payload.rootId = rootId;
      if (proofDate) payload.proofDate = proofDate;
      if (domain) payload.domain = domain;

      const effectiveCtx = buildMerkleWriteCtx(
        ctx,
        "HF_CORE_MERKLE_PUBLISH_TIMEOUT_MS",
        90_000
      );

      const res = await core.post<any>("/v1/merkle/root/publish", payload, effectiveCtx, { maxRetries: 0 });
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function publishRootPublic(body: JsonObject, ctx?: CoreRequestCtx): Promise<JsonObject> {
    try {
      if (!isPlainObject(body)) {
        throw new MerkleClientError("invalid_body", {
          statusCode: 400,
          code: "INVALID_BODY",
        });
      }

      const rootId = normalizeOptionalUuid(body.rootId, "root_id");
      const proofDate = normalizeYmd(body.proofDate, "proof_date");
      const domain = normalizeOptionalDomain(body.domain);
      const visibility = normalizeOptionalVisibility(body.visibility);
      const shareToken = normalizeOptionalString(body.share_token, "share_token", 256);

      if (!rootId && !domain) {
        throw new MerkleClientError("invalid_request", {
          statusCode: 400,
          code: "INVALID_REQUEST",
          detail: { message: "At least one of rootId or domain is required" },
        });
      }

      const payload: JsonObject = {};
      if (rootId) payload.rootId = rootId;
      if (proofDate) payload.proofDate = proofDate;
      if (domain) payload.domain = domain;
      if (visibility) payload.visibility = visibility;
      if (shareToken !== null) payload.share_token = shareToken;

      const res = await core.post<any>("/v1/merkle/root/public/publish", payload, ctx, { maxRetries: 0 });
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function unpublishRootPublic(body: JsonObject, ctx?: CoreRequestCtx): Promise<JsonObject> {
    try {
      if (!isPlainObject(body)) {
        throw new MerkleClientError("invalid_body", {
          statusCode: 400,
          code: "INVALID_BODY",
        });
      }

      const rootId = normalizeOptionalUuid(body.rootId, "root_id");
      const proofDate = normalizeYmd(body.proofDate, "proof_date");
      const domain = normalizeOptionalDomain(body.domain);

      if (!rootId && !domain) {
        throw new MerkleClientError("invalid_request", {
          statusCode: 400,
          code: "INVALID_REQUEST",
          detail: { message: "At least one of rootId or domain is required" },
        });
      }

      const payload: JsonObject = {};
      if (rootId) payload.rootId = rootId;
      if (proofDate) payload.proofDate = proofDate;
      if (domain) payload.domain = domain;

      const res = await core.post<any>("/v1/merkle/root/public/unpublish", payload, ctx, { maxRetries: 0 });
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function buildAndStoreProof(body: JsonObject, ctx?: CoreRequestCtx): Promise<JsonObject> {
    try {
      if (!isPlainObject(body)) {
        throw new MerkleClientError("invalid_body", {
          statusCode: 400,
          code: "INVALID_BODY",
        });
      }

      const proofDate = normalizeYmd(body.proofDate, "proof_date");
      const domain = normalizeOptionalDomain(body.domain);
      const entityId = normalizeNonEmpty(body.entityId, "entity_id", 512);

      if (!proofDate || !domain) {
        throw new MerkleClientError("invalid_request", {
          statusCode: 400,
          code: "INVALID_REQUEST",
          detail: { message: "proofDate and domain are required" },
        });
      }

      const payload: JsonObject = {
        proofDate,
        domain,
        entityId,
      };

      const effectiveCtx = buildMerkleWriteCtx(
        ctx,
        "HF_CORE_MERKLE_PROOF_TIMEOUT_MS",
        60_000
      );

      const res = await core.post<any>("/v1/merkle/proof/build-store", payload, effectiveCtx, { maxRetries: 0 });
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  return {
    getRoot,
    getTree,
    getProof,
    getProofByLeafHash,
    buildRoot,
    publishRoot,
    publishRootPublic,
    unpublishRootPublic,
    buildAndStoreProof,
  };
}

export default makeCoreMerkle;