// ============================================================================
// File: src/core/userKeysClient.ts
// Version: 1.1-hash-factory-user-keys-client | 2026-02-20
// Purpose:
//   Hash Factory -> Core "User Keys" client.
//   - Default auth: service key via CoreClient (CORE_SERVICE_API_KEY)
//   - Optional per-request auth override via CoreRequestCtx (coreAuthHeader/coreApiKey) for user pass-through
//   - Strict input normalization (UUIDs, pagination, metadata bounds)
//   - Defense-in-depth: deep redaction of private/secret material
//   - Response shaping via allowlist (stable HF contract)
//   - Correlation id propagation + structured core_call hook via CoreRequestCtx
//   - No retries by default; callers may opt-in for GET/HEAD only (and idempotent POSTs w/ idempotencyKey)
//
// Notes:
//   - Core remains source-of-truth for authz (RLS) and final validation.
//   - HF must enforce its own boundary authz before calling admin endpoints.
//   - This client never returns private key material even if Core regresses.
// ============================================================================

import { CoreClient, CoreClientError, CoreRequestCtx } from "./coreClient.js";

export type JsonObject = Record<string, unknown>;

export class UserKeysClientError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, opts: { statusCode: number; code: string }) {
    super(message);
    this.name = "UserKeysClientError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
  }
}

// ---------------------------------------------------------------------------
// Input guards / normalizers
// ---------------------------------------------------------------------------

function isUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function toInt(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const x = Number(n);
  const v = Number.isFinite(x) ? Math.trunc(x) : fallback;
  return Math.max(min, Math.min(max, v));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function bytesOfJson(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? {}), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function normalizeUserId(userId: unknown): string {
  const s = String(userId ?? "").trim();
  if (!isUuid(s)) throw new UserKeysClientError("invalid_user_id", { statusCode: 400, code: "INVALID_USER_ID" });
  return s;
}

function normalizeKeyTypeOrDefault(v: unknown): "rsa-2048" | "rsa-4096" | "ecdsa-p256" | "ecdsa-p384" {
  const s = String(v ?? "").trim();
  if (!s) return "rsa-2048";
  if (s === "rsa-2048" || s === "rsa-4096" || s === "ecdsa-p256" || s === "ecdsa-p384") return s;
  throw new UserKeysClientError("invalid_key_type", { statusCode: 400, code: "INVALID_KEY_TYPE" });
}

function readEnvInt(name: string, def: number): number {
  const raw = process.env[name];
  if (raw == null) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function maxMetadataBytes(): number {
  // Keep consistent with Core default (16_384) but clamp for safety.
  const def = 16_384;
  const n = readEnvInt("HF_USER_KEYS_MAX_METADATA_BYTES", def);
  return Math.max(256, Math.min(256 * 1024, n));
}

function sanitizeMetadataOrEmpty(v: unknown, maxBytes: number): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (!isPlainObject(v)) throw new UserKeysClientError("invalid_metadata", { statusCode: 400, code: "INVALID_METADATA" });

  // Prototype pollution defense
  for (const k of Object.keys(v)) {
    if (k === "__proto__" || k === "prototype" || k === "constructor") {
      throw new UserKeysClientError("invalid_metadata", { statusCode: 400, code: "INVALID_METADATA" });
    }
  }

  if (bytesOfJson(v) > maxBytes) {
    throw new UserKeysClientError("metadata_too_large", { statusCode: 400, code: "METADATA_TOO_LARGE" });
  }

  return v;
}

export type HistoryQuery = Readonly<{
  limit?: number | null;
  offset?: number | null;
  includeDeleted?: boolean | null;
}>;

function normalizeHistoryQuery(q: HistoryQuery | undefined): { limit: number; offset: number; includeDeleted: boolean } {
  const limit = clampInt(q?.limit, 1, 500, 50);
  const offset = clampInt(q?.offset, 0, 10_000_000, 0);
  const includeDeleted = Boolean(q?.includeDeleted);
  return { limit, offset, includeDeleted };
}

function buildQueryString(q: Record<string, string | number | boolean | null | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === null || v === undefined) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

// ---------------------------------------------------------------------------
// Defense-in-depth redaction (mirror Core PRIVATE_FIELD_NAMES)
// ---------------------------------------------------------------------------

const PRIVATE_FIELD_NAMES = new Set([
  "private_key",
  "privateKey",
  "private_key_pem",
  "privateKeyPem",
  "private_jwk",
  "privateJwk",
  "secret",
  "secret_key",
  "secretKey",
  "seed",
  "mnemonic",
  "passphrase",
  "raw_key",
  "rawKey",
  "key_material",
  "keyMaterial",
  "encrypted_private_key",
  "encryptedPrivateKey",
  "encrypted_private_key_pem",
  "encryptedPrivateKeyPem",
  "key_envelope",
  "keyEnvelope",
  "envelope",
  "data_key",
  "dataKey",
  "dek",
  "kek",
  "master_key",
  "masterKey",
]);

function redactPrivateFieldsDeep(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redactPrivateFieldsDeep);
  if (typeof value !== "object") return value;

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (PRIVATE_FIELD_NAMES.has(k)) continue;
    out[k] = redactPrivateFieldsDeep(v);
  }
  return out;
}

