// tests/units/src/db.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type PgClient = { query: ReturnType<typeof vi.fn> };
type PgPool = {
  query: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
};

function makeDeferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("db.ts (unit)", () => {
  const origEnv = process.env;

  let pool: PgPool;
  let connectHandler: ((client: PgClient) => void) | null = null;
  let errorHandler: ((err: any) => void) | null = null;

  async function importDbWithEnv(extraEnv: Record<string, string> = {}) {
    // Reset module graph BEFORE mocking + import
    vi.resetModules();

    // Fresh env per import (db.ts reads env at import time)
    process.env = { ...origEnv };
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://unit:unit@127.0.0.1:5432/unit";
    Object.assign(process.env, extraEnv);

    connectHandler = null;
    errorHandler = null;

    pool = {
      query: vi.fn(),
      connect: vi.fn(),
      end: vi.fn(),
      on: vi.fn((evt: string, cb: any) => {
        if (evt === "connect") connectHandler = cb;
        if (evt === "error") errorHandler = cb;
        return pool as any;
      }),
    };

    // Critical: doMock must happen BEFORE importing db.js
    vi.doMock("pg", () => {
      return {
        Pool: vi.fn(() => pool),
      };
    });

    const mod = await import("../../../src/db.js");
    return mod;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = origEnv;
    vi.doUnmock("pg");
  });

  it("registers pool connect hook and applies session settings", async () => {
    await importDbWithEnv({
      PG_STATEMENT_TIMEOUT_MS: "15000",
      PG_IDLE_IN_TXN_SESSION_TIMEOUT_MS: "60000",
      PG_IDLE_SESSION_TIMEOUT_MS: "300000",
    });

    expect(pool.on).toHaveBeenCalled();

    expect(typeof connectHandler).toBe("function");
    if (!connectHandler) throw new Error("connect handler missing");

    const client: PgClient = { query: vi.fn(async () => ({ rowCount: 1 })) };
    connectHandler(client);

    await Promise.resolve();

    const calls = client.query.mock.calls.map((c) => String(c[0]));
    expect(calls).toContain("SET search_path TO core, utils, public");
    expect(calls.some((s) => s.startsWith("SET statement_timeout = '"))).toBe(true);
    expect(calls.some((s) => s.startsWith("SET idle_in_transaction_session_timeout = '"))).toBe(true);
    expect(calls.some((s) => s.startsWith("SET idle_session_timeout = '"))).toBe(true);
  });

  it("healthcheck returns true when SELECT 1 succeeds", async () => {
    const { healthcheck } = await importDbWithEnv();
    pool.query.mockResolvedValueOnce({ rowCount: 1 });

    await expect(healthcheck()).resolves.toBe(true);
    expect(pool.query).toHaveBeenCalledWith("SELECT 1");
  });

  it("healthcheck returns false when query throws", async () => {
    const { healthcheck } = await importDbWithEnv();
    pool.query.mockRejectedValueOnce(new Error("db down"));

    await expect(healthcheck()).resolves.toBe(false);
  });

  it("assertAuthPrereqs resolves when prereq function exists", async () => {
    const { assertAuthPrereqs } = await importDbWithEnv();
    pool.query.mockResolvedValueOnce({ rows: [{ ok: true, has_table: true }] });

    await expect(assertAuthPrereqs()).resolves.toBeUndefined();
    expect(pool.query).toHaveBeenCalled();
  });

  it("assertAuthPrereqs throws when prereq function missing", async () => {
    const { assertAuthPrereqs } = await importDbWithEnv();
    pool.query.mockResolvedValueOnce({ rows: [{ ok: false, has_table: true }] });

    await expect(assertAuthPrereqs()).rejects.toThrow(
      "db_missing_prereq: core.api_key_lookup(text) not found"
    );
  });

  it("withClient releases client on success", async () => {
    const { withClient } = await importDbWithEnv();

    const client = { query: vi.fn(), release: vi.fn() };
    pool.connect.mockResolvedValueOnce(client as any);

    const out = await withClient(async (c: any) => {
      await c.query("SELECT 1");
      return 123;
    });

    expect(out).toBe(123);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("withClient releases client on error", async () => {
    const { withClient } = await importDbWithEnv();

    const client = { query: vi.fn(), release: vi.fn() };
    pool.connect.mockResolvedValueOnce(client as any);

    await expect(
      withClient(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("withClient emits pool contention warning if connect is slow", async () => {
    vi.useFakeTimers();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { withClient } = await importDbWithEnv({ PG_CONNECT_WARN_MS: "50" });

    const client = { query: vi.fn(), release: vi.fn() };

    const d = makeDeferred<any>();
    pool.connect.mockReturnValueOnce(d.promise as any);

    const p = withClient(async () => "ok");

    vi.advanceTimersByTime(60);
    expect(warnSpy).toHaveBeenCalledWith(
      "[db] connect() waiting for a free client (pool contention)"
    );

    d.resolve(client as any);
    await expect(p).resolves.toBe("ok");
    expect(client.release).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it("closeDb calls pool.end()", async () => {
    const { closeDb } = await importDbWithEnv();
    pool.end.mockResolvedValueOnce(undefined as any);

    await expect(closeDb()).resolves.toBeUndefined();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("logs non-fatal pool idle errors via pool.on('error') handler", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await importDbWithEnv();

    expect(typeof errorHandler).toBe("function");
    if (!errorHandler) throw new Error("error handler missing");

    errorHandler(new Error("idle client blew up"));
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });
});