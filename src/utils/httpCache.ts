// ============================================================================
// File: src/utils/httpCache.ts
// Version: 1.0-hash-factory-etag-memory-cache | 2026-02-18
// Purpose:
//   Dependency-free HTTP cache helper (Hash Factory):
//     • Deterministic strong ETags (sha3-512)
//     • In-memory response cache for small JSON payloads
//     • Strict keying: caller must include actor identity where relevant
//
// Guidance:
//   - Prefer ETag-only (304) for most endpoints.
//   - Only cache GET responses that are safe to share (public contract).
//   - Do NOT cache POST responses by default.
// ============================================================================

import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export type CacheableBody = unknown | string | Buffer;

export type CachedResponse = {
  etag: string;
  status: number;
  headers: Record<string, string>;
  body: CacheableBody;
  createdAtMs: number;
  expiresAtMs: number;
};

function envTrue(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function toInt(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = toInt(n, fallback);
  return Math.max(min, Math.min(max, v));
}

export function cacheEnabled(): boolean {
  const v = process.env.API_CACHE_ENABLE;
  if (v === undefined) return true;
  return envTrue(v);
}

export function sha3_512_hex(input: string | Buffer): string {
  return crypto.createHash("sha3-512").update(input).digest("hex");
}

export function makeEtagFromHexDigest(hexDigest: string): string {
  // Strong ETag; quote per RFC formatting.
  return `"${String(hexDigest).toLowerCase()}"`;
}

export function makeEtagFromString(s: string): string {
  return makeEtagFromHexDigest(sha3_512_hex(s));
}

export function makeEtagFromBuffer(buf: Buffer): string {
  return makeEtagFromHexDigest(sha3_512_hex(buf));
}

function parseIfNoneMatchList(v: string): string[] {
  // Accept comma-separated ETags. Conservative parsing:
  // - trim whitespace
  // - strip weak prefix W/
  // - keep quotes intact
  const raw = String(v || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith("W/") ? s.slice(2).trim() : s));
}

export function getIfNoneMatch(req: FastifyRequest): string | null {
  const v = (req.headers["if-none-match"] ?? null) as any;
  if (!v) return null;
  if (Array.isArray(v)) return String(v[0] ?? "") || null;
  return String(v) || null;
}

export function matchesIfNoneMatch(req: FastifyRequest, etag: string): boolean {
  const inm = getIfNoneMatch(req);
  if (!inm) return false;
  const want = String(etag).trim();
  const list = parseIfNoneMatchList(String(inm));
  if (list.length === 0) return false;
  return list.some((x) => String(x).trim() === want);
}

export function replyNotModified(reply: FastifyReply, etag: string): void {
  reply.header("ETag", etag);
  reply.code(304).send();
}

export function stableJsonStringify(v: unknown): string {
  // Deterministic JSON stringify with stable key ordering.
  const seen = new WeakSet<object>();

  const sortKeys = (x: any): any => {
    if (x === null || x === undefined) return x;
    if (typeof x !== "object") return x;
    if (Buffer.isBuffer(x)) return x.toString("base64");
    if (x instanceof Date) return x.toISOString();

    if (Array.isArray(x)) return x.map(sortKeys);

    if (seen.has(x)) return "[Circular]";
    seen.add(x);

    const out: Record<string, any> = {};
    for (const k of Object.keys(x).sort()) out[k] = sortKeys(x[k]);
    return out;
  };

  return JSON.stringify(sortKeys(v));
}

export function stableCacheKey(parts: Array<string | number | boolean | null | undefined>): string {
  // Strict join with delimiter that won't appear in our ids/paths.
  return parts.map((p) => String(p ?? "")).join("||");
}

function maxCacheBodyBytes(): number {
  // Hash Factory should cache only small GET payloads (e.g., /v1/contract).
  const raw = process.env.API_CACHE_MAX_BODY_BYTES;
  return clampInt(raw ?? 131_072, 1024, 10_000_000, 131_072);
}

function approxBodyBytes(body: CacheableBody): number {
  try {
    if (body == null) return 0;
    if (Buffer.isBuffer(body)) return body.length;
    if (typeof body === "string") return Buffer.byteLength(body, "utf8");
    return Buffer.byteLength(JSON.stringify(body), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function headerKeyLower(k: string): string {
  return String(k || "").trim().toLowerCase();
}

function hasHeader(headers: Record<string, string> | null | undefined, name: string): boolean {
  const want = headerKeyLower(name);
  for (const k of Object.keys(headers || {})) {
    if (headerKeyLower(k) === want) return true;
  }
  return false;
}

function getHeader(headers: Record<string, string> | null | undefined, name: string): string | null {
  const want = headerKeyLower(name);
  for (const [k, v] of Object.entries(headers || {})) {
    if (headerKeyLower(k) === want) return String(v ?? "");
  }
  return null;
}

function cacheIsUnsafe(headers: Record<string, string> | null | undefined): boolean {
  // Defense-in-depth: refuse caching if response looks session/user-specific.
  if (hasHeader(headers, "set-cookie")) return true;

  const cc = (getHeader(headers, "cache-control") || "").toLowerCase();
  if (cc.includes("no-store")) return true;
  if (cc.includes("private")) return true;

  return false;
}

export class ResponseCache {
  private maxEntries: number;
  private store: Map<string, CachedResponse>;

  constructor(opts?: { maxEntries?: number }) {
    const max = Number(opts?.maxEntries ?? process.env.API_CACHE_MAX_ENTRIES ?? 200);
    this.maxEntries = Number.isFinite(max) && max > 0 ? Math.floor(max) : 200;
    this.store = new Map();
  }

  get(key: string): CachedResponse | null {
    const now = Date.now();
    const v = this.store.get(key);
    if (!v) return null;

    if (v.expiresAtMs <= now) {
      this.store.delete(key);
      return null;
    }

    // Simple LRU bump.
    this.store.delete(key);
    this.store.set(key, v);
    return v;
  }

  set(key: string, value: Omit<CachedResponse, "createdAtMs" | "expiresAtMs">, ttlSeconds: number): void {
    // Defense-in-depth: refuse caching unsafe responses.
    if (cacheIsUnsafe(value.headers)) return;

    // Memory DoS guard.
    const bytes = approxBodyBytes(value.body);
    if (bytes > maxCacheBodyBytes()) return;

    const now = Date.now();
    const ttlMs = Math.max(0, Math.floor(ttlSeconds * 1000));

    const entry: CachedResponse = {
      ...value,
      createdAtMs: now,
      expiresAtMs: now + ttlMs,
    };

    // Evict oldest if needed.
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }

    this.store.set(key, entry);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export function applyCachedResponse(reply: FastifyReply, cached: CachedResponse): void {
  for (const [k, v] of Object.entries(cached.headers || {})) {
    if (v != null && v !== "") reply.header(k, v);
  }
  reply.header("ETag", cached.etag);
  reply.code(cached.status).send(cached.body as any);
}