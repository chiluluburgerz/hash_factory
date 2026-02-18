// ============================================================================
// File: src/routes/_zod.ts
// Version: 1.0-route-zod-util | 2026-02-18
// Purpose:
//   Shared Zod helpers for route-boundary validation (400 w/ issues).
// ============================================================================

import type { FastifyReply } from "fastify";
import type { ZodTypeAny, ZodError } from "zod";

export type ZodBadRequest = Readonly<{
  error: "bad_request";
  issues: unknown[];
}>;

export function sendZodError(reply: FastifyReply, err: ZodError): FastifyReply {
  return reply.code(400).send({ error: "bad_request", issues: err.issues ?? [] } satisfies ZodBadRequest);
}

export function parseOr400<T extends ZodTypeAny>(
  reply: FastifyReply,
  schema: T,
  input: unknown
): { ok: true; data: import("zod").infer<T> } | { ok: false } {
  const r = schema.safeParse(input);
  if (!r.success) {
    sendZodError(reply, r.error);
    return { ok: false };
  }
  return { ok: true, data: r.data };
}