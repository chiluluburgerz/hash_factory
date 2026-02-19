// tests/units/src/core/coreClient.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CoreClient, CoreClientError, makeCoreOnboarding } from "../../../../src/core/coreClient.js";

type FetchCall = { url: string; init?: RequestInit };

function makeJsonResponse(opts: {
  status?: number;
  headers?: Record<string, string>;
  jsonBody: any;
}) {
  const status = opts.status ?? 200;
  const headers = new Headers({
    "content-type": "application/json",
    ...(opts.headers ?? {}),
  });

  // Minimal Response-like shape that coreClient uses:
  // - status, ok, headers.get(), text(), body.getReader()
  const raw = JSON.stringify(opts.jsonBody);

  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    body: null,
    text: async () => raw,
  } as any;
}

function makeTextResponse(opts: {
  status?: number;
  headers?: Record<string, string>;
  text: string;
}) {
  const status = opts.status ?? 200;
  const headers = new Headers({
    "content-type": "text/plain",
    ...(opts.headers ?? {}),
  });

  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    body: null,
    text: async () => opts.text,
  } as any;
}

describe("core/coreClient.ts (unit)", () => {
  let fetchSpy: any;
  const calls: FetchCall[] = [];

  beforeEach(() => {
    calls.length = 0;
    fetchSpy = vi.fn(async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      return makeJsonResponse({ jsonBody: { ok: true } });
    });
    (globalThis as any).fetch = fetchSpy;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("constructor requires baseUrl + apiKey", () => {
    expect(() => new CoreClient({ baseUrl: "", apiKey: "k" } as any)).toThrow(
      "CoreClient: baseUrl is required"
    );
    expect(() => new CoreClient({ baseUrl: "http://x", apiKey: "" } as any)).toThrow(
      "CoreClient: apiKey is required"
    );
  });

  it("GET joins urls, sets service auth, accept/json headers, and request id headers", async () => {
    const c = new CoreClient({ baseUrl: "http://core.local/", apiKey: "svc_key" });

    await c.get("/v1/ping", { requestId: "hf-1", clientRequestId: "c-1" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toBe("http://core.local/v1/ping");

    const h = calls[0].init?.headers as Record<string, string>;
    expect(h.accept).toBe("application/json");
    expect(h["content-type"]).toBe("application/json");
    expect(h.authorization).toBe("Bearer svc_key");
    expect(h["x-request-id"]).toBe("hf-1");
    expect(h["x-client-request-id"]).toBe("c-1");
  });

  it("POST sends JSON body and idempotency-key header", async () => {
    const c = new CoreClient({ baseUrl: "http://core.local", apiKey: "svc_key" });

    await c.post(
      "v1/onboarding/orgs",
      { name: "acme" },
      { idempotencyKey: "idem-1", requestId: "hf-2" }
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const init = calls[0].init!;
    const h = init.headers as Record<string, string>;
    expect(h["idempotency-key"]).toBe("idem-1");
    expect(h["x-request-id"]).toBe("hf-2");

    expect(init.method).toBe("POST");
    expect(String(init.body)).toBe(JSON.stringify({ name: "acme" }));
  });

  it("auth override: coreAuthHeader replaces service bearer", async () => {
    const c = new CoreClient({ baseUrl: "http://core.local", apiKey: "svc_key" });

    await c.get("/v1/ping", { coreAuthHeader: "Bearer user_token" } as any);

    const h = calls[0].init?.headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer user_token");
  });

  it("auth override: coreApiKey becomes Bearer <coreApiKey>", async () => {
    const c = new CoreClient({ baseUrl: "http://core.local", apiKey: "svc_key" });

    await c.get("/v1/ping", { coreApiKey: "user_secret" } as any);

    const h = calls[0].init?.headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer user_secret");
  });

  it("non-2xx throws CoreClientError with status/code/message and requestId from payload", async () => {
    fetchSpy.mockImplementationOnce(async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      return makeJsonResponse({
        status: 400,
        jsonBody: { error: "bad", message: "bad_request", code: "BAD", request_id: "core-req-9" },
      });
    });

    const c = new CoreClient({ baseUrl: "http://core.local", apiKey: "svc_key" });

    await expect(c.get("/v1/err")).rejects.toMatchObject({
      name: "CoreClientError",
      status: 400,
      code: "BAD",
      requestId: "core-req-9",
      message: "bad_request",
    });
  });

  it("2xx but non-json returns {error: non_json_response}", async () => {
    fetchSpy.mockImplementationOnce(async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      return makeTextResponse({
        status: 200,
        text: "hello",
        headers: { "content-type": "text/plain" },
      });
    });

    const c = new CoreClient({ baseUrl: "http://core.local", apiKey: "svc_key" });

    const out = await c.get("/v1/nonjson");
    expect(out).toMatchObject({ error: "non_json_response" });
  });

  it("2xx but invalid json returns {error: invalid_json}", async () => {
    fetchSpy.mockImplementationOnce(async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      return {
        status: 200,
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        body: null,
        text: async () => "{not json",
      } as any;
    });

    const c = new CoreClient({ baseUrl: "http://core.local", apiKey: "svc_key" });

    const out = await c.get("/v1/invalidjson");
    expect(out).toEqual({ error: "invalid_json" });
  });

  it("AbortError maps to CoreClientError status=504 core_timeout and emits onCoreCall once", async () => {
    fetchSpy.mockImplementationOnce(async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      const err: any = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });

    const onCoreCall = vi.fn();
    const c = new CoreClient({ baseUrl: "http://core.local", apiKey: "svc_key" });

    await expect(c.get("/v1/slow", { requestId: "hf-10", onCoreCall } as any)).rejects.toMatchObject({
      name: "CoreClientError",
      status: 504,
      message: "core_timeout",
    });

    expect(onCoreCall).toHaveBeenCalledTimes(1);
    expect(onCoreCall).toHaveBeenCalledWith(
      expect.objectContaining({
        hf_req_id: "hf-10",
        core_status: 504,
        attempt: 1,
      })
    );
  });

  it("non-CoreClientError reject maps to status=502 core_unreachable and emits onCoreCall once", async () => {
    fetchSpy.mockImplementationOnce(async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      throw new Error("dns");
    });

    const onCoreCall = vi.fn();
    const c = new CoreClient({ baseUrl: "http://core.local", apiKey: "svc_key" });

    await expect(c.get("/v1/down", { requestId: "hf-11", onCoreCall } as any)).rejects.toMatchObject({
      name: "CoreClientError",
      status: 502,
    });

    expect(onCoreCall).toHaveBeenCalledTimes(1);
    expect(onCoreCall).toHaveBeenCalledWith(
      expect.objectContaining({
        hf_req_id: "hf-11",
        core_status: 502,
        attempt: 1,
      })
    );
  });

  it("retries GET on transient 502/503/504 with deterministic backoff, and calls onCoreCall per attempt", async () => {
    vi.useFakeTimers();

    const onCoreCall = vi.fn();
    let n = 0;

    fetchSpy.mockImplementation(async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      n++;

      if (n === 1) {
        // unreachable => mapped to 502
        throw new Error("net");
      }
      if (n === 2) {
        // 503 json error
        return makeJsonResponse({ status: 503, jsonBody: { message: "busy", code: "BUSY" } });
      }
      return makeJsonResponse({ status: 200, jsonBody: { ok: true, n } });
    });

    const c = new CoreClient({ baseUrl: "http://core.local", apiKey: "svc_key", maxRetries: 2 });

    const p = c.get("/v1/flaky", { requestId: "hf-12", onCoreCall } as any);

    // attempt1 fails -> wait 250ms
    await vi.runAllTimersAsync();
    const out = await p;

    expect(out).toEqual({ ok: true, n: 3 });
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    expect(onCoreCall).toHaveBeenCalledTimes(3);
    expect(onCoreCall.mock.calls[0][0]).toMatchObject({ core_status: 502, attempt: 1 });
    expect(onCoreCall.mock.calls[1][0]).toMatchObject({ core_status: 503, attempt: 2 });
    expect(onCoreCall.mock.calls[2][0]).toMatchObject({ core_status: 200, attempt: 3 });
  });

  it("does not retry POST without idempotencyKey, even if retry is requested", async () => {
    fetchSpy.mockImplementationOnce(async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      return makeJsonResponse({ status: 503, jsonBody: { message: "busy", code: "BUSY" } });
    });

    const c = new CoreClient({ baseUrl: "http://core.local", apiKey: "svc_key" });

    await expect(c.post("/v1/x", { a: 1 }, undefined, { maxRetries: 2 })).rejects.toBeInstanceOf(CoreClientError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries POST when idempotencyKey is present", async () => {
    vi.useFakeTimers();

    let n = 0;
    fetchSpy.mockImplementation(async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      n++;
      if (n === 1) return makeJsonResponse({ status: 503, jsonBody: { message: "busy" } });
      return makeJsonResponse({ status: 200, jsonBody: { ok: true } });
    });

    const c = new CoreClient({ baseUrl: "http://core.local", apiKey: "svc_key" });

    const p = c.post(
      "/v1/x",
      { a: 1 },
      { idempotencyKey: "idem-9" },
      { maxRetries: 1 }
    );

    await vi.runAllTimersAsync();
    const out = await p;

    expect(out).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const h0 = calls[0].init?.headers as Record<string, string>;
    const h1 = calls[1].init?.headers as Record<string, string>;
    expect(h0["idempotency-key"]).toBe("idem-9");
    expect(h1["idempotency-key"]).toBe("idem-9");
  });

  it("makeCoreOnboarding wrappers call the expected paths", async () => {
    const c = new CoreClient({ baseUrl: "http://core.local", apiKey: "svc_key" });
    const onboarding = makeCoreOnboarding(c);

    await onboarding.checkEmail("a@b.com");
    await onboarding.createOrg({ name: "acme" }, { idempotencyKey: "idem-1" } as any);
    await onboarding.addMember("org-1", { email: "x@y.com" });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(calls[0].url).toBe("http://core.local/v1/onboarding/email/check");
    expect(calls[1].url).toBe("http://core.local/v1/onboarding/orgs");
    expect(calls[2].url).toBe("http://core.local/v1/onboarding/orgs/org-1/members");
  });
});