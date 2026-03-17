// ============================================================================
// File: src/routes/wallets.ts
// Version: 1.0-hash-factory-wallet-routes | 2026-03-12
// Purpose:
//   Fastify routes for HF wallet slice.
//   - Auth required.
//   - Self-service wallet routes + system-admin operational routes.
//   - Pass-through auth to Core.
//   - Strict query/body allowlists.
//   - No-store responses.
// Notes:
//   - Core remains source of truth for ownership, entitlements, and RLS.
// ============================================================================

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { WalletService, Actor } from "../services/walletService.js";

const MAX_BODY_BYTES_DEFAULT = 128 * 1024;
const MAX_KEYS = Number.parseInt(process.env.HF_WALLETS_MAX_KEYS || "128", 10);
const MAX_DEPTH = Number.parseInt(process.env.HF_WALLETS_MAX_DEPTH || "5", 10);
const MAX_ARRAY = Number.parseInt(process.env.HF_WALLETS_MAX_ARRAY || "64", 10);
const MAX_STRING = Number.parseInt(process.env.HF_WALLETS_MAX_STRING || "2048", 10);

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
  const raw = process.env.HF_WALLETS_ROUTE_BODY_MAX_BYTES ?? process.env.HTTP_ROUTE_BODY_MAX_BYTES ?? null;
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
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(s)) {
    const e: any = new Error("invalid_token_id");
    e.statusCode = 400;
    e.code = "INVALID_TOKEN_ID";
    throw e;
  }
  return s;
}

function requireIdempotencyKey(body: Record<string, unknown>): string {
  const s = String(body?.idempotency_key ?? "").trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(s)) {
    const e: any = new Error("idempotency_key_required");
    e.statusCode = 400;
    e.code = "IDEMPOTENCY_KEY_REQUIRED";
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

    if (path.startsWith("/v1/wallets") || path.startsWith("/v1/admin/wallets") || path.startsWith("/v1/admin/users")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("vary", "Accept");
    }

    return payload;
  });
}

export type WalletRoutesOpts = Readonly<{
  walletService: WalletService;
}>;

const walletRoutes: FastifyPluginAsync<WalletRoutesOpts> = async (app, opts) => {
  if (!opts?.walletService) throw new Error("walletRoutes requires walletService");
  const svc = opts.walletService;

  const requireAuth = app.requireAuth();
  ensureNoStore(app);

  app.get("/v1/wallets/me", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const result = await svc.listMine(req, actor, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/wallets/me/primary", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const result = await svc.getMyPrimary(req, actor, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/wallets/:wallet_id", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const walletId = requireUuidParam((req.params as any)?.wallet_id, "INVALID_WALLET_ID");
    const result = await svc.getWalletById(req, walletId, actor, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.post("/v1/wallets/me", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const body = requireBodyObject(req);
    const result = await svc.createMyWallet(req, body, actor, svc.ctxFromReq(req, actor, true));
    return reply.code(result.created ? 201 : 200).send({
      ok: true,
      result: result.wallet,
      created: result.created,
    });
  });

  app.post("/v1/wallets/:wallet_id/primary", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const walletId = requireUuidParam((req.params as any)?.wallet_id, "INVALID_WALLET_ID");
    const result = await svc.setMyPrimary(req, walletId, actor, svc.ctxFromReq(req, actor, true));
    return reply.code(200).send({ ok: true, result });
  });

  app.delete("/v1/wallets/:wallet_id", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const walletId = requireUuidParam((req.params as any)?.wallet_id, "INVALID_WALLET_ID");
    const result = await svc.retireMyWallet(req, walletId, actor, svc.ctxFromReq(req, actor, true));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/wallets/:wallet_id/balances/:token_id", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const walletId = requireUuidParam((req.params as any)?.wallet_id, "INVALID_WALLET_ID");
    const tokenId = requireTokenIdParam((req.params as any)?.token_id);
    const result = await svc.getBalanceRow(req, walletId, tokenId, actor, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/wallets/:wallet_id/available/:token_id", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const walletId = requireUuidParam((req.params as any)?.wallet_id, "INVALID_WALLET_ID");
    const tokenId = requireTokenIdParam((req.params as any)?.token_id);
    const result = await svc.getAvailable(req, walletId, tokenId, actor, svc.ctxFromReq(req, actor, false));
    return reply.code(200).send({ ok: true, result });
  });

  app.post("/v1/admin/wallets", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const body = requireBodyObject(req);
    const result = await svc.adminCreateWallet(req, body, actor, svc.ctxFromReq(req, actor, true));
    return reply.code(result?.created ? 201 : 200).send({
      ok: true,
      result: result?.wallet ?? null,
      created: !!result?.created,
    });
  });

  app.post("/v1/admin/wallets/balance-ops", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const body = requireBodyObject(req);
    requireIdempotencyKey(body);
    const result = await svc.adminBalanceOp(req, body, actor, svc.ctxFromReq(req, actor, true));
    reply.code(201).send({ ok: true, result });
  });

  app.post("/v1/admin/wallets/transfers", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const body = requireBodyObject(req);
    requireIdempotencyKey(body);
    const result = await svc.adminTransfer(req, body, actor, svc.ctxFromReq(req, actor, true));
    reply.code(201).send({ ok: true, result });
  });

  app.post("/v1/admin/wallets/reconcile", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const body = requireBodyObject(req);
    requireIdempotencyKey(body);
    const result = await svc.adminReconcile(req, body, actor, svc.ctxFromReq(req, actor, true));
    reply.code(201).send({ ok: true, result });
  });

  app.get("/v1/admin/users/:user_id/wallets", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const userId = requireUuidParam((req.params as any)?.user_id, "INVALID_USER_ID");
    const result = await svc.adminListUserWallets(req, userId, actor, svc.ctxFromReq(req, actor, false));
    reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/admin/users/:user_id/wallets/primary", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const userId = requireUuidParam((req.params as any)?.user_id, "INVALID_USER_ID");
    const result = await svc.adminGetUserPrimary(req, userId, actor, svc.ctxFromReq(req, actor, false));
    reply.code(200).send({ ok: true, result });
  });
};

export { walletRoutes };
export default walletRoutes;