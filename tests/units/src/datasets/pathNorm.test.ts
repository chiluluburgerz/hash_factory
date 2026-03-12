// ============================================================================
// File: tests/units/datasets/pathNorm.test.ts
// Version: 1.0.0-hf-datasets-path-norm-unit | 2026-03-07
// Purpose:
//   Unit tests for src/datasets/pathNorm.ts
// Notes:
//   - Pure deterministic tests.
//   - Verifies normalization, rejection of unsafe segments, and stable error shape.
// ============================================================================

import { describe, it, expect } from "vitest";
import { normalizeRelPath } from "../../../../src/datasets/pathNorm.js";
import { MAX_PATH_CHARS } from "../../../../src/datasets/limits.js";

describe("datasets/pathNorm (unit)", () => {
  it("normalizes relative paths to POSIX form", () => {
    expect(normalizeRelPath("a\\b\\c.txt")).toBe("a/b/c.txt");
    expect(normalizeRelPath("foo//bar///baz.tsv")).toBe("foo/bar/baz.tsv");
    expect(normalizeRelPath("/alpha/beta.txt")).toBe("alpha/beta.txt");
  });

  it("rejects internal dot segments under fail-closed dataset rules", () => {
    expect(() => normalizeRelPath("a/./b/./c")).toThrow(/path_invalid_segment/i);
  });

  it("allows normalized paths exactly at MAX_PATH_CHARS", () => {
    const leaf = "a".repeat(MAX_PATH_CHARS);
    expect(normalizeRelPath(leaf)).toBe(leaf);
  });

  it("rejects empty input", () => {
    expect(() => normalizeRelPath("")).toThrow(/path_empty/i);
  });

  it("rejects empty-like normalized input", () => {
    expect(() => normalizeRelPath("/")).toThrow(/path_empty/i);
    expect(() => normalizeRelPath("////")).toThrow(/path_empty/i);
  });

  it("rejects dot and dot-dot path segments", () => {
    expect(() => normalizeRelPath(".")).toThrow(/path_invalid_segment/i);
    expect(() => normalizeRelPath("..")).toThrow(/path_invalid_segment/i);
    expect(() => normalizeRelPath("safe/../secret.txt")).toThrow(/path_invalid_segment/i);
    expect(() => normalizeRelPath("safe/./file.txt")).toThrow(/path_invalid_segment/i);
  });

  it("rejects null bytes in segments", () => {
    expect(() => normalizeRelPath("abc\u0000def.txt")).toThrow(/path_invalid_segment/i);
  });

  it("rejects normalized traversal", () => {
    expect(() => normalizeRelPath("a/b/../../..")).toThrow();
  });

  it("rejects paths longer than MAX_PATH_CHARS", () => {
    const tooLong = "a".repeat(MAX_PATH_CHARS + 1);
    expect(() => normalizeRelPath(tooLong)).toThrow(/path_too_long/i);
  });

  it("throws DatasetError with stable code for invalid paths", () => {
    try {
      normalizeRelPath("..");
      expect.fail("expected normalizeRelPath to throw");
    } catch (err: any) {
      expect(err.name).toBe("DatasetError");
      expect(err.code).toBe("PATH_INVALID");
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe("path_invalid_segment");
    }
  });
});