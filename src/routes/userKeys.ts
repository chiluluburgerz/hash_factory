// ============================================================================
// File: src/routes/userKeys.ts
// Version: 1.0-hash-factory-user-keys-routes | 2026-02-18
// Purpose:
//   Fastify "User Keys" routes for Hash Factory.
//   - Hardened gateway to Core user-keys endpoints.
//   - Multi-tenant safe by default: HF enforces minimal boundary authz,
//     Core remains source-of-truth via RLS.
//   - Defense-in-depth DoS guards: per-route body cap, metadata caps,
//     strict UUID validation, prototype-pollution blocking, bounded query params.
//   - Strong secrecy posture: HF never returns private key material (client already redacts),
//     and forces no-store headers on all endpoints.
//
// Auth model:
//   - HF requires auth (app.requireAuth) and uses req.actor for boundary checks.
//   - Core calls default to PASS-THROUGH auth (same incoming bearer/x-api-key),
//     preserving Core auditability + actor/RLS semantics.
//   - You can optionally force service-key auth for admin endpoints via env.
//
// Routes:
//   GET  /user-keys/me/public
//   GET  /user-keys/me/history?limit&offset&includeDeleted
//   GET  /user-keys/:user_id/public
//   GET  /user-keys/:user_id/history?limit&offset&includeDeleted
//   POST /user-keys/:user_id/generate   { key_type?, metadata? }
//   POST /user-keys/:user_id/rotate     { reseal?, metadata? }
//   POST /user-keys/:user_id/revoke     {}
// ============================================================================

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { CoreClientError } from "../core/coreClient.js";
import { UserKeysClient, UserKeysClientError } from "../core/userKeysClient.js";
import {
  createFixedWindowRateLimiter,
  rateLimitEnabled,
  getClientIp,
  applyRateLimitHeaders,
  rejectRateLimited,
  readEnvInt,
} from "../utils/rateLimit.js";

type Actor = Readonly<{
  user_id?: string | null;
  org_id?: string | null;
  org_role?: string | null;
  is_system_admin?: boolean | null;
  is_admin?: boolean | null;
  isAdmin?: boolean | null;
  scopes?: string[] | string | null;
  api_key_scopes?: string[] | string | null;
  apiKeyScopes?: string[] | string | null;
}>;

function isSystemAdmin(actor: Actor | null | undefined): boolean {
  return Boolean(actor?.is_system_admin || actor?.is_admin || actor?.isAdmin);
}

function isTenantAdmin(actor: Actor | null | undefined): boolean {
  return String(actor?.org_role ?? "") === "tenant_admin";
}

function requireActor(req: FastifyRequest): Actor {
  const actor = (req as any).actor ?? null;
  if (actor && typeof actor === "object") return actor as Actor;
  const e: any = new Error("Unauthorized");
  e.statusCode = 401;
  e.code = "AUTH_REQUIRED";
  throw e;
}

function requireTenantAdminOrSystem(actor: Actor) {
  if (isSystemAdmin(actor) || isTenantAdmin(actor)) return;
  const e: any = new Error("Forbidden");
  e.statusCode = 403;
  e.code = "TENANT_ADMIN_REQUIRED";
  throw e;
}

function requireSelfOrTenantAdmin(actor: Actor, targetUserId: string) {
  if (isSystemAdmin(actor)) return;
  const selfId = String(actor?.user_id ?? "");
  if (selfId && selfId === targetUserId) return;
  if (isTenantAdmin(actor)) return;

  const e: any = new Error("Forbidden");
  e.statusCode = 403;
  e.code = "FORBIDDEN";
  throw e;
}

function toInt(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = toInt(v, def);
  return Math.max(min, Math.min(max, n));
}

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

function bytesOfJson(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? {}), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function maxRouteBodyBytes(): number {
  const raw = process.env.USER_KEYS_ROUTE_BODY_MAX_BYTES ?? process.env.HTTP_ROUTE_BODY_MAX_BYTES ?? null;
  const def = 65_536;
  if (raw == null || raw === "") return def;
  const v = toInt(raw, def);
  return Math.max(256, Math.min(2_000_000, v));
}