const ALLOWED_PUBLIC_KEY_FIELDS = new Set([
  "user_id",
  "key_type",
  "public_key_pem",
  "public_jwk",
  "created_at",
  "updated_at",
  "metadata",
  "status",
  "revoked_at",
  "rotated_at",
  "version",
]);

const ALLOWED_HISTORY_ROW_FIELDS = new Set([
  "key_id",
  "user_id",
  "key_type",
  "public_key_pem",
  "public_jwk",
  "created_at",
  "revoked_at",
  "rotated_at",
  "status",
  "metadata",
  "version",
  "deleted_at",
]);

function pickAllowlistedObject(v: unknown, allow: Set<string>): Record<string, unknown> {
  if (!isPlainObject(v)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (!allow.has(k)) continue;
    out[k] = val;
  }
  return out;
}

function shapePublicKeyResult(v: unknown): Record<string, unknown> {
  const redacted = redactPrivateFieldsDeep(v);
  if (!isPlainObject(redacted)) {
    throw new UserKeysClientError("upstream_contract_error", { statusCode: 502, code: "UPSTREAM_CONTRACT_ERROR" });
  }
  return pickAllowlistedObject(redacted, ALLOWED_PUBLIC_KEY_FIELDS);
}

function shapeHistoryResult(v: unknown): Record<string, unknown> {
  const redacted = redactPrivateFieldsDeep(v);

  if (!isPlainObject(redacted)) {
    throw new UserKeysClientError("upstream_contract_error", { statusCode: 502, code: "UPSTREAM_CONTRACT_ERROR" });
  }
  const obj = redacted as Record<string, unknown>;
  const rowsRaw = obj["rows"];
  const rows =
    Array.isArray(rowsRaw)
      ? rowsRaw.map((r) => pickAllowlistedObject(r, ALLOWED_HISTORY_ROW_FIELDS))
      : [];

  const base: Record<string, unknown> = {};
  // Preserve paging fields if present
  for (const k of ["user_id", "limit", "offset", "total"]) {
    if (obj[k] !== undefined) base[k] = obj[k];
  }
  // Canonicalize includeDeleted (preserve either casing if Core changes)
  if (obj["includeDeleted"] !== undefined) base["includeDeleted"] = obj["includeDeleted"];
  else if (obj["include_deleted"] !== undefined) base["includeDeleted"] = obj["include_deleted"];
  base["rows"] = rows;

  return base;
}

