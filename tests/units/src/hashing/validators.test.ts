import { describe, it, expect } from "vitest";
import {
  parseHashRequestV1,
  parseHashEnvelopeV1,
  HashValidationError,
} from "../../../../src/hashing/validators.js";
import { hashJson, hashUtf8, hashRaw } from "../../../../src/hashing/hashFactory.js";
import { hashBytes, encodeDigest } from "../../../../src/hashing/hash.js";
import { frame } from "../../../../src/hashing/domain.js";
import {
  CANONICAL_JSON_ID,
  HASH_FACTORY_CONTRACT_ID,
  FRAME_ID,
} from "../../../../src/hashing/types.js";
import { MAX_PAYLOAD_BYTES, SHA3_512_BYTES } from "../../../../src/hashing/limits.js";

function expectValErr(fn: () => any, msgIncludes: string, code?: string) {
  try {
    fn();
    throw new Error("Expected HashValidationError");
  } catch (e: any) {
    expect(e?.name).toBe("HashValidationError");
    expect(String(e?.message || "")).toContain(msgIncludes);
    if (code) expect(String(e?.code || "")).toBe(code);
  }
}

function expectB64UrlErr(fn: () => any, msgIncludes?: string) {
  try {
    fn();
    throw new Error("Expected Base64UrlError");
  } catch (e: any) {
    expect(e?.name).toBe("Base64UrlError");
    if (msgIncludes) expect(String(e?.message || "")).toContain(msgIncludes);
  }
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

describe("hashing/validators.ts (unit)", () => {
  // ---------------------------------------------------------------------------
  // parseHashRequestV1
  // ---------------------------------------------------------------------------

  it("rejects non-object request bodies", () => {
    expectValErr(() => parseHashRequestV1(null as any), "request_invalid_body", "SCHEMA_INVALID");
    expectValErr(() => parseHashRequestV1([] as any), "request_invalid_body", "SCHEMA_INVALID");
    expectValErr(() => parseHashRequestV1("x" as any), "request_invalid_body", "SCHEMA_INVALID");
  });

  it("rejects invalid version/kind and unknown top-level keys", () => {
    expectValErr(() => parseHashRequestV1({ v: "v0", kind: "json", domain: "hf:test", value: {} } as any), "request_invalid_version");
    expectValErr(() => parseHashRequestV1({ v: "v1", kind: "nope", domain: "hf:test" } as any), "kind_invalid");

    // unknown key (json kind allowed keys are strict)
    expectValErr(
      () => parseHashRequestV1({ v: "v1", kind: "json", domain: "hf:test", value: {}, extra: 1 } as any),
      "HashRequestV1.json_unknown_key",
      "SCHEMA_UNKNOWN_KEY"
    );
  });

  it("parses json request; canon defaults and rejects unsupported canon id", () => {
    const r1 = parseHashRequestV1({ v: "v1", kind: "json", domain: "hf:test", value: { a: 1 } });
    expect(r1).toMatchObject({ v: "v1", kind: "json", domain: "hf:test" });

    // If canon provided, it must be v1 id and returned normalized to CANONICAL_JSON_ID
    const r2 = parseHashRequestV1({ v: "v1", kind: "json", domain: "hf:test", canon: CANONICAL_JSON_ID, value: { a: 1 } });
    expect(r2).toMatchObject({ canon: CANONICAL_JSON_ID });

    expectValErr(
      () => parseHashRequestV1({ v: "v1", kind: "json", domain: "hf:test", canon: "hf:canonical-json:v0", value: { a: 1 } } as any),
      "canon_unsupported",
      "SCHEMA_INVALID"
    );
  });

  it("parses utf8 request; enforces byte length cap", () => {
    const ok = parseHashRequestV1({ v: "v1", kind: "utf8", domain: "hf:t", text: "hello" });
    expect(ok).toMatchObject({ v: "v1", kind: "utf8", domain: "hf:t", text: "hello" });

    // Avoid huge allocations: create a buffer of MAX_PAYLOAD_BYTES+1 of 'a', then convert to string.
    const n = Math.min(MAX_PAYLOAD_BYTES + 1, MAX_PAYLOAD_BYTES + 1);
    const big = Buffer.allocUnsafe(n).fill(0x61).toString("utf8");
    expectValErr(
      () => parseHashRequestV1({ v: "v1", kind: "utf8", domain: "hf:t", text: big } as any),
      "utf8_payload_too_large",
      "PAYLOAD_TOO_LARGE"
    );
  });

  it("parses raw request; enforces strict/canonical base64url; allows empty if allowEmpty=true in decoder", () => {
    const ok = parseHashRequestV1({
      v: "v1",
      kind: "raw",
      domain: "hf:r",
      bytes_b64url: b64url(new Uint8Array([1, 2, 3])),
    });
    expect(ok).toMatchObject({ v: "v1", kind: "raw", domain: "hf:r" });

    // empty payload allowed (allowEmpty: true in validators for raw)
    const empty = parseHashRequestV1({ v: "v1", kind: "raw", domain: "hf:r", bytes_b64url: "" });
    expect(empty).toMatchObject({ bytes_b64url: "" });

    // rejects padding / non-url safe chars / invalid length
    expectValErr(
      () => parseHashRequestV1({ v: "v1", kind: "raw", domain: "hf:r", bytes_b64url: "AAAA==" } as any),
      "raw_bytes_invalid",
      "SCHEMA_INVALID"
    );
    expectValErr(
      () => parseHashRequestV1({ v: "v1", kind: "raw", domain: "hf:r", bytes_b64url: "aa+/" } as any),
      "raw_bytes_invalid",
      "SCHEMA_INVALID"
    );
    expectValErr(
      () => parseHashRequestV1({ v: "v1", kind: "raw", domain: "hf:r", bytes_b64url: "a" } as any),
      "raw_bytes_invalid",
      "SCHEMA_INVALID"
    );
  });

  it("parses include object strictly and forbids unknown include keys", () => {
    const r = parseHashRequestV1({
      v: "v1",
      kind: "json",
      domain: "hf:test",
      value: { a: 1 },
      include: { includeDigestBytes: 1, includePayloadBytes: true, includeFramedBytes: "yes" },
    } as any);

    expect(r).toMatchObject({
      include: { includeDigestBytes: true, includePayloadBytes: true, includeFramedBytes: true },
    });

    expectValErr(
      () =>
        parseHashRequestV1({
          v: "v1",
          kind: "json",
          domain: "hf:test",
          value: { a: 1 },
          include: { includeDigestBytes: true, extra: true },
        } as any),
      "include_unknown_key",
      "SCHEMA_UNKNOWN_KEY"
    );
  });

  it("domain parsing: trims, enforces regex, ascii, and bounds", () => {
    // trims
    const r = parseHashRequestV1({ v: "v1", kind: "utf8", domain: " hf:test ", text: "x" });
    expect(r.domain).toBe("hf:test");

    expectValErr(() => parseHashRequestV1({ v: "v1", kind: "utf8", domain: "A", text: "x" } as any), "domain_invalid_format", "DOMAIN_INVALID");
    expectValErr(() => parseHashRequestV1({ v: "v1", kind: "utf8", domain: "aé", text: "x" } as any), "domain_invalid_format", "DOMAIN_INVALID");
    expectValErr(() => parseHashRequestV1({ v: "v1", kind: "utf8", domain: "", text: "x" } as any), "domain_invalid_length", "DOMAIN_INVALID");
  });

  // ---------------------------------------------------------------------------
  // parseHashEnvelopeV1
  // ---------------------------------------------------------------------------

  it("rejects non-object envelope bodies and invalid version", () => {
    expectValErr(() => parseHashEnvelopeV1(null as any), "envelope_invalid_body", "SCHEMA_INVALID");
    expectValErr(() => parseHashEnvelopeV1([] as any), "envelope_invalid_body", "SCHEMA_INVALID");
    expectValErr(() => parseHashEnvelopeV1({ v: "v0" } as any), "envelope_invalid_version", "SCHEMA_INVALID");
  });

  it("enforces contract_id and frame ids", () => {
    const env = hashUtf8({ domain: "hf:e", text: "x" });

    expectValErr(
      () => parseHashEnvelopeV1({ ...env, contract_id: "nope" } as any),
      "envelope_contract_id_mismatch",
      "SCHEMA_INVALID"
    );
    expectValErr(
      () => parseHashEnvelopeV1({ ...env, frame: "nope" } as any),
      "envelope_frame_mismatch",
      "SCHEMA_INVALID"
    );
  });

  it("enforces discriminated shape: canonical_json required for json, forbidden otherwise", () => {
    const jsonEnv = hashJson({ domain: "hf:j", value: { a: 1 } });
    const parsedJson = parseHashEnvelopeV1(jsonEnv);
    expect(parsedJson).toMatchObject({ kind: "json", canonical_json: CANONICAL_JSON_ID });

    const utf8Env = hashUtf8({ domain: "hf:t", text: "x" }) as any;
    expectValErr(
      () => parseHashEnvelopeV1({ ...utf8Env, canonical_json: CANONICAL_JSON_ID } as any),
      "HashEnvelopeV1.bytes_unknown_key: canonical_json",
      "SCHEMA_UNKNOWN_KEY"
    );

    // missing canonical_json on json envelope should fail schema (unknown keys check includes canonical_json)
    const badJson = { ...(jsonEnv as any) };
    delete badJson.canonical_json;
    expectValErr(
      () => parseHashEnvelopeV1(badJson),
      "schema_invalid_string",
      "SCHEMA_INVALID"
    );
  });

  it("rejects unknown keys in envelopes (strict)", () => {
    const env = hashRaw({ domain: "hf:r", bytes: new Uint8Array([1]) }) as any;
    expectValErr(
      () => parseHashEnvelopeV1({ ...env, extra: 1 } as any),
      "HashEnvelopeV1.bytes_unknown_key",
      "SCHEMA_UNKNOWN_KEY"
    );
  });

  it("validates digest format for hex/hex_lower", () => {
    const env = hashRaw({ domain: "hf:r", bytes: new Uint8Array([1]) }) as any;

    // hex must be 128 chars
    expectValErr(() => parseHashEnvelopeV1({ ...env, digest: "aa" } as any), "digest_invalid_hex", "SCHEMA_INVALID");

    // hex_lower must be lower
    const envLower = hashRaw({ domain: "hf:r", bytes: new Uint8Array([1]), encoding: "hex_lower" }) as any;
    expectValErr(() => parseHashEnvelopeV1({ ...envLower, digest: envLower.digest.toUpperCase() } as any), "digest_invalid_hex_lower", "SCHEMA_INVALID");
  });

  it("validates digest format for base64/base64url and canonicality/length", () => {
    const bytes = new Uint8Array([1, 2, 3]);

    // base64
    const b64env = hashRaw({ domain: "hf:b", bytes, encoding: "base64" }) as any;
    expect(parseHashEnvelopeV1(b64env)).toMatchObject({ encoding: "base64" });

    // non-canonical base64: valid decode but different re-encode (whitespace)
    expectValErr(
        () => parseHashEnvelopeV1({ ...b64env, digest: b64env.digest + "\n" } as any),
        "digest_non_canonical_base64",
        "SCHEMA_INVALID"
    );

    // base64url
    const b64urlEnv = hashRaw({ domain: "hf:bu", bytes, encoding: "base64url" }) as any;
    expect(parseHashEnvelopeV1(b64urlEnv)).toMatchObject({ encoding: "base64url" });

    // base64url invalid (padding) -> Base64UrlError bubbles from decodeBase64UrlStrict
    expectB64UrlErr(() => parseHashEnvelopeV1({ ...b64urlEnv, digest: b64urlEnv.digest + "=" } as any));
  });

  it("validates payload/framed length fields and optional material base64url lengths", () => {
    const env = hashUtf8({
      domain: "hf:l",
      text: "hi",
      include: { includePayloadBytes: true, includeFramedBytes: true },
    }) as any;

    // ok
    const parsed = parseHashEnvelopeV1(env) as any;
    expect(parsed.payload_bytes_len).toBe(Buffer.byteLength("hi", "utf8"));

    // payload_b64url length mismatch
    expectValErr(
      () => parseHashEnvelopeV1({ ...env, payload_bytes_len: 9999 } as any),
      "payload_b64url_len_mismatch",
      "SCHEMA_INVALID"
    );

    // framed_b64url length mismatch
    expectValErr(
      () => parseHashEnvelopeV1({ ...env, framed_bytes_len: 1 } as any),
      "framed_b64url_len_mismatch",
      "SCHEMA_INVALID"
    );

    // invalid negative lengths
    expectValErr(
      () => parseHashEnvelopeV1({ ...env, payload_bytes_len: -1 } as any),
      "envelope_payload_len_invalid",
      "SCHEMA_INVALID"
    );
  });

  it("validates digest_bytes_b64url: length and derived digest must match", () => {
    const env = hashRaw({
      domain: "hf:d",
      bytes: new Uint8Array([9]),
      encoding: "hex_lower",
      include: { includeDigestBytes: true }, 
    }) as any;

    // ok
    expect(parseHashEnvelopeV1(env)).toMatchObject({ domain: "hf:d" });

    // mismatch: keep digest_bytes but tamper digest
    expectValErr(
      () => parseHashEnvelopeV1({ ...env, digest: "0".repeat(128) } as any),
      "digest_bytes_mismatch_digest",
      "SCHEMA_INVALID"
    );

    // length mismatch: digest_bytes not 64 bytes when decoded
    const shortDigestBytes = b64url(new Uint8Array(10));
    expectValErr(
      () => parseHashEnvelopeV1({ ...env, digest_bytes_b64url: shortDigestBytes } as any),
      "digest_bytes_len_invalid",
      "SCHEMA_INVALID"
    );
  });

  it("accepts envelopes without optional material fields", () => {
    const env = hashJson({ domain: "hf:j", value: { a: 1 } });
    const stripped = { ...(env as any) };
    delete stripped.payload_b64url;
    delete stripped.framed_b64url;
    delete stripped.digest_bytes_b64url;

    const parsed = parseHashEnvelopeV1(stripped);
    expect(parsed).toMatchObject({
      v: "v1",
      kind: "json",
      contract_id: HASH_FACTORY_CONTRACT_ID,
      frame: FRAME_ID,
    });
  });

  it("happy-path parsing roundtrip for each kind", () => {
    const eJson = hashJson({ domain: "hf:rtj", value: { b: 2, a: 1 }, include: { includePayloadBytes: true } });
    const eUtf8 = hashUtf8({ domain: "hf:rtt", text: "hello", include: { includeFramedBytes: true } });
    const eRaw = hashRaw({ domain: "hf:rtr", bytes: new Uint8Array([1, 2, 3]), include: { includeDigestBytes: true } });

    expect(parseHashEnvelopeV1(eJson)).toMatchObject({ kind: "json", canonical_json: CANONICAL_JSON_ID });
    expect(parseHashEnvelopeV1(eUtf8)).toMatchObject({ kind: "utf8" });
    expect(parseHashEnvelopeV1(eRaw)).toMatchObject({ kind: "raw" });
  });

  it("digest validation: correct SHA3-512 digest length assumptions (derived)", () => {
    const payload = Buffer.from("hello", "utf8");
    const framed = frame("hf:len", payload);
    const digestBytes = hashBytes({ alg: "sha3-512", bytes: framed });
    expect(digestBytes.byteLength).toBe(SHA3_512_BYTES);

    const digestHexLower = encodeDigest({ encoding: "hex_lower", digestBytes });
    expect(digestHexLower.length).toBe(128);
  });
});