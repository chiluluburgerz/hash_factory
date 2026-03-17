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
  parseAnchorSubmitRequestV1
} from "../datasets/validators.js";
import {
  verifyDatasetBundle,
  verifyDatasetReceipt,
  verifyDatasetMaterialAgainstReceiptOrBundle,
} from "../datasets/verifier.js";
import { buildGatewayCtx } from "../lib/gateway/requestContext.js";
import type HfEntitlements from "../lib/entitlements/hfOrgEntitlements.js";
import { HfEntitlementError } from "../lib/entitlements/hfEntitlementErrors.js";

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

function errorMeta(err: unknown) {
  const e = err as any;
  return {
    name: e?.name ?? "Error",
    message: e?.message ?? String(err),
    code: e?.code ?? null,
    statusCode: e?.statusCode ?? null,
    detail: e?.detail ?? e?.upstream_detail ?? null,
    upstream_request_id: e?.upstream_request_id ?? null,
    stack: typeof e?.stack === "string" ? e.stack : null,
  };
}

function requestSummary(body: Record<string, unknown>) {
  return {
    mode: body?.mode ?? null,
    dataset_key: (body?.identity as any)?.dataset_key ?? null,
    program: (body?.identity as any)?.program ?? null,
    version_label: (body?.identity as any)?.version_label ?? null,
    has_root_dir: Boolean(String((body as any)?.root_dir ?? "").trim()),
    has_evidence: Boolean((body as any)?.evidence && typeof (body as any)?.evidence === "object"),
    has_evidence_pointer: Boolean(String((body as any)?.evidence_pointer ?? "").trim()),
    publish_visibility: (body as any)?.publish_visibility ?? null,
    set_active: (body as any)?.set_active ?? null,
  };
}

function mapCoreError(err: unknown): Error {
  if (err instanceof HfEntitlementError) {
    const e: any = new Error(err.message || "forbidden");
    e.statusCode = err.statusCode;
    e.code = err.code;
    if (err.detail !== undefined) e.detail = err.detail;
    return e;
  }

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

  const raw: any = err as any;
  const e: any = new Error(raw?.message || "internal_error");
  e.statusCode =
    Number(raw?.statusCode) >= 400 && Number(raw?.statusCode) <= 599
      ? Number(raw.statusCode)
      : 500;
  e.code = raw?.code || "INTERNAL_ERROR";
  if (raw?.detail !== undefined) e.detail = raw.detail;
  if (raw?.upstream_detail !== undefined) e.upstream_detail = raw.upstream_detail;
  if (raw?.upstream_request_id !== undefined) e.upstream_request_id = raw.upstream_request_id;
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
  entitlements?: HfEntitlements | null;
}>;

