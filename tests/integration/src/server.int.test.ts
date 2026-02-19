// tests/integration/server.int.test.ts 
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.HASH_FACTORY_DATABASE_URL);
 
(HAS_DB ? describe : describe.skip)("hash_factory integration (real DB)", () => {
  let app: FastifyInstance | null = null;

  beforeAll(async () => {
    process.env.NODE_ENV = "test"; 

    const mod = await import("../../../src/server.js");
    app = await mod.buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("GET /healthz returns 200", async () => {
    if (!app) return;
    const res = await app.inject({ method: "GET", url: "/healthz" });
    if (res.statusCode !== 200) {
      // eslint-disable-next-line no-console
      console.error("[INT]/healthz:", res.statusCode, res.body);
    }
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it("GET /readyz returns 200 when DB + prereqs are good", async () => {
    if (!app) return;

    const res = await app.inject({ method: "GET", url: "/readyz" });
    if (res.statusCode !== 200) {
      // eslint-disable-next-line no-console
      console.error("[INT]/readyz:", res.statusCode, res.body);
    }
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body).toEqual({ ok: true });
  });
});