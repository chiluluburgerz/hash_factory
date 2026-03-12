// ============================================================================
// File: tests/units/ingest/pathNorm.test.ts
// Version: 1.0.0-hf-ingest-path-norm-unit | 2026-03-07
// Purpose:
//   Unit tests for src/ingest/pathNorm.ts
// Notes:
//   - Pure deterministic tests.
//   - Verifies normalization, rejection of unsafe paths, and stable error shape.
// ============================================================================

import { describe, it, expect } from "vitest";
import { normalizeRelPath } from "../../../../src/ingest/pathNorm.js";
import { MAX_PATH_CHARS } from "../../../../src/ingest/limits.js";

describe("ingest/pathNorm (unit)", () => {
  it("normalizes relative paths to POSIX form", () => {
    expect(normalizeRelPath("a\\b\\c.txt")).toBe("a/b/c.txt");
    expect(normalizeRelPath("foo//bar///baz.tsv")).toBe("foo/bar/baz.tsv");
    expect(normalizeRelPath("./alpha/./beta.txt")).toBe("alpha/beta.txt");
    expect(normalizeRelPath("  subdir/file.json  ")).toBe("subdir/file.json");
  });

  it("collapses harmless internal dot segments", () => {
    expect(normalizeRelPath("a/./b/./c")).toBe("a/b/c");
  });

  it("allows normalized paths exactly at MAX_PATH_CHARS", () => {
    const leaf = "a".repeat(MAX_PATH_CHARS);
    expect(normalizeRelPath(leaf)).toBe(leaf);
  });

  it("rejects empty input", () => {
    expect(() => normalizeRelPath("")).toThrow(/path_empty/i);
    expect(() => normalizeRelPath("   ")).toThrow(/path_empty/i);
  });

  it("rejects paths longer than MAX_PATH_CHARS", () => {
    const tooLong = "a".repeat(MAX_PATH_CHARS + 1);
    expect(() => normalizeRelPath(tooLong)).toThrow(/path_too_long/i);
  });

  it("rejects control characters in the raw path", () => {
    expect(() => normalizeRelPath("abc\u0000def.txt")).toThrow(/path_control_chars/i);
    expect(() => normalizeRelPath("abc\u001Fdef.txt")).toThrow(/path_control_chars/i);
    expect(() => normalizeRelPath("abc\u007Fdef.txt")).toThrow(/path_control_chars/i);
  });

  it("rejects absolute POSIX and root-relative Windows-like paths", () => {
    expect(() => normalizeRelPath("/etc/passwd")).toThrow(/path_must_be_relative/i);
    expect(() => normalizeRelPath("\\windows\\system32")).toThrow(/path_must_be_relative/i);
  });

  it("rejects drive-qualified Windows paths", () => {
    expect(() => normalizeRelPath("C:\\temp\\file.txt")).toThrow(/path_must_be_relative/i);
    expect(() => normalizeRelPath("d:/data/file.txt")).toThrow(/path_must_be_relative/i);
  });

  it("rejects dot-only and dot-dot-only normalized paths", () => {
    expect(() => normalizeRelPath(".")).toThrow(/path_invalid/i);
    expect(() => normalizeRelPath("..")).toThrow(/path_invalid/i);
  });

  it("rejects parent escaping paths", () => {
    expect(() => normalizeRelPath("../secret.txt")).toThrow(/path_parent_escape/i);
    expect(() => normalizeRelPath("safe/../../secret.txt")).toThrow(/path_parent_escape/i);
    expect(() => normalizeRelPath("a/../b/../../c")).toThrow(/path_parent_escape/i);
  });

  it("rejects paths whose remaining segments would contain dot or dot-dot segments", () => {
    expect(() => normalizeRelPath("a/./../..")).toThrow();
  });

  it("throws IngestValidationError with stable code for invalid paths", () => {
    try {
      normalizeRelPath("../escape.txt");
      expect.fail("expected normalizeRelPath to throw");
    } catch (err: any) {
      expect(err.name).toBe("IngestValidationError");
      expect(err.code).toBe("PATH_INVALID");
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe("path_parent_escape");
    }
  });
});