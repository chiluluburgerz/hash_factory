// ============================================================================
// File: src/routes/hedera.ts
// Version: 1.1-hash-factory-hedera-routes-expanded-read-surface | 2026-03-17
// Purpose:
//   Fastify routes for HF Hedera slice.
//   - Auth required
//   - User-facing Hedera read routes + admin topic membership routes
//   - Pass-through auth to Core
//   - Strict query/body allowlists
//   - No-store responses
//
// Security / policy posture:
//   - Core remains source of truth for auth, RLS, visibility, scopes, topic
//     membership semantics, and Hedera policy enforcement.
//   - HF route layer is transport-focused: validate request shape, enforce
//     no-store response posture, and forward pass-through auth/context.
//   - HF service layer may perform advisory entitlement preflight only for
//     tenant_admin / system_admin actors:
//       • read routes: hedera.allow_topic_list (fallback: hedera.enabled)
//       • admin topic membership routes: hedera.enabled +
//         hedera.allow_topic_bootstrap
// ============================================================================

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { HederaService, Actor } from "../services/hederaService.js";

const MAX_BODY_BYTES_DEFAULT = 64 * 1024;
const MAX_KEYS = Number.parseInt(process.env.HF_HEDERA_MAX_KEYS || "64", 10);
const MAX_DEPTH = Number.parseInt(process.env.HF_HEDERA_MAX_DEPTH || "4", 10);
const MAX_ARRAY = Number.parseInt(process.env.HF_HEDERA_MAX_ARRAY || "32", 10);
const MAX_STRING = Number.parseInt(process.env.HF_HEDERA_MAX_STRING || "2048", 10);

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

function readTimeoutMs(envName: string, fallback: number, min = 500, max = 300_000): number {
  const raw = process.env[envName];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const t = Math.trunc(n);
  return Math.max(min, Math.min(max, t));
}

function maxRouteBodyBytes(): number {
  const raw =
    process.env.HF_HEDERA_ROUTE_BODY_MAX_BYTES ??
    process.env.HTTP_ROUTE_BODY_MAX_BYTES ??
    null;
  if (raw == null || raw === "") return MAX_BODY_BYTES_DEFAULT;
  const v = toInt(raw, MAX_BODY_BYTES_DEFAULT);
  return Math.max(256, Math.min(1_000_000, v));
}

function requireTopicNameParam(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,64}$/.test(s)) {
    const e: any = new Error("invalid_topic_name");
    e.statusCode = 400;
    e.code = "INVALID_TOPIC_NAME";
    throw e;
  }
  return s;
}

function requireHederaIdParam(v: unknown, code: string): string {
  const s = String(v ?? "").trim();
  if (!/^0\.0\.\d+$/.test(s)) {
    const e: any = new Error(code.toLowerCase());
    e.statusCode = 400;
    e.code = code;
    throw e;
  }
  return s;
}

function requirePositiveIntParam(v: unknown, code: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    const e: any = new Error(code.toLowerCase());
    e.statusCode = 400;
    e.code = code;
    throw e;
  }
  return n;
}

function requireUuid(v: unknown, code: string): string {
  const s = String(v ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    const e: any = new Error(code.toLowerCase());
    e.statusCode = 400;
    e.code = code;
    throw e;
  }
  return s;
}

function requireTextIdParam(v: unknown, code: string): string {
  const s = String(v ?? "").trim();
  if (!s || s.length > 256 || /[\u0000-\u001f\u007f]/.test(s)) {
    const e: any = new Error(code.toLowerCase());
    e.statusCode = 400;
    e.code = code;
    throw e;
  }
  return s;
}

function optionalTopicScope(v: unknown): "org" | "shared" | "global" | undefined {
  if (v == null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === "org" || s === "shared" || s === "global") return s;

  const e: any = new Error("invalid_scope");
  e.statusCode = 400;
  e.code = "INVALID_SCOPE";
  throw e;
}

function optionalHtsType(v: unknown): "create" | "mint" | "burn" | "transfer" | "associate" | undefined {
  if (v == null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === "create" || s === "mint" || s === "burn" || s === "transfer" || s === "associate") {
    return s;
  }

  const e: any = new Error("invalid_type");
  e.statusCode = 400;
  e.code = "INVALID_TYPE";
  throw e;
}

function optionalBooleanParam(v: unknown, code = "INVALID_BOOLEAN"): boolean | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "boolean") return v;

  const s = String(v).trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;

  const e: any = new Error(code.toLowerCase());
  e.statusCode = 400;
  e.code = code;
  throw e;
}

