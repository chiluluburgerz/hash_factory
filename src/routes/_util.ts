// ============================================================================
// File: src/routes/_util.ts
// Version: 1.0-routes-util | 2026-02-17
// Purpose:
//   Shared route helpers: safe error mapping, no-store, typed request id extraction.
// Notes:
//   - Keeps route handlers small and consistent.
// ============================================================================

import type { FastifyReply, FastifyRequest } from "fastify";
import { HashValidationError } from "../hashing/validators.js";

export function requestIdOf(req: FastifyRequest): string | null {
  return ((req as any).requestId ?? (req as any).id ?? null) as string | null;
}

export function sendNoStore(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store");
}

export function normalizeStatusCode(n: unknown, fallback = 500): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  const i = Math.trunc(v);
  if (i < 400 || i > 599) return fallback;
  return i;
}

export function isHashValidationError(err: unknown): err is HashValidationError {
  return Boolean(err) && typeof err === "object" && (err as any).name === "HashValidationError";
}

/**
 * Convert known validation errors into Fastify-friendly errors.
 */
export function rethrowAsRouteError(err: unknown): never {
  if (isHashValidationError(err)) throw err;

  // Preserve explicit statusCodes from other trusted errors (AuthError, etc.)
  const e = err as any;
  if (e && typeof e === "object" && typeof e.statusCode === "number") throw err;

  throw err;
}