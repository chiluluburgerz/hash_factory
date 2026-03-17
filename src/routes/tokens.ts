// ============================================================================
// File: src/routes/tokens.ts
// Version: 1.0-hash-factory-token-routes | 2026-03-12
// Purpose:
//   Fastify routes for HF token slice.
//   - Auth required.
//   - Read routes for authenticated actors.
//   - Admin write routes for tenant_admin/system_admin actors.
//   - Pass-through auth to Core.
//   - Strict query/body allowlists.
//   - No-store responses.
// Notes:
//   - Core remains source of truth for scopes, entitlements, token semantics,
//     and RLS visibility.
// ============================================================================

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { TokenService, Actor } from "../services/tokenService.js";

const MAX_BODY_BYTES_DEFAULT = 128 * 1024;
const MAX_KEYS = Number.parseInt(process.env.HF_TOKENS_MAX_KEYS || "128", 10);
const MAX_DEPTH = Number.parseInt(process.env.HF_TOKENS_MAX_DEPTH || "5", 10);
const MAX_ARRAY = Number.parseInt(process.env.HF_TOKENS_MAX_ARRAY || "64", 10);
const MAX_STRING = Number.parseInt(process.env.HF_TOKENS_MAX_STRING || "2048", 10);

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
  const raw = process.env.HF_TOKENS_ROUTE_BODY_MAX_BYTES ?? process.env.HTTP_ROUTE_BODY_MAX_BYTES ?? null;
  if (raw == null || raw === "") return MAX_BODY_BYTES_DEFAULT;
  const v = toInt(raw, MAX_BODY_BYTES_DEFAULT);
  return Math.max(256, Math.min(2_000_000, v));
}

function isUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function requireUuidParam(v: unknown, code: string): string {
  const s = String(v ?? "").trim();
  if (!isUuid(s)) {
    const e: any = new Error(code.toLowerCase());
    e.statusCode = 400;
    e.code = code;
    throw e;
  }
  return s;
}

function requireTokenIdParam(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(s)) {
    const e: any = new Error("invalid_token_id");
    e.statusCode = 400;
    e.code = "INVALID_TOKEN_ID";
    throw e;
  }
  return s;
}

function requirePurposeParam(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(s)) {
    const e: any = new Error("invalid_purpose");
    e.statusCode = 400;
    e.code = "INVALID_PURPOSE";
    throw e;
  }
  return s;
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
      const e: any = new Error("invalid_body");
      e.statusCode = 400;
      e.code = "INVALID_BODY";
      throw e;
    }

    if (value == null) return null;

    const t = typeof value;
    if (t === "string") {
      if ((value as string).length > MAX_STRING) {
        const e: any = new Error("invalid_body");
        e.statusCode = 400;
        e.code = "INVALID_BODY";
        throw e;
      }
      return value;
    }
    if (t === "number") {
      if (!Number.isFinite(value)) {
        const e: any = new Error("invalid_body");
        e.statusCode = 400;
        e.code = "INVALID_BODY";
        throw e;
      }
      return value;
    }
    if (t === "boolean") return value;

    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY) {
        const e: any = new Error("invalid_body");
        e.statusCode = 400;
        e.code = "INVALID_BODY";
        throw e;
      }
      return value.map((v) => sanitizeValue(v, depth + 1, keysSeen));
    }

    if (!isPlainObject(value)) {
      const e: any = new Error("invalid_body");
      e.statusCode = 400;
      e.code = "INVALID_BODY";
      throw e;
    }

    const entries = Object.entries(value);
    if (entries.length + keysSeen.count > MAX_KEYS) {
      const e: any = new Error("invalid_body");
      e.statusCode = 400;
      e.code = "INVALID_BODY";
      throw e;
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      if (isDangerousKey(k)) {
        const e: any = new Error("invalid_body");
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

    if (path.startsWith("/v1/tokens") || path.startsWith("/v1/admin/tokens")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("vary", "Accept");
    }

    return payload;
  });
}

