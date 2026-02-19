import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Pool } from "pg";

// Mock hashing 
vi.mock("../../../../src/utils/cryptoUtils.js", () => ({
  sha3_512_hex_lower: (s: string) => `h:${String(s)}`,
}));

import { createApiKeyAuthenticator, AuthError } from "../../../../src/auth/apiKeyAuth.js";

type ReqLike = {
  headers: Record<string, any>;
};

function req(headers: Record<string, any>): any {
  return { headers } as ReqLike;
}

function expectAuthError(
  fn: () => any,
  opts: { statusCode?: number; code?: string; messageIncludes?: string } = {}
) {
  try {
    fn();
    throw new Error("Expected AuthError");
  } catch (e: any) {
    expect(e).toBeInstanceOf(AuthError);
    if (opts.statusCode != null) expect(e.statusCode).toBe(opts.statusCode);
    if (opts.code != null) expect(e.code).toBe(opts.code);
    if (opts.messageIncludes) expect(String(e.message)).toContain(opts.messageIncludes);
  }
}

function expectAuthErrorAsync(
  p: Promise<any>,
  opts: { statusCode?: number; code?: string; messageIncludes?: string } = {}
) {
  return p.then(
    () => {
      throw new Error("Expected AuthError");
    },
    (e: any) => {
      expect(e).toBeInstanceOf(AuthError);
      if (opts.statusCode != null) expect(e.statusCode).toBe(opts.statusCode);
      if (opts.code != null) expect(e.code).toBe(opts.code);
      if (opts.messageIncludes) expect(String(e.message)).toContain(opts.messageIncludes);
    }
  );
}

