import { describe, it, expect } from "vitest";
import { encodeBase64Url, decodeBase64UrlStrict, Base64UrlError } from "../../../../src/hashing/base64url.js";
import { MAX_PAYLOAD_BYTES } from "../../../../src/hashing/limits.js";

function expectB64Err(fn: () => any, codeIncludes: string) {
  try {
    fn();
    throw new Error("Expected Base64UrlError");
  } catch (e: any) {
    expect(e).toBeInstanceOf(Base64UrlError);
    expect(String(e.message)).toContain(codeIncludes);
  }
}

describe("hashing/base64url.ts (unit)", () => {
  it("encodeBase64Url requires Uint8Array", () => {
    expectB64Err(() => encodeBase64Url(null as any), "encodeBase64Url_invalid_bytes");
    expectB64Err(() => encodeBase64Url("nope" as any), "encodeBase64Url_invalid_bytes");
    expectB64Err(() => encodeBase64Url({} as any), "encodeBase64Url_invalid_bytes");
  });

  it("round-trips bytes through base64url encoding", () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 254, 255]);
    const s = encodeBase64Url(bytes);
    const out = decodeBase64UrlStrict(s, { maxBytes: 1024 });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });

  it("trims input; allowEmpty=false rejects empty/whitespace", () => {
    expectB64Err(() => decodeBase64UrlStrict("", { allowEmpty: false }), "decodeBase64UrlStrict_empty");
    expectB64Err(() => decodeBase64UrlStrict("   ", { allowEmpty: false }), "decodeBase64UrlStrict_empty");
  });

  it("allowEmpty=true returns empty bytes for empty/whitespace", () => {
    expect(Array.from(decodeBase64UrlStrict("", { allowEmpty: true }))).toEqual([]);
    expect(Array.from(decodeBase64UrlStrict("   ", { allowEmpty: true }))).toEqual([]);
  });

  it("rejects padding '='", () => {
    expectB64Err(() => decodeBase64UrlStrict("Zg=="), "decodeBase64UrlStrict_padding_not_allowed");
    expectB64Err(() => decodeBase64UrlStrict("Zg="), "decodeBase64UrlStrict_padding_not_allowed");
  });

  it("rejects non-url-safe characters", () => {
    expectB64Err(() => decodeBase64UrlStrict("ab+c"), "decodeBase64UrlStrict_invalid_chars");
    expectB64Err(() => decodeBase64UrlStrict("ab/c"), "decodeBase64UrlStrict_invalid_chars");
    expectB64Err(() => decodeBase64UrlStrict("ab c"), "decodeBase64UrlStrict_invalid_chars");
  });

  it("rejects invalid length where len % 4 === 1", () => {
    // base64url length mod 4 cannot be 1
    expectB64Err(() => decodeBase64UrlStrict("A"), "decodeBase64UrlStrict_invalid_length");
    expectB64Err(() => decodeBase64UrlStrict("AAAAA"), "decodeBase64UrlStrict_invalid_length");
  });

  it("rejects non-string input", () => {
    expectB64Err(() => decodeBase64UrlStrict(null as any), "decodeBase64UrlStrict_invalid_input");
    expectB64Err(() => decodeBase64UrlStrict(123 as any), "decodeBase64UrlStrict_invalid_input");
    expectB64Err(() => decodeBase64UrlStrict({} as any), "decodeBase64UrlStrict_invalid_input");
  });

  it("rejects invalid maxBytes", () => {
    expectB64Err(() => decodeBase64UrlStrict("Zg", { maxBytes: NaN as any }), "decodeBase64UrlStrict_invalid_maxBytes");
    expectB64Err(() => decodeBase64UrlStrict("Zg", { maxBytes: -1 }), "decodeBase64UrlStrict_invalid_maxBytes");
    expectB64Err(() => decodeBase64UrlStrict("Zg", { maxBytes: Infinity as any }), "decodeBase64UrlStrict_invalid_maxBytes");
  });

  it("enforces maxBytes via character budget (too_large) and decoded size (decoded_too_large)", () => {
    const payload = new Uint8Array(32);
    for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;
    const s = encodeBase64Url(payload);

    // Very small maxBytes => should be rejected either by char budget or decoded budget
    expectB64Err(() => decodeBase64UrlStrict(s, { maxBytes: 1 }), "decodeBase64UrlStrict_");
  });

  it("default maxBytes uses MAX_PAYLOAD_BYTES and accepts reasonable payloads", () => {
    const n = Math.min(1024, MAX_PAYLOAD_BYTES);
    const bytes = new Uint8Array(n);
    bytes.fill(7);
    const s = encodeBase64Url(bytes);
    const out = decodeBase64UrlStrict(s);
    expect(out.byteLength).toBe(n);
  });
});