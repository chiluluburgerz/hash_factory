// src/server.ts
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import helmet, { type FastifyHelmetOptions } from "@fastify/helmet";
import fastifyCors, { type FastifyCorsOptions } from "@fastify/cors";
import { securityHeadersPlugin } from "./plugins/securityHeaders.js";
import compress from "@fastify/compress";
import { nanoid } from "nanoid";
import { pool, healthcheck, assertAuthPrereqs, closeDb } from "./db.js";
import authActorPlugin from "./plugins/authActor.js";
import { requestIdPlugin } from "./plugins/requestId.js";
import { registerGlobalRateLimit } from "./plugins/globalRateLimit.js";
import { registerRoutes } from "./routes/index.js";

type ReqWithTiming = FastifyRequest & { _reqStartNs?: bigint };

function toBool(v: unknown, def = false): boolean {
  if (v === undefined || v === null) return def;
  const s = String(v).trim().toLowerCase();
  if (!s) return def;
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function toInt(v: unknown, def: number, min?: number, max?: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  let i = Math.trunc(n);
  if (typeof min === "number") i = Math.max(min, i);
  if (typeof max === "number") i = Math.min(max, i);
  return i;
}

function clampStr(v: unknown, max = 256): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function parseCsvList(v: unknown): string[] {
  const s = String(v ?? "").trim();
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function normalizeOrigin(origin: string): string {
  try {
    const u = new URL(origin);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return origin.trim().toLowerCase();
  }
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

async function buildApp(): Promise<FastifyInstance> {
  const isProd = String(process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";

  const requestTimeout = toInt(process.env.REQUEST_TIMEOUT_MS, 10_000, 1_000, 120_000);
  const keepAliveTimeout = toInt(process.env.KEEP_ALIVE_TIMEOUT_MS, 72_000, 1_000, 300_000);
  const bodyLimit = toInt(process.env.BODY_LIMIT_BYTES, 1_048_576, 1_024, 32 * 1_048_576);

  const trustProxy =
    toBool(process.env.TRUST_PROXY, false) ||
    String(process.env.TRUST_PROXY ?? "").trim() === "1";

  const logLevel = String(process.env.LOG_LEVEL || "info").toLowerCase();

  const app = Fastify({
    logger: {
      level: logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    disableRequestLogging: true,
    requestTimeout,
    keepAliveTimeout,
    bodyLimit,
    trustProxy,
    genReqId: () => nanoid(),
    requestIdHeader: false,
  });

  // Request id + client request id (binds req.log child logger)
  await app.register(requestIdPlugin);

  // Ensure DB closes on shutdown
  app.addHook("onClose", async () => {
    await closeDb();
  });

  // Timing + structured per-request logs
  app.addHook("onRequest", async (req) => {
    (req as ReqWithTiming)._reqStartNs = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (req, reply) => {
    const start = (req as ReqWithTiming)._reqStartNs;
    if (typeof start !== "bigint") return;

    const ms = Number(process.hrtime.bigint() - start) / 1e6;

    const route = req.routeOptions?.url || "unmatched";
    const ua = clampStr(req.headers["user-agent"], 180);

    const bytesOutHdr = reply.getHeader("content-length");
    const bytesOut =
      typeof bytesOutHdr === "string" || typeof bytesOutHdr === "number"
        ? Number(bytesOutHdr)
        : null;

    const base: Record<string, unknown> = {
      reqId: (req as any).id,
      clientReqId: (req as any).clientRequestId ?? null,
      method: req.method,
      route,
      status: reply.statusCode,
      ms: Math.round(ms),
      ...(ua ? { ua } : {}),
      ...(Number.isFinite(bytesOut as any) ? { bytesOut } : {}),
    };

    if (ms >= 1500) req.log.warn(base, "slow_request");
    else if (reply.statusCode >= 500) req.log.error(base, "request_5xx");
    else req.log.info(base, "request");
  });

  // Security headers
  const helmetEnableCsp = toBool(process.env.HELMET_ENABLE_CSP, false);

  const helmetOpts: FastifyHelmetOptions & { global: true } = {
    global: true,
    crossOriginResourcePolicy: { policy: "same-site" },
    ...(helmetEnableCsp ? {} : { contentSecurityPolicy: false }),
  };

  await app.register(helmet, helmetOpts);

  // CORS (avoid callback/async origin function typing issues entirely)
  const corsAllowedRaw = parseCsvList(process.env.CORS_ORIGINS);
  const corsAllowed = uniq(corsAllowedRaw.map(normalizeOrigin));
  const corsCreds = toBool(process.env.CORS_CREDENTIALS, false);

  const corsOrigin: FastifyCorsOptions["origin"] =
    corsAllowed.length === 0 ? true : corsAllowed;

  const corsOpts: FastifyCorsOptions = {
    origin: corsOrigin,
    credentials: corsCreds,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    maxAge: 600,
  };

  await app.register(fastifyCors, corsOpts);

  await app.register(securityHeadersPlugin);

  // Compression
  const compressEnabled = toBool(process.env.COMPRESS_ENABLED, true);
  if (compressEnabled) {
    await app.register(compress, { global: true });
  }

  // Global soft rate limit (preHandler)
  registerGlobalRateLimit(app);

  // Auth plugin (API-key -> req.actor)
  await app.register(authActorPlugin, { pool });

  // System default: require auth for all routes except liveness/readiness.
  // This establishes a stable boundary for future quotas/subscriptions/auditing.
  const requireAuthMw = app.requireAuth();
const AUTH_BYPASS_PATHS = new Set(["/healthz", "/readyz", "/v1/health"]);

  app.addHook("preHandler", async (req, reply) => {
    // Fastify's req.url includes querystring; normalize to pathname only.
    const url = String((req as any).url || "");
    const path = url.split("?")[0] || url;
    if (AUTH_BYPASS_PATHS.has(path)) return;
    return requireAuthMw(req, reply);
  });

  // Health
  app.get("/healthz", async (_req, reply) => reply.send({ ok: true }));

  // Readiness (DB + auth prereqs)
  app.get("/readyz", async (_req, reply) => {
    const ok = await healthcheck();
    if (!ok) {
      reply.code(503).send({ ok: false, error: "db_unhealthy" });
      return;
    }
    try {
      await assertAuthPrereqs();
    } catch (err: any) {
      reply
        .code(503)
        .send({ ok: false, error: "db_missing_prereq", message: String(err?.message || "missing") });
      return;
    }
    reply.send({ ok: true });
  });

  await registerRoutes(app);

  function coerceStatus(n: unknown): number | null {
    const v = Number(n);
    return Number.isFinite(v) && v >= 400 && v <= 599 ? v : null;
  }

  function deepGet(obj: any, key: string): unknown {
    const seen = new Set<any>();
    let cur: any = obj;
    while (cur && typeof cur === "object" && !seen.has(cur)) {
      seen.add(cur);
      if (cur[key] !== undefined) return cur[key];
      cur = cur.cause;
    }
    return undefined;
  }

  function deepStatus(err: any): number | null {
    return (
      coerceStatus(deepGet(err, "statusCode")) ??
      coerceStatus(deepGet(err, "status")) ??
      coerceStatus(deepGet(err, "httpStatus")) ??
      null
    );
  }

  function deepCode(err: any): string | null {
    const v = deepGet(err, "code");
    return typeof v === "string" && v.trim() ? v.trim() : null;
  }

  function errorKeyFromStatus(status: number): "bad_request" | "unauthorized" | "forbidden" | "not_found" | "internal_error" {
    switch (status) {
      case 400:
        return "bad_request";
      case 401:
        return "unauthorized";
      case 403:
        return "forbidden";
      case 404:
        return "not_found";
      default:
        return "internal_error";
    }
  }

  function isHashValidationError(err: any): boolean {
    return String(err?.name || "") === "HashValidationError";
  }

  function isAuthError(err: any): boolean {
    // supports your AuthError class and any future wrappers
    return String(err?.name || "") === "AuthError";
  }

  // Not found handler
  app.setNotFoundHandler((req, reply) => {
    const reqId = (req as any).id;
    req.log.info({ reqId, route: req.url }, "not_found");
    reply.code(404).send({ error: "not_found", message: "not_found", request_id: reqId ?? null });
  });

  // Central error handler
  app.setErrorHandler((err: FastifyError & { name?: string }, req, reply) => {
    const route = req.routeOptions?.url || "unmatched";
    const reqId = (req as any).id;

    const status =
      deepStatus(err) ??
      // Fastify sometimes sets .statusCode at top-level only; keep fallback
      coerceStatus((err as any).statusCode) ??
      500;

    const code = deepCode(err);

    // Message policy:
    // - always safe for 4xx (client error, expected)
    // - never leak details for 5xx in production
    const safeMessage =
      status >= 500 && isProd ? "internal_error" : String((err as any)?.message || "error");

    const errorKey = errorKeyFromStatus(status);

    // Log policy:
    // - 5xx: error level
    // - expected 4xx validation/auth: info (avoid noisy warn/error)
    // - keep logs structured and small (do not log full err object)
    const logBase: Record<string, unknown> = {
      reqId,
      route,
      status,
      name: (err as any)?.name ?? null,
      message: String((err as any)?.message || ""),
      ...(code ? { code } : {}),
    };

    if (status >= 500) req.log.error(logBase, "request_error");
    else if (isHashValidationError(err) || status === 400) req.log.info(logBase, "request_error");
    else if (isAuthError(err) || status === 401 || status === 403) req.log.info(logBase, "request_error");
    else req.log.info(logBase, "request_error");

    const payload: Record<string, unknown> = {
      error: errorKey,
      message: safeMessage,
      request_id: reqId ?? null,
    };

    // Only expose a diagnostic code in non-production
    if (!isProd && code) payload.code = code;

    reply.code(status).send(payload);
  });

  return app;     
}

async function main() {
  const app = await buildApp();
  await app.ready();

  const port = toInt(process.env.PORT, 8090, 1, 65535);
  const host = clampStr(process.env.HOST, 128) || "0.0.0.0";

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutdown_start");
    try {
      await app.close();
      app.log.info({ signal }, "shutdown_complete");
      process.exit(0);
    } catch (err) {
      app.log.error({ err, signal }, "shutdown_failed");
      process.exit(1);
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port, host });
  app.log.info({ port, host }, "Hash Factory started");
}

const RUN_MAIN =
  String(process.env.RUN_MAIN ?? "").trim() === "1" ||
  (process.argv[1] && /server\.(ts|js|mjs)$/i.test(process.argv[1]));

if (RUN_MAIN) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

export { buildApp };