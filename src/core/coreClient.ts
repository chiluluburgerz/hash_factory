// ============================================================================
// File: src/core/coreClient.ts
// Version: 1.0-hash-factory-core-client | 2026-02-18
// Purpose:
//   Minimal, disciplined HTTP client for Hash Factory -> Core Backend.
//   - Service-to-service auth via CORE_SERVICE_API_KEY
//   - Propagates request correlation ids
//   - Strict timeouts
//   - No retries by default (callers opt-in for safe GETs only)
// ============================================================================

type Json = Record<string, unknown>;

export type CoreClientOpts = {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export class CoreClientError extends Error {
  status: number;
  code?: string | null;
  payload?: any;

  constructor(message: string, opts: { status: number; code?: string | null; payload?: any }) {
    super(message);
    this.name = "CoreClientError";
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.payload = opts.payload;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  const b = String(baseUrl || "").replace(/\/+$/, "");
  const p = String(path || "").replace(/^\/+/, "");
  return `${b}/${p}`;
}

async function readTextBounded(res: Response, maxBytes: number): Promise<string> {
  // Defense-in-depth: bound memory usage when reading error bodies or malformed responses.
  const lim = Math.max(1024, Math.min(Number(maxBytes || 0) || 256_000, 10_000_000));
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > lim) return buf.subarray(0, lim).toString("utf8");
    return buf.toString("utf8");
  } catch {
    return await res.text().catch(() => "");
  }
}

async function readJsonSafe(res: Response, maxBytes: number): Promise<any> {
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
  private maxResponseBytes: number;

  constructor(opts: CoreClientOpts) {
    if (!opts?.baseUrl) throw new Error("CoreClient: baseUrl is required");
    if (!opts?.apiKey) throw new Error("CoreClient: apiKey is required");

    this.baseUrl = String(opts.baseUrl);
    this.apiKey = String(opts.apiKey).trim();
    this.timeoutMs = Math.max(500, Number(opts.timeoutMs ?? 10_000));
    this.maxResponseBytes = Math.max(1024, Math.min(Number(opts.maxResponseBytes ?? 256_000), 10_000_000));
  }

  async post<T = any>(
    path: string,
    body: Json,
    ctx?: { requestId?: string | null; clientRequestId?: string | null }
  ): Promise<T> {
    const url = joinUrl(this.baseUrl, path);

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        ...(ctx?.requestId ? { "x-request-id": String(ctx.requestId) } : {}),
        ...(ctx?.clientRequestId ? { "x-client-request-id": String(ctx.clientRequestId) } : {}),
      };

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
      });

      const payload = await readJsonSafe(res, this.maxResponseBytes);

      if (!res.ok) {
        const msg = payload?.message || payload?.error || `core_http_${res.status}`;
        throw new CoreClientError(String(msg), {
          status: res.status,
          code: payload?.code ?? null,
          payload,
        });
      }

      return payload as T;
    } catch (e: any) {
      if (e?.name === "AbortError") {
        throw new CoreClientError("core_timeout", { status: 504 });
      }
      if (e instanceof CoreClientError) throw e;
      throw new CoreClientError(e?.message || "core_unreachable", { status: 502 });
    } finally {
      clearTimeout(t);
    }
  }
}

// Convenience wrappers (onboarding) — keep call sites clean and typed.
export function makeCoreOnboarding(core: CoreClient) {
  return {
    checkEmail: (email: string, ctx?: { requestId?: string | null; clientRequestId?: string | null }) =>
      core.post("/v1/onboarding/email/check", { email }, ctx),

    createOrg: (payload: Json, ctx?: { requestId?: string | null; clientRequestId?: string | null }) =>
      core.post("/v1/onboarding/orgs", payload, ctx),

    addMember: (
      orgId: string,
      payload: Json,
      ctx?: { requestId?: string | null; clientRequestId?: string | null }
    ) => core.post(`/v1/onboarding/orgs/${encodeURIComponent(orgId)}/members`, payload, ctx),
  };
}