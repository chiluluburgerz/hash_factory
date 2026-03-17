// ============================================================================
// File: src/core/coreClient.ts
// Version: 1.4-hash-factory-core-client-pass-through-hardened | 2026-03-12
// Purpose:
//   Minimal, disciplined HTTP client for Hash Factory -> Core Backend.
//   - Service-to-service auth via CORE_SERVICE_API_KEY
//   - Optional strict pass-through auth requirement per request
//   - Propagates request correlation ids
//   - Strict timeouts
//   - No retries by default (callers opt-in for safe GETs only)
// Changes (v1.4):
//   - Adds requirePassThroughAuth gate for user-bound gateway calls
//   - Treats 2xx non-JSON / invalid JSON upstream responses as invalid upstream
//   - Preserves service-key fallback for internal flows that do not require pass-through
// ============================================================================

type Json = Record<string, unknown>;
type AnyResponse = any;
type TimeoutHandle = ReturnType<typeof setTimeout>;

export type CoreClientOpts = {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRetries?: number;
};

export type CoreCallLogLine = Readonly<{
  hf_req_id: string | null;
  hf_actor: string | null;
  core_path: string;
  core_method: string;
  core_status: number;
  core_request_id: string | null;
  attempt: number;
}>;

export type CoreRequestCtx = Readonly<{
  requestId?: string | null;
  clientRequestId?: string | null;
  idempotencyKey?: string | null;
  coreAuthHeader?: string | null;
  coreApiKey?: string | null;
  coreExtraHeaders?: Record<string, string> | null;

  // Optional per-request timeout overrides (ms). Use only for known slow endpoints.
  timeoutMs?: number | null;

  // When true, the request MUST carry caller auth via coreAuthHeader or coreApiKey.
  // This is intended for user-bound HF -> Core gateway paths.
  requirePassThroughAuth?: boolean | null;

  onCoreCall?: (line: CoreCallLogLine) => void;
  hfActor?: string | null;
}>;

type ParsedBody =
  | { kind: "json"; value: any }
  | { kind: "non_json"; text: string }
  | { kind: "empty" }
  | { kind: "invalid_json"; text: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export class CoreClientError extends Error {
  status: number;
  code?: string | null;
  requestId?: string | null;
  payload?: any;
  detail?: unknown;

  constructor(message: string, opts: { status: number; code?: string | null; payload?: any }) {
    super(message);
    this.name = "CoreClientError";
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.requestId = opts?.payload?.request_id ?? null;
    this.payload = opts.payload;
    this.detail =
      opts?.payload?.detail ??
      opts?.payload?.details ??
      null;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  const b = String(baseUrl || "").replace(/\/+$/, "");
  const p = String(path || "").replace(/^\/+/, "");
  return `${b}/${p}`;
}

async function readTextBounded(res: AnyResponse, maxBytes: number): Promise<string> {
  const lim = Math.max(1024, Math.min(Number(maxBytes || 0) || 256_000, 10_000_000));
  const body: any = (res as any)?.body;

  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.length) {
          const remaining = lim - total;
          if (remaining <= 0) break;
          if (value.length <= remaining) {
            chunks.push(value);
            total += value.length;
          } else {
            chunks.push(value.subarray(0, remaining));
            total += remaining;
            break;
          }
        }
      }
    } catch {
      // ignore stream errors, best-effort
    } finally {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
    }
    return Buffer.concat(chunks.map((u) => Buffer.from(u)), total).toString("utf8");
  }

  const txt = await res.text().catch(() => "");
  if (!txt) return "";
  return txt.length > lim ? txt.slice(0, lim) : txt;
}

async function readBodyParsed(res: AnyResponse, maxBytes: number): Promise<ParsedBody> {
  const ct = String(res.headers.get("content-type") || "").toLowerCase();
  const raw = await readTextBounded(res, maxBytes);

  if (!raw) {
    return { kind: "empty" };
  }

  if (!ct.includes("application/json")) {
    return { kind: "non_json", text: raw?.slice?.(0, 500) ?? "" };
  }

  try {
    return { kind: "json", value: JSON.parse(raw) };
  } catch {
    return { kind: "invalid_json", text: raw?.slice?.(0, 500) ?? "" };
  }
}

