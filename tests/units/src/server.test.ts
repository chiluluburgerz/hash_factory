// tests/units/src/server.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const mockCloseDb = vi.fn(async () => {});
const mockHealthcheck = vi.fn(async () => true);
const mockAssertAuthPrereqs = vi.fn(async () => {});

// IMPORTANT: These specifiers must match what src/server.ts resolves to.
// Since server imports "./db.js" and "./plugins/authActor.js", mock them
// using paths that resolve to the same underlying files.
vi.mock("../../../src/db.js", () => ({
  pool: {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    end: vi.fn(async () => {}),
  },
  healthcheck: () => mockHealthcheck(),
  assertAuthPrereqs: () => mockAssertAuthPrereqs(),
  closeDb: () => mockCloseDb(),
}));

vi.mock("../../../src/plugins/globalRateLimit.js", () => ({
  registerGlobalRateLimit: vi.fn((_app: any) => {}),
}));

vi.mock("../../../src/routes/index.js", () => ({
  registerRoutes: vi.fn(async (app: any) => {
    app.get("/v1/protected", async (_req: any, reply: any) => reply.send({ ok: true }));
    app.get("/v1/health", async (_req: any, reply: any) => reply.send({ ok: true }));
  }),
}));

// Auth plugin MUST decorate app.requireAuth (and optionalAuth if you later need it)
vi.mock("../../../src/plugins/authActor.js", async () => {
  const fpMod = await import("fastify-plugin");
  const fp = fpMod.default;

  const plugin = async function authActorPlugin(app: any, _opts: any) {
    app.decorate("requireAuth", () => {
      return async (req: any) => {
        if (String(req.headers["x-test-auth"] || "") !== "1") {
          const err: any = new Error("missing_auth");
          err.name = "AuthError";
          err.statusCode = 401;
          throw err;
        }
      };
    });

    app.decorate("optionalAuth", () => {
      return async () => {};
    });

    app.decorate("assertReqActor", () => {
      throw new Error("not_used_in_unit_tests");
    });
  };

  return {
    default: fp(plugin, { name: "auth-actor" }),
  };
});

vi.mock("../../../src/plugins/requestId.js", () => ({
  requestIdPlugin: async function requestIdPlugin(app: any) {
    app.addHook("onRequest", async (req: any) => {
      req.id = req.id || "req_test_1";
      req.clientRequestId = req.headers["x-client-request-id"] ?? null;
    });
  },
}));

vi.mock("../../../src/plugins/securityHeaders.js", () => ({
  securityHeadersPlugin: async function securityHeadersPlugin(_app: any) {},
}));

// Import AFTER mocks
import { buildApp } from "../../../src/server.js";

describe("hash_factory server buildApp() wiring (unit)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockHealthcheck.mockResolvedValue(true);
    mockAssertAuthPrereqs.mockResolvedValue(undefined);
  });

  it("GET /healthz is public and returns {ok:true}", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it("GET /readyz is public and returns ok=true when DB is healthy and prereqs pass", async () => {
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(mockHealthcheck).toHaveBeenCalled();
    expect(mockAssertAuthPrereqs).toHaveBeenCalled();
  });

  it("GET /readyz returns 503 db_unhealthy when healthcheck fails", async () => {
    mockHealthcheck.mockResolvedValue(false);
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, error: "db_unhealthy" });
  });

  it("GET /readyz returns 503 db_missing_prereq when prereqs throw", async () => {
    mockAssertAuthPrereqs.mockRejectedValue(new Error("missing_table"));
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ ok: false, error: "db_missing_prereq" });
    expect(String(body.message || "")).toContain("missing_table");
  });

  it("non-bypass paths require auth (401 when missing)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/protected" });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ error: "unauthorized", message: "missing_auth" });
    expect(body).toHaveProperty("request_id");
  });

  it("authorized request succeeds", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/protected",
      headers: { "x-test-auth": "1" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });
});