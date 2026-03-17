// ============================================================================
// File: src/core/orgEntitlementsClient.ts
// Version: 1.0-hash-factory-org-entitlements-client | 2026-03-12
// Purpose:
//   Hash Factory -> Core "Org Entitlements" client.
//   - Default auth: service key via CoreClient
//   - Optional per-request auth override via CoreRequestCtx for pass-through
//   - Strict input normalization for org ids, path queries, feature keys, and
//     entitlement-check payloads
// Notes:
//   - Thin proxy only. Core remains source of truth for entitlement shaping,
//     effective policies, and check semantics.
// ============================================================================

import { CoreClient, CoreClientError, CoreRequestCtx } from "./coreClient.js";

export class OrgEntitlementsClientError extends Error {
  statusCode: number;
  code: string;
  detail?: unknown;
  requestId?: string | null;

  constructor(
    message: string,
    opts: { statusCode: number; code: string; detail?: unknown; requestId?: string | null }
  ) {
    super(message);
    this.name = "OrgEntitlementsClientError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.detail = opts.detail;
    this.requestId = opts.requestId ?? null;
  }
}

type JsonObject = Record<string, unknown>;

export type EntitlementsView = "full" | "summary";
export type EntitlementValueType = "bool" | "int" | "string" | "string_list";

export type EntitlementPathQuery = Readonly<{
  path: unknown;
  type?: unknown;
  default_bool?: unknown;
  default_int?: unknown;
  default_string?: unknown;
  min?: unknown;
  max?: unknown;
}>;

export type EntitlementCheckInput = Readonly<{
  path: unknown;
  required?: unknown;
  code?: unknown;
  message?: unknown;
}>;