function optionalDecryptMode(
  v: unknown
): "verify_only" | "decrypt_only" | "decrypt_and_verify" | undefined {
  if (v == null || v === "") return undefined;
  const s = String(v).trim();
  if (s === "verify_only" || s === "decrypt_only" || s === "decrypt_and_verify") {
    return s;
  }

  const e: any = new Error("invalid_mode");
  e.statusCode = 400;
  e.code = "INVALID_MODE";
  throw e;
}

function clampLimit(v: unknown, fallback = 50): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 200) {
    const e: any = new Error("invalid_limit");
    e.statusCode = 400;
    e.code = "INVALID_LIMIT";
    throw e;
  }
  return n;
}

function clampOffset(v: unknown, fallback = 0): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10_000) {
    const e: any = new Error("invalid_offset");
    e.statusCode = 400;
    e.code = "INVALID_OFFSET";
    throw e;
  }
  return n;
}

function clampRecentLimit(v: unknown, fallback = 5): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 20) {
    const e: any = new Error("invalid_recent_limit");
    e.statusCode = 400;
    e.code = "INVALID_RECENT_LIMIT";
    throw e;
  }
  return n;
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

function normalizeAddUserBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    userId: requireUuid(body.userId, "INVALID_USER_ID"),
  };

  if (body.org_id !== undefined) {
    out.org_id = requireUuid(body.org_id, "INVALID_ORG_ID");
  }

  const scope = optionalTopicScope(body.scope);
  if (scope !== undefined) out.scope = scope;

  const allowed = new Set(["userId", "org_id", "scope"]);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) {
      const e: any = new Error("invalid_request");
      e.statusCode = 400;
      e.code = "INVALID_REQUEST";
      throw e;
    }
  }

  return out;
}

function normalizeListTopicUsersQuery(query: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (query.includeRevoked !== undefined) {
    out.includeRevoked = optionalBooleanParam(query.includeRevoked);
  }

  if (query.limit !== undefined) {
    out.limit = clampLimit(query.limit, 50);
  }

  if (query.offset !== undefined) {
    out.offset = clampOffset(query.offset, 0);
  }

  if (query.org_id !== undefined) {
    out.org_id = requireUuid(query.org_id, "INVALID_ORG_ID");
  }

  if (query.scope !== undefined) {
    out.scope = optionalTopicScope(query.scope);
  }

  const allowed = new Set(["includeRevoked", "limit", "offset", "org_id", "scope"]);
  for (const k of Object.keys(query)) {
    if (!allowed.has(k)) {
      const e: any = new Error("invalid_query");
      e.statusCode = 400;
      e.code = "INVALID_QUERY";
      throw e;
    }
  }

  return out;
}

function normalizeRemoveUserQuery(query: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (query.org_id !== undefined) {
    out.org_id = requireUuid(query.org_id, "INVALID_ORG_ID");
  }

  if (query.scope !== undefined) {
    out.scope = optionalTopicScope(query.scope);
  }

  const allowed = new Set(["org_id", "scope"]);
  for (const k of Object.keys(query)) {
    if (!allowed.has(k)) {
      const e: any = new Error("invalid_query");
      e.statusCode = 400;
      e.code = "INVALID_QUERY";
      throw e;
    }
  }

  return out;
}

function normalizeVerifyJobBody(body: Record<string, unknown>): Record<string, unknown> {
  const message_id =
    body.message_id == null ? undefined : requireTextIdParam(body.message_id, "INVALID_MESSAGE_ID");

  const transaction_id =
    body.transaction_id == null
      ? undefined
      : requireTextIdParam(body.transaction_id, "INVALID_TRANSACTION_ID");

  const hasMessage = Boolean(message_id);
  const hasTransaction = Boolean(transaction_id);

  if (hasMessage === hasTransaction) {
    const e: any = new Error("invalid_request");
    e.statusCode = 400;
    e.code = "INVALID_REQUEST";
    throw e;
  }

  const idempotency_key = requireTextIdParam(body.idempotency_key, "INVALID_IDEMPOTENCY_KEY");

  const out: Record<string, unknown> = {
    idempotency_key,
    mode: "verify_only",
  };

  if (message_id) out.message_id = message_id;
  if (transaction_id) out.transaction_id = transaction_id;

  if (body.max_attempts !== undefined) {
    const n = Number(body.max_attempts);
    if (!Number.isInteger(n) || n < 0 || n > 50) {
      const e: any = new Error("invalid_max_attempts");
      e.statusCode = 400;
      e.code = "INVALID_MAX_ATTEMPTS";
      throw e;
    }
    out.max_attempts = n;
  }

  const allowed = new Set(["message_id", "transaction_id", "idempotency_key", "max_attempts", "mode"]);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) {
      const e: any = new Error("invalid_request");
      e.statusCode = 400;
      e.code = "INVALID_REQUEST";
      throw e;
    }
  }

  return out;
}

