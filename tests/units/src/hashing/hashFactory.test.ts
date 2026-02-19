import { describe, it, expect } from "vitest";
import { hashJson, hashUtf8, hashRaw } from "../../../../src/hashing/hashFactory.js";
import { CANONICAL_JSON_ID } from "../../../../src/hashing/types.js";
import { frame } from "../../../../src/hashing/domain.js";
import { canonicalize } from "../../../../src/hashing/canonicalJson.js";
import { hashBytes, encodeDigest } from "../../../../src/hashing/hash.js";
import { MAX_PAYLOAD_BYTES } from "../../../../src/hashing/limits.js";

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(String(s), "base64url");
}

describe("hashing/hashFactory.ts (unit)", () => {
  it("hashJson rejects unsupported canon id", () => {
    expect(() =>
      hashJson({
        domain: "hf:test",
        canon: "hf:canonical-json:v0" as any,
        value: { a: 1 },
      })
    ).toThrow(/hashJson_unsupported_canon/);
  });

  it("hashJson returns v1 json envelope with canonical_json field", () => {
    const env = hashJson({ domain: "hf:test", value: { b: 2, a: 1 } });

    expect(env).toMatchObject({
      v: "v1",
      kind: "json",
      contract_id: "hf-contract-v1",
      frame: "hf:frame:v1",
      canonical_json: CANONICAL_JSON_ID,
      alg: "sha3-512",
      encoding: "hex_lower",
      domain: "hf:test",
    });

    // Determinism: same inputs => same digest
    const env2 = hashJson({ domain: "hf:test", value: { a: 1, b: 2 } });
    expect(env.digest).toBe(env2.digest);

    // Lengths should be sane and positive
    expect(env.payload_bytes_len).toBeGreaterThan(0);
    expect(env.framed_bytes_len).toBeGreaterThan(env.payload_bytes_len);
  });

  it("hashUtf8 hashes raw UTF-8 bytes under the domain (kind=utf8)", () => {
    const env = hashUtf8({ domain: "hf:text", text: "hello" });

    expect(env).toMatchObject({
      v: "v1",
      kind: "utf8",
      contract_id: "hf-contract-v1",
      frame: "hf:frame:v1",
      alg: "sha3-512",
      encoding: "hex_lower",
      domain: "hf:text",
    });

    // Verify digest equals manual: digest = H(frame(domain, utf8bytes))
    const payloadBytes = Buffer.from("hello", "utf8");
    const framed = frame("hf:text", payloadBytes);
    const digestBytes = hashBytes({ alg: "sha3-512", bytes: framed });
    const expectedDigest = encodeDigest({ encoding: "hex_lower", digestBytes });

    expect(env.digest).toBe(expectedDigest);
    expect(env.payload_bytes_len).toBe(payloadBytes.byteLength);
    expect(env.framed_bytes_len).toBe(framed.byteLength);
  });

  it("hashRaw hashes provided bytes under the domain (kind=raw)", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const env = hashRaw({ domain: "hf:raw", bytes });

    expect(env).toMatchObject({
      v: "v1",
      kind: "raw",
      contract_id: "hf-contract-v1",
      frame: "hf:frame:v1",
      alg: "sha3-512",
      encoding: "hex_lower",
      domain: "hf:raw",
    });

    const framed = frame("hf:raw", bytes);
    const digestBytes = hashBytes({ alg: "sha3-512", bytes: framed });
    const expectedDigest = encodeDigest({ encoding: "hex_lower", digestBytes });

    expect(env.digest).toBe(expectedDigest);
  });

  it("include flags add deterministic material fields (digest/payload/framed)", () => {
    const env = hashJson({
      domain: "hf:inc",
      value: { a: 1 },
      include: {
        includeDigestBytes: true,
        includePayloadBytes: true,
        includeFramedBytes: true,
      },
    });

    expect(env.kind).toBe("json");
    expect((env as any).digest_bytes_b64url).toBeTruthy();
    expect((env as any).payload_b64url).toBeTruthy();
    expect((env as any).framed_b64url).toBeTruthy();

    const payload = canonicalize({ a: 1 });
    const framed = frame("hf:inc", payload);

    expect(b64urlToBuf((env as any).payload_b64url)).toEqual(Buffer.from(payload));
    expect(b64urlToBuf((env as any).framed_b64url)).toEqual(Buffer.from(framed)); 

    const digestBytes = hashBytes({ alg: "sha3-512", bytes: framed });
    expect(b64urlToBuf((env as any).digest_bytes_b64url)).toEqual(Buffer.from(digestBytes));
  });

  it("include flags default to false (no optional fields)", () => {
    const env = hashRaw({ domain: "hf:none", bytes: new Uint8Array([9]) });

    expect((env as any).digest_bytes_b64url).toBeUndefined();
    expect((env as any).payload_b64url).toBeUndefined();
    expect((env as any).framed_b64url).toBeUndefined();
  });

  it("hashUtf8 rejects payload too large (byte-length, not char count)", () => {
    // Avoid huge allocations: just exceed MAX_PAYLOAD_BYTES with a controlled buffer
    const n = Math.min(MAX_PAYLOAD_BYTES + 1, MAX_PAYLOAD_BYTES + 1);
    const bigBuf = Buffer.allocUnsafe(n).fill(0x61); // 'a'
    const bigText = bigBuf.toString("utf8");

    // Some UTF-8 conversions could shrink if invalid sequences existed, but ours are valid.
    expect(() => hashUtf8({ domain: "hf:big", text: bigText })).toThrow(/hashUtf8_payload_too_large/);
  });

  it("supports per-call alg/encoding overrides and preserves them in envelope", () => {
    const env = hashRaw({
      domain: "hf:ovr",
      bytes: new Uint8Array([1, 2, 3]),
      alg: "sha3-512",
      encoding: "base64url",
      include: { includeDigestBytes: true },
    });
 
    expect(env.alg).toBe("sha3-512");
    expect(env.encoding).toBe("base64url");
    expect((env as any).digest_bytes_b64url).toBeTruthy();

    // digest string should be base64url and decode back to digest bytes
    const framed = frame("hf:ovr", new Uint8Array([1, 2, 3]));
    const digestBytes = hashBytes({ alg: "sha3-512", bytes: framed });
    const decoded = b64urlToBuf(String(env.digest));
    expect(decoded).toEqual(Buffer.from(digestBytes));
  });

  it("returns frozen envelopes (defense-in-depth)", () => {
    const env = hashJson({ domain: "hf:freeze", value: { a: 1 } });
    expect(Object.isFrozen(env)).toBe(true);
  });
});