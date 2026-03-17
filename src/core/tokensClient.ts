// ============================================================================
// File: src/core/tokensClient.ts
// Version: 1.0-hash-factory-tokens-client | 2026-03-12
// Purpose:
//   Hash Factory -> Core "Tokens" client.
//   - Default auth: service key via CoreClient
//   - Optional pass-through auth via CoreRequestCtx
//   - Strict input normalization for token routes
// Notes:
//   - Thin proxy only. Core remains source of truth for token semantics,
//     ownership, RLS, scope checks, and entitlement enforcement.
// ============================================================================

import { CoreClient, CoreClientError, CoreRequestCtx } from "./coreClient.js";

type JsonObject = Record<string, unknown>;

export class TokensClientError extends Error {
  statusCode: number;
  code: string;
  detail?: unknown;
  requestId?: string | null;

  constructor(
    message: string,
    opts: { statusCode: number; code: string; detail?: unknown; requestId?: string | null }
  ) {
    super(message);
    this.name = "TokensClientError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.detail = opts.detail;
    this.requestId = opts.requestId ?? null;
  }
}

export type TokenPageQuery = Readonly<{
  limit?: unknown;
  offset?: unknown;
}>;

export type TokenSearchQuery = Readonly<{
  token_id?: unknown;
  symbol?: unknown;
  name?: unknown;
  purpose?: unknown;
  limit?: unknown;
  offset?: unknown;
}>;

export type TokensClient = Readonly<{
  listActive: (q?: TokenPageQuery | null, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  search: (q?: TokenSearchQuery | null, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  getByRowId: (id: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject | null>;
  getByTokenId: (tokenId: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject | null>;
  getBySymbolPurpose: (
    symbol: unknown,
    purpose: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<JsonObject | null>;
  listByPurpose: (
    purpose: unknown,
    q?: TokenPageQuery | null,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<JsonObject>;
  resolveForPurpose: (
    purpose: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<JsonObject | null>;

  create: (body: Record<string, unknown>, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  upsert: (body: Record<string, unknown>, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  patchMetadata: (tokenId: unknown, body: Record<string, unknown>, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  delete: (tokenId: unknown, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  restore: (tokenId: unknown, ctx?: CoreRequestCtx) => Promise<JsonObject>;
}>;

function isUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function normalizeUuid(v: unknown, message: string, code: string): string {
  const s = String(v ?? "").trim();
  if (!isUuid(s)) {
    throw new TokensClientError(message, { statusCode: 400, code });
  }
  return s;
}

function normalizeTokenId(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(s)) {
    throw new TokensClientError("invalid_token_id", {
      statusCode: 400,
      code: "INVALID_TOKEN_ID",
    });
  }
  return s;
}

function normalizePurpose(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(s)) {
    throw new TokensClientError("invalid_purpose", {
      statusCode: 400,
      code: "INVALID_PURPOSE",
    });
  }
  return s;
}

function normalizeSymbol(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!/^[^\s]{1,32}$/.test(s)) {
    throw new TokensClientError("invalid_symbol", {
      statusCode: 400,
      code: "INVALID_SYMBOL",
    });
  }
  return s;
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  const x = Math.trunc(n);
  return Math.max(min, Math.min(max, x));
}

function normalizePageQuery(q?: TokenPageQuery | null): { limit?: number; offset?: number } {
  const src = q ?? {};
  return {
    limit: clampInt(src.limit, 1, 1000, 100),
    offset: clampInt(src.offset, 0, 10_000_000, 0),
  };
}

function sanitizeMetadata(v: unknown): Record<string, unknown> | undefined {
  if (v === undefined) return undefined;
  if (!isPlainObject(v)) {
    throw new TokensClientError("invalid_metadata", {
      statusCode: 400,
      code: "INVALID_METADATA",
    });
  }
  for (const k of Object.keys(v)) {
    if (k === "__proto__" || k === "prototype" || k === "constructor") {
      throw new TokensClientError("invalid_metadata", {
        statusCode: 400,
        code: "INVALID_METADATA",
      });
    }
  }
  return v;
}

function unwrapResult(res: unknown): JsonObject {
  const out = (res as any)?.result ?? res;
  return out && typeof out === "object" && !Array.isArray(out) ? (out as JsonObject) : {};
}

function unwrapMaybeToken(res: unknown): JsonObject | null {
  const out = (res as any)?.result ?? res;
  return out && typeof out === "object" && !Array.isArray(out) ? (out as JsonObject) : null;
}

function buildQueryString(q: Record<string, string | number | boolean | null | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === null || v === undefined) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

function normalizeCreateOrUpsertBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(body)) {
    throw new TokensClientError("invalid_body", { statusCode: 400, code: "INVALID_BODY" });
  }

  const out: Record<string, unknown> = {
    token_id: normalizeTokenId(body.token_id),
    symbol: normalizeSymbol(body.symbol),
    purpose: normalizePurpose(body.purpose),
  };

  if (body.name !== undefined) {
    const name = String(body.name ?? "").trim();
    if (name.length > 150) {
      throw new TokensClientError("invalid_name", { statusCode: 400, code: "INVALID_NAME" });
    }
    out.name = name || null;
  }

  if (body.decimals !== undefined) {
    const d = Number(body.decimals);
    if (!Number.isInteger(d) || d < 0 || d > 18) {
      throw new TokensClientError("invalid_decimals", { statusCode: 400, code: "INVALID_DECIMALS" });
    }
    out.decimals = d;
  }

  const metadata = sanitizeMetadata(body.metadata);
  if (metadata !== undefined) out.metadata = metadata;

  if (body.restoreIfDeleted !== undefined) out.restoreIfDeleted = Boolean(body.restoreIfDeleted);

  const allowed = new Set(["token_id", "symbol", "name", "purpose", "decimals", "metadata", "restoreIfDeleted"]);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) {
      throw new TokensClientError("invalid_request", { statusCode: 400, code: "INVALID_REQUEST" });
    }
  }

  return out;
}

function normalizePatchMetadataBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(body)) {
    throw new TokensClientError("invalid_body", { statusCode: 400, code: "INVALID_BODY" });
  }

  const allowed = new Set(["patch"]);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) {
      throw new TokensClientError("invalid_request", { statusCode: 400, code: "INVALID_REQUEST" });
    }
  }

  const patch = sanitizeMetadata(body.patch);
  if (!patch) {
    throw new TokensClientError("invalid_patch", { statusCode: 400, code: "INVALID_PATCH" });
  }

  return { patch };
}

