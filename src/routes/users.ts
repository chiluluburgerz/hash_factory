// ============================================================================
// File: src/routes/users.ts
// Version: 1.0-hash-factory-user-routes | 2026-03-11
// Purpose:
//   Fastify routes for HF user slice.
//   - Auth required.
//   - Self-service + org-visible reads only.
//   - Strict query/body allowlists.
//   - No-store responses.
// ============================================================================

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { UserService, Actor } from "../services/userService.js";

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
  const raw = process.env.HF_USERS_ROUTE_BODY_MAX_BYTES ?? process.env.HTTP_ROUTE_BODY_MAX_BYTES ?? null;
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

function ensureNoStore(app: FastifyInstance) {
  app.addHook("onSend", async (req, reply, payload) => {
    const rp = String((req as any).routerPath ?? "");
    const url = String((req as any).routeOptions?.url ?? "");
    const path = rp || url;

    if (path.startsWith("/v1/users")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("vary", "Accept");
    }

    return payload;
  });
}

export type UserRoutesOpts = Readonly<{
  userService: UserService;
}>;

const userRoutes: FastifyPluginAsync<UserRoutesOpts> = async (app, opts) => {
  if (!opts?.userService) throw new Error("userRoutes requires userService");
  const svc = opts.userService;

  const requireAuth = app.requireAuth();
  ensureNoStore(app);

  app.get("/v1/users/me", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const result = await svc.getMe(actor, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.patch("/v1/users/me", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const body = requireBodyObject(req);
    const result = await svc.patchMe(body, actor, svc.ctxFromReq(req, actor, true));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/users/org", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);

    const q: any = (req as any).query ?? {};
    const allowed = new Set(["limit", "offset", "includeDeleted"]);
    for (const k of Object.keys(q)) {
      if (!allowed.has(k)) {
        const e: any = new Error("invalid_request");
        e.statusCode = 400;
        e.code = "INVALID_REQUEST";
        e.detail = { message: `Unknown query field: ${k}` };
        throw e;
      }
    }

    const result = await svc.listOrgUsers(q, actor, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/users/:user_id", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const userId = String((req.params as any)?.user_id ?? "").trim();
    const result = await svc.getUserById(userId, actor, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });
};

export { userRoutes };
export default userRoutes;