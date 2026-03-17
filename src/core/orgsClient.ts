// ============================================================================
// File: src/core/orgsClient.ts
// Version: 1.0-hash-factory-orgs-client | 2026-03-11
// Purpose:
//   Hash Factory -> Core "Organizations" client.
//   - Default auth: service key via CoreClient
//   - Optional per-request auth override via CoreRequestCtx for pass-through
//   - Strict input normalization for UUIDs, limits, offsets, and org patch body
// ============================================================================

import { CoreClient, CoreClientError, CoreRequestCtx } from "./coreClient.js";

export class OrgsClientError extends Error {
  statusCode: number;
  code: string;
  detail?: unknown;
  requestId?: string | null;

  constructor(
    message: string,
    opts: { statusCode: number; code: string; detail?: unknown; requestId?: string | null }
  ) {
    super(message);
    this.name = "OrgsClientError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.detail = opts.detail;
    this.requestId = opts.requestId ?? null;
  }
}

type JsonObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function clampInt(v: unknown, min: number, max: number, d: number): number {
  const n = Number(v);
  const val = Number.isFinite(n) ? Math.trunc(n) : d;
  return Math.max(min, Math.min(max, val));
}

function normalizeUuid(v: unknown, message: string, code: string): string {
  const s = String(v ?? "").trim();
  if (!isUuid(s)) {
    throw new OrgsClientError(message, { statusCode: 400, code });
  }
  return s;
}

function normalizeSlugOrNull(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z0-9][a-z0-9-]{0,98}$/.test(s)) {
    throw new OrgsClientError("invalid_slug", { statusCode: 400, code: "INVALID_SLUG" });
  }
  return s;
}

function normalizeWalletOrNull(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(s)) {
    throw new OrgsClientError("invalid_wallet_address", { statusCode: 400, code: "INVALID_WALLET" });
  }
  return s.toLowerCase();
}

function normalizeEmailOrUndefined(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return undefined;
  if (s.length < 6 || s.length > 255 || !s.includes("@") || !s.includes(".")) {
    throw new OrgsClientError("invalid_email", { statusCode: 400, code: "INVALID_EMAIL" });
  }
  return s;
}

function normalizeDescriptionOrNull(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (s.length > 2000) {
    throw new OrgsClientError("invalid_description", { statusCode: 400, code: "INVALID_DESCRIPTION" });
  }
  return s;
}

function normalizeBillingTier(v: unknown): "free" | "starter" | "pro" | "enterprise" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s !== "free" && s !== "starter" && s !== "pro" && s !== "enterprise") {
    throw new OrgsClientError("invalid_billing_tier", { statusCode: 400, code: "INVALID_BILLING_TIER" });
  }
  return s;
}

function normalizeKycStatus(v: unknown): "pending" | "approved" | "rejected" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s !== "pending" && s !== "approved" && s !== "rejected") {
    throw new OrgsClientError("invalid_kyc_status", { statusCode: 400, code: "INVALID_KYC_STATUS" });
  }
  return s;
}

function unwrapResult(res: unknown): unknown {
  return (res as any)?.result ?? res;
}

function buildQueryString(q: Record<string, string | number | boolean | null | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === null || v === undefined) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

function mapCoreError(err: unknown): Error {
  if (err instanceof OrgsClientError) return err;

  if (err instanceof CoreClientError) {
    const status = err.status;
    const code = err.code || null;
    const detail = (err as any).detail;
    const requestId = err.requestId ?? null;

    if (status === 400) {
      return new OrgsClientError("bad_request", {
        statusCode: 400,
        code: code ?? "BAD_REQUEST",
        detail,
        requestId,
      });
    }
    if (status === 401) {
      return new OrgsClientError("unauthorized", {
        statusCode: 401,
        code: code ?? "AUTH_REQUIRED",
        detail,
        requestId,
      });
    }
    if (status === 403) {
      return new OrgsClientError("forbidden", {
        statusCode: 403,
        code: code ?? "FORBIDDEN",
        detail,
        requestId,
      });
    }
    if (status === 404) {
      return new OrgsClientError("not_found", {
        statusCode: 404,
        code: code ?? "NOT_FOUND",
        detail,
        requestId,
      });
    }
    if (status === 409) {
      return new OrgsClientError("conflict", {
        statusCode: 409,
        code: code ?? "CONFLICT",
        detail,
        requestId,
      });
    }

    return new OrgsClientError("upstream_error", {
      statusCode: 502,
      code: code ?? "UPSTREAM_ERROR",
      detail,
      requestId,
    });
  }

  return new OrgsClientError("internal_error", { statusCode: 500, code: "INTERNAL_ERROR" });
}

export type MembersQuery = Readonly<{
  limit?: unknown;
  offset?: unknown;
}>;

export type PatchOrgInput = Readonly<{
  name?: unknown;
  slug?: unknown;
  email?: unknown;
  wallet_address?: unknown;
  description?: unknown;
  metadata?: unknown;
}>;

