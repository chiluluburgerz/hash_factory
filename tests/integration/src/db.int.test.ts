// tests/integration/src/db.int.test.ts
import { describe, it, expect } from "vitest";

const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.HASH_FACTORY_DATABASE_URL);

(HAS_DB ? describe : describe.skip)("db.ts integration (real DB)", () => {
  it("healthcheck returns true", async () => {
    process.env.NODE_ENV = "test";
    const { healthcheck } = await import("../../../src/db.js");
    await expect(healthcheck()).resolves.toBe(true);
  });

  it("assertAuthPrereqs resolves when migrations are applied", async () => {
    process.env.NODE_ENV = "test";
    const { assertAuthPrereqs } = await import("../../../src/db.js");
    await expect(assertAuthPrereqs()).resolves.toBeUndefined();
  });

  it("withClient can acquire a client and run a query", async () => {
    process.env.NODE_ENV = "test";
    const { withClient } = await import("../../../src/db.js");

    const out = await withClient(async (client: any) => {
      const r = await client.query("SELECT 1 AS one");
      return r?.rows?.[0]?.one ?? null;
    });

    expect(out).toBe(1);
  });
});