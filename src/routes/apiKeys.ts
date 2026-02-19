// ============================================================================
// File: src/routes/apiKeys.ts
// Version: 1.1-hash-factory-api-keys-routes | 2026-02-18
// Purpose:
//   Fastify API key management routes for Hash Factory.
//   - Hash Factory acts as a hardened gateway to Core API key endpoints.
//   - Route-level DoS guards (body size, metadata size).
//   - Minimal boundary authz checks; Core RLS remains authoritative.
//   - Never returns key_hash; create/rotate return secret ONCE.
// V1.1: added route-level DoS guards, metadata size limits, and boundary authz checks.
// ============================================================================

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { CoreClient, CoreClientError } from "../core/coreClient.js";
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

function toInt(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = toInt(v, def);
  return Math.max(min, Math.min(max, n));
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
  const raw = process.env.API_KEYS_ROUTE_BODY_MAX_BYTES ?? process.env.HTTP_ROUTE_BODY_MAX_BYTES ?? null;
  const def = 65_536;
  if (raw == null || raw === "") return def;
  const v = toInt(raw, def);
  return Math.max(256, Math.min(2_000_000, v));
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

function isUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function ctxFromReq(req: FastifyRequest): { requestId?: string | null; clientRequestId?: string | null } {
  return {
    requestId: (req as any)?.requestId ?? (req as any)?.id ?? null,
    clientRequestId: (req as any)?.clientRequestId ?? null,
  };
}

function extractIncomingAuthHeader(req: FastifyRequest): string | null {
  // HF auth accepts Authorization: Bearer or x-api-key.
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

  // Keep bounded (matches apiKeyAuth.ts MAX_API_KEY_LEN)
  if (token.length > 1024) {
    const e: any = new Error("API key too long");
    e.statusCode = 400;
    e.code = "AUTH_INVALID";
    throw e;
  }

  return `Bearer ${token}`;
}

function idempotencyKeyFromReq(req: FastifyRequest): string | null {
  // Prefer standard header; accept x- prefix for flexibility.
  const h = (req.headers as any) || {};
  const raw = h["idempotency-key"] ?? h["x-idempotency-key"] ?? null;
  if (raw == null) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  // Keep it bounded to avoid log/pathological header abuse.
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

function coreCtx(req: FastifyRequest, actor?: Actor | null, forWrite: boolean = false, passThroughAuth: boolean = true) {
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
      // One structured line per attempt; do NOT include secrets.
      // Fastify gives req.log by default; fall back to app logger if needed.
      const logger: any = (req as any).log ?? console;
      logger.info(
        {
          event: "core_call",
          ...line,
        },
        "core_call"
      );
    },
  };
}

