import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  readEnvInt,
  trustProxyEnabled,
  rateLimitEnabled,
  getClientIp,
  createFixedWindowRateLimiter,
  applyRateLimitHeaders,
  rejectRateLimited,
  isUnknownIp,
} from "../../../../src/utils/rateLimit.js";

type FakeReq = {
  ip?: any;
  socket?: { remoteAddress?: any };
  raw?: { socket?: { remoteAddress?: any }; connection?: { remoteAddress?: any } };
};

type FakeReply = {
  headers: Record<string, string>;
  statusCode: number | null;
  sent: any;
  header: (k: string, v: any) => FakeReply;
  code: (n: number) => FakeReply;
  send: (body?: any) => FakeReply;
};

function makeReply(): FakeReply {
  const r: FakeReply = {
    headers: {},
    statusCode: null,
    sent: undefined,
    header(k: string, v: any) {
      r.headers[String(k)] = String(v);
      return r;
    },
    code(n: number) {
      r.statusCode = n;
      return r;
    },
    send(body?: any) {
      r.sent = body;
      return r;
    },
  };
  return r;
}

describe("utils/rateLimit.ts (unit)", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...envSnapshot };
    delete process.env.TRUST_PROXY;
    delete process.env.RATE_LIMIT_ENABLE;
    delete process.env.API_RATE_LIMIT_ENABLE;

    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // readEnvInt
  // ---------------------------------------------------------------------------

  it("readEnvInt returns default when none set", () => {
    delete process.env.A;
    delete process.env.B;
    expect(readEnvInt(["A", "B"], 123)).toBe(123);
  });

  it("readEnvInt returns first defined numeric value and floors it", () => {
    process.env.A = "12.9";
    process.env.B = "7";
    expect(readEnvInt(["A", "B"], 0)).toBe(12);
  });

  it("readEnvInt skips undefined and returns later defined value", () => {
    delete process.env.A;
    process.env.B = "9";
    expect(readEnvInt(["A", "B"], 0)).toBe(9);
  });

  it("readEnvInt ignores non-finite values and returns default", () => {
    process.env.A = "NaN";
    process.env.B = "Infinity";
    expect(readEnvInt(["A", "B"], 5)).toBe(5);
  });

  // ---------------------------------------------------------------------------
  // trustProxyEnabled / rateLimitEnabled
  // ---------------------------------------------------------------------------

  it("trustProxyEnabled defaults to false when env unset", () => {
    delete process.env.TRUST_PROXY;
    expect(trustProxyEnabled()).toBe(false);
  });

  it("trustProxyEnabled parses truthy values", () => {
    process.env.TRUST_PROXY = "true";
    expect(trustProxyEnabled()).toBe(true);

    process.env.TRUST_PROXY = "1";
    expect(trustProxyEnabled()).toBe(true);

    process.env.TRUST_PROXY = "yes";
    expect(trustProxyEnabled()).toBe(true);

    process.env.TRUST_PROXY = "on";
    expect(trustProxyEnabled()).toBe(true);
  });

  it("trustProxyEnabled parses falsey values as false", () => {
    process.env.TRUST_PROXY = "false";
    expect(trustProxyEnabled()).toBe(false);

    process.env.TRUST_PROXY = "0";
    expect(trustProxyEnabled()).toBe(false);
  });

  it("rateLimitEnabled defaults to true when env unset", () => {
    delete process.env.RATE_LIMIT_ENABLE;
    delete process.env.API_RATE_LIMIT_ENABLE;
    expect(rateLimitEnabled()).toBe(true);
  });

  it("rateLimitEnabled prefers RATE_LIMIT_ENABLE over API_RATE_LIMIT_ENABLE", () => {
    process.env.API_RATE_LIMIT_ENABLE = "false";
    process.env.RATE_LIMIT_ENABLE = "true";
    expect(rateLimitEnabled()).toBe(true);

    process.env.API_RATE_LIMIT_ENABLE = "true";
    process.env.RATE_LIMIT_ENABLE = "false";
    expect(rateLimitEnabled()).toBe(false);
  });

  it("rateLimitEnabled falls back to API_RATE_LIMIT_ENABLE when RATE_LIMIT_ENABLE unset", () => {
    delete process.env.RATE_LIMIT_ENABLE;
    process.env.API_RATE_LIMIT_ENABLE = "false";
    expect(rateLimitEnabled()).toBe(false);

    process.env.API_RATE_LIMIT_ENABLE = "true";
    expect(rateLimitEnabled()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // getClientIp + normalization
  // ---------------------------------------------------------------------------

  it("getClientIp prefers req.ip when present and normalizes ::1", () => {
    const req: FakeReq = { ip: "::1" };
    expect(getClientIp(req as any)).toBe("127.0.0.1");
  });

  it("getClientIp normalizes IPv4-mapped IPv6", () => {
    const req: FakeReq = { ip: "::ffff:127.0.0.1" };
    expect(getClientIp(req as any)).toBe("127.0.0.1");
  });

  it("getClientIp returns unknown when no ip and no socket address", () => {
    const req: FakeReq = {};
    const ip = getClientIp(req as any);
    expect(ip).toBe("unknown");
    expect(isUnknownIp(ip)).toBe(true);
  });

  it("getClientIp falls back to req.socket.remoteAddress", () => {
    const req: FakeReq = { socket: { remoteAddress: "10.0.0.1" } };
    expect(getClientIp(req as any)).toBe("10.0.0.1");
  });

  it("getClientIp falls back to req.raw.socket.remoteAddress", () => {
    const req: FakeReq = { raw: { socket: { remoteAddress: "10.0.0.2" } } };
    expect(getClientIp(req as any)).toBe("10.0.0.2");
  });

  it("getClientIp falls back to req.raw.connection.remoteAddress", () => {
    const req: FakeReq = { raw: { connection: { remoteAddress: "10.0.0.3" } } };
    expect(getClientIp(req as any)).toBe("10.0.0.3");
  });

  it("getClientIp trims whitespace and returns unknown on blank", () => {
    const req: FakeReq = { ip: "   " };
    expect(getClientIp(req as any)).toBe("unknown");
  });

  // ---------------------------------------------------------------------------
  // createFixedWindowRateLimiter (fixed window semantics)
  // ---------------------------------------------------------------------------

  it("allows up to max within a window and then blocks with retryAfterSeconds >= 1", () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);

    const lim = createFixedWindowRateLimiter({ windowMs: 10_000, max: 2 });

    const d1 = lim.check("k");
    expect(d1.allowed).toBe(true);
    expect(d1.limit).toBe(2);
    expect(d1.remaining).toBe(1);
    expect(d1.retryAfterSeconds).toBe(0);

    const d2 = lim.check("k");
    expect(d2.allowed).toBe(true);
    expect(d2.remaining).toBe(0);

    const d3 = lim.check("k");
    expect(d3.allowed).toBe(false);
    expect(d3.remaining).toBe(0);
    expect(d3.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(d3.resetMs).toBe(d1.resetMs);

    vi.useRealTimers();
  });

  it("resets after window and starts a new counter", () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);

    const lim = createFixedWindowRateLimiter({ windowMs: 5_000, max: 1 });

    const d1 = lim.check("k");
    expect(d1.allowed).toBe(true);
    expect(d1.remaining).toBe(0);

    const d2 = lim.check("k");
    expect(d2.allowed).toBe(false);

    // Move beyond window
    vi.setSystemTime(now + 5_001);

    const d3 = lim.check("k");
    expect(d3.allowed).toBe(true);
    expect(d3.remaining).toBe(0);
    expect(d3.resetMs).toBe(now + 5_001 + 5_000);

    vi.useRealTimers();
  });

  it("clamps windowMs to >= 1000 and max to >= 1", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);

    const lim = createFixedWindowRateLimiter({ windowMs: 10, max: 0 });
    const d = lim.check("k");
    // windowMs should be at least 1000, max at least 1.
    expect(d.limit).toBe(1);
    expect(d.resetMs - 1_700_000_000_000).toBeGreaterThanOrEqual(1000);

    vi.useRealTimers();
  });

  it("evicts oldest entries when maxEntries exceeded (bounded memory)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);

    const lim = createFixedWindowRateLimiter({ windowMs: 60_000, max: 1, maxEntries: 100 });

    // Create more unique keys than maxEntries to force eviction.
    for (let i = 0; i < 150; i++) {
      const d = lim.check("k" + i);
      expect(d.allowed).toBe(true);
    }

    // Oldest keys should have been evicted, so re-checking a very old key should behave like first hit.
    const dOld = lim.check("k0");
    expect(dOld.allowed).toBe(true);
    expect(dOld.remaining).toBe(0);

    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // applyRateLimitHeaders / rejectRateLimited
  // ---------------------------------------------------------------------------

  it("applyRateLimitHeaders sets standard headers and Retry-After only when blocked", () => {
    const reply1 = makeReply();
    applyRateLimitHeaders(reply1 as any, {
      allowed: true,
      limit: 10,
      remaining: 9,
      resetMs: 2_000,
      retryAfterSeconds: 0,
    });
    expect(reply1.headers["X-RateLimit-Limit"]).toBe("10");
    expect(reply1.headers["X-RateLimit-Remaining"]).toBe("9");
    expect(reply1.headers["X-RateLimit-Reset"]).toBe(String(Math.floor(2_000 / 1000)));
    expect(reply1.headers["Retry-After"]).toBeUndefined();

    const reply2 = makeReply();
    applyRateLimitHeaders(reply2 as any, {
      allowed: false,
      limit: 10,
      remaining: 0,
      resetMs: 2_000,
      retryAfterSeconds: 5,
    });
    expect(reply2.headers["Retry-After"]).toBe("5");
  });

  it("rejectRateLimited sends 429 with structured body and headers", () => {
    const reply = makeReply();
    rejectRateLimited(reply as any, {
      allowed: false,
      limit: 2,
      remaining: 0,
      resetMs: 10_000,
      retryAfterSeconds: 7,
    });

    expect(reply.statusCode).toBe(429);
    expect(reply.headers["X-RateLimit-Limit"]).toBe("2");
    expect(reply.headers["X-RateLimit-Remaining"]).toBe("0");
    expect(reply.headers["Retry-After"]).toBe("7");

    expect(reply.sent).toMatchObject({
      error: "rate_limited",
      retry_after_seconds: 7,
    });
  });

  it("isUnknownIp returns true only for the unknown sentinel", () => {
    expect(isUnknownIp("unknown")).toBe(true);
    expect(isUnknownIp(" unknown ")).toBe(true);
    expect(isUnknownIp("127.0.0.1")).toBe(false);
    expect(isUnknownIp("")).toBe(false);
  });
});