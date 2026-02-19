// src/auth/apiKeyAuth.ts
import type { FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { sha3_512_hex_lower } from "../utils/cryptoUtils.js";

const MAX_API_KEY_LEN = 1024;

function clamp01(v: unknown, d: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.max(0, Math.min(1, n));
}

export class AuthError extends Error {
  code: string;
  statusCode: number;
  cause?: unknown;

  constructor(message: string, opts?: { code?: string; statusCode?: number; cause?: unknown }) {
    super(message);
    this.name = "AuthError";
    this.code = opts?.code ?? "AUTH_FAILED";
    this.statusCode = opts?.statusCode ?? 401;
    this.cause = opts?.cause;
  }
}

function extractApiKeyFromHeaders(req: FastifyRequest): string | null {
  const authRaw = req.headers.authorization;
  const xRaw = req.headers["x-api-key"];

  const bearer =
    typeof authRaw === "string" && authRaw.toLowerCase().startsWith("bearer ")
      ? authRaw.slice("bearer ".length).trim()
      : null;

  const x = typeof xRaw === "string" ? xRaw.trim() : null;

  if (bearer && x && bearer !== x) {
    throw new AuthError("Multiple API key headers provided", {
      statusCode: 400,
      code: "AUTH_AMBIGUOUS",
    });
  }

  const token = bearer || x || null;
  if (!token) return null;

  if (token.length > MAX_API_KEY_LEN) {
    throw new AuthError("API key too long", { statusCode: 400, code: "AUTH_INVALID" });
  }

  return token;
}

function toInt(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

export type ApiKeyAuthenticatorOpts = {  pool: Pool;
  touchLastUsed?: boolean;
  touchSampleRate?: number;
  touchMinIntervalMs?: number;
  cacheTtlMs?: number;
  cacheMax?: number;
  touchMaxKeys?: number;
};

export function createApiKeyAuthenticator(opts: ApiKeyAuthenticatorOpts) {
  const pool = opts.pool;
  if (!pool || typeof (pool as any).query !== "function") {
    throw new Error("createApiKeyAuthenticator requires a pg pool");
  }

  const touchLastUsed = opts.touchLastUsed ?? true;
  const touchSampleRate = clamp01(opts.touchSampleRate, 0.02);
  const touchMinIntervalMs = opts.touchMinIntervalMs ?? 60_000;
  const cacheTtlMs = toInt(opts.cacheTtlMs, 0);
  const cacheMax = toInt(opts.cacheMax, 2000);
  const touchMaxKeys = toInt(opts.touchMaxKeys, 50_000);

  const cache = cacheTtlMs > 0 ? new Map<string, { value: any; expiresAt: number }>() : null;

  function cacheGet(keyHash: string) {
    if (!cache) return null;
    const hit = cache.get(keyHash);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      cache.delete(keyHash);
      return null;
    }
    return hit.value;
  }

  function cacheSet(keyHash: string, value: any) {
    if (!cache) return;
    if (cache.size >= cacheMax) {
      const first = cache.keys().next().value as string | undefined;
      if (first) cache.delete(first);
    }
    cache.set(keyHash, { value, expiresAt: Date.now() + cacheTtlMs });
  }

  const lastTouchByKeyId = new Map<string, number>();

  function noteTouchKey(api_key_id: string, now: number) {
    lastTouchByKeyId.set(api_key_id, now);
    if (touchMaxKeys > 0 && lastTouchByKeyId.size > touchMaxKeys) {
      const first = lastTouchByKeyId.keys().next().value as string | undefined;
      if (first) lastTouchByKeyId.delete(first);
    }
  }

  async function maybeTouchLastUsed(api_key_id: string) {
    if (!touchLastUsed) return;
    const now = Date.now();
    const last = lastTouchByKeyId.get(api_key_id);
    if (last != null && now - last < touchMinIntervalMs) return;

    const rate = Number(touchSampleRate);
    const doTouch = Number.isFinite(rate) ? Math.random() < rate : false;
    if (!doTouch) return;

    await pool.query("SELECT core.api_key_touch_last_used($1)", [api_key_id]);
    noteTouchKey(api_key_id, now);
  }

  async function lookupBySecret(secret: unknown) {
    const raw = String(secret || "").trim();
    if (!raw) return null;
    if (raw.length > MAX_API_KEY_LEN) return null;

    const keyHash = sha3_512_hex_lower(raw);

    const cached = cacheGet(keyHash);
    if (cached) return cached;

    let res;
    try {
      res = await pool.query("SELECT * FROM core.api_key_lookup($1)", [keyHash]);
    } catch (err) {
      throw new AuthError("Authentication failed", {
        statusCode: 401,
        code: "AUTH_FAILED",
        cause: err,
      });
    }

    const row = res.rows?.[0] ?? null;
    if (!row) return null;

    try {
      await maybeTouchLastUsed(row.api_key_id);
    } catch {
      // non-fatal
    }

    cacheSet(keyHash, row);
    return row;
  }

  async function authenticateRequest(req: FastifyRequest) {
    let secret: string | null;
    try {
      secret = extractApiKeyFromHeaders(req);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError("Authentication failed", { statusCode: 401, code: "AUTH_FAILED", cause: err });
    }

    if (!secret) return null;

    const row = await lookupBySecret(secret);
    if (!row) {
      throw new AuthError("Invalid or expired API key", { statusCode: 401, code: "AUTH_INVALID" });
    }
    return row;
  }

  return { authenticateRequest, lookupBySecret };
}