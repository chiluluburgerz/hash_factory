// ============================================================================
// File: src/routes/orgs.ts
// Version: 1.0-hash-factory-org-routes | 2026-03-11
// Purpose:
//   Fastify routes for HF org slice.
//   - Auth required.
//   - Same-org reads.
//   - Tenant-admin member reads and tenant-admin org mutations.
//   - System-admin-only billing tier mutation.
//   - Strict query/body allowlists.
//   - No-store responses.
// ============================================================================

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { OrgService, Actor } from "../services/orgService.js";

const MAX_KEYS = Number.parseInt(process.env.HF_ORGS_MAX_KEYS || "128", 10);
const MAX_DEPTH = Number.parseInt(process.env.HF_ORGS_MAX_DEPTH || "4", 10);
const MAX_ARRAY = Number.parseInt(process.env.HF_ORGS_MAX_ARRAY || "50", 10);
const MAX_STRING = Number.parseInt(process.env.HF_ORGS_MAX_STRING || "8192", 10);

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
  const raw = process.env.HF_ORGS_ROUTE_BODY_MAX_BYTES ?? process.env.HTTP_ROUTE_BODY_MAX_BYTES ?? null;
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

function ensureNoStore(app: FastifyInstance) {
  app.addHook("onSend", async (req, reply, payload) => {
    const rp = String((req as any).routerPath ?? "");
    const url = String((req as any).routeOptions?.url ?? "");
    const path = rp || url;

    if (path.startsWith("/v1/orgs")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("vary", "Accept");
    }

    return payload;
  });
}

export type OrgRoutesOpts = Readonly<{
  orgService: OrgService;
}>;

const orgRoutes: FastifyPluginAsync<OrgRoutesOpts> = async (app, opts) => {
  if (!opts?.orgService) throw new Error("orgRoutes requires orgService");
  const svc = opts.orgService;

  const requireAuth = app.requireAuth();
  ensureNoStore(app);

  app.get("/v1/orgs/me", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const result = await svc.getMe(actor, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/orgs/me/members", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);

    const q: any = (req as any).query ?? {};
    const allowed = new Set(["limit", "offset"]);
    for (const k of Object.keys(q)) {
      if (!allowed.has(k)) {
        const e: any = new Error("invalid_request");
        e.statusCode = 400;
        e.code = "INVALID_REQUEST";
        e.detail = { message: `Unknown query field: ${k}` };
        throw e;
      }
    }

    const result = await svc.getMyMembers(q, actor, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/orgs/:org_id", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const orgId = String((req.params as any)?.org_id ?? "").trim();
    const result = await svc.getById(orgId, actor, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/orgs/:org_id/members", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);

    const q: any = (req as any).query ?? {};
    const allowed = new Set(["limit", "offset"]);
    for (const k of Object.keys(q)) {
      if (!allowed.has(k)) {
        const e: any = new Error("invalid_request");
        e.statusCode = 400;
        e.code = "INVALID_REQUEST";
        e.detail = { message: `Unknown query field: ${k}` };
        throw e;
      }
    }

    const orgId = String((req.params as any)?.org_id ?? "").trim();
    const result = await svc.getMembersByOrgId(orgId, q, actor, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.patch("/v1/orgs/:org_id", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const body = requireBodyObject(req);
    const orgId = String((req.params as any)?.org_id ?? "").trim();
    const result = await svc.patchOrg(orgId, body, actor, svc.ctxFromReq(req, actor, true));
    return reply.code(200).send({ ok: true, result });
  });

  app.post("/v1/orgs/:org_id/billing-tier", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const body = requireBodyObject(req);

    const allowed = new Set(["billing_tier"]);
    for (const k of Object.keys(body)) {
      if (!allowed.has(k)) {
        const e: any = new Error("invalid_request");
        e.statusCode = 400;
        e.code = "INVALID_REQUEST";
        e.detail = { message: `Unknown body field: ${k}` };
        throw e;
      }
    }

    const orgId = String((req.params as any)?.org_id ?? "").trim();
    const result = await svc.setBillingTier(
      orgId,
      (body as any).billing_tier,
      actor,
      svc.ctxFromReq(req, actor, true)
    );
    return reply.code(200).send({ ok: true, result });
  });

  app.post("/v1/orgs/:org_id/kyc", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const body = requireBodyObject(req);

    const allowed = new Set(["kyc_status"]);
    for (const k of Object.keys(body)) {
      if (!allowed.has(k)) {
        const e: any = new Error("invalid_request");
        e.statusCode = 400;
        e.code = "INVALID_REQUEST";
        e.detail = { message: `Unknown body field: ${k}` };
        throw e;
      }
    }

    const orgId = String((req.params as any)?.org_id ?? "").trim();
    const result = await svc.setKyc(
      orgId,
      (body as any).kyc_status,
      actor,
      svc.ctxFromReq(req, actor, true)
    );
    return reply.code(200).send({ ok: true, result });
  });

  app.post("/v1/orgs/:org_id/soft-delete", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const body = (req as any).body;
    if (body != null) {
      const parsed = requireBodyObject(req);
      if (Object.keys(parsed).length !== 0) {
        const e: any = new Error("invalid_request");
        e.statusCode = 400;
        e.code = "INVALID_REQUEST";
        throw e;
      }
    }

    const orgId = String((req.params as any)?.org_id ?? "").trim();
    const result = await svc.softDelete(orgId, actor, svc.ctxFromReq(req, actor, true));
    return reply.code(200).send({ ok: true, result });
  });

  app.post("/v1/orgs/:org_id/restore", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const body = (req as any).body;
    if (body != null) {
      const parsed = requireBodyObject(req);
      if (Object.keys(parsed).length !== 0) {
        const e: any = new Error("invalid_request");
        e.statusCode = 400;
        e.code = "INVALID_REQUEST";
        throw e;
      }
    }

    const orgId = String((req.params as any)?.org_id ?? "").trim();
    const result = await svc.restore(orgId, actor, svc.ctxFromReq(req, actor, true));
    return reply.code(200).send({ ok: true, result });
  });
};

export { orgRoutes };
export default orgRoutes;