function mapCoreError(err: unknown): Error {
  if (err instanceof CoreClientError) {
    const e: any = new Error(err.message || "upstream_error");
    // Preserve 4xx/5xx semantics while remaining stable.
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

export type ApiKeysRoutesOpts = Readonly<{
  core: CoreClient;
}>;

/**
 * Core endpoints used here:
 *   POST /api-keys
 *   POST /api-keys/rotate
 *   GET  /api-keys/my
 *   GET  /api-keys/org
 *   GET  /api-keys/user/:user_id
 *   GET  /api-keys/:id
 *   POST /api-keys/:id/disable|enable|revoke|scopes|hint|expiry|metadata
 *
 * If your core mounts these under /v1, change CORE_API_KEYS_PREFIX accordingly.
 */
const CORE_API_KEYS_PREFIX = process.env.CORE_API_KEYS_PREFIX ?? "";

function corePath(p: string): string {
  const prefix = String(CORE_API_KEYS_PREFIX || "").trim().replace(/\/+$/, "");
  const path = String(p || "").trim().startsWith("/") ? String(p || "").trim() : `/${String(p || "").trim()}`;
  return prefix ? `${prefix}${path}` : path;
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

export const apiKeysRoutes: FastifyPluginAsync<ApiKeysRoutesOpts> = async (app: FastifyInstance, opts) => {
  if (!opts?.core) throw new Error("apiKeysRoutes requires core client");

  const core = opts.core;
  const requireAuth = app.requireAuth();

  const windowMs = Math.max(1_000, readEnvInt(["API_KEYS_RATE_LIMIT_WINDOW_MS"], 60_000));
  const maxEntries = Math.max(1_000, readEnvInt(["API_KEYS_RATE_LIMIT_MAX_ENTRIES"], 50_000));

  // Writes are more sensitive; reads are higher volume.
  const maxReads = Math.max(1, readEnvInt(["API_KEYS_RATE_LIMIT_READ_MAX"], 180));   // /min
  const maxWrites = Math.max(1, readEnvInt(["API_KEYS_RATE_LIMIT_WRITE_MAX"], 60));  // /min

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

  // no-store by default on all API key endpoints.
  app.addHook("onSend", async (req, reply, payload) => {
    const url = String((req as any).routeOptions?.url ?? "");
    if (url.startsWith("/api-keys")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("vary", "Accept");
    }
    return payload;
  });

  const MAX_METADATA_BYTES = clampInt(process.env.API_KEYS_MAX_METADATA_BYTES, 1024, 256 * 1024, 16 * 1024);

  // ---------------------------------------------------------------------------
  // Create
  // POST /api-keys
  // ---------------------------------------------------------------------------
  app.post("/api-keys", { preHandler: requireAuth }, async (req, reply) => {
    if (!enforce(limWrite, rlKey(req, "api-keys:create"), req, reply)) return reply;
    const actor = requireActor(req);
    const body = requireBodyObject(req);

    // Boundary rules (defense-in-depth):
    // - Non-system users cannot set org_id different from their actor org.
    // - Creating for another user requires tenant_admin/system.
    const out: Record<string, unknown> = { ...body };

    const actorOrgId = String(actor?.org_id ?? "");
    if (!isSystemAdmin(actor)) {
      if (out.org_id != null && String(out.org_id) !== actorOrgId) {
        const e: any = new Error("Forbidden");
        e.statusCode = 403;
        e.code = "CROSS_ORG_DENIED";
        throw e;
      }
      out.org_id = actorOrgId;
    } else {
      if (out.org_id == null && actorOrgId) out.org_id = actorOrgId;
    }

    const userId = out.user_id == null ? null : String(out.user_id);
    if (userId && !isUuid(userId)) {
      const e: any = new Error("invalid_user_id");
      e.statusCode = 400;
      e.code = "INVALID_USER_ID";
      throw e;
    }
    if (userId && String(userId) !== String(actor?.user_id ?? "") && !isSystemAdmin(actor)) {
      requireTenantAdminOrSystem(actor);
    }

    const meta = (out.metadata ?? null) as unknown;
    if (meta != null) {
      if (!isPlainObject(meta) || bytesOfJson(meta) > MAX_METADATA_BYTES) {
        const e: any = new Error("metadata_too_large");
        e.statusCode = 400;
        e.code = "METADATA_TOO_LARGE";
        throw e;
      }
    }

    try {
      const result = await core.post(corePath("/api-keys"), out, coreCtx(req, actor, true, true));
      reply.code(200).send(result);
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  // ---------------------------------------------------------------------------
  // Rotate
  // POST /api-keys/rotate
  // ---------------------------------------------------------------------------
  app.post("/api-keys/rotate", { preHandler: requireAuth }, async (req, reply) => {
    if (!enforce(limWrite, rlKey(req, "api-keys:rotate"), req, reply)) return reply;
    const actor = requireActor(req);
    const body = requireBodyObject(req);

    const oldId = (body as any).old_api_key_id;
    if (!isUuid(String(oldId ?? ""))) {
      const e: any = new Error("invalid_old_api_key_id");
      e.statusCode = 400;
      e.code = "INVALID_API_KEY_ID";
      throw e;
    }

    try {
      const result = await core.post(corePath("/api-keys/rotate"), body, coreCtx(req, actor, true, true));
      reply.code(200).send(result);
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  // ---------------------------------------------------------------------------
  // Reads
  // GET /api-keys/my
  // GET /api-keys/org
  // GET /api-keys/user/:user_id
  // GET /api-keys/:id
  // ---------------------------------------------------------------------------
  app.get("/api-keys/my", { preHandler: requireAuth }, async (req, reply) => {
    if (!enforce(limRead, rlKey(req, "api-keys:my"), req, reply)) return reply;
    const actor = requireActor(req);
    const limit = clampInt((req.query as any)?.limit, 1, 1000, 50);
    const offset = clampInt((req.query as any)?.offset, 0, 10_000_000, 0);
    const includeDisabledRaw = (req.query as any)?.includeDisabled;
    const includeDisabled = includeDisabledRaw == null ? true : String(includeDisabledRaw).trim() !== "false";

    try {
      const qp = buildQuery({ limit, offset, includeDisabled });
      const result = await core.get(corePath(`/api-keys/my${qp}`), coreCtx(req, actor, false, true));
      reply.code(200).send(result);
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.get("/api-keys/org", { preHandler: requireAuth }, async (req, reply) => {
    if (!enforce(limRead, rlKey(req, "api-keys:org"), req, reply)) return reply;
    const actor = requireActor(req);
    requireTenantAdminOrSystem(actor);

    const limit = clampInt((req.query as any)?.limit, 1, 1000, 50);
    const offset = clampInt((req.query as any)?.offset, 0, 10_000_000, 0);
    const status = (req.query as any)?.status == null ? null : String((req.query as any).status).trim() || null;
    const userId = (req.query as any)?.user_id == null ? null : String((req.query as any).user_id).trim() || null;

    if (userId && !isUuid(userId)) {
      const e: any = new Error("invalid_user_id");
      e.statusCode = 400;
      e.code = "INVALID_USER_ID";
      throw e;
    }

    try {
      const qp = buildQuery({ limit, offset, status, user_id: userId });
      const result = await core.get(corePath(`/api-keys/org${qp}`), coreCtx(req, actor, false, true));
      reply.code(200).send(result);
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.get("/api-keys/user/:user_id", { preHandler: requireAuth }, async (req, reply) => {
    if (!enforce(limRead, rlKey(req, "api-keys:user"), req, reply)) return reply;
    const actor = requireActor(req);
    const targetUserId = String((req.params as any)?.user_id ?? "").trim();
    if (!isUuid(targetUserId)) {
      const e: any = new Error("invalid_user_id");
      e.statusCode = 400;
      e.code = "INVALID_USER_ID";
      throw e;
    }

    requireSelfOrTenantAdmin(actor, targetUserId);

    const limit = clampInt((req.query as any)?.limit, 1, 1000, 50);
    const offset = clampInt((req.query as any)?.offset, 0, 10_000_000, 0);
    const status = (req.query as any)?.status == null ? null : String((req.query as any).status).trim() || null;

    try {
      const qp = buildQuery({ limit, offset, status });
      const result = await core.get(corePath(`/api-keys/user/${encodeURIComponent(targetUserId)}${qp}`), coreCtx(req, actor, false, true));
      reply.code(200).send(result);
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.get("/api-keys/:id", { preHandler: requireAuth }, async (req, reply) => {
    if (!enforce(limRead, rlKey(req, "api-keys:get"), req, reply)) return reply;
    const actor = requireActor(req);
    const id = String((req.params as any)?.id ?? "").trim();
    if (!isUuid(id)) {
      const e: any = new Error("invalid_id");
      e.statusCode = 400;
      e.code = "INVALID_API_KEY_ID";
      throw e;
    }

    const includeDeletedRaw = (req.query as any)?.includeDeleted;
    const includeDeleted = includeDeletedRaw == null ? false : String(includeDeletedRaw).trim() === "true";

    try {
      const qp = buildQuery({ includeDeleted });
      const result = await core.get(corePath(`/api-keys/${encodeURIComponent(id)}${qp}`), coreCtx(req, actor, false, true));
      reply.code(200).send(result);
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  // ---------------------------------------------------------------------------
  // Mutations (pass-through with minimal validation)
  // ---------------------------------------------------------------------------
  async function postWithId(req: FastifyRequest, reply: any, suffix: string, extraBody?: Record<string, unknown>) {
    if (!enforce(limWrite, rlKey(req, `api-keys:${suffix}`), req, reply)) return;
    const actor = requireActor(req);
    const id = String((req.params as any)?.id ?? "").trim();
    if (!isUuid(id)) {
      const e: any = new Error("invalid_id");
      e.statusCode = 400;
      e.code = "INVALID_API_KEY_ID";
      throw e;
    }

    const body = extraBody ?? (req.method === "POST" ? requireBodyObject(req) : {});
    try {
      const result = await core.post(
        corePath(`/api-keys/${encodeURIComponent(id)}/${suffix}`),
        body,
        coreCtx(req, actor, true, true)
      );
      reply.code(200).send(result);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  app.post("/api-keys/:id/disable", { preHandler: requireAuth }, async (req, reply) => postWithId(req, reply, "disable", {}));
  app.post("/api-keys/:id/enable", { preHandler: requireAuth }, async (req, reply) => postWithId(req, reply, "enable", {}));
  app.post("/api-keys/:id/revoke", { preHandler: requireAuth }, async (req, reply) => postWithId(req, reply, "revoke", {}));

  app.post("/api-keys/:id/scopes", { preHandler: requireAuth }, async (req, reply) => {
    const body = requireBodyObject(req);
    const scopes = (body as any).scopes;
    if (!Array.isArray(scopes) || scopes.length > 32) {
      const e: any = new Error("invalid_scopes");
      e.statusCode = 400;
      e.code = "INVALID_SCOPES";
      throw e;
    }
    await postWithId(req, reply, "scopes", { scopes });
  });

  app.post("/api-keys/:id/hint", { preHandler: requireAuth }, async (req, reply) => {
    const body = requireBodyObject(req);
    const key_hint = (body as any).key_hint ?? null;
    if (key_hint != null && String(key_hint).length > 64) {
      const e: any = new Error("invalid_key_hint");
      e.statusCode = 400;
      e.code = "INVALID_KEY_HINT";
      throw e;
    }
    await postWithId(req, reply, "hint", { key_hint });
  });

  app.post("/api-keys/:id/expiry", { preHandler: requireAuth }, async (req, reply) => {
    const body = requireBodyObject(req);
    // Validate shape lightly; core enforces semantics.
    const expires_at = (body as any).expires_at ?? null;
    const expires_in_days = (body as any).expires_in_days ?? null;

    if (expires_in_days != null) {
      const n = Number(expires_in_days);
      if (!Number.isFinite(n) || Math.trunc(n) < 1 || Math.trunc(n) > 3650) {
        const e: any = new Error("invalid_expires_in_days");
        e.statusCode = 400;
        e.code = "INVALID_EXPIRY";
        throw e;
      }
    }

    await postWithId(req, reply, "expiry", { expires_at, expires_in_days });
  });

  app.post("/api-keys/:id/metadata", { preHandler: requireAuth }, async (req, reply) => {
    const body = requireBodyObject(req);
    const metadata = (body as any).metadata ?? null;

    if (metadata == null || !isPlainObject(metadata) || bytesOfJson(metadata) > MAX_METADATA_BYTES) {
      const e: any = new Error("metadata_too_large");
      e.statusCode = 400;
      e.code = "METADATA_TOO_LARGE";
      throw e;
    }

    await postWithId(req, reply, "metadata", { metadata });
  });
};

export default apiKeysRoutes;