function maxMetadataBytes(): number {
  // Prefer HF-specific env (matches your HF client), else fall back to generic.
  const raw = process.env.HF_USER_KEYS_MAX_METADATA_BYTES ?? process.env.USER_KEYS_MAX_METADATA_BYTES ?? null;
  const def = 16_384;
  if (raw == null || raw === "") return def;
  const v = toInt(raw, def);
  return Math.max(256, Math.min(256 * 1024, v));
}

function requireBodyObject(req: FastifyRequest): Record<string, unknown> {
  const body = (req as any).body;
  if (!isPlainObject(body)) {
    const e: any = new Error("invalid_body");
    e.statusCode = 400;
    e.code = "INVALID_BODY";
    throw e;
  }

  if (bytesOfJson(body) > maxRouteBodyBytes()) {
    const e: any = new Error("payload_too_large");
    e.statusCode = 413;
    e.code = "PAYLOAD_TOO_LARGE";
    throw e;
  }

  // Prototype pollution defense.
  for (const k of Object.keys(body)) {
    if (k === "__proto__" || k === "prototype" || k === "constructor") {
      const e: any = new Error("invalid_body");
      e.statusCode = 400;
      e.code = "INVALID_BODY";
      throw e;
    }
  }

  return body;
}

function scopesOf(actor: Actor | null | undefined): string[] {
  const s = actor?.scopes ?? actor?.api_key_scopes ?? actor?.apiKeyScopes ?? null;
  if (Array.isArray(s)) return s.map((x) => String(x)).filter(Boolean).slice(0, 128);
  if (typeof s === "string" && s.trim()) return s.split(/[\s,]+/g).map((x) => x.trim()).filter(Boolean).slice(0, 128);
  return [];
}

function hasScope(actor: Actor | null | undefined, scope: string): boolean {
  const list = scopesOf(actor);
  // Backwards-compatible default: allow empty scopes in non-prod.
  const allowEmpty = process.env.USER_KEYS_ALLOW_EMPTY_SCOPES
    ? String(process.env.USER_KEYS_ALLOW_EMPTY_SCOPES).trim() !== "false"
    : String(process.env.NODE_ENV ?? "").toLowerCase() !== "production";

  if (list.length === 0 && allowEmpty) return true;

  const sc = String(scope);
  return list.includes(sc) || list.includes("user_keys:*");
}

function enforceScopesEnabled(): boolean {
  if (process.env.USER_KEYS_ENFORCE_SCOPES != null) return String(process.env.USER_KEYS_ENFORCE_SCOPES) === "true";
  return String(process.env.NODE_ENV ?? "").toLowerCase() === "production";
}

function requireAnyScope(actor: Actor, scopes: string[]) {
  if (!enforceScopesEnabled()) return;
  if (isSystemAdmin(actor)) return;
  for (const s of scopes) {
    if (hasScope(actor, s)) return;
  }
  const e: any = new Error("Forbidden");
  e.statusCode = 403;
  e.code = "SCOPE_REQUIRED";
  e.detail = { scopes: scopes.map(String) };
  throw e;
}

// Metadata structural guard (JSON-only, bounded)
const META_MAX_KEYS = clampInt(process.env.USER_KEYS_METADATA_MAX_KEYS, 16, 4096, 128);
const META_MAX_DEPTH = clampInt(process.env.USER_KEYS_METADATA_MAX_DEPTH, 1, 16, 4);
const META_MAX_ARRAY = clampInt(process.env.USER_KEYS_METADATA_MAX_ARRAY, 1, 2000, 50);
const META_MAX_STRING = clampInt(process.env.USER_KEYS_METADATA_MAX_STRING, 32, 1_000_000, 4096);

function isDangerousKey(k: string): boolean {
  return k === "__proto__" || k === "prototype" || k === "constructor";
}