function unwrapResult(res: unknown): unknown {
  return (res as any)?.result ?? res;
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export type UserKeysClient = Readonly<{
  getMePublicKey: (ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<Record<string, unknown>>;
  getMeHistory: (
    q?: HistoryQuery,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<Record<string, unknown>>;
  getUserPublicKey: (
    userId: string,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<Record<string, unknown>>;
  getUserHistory: (
    userId: string,
    q?: HistoryQuery,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<Record<string, unknown>>;

  generateUserKey: (
    userId: string,
    input?: { keyType?: unknown; metadata?: unknown } | null,
    ctx?: CoreRequestCtx,
  ) => Promise<Record<string, unknown>>;

  rotateUserKey: (
    userId: string,
    input?: { reseal?: unknown; metadata?: unknown } | null,
    ctx?: CoreRequestCtx,
  ) => Promise<Record<string, unknown>>;

  revokeUserKey: (userId: string, ctx?: CoreRequestCtx,) => Promise<Record<string, unknown>>;
}>;

export function makeCoreUserKeys(core: CoreClient): UserKeysClient {
  if (!core) throw new Error("makeCoreUserKeys requires core client");

  const metaMax = maxMetadataBytes();

  function mapCoreError(err: unknown): Error {
    if (err instanceof UserKeysClientError) return err;
    if (err instanceof CoreClientError) {
      const status = err.status;
      const code = err.code || null;

      if (status === 400) return new UserKeysClientError("bad_request", { statusCode: 400, code: code ?? "BAD_REQUEST" });
      if (status === 401) return new UserKeysClientError("unauthorized", { statusCode: 401, code: code ?? "AUTH_REQUIRED" });
      if (status === 403) return new UserKeysClientError("forbidden", { statusCode: 403, code: code ?? "FORBIDDEN" });
      if (status === 404) return new UserKeysClientError("not_found", { statusCode: 404, code: code ?? "NOT_FOUND" });

      return new UserKeysClientError("upstream_error", { statusCode: 502, code: code ?? "UPSTREAM_ERROR" });
    }
    return new UserKeysClientError("internal_error", { statusCode: 500, code: "INTERNAL_ERROR" });
  }

  async function getMePublicKey(ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const res = await core.get<any>("/v1/user-keys/me/public", ctx, retry ?? undefined);
      return shapePublicKeyResult(unwrapResult(res));
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getMeHistory(q?: HistoryQuery, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    const n = normalizeHistoryQuery(q);
    const qs = buildQueryString({ limit: n.limit, offset: n.offset, includeDeleted: n.includeDeleted });
    try {
      const res = await core.get<any>(`/v1/user-keys/me/history${qs}`, ctx, retry ?? undefined);
      return shapeHistoryResult(unwrapResult(res));
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getUserPublicKey(userId: string, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    const uid = normalizeUserId(userId);
    try {
      const res = await core.get<any>(`/v1/user-keys/${encodeURIComponent(uid)}/public`, ctx, retry ?? undefined);
      return shapePublicKeyResult(unwrapResult(res));
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getUserHistory(
    userId: string,
    q?: HistoryQuery,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    const uid = normalizeUserId(userId);
    const n = normalizeHistoryQuery(q);
    const qs = buildQueryString({ limit: n.limit, offset: n.offset, includeDeleted: n.includeDeleted });

    try {
      const res = await core.get<any>(`/v1/user-keys/${encodeURIComponent(uid)}/history${qs}`, ctx, retry ?? undefined);
      return shapeHistoryResult(unwrapResult(res));
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function generateUserKey(userId: string, input?: { keyType?: unknown; metadata?: unknown } | null, ctx?: CoreRequestCtx) {
    const uid = normalizeUserId(userId);
    const keyType = normalizeKeyTypeOrDefault(input?.keyType);
    const metadata = sanitizeMetadataOrEmpty(input?.metadata, metaMax);

    const body = { key_type: keyType, metadata };

    try {
      const res = await core.post<any>(`/v1/user-keys/${encodeURIComponent(uid)}/generate`, body, ctx, { maxRetries: 0 });
      return shapePublicKeyResult(unwrapResult(res));
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function rotateUserKey(userId: string, input?: { reseal?: unknown; metadata?: unknown } | null, ctx?: CoreRequestCtx) {
    const uid = normalizeUserId(userId);
    const reseal = input?.reseal === undefined || input?.reseal === null ? true : Boolean(input.reseal);
    const metadata = sanitizeMetadataOrEmpty(input?.metadata, metaMax);

    const body = { reseal, metadata };

    try {
      const res = await core.post<any>(`/v1/user-keys/${encodeURIComponent(uid)}/rotate`, body, ctx, { maxRetries: 0 });
      return shapePublicKeyResult(unwrapResult(res));
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function revokeUserKey(userId: string, ctx?: CoreRequestCtx) {
    const uid = normalizeUserId(userId);

    try {
      const res = await core.post<any>(`/v1/user-keys/${encodeURIComponent(uid)}/revoke`, {}, ctx, { maxRetries: 0 });
      const redacted = redactPrivateFieldsDeep(unwrapResult(res));
      return isPlainObject(redacted) ? (redacted as Record<string, unknown>) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  return {
    getMePublicKey,
    getMeHistory,
    getUserPublicKey,
    getUserHistory,
    generateUserKey,
    rotateUserKey,
    revokeUserKey,
  };
}

export default makeCoreUserKeys;