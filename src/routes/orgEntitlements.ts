// ============================================================================
// File: src/routes/orgEntitlements.ts
// Version: 1.1-hash-factory-org-entitlements-routes-typed-inputs | 2026-03-12
// Purpose:
//   Fastify routes for HF org entitlements slice.
//   - Auth required.
//   - Read-only surface.
//   - Same-org tenant-admin reads, system-admin override.
//   - Strict query/body allowlists.
//   - No-store responses.
// Changes (v1.1):
//   - Adds typed route-level narrowing for path/check/view inputs
//   - Fixes TS assignability errors for EntitlementCheckInput / EntitlementPathQuery
// Notes:
//   - Core remains source of truth for entitlement semantics.
// ============================================================================

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { OrgEntitlementsService, Actor } from "../services/orgEntitlementsService.js";
import type {
  EntitlementPathQuery,
  EntitlementCheckInput,
} from "../core/orgEntitlementsClient.js";

const MAX_KEYS = Number.parseInt(process.env.HF_ORG_ENTITLEMENTS_MAX_KEYS || "128", 10);
const MAX_DEPTH = Number.parseInt(process.env.HF_ORG_ENTITLEMENTS_MAX_DEPTH || "5", 10);
const MAX_ARRAY = Number.parseInt(process.env.HF_ORG_ENTITLEMENTS_MAX_ARRAY || "64", 10);
const MAX_STRING = Number.parseInt(process.env.HF_ORG_ENTITLEMENTS_MAX_STRING || "2048", 10);

function requireActor(req: FastifyRequest): Actor {
  const actor = (req as any).actor ?? null;
  if (actor && typeof actor === "object") return actor as Actor;
  const e: any = new Error("Unauthorized");
  e.statusCode = 401;
  e.code = "AUTH_REQUIRED";
  throw e;
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

function toInt(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function maxRouteBodyBytes(): number {
  const raw =
    process.env.HF_ORG_ENTITLEMENTS_ROUTE_BODY_MAX_BYTES ??
    process.env.HTTP_ROUTE_BODY_MAX_BYTES ??
    null;
  const def = 32_768;
  if (raw == null || raw === "") return def;
  const v = toInt(raw, def);
  return Math.max(256, Math.min(1_000_000, v));
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

  function isDangerousKey(k: string): boolean {
    return k === "__proto__" || k === "prototype" || k === "constructor";
  }

  function sanitizeValue(value: unknown, depth: number, keysSeen: { count: number }): unknown {
    if (depth > MAX_DEPTH) {
      const e: any = new Error("max_depth_exceeded");
      e.statusCode = 400;
      e.code = "INVALID_BODY";
      throw e;
    }

    if (value == null) return null;

    const t = typeof value;
    if (t === "string") {
      if ((value as string).length > MAX_STRING) {
        const e: any = new Error("string_too_large");
        e.statusCode = 400;
        e.code = "INVALID_BODY";
        throw e;
      }
      return value;
    }
    if (t === "number") {
      if (!Number.isFinite(value)) {
        const e: any = new Error("invalid_number");
        e.statusCode = 400;
        e.code = "INVALID_BODY";
        throw e;
      }
      return value;
    }
    if (t === "boolean") return value;

    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY) {
        const e: any = new Error("array_too_large");
        e.statusCode = 400;
        e.code = "INVALID_BODY";
        throw e;
      }
      return value.map((v) => sanitizeValue(v, depth + 1, keysSeen));
    }

    if (!isPlainObject(value)) {
      const e: any = new Error("invalid_type");
      e.statusCode = 400;
      e.code = "INVALID_BODY";
      throw e;
    }

    const out: Record<string, unknown> = {};
    const entries = Object.entries(value);
    if (entries.length + keysSeen.count > MAX_KEYS) {
      const e: any = new Error("too_many_keys");
      e.statusCode = 400;
      e.code = "INVALID_BODY";
      throw e;
    }

    for (const [k, v] of entries) {
      if (isDangerousKey(k)) {
        const e: any = new Error("dangerous_key");
        e.statusCode = 400;
        e.code = "INVALID_BODY";
        throw e;
      }
      keysSeen.count += 1;
      out[k] = sanitizeValue(v, depth + 1, keysSeen);
    }

    return out;
  }

  return sanitizeValue(body, 0, { count: 0 }) as Record<string, unknown>;
}

function requireFeatureKey(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(s)) {
    const e: any = new Error("invalid_feature_key");
    e.statusCode = 400;
    e.code = "INVALID_FEATURE_KEY";
    throw e;
  }
  return s;
}

function ensureNoStore(app: FastifyInstance) {
  app.addHook("onSend", async (req, reply, payload) => {
    const rp = String((req as any).routerPath ?? "");
    const url = String((req as any).routeOptions?.url ?? "");
    const path = rp || url;

    if (path.startsWith("/v1/org-entitlements")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("vary", "Accept");
    }

    return payload;
  });
}