function validateMetadataShape(value: unknown, depth: number, keysSeen: { n: number }) {
  if (value === null || value === undefined) return;

  if (depth > META_MAX_DEPTH) throw new Error("metadata_max_depth_exceeded");

  const t = typeof value;

  if (t === "string") {
    if ((value as string).length > META_MAX_STRING) throw new Error("metadata_string_too_large");
    return;
  }
  if (t === "number") {
    if (!Number.isFinite(value as number)) throw new Error("metadata_invalid_number");
    return;
  }
  if (t === "boolean") return;

  if (Array.isArray(value)) {
    if (value.length > META_MAX_ARRAY) throw new Error("metadata_array_too_large");
    for (const v of value) validateMetadataShape(v, depth + 1, keysSeen);
    return;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (keysSeen.n + entries.length > META_MAX_KEYS) throw new Error("metadata_too_many_keys");

    for (const [k, v] of entries) {
      if (isDangerousKey(k)) throw new Error("metadata_dangerous_key");
      keysSeen.n += 1;
      validateMetadataShape(v, depth + 1, keysSeen);
    }
    return;
  }

  throw new Error("metadata_invalid_type");
}

function requireAndValidateMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata == null) return {};
  if (!isPlainObject(metadata)) {
    const e: any = new Error("invalid_metadata");
    e.statusCode = 400;
    e.code = "INVALID_METADATA";
    throw e;
  }

  if (bytesOfJson(metadata) > maxMetadataBytes()) {
    const e: any = new Error("metadata_too_large");
    e.statusCode = 400;
    e.code = "METADATA_TOO_LARGE";
    throw e;
  }

  try {
    validateMetadataShape(metadata, 0, { n: 0 });
  } catch (err: any) {
    const e: any = new Error(String(err?.message || "invalid_metadata"));
    e.statusCode = 400;
    e.code = "INVALID_METADATA";
    throw e;
  }

  // Re-check proto pollution at top level (defense-in-depth).
  for (const k of Object.keys(metadata)) {
    if (isDangerousKey(k)) {
      const e: any = new Error("invalid_metadata");
      e.statusCode = 400;
      e.code = "INVALID_METADATA";
      throw e;
    }
  }

  return metadata;
}

function ctxFromReq(req: FastifyRequest): { requestId?: string | null; clientRequestId?: string | null } {
  return {
    requestId: (req as any)?.requestId ?? (req as any)?.id ?? null,
    clientRequestId: (req as any)?.clientRequestId ?? null,
  };
}

function extractIncomingAuthHeader(req: FastifyRequest): string | null {
  // HF auth accepts Authorization: Bearer or x-api-key; normalize to "Bearer <token>".
  const authRaw = req.headers.authorization;
  const xRaw = (req.headers as any)["x-api-key"];

  const bearer =
    typeof authRaw === "string" && authRaw.toLowerCase().startsWith("bearer ")
      ? authRaw.slice("bearer ".length).trim()
      : null;

  const x = typeof xRaw === "string" ? xRaw.trim() : null;

  if (bearer && x && bearer !== x) {
    const e: any = new Error("Multiple API key headers provided");
    e.statusCode = 400;
    e.code = "AUTH_AMBIGUOUS";
    throw e;
  }

  const token = bearer || x || null;
  if (!token) return null;

  if (token.length > 1024) {
    const e: any = new Error("API key too long");
    e.statusCode = 400;
    e.code = "AUTH_INVALID";
    throw e;
  }

  return `Bearer ${token}`;
}

function idempotencyKeyFromReq(req: FastifyRequest): string | null {
  const h = (req.headers as any) || {};
  const raw = h["idempotency-key"] ?? h["x-idempotency-key"] ?? null;
  if (raw == null) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > 256 ? s.slice(0, 256) : s;
}

function actorTag(actor: Actor | null | undefined): string | null {
  if (!actor) return null;
  const u = actor.user_id ? String(actor.user_id) : "";
  const o = actor.org_id ? String(actor.org_id) : "";
  const r = actor.org_role ? String(actor.org_role) : "";
  if (!u && !o && !r) return null;
  return `u:${u || "?"}|o:${o || "?"}|r:${r || "?"}`;
}

