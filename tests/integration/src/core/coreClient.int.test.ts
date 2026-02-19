// tests/integration/src/core/coreClient.int.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { CoreClient } from "../../../../src/core/coreClient.js";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe("core/coreClient.ts integration (real HTTP)", () => {
  let app: FastifyInstance;
  let baseUrl: string;

  let flakyCount = 0;

  beforeAll(async () => {
    app = Fastify({ logger: false });

    app.addHook("onSend", async (_req, reply, payload) => {
      reply.header("connection", "close");
      return payload;
    });

    app.get("/ok", async (req, reply) => {
      const h = req.headers as Record<string, any>;
      return reply.send({
        ok: true,
        request_id: "core-req-ok",
        got: {
          auth: h["authorization"] ?? null,
          requestId: h["x-request-id"] ?? null,
          clientRequestId: h["x-client-request-id"] ?? null,
        },
      });
    });

    app.post("/post", async (req, reply) => {
      const h = req.headers as Record<string, any>;
      return reply.send({
        ok: true,
        request_id: "core-req-post",
        got: {
          auth: h["authorization"] ?? null,
          idem: h["idempotency-key"] ?? null,
        },
        body: (req.body as any) ?? null,
      });
    });

    app.get("/nonjson", async (_req, reply) => {
      reply.header("content-type", "text/plain");
      return reply.send("hello world");
    });

    app.get("/invalidjson", async (_req, reply) => {
      reply.header("content-type", "application/json");
      return reply.send("{not json");
    });

    app.get("/err", async (_req, reply) => {
      return reply.code(400).send({
        error: "bad",
        message: "bad_request",
        code: "BAD",
        request_id: "core-req-err",
      });
    });

    app.get("/slow", async (_req, reply) => {
      await sleep(800);
      return reply.send({ ok: true });
    });

    app.get("/flaky", async (_req, reply) => {
      flakyCount++;
      if (flakyCount <= 2) {
        return reply.code(503).send({ message: "busy", code: "BUSY" });
      }
      return reply.send({ ok: true, request_id: `core-req-flaky-${flakyCount}` });
    });

    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("unexpected address");
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (!app) return;
    // Best-effort: ensure no open sockets keep the suite alive.
    try {
      const s: any = app.server as any;
      if (typeof s.closeIdleConnections === "function") s.closeIdleConnections();
      if (typeof s.closeAllConnections === "function") s.closeAllConnections();
    } catch {
      // ignore
    }
    await app.close();
  }, 20_000);
 
  it("GET /ok sets service bearer and propagates request ids", async () => {
    const c = new CoreClient({ baseUrl, apiKey: "svc_key", timeoutMs: 5_000 });

    const out = await c.get("/ok", { requestId: "hf-1", clientRequestId: "c-1" });

    expect(out).toMatchObject({
      ok: true,
      request_id: "core-req-ok",
      got: {
        auth: "Bearer svc_key",
        requestId: "hf-1",
        clientRequestId: "c-1",
      },
    });
  });

  it("POST /post sends json, idempotency key, and uses per-request auth override", async () => {
    const c = new CoreClient({ baseUrl, apiKey: "svc_key", timeoutMs: 5_000 });

    const out = await c.post(
      "/post",
      { hello: "world" },
      { idempotencyKey: "idem-1", coreApiKey: "user_secret" } as any
    );

    expect(out).toMatchObject({
      ok: true,
      request_id: "core-req-post",
      got: { auth: "Bearer user_secret", idem: "idem-1" },
      body: { hello: "world" },
    });
  });

  it("non-json 2xx returns {error: non_json_response}", async () => {
    const c = new CoreClient({ baseUrl, apiKey: "svc_key" });
    const out = await c.get("/nonjson");
    expect(out).toMatchObject({ error: "non_json_response" });
  });

  it("invalid json 2xx returns {error: invalid_json}", async () => {
    const c = new CoreClient({ baseUrl, apiKey: "svc_key" });
    const out = await c.get("/invalidjson");
    expect(out).toEqual({ error: "invalid_json" });
  });

  it("non-2xx throws CoreClientError with status/code/requestId", async () => {
    const c = new CoreClient({ baseUrl, apiKey: "svc_key" });

    await expect(c.get("/err")).rejects.toMatchObject({
      name: "CoreClientError",
      status: 400,
      code: "BAD",
      requestId: "core-req-err",
      message: "bad_request",
    });
  });

  it("timeout maps to status=504 core_timeout", async () => {
    const c = new CoreClient({ baseUrl, apiKey: "svc_key", timeoutMs: 200, connectTimeoutMs: 200 });

    await expect(c.get("/slow")).rejects.toMatchObject({
      name: "CoreClientError",
      status: 504,
      message: "core_timeout",
    });
  });

  it("retries GET on 503 up to maxRetries and eventually succeeds", async () => {
    flakyCount = 0;

    const onCoreCall: any[] = [];
    const c = new CoreClient({ baseUrl, apiKey: "svc_key", maxRetries: 3, timeoutMs: 5_000 });

    const out = await c.get(
      "/flaky",
      {
        requestId: "hf-99",
        hfActor: "u:1",
        onCoreCall: (line: any) => onCoreCall.push(line),
      } as any,
      { maxRetries: 3 }
    );
 
    expect(out).toMatchObject({ ok: true });
    expect(onCoreCall.length).toBe(3);

    // attempt 1 => 503, attempt 2 => 503, attempt 3 => 200
    expect(onCoreCall[0]).toMatchObject({ attempt: 1, core_status: 503, hf_req_id: "hf-99", hf_actor: "u:1" });
    expect(onCoreCall[1]).toMatchObject({ attempt: 2, core_status: 503 });
    expect(onCoreCall[2]).toMatchObject({ attempt: 3, core_status: 200 });
  });
});