export type OrgEntitlementsClient = Readonly<{
  getMe: (q?: { view?: unknown } | null, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  getMeEffective: (ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  getMePath: (q: EntitlementPathQuery, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  getMeFeature: (featureKey: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  checkMe: (body: EntitlementCheckInput, ctx?: CoreRequestCtx) => Promise<JsonObject>;

  getForOrg: (orgId: unknown, q?: { view?: unknown } | null, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  getForOrgEffective: (orgId: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  getForOrgPath: (orgId: unknown, q: EntitlementPathQuery, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  getForOrgFeature: (orgId: unknown, featureKey: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  checkForOrg: (orgId: unknown, body: EntitlementCheckInput, ctx?: CoreRequestCtx) => Promise<JsonObject>;
}>;

function isUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function clampInt(v: unknown, min: number, max: number, dflt: number | null): number | null {
  if (v == null || v === "") return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  const val = Math.trunc(n);
  return Math.max(min, Math.min(max, val));
}

function normalizeUuid(v: unknown, message: string, code: string): string {
  const s = String(v ?? "").trim();
  if (!isUuid(s)) {
    throw new OrgEntitlementsClientError(message, { statusCode: 400, code });
  }
  return s;
}

function normalizeView(v: unknown): EntitlementsView {
  const s = String(v ?? "full").trim().toLowerCase();
  if (s !== "full" && s !== "summary") {
    throw new OrgEntitlementsClientError("invalid_view", { statusCode: 400, code: "INVALID_VIEW" });
  }
  return s;
}

function normalizePath(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s || s.length > 256) {
    throw new OrgEntitlementsClientError("invalid_path", { statusCode: 400, code: "INVALID_PATH" });
  }
  return s;
}

function normalizeValueType(v: unknown): EntitlementValueType {
  const s = String(v ?? "bool").trim().toLowerCase();
  if (s !== "bool" && s !== "int" && s !== "string" && s !== "string_list") {
    throw new OrgEntitlementsClientError("invalid_type", { statusCode: 400, code: "INVALID_TYPE" });
  }
  return s;
}

function normalizeFeatureKey(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(s)) {
    throw new OrgEntitlementsClientError("invalid_feature_key", { statusCode: 400, code: "INVALID_FEATURE_KEY" });
  }
  return s;
}

function normalizeBoolOrUndefined(v: unknown): boolean | undefined {
  if (v === undefined) return undefined;
  if (v === true) return true;
  if (v === false) return false;

  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return undefined;
  if (["1", "true", "t", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "f", "no", "n", "off"].includes(s)) return false;

  throw new OrgEntitlementsClientError("invalid_boolean", { statusCode: 400, code: "INVALID_BOOLEAN" });
}

function normalizeStringOrUndefined(v: unknown, field: string, maxLen: number): string | undefined {
  if (v === undefined) return undefined;
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  if (s.length > maxLen) {
    throw new OrgEntitlementsClientError(`invalid_${field}`, { statusCode: 400, code: `INVALID_${field.toUpperCase()}` });
  }
  return s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
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
  if (err instanceof OrgEntitlementsClientError) return err;

  if (err instanceof CoreClientError) {
    const status = err.status;
    const code = err.code || null;
    const detail = (err as any).detail;
    const requestId = err.requestId ?? null;

    if (status === 400) {
      return new OrgEntitlementsClientError("bad_request", {
        statusCode: 400,
        code: code ?? "BAD_REQUEST",
        detail,
        requestId,
      });
    }
    if (status === 401) {
      return new OrgEntitlementsClientError("unauthorized", {
        statusCode: 401,
        code: code ?? "AUTH_REQUIRED",
        detail,
        requestId,
      });
    }
    if (status === 403) {
      return new OrgEntitlementsClientError("forbidden", {
        statusCode: 403,
        code: code ?? "FORBIDDEN",
        detail,
        requestId,
      });
    }
    if (status === 404) {
      return new OrgEntitlementsClientError("not_found", {
        statusCode: 404,
        code: code ?? "NOT_FOUND",
        detail,
        requestId,
      });
    }
    if (status === 409) {
      return new OrgEntitlementsClientError("conflict", {
        statusCode: 409,
        code: code ?? "CONFLICT",
        detail,
        requestId,
      });
    }

    return new OrgEntitlementsClientError("upstream_error", {
      statusCode: 502,
      code: code ?? "UPSTREAM_ERROR",
      detail,
      requestId,
    });
  }

  return new OrgEntitlementsClientError("internal_error", { statusCode: 500, code: "INTERNAL_ERROR" });
}

function normalizePathQuery(q: EntitlementPathQuery): Record<string, string | number | boolean | null | undefined> {
  if (!isPlainObject(q)) {
    throw new OrgEntitlementsClientError("invalid_query", { statusCode: 400, code: "INVALID_QUERY" });
  }

  const path = normalizePath(q.path);
  const type = normalizeValueType(q.type);

  const out: Record<string, string | number | boolean | null | undefined> = {
    path,
    type,
  };

  const defaultBool = normalizeBoolOrUndefined(q.default_bool);
  if (defaultBool !== undefined) out.default_bool = defaultBool;

  const defaultInt = clampInt(q.default_int, -1_000_000_000, 1_000_000_000, undefined as any);
  if (defaultInt !== undefined && defaultInt !== null) out.default_int = defaultInt;

  const defaultString = normalizeStringOrUndefined(q.default_string, "default_string", 2048);
  if (defaultString !== undefined) out.default_string = defaultString;

  const min = clampInt(q.min, -1_000_000_000, 1_000_000_000, undefined as any);
  if (min !== undefined && min !== null) out.min = min;

  const max = clampInt(q.max, -1_000_000_000, 1_000_000_000, undefined as any);
  if (max !== undefined && max !== null) out.max = max;

  return out;
}

function normalizeCheckInput(body: EntitlementCheckInput): JsonObject {
  if (!isPlainObject(body)) {
    throw new OrgEntitlementsClientError("invalid_body", { statusCode: 400, code: "INVALID_BODY" });
  }

  const path = normalizePath(body.path);
  const payload: JsonObject = { path };

  const required = normalizeBoolOrUndefined(body.required);
  if (required !== undefined) payload.required = required;

  const code = normalizeStringOrUndefined(body.code, "code", 128);
  if (code !== undefined) payload.code = code;

  const message = normalizeStringOrUndefined(body.message, "message", 256);
  if (message !== undefined) payload.message = message;

  return payload;
}

export function makeCoreOrgEntitlements(core: CoreClient): OrgEntitlementsClient {
  if (!core) throw new Error("makeCoreOrgEntitlements requires core client");

  async function getMe(
    q?: { view?: unknown } | null,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    try {
      const qs = buildQueryString({ view: normalizeView(q?.view) });
      const res = await core.get<any>(`/v1/org-entitlements/me${qs}`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getMeEffective(ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const res = await core.get<any>("/v1/org-entitlements/me/effective", ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getMePath(
    q: EntitlementPathQuery,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    try {
      const qs = buildQueryString(normalizePathQuery(q));
      const res = await core.get<any>(`/v1/org-entitlements/me/path${qs}`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getMeFeature(
    featureKey: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    try {
      const key = normalizeFeatureKey(featureKey);
      const res = await core.get<any>(`/v1/org-entitlements/me/features/${encodeURIComponent(key)}`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function checkMe(body: EntitlementCheckInput, ctx?: CoreRequestCtx) {
    try {
      const payload = normalizeCheckInput(body);
      const res = await core.post<any>("/v1/org-entitlements/me/check", payload, ctx, { maxRetries: 0 });
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getForOrg(
    orgId: unknown,
    q?: { view?: unknown } | null,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    try {
      const id = normalizeUuid(orgId, "invalid_org_id", "INVALID_ORG_ID");
      const qs = buildQueryString({ view: normalizeView(q?.view) });
      const res = await core.get<any>(`/v1/org-entitlements/${encodeURIComponent(id)}${qs}`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getForOrgEffective(
    orgId: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    try {
      const id = normalizeUuid(orgId, "invalid_org_id", "INVALID_ORG_ID");
      const res = await core.get<any>(`/v1/org-entitlements/${encodeURIComponent(id)}/effective`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getForOrgPath(
    orgId: unknown,
    q: EntitlementPathQuery,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    try {
      const id = normalizeUuid(orgId, "invalid_org_id", "INVALID_ORG_ID");
      const qs = buildQueryString(normalizePathQuery(q));
      const res = await core.get<any>(`/v1/org-entitlements/${encodeURIComponent(id)}/path${qs}`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getForOrgFeature(
    orgId: unknown,
    featureKey: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    try {
      const id = normalizeUuid(orgId, "invalid_org_id", "INVALID_ORG_ID");
      const key = normalizeFeatureKey(featureKey);
      const res = await core.get<any>(
        `/v1/org-entitlements/${encodeURIComponent(id)}/features/${encodeURIComponent(key)}`,
        ctx,
        retry ?? undefined
      );
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function checkForOrg(orgId: unknown, body: EntitlementCheckInput, ctx?: CoreRequestCtx) {
    try {
      const id = normalizeUuid(orgId, "invalid_org_id", "INVALID_ORG_ID");
      const payload = normalizeCheckInput(body);
      const res = await core.post<any>(
        `/v1/org-entitlements/${encodeURIComponent(id)}/check`,
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

  return {
    getMe,
    getMeEffective,
    getMePath,
    getMeFeature,
    checkMe,
    getForOrg,
    getForOrgEffective,
    getForOrgPath,
    getForOrgFeature,
    checkForOrg,
  };
}

export default makeCoreOrgEntitlements;