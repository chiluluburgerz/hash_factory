// ============================================================================
// File: src/lib/entitlements/hfEntitlementErrors.ts
// Version: 1.0-hf-entitlement-errors | 2026-03-12
// Purpose:
//   Stable internal HF entitlement error types.
//   - Used by reusable HF entitlement helper layer
//   - Keeps policy failures distinct from transport/client failures
// Notes:
//   - Internal-only; not a public route surface
// ============================================================================

export class HfEntitlementError extends Error {
  statusCode: number;
  code: string;
  detail?: unknown;

  constructor(
    message: string,
    opts: { statusCode: number; code: string; detail?: unknown }
  ) {
    super(message);
    this.name = "HfEntitlementError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.detail = opts.detail;
  }
}

export function isHfEntitlementError(err: unknown): err is HfEntitlementError {
  return err instanceof HfEntitlementError;
}