export class CoreClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;
  private maxResponseBytes: number;
  private maxRetries: number;

  constructor(opts: CoreClientOpts) {
    if (!opts?.baseUrl) throw new Error("CoreClient: baseUrl is required");
    if (!opts?.apiKey) throw new Error("CoreClient: apiKey is required");

    this.baseUrl = String(opts.baseUrl);
    this.apiKey = String(opts.apiKey).trim();
    this.timeoutMs = Math.max(500, Number(opts.timeoutMs ?? 10_000));
    this.maxResponseBytes = Math.max(1024, Math.min(Number(opts.maxResponseBytes ?? 256_000), 10_000_000));
    this.maxRetries = Math.max(0, Math.min(Number(opts.maxRetries ?? 0), 5));
  }

  private effectiveTimeoutMs(ctx?: CoreRequestCtx): number {
    const raw = ctx?.timeoutMs;
    if (raw == null) return this.timeoutMs;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(500, Math.trunc(n)) : this.timeoutMs;
  }

  private async _request<T = any>(args: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
    path: string;
    body?: Json | null;
    ctx?: CoreRequestCtx | undefined;
    retry?: { maxRetries?: number } | null | undefined;
  }): Promise<T> {
    const url = joinUrl(this.baseUrl, args.path);
    const method = args.method;

    const maxRetries =
      args?.retry?.maxRetries != null ? Math.max(0, Math.min(args.retry.maxRetries, 5)) : this.maxRetries;

    const canRetry =
      method === "GET" ||
      method === "HEAD" ||
      ((method === "POST" || method === "PUT" || method === "PATCH") && Boolean(args?.ctx?.idempotencyKey));

    const attempts = canRetry ? 1 + maxRetries : 1;

    let lastErr: any = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const timeoutMs = this.effectiveTimeoutMs(args.ctx);
      const tTotal: TimeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const hasPassThroughHeader = isNonEmptyString(args?.ctx?.coreAuthHeader);
        const hasPassThroughApiKey = isNonEmptyString(args?.ctx?.coreApiKey);

        if (args?.ctx?.requirePassThroughAuth === true && !hasPassThroughHeader && !hasPassThroughApiKey) {
          throw new CoreClientError("pass_through_auth_required", {
            status: 401,
            code: "PASS_THROUGH_AUTH_REQUIRED",
            payload: { request_id: null },
          });
        }

        const authHeader =
          hasPassThroughHeader
            ? String(args!.ctx!.coreAuthHeader).trim()
            : hasPassThroughApiKey
              ? `Bearer ${String(args!.ctx!.coreApiKey).trim()}`
              : `Bearer ${this.apiKey}`;

        const headers: Record<string, string> = {
          accept: "application/json",
          authorization: authHeader,
          ...(args?.ctx?.requestId ? { "x-request-id": String(args.ctx.requestId) } : {}),
          ...(args?.ctx?.clientRequestId ? { "x-client-request-id": String(args.ctx.clientRequestId) } : {}),
          ...(args?.ctx?.idempotencyKey ? { "idempotency-key": String(args.ctx.idempotencyKey) } : {}),
          ...(args?.ctx?.coreExtraHeaders && typeof args.ctx.coreExtraHeaders === "object"
            ? args.ctx.coreExtraHeaders
            : {}),
        };

         if (method === "POST" || method === "PUT" || method === "PATCH") {
          headers["content-type"] = "application/json";
        }

        const init: RequestInit = {
          method,
          headers,
          signal: controller.signal,
        };

        if (method === "POST" || method === "PUT" || method === "PATCH") {
          init.body = JSON.stringify(args.body ?? {});
        }

        const res: AnyResponse = await fetch(url, init);
        const parsed = await readBodyParsed(res, this.maxResponseBytes);

        const payload =
          parsed.kind === "json"
            ? parsed.value
            : parsed.kind === "empty"
              ? {}
            : parsed.kind === "non_json"
              ? { error: "non_json_response", message: parsed.text }
              : { error: "invalid_json", message: parsed.text };

        const coreReqId =
          (payload && typeof payload === "object" && (payload as any).request_id) ||
          res.headers.get("x-request-id") ||
          null;

        args?.ctx?.onCoreCall?.({
          hf_req_id: args?.ctx?.requestId ?? null,
          hf_actor: args?.ctx?.hfActor ?? null,
          core_path: args.path,
          core_method: method,
          core_status: res.status,
          core_request_id: coreReqId ? String(coreReqId) : null,
          attempt,
        });

        if (!res.ok) {
          const msg = (payload as any)?.message || (payload as any)?.error || `core_http_${res.status}`;
          throw new CoreClientError(String(msg), {
            status: res.status,
            code: (payload as any)?.code ?? null,
            payload,
          });
        }

        if (parsed.kind !== "json" && parsed.kind !== "empty") {
          throw new CoreClientError("core_invalid_response", {
            status: 502,
            code: parsed.kind === "non_json" ? "UPSTREAM_NON_JSON" : "UPSTREAM_INVALID_JSON",
            payload,
          });
        }

        return payload as T;
      } catch (e: any) {
        lastErr = e;

        if (e?.name === "AbortError") {
          const err = new CoreClientError("core_timeout", {
            status: 504,
            code: "CORE_TIMEOUT",
            payload: {
              request_id: null,
              detail: { timeout_ms: timeoutMs },
            },
          });
          args?.ctx?.onCoreCall?.({
            hf_req_id: args?.ctx?.requestId ?? null,
            hf_actor: args?.ctx?.hfActor ?? null,
            core_path: args.path,
            core_method: method,
            core_status: 504,
            core_request_id: null,
            attempt,
          });
          lastErr = err;
        } else if (!(e instanceof CoreClientError)) {
          const err = new CoreClientError(e?.message || "core_unreachable", {
            status: 502,
            code: "CORE_UNREACHABLE",
            payload: { request_id: null },
          });
          args?.ctx?.onCoreCall?.({
            hf_req_id: args?.ctx?.requestId ?? null,
            hf_actor: args?.ctx?.hfActor ?? null,
            core_path: args.path,
            core_method: method,
            core_status: 502,
            core_request_id: null,
            attempt,
          });
          lastErr = err;
        }

        if (attempt < attempts) {
          const status = lastErr instanceof CoreClientError ? lastErr.status : 0;
          const retryable = status === 502 || status === 503 || status === 504;
          if (retryable) {
            const delayMs = 250 * Math.pow(2, attempt - 1);
            await new Promise((r) => setTimeout(r, delayMs));
            continue;
          }
        }

        throw lastErr;
      } finally {
        clearTimeout(tTotal);
      }
    }

    throw lastErr ?? new CoreClientError("core_unreachable", { status: 502, payload: { request_id: null } });
  }

  async get<T = any>(path: string, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null): Promise<T> {
    const args: any = { method: "GET", path };
    if (ctx != null) args.ctx = ctx;
    if (retry != null) args.retry = retry;
    return this._request<T>(args);
  }

  async delete<T = any>(
    path: string,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<T> {
    const args: any = { method: "DELETE", path };
    if (ctx != null) args.ctx = ctx;
    if (retry != null) args.retry = retry;
    return this._request<T>(args);
  }

  async post<T = any>(
    path: string,
    body: Json,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<T> {
    const args: any = { method: "POST", path, body };
    if (ctx != null) args.ctx = ctx;
    if (retry != null) args.retry = retry;
    return this._request<T>(args);
  }

  async patch<T = any>(
    path: string,
    body: Json,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<T> {
    const args: any = { method: "PATCH", path, body };
    if (ctx != null) args.ctx = ctx;
    if (retry != null) args.retry = retry;
    return this._request<T>(args);
  }

  async put<T = any>(
    path: string,
    body: Json,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<T> {
    const args: any = { method: "PUT", path, body };
    if (ctx != null) args.ctx = ctx;
    if (retry != null) args.retry = retry;
    return this._request<T>(args);
  }
}

export function makeCoreOnboarding(core: CoreClient) {
  return {
    checkEmail: (email: string, ctx?: CoreRequestCtx) =>
      core.post("/v1/onboarding/email/check", { email }, ctx),

    createOrg: (payload: Json, ctx?: CoreRequestCtx) =>
      core.post("/v1/onboarding/orgs", payload, ctx, { maxRetries: 0 }),

    addMember: (orgId: string, payload: Json, ctx?: CoreRequestCtx) =>
      core.post(`/v1/onboarding/orgs/${encodeURIComponent(orgId)}/members`, payload, ctx, { maxRetries: 0 }),
  };
}