// ============================================================================
// File: tests/units/datasets/limits.test.ts
// Version: 1.0.0-hf-datasets-limits-unit | 2026-03-07
// Purpose:
//   Unit tests for src/datasets/limits.ts
// Notes:
//   - Locks down dataset constant contracts so accidental drift is caught.
// ============================================================================

import { describe, it, expect } from "vitest";
import * as limits from "../../../../src/datasets/limits.js";

describe("datasets/limits (unit)", () => {
  it("exports the expected dataset limits", () => {
    expect(limits.MAX_FILES_DEFAULT).toBe(200_000);
    expect(limits.MAX_TOTAL_BYTES_DEFAULT).toBe(2_000_000_000);
    expect(limits.MAX_SINGLE_FILE_BYTES_DEFAULT).toBe(1_000_000_000);

    expect(limits.MAX_PATH_CHARS).toBe(1024);
    expect(limits.MAX_ROOT_SCAN_DEPTH).toBe(64);

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