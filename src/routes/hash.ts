// ============================================================================
// File: src/routes/hash.ts
// Version: 1.0-routes-hash-v1 | 2026-02-17
// Purpose:
//   Hash Factory public API routes.
// Routes:
//   - POST /v1/hash
//   - POST /v1/verify
//   - GET  /v1/contract
// Notes:
//   - Deterministic outputs, strict request validation, no-store responses.
//   - Auth required (defense-in-depth even though server.ts also requires auth).
//   - Adds per-route strict rate limits (globalRateLimit remains as soft backstop).
// ============================================================================

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { hashJson, hashUtf8, hashRaw } from "../hashing/hashFactory.js";
import { verifyEnvelope, type VerifyMaterial } from "../hashing/verifier.js";
import { parseHashRequestV1, HashValidationError, parseHashEnvelopeV1 } from "../hashing/validators.js";
import { decodeBase64UrlStrict, Base64UrlError } from "../hashing/base64url.js";
import {
  HASH_FACTORY_CONTRACT_ID,
  FRAME_ID,
  CANONICAL_JSON_ID,
  type HashRequestV1,
} from "../hashing/types.js";
import { MAX_PAYLOAD_BYTES, MAX_FRAMED_BYTES, MAX_CANONICAL_JSON_BYTES } from "../hashing/limits.js";
import {
  createFixedWindowRateLimiter,
  rateLimitEnabled,
  getClientIp,
  applyRateLimitHeaders,
  rejectRateLimited,
  readEnvInt,
} from "../utils/rateLimit.js";
import { requestIdOf, sendNoStore, rethrowAsRouteError } from "./_util.js";
import { parseOr400 } from "./_zod.js";

type VerifyRequestBody = Readonly<{
  envelope: unknown;
  material?: unknown;
}>;

function requireJson(req: FastifyRequest): void {
  const ct = String((req.headers as any)?.["content-type"] ?? "").toLowerCase();
  // Accept application/json and application/*+json
  if (!ct.includes("application/json") && !ct.includes("+json")) {
    const e: any = new Error("unsupported_media_type");
    e.statusCode = 415;
    e.code = "UNSUPPORTED_MEDIA_TYPE";
    throw e;
  }
}

function parseVerifyMaterial(x: unknown): VerifyMaterial | undefined {
  if (x === undefined) return undefined;
  const MaterialSchema = z
    .object({
      value: z.unknown().optional(),
      text: z.string().optional(),
      bytes_b64url: z.string().optional(),
    })
    .strict()
    .superRefine((v, ctx) => {
      const hasValue = Object.prototype.hasOwnProperty.call(v, "value");
      const hasText = typeof v.text === "string";
      const hasBytes = typeof v.bytes_b64url === "string";
      const count = (hasValue ? 1 : 0) + (hasText ? 1 : 0) + (hasBytes ? 1 : 0);
      if (count === 0) return;
      if (count !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "verify_material_ambiguous" });
      }
    });

  const r = MaterialSchema.safeParse(x);
  if (!r.success) {
    throw new HashValidationError("verify_invalid_material", { code: "SCHEMA_INVALID", statusCode: 400 });
  }

  const v = r.data;
  const hasValue = Object.prototype.hasOwnProperty.call(v, "value");
  const hasText = typeof v.text === "string";
  const hasBytes = typeof v.bytes_b64url === "string";
  const count = (hasValue ? 1 : 0) + (hasText ? 1 : 0) + (hasBytes ? 1 : 0);
  if (count === 0) return undefined;
  if (count !== 1) {
    throw new HashValidationError("verify_material_ambiguous", { code: "SCHEMA_INVALID", statusCode: 400 });
  }

  if (hasValue) return { value: v.value } as VerifyMaterial;
  if (hasText) return { text: String(v.text) } as VerifyMaterial;

  // bytes_b64url (strict decode + bounds)
  try {
    decodeBase64UrlStrict(String(v.bytes_b64url), { maxBytes: MAX_PAYLOAD_BYTES, allowEmpty: true });
  } catch (err) {
    const cause = err instanceof Base64UrlError ? err : undefined;
    throw new HashValidationError("verify_material_bytes_invalid", { code: "SCHEMA_INVALID", statusCode: 400, cause });
  }
  return { bytes_b64url: String(v.bytes_b64url) } as VerifyMaterial;
}

