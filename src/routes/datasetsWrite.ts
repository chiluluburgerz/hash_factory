// ============================================================================
// File: src/routes/datasetsWrite.ts
// Version: 1.0-hash-factory-datasets-write-routes | 2026-03-04
// Purpose:
//   Fastify "Datasets" WRITE routes for Hash Factory (proxy to Core admin).
//   - tenant_admin OR system admin required.
//   - Strict body object checks, prototype pollution defense, bounded bytes.
//   - Optional service-key mode for admin endpoints (env).
// ============================================================================

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { CoreClientError } from "../core/coreClient.js";
import { DatasetsClient, DatasetsClientError } from "../core/datasetsClient.js";

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
  const raw = process.env.HF_DATASETS_ROUTE_BODY_MAX_BYTES ?? process.env.HTTP_ROUTE_BODY_MAX_BYTES ?? null;
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
  return String(process.env.HF_DATASETS_USE_SERVICE_KEY_FOR_ADMIN ?? "").trim() === "true";
}

function coreCtx(req: FastifyRequest, actor: Actor | null, forWrite: boolean) {
  const base = ctxFromReq(req);
  const hfActor = actorTag(actor);
  const idempotencyKey = forWrite ? idempotencyKeyFromReq(req) : null;

  // Default: pass-through auth so Core is source-of-truth + auditable under the caller.
  // Optional: force service-key mode for admin endpoints (env).
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
  if (err instanceof DatasetsClientError) {
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
    const rp = String((req as any).routerPath ?? "");
    const url = String((req as any).routeOptions?.url ?? "");
    const path = rp || url;
    if (path.startsWith("/admin/datasets")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("vary", "Accept");
    }
    return payload;
  });
}

export type DatasetsWriteRoutesOpts = Readonly<{
  datasets: DatasetsClient;
}>;

const datasetsWriteRoutes: FastifyPluginAsync<DatasetsWriteRoutesOpts> = async (app, opts) => {
  if (!opts?.datasets) throw new Error("datasetsWriteRoutes requires datasets client");
  const datasets = opts.datasets;

  const requireAuth = app.requireAuth();
  ensureNoStore(app);

  app.post("/admin/datasets", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    requireTenantAdminOrSystem(actor);
    const body = requireBodyObject(req);
    try {
      const result = await datasets.upsertDataset(body, coreCtx(req, actor, true));
      reply.code(201).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.post("/admin/datasets/:datasetKey/versions/ingest", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    requireTenantAdminOrSystem(actor);
    const body = requireBodyObject(req);

    const datasetKey = String((req.params as any)?.datasetKey ?? "");
    const q: any = (req as any).query ?? {};
    const allowed = new Set(["setActive"]);
    for (const k of Object.keys(q)) {
      if (!allowed.has(k)) {
        const e: any = new Error("invalid_request");
        e.statusCode = 400;
        e.code = "INVALID_REQUEST";
        e.detail = { message: `Unknown query field: ${k}` };
        throw e;
      }
    }

    try {
      const result = await datasets.ingestVersionFromArtifact(datasetKey, body, { setActive: q.setActive }, coreCtx(req, actor, true));
      reply.code(201).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.post("/admin/datasets/:datasetKey/versions", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    requireTenantAdminOrSystem(actor);
    const body = requireBodyObject(req);
    const datasetKey = String((req.params as any)?.datasetKey ?? "");
    try {
      const result = await datasets.createVersionStrict(datasetKey, body, coreCtx(req, actor, true));
      reply.code(201).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.post("/admin/datasets/:datasetKey/activate", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    requireTenantAdminOrSystem(actor);
    const body = requireBodyObject(req);
    const datasetKey = String((req.params as any)?.datasetKey ?? "");
    try {
      const result = await datasets.activateVersion(datasetKey, body, coreCtx(req, actor, true));
      reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.post("/admin/datasets/:datasetKey/visibility", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    requireTenantAdminOrSystem(actor);
    const body = requireBodyObject(req);
    const datasetKey = String((req.params as any)?.datasetKey ?? "");
    try {
      const result = await datasets.setVisibility(datasetKey, body, coreCtx(req, actor, true));
      reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.post("/admin/datasets/:datasetKey/disabled", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    requireTenantAdminOrSystem(actor);
    const body = requireBodyObject(req);
    const datasetKey = String((req.params as any)?.datasetKey ?? "");
    try {
      const result = await datasets.setDisabled(datasetKey, body, coreCtx(req, actor, true));
      reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.post("/admin/datasets/:datasetKey/hcs", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    requireTenantAdminOrSystem(actor);
    const body = requireBodyObject(req);
    const datasetKey = String((req.params as any)?.datasetKey ?? "");
    try {
      const result = await datasets.attachDatasetHcs(datasetKey, body, coreCtx(req, actor, true));
      reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.post("/admin/datasets/:datasetKey/versions/:version/hcs", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    requireTenantAdminOrSystem(actor);
    const body = requireBodyObject(req);
    const datasetKey = String((req.params as any)?.datasetKey ?? "");
    const version = (req.params as any)?.version;
    try {
      const result = await datasets.attachVersionHcs(datasetKey, version, body, coreCtx(req, actor, true));
      reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.post("/admin/datasets/:datasetKey/publish", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    requireTenantAdminOrSystem(actor);
    const body = requireBodyObject(req);
    const datasetKey = String((req.params as any)?.datasetKey ?? "");
    try {
      const result = await datasets.publishDatasetVersion(datasetKey, body, coreCtx(req, actor, true));
      reply.code(201).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.post("/admin/datasets/versions/:datasetVersionId/unpublish", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    requireTenantAdminOrSystem(actor);
    const body = requireBodyObject(req);
    const datasetVersionId = String((req.params as any)?.datasetVersionId ?? "");
    try {
      const result = await datasets.unpublishDatasetVersion(datasetVersionId, body, coreCtx(req, actor, true));
      reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });
};

export { datasetsWriteRoutes };
export default datasetsWriteRoutes;