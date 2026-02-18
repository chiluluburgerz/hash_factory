// ============================================================================
// File: src/routes/onboarding.ts
// Version: 1.0-hash-factory-onboarding-routes | 2026-02-18
// Purpose:
//   Fastify routes for Hash Factory onboarding.
//   - Assumes global auth hook exists (server.ts), but also hardens per-route.
//   - Applies route-level body-size bounds + structural sanitization.
//   - Delegates to OnboardingService (which enforces authz + validation).
// ============================================================================

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { OnboardingService, Actor } from "../services/onboardingService.js";
import {
  createFixedWindowRateLimiter,
  rateLimitEnabled,
  getClientIp,
  applyRateLimitHeaders,
  rejectRateLimited,
  readEnvInt,
} from "../utils/rateLimit.js";

// ----------------------------------------------------------------------------
// Bounds / sanitizer (defense-in-depth vs server bodyLimit)
// ----------------------------------------------------------------------------
const DEFAULT_MAX_ROUTE_BODY_BYTES = 65_536;

function toInt(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function maxRouteBodyBytes(): number {
  const raw = process.env.ONBOARDING_ROUTE_BODY_MAX_BYTES ?? process.env.HTTP_ROUTE_BODY_MAX_BYTES ?? null;
  if (raw == null || raw === "") return DEFAULT_MAX_ROUTE_BODY_BYTES;
  const v = toInt(raw, DEFAULT_MAX_ROUTE_BODY_BYTES);
  return Math.max(256, Math.min(2_000_000, v));
}

function bytesOfJson(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? {}), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isDangerousKey(k: string): boolean {
  return k === "__proto__" || k === "prototype" || k === "constructor";
}

function isUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function sanitizeJson(value: unknown, depth: number, maxDepth: number, maxKeys: number, keysSeen: { n: number }, maxArray: number, maxString: number): unknown {
  if (depth > maxDepth) throw new Error("max_depth_exceeded");
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
  if (value.length > maxString) throw new Error("string_too_large");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid_number");
    return value;
  }
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (value.length > maxArray) throw new Error("array_too_large");
    return value.map((v) => sanitizeJson(v, depth + 1, maxDepth, maxKeys, keysSeen, maxArray, maxString));
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (keysSeen.n + entries.length > maxKeys) throw new Error("too_many_keys");

    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      if (isDangerousKey(k)) throw new Error("dangerous_key");
      keysSeen.n += 1;
      out[k] = sanitizeJson(v, depth + 1, maxDepth, maxKeys, keysSeen, maxArray, maxString);
    }
    return out;
  }

  throw new Error("invalid_type");
}

/**
 * Sanitizes JSON body while preserving owner.password bytes exactly (no trimming/coercion).
 */
function sanitizeOnboardingBody(body: unknown): Record<string, unknown> {
  if (!isPlainObject(body)) throw new Error("invalid_body");

  const rawOwner = (body as any).owner ?? (body as any).user ?? null;
  const rawPassword = isPlainObject(rawOwner) ? (rawOwner as any).password : undefined;

  const MAX_KEYS = toInt(process.env.ONBOARDING_MAX_KEYS, 128);
  const MAX_DEPTH = toInt(process.env.ONBOARDING_MAX_DEPTH, 4);
  const MAX_ARRAY = toInt(process.env.ONBOARDING_MAX_ARRAY, 25);
  const MAX_STRING = toInt(process.env.ONBOARDING_MAX_STRING, 65_536);

  const keysSeen = { n: 0 };
  const sanitized = sanitizeJson(body, 0, MAX_DEPTH, MAX_KEYS, keysSeen, MAX_ARRAY, MAX_STRING);

  if (!isPlainObject(sanitized)) throw new Error("invalid_body");

  if (rawPassword !== undefined) {
    const ownerKey = (sanitized as any).owner != null ? "owner" : ((sanitized as any).user != null ? "user" : null);
    if (ownerKey && isPlainObject((sanitized as any)[ownerKey])) {
      (sanitized as any)[ownerKey].password = rawPassword;
    }
  }

  return sanitized;
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

  try {
    return sanitizeOnboardingBody(body);
  } catch (err: any) {
    const e: any = new Error(String(err?.message || "invalid_body"));
    e.statusCode = 400;
    e.code = "INVALID_BODY";
    throw e;
  }
}

