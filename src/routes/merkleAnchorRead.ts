// ============================================================================
// File: src/routes/merkleAnchorRead.ts
// Version: 1.0-hash-factory-merkle-anchor-read-routes | 2026-03-20
// Purpose:
//   Fastify "Merkle Anchor" READ routes for Hash Factory (proxy to Core).
//   - GET /v1/merkle/anchor/requests
//   - GET /v1/merkle/anchor/requests/:anchorRequestId
// Security:
//   - Auth required
//   - read access remains actor-scoped through Core
//   - strict query normalization
//   - no-store responses
// Notes:
//   - Core remains source-of-truth for scopes, entitlements, domain/org checks,
//     and visibility/RLS.
// ============================================================================

import type HfEntitlements from "../lib/entitlements/hfOrgEntitlements.js";
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { CoreClientError } from "../core/coreClient.js";
import {
  MerkleAnchorClient,
  MerkleAnchorClientError,
} from "../core/merkleAnchorClient.js";

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

function toInt(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function normalizePositiveInt(value: unknown, { min = 1, max = 1000, fallback = 50 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeNonNegativeInt(value: unknown, { max = 10_000_000, fallback = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(max, Math.trunc(n)));
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

function shouldUseServiceKeyForAdmin(): boolean {
  return String(process.env.HF_MERKLE_USE_SERVICE_KEY_FOR_ADMIN ?? "").trim() === "true";
}

function ctxFromReq(req: FastifyRequest): { requestId?: string | null; clientRequestId?: string | null } {
  return {
    requestId: (req as any)?.requestId ?? (req as any)?.id ?? null,
    clientRequestId: (req as any)?.clientRequestId ?? null,
  };
}

function coreCtx(req: FastifyRequest, actor: Actor | null) {
  const base = ctxFromReq(req);
  const hfActor = actorTag(actor);

  const passThroughAuth = !shouldUseServiceKeyForAdmin();
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
  if (err && typeof err === "object" && ("statusCode" in err || "code" in err)) {
    const e: any = new Error((err as any).message || "request_failed");
    e.statusCode = Number((err as any).statusCode ?? 500);
    e.code = String((err as any).code ?? "INTERNAL_ERROR");
    if ((err as any).detail !== undefined) e.detail = (err as any).detail;
    if ((err as any).upstream_request_id !== undefined) e.upstream_request_id = (err as any).upstream_request_id;
    if ((err as any).upstream_detail !== undefined) e.upstream_detail = (err as any).upstream_detail;
    return e;
  }

  if (err instanceof MerkleAnchorClientError) {
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

function asPlainObject(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function pick(obj: Record<string, unknown> | null, keys: string[]): Record<string, unknown> | null {
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return Object.keys(out).length ? out : null;
}

function shapeAnchorRow(anchorLike: unknown): Record<string, unknown> | null {
  const anchor = asPlainObject(anchorLike);
  if (!anchor) return null;

  return {
    ...(pick(anchor, [
      "anchor_request_id",
      "id",
      "proof_date",
      "domain",
      "anchor_kind",
      "root_id",
      "root_hash",
      "payload_type",
      "payload_hash",
      "payload_bytes",
      "leaf_id",
      "leaf_hash",
      "anchor_hash",
      "hcs_topic_id",
      "hcs_transaction_id",
      "hcs_message_id",
      "status",
      "reason",
      "attempt_count",
      "retry_at",
      "last_error_code",
      "last_error",
      "publishing_claimed_at",
      "published_at",
      "confirmed_at",
      "failed_at",
      "cancelled_at",
      "created_at",
      "updated_at",
    ]) ?? {}),
  };
}

function shapeAnchorListResult(resultLike: unknown): Record<string, unknown> {
  const result = asPlainObject(resultLike) ?? {};
  const rowsRaw = Array.isArray(result.rows) ? result.rows : [];
  const rows = rowsRaw.map((row) => shapeAnchorRow(row)).filter(Boolean);

  return {
    ok: Boolean(result.ok ?? true),
    rows,
    limit: Number(result.limit ?? rows.length ?? 0) || 0,
    offset: Number(result.offset ?? 0) || 0,
  };
}

function shapeAnchorDetailResult(resultLike: unknown): Record<string, unknown> | null {
  return shapeAnchorRow(resultLike);
}

function ensureNoStore(app: FastifyInstance) {
  app.addHook("onSend", async (req, reply, payload) => {
    const rp = String((req as any).routerPath ?? "");
    const url = String((req as any).routeOptions?.url ?? "");
    const path = rp || url;
    if (path.startsWith("/v1/merkle/anchor")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("vary", "Accept");
    }
    return payload;
  });
}

export type MerkleAnchorReadRoutesOpts = Readonly<{
  merkleAnchor: MerkleAnchorClient;
  entitlements?: HfEntitlements | null;
}>;

const merkleAnchorReadRoutes: FastifyPluginAsync<MerkleAnchorReadRoutesOpts> = async (app, opts) => {
  if (!opts?.merkleAnchor) throw new Error("merkleAnchorReadRoutes requires merkleAnchor client");
  const merkleAnchor = opts.merkleAnchor;
  const entitlements = opts.entitlements ?? null;

  const requireAuth = app.requireAuth();
  ensureNoStore(app);

  app.get("/v1/merkle/anchor/requests", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);

    try {
      if (entitlements) {
        await entitlements.requireMerkleAnchor(req, actor);
      }

      const q = (req.query ?? {}) as Record<string, unknown>;
      const query = {
        ...(q.domain != null ? { domain: String(q.domain) } : {}),
        ...(q.proof_date != null ? { proof_date: String(q.proof_date) } : {}),
        ...(q.status != null ? { status: String(q.status) } : {}),
        ...(q.anchor_kind != null ? { anchor_kind: String(q.anchor_kind) } : {}),
        ...(q.payload_type != null ? { payload_type: String(q.payload_type) } : {}),
        ...(q.root_id != null ? { root_id: String(q.root_id) } : {}),
        limit: normalizePositiveInt(q.limit, { min: 1, max: 1000, fallback: 50 }),
        offset: normalizeNonNegativeInt(q.offset, { max: 10_000_000, fallback: 0 }),
        order: q.order != null ? String(q.order) : "DESC",
      };

      const result = await merkleAnchor.listAnchorRequests(query, coreCtx(req, actor));
      return reply.code(200).send({ ok: true, result: shapeAnchorListResult(result) });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.get("/v1/merkle/anchor/requests/:anchorRequestId", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const anchorRequestId = String((req.params as any)?.anchorRequestId ?? "").trim();

    try {
      if (entitlements) {
        await entitlements.requireMerkleAnchor(req, actor);
      }

      const q = (req.query ?? {}) as Record<string, unknown>;
      const query = {
        ...(q.proof_date != null ? { proof_date: String(q.proof_date) } : {}),
      };

      const result = await merkleAnchor.getAnchorRequest(
        anchorRequestId,
        query,
        coreCtx(req, actor)
      );

      const shaped = shapeAnchorDetailResult(result);
      if (!shaped) {
        return reply.code(404).send({
          ok: false,
          error: "not_found",
          message: "Not found",
        });
      }

      return reply.code(200).send({ ok: true, result: shaped });
    } catch (e) {
      throw mapCoreError(e);
    }
  });
};

export { merkleAnchorReadRoutes };
export default merkleAnchorReadRoutes;