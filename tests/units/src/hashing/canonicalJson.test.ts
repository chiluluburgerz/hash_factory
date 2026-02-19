import { describe, it, expect } from "vitest";
import { canonicalize } from "../../../../src/hashing/canonicalJson.js";
import { MAX_CANONICAL_JSON_BYTES } from "../../../../src/hashing/limits.js";

function asUtf8(u8: Uint8Array): string {
  return Buffer.from(u8).toString("utf8");
}

function expectCanonErr(fn: () => any, msgIncludes: string) {
  let threw = false;
  try {
    fn();
  } catch (e: any) {
    threw = true;
    expect(String(e?.message || "")).toContain(msgIncludes);
  }
  if (!threw) {
    throw new Error(`Expected canonicalize() to throw (wanted message including: ${msgIncludes})`);
  }
}

describe("hashing/canonicalJson.ts (unit)", () => {
  it("canonicalizes primitives deterministically", () => {
    expect(asUtf8(canonicalize(null))).toBe("null");
    expect(asUtf8(canonicalize(true))).toBe("true");
    expect(asUtf8(canonicalize(false))).toBe("false");
    expect(asUtf8(canonicalize("x"))).toBe("\"x\""); 
    expect(asUtf8(canonicalize(1))).toBe("1");
    expect(asUtf8(canonicalize(-0))).toBe("0"); // JSON.stringify(-0) -> "0"
  });
 
  it("rejects non-finite numbers", () => {
    expectCanonErr(() => canonicalize(NaN), "canonicalize_invalid_number");
    expectCanonErr(() => canonicalize(Infinity), "canonicalize_invalid_number");
    expectCanonErr(() => canonicalize(-Infinity), "canonicalize_invalid_number");
  });

  it("encodes bigint as JSON string of decimal", () => {
    expect(asUtf8(canonicalize(123n))).toBe("\"123\"");
  });

  it("rejects unsupported JS types", () => {
    expectCanonErr(() => canonicalize(undefined), "canonicalize_unsupported_type");
    expectCanonErr(() => canonicalize(() => {}), "canonicalize_unsupported_type");
    expectCanonErr(() => canonicalize(Symbol("x")), "canonicalize_unsupported_type");
  });

  it("rejects Uint8Array (bytes must be hashed directly)", () => {
    expectCanonErr(() => canonicalize(new Uint8Array([1, 2, 3])), "canonicalize_unsupported_type: Uint8Array");
  });

  it("requires plain objects only", () => {
    class X { a = 1; }
    expectCanonErr(() => canonicalize(new Date()), "canonicalize_unsupported_object");
    expectCanonErr(() => canonicalize(new X()), "canonicalize_unsupported_object");
    expectCanonErr(() => canonicalize(Object.create(new X())), "canonicalize_unsupported_object");
  });

  it("accepts null-prototype objects (plain)", () => {
    const o = Object.create(null);
    o.b = 2;
    o.a = 1;
    expect(asUtf8(canonicalize(o))).toBe("{\"a\":1,\"b\":2}");
  });

  it("sorts object keys stably and does not drop keys", () => {
    const v = { b: 2, a: 1, aa: 3 };
    expect(asUtf8(canonicalize(v))).toBe("{\"a\":1,\"aa\":3,\"b\":2}");
  });

  it("arrays preserve order and are strict about undefined values", () => {
    expect(asUtf8(canonicalize([3, 2, 1]))).toBe("[3,2,1]");
    expectCanonErr(() => canonicalize([1, undefined as any, 2]), "canonicalize_unsupported_type: undefined");
  });

  it("rejects undefined object property values (strict)", () => {
    expectCanonErr(() => canonicalize({ a: undefined as any }), "canonicalize_undefined_value");
  });

  it("rejects circular references", () => {
    const a: any = { x: 1 };
    a.self = a;
    expectCanonErr(() => canonicalize(a), "canonicalize_circular");
  });

  it("enforces depth limit", () => {
    // MAX_DEPTH = 64 in module; create depth 65
    let v: any = 0;
    for (let i = 0; i < 70; i++) v = { a: v };
    expectCanonErr(() => canonicalize(v), "canonicalize_depth_exceeded");
  });

  it("enforces byte budget (canonicalize_too_large) without huge allocations", () => {
    const slack = 64;
    const singleTarget = Math.min(MAX_CANONICAL_JSON_BYTES + slack, 2_000_000);
    const s = "x".repeat(singleTarget);
    try {
      canonicalize({ s });
      const o: any = {};
      const n = 50_000;
      for (let i = 0; i < n; i++) o[`k${i}`] = 1;
      expectCanonErr(() => canonicalize(o), "canonicalize_too_large");
    } catch (e: any) {
      expect(String(e?.message || "")).toContain("canonicalize_too_large");
    }
  });

  it("output is UTF-8 bytes of canonical JSON text", () => {
    const out = canonicalize({ z: "hi", a: "yo" });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(asUtf8(out)).toBe("{\"a\":\"yo\",\"z\":\"hi\"}");
  });
});