export type OrgsClient = Readonly<{
  getMe: (ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  getMyMembers: (q?: MembersQuery | null, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  getById: (orgId: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  getMembersByOrgId: (orgId: unknown, q?: MembersQuery | null, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  patchOrg: (orgId: unknown, body: PatchOrgInput, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  setBillingTier: (orgId: unknown, billing_tier: unknown, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  setKyc: (orgId: unknown, kyc_status: unknown, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  softDelete: (orgId: unknown, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  restore: (orgId: unknown, ctx?: CoreRequestCtx) => Promise<JsonObject>;
}>;

export function makeCoreOrgs(core: CoreClient): OrgsClient {
  if (!core) throw new Error("makeCoreOrgs requires core client");

  async function getMe(ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const res = await core.get<any>("/v1/orgs/me", ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getMyMembers(q?: MembersQuery | null, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const limit = clampInt(q?.limit, 1, 1000, 100);
      const offset = clampInt(q?.offset, 0, 10_000_000, 0);
      const qs = buildQueryString({ limit, offset });

      const res = await core.get<any>(`/v1/orgs/me/members${qs}`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getById(orgId: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const id = normalizeUuid(orgId, "invalid_org_id", "INVALID_ORG_ID");
      const res = await core.get<any>(`/v1/orgs/${encodeURIComponent(id)}`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getMembersByOrgId(
    orgId: unknown,
    q?: MembersQuery | null,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    try {
      const id = normalizeUuid(orgId, "invalid_org_id", "INVALID_ORG_ID");
      const limit = clampInt(q?.limit, 1, 1000, 100);
      const offset = clampInt(q?.offset, 0, 10_000_000, 0);
      const qs = buildQueryString({ limit, offset });

      const res = await core.get<any>(`/v1/orgs/${encodeURIComponent(id)}/members${qs}`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function patchOrg(orgId: unknown, body: PatchOrgInput, ctx?: CoreRequestCtx) {
    try {
      const id = normalizeUuid(orgId, "invalid_org_id", "INVALID_ORG_ID");
      if (!isPlainObject(body)) {
        throw new OrgsClientError("invalid_body", { statusCode: 400, code: "INVALID_BODY" });
      }

      const payload: JsonObject = {};
      if (body.name !== undefined) payload.name = String(body.name ?? "").trim();
      if (body.slug !== undefined) payload.slug = normalizeSlugOrNull(body.slug);
      if (body.email !== undefined) payload.email = normalizeEmailOrUndefined(body.email);
      if (body.wallet_address !== undefined) payload.wallet_address = normalizeWalletOrNull(body.wallet_address);
      if (body.description !== undefined) payload.description = normalizeDescriptionOrNull(body.description);
      if (body.metadata !== undefined) {
        if (body.metadata !== null && !isPlainObject(body.metadata)) {
          throw new OrgsClientError("invalid_metadata", { statusCode: 400, code: "INVALID_METADATA" });
        }
        payload.metadata = body.metadata as any;
      }

      if (Object.keys(payload).length === 0) {
        throw new OrgsClientError("empty_patch", { statusCode: 400, code: "EMPTY_PATCH" });
      }

      const res = await core.patch<any>(`/v1/orgs/${encodeURIComponent(id)}`, payload, ctx, { maxRetries: 0 });
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function setBillingTier(orgId: unknown, billing_tier: unknown, ctx?: CoreRequestCtx) {
    try {
      const id = normalizeUuid(orgId, "invalid_org_id", "INVALID_ORG_ID");
      const payload = { billing_tier: normalizeBillingTier(billing_tier) };

      const res = await core.post<any>(
        `/v1/orgs/${encodeURIComponent(id)}/billing-tier`,
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

  async function setKyc(orgId: unknown, kyc_status: unknown, ctx?: CoreRequestCtx) {
    try {
      const id = normalizeUuid(orgId, "invalid_org_id", "INVALID_ORG_ID");
      const payload = { kyc_status: normalizeKycStatus(kyc_status) };

      const res = await core.post<any>(
        `/v1/orgs/${encodeURIComponent(id)}/kyc`,
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

  async function softDelete(orgId: unknown, ctx?: CoreRequestCtx) {
    try {
      const id = normalizeUuid(orgId, "invalid_org_id", "INVALID_ORG_ID");
      const res = await core.post<any>(
        `/v1/orgs/${encodeURIComponent(id)}/soft-delete`,
        {},
        ctx,
        { maxRetries: 0 }
      );
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function restore(orgId: unknown, ctx?: CoreRequestCtx) {
    try {
      const id = normalizeUuid(orgId, "invalid_org_id", "INVALID_ORG_ID");
      const res = await core.post<any>(
        `/v1/orgs/${encodeURIComponent(id)}/restore`,
        {},
        ctx,
        { maxRetries: 0 }
      );
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  return {
    getMe,
    getMyMembers,
    getById,
    getMembersByOrgId,
    patchOrg,
    setBillingTier,
    setKyc,
    softDelete,
    restore,
  };
}

export default makeCoreOrgs;