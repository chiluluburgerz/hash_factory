// ============================================================================
// File: src/plugins/globalRateLimit.ts
// Version: 1.0-enterprise-global-soft-rate-limit | 2026-01-16
// Purpose:
//   Global "soft" rate limiter for all routes (preHandler).
//   - Prevents list-scan abuse across many endpoints
//   - Per-route strict limiters can still exist 
// ============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  createFixedWindowRateLimiter,
  rateLimitEnabled,
  getClientIp,
  isUnknownIp,
  applyRateLimitHeaders,
  rejectRateLimited,
  readEnvInt,
} from "../utils/rateLimit.js";

function stripQuery(rawUrl: string): string {
  const s = String(rawUrl || "");
  const i = s.indexOf("?");
  return i >= 0 ? s.slice(0, i) : s;
}

export function registerGlobalRateLimit(app: FastifyInstance) {
  // Support both API_* and legacy RATE_LIMIT_* env names.
  const windowMs = Math.max(
    1_000,
    readEnvInt(["API_RATE_LIMIT_WINDOW_MS", "RATE_LIMIT_WINDOW_MS"], 60_000)
  );
  const max = Math.max(1, readEnvInt(["API_RATE_LIMIT_MAX", "RATE_LIMIT_MAX"], 120));
  const maxEntries = Math.max(1_000, readEnvInt(["API_RATE_LIMIT_MAX_ENTRIES"], 50_000));
  const unknownIpMax = Math.max(1, readEnvInt(["API_RATE_LIMIT_UNKNOWN_IP_MAX"], 15));
  const unknownIpMaxEntries = Math.max(100, readEnvInt(["API_RATE_LIMIT_UNKNOWN_IP_MAX_ENTRIES"], 1_000));

  const limiter = createFixedWindowRateLimiter({ windowMs, max, maxEntries });
  const unknownLimiter = createFixedWindowRateLimiter({ windowMs, max: unknownIpMax, maxEntries: unknownIpMaxEntries });

  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!rateLimitEnabled()) return;

    const routeUrl = String((req as any)?.routeOptions?.url ?? "");
    const rawUrl = stripQuery(String(req.raw?.url ?? ""));
    const url = routeUrl || rawUrl;

    if (
      url === "/" ||
      url === "/healthz" ||
      url === "/readyz" ||
      url === "/openapi.json" ||
      url.startsWith("/docs") ||
      url.startsWith("/static/")
    ) {
      return;
    } 

    const ip = getClientIp(req);
    const method = String(req.method || "GET");
    const key = `${ip}||${method}`;
    const activeLimiter = isUnknownIp(ip) ? unknownLimiter : limiter;

    const d = activeLimiter.check(key);
    if (!d.allowed) {
      rejectRateLimited(reply, d);
      return;
    }
    applyRateLimitHeaders(reply, d);
  });
}