function normalizeSearchQuery(q?: TokenSearchQuery | null): Record<string, string | number | boolean | null | undefined> {
  const src = q ?? {};
  const out: Record<string, string | number | boolean | null | undefined> = {
    ...normalizePageQuery(src),
  };

  if (src.token_id !== undefined) out.token_id = normalizeTokenId(src.token_id);
  if (src.symbol !== undefined) out.symbol = normalizeSymbol(src.symbol);

  if (src.name !== undefined) {
    const name = String(src.name ?? "").trim();
    if (!name || name.length > 512) {
      throw new TokensClientError("invalid_name", { statusCode: 400, code: "INVALID_NAME" });
    }
    out.name = name;
  }

  if (src.purpose !== undefined) out.purpose = normalizePurpose(src.purpose);

  return out;
}

function mapCoreError(err: unknown): Error {
  if (err instanceof TokensClientError) return err;

  if (err instanceof CoreClientError) {
    const status = err.status;
    const code = err.code || null;
    const detail = (err as any).detail;
    const requestId = err.requestId ?? null;

    if (status === 400) {
      return new TokensClientError("bad_request", { statusCode: 400, code: code ?? "BAD_REQUEST", detail, requestId });
    }
    if (status === 401) {
      return new TokensClientError("unauthorized", { statusCode: 401, code: code ?? "AUTH_REQUIRED", detail, requestId });
    }
    if (status === 403) {
      return new TokensClientError("forbidden", { statusCode: 403, code: code ?? "FORBIDDEN", detail, requestId });
    }
    if (status === 404) {
      return new TokensClientError("not_found", { statusCode: 404, code: code ?? "NOT_FOUND", detail, requestId });
    }
    if (status === 409) {
      return new TokensClientError("conflict", { statusCode: 409, code: code ?? "CONFLICT", detail, requestId });
    }

    return new TokensClientError("upstream_error", {
      statusCode: 502,
      code: code ?? "UPSTREAM_ERROR",
      detail,
      requestId,
    });
  }

  return new TokensClientError("internal_error", {
    statusCode: 500,
    code: "INTERNAL_ERROR",
  });
}

