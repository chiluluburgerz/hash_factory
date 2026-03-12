// ============================================================================
// File: src/routes/merkleRead.ts
// Version: 1.0-hash-factory-merkle-read-routes | 2026-03-06
// Purpose:
//   Fastify "Merkle operational" READ routes for Hash Factory (proxy to Core).
//   - /v1/merkle/root
//   - /v1/merkle/tree
//   - /v1/merkle/proof
//   - /v1/merkle/proof/by-hash/:leafHash
// Security:
//   - Auth required
//   - strict query / param validation
//   - no-store responses
// Notes:
//   - Core remains source-of-truth for scopes, entitlements, domain/org checks,
//     and proof/root visibility.
// ============================================================================

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { CoreClientError } from "../core/coreClient.js";
import { MerkleClient, MerkleClientError } from "../core/merkleClient.js";

type Actor = Readonly<{
  user_id?: string | null;
  org_id?: string | null;
  org_role?: string | null;
  is_system_admin?: boolean | null;
  is_admin?: boolean | null;
  isAdmin?: boolean | null;
}>;

function requireActor(req: FastifyRequest): Actor {
  const actor = (req as any).actor ?? null;
  if (actor && typeof actor === "object") return actor as Actor;
  const e: any = new Error("Unauthorized");
  e.statusCode = 401;
  e.code = "AUTH_REQUIRED";
  throw e;
}

function normalizeOptionalString(v: unknown, max = 512): string | undefined {
  if (v == null || v === "") return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

function ctxFromReq(req: FastifyRequest): { requestId?: string | null; clientRequestId?: string | null } {
  return {
    requestId: (req as any)?.requestId ?? (req as any)?.id ?? null,
    clientRequestId: (req as any)?.clientRequestId ?? null,
  };
}

function actorTag(actor: Actor | null | undefined): string | null {
  if (!actor) return null;
  const u = actor.user_id ? String(actor.user_id) : "";
  const o = actor.org_id ? String(actor.org_id) : "";
  const r = actor.org_role ? String(actor.org_role) : "";
  if (!u && !o && !r) return null;
  return `u:${u || "?"}|o:${o || "?"}|r:${r || "?"}`;
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

function coreCtx(req: FastifyRequest, actor: Actor | null) {
  const base = ctxFromReq(req);
  const hfActor = actorTag(actor);
  const coreAuthHeader = extractIncomingAuthHeader(req);

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

function findUnknownQueryKeys(queryObj: unknown, allowed: Set<string>): string[] {
  if (!queryObj || typeof queryObj !== "object") return [];
  const keys = Object.keys(queryObj as Record<string, unknown>);
  const bad: string[] = [];
  for (const k of keys) {
    if (!allowed.has(k)) bad.push(k);
  }
  return bad;
}

function mapCoreError(err: unknown): Error {
  if (err instanceof MerkleClientError) {
    const e: any = new Error(err.message || "upstream_error");
    const sc = Number(err.statusCode);
    e.statusCode = sc >= 400 && sc <= 599 ? sc : 502;
    e.code = err.code || (e.statusCode >= 500 ? "UPSTREAM_ERROR" : "BAD_REQUEST");
    if ((err as any).requestId) e.upstream_request_id = (err as any).requestId;
    if ((err as any).detail !== undefined) e.upstream_detail = (err as any).detail;
    return e;
  }

  if (err instanceof CoreClientError) {
    const e: any = new Error(err.message || "upstream_error");
    e.statusCode = err.status >= 400 && err.status <= 599 ? err.status : 502;
    e.code = err.code ?? (e.statusCode >= 500 ? "UPSTREAM_ERROR" : "BAD_REQUEST");
    if (err.requestId) e.upstream_request_id = err.requestId;
    if ((err as any).detail !== undefined) e.upstream_detail = (err as any).detail;
    return e;
  }

  const e: any = new Error("internal_error");
  e.statusCode = 500;
  e.code = "INTERNAL_ERROR";
  return e;
}

function ensureNoStore(app: FastifyInstance) {
  app.addHook("onSend", async (req, reply, payload) => {
    const url = String((req as any).routeOptions?.url ?? "");
    const isMerkleRead =
      url === "/v1/merkle/root" ||
      url === "/v1/merkle/tree" ||
      url === "/v1/merkle/proof" ||
      url === "/v1/merkle/proof/by-hash/:leafHash";

    if (isMerkleRead) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("vary", "Accept");
    }
    return payload;
  });
}

export type MerkleReadRoutesOpts = Readonly<{
  merkle: MerkleClient;
}>;

const merkleReadRoutes: FastifyPluginAsync<MerkleReadRoutesOpts> = async (app, opts) => {
  if (!opts?.merkle) throw new Error("merkleReadRoutes requires merkle client");
  const merkle = opts.merkle;

  const requireAuth = app.requireAuth();
  ensureNoStore(app);

  app.get("/v1/merkle/root", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const q: any = (req as any).query ?? {};
    const unknown = findUnknownQueryKeys(q, new Set(["domain"]));
    if (unknown.length) {
      const e: any = new Error("invalid_request");
      e.statusCode = 400;
      e.code = "INVALID_REQUEST";
      e.detail = { message: `Unknown query field(s): ${unknown.join(", ")}` };
      throw e;
    }

    try {
      const result = await merkle.getRoot(
        { domain: normalizeOptionalString(q.domain, 256) },
        coreCtx(req, actor),
        { maxRetries: 0 }
      );
      reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.get("/v1/merkle/tree", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const q: any = (req as any).query ?? {};
    const unknown = findUnknownQueryKeys(q, new Set(["proofDate", "domain"]));
    if (unknown.length) {
      const e: any = new Error("invalid_request");
      e.statusCode = 400;
      e.code = "INVALID_REQUEST";
      e.detail = { message: `Unknown query field(s): ${unknown.join(", ")}` };
      throw e;
    }

    try {
      const result = await merkle.getTree(
        {
          proofDate: normalizeOptionalString(q.proofDate, 32),
          domain: normalizeOptionalString(q.domain, 256),
        },
        coreCtx(req, actor),
        { maxRetries: 0 }
      );
      reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.get("/v1/merkle/proof", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const q: any = (req as any).query ?? {};
    const unknown = findUnknownQueryKeys(q, new Set(["proofDate", "domain", "entityId"]));
    if (unknown.length) {
      const e: any = new Error("invalid_request");
      e.statusCode = 400;
      e.code = "INVALID_REQUEST";
      e.detail = { message: `Unknown query field(s): ${unknown.join(", ")}` };
      throw e;
    }

    try {
      const result = await merkle.getProof(
        {
          proofDate: normalizeOptionalString(q.proofDate, 32),
          domain: normalizeOptionalString(q.domain, 256),
          entityId: normalizeOptionalString(q.entityId, 512),
        },
        coreCtx(req, actor),
        { maxRetries: 0 }
      );
      reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.get("/v1/merkle/proof/by-hash/:leafHash", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const leafHash = normalizeOptionalString((req.params as any)?.leafHash, 1024);
    if (!leafHash) {
      const e: any = new Error("invalid_leaf_hash");
      e.statusCode = 400;
      e.code = "INVALID_LEAF_HASH";
      throw e;
    }

    try {
      const result = await merkle.getProofByLeafHash(
        leafHash,
        coreCtx(req, actor),
        { maxRetries: 0 }
      );
      reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });
};

export { merkleReadRoutes };
export default merkleReadRoutes;