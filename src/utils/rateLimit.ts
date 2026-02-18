// ============================================================================
// File: src/utils/rateLimit.ts
// Version: 1.0-enterprise-fixed-window | 2026-01-16
// Purpose:
//   Dependency-free in-memory rate limiter (fixed window):
//     • Configurable per limiter instance
//     • Safe enable/disable via env
//     • Conservative IP extraction
// ============================================================================

import type { FastifyReply, FastifyRequest } from "fastify";

type Counter = { windowStartMs: number; count: number };
const UNKNOWN_IP = "unknown";

function envTrue(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}


export function readEnvInt(names: string[], def: number): number {
  for (const n of names) {
    const raw = process.env[n];
    if (raw === undefined) continue;
    const v = Number(raw);
    if (Number.isFinite(v)) return Math.floor(v);
  }
  return def;
}

function readEnvBool(names: string[], def: boolean): boolean {
  for (const n of names) {
    const raw = process.env[n];
    if (raw === undefined) continue;
    return envTrue(raw);
  }
  return def;
}

export function trustProxyEnabled(): boolean {
  const v = process.env.TRUST_PROXY;
  if (v === undefined) return false; // safer default
  return envTrue(v);
}

export function rateLimitEnabled(): boolean {
  // Prefer RATE_LIMIT_ENABLE; keep API_RATE_LIMIT_ENABLE for backwards compatibility.
  const v1 = process.env.RATE_LIMIT_ENABLE;
  if (v1 !== undefined) return envTrue(v1);
  const v2 = process.env.API_RATE_LIMIT_ENABLE;
  if (v2 !== undefined) return envTrue(v2);
  return true;
}

export function getClientIp(req: FastifyRequest): string {
  // Single source of truth:
  const ip = (req as any).ip;
  if (typeof ip === "string" && ip.trim()) return normalizeIp(ip);
 
  const ra =
    (req.socket && typeof req.socket.remoteAddress === "string" && req.socket.remoteAddress) ||
    (req.raw &&
      (req.raw.socket?.remoteAddress ||
        (req.raw.connection as any)?.remoteAddress)) ||
    "";
  return normalizeIp(String(ra || ""));
}

function normalizeIp(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return UNKNOWN_IP;
  // IPv6 loopback → treat as IPv4 loopback for allowlists
  if (s === "::1") return "127.0.0.1";
  // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
  const m = s.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (m && m[1]) return m[1];
  return s;
}

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
  retryAfterSeconds: number;
};

export type RateLimiter = {
  check: (key: string) => RateLimitDecision;
};

export function createFixedWindowRateLimiter(opts: {
  windowMs: number;
  max: number;
  maxEntries?: number;
}): RateLimiter {
  const windowMs = Math.max(1000, Math.floor(opts.windowMs));
  const max = Math.max(1, Math.floor(opts.max));
  const maxEntries = Math.max(100, Math.floor(opts.maxEntries ?? 5000));

  const map = new Map<string, Counter>();
  const EVICT_CLEANUP_THRESHOLD = Math.max(100, Math.floor(maxEntries * 0.9));

  function cleanupExpired(now: number) {
    for (const [k, v] of map) {
      if (now - v.windowStartMs >= windowMs) map.delete(k);
    }
  }

  function evictIfNeeded(now: number) {
    if (map.size >= EVICT_CLEANUP_THRESHOLD) cleanupExpired(now);
    while (map.size > maxEntries) {
      const k = map.keys().next().value as string | undefined;
      if (!k) break;
      map.delete(k);
    }
  }

  function check(key: string): RateLimitDecision {
    const now = Date.now();
    const k = String(key || "unknown");
    const cur = map.get(k);

    if (!cur || now - cur.windowStartMs >= windowMs) {
      map.set(k, { windowStartMs: now, count: 1 });
      evictIfNeeded(now);
      return {
        allowed: true,
        limit: max,
        remaining: Math.max(0, max - 1),
        resetMs: now + windowMs,
        retryAfterSeconds: 0,
      };
    }

    cur.count += 1;
    map.set(k, cur);
    evictIfNeeded(now);

    const resetMs = cur.windowStartMs + windowMs;
    const allowed = cur.count <= max;
    const remaining = Math.max(0, max - cur.count);
    const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil((resetMs - now) / 1000));

    return { allowed, limit: max, remaining, resetMs, retryAfterSeconds };
  }

  return { check };
}

export function applyRateLimitHeaders(reply: FastifyReply, d: RateLimitDecision): void {
  reply.header("X-RateLimit-Limit", String(d.limit));
  reply.header("X-RateLimit-Remaining", String(d.remaining));
  reply.header("X-RateLimit-Reset", String(Math.floor(d.resetMs / 1000)));
  if (!d.allowed && d.retryAfterSeconds > 0) {
    reply.header("Retry-After", String(d.retryAfterSeconds));
  }
}

export function rejectRateLimited(reply: FastifyReply, d: RateLimitDecision): void {
  applyRateLimitHeaders(reply, d);
  reply.code(429).send({
    error: "rate_limited",
    message: "Too many requests. Please retry later.",
    retry_after_seconds: d.retryAfterSeconds,
  });
}

export function isUnknownIp(ip: string): boolean {
  return String(ip || "").trim() === UNKNOWN_IP;
}