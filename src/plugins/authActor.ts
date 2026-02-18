// src/plugins/authActor.ts
import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { AuthError, createApiKeyAuthenticator } from "../auth/apiKeyAuth.js";
import { makeActorFromApiKeyRow, type Actor } from "../auth/actor.js";

declare module "fastify" {
  interface FastifyRequest {
    actor?: Actor;
  }
}

function safeAuthFailure(err: unknown): { statusCode: number; code: string; message: string } {
  const e = err as any;
  const statusCode = typeof e?.statusCode === "number" && e.statusCode >= 400 ? e.statusCode : 401;
  const code = typeof e?.code === "string" ? e.code : "AUTH_FAILED";
  return { statusCode, code, message: "Unauthorized" };
}

function toInt(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const x = Number(n);
  const v = Number.isFinite(x) ? Math.trunc(x) : fallback;
  return Math.max(min, Math.min(max, v));
}

export type AuthActorPluginOpts = {
  pool: Pool;
  apiKey?: Partial<Parameters<typeof createApiKeyAuthenticator>[0]>;
};

const authActorPlugin: FastifyPluginAsync<AuthActorPluginOpts> = async (app, opts) => {
  if (!opts?.pool || typeof (opts.pool as any).query !== "function") {
    throw new Error("authActorPlugin requires a pg pool");
  }

  const rawDefaultCacheTtlMs =
    process.env.NODE_ENV === "production"
      ? toInt(process.env.API_KEY_CACHE_TTL_MS, 2000)
      : toInt(process.env.API_KEY_CACHE_TTL_MS, 0);

  const defaultCacheTtlMs = clampInt(rawDefaultCacheTtlMs, 0, 60_000, 0);
  const defaultCacheMax = clampInt(toInt(process.env.API_KEY_CACHE_MAX, 2000), 0, 100_000, 2000);

  const authenticator = createApiKeyAuthenticator({
    pool: opts.pool,
    cacheTtlMs: defaultCacheTtlMs,
    cacheMax: defaultCacheMax,
    ...(opts.apiKey ?? {}),
  } as any);

  async function buildActorFromRequest(req: FastifyRequest): Promise<Actor | null> {
    const row = await authenticator.authenticateRequest(req);
    if (!row) return null;
    return makeActorFromApiKeyRow(row);
  }

  app.decorateRequest("actor", undefined);

  app.decorate("optionalAuth", () => {
    return async (req: FastifyRequest, reply: any) => {
      try {
        const actor = await buildActorFromRequest(req);
        if (actor) req.actor = actor;
      } catch (err) {
        const failure = safeAuthFailure(err);
        reply.code(failure.statusCode).send({
          error: "unauthorized",
          message: failure.message,
          request_id: (req as any).requestId ?? (req as any).id ?? null,
          code: process.env.NODE_ENV !== "production" ? failure.code : undefined,
        });
        return reply;
      }
    };
  });

  // Must have a valid key and actor
  app.decorate("requireAuth", () => {
    return async (req: FastifyRequest, reply: any) => {
      try {
        const actor = await buildActorFromRequest(req);
        if (!actor) {
          reply.code(401).send({
            error: "unauthorized",
            message: "Unauthorized",
            request_id: (req as any).requestId ?? (req as any).id ?? null,
          });
          return reply;
        }
        req.actor = actor;
      } catch (err) {
        const failure = safeAuthFailure(err);
        reply.code(failure.statusCode).send({
          error: "unauthorized",
          message: failure.message,
          request_id: (req as any).requestId ?? (req as any).id ?? null,
          code: process.env.NODE_ENV !== "production" ? failure.code : undefined,
        });
        return reply;
      }
    };
  });

  // convenience for handlers/services
  app.decorate("assertReqActor", (req: FastifyRequest): Actor => {
    if (!req.actor) {
      throw new AuthError("Unauthorized", { statusCode: 401, code: "AUTH_REQUIRED" });
    }
    return req.actor;
  });
};

export default fp(authActorPlugin, { name: "auth-actor" });

// Fastify decorate typings
declare module "fastify" {
  interface FastifyInstance {
    optionalAuth: () => (req: FastifyRequest, reply: any) => Promise<void>;
    requireAuth: () => (req: FastifyRequest, reply: any) => Promise<void>;
    assertReqActor: (req: FastifyRequest) => Actor;
  }
}