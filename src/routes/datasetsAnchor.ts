// ============================================================================
// File: src/routes/datasetsAnchor.ts
// Version: 1.0-hf-datasets-anchor-routes | 2026-03-05
// Purpose:
//   Local-first dataset anchoring routes in HF.
//   - POST /datasets/anchor/plan
//   - POST /datasets/anchor/execute
// Security:
//   - Auth required.
//   - register_and_anchor requires tenant_admin OR system admin.
//   - Strict allowlist body to prevent drift.
//   - No-store responses.
// ============================================================================

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { CoreClientError } from "../core/coreClient.js";
import type { DatasetsClient } from "../core/datasetsClient.js";
import { DatasetsClientError } from "../core/datasetsClient.js";
import { planAnchor } from "../datasets/workflow.js";
import { makeDatasetAnchorOrchestrator } from "../datasets/orchestrator.js";
import {
  DatasetValidationError,
  parseAnchorPlanRequestV1,
  parseAnchorExecuteRequestV1,
  parseDatasetVerifyRequestV1,
} from "../datasets/validators.js";
import {
  verifyDatasetBundle,
  verifyDatasetReceipt,
  verifyDatasetMaterialAgainstReceiptOrBundle,
} from "../datasets/verifier.js";

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
  if (err instanceof DatasetValidationError) {
    const e: any = new Error(err.message || "invalid_request");
    e.statusCode = err.statusCode ?? 400;
    e.code = err.code ?? "SCHEMA_INVALID";
    return e;
  }
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
    if (path.startsWith("/datasets/anchor")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("vary", "Accept");
    }
    return payload;
  });
}

function pickBody(body: Record<string, unknown>, allowed: ReadonlyArray<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  }
  // reject unknown keys (fail-closed)
  const allowedSet = new Set(allowed);
  for (const k of Object.keys(body)) {
    if (!allowedSet.has(k)) {
      const e: any = new Error("invalid_request");
      e.statusCode = 400;
      e.code = "INVALID_REQUEST";
      e.detail = { message: `Unknown body field: ${k}` };
      throw e;
    }
  }
  return out;
}

export type DatasetsAnchorRoutesOpts = Readonly<{
  datasets: DatasetsClient;
}>;

const datasetsAnchorRoutes: FastifyPluginAsync<DatasetsAnchorRoutesOpts> = async (app, opts) => {
  if (!opts?.datasets) throw new Error("datasetsAnchorRoutes requires datasets client");
  const datasets = opts.datasets;
  const orch = makeDatasetAnchorOrchestrator(datasets);

  const requireAuth = app.requireAuth();
  ensureNoStore(app);

  app.post("/datasets/anchor/plan", { preHandler: requireAuth }, async (req, reply) => {
    if (reply.sent) return reply;
    requireActor(req); // auth only
    const body = requireBodyObject(req);

    try {
      const picked = pickBody(body, ["mode", "identity", "rules"]);
      const parsed = parseAnchorPlanRequestV1(picked);
      const result = planAnchor(parsed);
      return reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.post("/datasets/anchor/execute", { preHandler: requireAuth }, async (req, reply) => {
    if (reply.sent) return reply;
    const actor = requireActor(req);
    const body = requireBodyObject(req);

    const picked = pickBody(body, [
      "mode",
      "identity",
      "root_dir",
      "rules",
      "display_name",
      "metadata",
      "evidence_pointer",
      "set_active",
    ]);

    try {
      const parsed = parseAnchorExecuteRequestV1(picked);
      if (parsed.mode === "register_and_anchor") {
        requireTenantAdminOrSystem(actor);
      }

      const result = await orch.execute(parsed, coreCtx(req, actor));
      return reply.code(200).send({ ok: true, result });
    } catch (e) {
      throw mapCoreError(e);
    }
  });

  app.post("/datasets/anchor/verify", { preHandler: requireAuth }, async (req, reply) => {
    if (reply.sent) return reply;
    requireActor(req); // authenticated verifier usage for now
    const body = requireBodyObject(req);

    try {
      const parsed = parseDatasetVerifyRequestV1(body);

      const receipt_verify = parsed.receipt ? verifyDatasetReceipt(parsed.receipt) : null;
      const bundle_verify = parsed.bundle ? verifyDatasetBundle(parsed.bundle) : null;
      const local_verify =
        parsed.root_dir
          ? await verifyDatasetMaterialAgainstReceiptOrBundle({
              ...(parsed.receipt ? { receipt: parsed.receipt } : {}),
              ...(parsed.bundle ? { bundle: parsed.bundle } : {}),
              root_dir: parsed.root_dir,
            })
          : null;

      const ok = Boolean(
        (receipt_verify ? receipt_verify.ok : true) &&
        (bundle_verify ? bundle_verify.ok : true) &&
        (local_verify ? local_verify.ok : true)
      );

      return reply.code(200).send({
        ok,
        result: {
          ...(receipt_verify ? { receipt_verify } : {}),
          ...(bundle_verify ? { bundle_verify } : {}),
          ...(local_verify ? { local_verify } : {}),
        },
      });
    } catch (e) {
      throw mapCoreError(e);
    }
  });
};

export { datasetsAnchorRoutes };
export default datasetsAnchorRoutes;