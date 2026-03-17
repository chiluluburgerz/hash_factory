// ============================================================================
// File: src/routes/merkleAnchorWrite.ts
// Version: 1.1-hash-factory-merkle-anchor-write-routes-shaped-timeouts | 2026-03-15
// Purpose:
//   Fastify "Merkle Anchor" WRITE routes for Hash Factory (proxy to Core).
//   - /v1/merkle/anchor
//   - /v1/merkle/anchor/root
// Security:
//   - Auth required
//   - tenant_admin OR system admin required for root anchor
//   - strict body object checks, prototype-pollution defense, bounded bytes
//   - optional service-key mode for admin-ish core calls (env)
// Notes:
//   - Core remains source-of-truth for scopes, entitlements, domain/org checks,
//     and topic routing.
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

function requireTenantAdminOrSystem(actor: Actor) {
  if (isSystemAdmin(actor) || isTenantAdmin(actor)) return;
  const e: any = new Error("Forbidden");
  e.statusCode = 403;
  e.code = "TENANT_ADMIN_REQUIRED";
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
    process.env.HF_MERKLE_ROUTE_BODY_MAX_BYTES ??
    process.env.HTTP_ROUTE_BODY_MAX_BYTES ??
    null;
  const def = 950_000;
  if (raw == null || raw === "") return def;
  const v = toInt(raw, def);
  return Math.max(256, Math.min(10_000_000, v));
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

function requireTrustedRootId(body: Record<string, unknown>) {
  const rootId = String(body?.rootId ?? "").trim();
  if (rootId) return;

  const e: any = new Error("invalid_request");
  e.statusCode = 400;
  e.code = "INVALID_REQUEST";
  e.detail = { message: "rootId is required for trusted HF root anchor" };
  throw e;
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

function idempotencyKeyFromReq(req: FastifyRequest): string | null {
  const h = (req.headers as any) || {};
  const raw = h["idempotency-key"] ?? h["x-idempotency-key"] ?? null;
  if (raw == null) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > 256 ? s.slice(0, 256) : s;
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

function shouldUseServiceKeyForAdmin(): boolean {
  return String(process.env.HF_MERKLE_USE_SERVICE_KEY_FOR_ADMIN ?? "").trim() === "true";
}

function coreCtx(req: FastifyRequest, actor: Actor | null, forWrite: boolean) {
  const base = ctxFromReq(req);
  const hfActor = actorTag(actor);
  const idempotencyKey = forWrite ? idempotencyKeyFromReq(req) : null;

  const passThroughAuth = !shouldUseServiceKeyForAdmin();
  const coreAuthHeader = passThroughAuth ? extractIncomingAuthHeader(req) : null;

  return {
    ...base,
    ...(idempotencyKey ? { idempotencyKey } : {}),
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

function shapeAnchor(anchorLike: unknown): Record<string, unknown> | null {
  return pick(asPlainObject(anchorLike), [
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
    "published_at",
    "confirmed_at",
    "created_at",
    "updated_at",
  ]);
}

function shapeLeaf(leafLike: unknown): Record<string, unknown> | null {
  return pick(asPlainObject(leafLike), ["leaf_id", "leaf_hash"]);
}

function shapePublish(publishLike: unknown, anchorLike?: unknown): Record<string, unknown> | null {
  const publish = asPlainObject(publishLike);
  const anchor = asPlainObject(anchorLike);

  const topic_key = publish?.topic_key ?? null;
  const topic_id =
    publish?.topicId ??
    publish?.topic_id ??
    anchor?.hcs_topic_id ??
    null;
  const sequence_number =
    publish?.sequenceNumber ??
    publish?.sequence_number ??
    null;
  const transaction_id =
    publish?.transactionId ??
    publish?.transaction_id ??
    anchor?.hcs_transaction_id ??
    null;
  const message_id =
    publish?.messageId ??
    publish?.message_id ??
    anchor?.hcs_message_id ??
    null;

  if (!topic_key && !topic_id && !transaction_id && !message_id) return null;

  return {
    ...(topic_key ? { topic_key } : {}),
    ...(topic_id ? { topic_id } : {}),
    ...(sequence_number != null ? { sequence_number } : {}),
    ...(transaction_id ? { transaction_id } : {}),
    ...(message_id ? { message_id } : {}),
  };
}

function shapeCertificate(certLike: unknown): Record<string, unknown> | null {
  const cert = asPlainObject(certLike);
  if (!cert) return null;

  const nested = asPlainObject(cert.certificate);
  const nft = asPlainObject(nested?.nft);
  const token = asPlainObject(nested?.token);
  const certificate = asPlainObject(nested?.certificate);

  return {
    attempted: Boolean(cert.attempted),
    skipped: Boolean(cert.skipped),
    issued: Boolean(cert.issued),
    deduped: Boolean(cert.deduped),
    reason:
      cert.reason ??
      nested?.reason ??
      null,
    nft: pick(nft, [
      "id",
      "nft_id",
      "token_id",
      "serial_number",
      "wallet_address",
      "status",
      "proof_date",
      "minted_at",
      "hcs_topic_id",
      "hcs_transaction_id",
      "hts_transaction_id",
    ]),
    token: pick(token, [
      "id",
      "token_id",
      "purpose",
      "symbol",
      "name",
    ]),
    certificate: pick(certificate, [
      "nft_id",
      "certificate_kind",
      "token_purpose",
      "proof_date",
      "payload_hash",
      "identity_hash",
      "compact_metadata",
    ]),
  };
}

function shapePublicPublish(resultLike: unknown): Record<string, unknown> | null {
  const result = asPlainObject(resultLike);
  if (!result) return null;
  const meta = asPlainObject(result.meta);
  return {
    ...(pick(result, [
      "id",
      "org_id",
      "entity_kind",
      "entity_id",
      "proof_date",
      "visibility",
      "share_token",
      "published_at",
      "published_by",
    ]) ?? {}),
    ...(meta
      ? {
          meta: pick(meta, [
            "domain",
            "source",
            "root_id",
            "root_hash",
            "anchor_hash",
            "anchor_kind",
          ]),
        }
      : {}),
  };
}

function shapeAnchorResult(resultLike: unknown): Record<string, unknown> {
  const result = asPlainObject(resultLike) ?? {};
  const anchor = asPlainObject(result.anchor);
  return {
    ok: Boolean(result.ok),
    deduped: Boolean(result.deduped),
    queued_only: Boolean(result.queued_only),
    anchor: shapeAnchor(result.anchor),
    leaf: shapeLeaf(result.leaf),
    publish: shapePublish(result.publish, anchor),
    certificate: shapeCertificate(result.certificate),
  };
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

export type MerkleAnchorWriteRoutesOpts = Readonly<{
  merkleAnchor: MerkleAnchorClient;
  entitlements?: HfEntitlements | null;
}>;

const merkleAnchorWriteRoutes: FastifyPluginAsync<MerkleAnchorWriteRoutesOpts> = async (app, opts) => {
  if (!opts?.merkleAnchor) throw new Error("merkleAnchorWriteRoutes requires merkleAnchor client");
  const merkleAnchor = opts.merkleAnchor;
  const entitlements = opts.entitlements ?? null;

  const requireAuth = app.requireAuth();
  ensureNoStore(app);

  app.post("/v1/merkle/anchor", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const body = requireBodyObject(req);
    try {
      if (entitlements) {
        await entitlements.requireMerkleAnchor(req, actor);
      }

      const result = await merkleAnchor.anchorPayload(body, coreCtx(req, actor, true));
      const deduped = Boolean((result as any)?.deduped);
      return reply.code(deduped ? 200 : 201).send({ ok: true, result: shapeAnchorResult(result) });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  // HF merkle root write is certificate-eligible trusted flow.
  app.post("/v1/merkle/anchor/root", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    requireTenantAdminOrSystem(actor);
    const body = requireBodyObject(req);

    try {
      requireTrustedRootId(body);
      if (entitlements) {
        await entitlements.requireMerkleAnchor(req, actor);
        await entitlements.requireMerkleRootAnchor(req, actor);
      }

      const result = await merkleAnchor.requestRootAnchor(
        body,
        coreCtx(req, actor, true)
      );

      const deduped = Boolean((result as any)?.deduped);
      return reply.code(deduped ? 200 : 201).send({ ok: true, result: shapeAnchorResult(result) });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.post("/v1/merkle/anchor/requests/:anchorRequestId/publish", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    requireTenantAdminOrSystem(actor);
    const body = requireBodyObject(req);
    const anchorRequestId = String((req.params as any)?.anchorRequestId ?? "");
    try {
      if (entitlements) {
        await entitlements.requireMerkleAnchor(req, actor);
        await entitlements.requireMerkleRootAnchor(req, actor);
      }

      const result = await merkleAnchor.publishExistingAnchorRequest(
        anchorRequestId,
        body,
        coreCtx(req, actor, true)
      );
      return reply.code(200).send({ ok: true, result: shapeAnchorResult(result) });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.post("/v1/merkle/anchor/requests/:anchorRequestId/public/publish", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    requireTenantAdminOrSystem(actor);
    const body = requireBodyObject(req);
    const anchorRequestId = String((req.params as any)?.anchorRequestId ?? "");
    try {
      if (entitlements) {
        await entitlements.requireMerkleAnchor(req, actor);
      }

      const result = await merkleAnchor.publishAnchorRequestPublic(
        anchorRequestId,
        body,
        coreCtx(req, actor, true)
      );
      return reply.code(201).send({ ok: true, result: shapePublicPublish(result) });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.post("/v1/merkle/anchor/requests/:anchorRequestId/public/unpublish", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    requireTenantAdminOrSystem(actor);
    const body = requireBodyObject(req);
    const anchorRequestId = String((req.params as any)?.anchorRequestId ?? "");
    try {
      if (entitlements) {
        await entitlements.requireMerkleAnchor(req, actor);
      }

      const result = await merkleAnchor.unpublishAnchorRequestPublic(
        anchorRequestId,
        body,
        coreCtx(req, actor, true)
      );
      return reply.code(200).send({ ok: true, result: shapePublicPublish(result) });
    } catch (e) {
      throw mapCoreError(e);
    }
  });
};

export { merkleAnchorWriteRoutes };
export default merkleAnchorWriteRoutes;