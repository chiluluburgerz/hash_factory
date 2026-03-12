// ============================================================================
// File: tests/units/datasets/errors.test.ts
// Version: 1.0.0-hf-datasets-errors-unit | 2026-03-07
// Purpose:
//   Unit tests for src/datasets/errors.ts
// Notes:
//   - Verifies stable defaults, override behavior, prototype chain, and cause.
// ============================================================================

import { describe, it, expect } from "vitest";
import { DatasetError } from "../../../../src/datasets/errors.js";

describe("datasets/errors (unit)", () => {
  it("DatasetError applies stable defaults", () => {
    const err = new DatasetError("boom");

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DatasetError);
    expect(err.name).toBe("DatasetError");
    expect(err.message).toBe("boom");
    expect(err.code).toBe("DATASET_ERROR");
    expect(err.statusCode).toBe(400);
  });

  it("DatasetError applies custom code/statusCode/cause", () => {
    const cause = new Error("root cause");
    const err = new DatasetError("bad_input", {
      code: "HASH_FAILED",
      statusCode: 500,
      cause,
    });

    expect(err.name).toBe("DatasetError");
    expect(err.message).toBe("bad_input");
    expect(err.code).toBe("HASH_FAILED");
    expect(err.statusCode).toBe(500);
    expect((err as any).cause).toBe(cause);
  });
});