function coreCtx(req: FastifyRequest, actor: Actor | null, forWrite: boolean, passThroughAuth: boolean) {
  const base = ctxFromReq(req);
  const hfActor = actorTag(actor);
  const idempotencyKey = forWrite ? idempotencyKeyFromReq(req) : null;
  const coreAuthHeader = passThroughAuth ? extractIncomingAuthHeader(req) : null;

  return {
    ...base,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(coreAuthHeader ? { coreAuthHeader } : {}),
    ...(hfActor ? { hfActor } : {}),
    onCoreCall: (line: any) => {
      const logger: any = (req as any).log ?? console;
      logger.info({ event: "core_call", ...line }, "core_call");
    },
  };
}

function mapCoreError(err: unknown): Error {
  if (err instanceof UserKeysClientError) {
    const e: any = new Error(err.message || "upstream_error");
    const sc = Number(err.statusCode);
    e.statusCode = sc >= 400 && sc <= 599 ? sc : 502;
    e.code = err.code || (e.statusCode >= 500 ? "UPSTREAM_ERROR" : "BAD_REQUEST");
    return e;
  }

  if (err instanceof CoreClientError) {
    const e: any = new Error(err.message || "upstream_error");
    e.statusCode = err.status >= 400 && err.status <= 599 ? err.status : 502;
    e.code = err.code ?? (e.statusCode >= 500 ? "UPSTREAM_ERROR" : "BAD_REQUEST");
    if (err.requestId) e.upstream_request_id = err.requestId;
    return e;
  }
  const e: any = new Error("internal_error");
  e.statusCode = 500;
  e.code = "INTERNAL_ERROR";
  return e;
}

function scrubSecrets(value: unknown): unknown {
  // Defense-in-depth: never allow private key material or sealed payloads to escape HF
  // even if upstream regresses.
  const deny = new Set([
    "private_key",
    "privateKey",
    "secret_key",
    "secretKey",
    "key_material",
    "keyMaterial",
    "sealed",
    "envelope",
    "ciphertext",
    "plaintext",
    "pem",
    "pkcs8",
  ]);

  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(scrubSecrets);

  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (deny.has(k)) continue;
    out[k] = scrubSecrets(v);
  }
  return out;
}

function buildQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "boolean") usp.set(k, v ? "true" : "false");
    else usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

function normalizeHistoryQuery(req: FastifyRequest): { limit: number; offset: number; includeDeleted: boolean } {
  const q: any = (req as any).query ?? {};
  const limit = clampInt(q.limit, 1, 500, 50);
  const offset = clampInt(q.offset, 0, 10_000_000, 0);
  const includeDeletedRaw = q.includeDeleted;
  const includeDeleted =
    includeDeletedRaw == null ? false : String(includeDeletedRaw).trim().toLowerCase() === "true";
  return { limit, offset, includeDeleted };
}

function normalizeKeyTypeOrDefault(v: unknown): "rsa-2048" | "rsa-4096" | "ecdsa-p256" | "ecdsa-p384" {
  const s = String(v ?? "").trim();
  if (!s) return "rsa-2048";
  if (s === "rsa-2048" || s === "rsa-4096" || s === "ecdsa-p256" || s === "ecdsa-p384") return s;
  const e: any = new Error("invalid_key_type");
  e.statusCode = 400;
  e.code = "INVALID_KEY_TYPE";
  throw e;
}

function shouldUseServiceKeyForAdmin(): boolean {
  return String(process.env.HF_USER_KEYS_USE_SERVICE_KEY_FOR_ADMIN ?? "").trim() === "true";
}

// ----------------------------------------------------------------------------
// Plugin
// ----------------------------------------------------------------------------
export type UserKeysRoutesOpts = Readonly<{
  userKeys: UserKeysClient;
}>;

