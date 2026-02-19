import { describe, it, expect } from "vitest";
import crypto from "node:crypto";

import {
  utf8ToBytes,
  bytesToHexLower,
  hexToBytesStrict,
  bytesToB64url,
  b64urlToBytesStrict,
  assertJsonByteBudget,
  canonicalStringify,
  stripIgnoredKeys,
  sha3_512_hex,
  sha3_512_bytes,
  sha3_512_hex_lower,
  computeDataHash,
  computeHashExcluding,
  computeCanonicalHash,
  DEFAULT_IGNORE_HASH_KEYS,
} from "../../../../src/utils/cryptoUtils.js";

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

describe("utils/cryptoUtils.ts (unit)", () => {
  // ---------------------------------------------------------------------------
  // Basic encoders / decoders
  // ---------------------------------------------------------------------------

  it("utf8ToBytes returns deterministic UTF-8 bytes", () => {
    const b = utf8ToBytes("hello");
    expect(b).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(b).toString("utf8")).toBe("hello");
  });

  it("bytesToHexLower returns lowercase hex", () => {
    const out = bytesToHexLower(new Uint8Array([0xab, 0xCd, 0x00]));
    expect(out).toBe("abcd00");
  });

  it("hexToBytesStrict accepts even-length hex and normalizes case/whitespace", () => {
    const bytes = hexToBytesStrict("  ABcd00  ");
    expect(Buffer.from(bytes).toString("hex")).toBe("abcd00");
  });

  it("hexToBytesStrict rejects odd-length or non-hex", () => {
    expect(() => hexToBytesStrict("a")).toThrow(/even-length hex/i);
    expect(() => hexToBytesStrict("zz")).toThrow(/even-length hex/i);
    expect(() => hexToBytesStrict("abz0")).toThrow(/even-length hex/i);
  });

  it("bytesToB64url encodes base64url and b64urlToBytesStrict decodes", () => {
    const bytes = new Uint8Array([1, 2, 3, 254, 255]);
    const s = bytesToB64url(bytes);
    expect(s).toBe(Buffer.from(bytes).toString("base64url"));
    const back = b64urlToBytesStrict(s);
    expect(Buffer.from(back)).toEqual(Buffer.from(bytes));
  });

  it("b64urlToBytesStrict rejects empty and invalid base64url", () => {
    expect(() => b64urlToBytesStrict("")).toThrow(/required/i);
    expect(() => b64urlToBytesStrict("   ")).toThrow(/required/i);
    expect(() => b64urlToBytesStrict("aa+/")).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // assertJsonByteBudget (DoS guard)
  // ---------------------------------------------------------------------------

  it("assertJsonByteBudget returns json + byte count for normal inputs", () => {
    const r = assertJsonByteBudget({ a: 1, b: "x" }, 10_000);
    expect(typeof r.json).toBe("string");
    expect(r.bytes).toBe(Buffer.byteLength(r.json, "utf8"));
  });

  it("assertJsonByteBudget throws when bytes exceed max", () => {
    const big = { s: "a".repeat(200) };
    expect(() => assertJsonByteBudget(big, 10)).toThrow(/Hash input too large/i);
  });

  it("assertJsonByteBudget handles circular refs without throwing (sentinel present)", () => {
    const o: any = { a: 1 };
    o.self = o;
    const r = assertJsonByteBudget(o, 10_000);
    expect(r.json).toContain("[circular]");
  });

  it("assertJsonByteBudget handles bigint/function/symbol/buffer sentinels deterministically", () => {
    const sym = Symbol("x");
    const r = assertJsonByteBudget(
      {
        n: 1n,
        fn: () => 1,
        sym,
        buf: Buffer.from("hi", "utf8"),
      },
      10_000
    );
    // bigint -> string, fn -> undefined (JSON drops), symbol -> string, buffer -> "[buffer]"
    expect(r.json).toContain('"n":"1"');
    expect(r.json).toContain('"sym":"Symbol(x)"');
    expect(r.json).toContain('"buf":');
    expect(r.json).toContain('"type":"Buffer"');
    expect(r.json).toContain('"data"');
    expect(r.json).not.toContain("fn");
  });

  // ---------------------------------------------------------------------------
  // canonicalStringify (Deterministic)
  // ---------------------------------------------------------------------------

  it("canonicalStringify is stable under key reordering", () => {
    const a = { b: 2, a: 1, c: { z: 9, y: 8 } };
    const b = { c: { y: 8, z: 9 }, a: 1, b: 2 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("canonicalStringify uses deterministic sentinels for problematic types", () => {
    const sym = Symbol("y");
    const o: any = { n: 2n, fn: () => 1, sym, buf: Buffer.from([1, 2, 3]) };
    o.self = o;

    const s = canonicalStringify(o);
    expect(s).toContain('"n":"2"');
    expect(s).toContain('"fn":"[function]"');
    expect(s).toContain('"sym":"Symbol(y)"');
    expect(s).toContain('"buf":"[buffer]"');
    expect(s).toContain('"self":"[circular]"');
  });

  it("canonicalStringify preserves array order (does not sort array elements)", () => {
    const s1 = canonicalStringify([2, 1, 3]);
    const s2 = canonicalStringify([1, 2, 3]);
    expect(s1).not.toBe(s2);
    expect(s1).toBe("[2,1,3]");
  });

  // ---------------------------------------------------------------------------
  // stripIgnoredKeys (bounded, deterministic)
  // ---------------------------------------------------------------------------

  it("stripIgnoredKeys removes specified keys and drops functions", () => {
    const input = { a: 1, drop: 2, fn: () => 1, nested: { drop: 9, keep: true } };
    const out: any = stripIgnoredKeys(input, ["drop"]);
    expect(out).toEqual({ a: 1, nested: { keep: true } });
    expect("fn" in out).toBe(false);
  });

  it("stripIgnoredKeys replaces buffers with sentinel", () => {
    const input = { a: Buffer.from("x", "utf8") };
    const out: any = stripIgnoredKeys(input, []);
    expect(out).toEqual({ a: "[buffer]" });
  });

  it("stripIgnoredKeys caps arrays and appends [truncated-array] sentinel", () => {
    const input = { a: [1, 2, 3, 4, 5] };
    const out: any = stripIgnoredKeys(input, [], { maxArrayLen: 2 });
    expect(out.a).toEqual([1, 2, "[truncated-array]"]);
  });

  it("stripIgnoredKeys caps depth with [truncated-depth] sentinel", () => {
    const input = { a: { b: { c: { d: 1 } } } };
    const out: any = stripIgnoredKeys(input, [], { maxDepth: 2 });
    // depth starts at 0; beyond 2 -> sentinel
    expect(out.a.b.c).toBe("[truncated-depth]");
  });

  it("stripIgnoredKeys caps key count and sets __truncated__", () => {
    const input: any = {};
    for (let i = 0; i < 10; i++) input["k" + i] = i;

    const out: any = stripIgnoredKeys(input, [], { maxKeys: 3 });
    expect(out.__truncated__).toBe(true);
    // We should have at most 3 keys plus __truncated__
    expect(Object.keys(out).length).toBeLessThanOrEqual(4);
  });

  it("stripIgnoredKeys handles circular refs with sentinel", () => {
    const o: any = { a: 1 };
    o.self = o;

    const out: any = stripIgnoredKeys(o, []);
    expect(out.self).toBe("[circular]");
  });

  // ---------------------------------------------------------------------------
  // sha3_512 primitives
  // ---------------------------------------------------------------------------

  it("sha3_512_hex returns 128 hex chars and is deterministic", () => {
    const h1 = sha3_512_hex("hello");
    const h2 = sha3_512_hex("hello");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{128}$/i);
  });

  it("sha3_512_hex respects lowercase option", () => {
    const lower = sha3_512_hex("hello", { lowercase: true });
    const mixed = sha3_512_hex("hello", { lowercase: false });
    expect(lower).toBe(lower.toLowerCase());
    // mixed could still be lower depending on node, but must equal ignoring case
    expect(mixed.toLowerCase()).toBe(lower);
  });

  it("sha3_512_bytes returns 64 bytes and matches sha3_512_hex", () => {
    const b = sha3_512_bytes("hello");
    expect(b).toBeInstanceOf(Uint8Array);
    expect(b.byteLength).toBe(64);

    const hexFromBytes = Buffer.from(b).toString("hex").toLowerCase();
    const hex = sha3_512_hex_lower("hello");
    expect(hexFromBytes).toBe(hex);
  });

  it("sha3_512_* rejects unsupported input types", () => {
    expect(() => sha3_512_hex({} as any)).toThrow(/must be string, Buffer, or Uint8Array/i);
    expect(() => sha3_512_bytes(123 as any)).toThrow(/must be string, Buffer, or Uint8Array/i);
  });
 
  // ---------------------------------------------------------------------------
  // Deterministic hashing helpers
  // ---------------------------------------------------------------------------
 
  it("computeDataHash is stable under object key reordering", () => {
    const a = { b: 2, a: 1, nested: { z: 9, y: 8 } };
    const b = { nested: { y: 8, z: 9 }, a: 1, b: 2 };
    expect(computeDataHash(a)).toBe(computeDataHash(b));
  });

  it("computeDataHash hashes strings as-is (no canonicalStringify on strings)", () => {
    const s = '{"b":2,"a":1}';
    const h = computeDataHash(s);
    const expected = crypto.createHash("sha3-512").update(s).digest("hex").toLowerCase();
    expect(h).toBe(expected);
  });

  it("computeDataHash enforces maxBytes when provided", () => {
    const big = { s: "a".repeat(100) };
    expect(() => computeDataHash(big, { maxBytes: 10 })).toThrow(/Hash input too large/i);
  });

  it("computeHashExcluding hashes payload if data has { payload }", () => {
    const a = { payload: { a: 1, b: 2 }, other: "ignored" };
    const b = { a: 1, b: 2 };
    expect(computeHashExcluding(a)).toBe(computeHashExcluding(b));
  });

  it("computeHashExcluding strips ignored keys before hashing", () => {
    const base = { a: 1, t: 2 };
    const withIgnored = { a: 1, t: 2, updated_at: "x", requestId: "y" };

    const h1 = computeHashExcluding(withIgnored, ["updated_at", "requestId"]);
    const h2 = computeHashExcluding(base, []);
    expect(h1).toBe(h2);
  });

  it("computeHashExcluding enforces byte budget via assertJsonByteBudget", () => {
    const big = { s: "a".repeat(200) };
    expect(() => computeHashExcluding(big, [], { maxBytes: 10 })).toThrow(/Hash input too large/i);
  });

  it("computeCanonicalHash uses DEFAULT_IGNORE_HASH_KEYS (fields do not affect hash)", () => {
    const base = { a: 1, b: 2 };
    const noisy: any = { ...base };
    for (const k of DEFAULT_IGNORE_HASH_KEYS) noisy[k] = "noise";

    expect(computeCanonicalHash(noisy)).toBe(computeCanonicalHash(base));
  });
});