function normalizeDecryptVerifyBody(body: Record<string, unknown>): Record<string, unknown> {
  const message_id =
    body.message_id == null ? undefined : requireTextIdParam(body.message_id, "INVALID_MESSAGE_ID");

  const transaction_id =
    body.transaction_id == null
      ? undefined
      : requireTextIdParam(body.transaction_id, "INVALID_TRANSACTION_ID");

  const hasMessage = Boolean(message_id);
  const hasTransaction = Boolean(transaction_id);

  if (hasMessage === hasTransaction) {
    const e: any = new Error("invalid_request");
    e.statusCode = 400;
    e.code = "INVALID_REQUEST";
    throw e;
  }

  const out: Record<string, unknown> = {};
  if (message_id) out.message_id = message_id;
  if (transaction_id) out.transaction_id = transaction_id;

  const mode = optionalDecryptMode(body.mode);
  if (mode !== undefined) out.mode = mode;

  const include_decrypted = optionalBooleanParam(body.include_decrypted);
  if (include_decrypted !== undefined) out.include_decrypted = include_decrypted;

  const allowed = new Set(["message_id", "transaction_id", "mode", "include_decrypted"]);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) {
      const e: any = new Error("invalid_request");
      e.statusCode = 400;
      e.code = "INVALID_REQUEST";
      throw e;
    }
  }

  return out;
}

function ensureNoStore(app: FastifyInstance) {
  app.addHook("onSend", async (req, reply, payload) => {
    const rp = String((req as any).routerPath ?? "");
    const url = String((req as any).routeOptions?.url ?? "");
    const path = rp || url;

    if (path.startsWith("/v1/hedera") || path.startsWith("/v1/admin/hedera")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("vary", "Accept");
    }

    return payload;
  });
}

export type HederaRoutesOpts = Readonly<{
  hederaService: HederaService;
}>;

