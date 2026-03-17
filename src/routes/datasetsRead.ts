// ============================================================================
// File: src/routes/datasetsRead.ts
// Version: 1.0-hash-factory-datasets-read-routes | 2026-03-04
// Purpose:
//   Fastify "Datasets" READ routes for Hash Factory (proxy to Core).
//   - Auth required (HF boundary); pass-through auth to Core (preserve RLS/audit).
//   - Strict query allow-list + bounded pagination.
//   - No-store headers.
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
  scopes?: string[] | string | null;
  api_key_scopes?: string[] | string | null;
  apiKeyScopes?: string[] | string | null;
}>;

function requireActor(req: FastifyRequest): Actor {
  const actor = (req as any).actor ?? null;
  if (actor && typeof actor === "object") return actor as Actor;
  const e: any = new Error("Unauthorized");
  e.statusCode = 401;
  e.code = "AUTH_REQUIRED";
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

function actorTag(actor: Actor | null | undefined): string | null {
  if (!actor) return null;
  const u = actor.user_id ? String(actor.user_id) : "";
  const o = actor.org_id ? String(actor.org_id) : "";
  const r = actor.org_role ? String(actor.org_role) : "";
  if (!u && !o && !r) return null;
  return `u:${u || "?"}|o:${o || "?"}|r:${r || "?"}`;
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

    if (path.startsWith("/datasets") || path.startsWith("/dataset-versions")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("vary", "Accept");
    }

    return payload;
  });
}

export type DatasetsReadRoutesOpts = Readonly<{
  datasets: DatasetsClient;
}>;

const datasetsReadRoutes: FastifyPluginAsync<DatasetsReadRoutesOpts> = async (app, opts) => {
  if (!opts?.datasets) throw new Error("datasetsReadRoutes requires datasets client");
  const datasets = opts.datasets;

  const requireAuth = app.requireAuth();
  ensureNoStore(app);

  app.get("/datasets/metrics", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    try {
      const q: any = (req as any).query ?? {};
      const allowed = new Set(["program"]);
      for (const k of Object.keys(q)) {
        if (!allowed.has(k)) {
          const e: any = new Error("invalid_request");
          e.statusCode = 400;
          e.code = "INVALID_REQUEST";
          e.detail = { message: `Unknown query field: ${k}` };
          throw e;
        }
      }

      const result = await datasets.getMetrics({ program: q.program }, coreCtx(req, actor), { maxRetries: 1 });
      return reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.get("/datasets", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    try {
      const q: any = (req as any).query ?? {};
      const allowed = new Set(["program", "visibility", "owner_user_id", "includeDisabled", "limit", "offset", "orderBy"]);
      for (const k of Object.keys(q)) {
        if (!allowed.has(k)) {
          const e: any = new Error("invalid_request");
          e.statusCode = 400;
          e.code = "INVALID_REQUEST";
          e.detail = { message: `Unknown query field: ${k}` };
          throw e;
        }
      }

      const result = await datasets.listDatasets(q, coreCtx(req, actor), { maxRetries: 1 });
      return reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.get("/dataset-versions/latest", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    try {
      const q: any = (req as any).query ?? {};
      const allowed = new Set(["program", "limit", "offset"]);
      for (const k of Object.keys(q)) {
        if (!allowed.has(k)) {
          const e: any = new Error("invalid_request");
          e.statusCode = 400;
          e.code = "INVALID_REQUEST";
          e.detail = { message: `Unknown query field: ${k}` };
          throw e;
        }
      }

      const result = await datasets.listLatestVersions(q, coreCtx(req, actor), { maxRetries: 1 });
      return reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.get("/datasets/:datasetKey", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    try {
      const key = String((req.params as any)?.datasetKey ?? "");
      const result = await datasets.getDataset(key, coreCtx(req, actor), { maxRetries: 1 });
      return reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.get("/datasets/:datasetKey/manifest/active", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    try {
      const key = String((req.params as any)?.datasetKey ?? "");
      const result = await datasets.getActiveManifest(key, coreCtx(req, actor), { maxRetries: 1 });
      return reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.get("/datasets/:datasetKey/active-version-row", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    try {
      const key = String((req.params as any)?.datasetKey ?? "");
      const result = await datasets.resolveActiveVersionRow(key, coreCtx(req, actor), { maxRetries: 1 });
      return reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });
};

export { datasetsReadRoutes };
export default datasetsReadRoutes;