export function makeCoreTokens(core: CoreClient): TokensClient {
  if (!core) throw new Error("makeCoreTokens requires core client");

  async function listActive(
    q?: TokenPageQuery | null,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    try {
      const qs = buildQueryString(normalizePageQuery(q));
      const res = await core.get<any>(`/v1/tokens${qs}`, ctx, retry ?? undefined);
      return unwrapResult(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function search(
    q?: TokenSearchQuery | null,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    try {
      const qs = buildQueryString(normalizeSearchQuery(q));
      const res = await core.get<any>(`/v1/tokens/search${qs}`, ctx, retry ?? undefined);
      return unwrapResult(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getByRowId(id: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const rowId = normalizeUuid(id, "invalid_token_row_id", "INVALID_TOKEN_ROW_ID");
      const res = await core.get<any>(`/v1/tokens/by-id/${encodeURIComponent(rowId)}`, ctx, retry ?? undefined);
      return unwrapMaybeToken(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getByTokenId(tokenId: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const tid = normalizeTokenId(tokenId);
      const res = await core.get<any>(`/v1/tokens/by-token-id/${encodeURIComponent(tid)}`, ctx, retry ?? undefined);
      return unwrapMaybeToken(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getBySymbolPurpose(
    symbol: unknown,
    purpose: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    try {
      const qs = buildQueryString({
        symbol: normalizeSymbol(symbol),
        purpose: normalizePurpose(purpose),
      });
      const res = await core.get<any>(`/v1/tokens/by-symbol-purpose${qs}`, ctx, retry ?? undefined);
      return unwrapMaybeToken(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function listByPurpose(
    purpose: unknown,
    q?: TokenPageQuery | null,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    try {
      const pur = normalizePurpose(purpose);
      const qs = buildQueryString(normalizePageQuery(q));
      const res = await core.get<any>(`/v1/tokens/purpose/${encodeURIComponent(pur)}${qs}`, ctx, retry ?? undefined);
      return unwrapResult(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function resolveForPurpose(
    purpose: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    try {
      const pur = normalizePurpose(purpose);
      const res = await core.get<any>(`/v1/tokens/purpose/${encodeURIComponent(pur)}/resolve`, ctx, retry ?? undefined);
      return unwrapMaybeToken(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function create(body: Record<string, unknown>, ctx?: CoreRequestCtx) {
    try {
      const payload = normalizeCreateOrUpsertBody(body);
      const res = await core.post<any>("/v1/tokens", payload, ctx, { maxRetries: 0 });
      return unwrapResult(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function upsert(body: Record<string, unknown>, ctx?: CoreRequestCtx) {
    try {
      const payload = normalizeCreateOrUpsertBody(body);
      const res = await core.put<any>("/v1/tokens", payload, ctx, { maxRetries: 0 });
      return unwrapResult(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function patchMetadata(tokenId: unknown, body: Record<string, unknown>, ctx?: CoreRequestCtx) {
    try {
      const tid = normalizeTokenId(tokenId);
      const payload = normalizePatchMetadataBody(body);
      const res = await core.post<any>(`/v1/tokens/${encodeURIComponent(tid)}/metadata`, payload, ctx, { maxRetries: 0 });
      return unwrapResult(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function del(tokenId: unknown, ctx?: CoreRequestCtx) {
    try {
      const tid = normalizeTokenId(tokenId);
      const res = await core.delete<any>(`/v1/tokens/${encodeURIComponent(tid)}`, ctx, { maxRetries: 0 });
      return unwrapResult(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function restore(tokenId: unknown, ctx?: CoreRequestCtx) {
    try {
      const tid = normalizeTokenId(tokenId);
      const res = await core.post<any>(`/v1/tokens/${encodeURIComponent(tid)}/restore`, {}, ctx, { maxRetries: 0 });
      return unwrapResult(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  return {
    listActive,
    search,
    getByRowId,
    getByTokenId,
    getBySymbolPurpose,
    listByPurpose,
    resolveForPurpose,
    create,
    upsert,
    patchMetadata,
    delete: del,
    restore,
  };
}

export default makeCoreTokens;