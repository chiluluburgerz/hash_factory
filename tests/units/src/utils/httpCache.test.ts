import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  cacheEnabled,
  sha3_512_hex,
  makeEtagFromHexDigest,
  makeEtagFromString,
  makeEtagFromBuffer,
  getIfNoneMatch,
  matchesIfNoneMatch,
  replyNotModified,
  stableJsonStringify,
  stableCacheKey,
  ResponseCache,
  applyCachedResponse,
} from "../../../../src/utils/httpCache.js";

type FakeReq = { headers: Record<string, any> };
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

describe("utils/httpCache.ts (unit)", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...envSnapshot };
    delete process.env.API_CACHE_ENABLE;
    delete process.env.API_CACHE_MAX_BODY_BYTES;
    delete process.env.API_CACHE_MAX_ENTRIES;
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  // ---------------------------------------------------------------------------
  // cacheEnabled
  // ---------------------------------------------------------------------------

  it("cacheEnabled defaults to true when env unset", () => {
    delete process.env.API_CACHE_ENABLE;
    expect(cacheEnabled()).toBe(true);
  });

  it("cacheEnabled parses truthy/falsey env values", () => {
    process.env.API_CACHE_ENABLE = "false";
    expect(cacheEnabled()).toBe(false);

    process.env.API_CACHE_ENABLE = "0";
    expect(cacheEnabled()).toBe(false);

    process.env.API_CACHE_ENABLE = "true";
    expect(cacheEnabled()).toBe(true);

    process.env.API_CACHE_ENABLE = "1";
    expect(cacheEnabled()).toBe(true);

    process.env.API_CACHE_ENABLE = "yes";
    expect(cacheEnabled()).toBe(true);

    process.env.API_CACHE_ENABLE = "on";
    expect(cacheEnabled()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // ETag helpers
  // ---------------------------------------------------------------------------

  it("sha3_512_hex is deterministic and lowercase", () => {
    const h1 = sha3_512_hex("hello");
    const h2 = sha3_512_hex("hello");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{128}$/);
  });

  it("makeEtagFromHexDigest returns quoted lowercase string", () => {
    const et = makeEtagFromHexDigest("ABCD");
    expect(et).toBe('"abcd"');
  });

  it("makeEtagFromString/Buffer are stable", () => {
    const a = makeEtagFromString("x");
    const b = makeEtagFromString("x");
    expect(a).toBe(b);

    const buf = Buffer.from("x", "utf8");
    const c = makeEtagFromBuffer(buf);
    expect(c).toBe(a);
  });

  // ---------------------------------------------------------------------------
  // If-None-Match parsing / matching
  // ---------------------------------------------------------------------------

  it("getIfNoneMatch returns null when header missing", () => {
    const req: FakeReq = { headers: {} };
    expect(getIfNoneMatch(req as any)).toBe(null);
  });

  it("getIfNoneMatch handles string or array header values", () => {
    const req1: FakeReq = { headers: { "if-none-match": '"abc"' } };
    expect(getIfNoneMatch(req1 as any)).toBe('"abc"');

    const req2: FakeReq = { headers: { "if-none-match": ['"abc"', '"def"'] } };
    expect(getIfNoneMatch(req2 as any)).toBe('"abc"');
  });

  it("matchesIfNoneMatch matches exact ETag and supports comma-separated list", () => {
    const etag = '"abc"';
    const req: FakeReq = { headers: { "if-none-match": '"nope", "abc", "zzz"' } };
    expect(matchesIfNoneMatch(req as any, etag)).toBe(true);
  });

  it("matchesIfNoneMatch strips weak prefix W/", () => {
    const etag = '"abc"';
    const req: FakeReq = { headers: { "if-none-match": 'W/"abc"' } };
    expect(matchesIfNoneMatch(req as any, etag)).toBe(true);
  });

  it("replyNotModified sets ETag and sends 304", () => {
    const reply = makeReply();
    replyNotModified(reply as any, '"abc"');
    expect(reply.headers["ETag"]).toBe('"abc"');
    expect(reply.statusCode).toBe(304);
  });

  // ---------------------------------------------------------------------------
  // stableJsonStringify
  // ---------------------------------------------------------------------------

  it("stableJsonStringify sorts keys deterministically", () => {
    const a = { b: 2, a: 1, nested: { z: 9, y: 8 } };
    const b = { nested: { y: 8, z: 9 }, a: 1, b: 2 };
    expect(stableJsonStringify(a)).toBe(stableJsonStringify(b));
  });

  it("stableJsonStringify encodes Buffer and Date consistently", () => {
    const d = new Date("2026-02-18T00:00:00.000Z");
    const a = { buf: Buffer.from("hi", "utf8"), date: d };
    const s = stableJsonStringify(a);
    expect(s).toContain(Buffer.from("hi", "utf8").toString("base64"));
    expect(s).toContain(d.toISOString());
  });

  it("stableJsonStringify handles circular structures with [Circular]", () => {
    const o: any = { a: 1 };
    o.self = o;
    const s = stableJsonStringify(o);
    expect(s).toContain("[Circular]");
  });

  // ---------------------------------------------------------------------------
  // stableCacheKey
  // ---------------------------------------------------------------------------

  it("stableCacheKey joins parts with || and stringifies nullish", () => {
    const k = stableCacheKey(["a", 1, true, null, undefined, "z"]);
    expect(k).toBe("a||1||true||||||z");
  });

  // ---------------------------------------------------------------------------
  // ResponseCache core behavior
  // ---------------------------------------------------------------------------

  it("ResponseCache set/get returns entry before expiry and null after expiry", async () => {
    const c = new ResponseCache({ maxEntries: 10 });
    c.set(
      "k1",
      { etag: '"e"', status: 200, headers: { "content-type": "application/json" }, body: { ok: true } },
      0.001 // 1ms
    );

    expect(c.get("k1")).toBeTruthy();

    await new Promise((r) => setTimeout(r, 5));
    expect(c.get("k1")).toBe(null);
  });

  it("ResponseCache implements LRU bump and evicts oldest when capacity exceeded", () => {
    const c = new ResponseCache({ maxEntries: 2 });

    c.set("k1", { etag: '"1"', status: 200, headers: {}, body: "a" }, 10);
    c.set("k2", { etag: '"2"', status: 200, headers: {}, body: "b" }, 10);

    // Touch k1 so it becomes most-recent
    expect(c.get("k1")?.etag).toBe('"1"');

    // Add k3; should evict oldest (k2)
    c.set("k3", { etag: '"3"', status: 200, headers: {}, body: "c" }, 10);

    expect(c.get("k2")).toBe(null);
    expect(c.get("k1")).toBeTruthy();
    expect(c.get("k3")).toBeTruthy();
  });

  it("ResponseCache refuses caching unsafe responses: set-cookie", () => {
    const c = new ResponseCache({ maxEntries: 10 });
    c.set("k", { etag: '"e"', status: 200, headers: { "Set-Cookie": "sid=1" }, body: "x" }, 10);
    expect(c.get("k")).toBe(null);
  });

  it("ResponseCache refuses caching unsafe responses: cache-control private/no-store", () => {
    const c = new ResponseCache({ maxEntries: 10 });

    c.set("k1", { etag: '"e"', status: 200, headers: { "Cache-Control": "private" }, body: "x" }, 10);
    expect(c.get("k1")).toBe(null);

    c.set("k2", { etag: '"e"', status: 200, headers: { "cache-control": "no-store" }, body: "x" }, 10);
    expect(c.get("k2")).toBe(null);
  });

  it("ResponseCache enforces max body size guard and refuses huge entries", () => {
    process.env.API_CACHE_MAX_BODY_BYTES = "1024";
    const c = new ResponseCache({ maxEntries: 10 });

    const big = { s: "a".repeat(5000) };
    c.set("k", { etag: '"e"', status: 200, headers: { "content-type": "application/json" }, body: big }, 10);

    expect(c.get("k")).toBe(null);
  });

  it("ResponseCache clamps max body size to a minimum of 1024 bytes", () => {
    process.env.API_CACHE_MAX_BODY_BYTES = "1"; // will clamp to 1024
    const c = new ResponseCache({ maxEntries: 10 });

    // ~200 bytes, should still cache because clamp lifts limit
    const small = { s: "a".repeat(200) };
    c.set("k", { etag: '"e"', status: 200, headers: { "content-type": "application/json" }, body: small }, 10);

    expect(c.get("k")).toBeTruthy();
  });

  it("ResponseCache delete and clear work", () => {
    const c = new ResponseCache({ maxEntries: 10 });
    c.set("k1", { etag: '"1"', status: 200, headers: {}, body: "a" }, 10);
    c.set("k2", { etag: '"2"', status: 200, headers: {}, body: "b" }, 10);

    c.delete("k1");
    expect(c.get("k1")).toBe(null);
    expect(c.get("k2")).toBeTruthy();

    c.clear();
    expect(c.get("k2")).toBe(null);
  });

  // ---------------------------------------------------------------------------
  // applyCachedResponse
  // ---------------------------------------------------------------------------

  it("applyCachedResponse sets headers + ETag + status + body", () => {
    const reply = makeReply();

    applyCachedResponse(reply as any, {
      etag: '"abc"',
      status: 200,
      headers: { "content-type": "application/json", "x-test": "1" },
      body: { ok: true },
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + 10_000,
    });

    expect(reply.headers["content-type"]).toBe("application/json");
    expect(reply.headers["x-test"]).toBe("1");
    expect(reply.headers["ETag"]).toBe('"abc"');
    expect(reply.statusCode).toBe(200);
    expect(reply.sent).toEqual({ ok: true });
  });

  it("applyCachedResponse does not write empty header values", () => {
    const reply = makeReply();

    applyCachedResponse(reply as any, {
      etag: '"abc"',
      status: 200,
      headers: { "x-a": "", "x-b": "ok" },
      body: "x",
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + 10_000,
    });

    expect(reply.headers["x-a"]).toBeUndefined();
    expect(reply.headers["x-b"]).toBe("ok");
    expect(reply.headers["ETag"]).toBe('"abc"');
  });
});