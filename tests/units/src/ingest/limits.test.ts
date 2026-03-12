// ============================================================================
// File: tests/units/ingest/limits.test.ts
// Version: 1.0.0-hf-ingest-limits-unit | 2026-03-07
// Purpose:
//   Unit tests for src/ingest/limits.ts
// Notes:
//   - Locks down ingest constant contracts so accidental drift is caught.
// ============================================================================

import { describe, it, expect } from "vitest";
import * as limits from "../../../../src/ingest/limits.js";

describe("ingest/limits (unit)", () => {
  it("exports the expected ingest limits", () => {
    expect(limits.MAX_OBJECT_KEY_LEN).toBe(256);
    expect(limits.MAX_PROGRAM_LEN).toBe(64);
    expect(limits.MAX_VERSION_LABEL_LEN).toBe(64);

    expect(limits.MAX_TEXT_BYTES_DEFAULT).toBe(5_000_000);
    expect(limits.MAX_JSON_BYTES_DEFAULT).toBe(5_000_000);

    expect(limits.MAX_FILES_DEFAULT).toBe(50_000);
    expect(limits.MAX_TOTAL_BYTES_DEFAULT).toBe(500_000_000);
    expect(limits.MAX_SINGLE_FILE_BYTES_DEFAULT).toBe(100_000_000);

    expect(limits.MAX_PATH_CHARS).toBe(1024);
    expect(limits.MAX_ROOT_SCAN_DEPTH).toBe(64);

    expect(limits.MAX_ARRAY_ITEMS).toBe(256);
    expect(limits.MAX_META_DEPTH).toBe(8);
    expect(limits.MAX_JSON_DEPTH).toBe(64);

    expect(limits.MAX_GLOB_LEN).toBe(256);
    expect(limits.MAX_SUFFIX_LEN).toBe(64);
    expect(limits.MAX_POINTER_LEN).toBe(2048);
    expect(limits.MAX_DOMAIN_LEN).toBe(256);
    expect(limits.MAX_MEDIA_TYPE_LEN).toBe(128);

    expect(limits.HASH_CHUNK_BYTES_DEFAULT).toBe(1_048_576);
  });

  it("exports only positive numeric limits", () => {
    for (const [key, value] of Object.entries(limits)) {
      expect(typeof value, `${key} should be a number`).toBe("number");
      expect(Number.isFinite(value), `${key} should be finite`).toBe(true);
      expect(value, `${key} should be > 0`).toBeGreaterThan(0);
    }
  });
});