// ============================================================================
// File: tests/units/ingest/errors.test.ts
// Version: 1.0.0-hf-ingest-errors-unit | 2026-03-07
// Purpose:
//   Unit tests for src/ingest/errors.ts
// Notes:
//   - Verifies stable defaults, override behavior, prototype chain, and cause.
// ============================================================================

import { describe, it, expect } from "vitest";
import { IngestError, IngestValidationError } from "../../../../src/ingest/errors.js";

describe("ingest/errors (unit)", () => {
  it("IngestError applies stable defaults", () => {
    const err = new IngestError("boom");

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(IngestError);
    expect(err.name).toBe("IngestError");
    expect(err.message).toBe("boom");
    expect(err.code).toBe("INGEST_ERROR");
    expect(err.statusCode).toBe(400);
  });

  it("IngestError applies custom code/statusCode/cause", () => {
    const cause = new Error("root cause");
    const err = new IngestError("bad_input", {
      code: "INPUT_INVALID",
      statusCode: 422,
      cause,
    });

    expect(err.name).toBe("IngestError");
    expect(err.message).toBe("bad_input");
    expect(err.code).toBe("INPUT_INVALID");
    expect(err.statusCode).toBe(422);
    expect((err as any).cause).toBe(cause);
  });

  it("IngestValidationError applies stable defaults", () => {
    const err = new IngestValidationError("invalid");

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(IngestValidationError);
    expect(err.name).toBe("IngestValidationError");
    expect(err.message).toBe("invalid");
    expect(err.code).toBe("INGEST_VALIDATION_FAILED");
    expect(err.statusCode).toBe(400);
  });

  it("IngestValidationError applies custom code/statusCode/cause", () => {
    const cause = { why: "bad schema" };
    const err = new IngestValidationError("schema_bad", {
      code: "SCHEMA_INVALID",
      statusCode: 409,
      cause,
    });

    expect(err.name).toBe("IngestValidationError");
    expect(err.message).toBe("schema_bad");
    expect(err.code).toBe("SCHEMA_INVALID");
    expect(err.statusCode).toBe(409);
    expect((err as any).cause).toBe(cause);
  });
});