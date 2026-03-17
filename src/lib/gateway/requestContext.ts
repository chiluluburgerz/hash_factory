// ============================================================================
// File: src/lib/gateway/requestContext.ts
// Version: 1.0-hash-factory-gateway-utils | 2026-03-12
// ============================================================================

import type { FastifyRequest } from "fastify";
import type { CoreRequestCtx } from "../../core/coreClient.js";

const MAX_API_KEY_LEN = 1024;
const MAX_IDEMPOTENCY_KEY_LEN = 256;

export type GatewayActorLike = Readonly<{
  user_id?: string | null;
  org_id?: string | null;
  org_role?: string | null;
}>;

function fail(message: string, statusCode: number, code: string): never {
  const e: any = new Error(message);
  e.statusCode = statusCode;
  e.code = code;
  throw e;
}

export function extractIncomingAuthHeader(req: FastifyRequest): string | null {
  const authRaw = req.headers.authorization;
  const xRaw = (req.headers as any)["x-api-key"];

  const bearer =
    typeof authRaw === "string" && authRaw.toLowerCase().startsWith("bearer ")
      ? authRaw.slice("bearer ".length).trim()
      : null;

  const x =
    typeof xRaw === "string"
      ? xRaw.trim()
      : Array.isArray(xRaw)
        ? String(xRaw[0] ?? "").trim()
        : null;

  if (bearer && x && bearer !== x) {
    fail("Multiple API key headers provided", 400, "AUTH_AMBIGUOUS");
  }

  const token = bearer || x || null;
  if (!token) return null;

  if (token.length > MAX_API_KEY_LEN) {
    fail("API key too long", 400, "AUTH_INVALID");
  }

  return `Bearer ${token}`;
}

export function idempotencyKeyFromReq(req: FastifyRequest): string | null {
  const h = (req.headers as any) || {};
  const raw = h["idempotency-key"] ?? h["x-idempotency-key"] ?? null;
  if (raw == null) return null;

  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return null;

  const s = v.trim();
  if (!s) return null;

  return s.length > MAX_IDEMPOTENCY_KEY_LEN ? s.slice(0, MAX_IDEMPOTENCY_KEY_LEN) : s;
}

export function actorTag(actor: GatewayActorLike | null | undefined): string | null {
  if (!actor) return null;
  const u = actor.user_id ? String(actor.user_id) : "";
  const o = actor.org_id ? String(actor.org_id) : "";
  const r = actor.org_role ? String(actor.org_role) : "";
  if (!u && !o && !r) return null;
  return `u:${u || "?"}|o:${o || "?"}|r:${r || "?"}`;
}

export function baseCtxFromReq(req: FastifyRequest): Pick<CoreRequestCtx, "requestId" | "clientRequestId"> {
  return {
    requestId: (req as any)?.requestId ?? (req as any)?.id ?? null,
    clientRequestId: (req as any)?.clientRequestId ?? null,
  };
}

export function buildGatewayCtx(
  req: FastifyRequest,
  actor?: GatewayActorLike | null,
  opts?: {
    forWrite?: boolean;
    requirePassThroughAuth?: boolean;
  }
): CoreRequestCtx {
  const forWrite = opts?.forWrite === true;
  const requirePassThroughAuth = opts?.requirePassThroughAuth === true;

  const base = baseCtxFromReq(req);
  const hfActor = actorTag(actor);
  const idempotencyKey = forWrite ? idempotencyKeyFromReq(req) : null;
  const coreAuthHeader = extractIncomingAuthHeader(req);

  if (requirePassThroughAuth && !coreAuthHeader) {
    fail("Pass-through auth required", 401, "PASS_THROUGH_AUTH_REQUIRED");
  }

  return {
    ...base,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(coreAuthHeader ? { coreAuthHeader } : {}),
    ...(hfActor ? { hfActor } : {}),
    ...(requirePassThroughAuth ? { requirePassThroughAuth: true } : {}),
    onCoreCall: (line) => {
      const logger: any = (req as any).log ?? console;
      logger.info({ event: "core_call", ...line }, "core_call");
    },
  };
}