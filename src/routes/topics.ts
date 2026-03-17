// ============================================================================
// File: src/routes/topics.ts
// Version: 1.0-hash-factory-topics-routes | 2026-03-04
// Purpose:
//   Fastify routes for Hash Factory topic bootstrap (tenant org topics).
//   - Hardened gateway to Core org topics bootstrap endpoint.
//   - Boundary authz: tenant_admin for org OR system admin (HF-side).
//   - Core remains source-of-truth via RLS + entitlements.
//   - DoS controls: strict UUID validation, small body cap (expects empty body),
//     rate limits, no-store headers.
//   - Pass-through auth to Core by default (preserves Core auditability/RLS semantics).
//
// Route:
//   POST /v1/orgs/:org_id/hedera/topics/bootstrap
// ============================================================================

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { CoreClientError } from "../core/coreClient.js";
import { TopicsClient, TopicsClientError } from "../core/topicsClient.js";
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

function requireTenantAdminOrSystemForOrg(actor: Actor, orgId: string) {
  if (isSystemAdmin(actor)) return;
  if (isTenantAdmin(actor) && String(actor?.org_id ?? "") === orgId) return;
  const e: any = new Error("Forbidden");
  e.statusCode = 403;
  e.code = "TENANT_ADMIN_REQUIRED";
  throw e;
}

function isUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
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
  // This route expects {}. Keep small.
  const raw = process.env.TOPICS_ROUTE_BODY_MAX_BYTES ?? process.env.HTTP_ROUTE_BODY_MAX_BYTES ?? null;
  const def = 16_384;
  if (raw == null || raw === "") return def;
  const v = toInt(raw, def);
  return Math.max(1024, Math.min(256 * 1024, v));
}

function requireBodyObjectOrEmpty(req: FastifyRequest): Record<string, unknown> {
  const body = (req as any).body;
  if (body == null) return {};
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
  // Prototype pollution defense
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

  const allowEmpty =
    process.env.TOPICS_ALLOW_EMPTY_SCOPES
      ? String(process.env.TOPICS_ALLOW_EMPTY_SCOPES).trim() !== "false"
      : String(process.env.NODE_ENV ?? "").toLowerCase() !== "production";

  if (list.length === 0 && allowEmpty) return true;

  const sc = String(scope);
  return list.includes(sc) || list.includes("hedera:*") || list.includes("admin:*");
}

