// ============================================================================
// File: tests/units/ingest/textNorm.test.ts
// Version: 1.0.0-hf-ingest-text-norm-unit | 2026-03-07
// Purpose:
//   Unit tests for src/ingest/textNorm.ts
// Notes:
//   - Pure deterministic tests.
//   - Verifies optional line-ending normalization and size enforcement.
// ============================================================================

import { describe, it, expect } from "vitest";
import { normalizeText } from "../../../../src/ingest/textNorm.js";

describe("ingest/textNorm (unit)", () => {
  it("returns raw text and utf8 bytes when line normalization is disabled", () => {
    const out = normalizeText({
      text: "a\r\nb\rc\n",
      normalize_line_endings: false,
    });

    expect(out.text).toBe("a\r\nb\rc\n");
    expect(out.bytes_utf8).toEqual(Buffer.from("a\r\nb\rc\n", "utf8"));
    expect(out.bytes).toBe(Buffer.byteLength("a\r\nb\rc\n", "utf8"));
    expect(Object.isFrozen(out)).toBe(true);
  });

  it("normalizes CRLF and CR to LF when enabled", () => {
    const out = normalizeText({
      text: "a\r\nb\rc\n",
      normalize_line_endings: true,
    });

    expect(out.text).toBe("a\nb\nc\n");
    expect(out.bytes_utf8).toEqual(Buffer.from("a\nb\nc\n", "utf8"));
    expect(out.bytes).toBe(Buffer.byteLength("a\nb\nc\n", "utf8"));
  });

  it("coerces missing text to empty string", () => {
    const out = normalizeText({ text: undefined as any });

    expect(out.text).toBe("");
    expect(out.bytes).toBe(0);
    expect(out.bytes_utf8).toEqual(Buffer.from("", "utf8"));
  });

  it("respects explicit maxBytes override", () => {
    const out = normalizeText(
      {
        text: "hello",
        normalize_line_endings: false,
      },
      5,
    );

    expect(out.text).toBe("hello");
    expect(out.bytes).toBe(5);
  });

  it("throws TEXT_TOO_LARGE when utf8 payload exceeds maxBytes", () => {
    expect(() =>
      normalizeText(
        {
          text: "hello!",
          normalize_line_endings: false,
        },
        5,
      ),
    ).toThrow(/text_payload_too_large/i);

    try {
      normalizeText(
        {
          text: "hello!",
          normalize_line_endings: false,
        },
        5,
      );
      expect.fail("expected normalizeText to throw");
    } catch (err: any) {
      expect(err.name).toBe("IngestError");
      expect(err.message).toBe("text_payload_too_large");
      expect(err.code).toBe("TEXT_TOO_LARGE");
      expect(err.statusCode).toBe(413);
    }
  });

  it("allows payload exactly at the byte limit", () => {
    const out = normalizeText(
      {
        text: "hello",
        normalize_line_endings: false,
      },
      5,
    );

    expect(out.bytes).toBe(5);
    expect(out.text).toBe("hello");
  });
});