export const userKeysRoutes: FastifyPluginAsync<UserKeysRoutesOpts> = async (app: FastifyInstance, opts) => {
  if (!opts?.userKeys) throw new Error("userKeysRoutes requires userKeys client");
  const userKeys = opts.userKeys;

  const requireAuth = app.requireAuth();

  // Rate limits
  const windowMs = Math.max(1_000, readEnvInt(["USER_KEYS_RATE_LIMIT_WINDOW_MS"], 60_000));
  const maxEntries = Math.max(1_000, readEnvInt(["USER_KEYS_RATE_LIMIT_MAX_ENTRIES"], 50_000));

  const maxReads = Math.max(1, readEnvInt(["USER_KEYS_RATE_LIMIT_READ_MAX"], 240)); // /min
  const maxWrites = Math.max(1, readEnvInt(["USER_KEYS_RATE_LIMIT_WRITE_MAX"], 60)); // /min

  const limRead = createFixedWindowRateLimiter({ windowMs, max: maxReads, maxEntries });
  const limWrite = createFixedWindowRateLimiter({ windowMs, max: maxWrites, maxEntries });

  function rlKey(req: FastifyRequest, routeName: string): string {
    const ip = getClientIp(req);
    const method = String(req.method || "GET");
    return `${ip}||${method}||${routeName}`;
  }

  function enforce(limiter: { check: (k: string) => any }, key: string, req: FastifyRequest, reply: any): boolean {
    if (!rateLimitEnabled()) return true;
    const d = limiter.check(key);
    if (!d.allowed) {
      rejectRateLimited(reply, d);
      return false;
    }
    applyRateLimitHeaders(reply, d);
    return true;
  }

  // No-store headers for all user-keys endpoints (defense-in-depth)
  app.addHook("onSend", async (req, reply, payload) => {
    const rp = String((req as any).routerPath ?? "");
    const url = String((req as any).routeOptions?.url ?? "");
    const path = rp || url;
    if (path.startsWith("/user-keys")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("vary", "Accept");
    }
    return payload;
  });

  // ---------------------------------------------------------------------------
  // Self reads (pass-through auth to Core)
  // ---------------------------------------------------------------------------
  app.get("/user-keys/me/public", { preHandler: requireAuth }, async (req, reply) => {
    if (!enforce(limRead, rlKey(req, "user-keys:me:public"), req, reply)) return reply;

    const actor = requireActor(req);
    requireAnyScope(actor, ["user_keys:self:read", "user_keys:read"]);

    try {
      const result = await userKeys.getMePublicKey(
        coreCtx(req, actor, false, true),
        { maxRetries: 1 }
      );
      return reply.code(200).send({ ok: true, result: scrubSecrets(result) });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.get("/user-keys/me/history", { preHandler: requireAuth }, async (req, reply) => {
    if (!enforce(limRead, rlKey(req, "user-keys:me:history"), req, reply)) return reply;

    const actor = requireActor(req);
    requireAnyScope(actor, ["user_keys:self:read", "user_keys:read"]);

    const q = normalizeHistoryQuery(req);

    try {
      const result = await userKeys.getMeHistory(
        q,
        coreCtx(req, actor, false, true),
        { maxRetries: 1 }
      );
      return reply.code(200).send({ ok: true, result: scrubSecrets(result) });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  // ---------------------------------------------------------------------------
  // Targeted reads (self or tenant_admin/system)
  // ---------------------------------------------------------------------------
  app.get("/user-keys/:user_id/public", { preHandler: requireAuth }, async (req, reply) => {
    if (!enforce(limRead, rlKey(req, "user-keys:user:public"), req, reply)) return reply;

    const actor = requireActor(req);
    requireAnyScope(actor, ["user_keys:read"]);

    const userId = String((req.params as any)?.user_id ?? "").trim();
    if (!isUuid(userId)) {
      const e: any = new Error("invalid_user_id");
      e.statusCode = 400;
      e.code = "INVALID_USER_ID";
      throw e;
    }

    requireSelfOrTenantAdmin(actor, userId);

    try {
      const result = await userKeys.getUserPublicKey(
        userId,
        coreCtx(req, actor, false, true),
        { maxRetries: 1 }
      );
      return reply.code(200).send({ ok: true, result: scrubSecrets(result) });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.get("/user-keys/:user_id/history", { preHandler: requireAuth }, async (req, reply) => {
    if (!enforce(limRead, rlKey(req, "user-keys:user:history"), req, reply)) return reply;

    const actor = requireActor(req);
    requireAnyScope(actor, ["user_keys:read"]);

    const userId = String((req.params as any)?.user_id ?? "").trim();
    if (!isUuid(userId)) {
      const e: any = new Error("invalid_user_id");
      e.statusCode = 400;
      e.code = "INVALID_USER_ID";
      throw e;
    }

    requireSelfOrTenantAdmin(actor, userId);

    const q = normalizeHistoryQuery(req);

    try {
      const result = await userKeys.getUserHistory(
        userId,
        q,
        coreCtx(req, actor, false, true),
        { maxRetries: 1 }
      );
      return reply.code(200).send({ ok: true, result: scrubSecrets(result) });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  // ---------------------------------------------------------------------------
  // Admin lifecycle ops (tenant_admin/system; optional service-key mode)
  // ---------------------------------------------------------------------------
  app.post("/user-keys/:user_id/generate", { preHandler: requireAuth }, async (req, reply) => {
    if (!enforce(limWrite, rlKey(req, "user-keys:generate"), req, reply)) return reply;

    const actor = requireActor(req);
    requireAnyScope(actor, ["user_keys:write", "user_keys:admin"]);
    requireTenantAdminOrSystem(actor);

    const userId = String((req.params as any)?.user_id ?? "").trim();
    if (!isUuid(userId)) {
      const e: any = new Error("invalid_user_id");
      e.statusCode = 400;
      e.code = "INVALID_USER_ID";
      throw e;
    }

    const body = requireBodyObject(req);

    const keyType = normalizeKeyTypeOrDefault((body as any).key_type ?? (body as any).keyType);
    const metadata = requireAndValidateMetadata((body as any).metadata);

    const passThroughAuth = !shouldUseServiceKeyForAdmin();

    try {
      const result = await userKeys.generateUserKey(
        userId,
        { keyType, metadata },
        coreCtx(req, actor, true, passThroughAuth)
      );
      return reply.code(201).send({ ok: true, result: scrubSecrets(result) });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.post("/user-keys/:user_id/rotate", { preHandler: requireAuth }, async (req, reply) => {
    if (!enforce(limWrite, rlKey(req, "user-keys:rotate"), req, reply)) return reply;

    const actor = requireActor(req);
    requireAnyScope(actor, ["user_keys:write", "user_keys:admin"]);
    requireTenantAdminOrSystem(actor);

    const userId = String((req.params as any)?.user_id ?? "").trim();
    if (!isUuid(userId)) {
      const e: any = new Error("invalid_user_id");
      e.statusCode = 400;
      e.code = "INVALID_USER_ID";
      throw e;
    }

    const body = requireBodyObject(req);

    const resealRaw = (body as any).reseal;
    const reseal = resealRaw === undefined || resealRaw === null ? true : Boolean(resealRaw);

    const metadata = requireAndValidateMetadata((body as any).metadata);

    const passThroughAuth = !shouldUseServiceKeyForAdmin();

    try {
      const result = await userKeys.rotateUserKey(
        userId,
        { reseal, metadata },
        coreCtx(req, actor, true, passThroughAuth)
      );
      return reply.code(200).send({ ok: true, result: scrubSecrets(result) });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.post("/user-keys/:user_id/revoke", { preHandler: requireAuth }, async (req, reply) => {
    if (!enforce(limWrite, rlKey(req, "user-keys:revoke"), req, reply)) return reply;

    const actor = requireActor(req);
    requireAnyScope(actor, ["user_keys:write", "user_keys:admin"]);
    requireTenantAdminOrSystem(actor);

    const userId = String((req.params as any)?.user_id ?? "").trim();
    if (!isUuid(userId)) {
      const e: any = new Error("invalid_user_id");
      e.statusCode = 400;
      e.code = "INVALID_USER_ID";
      throw e;
    }

    // Body optional; but if present enforce bounded object + pollution defense.
    const rawBody = (req as any).body;
    if (rawBody != null) {
      requireBodyObject(req);
    }

    const passThroughAuth = !shouldUseServiceKeyForAdmin();

    try {
      const result = await userKeys.revokeUserKey(
        userId,
        coreCtx(req, actor, true, passThroughAuth)
      );
      return reply.code(200).send({ ok: true, result: scrubSecrets(result) });
    } catch (e) {
      throw mapCoreError(e);
    }
  });
};

export default userKeysRoutes;