function parsePageQuery(req: FastifyRequest): { limit?: number; offset?: number } {
  const q = ((req as any).query ?? {}) as Record<string, unknown>;
  const out: { limit?: number; offset?: number } = {};

  if (q.limit !== undefined) out.limit = Math.max(1, Math.min(1000, toInt(q.limit, 100)));
  if (q.offset !== undefined) out.offset = Math.max(0, Math.min(10_000_000, toInt(q.offset, 0)));

  return out;
}

function readAllowedQuery(req: FastifyRequest, allowed: string[]): Record<string, unknown> {
  const q = ((req as any).query ?? {}) as Record<string, unknown>;
  const allow = new Set(allowed);
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(q)) {
    if (!allow.has(k)) {
      const e: any = new Error("invalid_request");
      e.statusCode = 400;
      e.code = "INVALID_REQUEST";
      e.detail = { message: `Unknown query field: ${k}` };
      throw e;
    }
    out[k] = v;
  }

  return out;
}

export type TokenRoutesOpts = Readonly<{
  tokenService: TokenService;
}>;

const tokenRoutes: FastifyPluginAsync<TokenRoutesOpts> = async (app, opts) => {
  if (!opts?.tokenService) throw new Error("tokenRoutes requires tokenService");
  const svc = opts.tokenService;

  const requireAuth = app.requireAuth();
  ensureNoStore(app);

  app.get("/v1/tokens", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const qRaw = readAllowedQuery(req, ["limit", "offset"]);
    const result = await svc.listActive(req, actor, qRaw, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/tokens/search", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const qRaw = readAllowedQuery(req, ["token_id", "symbol", "name", "purpose", "limit", "offset"]);
    const result = await svc.search(req, actor, qRaw, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/tokens/by-id/:id", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const id = requireUuidParam((req.params as any)?.id, "INVALID_TOKEN_ROW_ID");
    const result = await svc.getByRowId(req, actor, id, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/tokens/by-token-id/:token_id", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const tokenId = requireTokenIdParam((req.params as any)?.token_id);
    const result = await svc.getByTokenId(req, actor, tokenId, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/tokens/by-symbol-purpose", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const q = readAllowedQuery(req, ["symbol", "purpose"]);
    const result = await svc.getBySymbolPurpose(
      req,
      actor,
      q.symbol,
      q.purpose,
      svc.ctxFromReq(req, actor, false)
    );
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/tokens/purpose/:purpose", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const purpose = requirePurposeParam((req.params as any)?.purpose);
    const page = parsePageQuery(req);
    const result = await svc.listByPurpose(req, actor, purpose, page, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/tokens/purpose/:purpose/resolve", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const purpose = requirePurposeParam((req.params as any)?.purpose);
    const result = await svc.resolveForPurpose(req, actor, purpose, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.post("/v1/admin/tokens", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const body = requireBodyObject(req);
    const result = await svc.create(req, body, actor, svc.ctxFromReq(req, actor, true));
    return reply.code(201).send({ ok: true, result });
  });

  app.put("/v1/admin/tokens", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const body = requireBodyObject(req);
    const result = await svc.upsert(req, body, actor, svc.ctxFromReq(req, actor, true));
    return reply.code(200).send({ ok: true, result });
  });

  app.post("/v1/admin/tokens/:token_id/metadata", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const tokenId = requireTokenIdParam((req.params as any)?.token_id);
    const body = requireBodyObject(req);
    const result = await svc.patchMetadata(req, tokenId, body, actor, svc.ctxFromReq(req, actor, true));
    return reply.code(200).send({ ok: true, result });
  });

  app.delete("/v1/admin/tokens/:token_id", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const tokenId = requireTokenIdParam((req.params as any)?.token_id);
    const result = await svc.delete(req, tokenId, actor, svc.ctxFromReq(req, actor, true));
    return reply.code(200).send({ ok: true, result });
  });

  app.post("/v1/admin/tokens/:token_id/restore", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const tokenId = requireTokenIdParam((req.params as any)?.token_id);
    const result = await svc.restore(req, tokenId, actor, svc.ctxFromReq(req, actor, true));
    return reply.code(200).send({ ok: true, result });
  });
};

export { tokenRoutes };
export default tokenRoutes;