function toViewQuery(q: Record<string, unknown>): { view?: unknown } {
  const allowed = new Set(["view"]);
  for (const k of Object.keys(q)) {
    if (!allowed.has(k)) {
      const e: any = new Error("invalid_request");
      e.statusCode = 400;
      e.code = "INVALID_REQUEST";
      e.detail = { message: `Unknown query field: ${k}` };
      throw e;
    }
  }

  return q;
}

function toPathQuery(q: Record<string, unknown>): EntitlementPathQuery {
  const allowed = new Set(["path", "type", "default_bool", "default_int", "default_string", "min", "max"]);
  for (const k of Object.keys(q)) {
    if (!allowed.has(k)) {
      const e: any = new Error("invalid_request");
      e.statusCode = 400;
      e.code = "INVALID_REQUEST";
      e.detail = { message: `Unknown query field: ${k}` };
      throw e;
    }
  }

  if (!Object.prototype.hasOwnProperty.call(q, "path")) {
    const e: any = new Error("invalid_request");
    e.statusCode = 400;
    e.code = "INVALID_REQUEST";
    e.detail = { message: "Missing required query field: path" };
    throw e;
  }

  return {
    path: q.path,
    type: q.type,
    default_bool: q.default_bool,
    default_int: q.default_int,
    default_string: q.default_string,
    min: q.min,
    max: q.max,
  };
}

function toCheckInput(body: Record<string, unknown>): EntitlementCheckInput {
  if (!Object.prototype.hasOwnProperty.call(body, "path")) {
    const e: any = new Error("invalid_request");
    e.statusCode = 400;
    e.code = "INVALID_REQUEST";
    e.detail = { message: "Missing required body field: path" };
    throw e;
  }

  const allowed = new Set(["path", "required", "code", "message"]);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) {
      const e: any = new Error("invalid_request");
      e.statusCode = 400;
      e.code = "INVALID_REQUEST";
      e.detail = { message: `Unknown body field: ${k}` };
      throw e;
    }
  }

  return {
    path: body.path,
    required: body.required,
    code: body.code,
    message: body.message,
  };
}

export type OrgEntitlementsRoutesOpts = Readonly<{
  orgEntitlementsService: OrgEntitlementsService;
}>;

const orgEntitlementsRoutes: FastifyPluginAsync<OrgEntitlementsRoutesOpts> = async (app, opts) => {
  if (!opts?.orgEntitlementsService) {
    throw new Error("orgEntitlementsRoutes requires orgEntitlementsService");
  }

  const svc = opts.orgEntitlementsService;
  const requireAuth = app.requireAuth();

  ensureNoStore(app);

  app.get("/v1/org-entitlements/me", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const qRaw = ((req as any).query ?? {}) as Record<string, unknown>;
    const q = toViewQuery(qRaw);

    const result = await svc.getMe(actor, q, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/org-entitlements/me/effective", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const result = await svc.getMeEffective(actor, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/org-entitlements/me/path", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const qRaw = ((req as any).query ?? {}) as Record<string, unknown>;
    const q = toPathQuery(qRaw);

    const result = await svc.getMePath(actor, q, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/org-entitlements/me/features/:feature_key", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const featureKey = requireFeatureKey((req.params as any)?.feature_key);
    const result = await svc.getMeFeature(actor, featureKey, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.post("/v1/org-entitlements/me/check", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const bodyRaw = requireBodyObject(req);
    const body = toCheckInput(bodyRaw);

    const result = await svc.checkMe(actor, body, svc.ctxFromReq(req, actor, true));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/org-entitlements/:org_id", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const orgId = String((req.params as any)?.org_id ?? "").trim();
    const qRaw = ((req as any).query ?? {}) as Record<string, unknown>;
    const q = toViewQuery(qRaw);

    const result = await svc.getForOrg(orgId, actor, q, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/org-entitlements/:org_id/effective", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const orgId = String((req.params as any)?.org_id ?? "").trim();
    const result = await svc.getForOrgEffective(orgId, actor, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/org-entitlements/:org_id/path", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const orgId = String((req.params as any)?.org_id ?? "").trim();
    const qRaw = ((req as any).query ?? {}) as Record<string, unknown>;
    const q = toPathQuery(qRaw);

    const result = await svc.getForOrgPath(orgId, q, actor, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/org-entitlements/:org_id/features/:feature_key", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const orgId = String((req.params as any)?.org_id ?? "").trim();
    const featureKey = requireFeatureKey((req.params as any)?.feature_key);
    const result = await svc.getForOrgFeature(orgId, featureKey, actor, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.post("/v1/org-entitlements/:org_id/check", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const orgId = String((req.params as any)?.org_id ?? "").trim();
    const bodyRaw = requireBodyObject(req);
    const body = toCheckInput(bodyRaw);

    const result = await svc.checkForOrg(orgId, body, actor, svc.ctxFromReq(req, actor, true));
    return reply.code(200).send({ ok: true, result });
  });
};

export { orgEntitlementsRoutes };
export default orgEntitlementsRoutes;