describe("auth/apiKeyAuth.ts (unit)", () => {
  let pool: Pick<Pool, "query">;

  beforeEach(() => {
    vi.restoreAllMocks();
    pool = { query: vi.fn() } as any;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("createApiKeyAuthenticator requires a pg pool", () => {
    expect(() => createApiKeyAuthenticator({ pool: null as any })).toThrow(
      "createApiKeyAuthenticator requires a pg pool"
    );
    expect(() => createApiKeyAuthenticator({ pool: {} as any })).toThrow(
      "createApiKeyAuthenticator requires a pg pool"
    );
  });

  describe("authenticateRequest header extraction", () => {
    it("returns null when no api key headers present", async () => {
      const auth = createApiKeyAuthenticator({ pool: pool as any });
      const out = await auth.authenticateRequest(req({}));
      expect(out).toBeNull();
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("accepts Authorization: Bearer <token>", async () => {
      (pool.query as any).mockResolvedValueOnce({ rows: [{ api_key_id: "k1" }] });

      const auth = createApiKeyAuthenticator({ pool: pool as any });
      const out = await auth.authenticateRequest(req({ authorization: "Bearer abc" }));
      expect(out).toEqual({ api_key_id: "k1" });

      expect(pool.query).toHaveBeenCalledWith("SELECT * FROM core.api_key_lookup($1)", ["h:abc"]);
    });

    it("accepts x-api-key: <token>", async () => {
      (pool.query as any).mockResolvedValueOnce({ rows: [{ api_key_id: "k1" }] });

      const auth = createApiKeyAuthenticator({ pool: pool as any });
      const out = await auth.authenticateRequest(req({ "x-api-key": "abc" }));
      expect(out).toEqual({ api_key_id: "k1" });

      expect(pool.query).toHaveBeenCalledWith("SELECT * FROM core.api_key_lookup($1)", ["h:abc"]);
    });

    it("throws AUTH_AMBIGUOUS when bearer and x-api-key both present but differ", async () => {
      const auth = createApiKeyAuthenticator({ pool: pool as any });

      await expectAuthErrorAsync(auth.authenticateRequest(req({ authorization: "Bearer a", "x-api-key": "b" })), {
        statusCode: 400,
        code: "AUTH_AMBIGUOUS",
        messageIncludes: "Multiple API key headers",
      });
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("allows bearer and x-api-key when identical (no ambiguity)", async () => {
      (pool.query as any).mockResolvedValueOnce({ rows: [{ api_key_id: "k1" }] });

      const auth = createApiKeyAuthenticator({ pool: pool as any });
      const out = await auth.authenticateRequest(
        req({ authorization: "Bearer same", "x-api-key": "same" })
      );
      expect(out).toEqual({ api_key_id: "k1" });
      expect(pool.query).toHaveBeenCalledWith("SELECT * FROM core.api_key_lookup($1)", ["h:same"]);
    });

    it("throws AUTH_INVALID when header token exceeds MAX_API_KEY_LEN", async () => {
      const auth = createApiKeyAuthenticator({ pool: pool as any });
      const tooLong = "x".repeat(1025);

      await expectAuthErrorAsync(auth.authenticateRequest(req({ "x-api-key": tooLong })), {
        statusCode: 400,
        code: "AUTH_INVALID",
        messageIncludes: "API key too long",
      });

      expect(pool.query).not.toHaveBeenCalled();
    });

    it("authenticateRequest throws AUTH_INVALID when lookup returns null", async () => {
      (pool.query as any).mockResolvedValueOnce({ rows: [] });

      const auth = createApiKeyAuthenticator({ pool: pool as any });
      await expectAuthErrorAsync(auth.authenticateRequest(req({ "x-api-key": "abc" })), {
        statusCode: 401,
        code: "AUTH_INVALID",
        messageIncludes: "Invalid or expired",
      });
    });
  });

  describe("lookupBySecret", () => {
    it("returns null for blank secrets", async () => {
      const auth = createApiKeyAuthenticator({ pool: pool as any });
      await expect(auth.lookupBySecret("")).resolves.toBeNull();
      await expect(auth.lookupBySecret("   ")).resolves.toBeNull();
      await expect(auth.lookupBySecret(null as any)).resolves.toBeNull();
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("returns null for secrets over MAX_API_KEY_LEN (defense-in-depth)", async () => {
      const auth = createApiKeyAuthenticator({ pool: pool as any });
      const tooLong = "x".repeat(1025);
      await expect(auth.lookupBySecret(tooLong)).resolves.toBeNull();
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("wraps DB errors as AUTH_FAILED", async () => {
      (pool.query as any).mockRejectedValueOnce(new Error("db down"));
      const auth = createApiKeyAuthenticator({ pool: pool as any });

      await expectAuthErrorAsync(auth.lookupBySecret("abc"), {
        statusCode: 401,
        code: "AUTH_FAILED",
        messageIncludes: "Authentication failed",
      });
    });

    it("returns null when api_key_lookup returns no rows", async () => {
      (pool.query as any).mockResolvedValueOnce({ rows: [] });
      const auth = createApiKeyAuthenticator({ pool: pool as any });

      const out = await auth.lookupBySecret("abc");
      expect(out).toBeNull();
    });

    it("returns the first row when api_key_lookup returns a match", async () => {
      (pool.query as any).mockResolvedValueOnce({ rows: [{ api_key_id: "k1", org_id: "o1" }] });
      const auth = createApiKeyAuthenticator({ pool: pool as any });

      const out = await auth.lookupBySecret("abc");
      expect(out).toEqual({ api_key_id: "k1", org_id: "o1" });
    });
  });

  describe("caching", () => {
    it("caches lookup results by key hash when cacheTtlMs > 0", async () => {
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);

      (pool.query as any).mockResolvedValueOnce({ rows: [{ api_key_id: "k1" }] });

      const auth = createApiKeyAuthenticator({
        pool: pool as any,
        cacheTtlMs: 10_000,
      });

      const a = await auth.lookupBySecret("abc");
      expect(a).toEqual({ api_key_id: "k1" });
      expect(pool.query).toHaveBeenCalledTimes(1);

      const b = await auth.lookupBySecret("abc");
      expect(b).toEqual({ api_key_id: "k1" });

      // second call should be cache hit
      expect(pool.query).toHaveBeenCalledTimes(1);

      nowSpy.mockRestore();
    });

    it("expires cache entries after ttl", async () => {
      const nowSpy = vi.spyOn(Date, "now");

      (pool.query as any)
        .mockResolvedValueOnce({ rows: [{ api_key_id: "k1" }] })
        .mockResolvedValueOnce({ rows: [{ api_key_id: "k2" }] });

      const auth = createApiKeyAuthenticator({
        pool: pool as any,
        cacheTtlMs: 100,
      });

      nowSpy.mockReturnValue(1000);
      const a = await auth.lookupBySecret("abc");
      expect(a).toEqual({ api_key_id: "k1" });
      expect(pool.query).toHaveBeenCalledTimes(1);

      // still valid
      nowSpy.mockReturnValue(1099);
      const b = await auth.lookupBySecret("abc");
      expect(b).toEqual({ api_key_id: "k1" });
      expect(pool.query).toHaveBeenCalledTimes(1);

      // expired
      nowSpy.mockReturnValue(1101);
      const c = await auth.lookupBySecret("abc");
      expect(c).toEqual({ api_key_id: "k2" });
      expect(pool.query).toHaveBeenCalledTimes(2);

      nowSpy.mockRestore();
    });

    it("evicts oldest entry when cacheMax is exceeded", async () => {
      // cacheMax=1 => every new key evicts the previous
      (pool.query as any)
        .mockResolvedValueOnce({ rows: [{ api_key_id: "k1" }] })
        .mockResolvedValueOnce({ rows: [{ api_key_id: "k2" }] })
        .mockResolvedValueOnce({ rows: [{ api_key_id: "k3" }] });

      const auth = createApiKeyAuthenticator({
        pool: pool as any,
        cacheTtlMs: 10_000,
        cacheMax: 1,
      });

      await auth.lookupBySecret("a"); // cached
      await auth.lookupBySecret("b"); // evicts "a"
      await auth.lookupBySecret("a"); // must query again

      expect(pool.query).toHaveBeenCalledTimes(3);
    });
  });

  describe("touch last_used", () => {
    it("touches last_used when enabled, sampled-in, and min interval passed", async () => {
      const nowSpy = vi.spyOn(Date, "now");
      const randSpy = vi.spyOn(Math, "random");

      // lookup + touch
      (pool.query as any)
        .mockResolvedValueOnce({ rows: [{ api_key_id: "k1" }] }) // lookup
        .mockResolvedValueOnce({ rows: [{ ok: true }] }); // touch

      nowSpy.mockReturnValue(1000);
      randSpy.mockReturnValue(0); // always < 1

      const auth = createApiKeyAuthenticator({
        pool: pool as any,
        touchLastUsed: true,
        touchSampleRate: 1,
        touchMinIntervalMs: 0,
      });

      await auth.lookupBySecret("abc");

      expect(pool.query).toHaveBeenNthCalledWith(1, "SELECT * FROM core.api_key_lookup($1)", ["h:abc"]);
      expect(pool.query).toHaveBeenNthCalledWith(2, "SELECT core.api_key_touch_last_used($1)", ["k1"]);

      nowSpy.mockRestore();
      randSpy.mockRestore();
    });

    it("does not touch again within touchMinIntervalMs", async () => {
      const nowSpy = vi.spyOn(Date, "now");
      const randSpy = vi.spyOn(Math, "random");

      (pool.query as any)
        .mockResolvedValueOnce({ rows: [{ api_key_id: "k1" }] }) // lookup #1
        .mockResolvedValueOnce({ rows: [{ ok: true }] }) // touch #1
        .mockResolvedValueOnce({ rows: [{ api_key_id: "k1" }] }); // lookup #2

      randSpy.mockReturnValue(0);

      const auth = createApiKeyAuthenticator({
        pool: pool as any,
        touchLastUsed: true,
        touchSampleRate: 1,
        touchMinIntervalMs: 60_000,
      });

      nowSpy.mockReturnValue(1000);
      await auth.lookupBySecret("abc");

      nowSpy.mockReturnValue(1000 + 1000); // only 1s later
      await auth.lookupBySecret("def");

      // Calls: lookup(abc), touch(k1), lookup(def). No second touch due to min interval.
      expect(pool.query).toHaveBeenCalledTimes(3);
      expect(pool.query).toHaveBeenNthCalledWith(1, "SELECT * FROM core.api_key_lookup($1)", ["h:abc"]);
      expect(pool.query).toHaveBeenNthCalledWith(2, "SELECT core.api_key_touch_last_used($1)", ["k1"]);
      expect(pool.query).toHaveBeenNthCalledWith(3, "SELECT * FROM core.api_key_lookup($1)", ["h:def"]);

      nowSpy.mockRestore();
      randSpy.mockRestore();
    });
 
    it("ignores touch errors (non-fatal) and still returns row", async () => {
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
      const randSpy = vi.spyOn(Math, "random").mockReturnValue(0);

      (pool.query as any)
        .mockResolvedValueOnce({ rows: [{ api_key_id: "k1" }] }) // lookup
        .mockRejectedValueOnce(new Error("touch failed")); // touch

      const auth = createApiKeyAuthenticator({
        pool: pool as any,
        touchLastUsed: true,
        touchSampleRate: 1,
        touchMinIntervalMs: 0,
      });

      const out = await auth.lookupBySecret("abc");
      expect(out).toEqual({ api_key_id: "k1" });

      nowSpy.mockRestore();
      randSpy.mockRestore();
    });

    it("bounds lastTouchByKeyId size using touchMaxKeys", async () => {
      const nowSpy = vi.spyOn(Date, "now");
      const randSpy = vi.spyOn(Math, "random").mockReturnValue(0);

      // For N lookups: each lookup does api_key_lookup then a touch.
      const N = 5;
      const results: any[] = [];
      for (let i = 0; i < N; i++) {
        results.push({ rows: [{ api_key_id: `k${i}` }] }); // lookup
        results.push({ rows: [{ ok: true }] }); // touch
      }
      (pool.query as any).mockImplementation(async (_sql: string, args?: any[]) => {
        const next = results.shift();
        if (!next) throw new Error("unexpected query");
        return next;
      });

      const auth = createApiKeyAuthenticator({
        pool: pool as any,
        touchLastUsed: true,
        touchSampleRate: 1,
        touchMinIntervalMs: 0,
        touchMaxKeys: 2,
      });

      for (let i = 0; i < N; i++) {
        nowSpy.mockReturnValue(1000 + i);
        await auth.lookupBySecret(`s${i}`);
      }

      // Not asserting internals directly; just ensure calls happened and nothing blew up.
      expect((pool.query as any).mock.calls.length).toBe(N * 2);

      nowSpy.mockRestore();
      randSpy.mockRestore();
    });
  });

  describe("pool contention warning", () => {
    it("does not warn if connect time is not used in this module", async () => {
      // This module never calls pool.connect(), only pool.query().
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const auth = createApiKeyAuthenticator({ pool: pool as any });

      (pool.query as any).mockResolvedValueOnce({ rows: [] });
      await auth.lookupBySecret("abc");

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});