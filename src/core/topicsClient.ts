// ============================================================================
// File: src/core/topicsClient.ts
// Version: 1.0-hash-factory-topics-client | 2026-03-04
// Purpose:
//   Hash Factory -> Core "Org Topics" client.
//   - Calls Core tenant HCS topic bootstrap endpoint
//   - Default auth: service key via CoreClient
//   - Optional per-request auth override via CoreRequestCtx (coreAuthHeader/coreApiKey) for pass-through
//   - Strict UUID validation, stable error mapping, response shaping
//
// Notes:
//   - Core remains authoritative for authz via RLS + entitlements.
//   - HF enforces boundary checks before calling admin endpoints.
// ============================================================================

import { CoreClient, CoreClientError, CoreRequestCtx } from "./coreClient.js";

export type JsonObject = Record<string, unknown>;

function readEnvInt(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function stableIdempotencyKey(prefix: string, orgId: string, requestId?: string | null): string {
  const rid = String(requestId ?? "").trim();
  if (rid) return `${prefix}:${orgId}:${rid}`;
  return `${prefix}:${orgId}`;
}

export class TopicsClientError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, opts: { statusCode: number; code: string }) {
    super(message);
    this.name = "TopicsClientError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
  }
}

// ---------------------------------------------------------------------------
// Input guards
// ---------------------------------------------------------------------------

function isUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizeOrgId(orgId: unknown): string {
  const s = String(orgId ?? "").trim();
  if (!isUuid(s)) throw new TopicsClientError("invalid_org_id", { statusCode: 400, code: "INVALID_ORG_ID" });
  return s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function unwrapResult(res: unknown): unknown {
  return (res as any)?.result ?? res;
}

// Shape response to a stable HF contract (allowlist-ish).
// Core returns: { ok, result: { org_id, policy, created, ensured, errors, meta } }
function shapeBootstrapResponse(v: unknown): Record<string, unknown> {
  if (!isPlainObject(v)) {
    throw new TopicsClientError("upstream_contract_error", { statusCode: 502, code: "UPSTREAM_CONTRACT_ERROR" });
  }

  const ok = Boolean((v as any).ok);

  const r = (v as any).result;
  if (!isPlainObject(r)) {
    return { ok, result: {} };
  }

  const out: Record<string, unknown> = {};

  for (const k of ["org_id", "policy", "created", "ensured", "errors", "meta"]) {
    if ((r as any)[k] !== undefined) out[k] = (r as any)[k];
  }

  return { ok, result: out };
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export type TopicsClient = Readonly<{
  bootstrapOrgTopics: (
    orgId: string,
    ctx?: CoreRequestCtx
  ) => Promise<Record<string, unknown>>;
}>;

export function makeCoreTopics(core: CoreClient): TopicsClient {
  if (!core) throw new Error("makeCoreTopics requires core client");

  function mapCoreError(err: unknown): Error {
    if (err instanceof TopicsClientError) return err;

    if (err instanceof CoreClientError) {
      const status = err.status;
      const code = err.code || null;

      if (status === 400) return new TopicsClientError("bad_request", { statusCode: 400, code: code ?? "BAD_REQUEST" });
      if (status === 401) return new TopicsClientError("unauthorized", { statusCode: 401, code: code ?? "AUTH_REQUIRED" });
      if (status === 403) return new TopicsClientError("forbidden", { statusCode: 403, code: code ?? "FORBIDDEN" });
      if (status === 404) return new TopicsClientError("not_found", { statusCode: 404, code: code ?? "NOT_FOUND" });

      return new TopicsClientError("upstream_error", { statusCode: 502, code: code ?? "UPSTREAM_ERROR" });
    }

    return new TopicsClientError("internal_error", { statusCode: 500, code: "INTERNAL_ERROR" });
  }

  async function bootstrapOrgTopics(orgId: string, ctx?: CoreRequestCtx) {
    const oid = normalizeOrgId(orgId);

    try {
      const timeoutMs = readEnvInt("HF_CORE_TOPICS_BOOTSTRAP_TIMEOUT_MS", 120_000, 15_000, 300_000);

      const effectiveCtx: CoreRequestCtx = {
        ...(ctx || {}),
        timeoutMs,
        idempotencyKey: (ctx as any)?.idempotencyKey ?? stableIdempotencyKey("topics_bootstrap", oid, ctx?.requestId ?? null),
      };

      // Core route expects POST and ignores body; keep empty object.
      const res = await core.post<any>(
        `/v1/orgs/${encodeURIComponent(oid)}/hedera/topics/bootstrap`,
        {},
        effectiveCtx,
        { maxRetries: 0 }
      );

      return shapeBootstrapResponse(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  return { bootstrapOrgTopics };
}

export default makeCoreTopics;