// ============================================================================
// File: src/core/coreClient.ts
// Version: 1.1-hash-factory-core-client | 2026-02-18
// Purpose:
//   Minimal, disciplined HTTP client for Hash Factory -> Core Backend.
//   - Service-to-service auth via CORE_SERVICE_API_KEY
//   - Propagates request correlation ids
//   - Strict timeouts
//   - No retries by default (callers opt-in for safe GETs only)
// V1.1: added optional retry config per call with safe defaults and caps.
// ============================================================================

type Json = Record<string, unknown>;

type AnyResponse = any;
type TimeoutHandle = ReturnType<typeof setTimeout>;

export type CoreClientOpts = {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  connectTimeoutMs?: number;
  maxResponseBytes?: number;
  maxRetries?: number;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export class CoreClientError extends Error {
  status: number;
  code?: string | null;
  requestId?: string | null;
  payload?: any;

  constructor(message: string, opts: { status: number; code?: string | null; payload?: any }) {
    super(message);
    this.name = "CoreClientError";
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.requestId = opts?.payload?.request_id ?? null;
    this.payload = opts.payload;
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

  // Node 18+ fetch returns a web ReadableStream
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
  // Fallback: clip after read.
  const txt = await res.text().catch(() => "");
  if (!txt) return "";
  return txt.length > lim ? txt.slice(0, lim) : txt;
}

async function readJsonSafe(res: AnyResponse, maxBytes: number): Promise<any> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    const txt = await readTextBounded(res, maxBytes);
    return { error: "non_json_response", message: txt?.slice?.(0, 500) ?? "" };
  }
  const raw = await readTextBounded(res, maxBytes);
  try {
    return JSON.parse(raw);
  } catch {
    return { error: "invalid_json" };
  }
}