const datasetsAnchorRoutes: FastifyPluginAsync<DatasetsAnchorRoutesOpts> = async (app, opts) => {
  if (!opts?.datasets) throw new Error("datasetsAnchorRoutes requires datasets client");
  const datasets = opts.datasets;
  const entitlements = opts.entitlements ?? null;
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

    req.log.info(
      {
        event: "datasets_anchor_execute_received",
        actor: {
          user_id: actor?.user_id ?? null,
          org_id: actor?.org_id ?? null,
          org_role: actor?.org_role ?? null,
          is_system_admin: Boolean(actor?.is_system_admin),
        },
        request: requestSummary(body),
        has_authorization: Boolean(req.headers.authorization),
        has_x_api_key: Boolean((req.headers as any)["x-api-key"]),
      },
      "datasets_anchor_execute_received"
    );

    const picked = pickBody(body, [
      "mode",
      "identity",
      "root_dir",
      "rules",
      "display_name",
      "metadata",
      "evidence_pointer",
      "publish_visibility",
      "set_active",
    ]);

    try {
      const parsed = parseAnchorExecuteRequestV1(picked);

      req.log.info(
        {
          event: "datasets_anchor_execute_parsed",
          request: requestSummary(parsed as any),
        },
        "datasets_anchor_execute_parsed"
      );

      if (parsed.mode === "register_and_anchor") {
        requireTenantAdminOrSystem(actor);

        if (entitlements) {
          await entitlements.requireDatasetAnchor(req, actor);
          await entitlements.requireDatasetIngest(req, actor);
        }
      }

      const ctx = buildGatewayCtx(req, actor, {
        forWrite: parsed.mode === "register_and_anchor",
        requirePassThroughAuth: parsed.mode === "register_and_anchor",
      });

      req.log.info(
        {
          event: "datasets_anchor_execute_ctx_built",
          has_core_auth_header: Boolean((ctx as any)?.coreAuthHeader),
          has_hf_actor: Boolean((ctx as any)?.hfActor),
          has_idempotency_key: Boolean((ctx as any)?.idempotencyKey),
        },
        "datasets_anchor_execute_ctx_built"
      );

      const result = await orch.executeServerLocal(parsed, ctx);

      req.log.info(
        {
          event: "datasets_anchor_execute_succeeded",
          dataset_key: result?.evidence?.dataset_key ?? null,
          mode: result?.mode ?? null,
          reused: Boolean((result as any)?.core?.replay?.reused),
          replay: Boolean((result as any)?.core?.replay?.replay),
          replay_reason: (result as any)?.core?.replay?.replay_reason ?? null,
        },
        "datasets_anchor_execute_succeeded"
      );

      return reply.code(200).send({ ok: true, result });
    } catch (err) {
      const mapped = mapCoreError(err) as any;

      req.log.error(
        {
          event: "datasets_anchor_execute_failed",
          request: requestSummary(picked),
          error: errorMeta(err),
          mapped: errorMeta(mapped),
        },
        "datasets_anchor_execute_failed"
      );

      return reply.code(mapped.statusCode || 500).send({
        ok: false,
        error: mapped.code || "INTERNAL_ERROR",
        message: mapped.message || "Request failed",
        detail: mapped.detail ?? mapped.upstream_detail ?? null,
        upstream_request_id: mapped.upstream_request_id ?? null,
      });
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

  app.post("/datasets/anchor/submit", { preHandler: requireAuth }, async (req, reply) => {
    if (reply.sent) return reply;

    const actor = requireActor(req);
    const body = requireBodyObject(req);

    req.log.info(
      {
        event: "datasets_anchor_submit_received",
        actor: {
          user_id: actor?.user_id ?? null,
          org_id: actor?.org_id ?? null,
          org_role: actor?.org_role ?? null,
          is_system_admin: Boolean(actor?.is_system_admin),
        },
        request: requestSummary(body),
        has_authorization: Boolean(req.headers.authorization),
        has_x_api_key: Boolean((req.headers as any)["x-api-key"]),
      },
      "datasets_anchor_submit_received"
    );

    const picked = pickBody(body, [
      "mode",
      "identity",
      "evidence",
      "display_name",
      "metadata",
      "evidence_pointer",
      "publish_visibility",
      "set_active",
    ]);

    try {
      const parsed = parseAnchorSubmitRequestV1(picked);

      requireTenantAdminOrSystem(actor);

      if (entitlements) {
        await entitlements.requireDatasetAnchor(req, actor);
        await entitlements.requireDatasetIngest(req, actor);
      }

      const ctx = buildGatewayCtx(req, actor, {
        forWrite: true,
        requirePassThroughAuth: true,
      });

      const result = await orch.submit(parsed, ctx);

      req.log.info(
        {
          event: "datasets_anchor_submit_succeeded",
          dataset_key: result?.evidence?.dataset_key ?? null,
          mode: result?.mode ?? null,
          reused: Boolean((result as any)?.core?.replay?.reused),
          replay: Boolean((result as any)?.core?.replay?.replay),
          replay_reason: (result as any)?.core?.replay?.replay_reason ?? null,
        },
        "datasets_anchor_submit_succeeded"
      );

      return reply.code(200).send({ ok: true, result });
    } catch (err) {
      const mapped = mapCoreError(err) as any;

      req.log.error(
        {
          event: "datasets_anchor_submit_failed",
          request: requestSummary(picked),
          error: errorMeta(err),
          mapped: errorMeta(mapped),
        },
        "datasets_anchor_submit_failed"
      );

      return reply.code(mapped.statusCode || 500).send({
        ok: false,
        error: mapped.code || "INTERNAL_ERROR",
        message: mapped.message || "Request failed",
        detail: mapped.detail ?? mapped.upstream_detail ?? null,
        upstream_request_id: mapped.upstream_request_id ?? null,
      });
    }
  });
};

export { datasetsAnchorRoutes };
export default datasetsAnchorRoutes;