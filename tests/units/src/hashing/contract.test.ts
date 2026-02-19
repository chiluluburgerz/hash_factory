import { describe, it, expect } from "vitest";
import { hashRaw, hashJson, hashRawDigest, hashJsonDigest } from "../../../../src/hashing/contract.js";
import { canonicalize } from "../../../../src/hashing/canonicalJson.js";
import { frame } from "../../../../src/hashing/domain.js";

function isHexLower(s: string): boolean {
  return typeof s === "string" && /^[0-9a-f]+$/.test(s);
}

describe("hashing/contract.ts (unit)", () => {
  it("hashRaw validates input bytes", () => {
    expect(() => hashRaw({ domain: "hf:test", bytes: null as any })).toThrow("hashRaw_invalid_bytes");
    expect(() => hashRaw({ domain: "hf:test", bytes: "nope" as any })).toThrow("hashRaw_invalid_bytes");
  });

  it("hashRaw returns deterministic digest + metadata + internal bytes", () => {
    const domain = "hf:test";
    const payload = new Uint8Array([1, 2, 3, 4]);

    const a = hashRaw({ domain, bytes: payload });
    const b = hashRaw({ domain, bytes: payload });

    expect(a.domain).toBe(domain);
    expect(a.digest).toBe(b.digest);
    expect(a.info).toMatchObject({
      contractId: "hf-contract-v1",
      frame: "hf:frame:v1",
      canonicalJson: "hf:canonical-json:v1",
      algorithm: "sha3-512",
      encoding: "hex_lower",
    });

    // sha3-512 digest bytes are 64 bytes; hex_lower is 128 chars
    expect(a.digestBytes).toBeInstanceOf(Uint8Array);
    expect(a.digestBytes.byteLength).toBe(64);
    expect(a.digest).toHaveLength(128);
    expect(isHexLower(a.digest)).toBe(true);

    expect(a.payloadBytes).toBe(payload);

    // framedBytes must equal frame(domain, payload)
    const framed = frame(domain, payload);
    expect(Buffer.from(a.framedBytes)).toEqual(Buffer.from(framed));

    // object is frozen (contract output should not be mutated)
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.info)).toBe(true);

    // convenience matches
    expect(hashRawDigest({ domain, bytes: payload })).toBe(a.digest);
  });

  it("hashJson canonicalizes value and frames canonical bytes before hashing", () => {
    const domain = "hf:test";
    const value = { b: 2, a: 1 };

    const out = hashJson({ domain, value });

    const payloadBytes = canonicalize(value);
    const framed = frame(domain, payloadBytes);

    expect(Buffer.from(out.payloadBytes)).toEqual(Buffer.from(payloadBytes));
    expect(Buffer.from(out.framedBytes)).toEqual(Buffer.from(framed));

    expect(out.digestBytes.byteLength).toBe(64);
    expect(out.digest).toHaveLength(128);
    expect(isHexLower(out.digest)).toBe(true);

    expect(hashJsonDigest({ domain, value })).toBe(out.digest);
  }); 

  it("supports explicit encoding/alg passthrough in info (even if current impl only has sha3-512)", () => {
    // This test asserts the contract surface carries through opts into info.
    const out = hashRaw({ domain: "hf:test", bytes: new Uint8Array([9]), alg: "sha3-512", encoding: "hex_lower" });
    expect(out.info.algorithm).toBe("sha3-512");
    expect(out.info.encoding).toBe("hex_lower");
  });

  it("hashJson is deterministic across calls", () => {
    const domain = "hf:test";
    const value = { z: [3, 2, 1], a: { b: "x" } };
    const a = hashJson({ domain, value }).digest;
    const b = hashJson({ domain, value }).digest;
    expect(a).toBe(b);
  });
});