export class CoreClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;
  private connectTimeoutMs: number;
  private maxResponseBytes: number;
  private maxRetries: number;

  constructor(opts: CoreClientOpts) {
    if (!opts?.baseUrl) throw new Error("CoreClient: baseUrl is required");
    if (!opts?.apiKey) throw new Error("CoreClient: apiKey is required");

    this.baseUrl = String(opts.baseUrl);
    this.apiKey = String(opts.apiKey).trim();
    this.timeoutMs = Math.max(500, Number(opts.timeoutMs ?? 10_000));
    this.connectTimeoutMs = Math.max(250, Number(opts.connectTimeoutMs ?? 2_500));
    this.maxResponseBytes = Math.max(1024, Math.min(Number(opts.maxResponseBytes ?? 256_000), 10_000_000));
    this.maxRetries = Math.max(0, Math.min(Number(opts.maxRetries ?? 0), 5));
  }

  private async _request<T = any>(args: {
    method: "GET" | "POST" | "HEAD";
    path: string;
    body?: Json | null;
    ctx?: {
      requestId?: string | null;
      clientRequestId?: string | null;
      idempotencyKey?: string | null;
      // Override auth per request (used for user pass-through). If set, replaces service key.
      // Provide either:
      //   - coreAuthHeader: full value, e.g. "Bearer <token>"
      //   - coreApiKey: secret only; will be used as "Bearer <coreApiKey>"
      coreAuthHeader?: string | null;
      coreApiKey?: string | null;
      // If provided, this gets called exactly once per attempt (success or error).
      // Use it in HF routes to emit the single “core_call” structured line.
      onCoreCall?: (line: {
        hf_req_id: string | null;
        hf_actor: string | null;
        core_path: string;
        core_method: string;
        core_status: number;
        core_request_id: string | null;
        attempt: number;
      }) => void;
      hfActor?: string | null; // for logging only
    } | undefined;
    // Retries only for GET/HEAD, or POST when idempotencyKey is present.
    retry?: { maxRetries?: number } | null | undefined;
  }): Promise<T> {
    const url = joinUrl(this.baseUrl, args.path);
    const method = args.method;

    const maxRetries =
      args?.retry?.maxRetries != null ? Math.max(0, Math.min(args.retry.maxRetries, 5)) : this.maxRetries;

    const canRetry =
      method === "GET" ||
      method === "HEAD" ||
      (method === "POST" && Boolean(args?.ctx?.idempotencyKey));

    const attempts = canRetry ? 1 + maxRetries : 1;

    let lastErr: any = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const tTotal: TimeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
      // “Connect timeout” approximation: abort if we can't even get headers quickly.
      const tConnect: TimeoutHandle = setTimeout(() => controller.abort(), this.connectTimeoutMs);

      try {
        // Auth selection:
        // - default: service key (CORE_SERVICE_API_KEY)
        // - override: per-request header or api key for user pass-through
        const authHeader =
          isNonEmptyString(args?.ctx?.coreAuthHeader)
            ? String(args.ctx!.coreAuthHeader).trim()
            : isNonEmptyString(args?.ctx?.coreApiKey)
              ? `Bearer ${String(args.ctx!.coreApiKey).trim()}`
              : `Bearer ${this.apiKey}`;

        const headers: Record<string, string> = {
          accept: "application/json",
          "content-type": "application/json",
          authorization: authHeader,
          ...(args?.ctx?.requestId ? { "x-request-id": String(args.ctx.requestId) } : {}),
          ...(args?.ctx?.clientRequestId ? { "x-client-request-id": String(args.ctx.clientRequestId) } : {}),
          ...(args?.ctx?.idempotencyKey ? { "idempotency-key": String(args.ctx.idempotencyKey) } : {}),
        };

        const init: RequestInit = {
          method,
          headers,
          signal: controller.signal,
        };

        if (method === "POST") {
          init.body = JSON.stringify(args.body ?? {});
        }

        const res: AnyResponse = await fetch(url, init);

        // If we got a response, we consider “connect” satisfied.
        clearTimeout(tConnect);

        const payload = await readJsonSafe(res, this.maxResponseBytes);
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

        return payload as T;
      } catch (e: any) {
        clearTimeout(tConnect);
        lastErr = e;

        // Normalize timeouts/unreachable into stable errors
        if (e?.name === "AbortError") {
          const err = new CoreClientError("core_timeout", { status: 504, payload: { request_id: null } });
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

        // Retry only when allowed and only for transient-looking failures.
        if (attempt < attempts) {
          const status = lastErr instanceof CoreClientError ? lastErr.status : 0;
          const retryable = status === 502 || status === 503 || status === 504;
          if (retryable) {
            // Deterministic backoff (no jitter): 250ms, 500ms, 1000ms, ...
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

  async get<T = any>(
    path: string,
    ctx?: {
      requestId?: string | null;
      clientRequestId?: string | null;
      onCoreCall?: (line: {
        hf_req_id: string | null;
        hf_actor: string | null;
        core_path: string;
        core_method: string;
        core_status: number;
        core_request_id: string | null;
        attempt: number;
      }) => void;
      hfActor?: string | null;
    },
    retry?: { maxRetries?: number } | null
  ): Promise<T> {
    const args: any = { method: "GET", path };
    if (ctx != null) args.ctx = ctx;
    if (retry != null) args.retry = retry;
    return this._request<T>(args);
  }

  async post<T = any>(
    path: string,
    body: Json,
    ctx?: {
      requestId?: string | null;
      clientRequestId?: string | null;
      idempotencyKey?: string | null;
      onCoreCall?: (line: {
        hf_req_id: string | null;
        hf_actor: string | null;
        core_path: string;
        core_method: string;
        core_status: number;
        core_request_id: string | null;
        attempt: number;
      }) => void;
      hfActor?: string | null;
    },
    retry?: { maxRetries?: number } | null
  ): Promise<T> {
    const args: any = { method: "POST", path, body };
    if (ctx != null) args.ctx = ctx;
    if (retry != null) args.retry = retry;
    return this._request<T>(args);
  }
}

// Convenience wrappers (onboarding) — keep call sites clean and typed.
export function makeCoreOnboarding(core: CoreClient) {
  return {
    checkEmail: (
      email: string,
      ctx?: {
        requestId?: string | null;
        clientRequestId?: string | null;
        onCoreCall?: (line: {
          hf_req_id: string | null;
          hf_actor: string | null;
          core_path: string;
          core_method: string;
          core_status: number;
          core_request_id: string | null;
          attempt: number;
        }) => void;
        hfActor?: string | null;
      }
    ) => core.post("/v1/onboarding/email/check", { email }, ctx),

    createOrg: (
      payload: Json,
      ctx?: {
        requestId?: string | null;
        clientRequestId?: string | null;
        idempotencyKey?: string | null;
        onCoreCall?: (line: {
          hf_req_id: string | null;
          hf_actor: string | null;
          core_path: string;
          core_method: string;
          core_status: number;
          core_request_id: string | null;
          attempt: number;
        }) => void;
        hfActor?: string | null;
      }
    ) => core.post("/v1/onboarding/orgs", payload, ctx, { maxRetries: 0 }), 

    addMember: (
      orgId: string,
      payload: Json,
      ctx?: {
        requestId?: string | null;
        clientRequestId?: string | null;
        idempotencyKey?: string | null;
        onCoreCall?: (line: {
          hf_req_id: string | null;
          hf_actor: string | null;
          core_path: string;
          core_method: string;
          core_status: number;
          core_request_id: string | null;
          attempt: number;
        }) => void;
        hfActor?: string | null;
      }
    ) => core.post(`/v1/onboarding/orgs/${encodeURIComponent(orgId)}/members`, payload, ctx, { maxRetries: 0 }),
  };
}