function enforceScopesEnabled(): boolean {
  if (process.env.TOPICS_ENFORCE_SCOPES != null) return String(process.env.TOPICS_ENFORCE_SCOPES) === "true";
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

function ctxFromReq(req: FastifyRequest): { requestId?: string | null; clientRequestId?: string | null } {
  return {
    requestId: (req as any)?.requestId ?? (req as any)?.id ?? null,
    clientRequestId: (req as any)?.clientRequestId ?? null,
  };
}

function extractIncomingAuthHeader(req: FastifyRequest): string | null {
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

function actorTag(actor: Actor | null | undefined): string | null {
  if (!actor) return null;
  const u = actor.user_id ? String(actor.user_id) : "";
  const o = actor.org_id ? String(actor.org_id) : "";
  const r = actor.org_role ? String(actor.org_role) : "";
  if (!u && !o && !r) return null;
  return `u:${u || "?"}|o:${o || "?"}|r:${r || "?"}`;
}

function coreCtx(req: FastifyRequest, actor: Actor | null, passThroughAuth: boolean) {
  const base = ctxFromReq(req);
  const hfActor = actorTag(actor);
  const coreAuthHeader = passThroughAuth ? extractIncomingAuthHeader(req) : null;

  return {
    ...base,
    ...(coreAuthHeader ? { coreAuthHeader } : {}),
    ...(hfActor ? { hfActor } : {}),
    onCoreCall: (line: any) => {
      const logger: any = (req as any).log ?? console;
      logger.info({ event: "core_call", ...line }, "core_call");
    },
  };
}

function mapCoreError(err: unknown): Error {
  if (err instanceof TopicsClientError) {
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

// ----------------------------------------------------------------------------
// Plugin
// ----------------------------------------------------------------------------

export type TopicsRoutesOpts = Readonly<{
  topics: TopicsClient;
}>;

function statusFromBootstrapResult(result: any): number {
  // Mirror Core status semantics as closely as possible
  // Core meta: created_count, ensured_count, error_count
  const meta = result?.result?.meta ?? null;
  const createdCount = Number(meta?.created_count ?? 0);
  const ensuredCount = Number(meta?.ensured_count ?? 0);
  const errorCount = Number(meta?.error_count ?? 0);

  if (Number.isFinite(createdCount) && createdCount > 0) return 201;
  if (Number.isFinite(errorCount) && Number.isFinite(ensuredCount) && errorCount > 0 && ensuredCount > 0) return 207;
  if (Number.isFinite(ensuredCount) && ensuredCount === 0) return 500;
  return 200;
}

export const topicsRoutes: FastifyPluginAsync<TopicsRoutesOpts> = async (app: FastifyInstance, opts) => {
  if (!opts?.topics) throw new Error("topicsRoutes requires topics client");
  const topics = opts.topics;

  const requireAuth = app.requireAuth();

  // Rate limits (bootstrap is expensive)
  const windowMs = Math.max(1_000, readEnvInt(["TOPICS_RATE_LIMIT_WINDOW_MS"], 60_000));
  const maxEntries = Math.max(1_000, readEnvInt(["TOPICS_RATE_LIMIT_MAX_ENTRIES"], 50_000));
  const maxBootstrap = Math.max(1, readEnvInt(["TOPICS_RATE_LIMIT_BOOTSTRAP_MAX"], 12)); // /min per key

  const limBootstrap = createFixedWindowRateLimiter({ windowMs, max: maxBootstrap, maxEntries });

  function rlKey(req: FastifyRequest, routeName: string): string {
    const ip = getClientIp(req);
    const method = String(req.method || "POST");
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

  // No-store headers (defense-in-depth)
  app.addHook("onSend", async (req, reply, payload) => {
    const url = String((req as any).routeOptions?.url ?? "");
    if (url.includes("/hedera/topics")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("vary", "Accept");
    }
    return payload;
  });

  // POST /v1/orgs/:org_id/hedera/topics/bootstrap
  app.post("/v1/orgs/:org_id/hedera/topics/bootstrap", { preHandler: requireAuth }, async (req, reply) => {
    if (!enforce(limBootstrap, rlKey(req, "topics:bootstrap"), req, reply)) return reply;

    const actor = requireActor(req);

    const orgId = String((req.params as any)?.org_id ?? "").trim();
    if (!isUuid(orgId)) {
      const e: any = new Error("invalid_org_id");
      e.statusCode = 400;
      e.code = "INVALID_ORG_ID";
      throw e;
    }

    // HF boundary: tenant_admin for that org OR system admin.
    requireTenantAdminOrSystemForOrg(actor, orgId);

    // Scopes (match Core policy intent)
    requireAnyScope(actor, ["hedera:topic_bootstrap", "hedera:admin"]);

    // Expect empty body; allow {} only.
    requireBodyObjectOrEmpty(req);

    // Default: pass-through so Core enforces RLS + entitlements with the real actor.
    const passThroughAuth =
      process.env.HF_TOPICS_USE_SERVICE_KEY === "true" ? false : true;

    try {
      const result = await topics.bootstrapOrgTopics(orgId, coreCtx(req, actor, passThroughAuth));
      // result is shaped: { ok, result: { org_id, policy, created, ensured, errors, meta } }
      // Mirror Core status semantics for cleaner UI handling.
      const sc = statusFromBootstrapResult(result);
      return reply.code(sc).send(result);
    } catch (e) {
      throw mapCoreError(e);
    }
  });
};

export default topicsRoutes;