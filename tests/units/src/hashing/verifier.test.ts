import { describe, it, expect } from "vitest";
import { verifyEnvelope } from "../../../../src/hashing/verifier.js";
import { hashJson, hashUtf8, hashRaw } from "../../../../src/hashing/hashFactory.js";
import { canonicalize } from "../../../../src/hashing/canonicalJson.js";
import { frame } from "../../../../src/hashing/domain.js";
import { hashBytes, encodeDigest } from "../../../../src/hashing/hash.js";

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function expectVerifyErr(fn: () => any, msgIncludes: string, code?: string, statusCode?: number) {
  try {
    fn();
    throw new Error("Expected verifyEnvelope() to throw");
  } catch (e: any) {
    expect(e?.name).toBe("HashValidationError");
    expect(String(e?.message || "")).toContain(msgIncludes);
    if (code) expect(String(e?.code || "")).toBe(code);
    if (statusCode) expect(Number(e?.statusCode)).toBe(statusCode);
  }
}

/**
 * Envelopes returned by hashFactory are frozen.
 * For negative tests, clone into a mutable plain object.
 */
function cloneEnv<T extends object>(env: T): any {
  return { ...(env as any) };
}

describe("hashing/verifier.ts (unit)", () => {
  it("verifies json envelope using provided { value } (ok=true)", () => {
    const env = hashJson({ domain: "hf:vj", value: { b: 2, a: 1 } });
    const res = verifyEnvelope(env, { value: { a: 1, b: 2 } });

    expect(res.ok).toBe(true);
    expect(res.expected_digest).toBe(env.digest);
    expect(res.actual_digest).toBe(env.digest);
    expect(res.mismatches.length).toBe(0);
  });

  it("verifies json envelope using envelope.payload_b64url when material missing", () => {
    const env = hashJson({
      domain: "hf:vj2",
      value: { a: 1 },
      include: { includePayloadBytes: true },
    });

    const res = verifyEnvelope(env);
    expect(res.ok).toBe(true);
    expect(res.expected_digest).toBe(env.digest);
  });

  it("rejects json verification when missing both { value } and envelope.payload_b64url", () => {
    const env0 = hashJson({ domain: "hf:vj3", value: { a: 1 } }) as any;
    const env = cloneEnv(env0);
    delete env.payload_b64url;

    expectVerifyErr(
      () => verifyEnvelope(env),
      "verifyEnvelope_missing_material: json requires",
      "VERIFY_MISSING_MATERIAL",
      400
    );
  });

  it("verifies utf8 envelope with provided { text }", () => {
    const env = hashUtf8({ domain: "hf:vt", text: "hello" });
    const res = verifyEnvelope(env, { text: "hello" });
    expect(res.ok).toBe(true);
    expect(res.mismatches.length).toBe(0);
  });

  it("verifies utf8 envelope using envelope.payload_b64url if present", () => {
    const env = hashUtf8({
      domain: "hf:vt2",
      text: "hello",
      include: { includePayloadBytes: true },
    });
    const res = verifyEnvelope(env);
    expect(res.ok).toBe(true);
  });

  it("verifies raw envelope with provided { bytes }", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const env = hashRaw({ domain: "hf:vr", bytes });
    const res = verifyEnvelope(env, { bytes });
    expect(res.ok).toBe(true);
  });

  it("verifies raw envelope with provided { bytes_b64url }", () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const env = hashRaw({ domain: "hf:vr2", bytes });
    const res = verifyEnvelope(env, { bytes_b64url: b64url(bytes) });
    expect(res.ok).toBe(true);
  });

  it("rejects raw verification when missing both material and envelope.payload_b64url", () => {
    const env0 = hashRaw({ domain: "hf:vr3", bytes: new Uint8Array([9]) }) as any;
    const env = cloneEnv(env0);
    delete env.payload_b64url;

    expectVerifyErr(
      () => verifyEnvelope(env),
      "verifyEnvelope_missing_material: raw requires",
      "VERIFY_MISSING_MATERIAL",
      400
    );
  });

  it("detects digest mismatch and reports it", () => {
    const env0 = hashUtf8({ domain: "hf:mm", text: "hello" }) as any;
    const env = cloneEnv(env0);
    env.digest = "0".repeat(String(env.digest).length);

    const res = verifyEnvelope(env, { text: "hello" });
    expect(res.ok).toBe(false);

    const d = res.mismatches.find((m) => m.field === "digest");
    expect(d).toBeTruthy();
    expect(d?.expected).not.toBe(d?.actual);
  });

  it("detects payload_bytes_len mismatch and framed_bytes_len mismatch", () => {
    const env0 = hashUtf8({ domain: "hf:len", text: "hello" }) as any;
    const env = cloneEnv(env0);
    env.payload_bytes_len = 999;
    env.framed_bytes_len = 1;

    const res = verifyEnvelope(env, { text: "hello" });
    expect(res.ok).toBe(false);

    expect(res.mismatches.some((m) => m.field === "payload_bytes_len")).toBe(true);
    expect(res.mismatches.some((m) => m.field === "framed_bytes_len")).toBe(true);
  });

  it("rejects envelope when digest_bytes_b64url does not match digest (validator invariant)", () => {
    const env0 = hashRaw({
        domain: "hf:db",
        bytes: new Uint8Array([1, 2, 3]),
        include: { includeDigestBytes: true },
    }) as any;

    // sanity: valid envelope verifies
    const ok = verifyEnvelope(env0, { bytes: new Uint8Array([1, 2, 3]) });
    expect(ok.ok).toBe(true);

    // tamper digest_bytes_b64url but keep digest unchanged => validator should reject
    const env = cloneEnv(env0);
    env.digest_bytes_b64url = b64url(new Uint8Array(64).fill(0xaa));

    expectVerifyErr(() => verifyEnvelope(env, { bytes: new Uint8Array([1, 2, 3]) }), "digest_bytes_mismatch_digest", "SCHEMA_INVALID", 400);
  });

  it("validates declared framed_b64url against computed framed bytes", () => {
    const env0 = hashUtf8({
      domain: "hf:fb",
      text: "hello",
      include: { includeFramedBytes: true },
    }) as any;

    const ok = verifyEnvelope(env0, { text: "hello" });
    expect(ok.ok).toBe(true);

    const env = cloneEnv(env0);
    env.framed_b64url = b64url(new Uint8Array(env.framed_bytes_len).fill(0x01));

    const res = verifyEnvelope(env, { text: "hello" });
    expect(res.ok).toBe(false);
    expect(res.mismatches.some((m) => m.field === "framed_b64url")).toBe(true);
  });

  it("for json: if payload_b64url is declared, it must match canonicalize(value)", () => {
    const env0 = hashJson({
      domain: "hf:pj",
      value: { a: 1 },
      include: { includePayloadBytes: true },
    }) as any;

    const goodPayload = canonicalize({ a: 1 });
    const badPayload = new Uint8Array(goodPayload);
    badPayload[badPayload.length - 1] ^= 0xff;

    const env = cloneEnv(env0);
    env.payload_b64url = b64url(badPayload);

    const res = verifyEnvelope(env, { value: { a: 1 } });
    expect(res.ok).toBe(false);
    expect(res.mismatches.some((m) => m.field === "payload_b64url")).toBe(true);
  });

  it("works without any optional envelope material fields (recompute only)", () => {
    const env0 = hashRaw({ domain: "hf:bare", bytes: new Uint8Array([7, 8]) }) as any;
    const env = cloneEnv(env0);
    delete env.payload_b64url;
    delete env.framed_b64url;
    delete env.digest_bytes_b64url;

    const res = verifyEnvelope(env, { bytes: new Uint8Array([7, 8]) });
    expect(res.ok).toBe(true);
  });

  it("rejects invalid envelope input via validator (schema hardening)", () => {
    expectVerifyErr(
      () => verifyEnvelope({ v: "v1", kind: "raw" } as any),
      "schema_invalid_string",
      "SCHEMA_INVALID"
    );
  });

  it("manual cross-check: expected digest equals H(frame(domain, payloadBytes)) for raw", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const env = hashRaw({ domain: "hf:mc", bytes, encoding: "hex_lower" });

    const framed = frame("hf:mc", bytes);
    const digestBytes = hashBytes({ alg: "sha3-512", bytes: framed });
    const expected = encodeDigest({ encoding: "hex_lower", digestBytes });

    const res = verifyEnvelope(env, { bytes });
    expect(res.ok).toBe(true);
    expect(res.expected_digest).toBe(expected);
  });
});