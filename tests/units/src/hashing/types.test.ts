import { describe, it, expect } from "vitest";
import {
  HASH_FACTORY_CONTRACT_ID,
  FRAME_ID,
  CANONICAL_JSON_ID,
  HASH_ALGS,
  DIGEST_ENCODINGS,
  ENVELOPE_VERSIONS,
  HASH_KINDS,
} from "../../../../src/hashing/types.js";

describe("hashing/types.ts (unit)", () => {
  it("ids are stable and non-empty", () => {
    expect(HASH_FACTORY_CONTRACT_ID).toBe("hf-contract-v1");
    expect(FRAME_ID).toBe("hf:frame:v1");
    expect(CANONICAL_JSON_ID).toBe("hf:canonical-json:v1");
  });

  it("enum arrays are exact and stable", () => {
    expect(HASH_ALGS).toEqual(["sha3-512"]);
    expect(DIGEST_ENCODINGS).toEqual(["hex", "hex_lower", "base64", "base64url"]);
    expect(ENVELOPE_VERSIONS).toEqual(["v1"]);
    expect(HASH_KINDS).toEqual(["json", "utf8", "raw"]);
  });

  it("arrays are readonly by convention (defense-in-depth)", () => {
    expect(Array.isArray(HASH_ALGS)).toBe(true);
    expect(Array.isArray(DIGEST_ENCODINGS)).toBe(true);
    expect(Array.isArray(ENVELOPE_VERSIONS)).toBe(true);
    expect(Array.isArray(HASH_KINDS)).toBe(true);
  });
});