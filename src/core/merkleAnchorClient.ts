// ============================================================================
// File: src/core/merkleAnchorClient.ts
// Version: 1.2-hash-factory-merkle-anchor-client-read-write | 2026-03-20
// Purpose:
//   Hash Factory -> Core "Merkle Anchor" client.
//   - Default auth: service key via CoreClient (CORE_SERVICE_API_KEY)
//   - Optional per-request auth override via CoreRequestCtx
//     (coreAuthHeader/coreApiKey) for user pass-through
//   - Strict input normalization for anchor routes
//   - Read + write support for merkle anchor requests
//   - No retries by default; anchor writes are not retried automatically
//   - Trusted HF root/publish helpers for certificate-eligible flows
// ============================================================================

import { CoreClient, CoreClientError, CoreRequestCtx } from "./coreClient.js";

export class MerkleAnchorClientError extends Error {
  statusCode: number;
  code: string;
  detail?: unknown;
  requestId?: string | null;

  constructor(
    message: string,
    opts: { statusCode: number; code: string; detail?: unknown; requestId?: string | null }
  ) {
    super(message);
    this.name = "MerkleAnchorClientError";
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

const ROOT_ANCHOR_KINDS = new Set(["root", "job", "result", "cost", "event", "custom"]);
const ANCHOR_STATUSES = new Set(["pending", "publishing", "published", "confirmed", "failed", "cancelled"]);
const ORDER_VALUES = new Set(["ASC", "DESC"]);

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
    throw new MerkleAnchorClientError(`invalid_${field}`, {
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

function normalizeOptionalUuid(v: unknown, field: string): string | null {
  if (v == null || v === "") return null;
  return normalizeUuid(v, field);
}

function normalizeYmd(v: unknown, field: string): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (!RE_YMD.test(s)) {
    throw new MerkleAnchorClientError(`invalid_${field}`, {
      statusCode: 400,
      code: `INVALID_${field.toUpperCase()}`,
    });
  }
  return s;
}

function normalizeDomain(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s || !RE_MERKLE_DOMAIN.test(s)) {
    throw new MerkleAnchorClientError("invalid_domain", {
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

function normalizeNonEmpty(v: unknown, field: string, max = 256): string {
  const s = String(v ?? "").trim();
  if (!s) {
    throw new MerkleAnchorClientError(`invalid_${field}`, {
      statusCode: 400,
      code: `INVALID_${field.toUpperCase()}`,
    });
  }
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeOptionalString(v: unknown, field: string, max = 1024): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) {
    throw new MerkleAnchorClientError(`invalid_${field}`, {
      statusCode: 400,
      code: `INVALID_${field.toUpperCase()}`,
    });
  }
  return s;
}

function normalizeAnchorKind(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (!ROOT_ANCHOR_KINDS.has(s)) {
    throw new MerkleAnchorClientError("invalid_anchor_kind", {
      statusCode: 400,
      code: "INVALID_ANCHOR_KIND",
    });
  }
  return s;
}

function normalizeAnchorStatus(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (!ANCHOR_STATUSES.has(s)) {
    throw new MerkleAnchorClientError("invalid_status", {
      statusCode: 400,
      code: "INVALID_STATUS",
    });
  }
  return s;
}

function normalizeOrder(v: unknown): "ASC" | "DESC" | null {
  if (v == null || v === "") return null;
  const s = String(v).trim().toUpperCase();
  if (!ORDER_VALUES.has(s)) {
    throw new MerkleAnchorClientError("invalid_order", {
      statusCode: 400,
      code: "INVALID_ORDER",
    });
  }
  return s as "ASC" | "DESC";
}

function normalizePositiveInt(
  v: unknown,
  field: string,
  { min = 1, max = 1000, fallback = 50 } = {}
): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new MerkleAnchorClientError(`invalid_${field}`, {
      statusCode: 400,
      code: `INVALID_${field.toUpperCase()}`,
    });
  }
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeNonNegativeInt(
  v: unknown,
  field: string,
  { max = 10_000_000, fallback = 0 } = {}
): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new MerkleAnchorClientError(`invalid_${field}`, {
      statusCode: 400,
      code: `INVALID_${field.toUpperCase()}`,
    });
  }
  return Math.max(0, Math.min(max, Math.trunc(n)));
}

function stableIdempotencyKey(prefix: string, basis: string, requestId?: string | null): string {
  const rid = String(requestId ?? "").trim();
  if (rid) return `${prefix}:${basis}:${rid}`;
  return `${prefix}:${basis}`;
}

function requireTrustedHfContext(ctx?: CoreRequestCtx): {
  hfInternalSecret: string;
  hfActorHeader: string;
} {
  const hfInternalSecret = String(process.env.HF_INTERNAL_SHARED_SECRET ?? "").trim();
  if (!hfInternalSecret) {
    throw new MerkleAnchorClientError("hf_internal_secret_required", {
      statusCode: 500,
      code: "HF_INTERNAL_SECRET_REQUIRED",
    });
  }

  const hfActorHeader = String(ctx?.hfActor ?? "").trim();
  if (!hfActorHeader) {
    throw new MerkleAnchorClientError("hf_actor_required", {
      statusCode: 500,
      code: "HF_ACTOR_REQUIRED",
    });
  }

  return { hfInternalSecret, hfActorHeader };
}

function buildTrustedHfCtx(
  ctx: CoreRequestCtx | undefined,
  timeoutEnv: string,
  timeoutDefaultMs: number
): CoreRequestCtx {
  const { hfInternalSecret, hfActorHeader } = requireTrustedHfContext(ctx);
  const timeoutMs = readEnvInt(timeoutEnv, timeoutDefaultMs, 15_000, 300_000);
  return {
    ...(ctx || {}),
    timeoutMs,
    coreExtraHeaders: {
      ...((ctx as any)?.coreExtraHeaders ?? {}),
      "x-hf-internal-secret": hfInternalSecret,
      "x-hf-actor": hfActorHeader,
    },
  };
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

function buildMerkleReadCtx(
  ctx: CoreRequestCtx | undefined,
  timeoutEnv: string,
  timeoutDefaultMs: number
): CoreRequestCtx {
  const timeoutMs = readEnvInt(timeoutEnv, timeoutDefaultMs, 5_000, 120_000);

  return {
    ...(ctx || {}),
    timeoutMs,
  };
}

function mapCoreError(err: unknown): Error {
  if (err instanceof MerkleAnchorClientError) return err;

  if (err instanceof CoreClientError) {
    const status = err.status;
    const code = err.code || null;
    const detail = (err as any).detail;
    const requestId = err.requestId ?? null;

    if (status === 400) {
      return new MerkleAnchorClientError("bad_request", {
        statusCode: 400,
        code: code ?? "BAD_REQUEST",
        detail,
        requestId,
      });
    }
    if (status === 401) {
      return new MerkleAnchorClientError("unauthorized", {
        statusCode: 401,
        code: code ?? "AUTH_REQUIRED",
        detail,
        requestId,
      });
    }
    if (status === 403) {
      return new MerkleAnchorClientError("forbidden", {
        statusCode: 403,
        code: code ?? "FORBIDDEN",
        detail,
        requestId,
      });
    }
    if (status === 404) {
      return new MerkleAnchorClientError("not_found", {
        statusCode: 404,
        code: code ?? "NOT_FOUND",
        detail,
        requestId,
      });
    }
    if (status === 409) {
      return new MerkleAnchorClientError("conflict", {
        statusCode: 409,
        code: code ?? "CONFLICT",
        detail,
        requestId,
      });
    }
    if (status === 422) {
      return new MerkleAnchorClientError("unprocessable_entity", {
        statusCode: 422,
        code: code ?? "UNPROCESSABLE_ENTITY",
        detail,
        requestId,
      });
    }
    if (status === 504) {
      return new MerkleAnchorClientError("gateway_timeout", {
        statusCode: 504,
        code: code ?? "GATEWAY_TIMEOUT",
        detail,
        requestId,
      });
    }

    return new MerkleAnchorClientError("upstream_error", {
      statusCode: 502,
      code: code ?? "UPSTREAM_ERROR",
      detail,
      requestId,
    });
  }

  return new MerkleAnchorClientError("internal_error", {
    statusCode: 500,
    code: "INTERNAL_ERROR",
  });
}

function unwrapResult(res: unknown): unknown {
  return (res as any)?.result ?? res;
}

export type MerkleAnchorClient = Readonly<{
  anchorPayload: (body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  listAnchorRequests: (query?: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  getAnchorRequest: (anchorRequestId: unknown, query?: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  requestRootAnchor: (body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  requestRootAnchorFromHf: (body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  publishExistingAnchorRequestFromHf: (anchorRequestId: unknown, body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  publishExistingAnchorRequest: (anchorRequestId: unknown, body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  publishAnchorRequestPublic: (anchorRequestId: unknown, body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  unpublishAnchorRequestPublic: (anchorRequestId: unknown, body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
}>;

export function makeCoreMerkleAnchor(core: CoreClient): MerkleAnchorClient {
  if (!core) throw new Error("makeCoreMerkleAnchor requires core client");

  async function anchorPayload(body: JsonObject, ctx?: CoreRequestCtx): Promise<JsonObject> {
    try {
      if (!isPlainObject(body)) {
        throw new MerkleAnchorClientError("invalid_body", {
          statusCode: 400,
          code: "INVALID_BODY",
        });
      }

      const hasPayload = Object.prototype.hasOwnProperty.call(body, "payload");
      const hasPayloadJson = Object.prototype.hasOwnProperty.call(body, "payload_json");

      if (hasPayload === hasPayloadJson) {
        throw new MerkleAnchorClientError("invalid_request", {
          statusCode: 400,
          code: "INVALID_REQUEST",
          detail: { message: "Exactly one of payload or payload_json is required" },
        });
      }

      const payload: JsonObject = {
        domain: normalizeDomain(body.domain),
        payload_type: normalizeNonEmpty(body.payload_type, "payload_type", 256),
      };

      const proofDate = normalizeYmd(body.proofDate, "proof_date");
      if (proofDate) payload.proofDate = proofDate;

      if (hasPayloadJson) {
        payload.payload_json = body.payload_json as unknown;
      } else {
        payload.payload = body.payload as unknown;
      }

      const res = await core.post<any>("/v1/merkle/anchor", payload, ctx, { maxRetries: 0 });
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function listAnchorRequests(query: JsonObject = {}, ctx?: CoreRequestCtx): Promise<JsonObject> {
    try {
      if (!isPlainObject(query)) {
        throw new MerkleAnchorClientError("invalid_query", {
          statusCode: 400,
          code: "INVALID_QUERY",
        });
      }

      const params = new URLSearchParams();

      const domain = normalizeOptionalDomain(query.domain);
      const proofDate = normalizeYmd(query.proof_date, "proof_date");
      const status = normalizeAnchorStatus(query.status);
      const anchorKind = normalizeAnchorKind(query.anchor_kind);
      const payloadType = normalizeOptionalString(query.payload_type, "payload_type", 128);
      const rootId = normalizeOptionalUuid(query.root_id, "root_id");
      const order = normalizeOrder(query.order) ?? "DESC";
      const limit = normalizePositiveInt(query.limit, "limit", { min: 1, max: 1000, fallback: 50 });
      const offset = normalizeNonNegativeInt(query.offset, "offset", { max: 10_000_000, fallback: 0 });

      if (domain) params.set("domain", domain);
      if (proofDate) params.set("proof_date", proofDate);
      if (status) params.set("status", status);
      if (anchorKind) params.set("anchor_kind", anchorKind);
      if (payloadType) params.set("payload_type", payloadType);
      if (rootId) params.set("root_id", rootId);
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      params.set("order", order);

      const effectiveCtx = buildMerkleReadCtx(
        ctx,
        "HF_CORE_MERKLE_ANCHOR_READ_TIMEOUT_MS",
        30_000
      );

      const res = await core.get<any>(
        `/v1/merkle/anchor/requests?${params.toString()}`,
        effectiveCtx,
        { maxRetries: 0 }
      );
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getAnchorRequest(
    anchorRequestId: unknown,
    query: JsonObject = {},
    ctx?: CoreRequestCtx
  ): Promise<JsonObject> {
    try {
      if (!isPlainObject(query)) {
        throw new MerkleAnchorClientError("invalid_query", {
          statusCode: 400,
          code: "INVALID_QUERY",
        });
      }

      const id = normalizeUuid(anchorRequestId, "anchor_request_id");
      const params = new URLSearchParams();

      const proofDate = normalizeYmd(query.proof_date, "proof_date");
      if (proofDate) params.set("proof_date", proofDate);

      const effectiveCtx = buildMerkleReadCtx(
        ctx,
        "HF_CORE_MERKLE_ANCHOR_READ_TIMEOUT_MS",
        30_000
      );

      const suffix = params.toString() ? `?${params.toString()}` : "";
      const res = await core.get<any>(
        `/v1/merkle/anchor/requests/${encodeURIComponent(id)}${suffix}`,
        effectiveCtx,
        { maxRetries: 0 }
      );
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function requestRootAnchor(body: JsonObject, ctx?: CoreRequestCtx): Promise<JsonObject> {
    try {
      if (!isPlainObject(body)) {
        throw new MerkleAnchorClientError("invalid_body", {
          statusCode: 400,
          code: "INVALID_BODY",
        });
      }

      const rootId = normalizeOptionalUuid(body.rootId, "root_id");
      const proofDate = normalizeYmd(body.proofDate, "proof_date");
      const domain = normalizeOptionalDomain(body.domain);
      const anchorKind = normalizeAnchorKind(body.anchor_kind);
      const reason = normalizeOptionalString(body.reason, "reason", 1024);
      const idempotencyKey = normalizeOptionalString(body.idempotency_key, "idempotency_key", 256);

      if (!rootId && !domain) {
        throw new MerkleAnchorClientError("invalid_request", {
          statusCode: 400,
          code: "INVALID_REQUEST",
          detail: { message: "At least one of rootId or domain is required" },
        });
      }

      const payload: JsonObject = {};
      if (rootId) payload.rootId = rootId;
      if (proofDate) payload.proofDate = proofDate;
      if (domain) payload.domain = domain;
      if (anchorKind) payload.anchor_kind = anchorKind;
      if (reason !== null) payload.reason = reason;
      if (idempotencyKey !== null) payload.idempotency_key = idempotencyKey;

      const effectiveCtx = buildMerkleWriteCtx(
        ctx,
        "HF_CORE_MERKLE_ANCHOR_TIMEOUT_MS",
        180_000
      );

      const res = await core.post<any>("/v1/merkle/anchor/root", payload, effectiveCtx, { maxRetries: 0 });
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function publishExistingAnchorRequest(
    anchorRequestId: unknown,
    body: JsonObject,
    ctx?: CoreRequestCtx
  ): Promise<JsonObject> {
    try {
      if (!isPlainObject(body)) {
        throw new MerkleAnchorClientError("invalid_body", {
          statusCode: 400,
          code: "INVALID_BODY",
        });
      }

      const id = normalizeUuid(anchorRequestId, "anchor_request_id");
      const proofDate = normalizeYmd(body.proof_date, "proof_date");
      if (!proofDate) {
        throw new MerkleAnchorClientError("invalid_request", {
          statusCode: 400,
          code: "INVALID_REQUEST",
          detail: { message: "proof_date is required" },
        });
      }

      const payload: JsonObject = { proof_date: proofDate };
      const res = await core.post<any>(
        `/v1/merkle/anchor/requests/${encodeURIComponent(id)}/publish`,
        payload,
        ctx,
        { maxRetries: 0 }
      );
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function publishExistingAnchorRequestFromHf(
    anchorRequestId: unknown,
    body: JsonObject,
    ctx?: CoreRequestCtx
  ): Promise<JsonObject> {
    try {
      if (!isPlainObject(body)) {
        throw new MerkleAnchorClientError("invalid_body", {
          statusCode: 400,
          code: "INVALID_BODY",
        });
      }

      const id = normalizeUuid(anchorRequestId, "anchor_request_id");
      const proofDate = normalizeYmd(body.proof_date, "proof_date");
      if (!proofDate) {
        throw new MerkleAnchorClientError("invalid_request", {
          statusCode: 400,
          code: "INVALID_REQUEST",
          detail: { message: "proof_date is required" },
        });
      }

      const effectiveCtx = buildTrustedHfCtx(
        {
          ...(ctx || {}),
          idempotencyKey:
            (ctx as any)?.idempotencyKey ??
            stableIdempotencyKey("merkle_anchor_publish_hf", id, ctx?.requestId ?? null),
        },
        "HF_CORE_MERKLE_ANCHOR_PUBLISH_TIMEOUT_MS",
        120_000
      );

      const payload: JsonObject = { proof_date: proofDate };
      const res = await core.post<any>(
        `/internal/merkle/anchor/requests/${encodeURIComponent(id)}/publish-from-hf`,
        payload,
        effectiveCtx,
        { maxRetries: 0 }
      );
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function publishAnchorRequestPublic(
    anchorRequestId: unknown,
    body: JsonObject,
    ctx?: CoreRequestCtx
  ): Promise<JsonObject> {
    try {
      if (!isPlainObject(body)) {
        throw new MerkleAnchorClientError("invalid_body", {
          statusCode: 400,
          code: "INVALID_BODY",
        });
      }

      const id = normalizeUuid(anchorRequestId, "anchor_request_id");
      const proofDate = normalizeYmd(body.proof_date, "proof_date");
      const visibility = normalizeOptionalString(body.visibility, "visibility", 32);
      const shareToken = normalizeOptionalString(body.share_token, "share_token", 256);

      if (!proofDate) {
        throw new MerkleAnchorClientError("invalid_request", {
          statusCode: 400,
          code: "INVALID_REQUEST",
          detail: { message: "proof_date is required" },
        });
      }

      if (visibility !== null && visibility !== "public" && visibility !== "unlisted") {
        throw new MerkleAnchorClientError("invalid_visibility", {
          statusCode: 400,
          code: "INVALID_VISIBILITY",
        });
      }

      const payload: JsonObject = {
        proof_date: proofDate,
      };
      if (visibility !== null) payload.visibility = visibility;
      if (shareToken !== null) payload.share_token = shareToken;

      const res = await core.post<any>(
        `/v1/merkle/anchor/requests/${encodeURIComponent(id)}/public/publish`,
        payload,
        ctx,
        { maxRetries: 0 }
      );
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function unpublishAnchorRequestPublic(
    anchorRequestId: unknown,
    body: JsonObject,
    ctx?: CoreRequestCtx
  ): Promise<JsonObject> {
    try {
      if (!isPlainObject(body)) {
        throw new MerkleAnchorClientError("invalid_body", {
          statusCode: 400,
          code: "INVALID_BODY",
        });
      }

      const id = normalizeUuid(anchorRequestId, "anchor_request_id");
      const proofDate = normalizeYmd(body.proof_date, "proof_date");
      if (!proofDate) {
        throw new MerkleAnchorClientError("invalid_request", {
          statusCode: 400,
          code: "INVALID_REQUEST",
          detail: { message: "proof_date is required" },
        });
      }

      const payload: JsonObject = { proof_date: proofDate };
      const res = await core.post<any>(
        `/v1/merkle/anchor/requests/${encodeURIComponent(id)}/public/unpublish`,
        payload,
        ctx,
        { maxRetries: 0 }
      );
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function requestRootAnchorFromHf(body: JsonObject, ctx?: CoreRequestCtx): Promise<JsonObject> {
    try {
      if (!isPlainObject(body)) {
        throw new MerkleAnchorClientError("invalid_body", {
          statusCode: 400,
          code: "INVALID_BODY",
        });
      }

      const rootId = normalizeOptionalUuid(body.rootId, "root_id");
      const proofDate = normalizeYmd(body.proofDate, "proof_date");
      const domain = normalizeOptionalDomain(body.domain);
      const anchorKind = normalizeAnchorKind(body.anchor_kind);
      const reason = normalizeOptionalString(body.reason, "reason", 1024);
      const idempotencyKey = normalizeOptionalString(body.idempotency_key, "idempotency_key", 256);

      if (!rootId) {
        throw new MerkleAnchorClientError("invalid_request", {
          statusCode: 400,
          code: "INVALID_REQUEST",
          detail: { message: "rootId is required for trusted HF root anchor" },
        });
      }

      const basis = rootId;

      const payload: JsonObject = {};
      if (rootId) payload.rootId = rootId;
      if (proofDate) payload.proofDate = proofDate;
      if (domain) payload.domain = domain;
      if (anchorKind) payload.anchor_kind = anchorKind;
      if (reason !== null) payload.reason = reason;
      payload.idempotency_key =
        idempotencyKey ??
        stableIdempotencyKey("merkle_root_anchor_hf", basis, ctx?.requestId ?? null);

      const effectiveCtx = buildTrustedHfCtx(
        ctx,
        "HF_CORE_MERKLE_ROOT_ANCHOR_TIMEOUT_MS",
        120_000
      );

      const res = await core.post<any>(
        "/internal/merkle/anchor/root-from-hf",
        payload,
        effectiveCtx,
        { maxRetries: 0 }
      );

      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  return {
    anchorPayload,
    listAnchorRequests,
    getAnchorRequest,
    requestRootAnchor,
    requestRootAnchorFromHf,
    publishExistingAnchorRequestFromHf,
    publishExistingAnchorRequest,
    publishAnchorRequestPublic,
    unpublishAnchorRequestPublic,
  };
}

export default makeCoreMerkleAnchor;