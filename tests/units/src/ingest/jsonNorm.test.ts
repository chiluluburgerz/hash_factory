// ============================================================================
// File: tests/units/ingest/jsonNorm.test.ts
// Version: 1.0.0-hf-ingest-json-norm-unit | 2026-03-07
// Purpose:
//   Unit tests for src/ingest/jsonNorm.ts
// Notes:
//   - Pure deterministic tests.
//   - Mocks canonical JSON boundary so we can verify wrapping/error behavior.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const canonicalizeMock = vi.fn();

vi.mock("../../../../src/hashing/canonicalJson.js", () => ({
  canonicalize: canonicalizeMock,
}));

describe("ingest/jsonNorm (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizeJsonValue returns canonical text/bytes/length from canonicalize()", async () => {
    const { normalizeJsonValue } = await import("../../../../src/ingest/jsonNorm.js");

    const canonicalBytes = new TextEncoder().encode('{"a":1,"b":2}');
    canonicalizeMock.mockReturnValue(canonicalBytes);

    const out = normalizeJsonValue({ b: 2, a: 1 });

    expect(canonicalizeMock).toHaveBeenCalledWith({ b: 2, a: 1 });
    expect(out).toEqual({
      canonical_text: '{"a":1,"b":2}',
      canonical_bytes: canonicalBytes,
      bytes: canonicalBytes.byteLength,
    });
    expect(Object.isFrozen(out)).toBe(true);
  });

  it("normalizeJsonValue respects explicit maxBytes override", async () => {
    const { normalizeJsonValue } = await import("../../../../src/ingest/jsonNorm.js");

    const canonicalBytes = new TextEncoder().encode('{"abc":123}');
    canonicalizeMock.mockReturnValue(canonicalBytes);

    const out = normalizeJsonValue({ abc: 123 }, canonicalBytes.byteLength);

    expect(out.bytes).toBe(canonicalBytes.byteLength);
    expect(out.canonical_text).toBe('{"abc":123}');
  });

  it("normalizeJsonValue throws JSON_CANONICALIZATION_FAILED when canonicalize throws", async () => {
    const { normalizeJsonValue } = await import("../../../../src/ingest/jsonNorm.js");

    const cause = new Error("bad json");
    canonicalizeMock.mockImplementation(() => {
      throw cause;
    });

    expect(() => normalizeJsonValue({ x: 1 })).toThrow(/json_canonicalization_failed/i);

    try {
      normalizeJsonValue({ x: 1 });
      expect.fail("expected normalizeJsonValue to throw");
    } catch (err: any) {
      expect(err.name).toBe("IngestError");
      expect(err.message).toBe("json_canonicalization_failed");
      expect(err.code).toBe("JSON_CANONICALIZATION_FAILED");
      expect(err.statusCode).toBe(400);
      expect(err.cause).toBe(cause);
    }
  });

  it("normalizeJsonValue throws JSON_TOO_LARGE when canonical bytes exceed maxBytes", async () => {
    const { normalizeJsonValue } = await import("../../../../src/ingest/jsonNorm.js");

    const canonicalBytes = new Uint8Array(12);
    canonicalizeMock.mockReturnValue(canonicalBytes);

    expect(() => normalizeJsonValue({ x: 1 }, 10)).toThrow(/json_payload_too_large/i);

    try {
      normalizeJsonValue({ x: 1 }, 10);
      expect.fail("expected normalizeJsonValue to throw");
    } catch (err: any) {
      expect(err.name).toBe("IngestError");
      expect(err.message).toBe("json_payload_too_large");
      expect(err.code).toBe("JSON_TOO_LARGE");
      expect(err.statusCode).toBe(413);
    }
  });

  it("normalizeJsonValue allows payload exactly at the byte limit", async () => {
    const { normalizeJsonValue } = await import("../../../../src/ingest/jsonNorm.js");

    const canonicalBytes = new TextEncoder().encode('{"k":"v"}');
    canonicalizeMock.mockReturnValue(canonicalBytes);

    const out = normalizeJsonValue({ k: "v" }, canonicalBytes.byteLength);

    expect(out.bytes).toBe(canonicalBytes.byteLength);
    expect(out.canonical_text).toBe('{"k":"v"}');
  });
});