const hederaRoutes: FastifyPluginAsync<HederaRoutesOpts> = async (app, opts) => {
  if (!opts?.hederaService) throw new Error("hederaRoutes requires hederaService");
  const svc = opts.hederaService;

  const requireAuth = app.requireAuth();
  ensureNoStore(app);

  app.get("/v1/hedera/overview", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const recentLimit = clampRecentLimit((req.query as any)?.recentLimit, 5);

    const result = await svc.getOverview(
      req,
      { recentLimit },
      actor,
      {
        ...svc.ctxFromReq(req, actor, false),
        timeoutMs: readTimeoutMs("HF_HEDERA_OVERVIEW_TIMEOUT_MS", 20_000),
      }
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/hedera/topics", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);

    const result = await svc.listTopics(
      req,
      actor,
      svc.ctxFromReq(req, actor, false)
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/hedera/hcs/messages/:message_id", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const messageId = requireTextIdParam((req.params as any)?.message_id, "INVALID_MESSAGE_ID");

    const result = await svc.getHcsActivityByMessageId(
      req,
      messageId,
      actor,
      {
        ...svc.ctxFromReq(req, actor, false),
        timeoutMs: readTimeoutMs("HF_HEDERA_HCS_DETAIL_TIMEOUT_MS", 20_000),
      }
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/hedera/hcs/transactions/:transaction_id", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const transactionId = requireTextIdParam((req.params as any)?.transaction_id, "INVALID_TRANSACTION_ID");

    const result = await svc.getHcsActivityByTransactionId(
      req,
      transactionId,
      actor,
      {
        ...svc.ctxFromReq(req, actor, false),
        timeoutMs: readTimeoutMs("HF_HEDERA_HCS_DETAIL_TIMEOUT_MS", 20_000),
      }
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/hedera/hts/transactions/:transaction_id", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const transactionId = requireTextIdParam((req.params as any)?.transaction_id, "INVALID_TRANSACTION_ID");

    const result = await svc.getHtsActivityByTransactionId(
      req,
      transactionId,
      actor,
      {
        ...svc.ctxFromReq(req, actor, false),
        timeoutMs: readTimeoutMs("HF_HEDERA_HTS_DETAIL_TIMEOUT_MS", 20_000),
      }
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/hedera/topics/:topic_name", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const topicName = requireTopicNameParam((req.params as any)?.topic_name);

    const result = await svc.getTopicByName(
      req,
      topicName,
      actor,
      {
        ...svc.ctxFromReq(req, actor, false),
        timeoutMs: readTimeoutMs("HF_HEDERA_TOPIC_DETAIL_TIMEOUT_MS", 15_000),
      }
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/hedera/hcs", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);

    const topic_name =
      (req.query as any)?.topic_name == null || (req.query as any)?.topic_name === ""
        ? undefined
        : requireTopicNameParam((req.query as any)?.topic_name);

    const mirror_verified = optionalBooleanParam((req.query as any)?.mirror_verified);
    const limit = clampLimit((req.query as any)?.limit, 50);
    const offset = clampOffset((req.query as any)?.offset, 0);

    const result = await svc.listHcsActivity(
      req,
      {
        topic_name,
        mirror_verified,
        limit,
        offset,
      },
      actor,
      {
        ...svc.ctxFromReq(req, actor, false),
        timeoutMs: readTimeoutMs("HF_HEDERA_HCS_LIST_TIMEOUT_MS", 20_000),
      }
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/hedera/hts", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);

    const token_id =
      (req.query as any)?.token_id == null || (req.query as any)?.token_id === ""
        ? undefined
        : requireHederaIdParam((req.query as any)?.token_id, "INVALID_TOKEN_ID");

    const type = optionalHtsType((req.query as any)?.type);
    const mirror_verified = optionalBooleanParam((req.query as any)?.mirror_verified);
    const limit = clampLimit((req.query as any)?.limit, 50);
    const offset = clampOffset((req.query as any)?.offset, 0);

    const result = await svc.listHtsActivity(
      req,
      {
        token_id,
        type,
        mirror_verified,
        limit,
        offset,
      },
      actor,
      {
        ...svc.ctxFromReq(req, actor, false),
        timeoutMs: readTimeoutMs("HF_HEDERA_HTS_LIST_TIMEOUT_MS", 20_000),
      }
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/hedera/topics/:topic_name/messages", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const topicName = requireTopicNameParam((req.params as any)?.topic_name);
    const limit = clampLimit((req.query as any)?.limit, 50);
    const offset = clampOffset((req.query as any)?.offset, 0);

    const result = await svc.getTopicMessages(
      req,
      topicName,
      { limit, offset },
      actor,
      {
        ...svc.ctxFromReq(req, actor, false),
        timeoutMs: readTimeoutMs("HF_HEDERA_GET_TOPIC_MESSAGES_TIMEOUT_MS", 30_000),
      }
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/hedera/tokens/:token_id/associations/:account_id", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const tokenId = requireHederaIdParam((req.params as any)?.token_id, "INVALID_TOKEN_ID");
    const accountId = requireHederaIdParam((req.params as any)?.account_id, "INVALID_ACCOUNT_ID");

    const result = await svc.getTokenAssociation(
      req,
      tokenId,
      accountId,
      actor,
      {
        ...svc.ctxFromReq(req, actor, false),
        timeoutMs: readTimeoutMs("HF_HEDERA_TOKEN_ASSOC_TIMEOUT_MS", 20_000),
      }
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/hedera/nfts/:token_id/serials/:serial/ownership", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const tokenId = requireHederaIdParam((req.params as any)?.token_id, "INVALID_TOKEN_ID");
    const serial = requirePositiveIntParam((req.params as any)?.serial, "INVALID_SERIAL");
    const expectedAccountId = requireHederaIdParam(
      (req.query as any)?.expectedAccountId,
      "INVALID_ACCOUNT_ID"
    );

    const result = await svc.verifyNftOwnership(
      req,
      tokenId,
      serial,
      expectedAccountId,
      actor,
      {
        ...svc.ctxFromReq(req, actor, false),
        timeoutMs: readTimeoutMs("HF_HEDERA_NFT_OWNERSHIP_TIMEOUT_MS", 30_000),
      }
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/admin/hedera/topics/:topic_name/users", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const topicName = requireTopicNameParam((req.params as any)?.topic_name);
    const query = normalizeListTopicUsersQuery(isPlainObject(req.query) ? (req.query as Record<string, unknown>) : {});

    const result = await svc.adminListTopicUsers(
      req,
      topicName,
      query,
      actor,
      {
        ...svc.ctxFromReq(req, actor, false),
        timeoutMs: readTimeoutMs("HF_HEDERA_LIST_TOPIC_USERS_TIMEOUT_MS", 20_000),
      }
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.post("/v1/admin/hedera/topics/:topic_name/users", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const topicName = requireTopicNameParam((req.params as any)?.topic_name);
    const rawBody = requireBodyObject(req);
    const body = normalizeAddUserBody(rawBody);

    const result = await svc.adminAddUserToTopic(
      req,
      topicName,
      body,
      actor,
      {
        ...svc.ctxFromReq(req, actor, true),
        timeoutMs: readTimeoutMs("HF_HEDERA_ADD_USER_TO_TOPIC_TIMEOUT_MS", 60_000),
      }
    );

    return reply.code(201).send({ ok: true, result });
  });

  app.delete("/v1/admin/hedera/topics/:topic_name/users/:user_id", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const topicName = requireTopicNameParam((req.params as any)?.topic_name);
    const userId = requireUuid((req.params as any)?.user_id, "INVALID_USER_ID");
    const query = normalizeRemoveUserQuery(isPlainObject(req.query) ? (req.query as Record<string, unknown>) : {});

    const result = await svc.adminRemoveUserFromTopic(
      req,
      topicName,
      userId,
      query,
      actor,
      {
        ...svc.ctxFromReq(req, actor, true),
        timeoutMs: readTimeoutMs("HF_HEDERA_REMOVE_USER_FROM_TOPIC_TIMEOUT_MS", 60_000),
      }
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.post("/v1/hedera/verify-jobs", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const rawBody = requireBodyObject(req);
    const body = normalizeVerifyJobBody(rawBody);

    const result = await svc.enqueueVerifyJob(
      req,
      body,
      actor,
      {
        ...svc.ctxFromReq(req, actor, false),
        timeoutMs: readTimeoutMs("HF_HEDERA_VERIFY_JOB_ENQUEUE_TIMEOUT_MS", 30_000),
      }
    );

    return reply.code(202).send({ ok: true, result });
  });

  app.get("/v1/hedera/verify-jobs/:id", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const id = requireUuid((req.params as any)?.id, "INVALID_JOB_ID");
    const with_tx = optionalBooleanParam((req.query as any)?.with_tx);

    const result = await svc.getVerifyJob(
      req,
      id,
      { with_tx },
      actor,
      {
        ...svc.ctxFromReq(req, actor, false),
        timeoutMs: readTimeoutMs("HF_HEDERA_VERIFY_JOB_GET_TIMEOUT_MS", 20_000),
      }
    );

    return reply.code(200).send({ ok: true, result });
  });
 
  app.post("/v1/hedera/decrypt/verify", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const rawBody = requireBodyObject(req);
    const body = normalizeDecryptVerifyBody(rawBody);

    const result = await svc.verifyAndMaybeDecrypt(
      req,
      body,
      actor,
      {
        ...svc.ctxFromReq(req, actor, false),
        timeoutMs: readTimeoutMs("HF_HEDERA_DECRYPT_VERIFY_TIMEOUT_MS", 30_000),
      }
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.post("/v1/hedera/verify", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const rawBody = requireBodyObject(req);
    const body = {
      ...normalizeDecryptVerifyBody(rawBody),
      mode: "verify_only",
      include_decrypted: false,
    };

    const result = await svc.verifyAndMaybeDecrypt(
      req,
      body,
      actor,
      {
        ...svc.ctxFromReq(req, actor, false),
        timeoutMs: readTimeoutMs("HF_HEDERA_VERIFY_TIMEOUT_MS", 30_000),
      }
    );

    return reply.code(200).send({ ok: true, result });
  });
  
  app.post("/v1/hedera/decrypt", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const rawBody = requireBodyObject(req);
    const body = {
      ...normalizeDecryptVerifyBody(rawBody),
      mode: "decrypt_only",
    };

    const result = await svc.verifyAndMaybeDecrypt(
      req,
      body,
      actor,
      {
        ...svc.ctxFromReq(req, actor, false),
        timeoutMs: readTimeoutMs("HF_HEDERA_DECRYPT_TIMEOUT_MS", 30_000),
      }
    );

    return reply.code(200).send({ ok: true, result });
  });
};

export { hederaRoutes };
export default hederaRoutes;