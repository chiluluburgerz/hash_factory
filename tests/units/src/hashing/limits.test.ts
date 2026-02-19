import { describe, it, expect } from "vitest";
import {
  DOMAIN_MIN,
  DOMAIN_MAX,
  DOMAIN_RE,
  MAX_PAYLOAD_BYTES,
  MAX_CANONICAL_JSON_BYTES,
  MAX_DOMAIN_BYTES,
  FRAME_MAGIC_BYTES,
  FRAME_OVERHEAD_MAX,
  MAX_FRAMED_BYTES,
  SHA3_512_BYTES,
} from "../../../../src/hashing/limits.js";

describe("hashing/limits.ts (unit)", () => {
  it("domain constants are sane", () => {
    expect(DOMAIN_MIN).toBeGreaterThan(0);
    expect(DOMAIN_MAX).toBeGreaterThanOrEqual(DOMAIN_MIN);
    expect(MAX_DOMAIN_BYTES).toBe(DOMAIN_MAX);

    expect(DOMAIN_RE.test("a")).toBe(true);
    expect(DOMAIN_RE.test("hf:test")).toBe(true);
    expect(DOMAIN_RE.test("A")).toBe(false);
    expect(DOMAIN_RE.test("a ")).toBe(false);
  });

  it("payload/canonical caps are aligned", () => {
    expect(MAX_PAYLOAD_BYTES).toBeGreaterThan(0);
    expect(MAX_CANONICAL_JSON_BYTES).toBe(MAX_PAYLOAD_BYTES);
  });

  it("frame overhead math matches documented cap", () => {
    // MAGIC("hf:frame:v1") is 11 bytes
    expect(FRAME_MAGIC_BYTES).toBe(11);

    // overhead = magic + 0x00 + u16 + maxDomain + u32
    expect(FRAME_OVERHEAD_MAX).toBe(FRAME_MAGIC_BYTES + 1 + 2 + MAX_DOMAIN_BYTES + 4);
    expect(FRAME_OVERHEAD_MAX).toBe(82);
  });

  it("max framed bytes equals payload + overhead", () => {
    expect(MAX_FRAMED_BYTES).toBe(MAX_PAYLOAD_BYTES + FRAME_OVERHEAD_MAX);
  });

  it("algorithm constants are correct", () => {
    expect(SHA3_512_BYTES).toBe(64);
  });
});