function requireActor(req: FastifyRequest): Actor {
  const actor = (req as any).actor ?? null;
  if (actor && typeof actor === "object") return actor as Actor;

  const e: any = new Error("Unauthorized");
  e.statusCode = 401;
  e.code = "AUTH_REQUIRED";
  throw e;
}

// ----------------------------------------------------------------------------
// Plugin
// ----------------------------------------------------------------------------
export type OnboardingRoutesOpts = Readonly<{
  onboardingService: OnboardingService;
}>;

export const onboardingRoutes: FastifyPluginAsync<OnboardingRoutesOpts> = async (app: FastifyInstance, opts) => {
  if (!opts?.onboardingService) throw new Error("onboardingRoutes requires onboardingService");
  const svc = opts.onboardingService;
  const requireAuth = app.requireAuth();

  // Per-route strict rate limits (in-memory, per instance).
  const windowMs = Math.max(1_000, readEnvInt(["ONBOARDING_RATE_LIMIT_WINDOW_MS"], 60_000));
  const maxEntries = Math.max(1_000, readEnvInt(["ONBOARDING_RATE_LIMIT_MAX_ENTRIES"], 50_000));

  // Email check can be higher volume; org/member creation should be lower.
  const maxEmailCheck = Math.max(1, readEnvInt(["ONBOARDING_RATE_LIMIT_EMAIL_CHECK_MAX"], 60)); // /min
  const maxCreateOrg = Math.max(1, readEnvInt(["ONBOARDING_RATE_LIMIT_CREATE_ORG_MAX"], 15));  // /min
  const maxAddMember = Math.max(1, readEnvInt(["ONBOARDING_RATE_LIMIT_ADD_MEMBER_MAX"], 30));  // /min

  const limEmail = createFixedWindowRateLimiter({ windowMs, max: maxEmailCheck, maxEntries });
  const limOrg = createFixedWindowRateLimiter({ windowMs, max: maxCreateOrg, maxEntries });
  const limMember = createFixedWindowRateLimiter({ windowMs, max: maxAddMember, maxEntries });

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

  // Always no-store for onboarding endpoints (defense-in-depth).
  app.addHook("onSend", async (req, reply, payload) => {
    const url = String((req as any).routeOptions?.url ?? "");
    if (url.startsWith("/v1/onboarding/")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("vary", "Accept");
    }
    return payload;
  });

  // POST /v1/onboarding/email/check
  app.post("/v1/onboarding/email/check", { preHandler: requireAuth }, async (req, reply) => {
    if (!enforce(limEmail, rlKey(req, "onboarding:email_check"), req, reply)) return reply;
    const actor = requireActor(req);
    const body = requireBodyObject(req);
    const email = (body as any).email;

    const out = await svc.checkEmailAvailability(email, actor, svc.ctxFromReq(req));
    reply.code(200).send({ ok: true, result: out });
  });

  // POST /v1/onboarding/orgs
  app.post("/v1/onboarding/orgs", { preHandler: requireAuth }, async (req, reply) => {
    if (!enforce(limOrg, rlKey(req, "onboarding:create_org"), req, reply)) return reply;
    const actor = requireActor(req);
    const body = requireBodyObject(req);

    const out = await svc.createOrganizationWithOwner(body as any, actor, svc.ctxFromReq(req));
    reply.code(201).send({ ok: true, result: out });
  });

  // POST /v1/onboarding/orgs/:org_id/members
  app.post("/v1/onboarding/orgs/:org_id/members", { preHandler: requireAuth }, async (req, reply) => {
    if (!enforce(limMember, rlKey(req, "onboarding:add_member"), req, reply)) return reply;
    const actor = requireActor(req);
    const body = requireBodyObject(req);
    const orgId = String((req.params as any)?.org_id ?? "").trim();

    if (!isUuid(orgId)) {
      const e: any = new Error("invalid_org_id");
      e.statusCode = 400;
      e.code = "INVALID_ORG_ID";
      throw e;
    }

    const payload = {
      org_id: orgId,
      user_id: (body as any).user_id,
      role: (body as any).role ?? null,
      status: (body as any).status ?? null,
      metadata: (body as any).metadata ?? {},
    };

    const out = await svc.addMemberToOrganization(payload as any, actor, svc.ctxFromReq(req));
    reply.code(201).send({ ok: true, result: out });
  });
};

export default onboardingRoutes;