export async function hashRoutes(app: FastifyInstance) {
  // Auth required
  const requireAuth = app.requireAuth();

  // Per-route strict rate limits (in-memory, per instance).
  // Defaults are conservative; tune via env.
  const windowMs = Math.max(1_000, readEnvInt(["HASH_RATE_LIMIT_WINDOW_MS"], 60_000));
  const maxEntries = Math.max(1_000, readEnvInt(["HASH_RATE_LIMIT_MAX_ENTRIES"], 50_000));
  const maxHash = Math.max(1, readEnvInt(["HASH_RATE_LIMIT_HASH_MAX"], 120));       // /min
  const maxVerify = Math.max(1, readEnvInt(["HASH_RATE_LIMIT_VERIFY_MAX"], 60));    // /min
  const maxContract = Math.max(1, readEnvInt(["HASH_RATE_LIMIT_CONTRACT_MAX"], 240)); // /min

  const limHash = createFixedWindowRateLimiter({ windowMs, max: maxHash, maxEntries });
  const limVerify = createFixedWindowRateLimiter({ windowMs, max: maxVerify, maxEntries });
  const limContract = createFixedWindowRateLimiter({ windowMs, max: maxContract, maxEntries });

  function rlKey(req: FastifyRequest, routeName: string): string {
    // Key by IP + method + routeName.
    const ip = getClientIp(req);
    const method = String(req.method || "GET");
    return `${ip}||${method}||${routeName}`;
  }

  function enforce(limiter: { check: (k: string) => any }, key: string, req: FastifyRequest, reply: any): boolean {
    if (!rateLimitEnabled()) return true;
    const d = limiter.check(key);
    if (!d.allowed) {
      rejectRateLimited(reply, d);
      return false;
    }
    applyRateLimitHeaders(reply, d);
    return true;
  }

  // Defense-in-depth: no-store for all /v1 endpoints in this file.
  app.addHook("onSend", async (req, reply, payload) => {
    const url = String((req as any).routeOptions?.url ?? "");
    if (url.startsWith("/v1/")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("vary", "Accept");
    }
    return payload;
  });

  // ---------------------------------------------------------------------------
  // GET /v1/contract
  // ---------------------------------------------------------------------------
  app.get("/v1/contract", { preHandler: requireAuth }, async (req, reply) => {
    sendNoStore(reply);
    if (!enforce(limContract, rlKey(req, "contract"), req, reply)) return reply;
    return reply.send({
      ok: true,
      contract_id: HASH_FACTORY_CONTRACT_ID,
      frame: FRAME_ID,
      canonical_json: CANONICAL_JSON_ID,
      limits: {
        max_payload_bytes: MAX_PAYLOAD_BYTES,
        max_framed_bytes: MAX_FRAMED_BYTES,
        max_canonical_json_bytes: MAX_CANONICAL_JSON_BYTES,
      },
      request_id: requestIdOf(req),
    });
  });

  // ---------------------------------------------------------------------------
  // POST /v1/hash
  // Body: HashRequestV1
  // ---------------------------------------------------------------------------
  app.post("/v1/hash", { preHandler: requireAuth }, async (req: FastifyRequest, reply) => {
    sendNoStore(reply);
    requireJson(req);
    if (!enforce(limHash, rlKey(req, "hash"), req, reply)) return reply;

    try {
      const parsed = parseHashRequestV1((req as any).body) as HashRequestV1;

      const env =
        parsed.kind === "json"
          ? hashJson({
              domain: parsed.domain,
              value: (parsed as any).value,
              ...(parsed.canon ? { canon: parsed.canon } : {}),
              ...(parsed.alg ? { alg: parsed.alg } : {}),
              ...(parsed.encoding ? { encoding: parsed.encoding } : {}),
              ...(parsed.include ? { include: parsed.include } : {}),
            })
          : parsed.kind === "utf8"
            ? hashUtf8({
                domain: parsed.domain,
                text: (parsed as any).text,
                ...(parsed.alg ? { alg: parsed.alg } : {}),
                ...(parsed.encoding ? { encoding: parsed.encoding } : {}),
                ...(parsed.include ? { include: parsed.include } : {}),
              })
            : hashRaw({
                domain: parsed.domain,
                bytes: decodeBase64UrlStrict((parsed as any).bytes_b64url, {
                  maxBytes: MAX_PAYLOAD_BYTES,
                  allowEmpty: true,
                }),
                ...(parsed.alg ? { alg: parsed.alg } : {}),
                ...(parsed.encoding ? { encoding: parsed.encoding } : {}),
                ...(parsed.include ? { include: parsed.include } : {}),
              });

      return reply.send({
        ok: true,
        envelope: env,
        request_id: requestIdOf(req),
      });
    } catch (err) {
      rethrowAsRouteError(err);
    }
  });

  // ---------------------------------------------------------------------------
  // POST /v1/verify
  // Body: { envelope, material? }
  // - envelope: HashEnvelopeV1 (validated)
  // - material: optional, oneof { value | text | bytes_b64url }
  // ---------------------------------------------------------------------------
  app.post("/v1/verify", { preHandler: requireAuth }, async (req: FastifyRequest, reply) => {
    sendNoStore(reply);
    requireJson(req);
    if (!enforce(limVerify, rlKey(req, "verify"), req, reply)) return reply;

    try {
      const VerifyBodySchema = z
        .object({
          envelope: z.unknown(),
          material: z.unknown().optional(),
        })
        .strict();

      const parsedBody = parseOr400(reply, VerifyBodySchema, (req as any).body);
      if (!parsedBody.ok) return reply;

      const env = parseHashEnvelopeV1((parsedBody.data as VerifyRequestBody).envelope);
      const material = parseVerifyMaterial((parsedBody.data as VerifyRequestBody).material);

      const res = verifyEnvelope(env, material);

      return reply.send({
        ok: true,
        result: res,
        request_id: requestIdOf(req),
      });
    } catch (err) {
      rethrowAsRouteError(err);
    }
  });
}