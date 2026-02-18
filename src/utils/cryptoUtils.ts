// src/utils/cryptoUtils.ts
// Version: 1.0-hash-factory-minimal | 2026-02-17
// Purpose:
//   Minimal, deterministic crypto primitives for Hash Factory.
//   - SHA3-512 helpers used by API-key auth + hashing contract
//   - Canonical JSON stringify (stable, deterministic; matches explorer/core behavior)
//   - DoS guards for hashing inputs (byte budget + depth/keys/array caps)

import crypto from "node:crypto";

// -----------------------------------------------------------------------------
// Hardening limits (hashing) — keep aligned with core/explorer defaults
// -----------------------------------------------------------------------------
const MAX_HASH_INPUT_BYTES = Number.parseInt(
  process.env.SERVICE_MAX_HASH_BYTES || String(256 * 1024),
  10
); // 256KB
const MAX_STRIP_DEPTH = Number.parseInt(process.env.CRYPTO_MAX_STRIP_DEPTH || "20", 10);
const MAX_STRIP_KEYS = Number.parseInt(process.env.CRYPTO_MAX_STRIP_KEYS || "20000", 10);
const MAX_STRIP_ARRAY_LEN = Number.parseInt(process.env.CRYPTO_MAX_STRIP_ARRAY_LEN || "5000", 10);

// -----------------------------------------------------------------------------
// Basic encoders / decoders (useful for hash contract work)
// -----------------------------------------------------------------------------
export function utf8ToBytes(s: string): Uint8Array {
  return Buffer.from(String(s ?? ""), "utf8");
}

export function bytesToHexLower(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex").toLowerCase();
}

export function hexToBytesStrict(hex: string, name = "hex"): Uint8Array {
  const s = String(hex ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]*$/.test(s) || s.length % 2 !== 0) {
    throw new Error(`${name} must be even-length hex`);
  }
  return Buffer.from(s, "hex");
}

export function bytesToB64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function b64urlToBytesStrict(s: string, name = "b64url"): Uint8Array {
  const raw = String(s ?? "").trim();
  if (!raw) throw new Error(`${name} required`);
  try {
    return Buffer.from(raw, "base64url");
  } catch {
    throw new Error(`${name} invalid`);
  }
}

// -----------------------------------------------------------------------------
// Safe stringify + byte budget guard (DoS prevention)
// -----------------------------------------------------------------------------
function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "function") return undefined;
    if (typeof v === "symbol") return String(v);
    if (typeof Buffer !== "undefined" && Buffer.isBuffer?.(v)) return "[buffer]";
    if (v && typeof v === "object") {
      if (seen.has(v as object)) return "[circular]";
      seen.add(v as object);
    }
    return v;
  });
}

export function assertJsonByteBudget(
  obj: unknown,
  maxBytes = MAX_HASH_INPUT_BYTES
): { json: string; bytes: number } {
  let json: string;
  try {
    json = safeJsonStringify(obj);
  } catch (e: any) {
    throw new Error(`Unserializable hash input: ${e?.message || "unknown"}`);
  }
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > maxBytes) {
    throw new Error(`Hash input too large (${bytes} bytes > ${maxBytes} bytes)`);
  }
  return { json, bytes };
}

// -----------------------------------------------------------------------------
// Canonical JSON (Deterministic)
// - stable key order
// - no whitespace
// - safe sentinels for problematic JS types
// -----------------------------------------------------------------------------
export function canonicalStringify(obj: unknown): string {
  const seen = new WeakSet<object>();

  const walk = (x: any): string => {
    if (x === null || x === undefined) return JSON.stringify(x);
    if (typeof x === "bigint") return JSON.stringify(x.toString());
    if (typeof x === "function") return JSON.stringify("[function]");
    if (typeof x === "symbol") return JSON.stringify(String(x));
    if (typeof Buffer !== "undefined" && Buffer.isBuffer?.(x)) return JSON.stringify("[buffer]");

    if (Array.isArray(x)) return `[${x.map(walk).join(",")}]`;

    if (typeof x === "object") {
      if (seen.has(x as object)) return JSON.stringify("[circular]");
      seen.add(x as object);

      const keys = Object.keys(x).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${walk(x[k])}`).join(",")}}`;
    }

    return JSON.stringify(x);
  };

  return walk(obj);
}

// -----------------------------------------------------------------------------
// Strip ignored keys before hashing (bounded; deterministic shape)
// -----------------------------------------------------------------------------
export function stripIgnoredKeys(
  obj: unknown,
  ignoreKeys: string[] = [],
  {
    maxDepth = MAX_STRIP_DEPTH,
    maxKeys = MAX_STRIP_KEYS,
    maxArrayLen = MAX_STRIP_ARRAY_LEN,
  }: { maxDepth?: number; maxKeys?: number; maxArrayLen?: number } = {}
): unknown {
  const seen = new WeakSet<object>();
  let keyCount = 0;

  const walk = (x: any, depth: number): any => {
    if (x === null || x === undefined) return x;
    if (depth > maxDepth) return "[truncated-depth]";

    if (Array.isArray(x)) {
      const cap = Math.min(x.length, maxArrayLen);
      const out = new Array(cap);
      for (let i = 0; i < cap; i++) out[i] = walk(x[i], depth + 1);
      if (x.length > cap) out.push("[truncated-array]");
      return out;
    }

    if (typeof x === "object") {
      if (seen.has(x as object)) return "[circular]";
      seen.add(x as object);

      const out: Record<string, any> = {};
      for (const key of Object.keys(x)) {
        keyCount++;
        if (keyCount > maxKeys) {
          out.__truncated__ = true;
          break;
        }
        if (ignoreKeys.includes(key)) continue;

        const v = x[key];
        if (typeof v === "function") continue;
        if (typeof Buffer !== "undefined" && Buffer.isBuffer?.(v)) {
          out[key] = "[buffer]";
          continue;
        }
        out[key] = walk(v, depth + 1);
      }
      return out;
    }

    return x;
  };

  return walk(obj as any, 0);
}

// -----------------------------------------------------------------------------
// SHA3-512 primitives
// -----------------------------------------------------------------------------
function toBufferStrict(input: unknown): Buffer {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (typeof input === "string") return Buffer.from(input, "utf8");
  throw new TypeError("sha3-512 input must be string, Buffer, or Uint8Array");
}

/** SHA3-512 over raw bytes (NOT canonical JSON). Returns hex. */
export function sha3_512_hex(input: unknown, { lowercase = true }: { lowercase?: boolean } = {}): string {
  const buf = toBufferStrict(input);
  const hex = crypto.createHash("sha3-512").update(buf).digest("hex");
  return lowercase ? hex.toLowerCase() : hex;
}

/** SHA3-512 over raw bytes. Returns digest bytes. */
export function sha3_512_bytes(input: unknown): Uint8Array {
  const buf = toBufferStrict(input);
  return crypto.createHash("sha3-512").update(buf).digest();
}

/** Convenience alias used by auth flows (DB expects lowercase hex). */
export function sha3_512_hex_lower(input: unknown): string {
  return sha3_512_hex(input, { lowercase: true });
}

// -----------------------------------------------------------------------------
// Deterministic object hashing helpers (canonical JSON + optional stripping)
// -----------------------------------------------------------------------------
export function computeDataHash(
  data: unknown,
  { maxBytes = null }: { maxBytes?: number | null } = {}
): string {
  const canonical = typeof data === "string" ? data : canonicalStringify(data);

  if (maxBytes != null) {
    const bytes = Buffer.byteLength(canonical, "utf8");
    if (bytes > maxBytes) {
      throw new Error(`Hash input too large (${bytes} bytes > ${maxBytes} bytes)`);
    }
  }

  return crypto.createHash("sha3-512").update(canonical).digest("hex").toLowerCase();
}

/**
 * Deterministic, safe hashing:
 * - If given { payload: ... }, hash payload
 * - Enforce byte budget (DoS guard)
 * - Strip ignore keys before hashing
 */
export function computeHashExcluding(
  data: unknown,
  ignoreKeys: string[] = [],
  { maxBytes = MAX_HASH_INPUT_BYTES }: { maxBytes?: number } = {}
): string {
  const d = data as any;
  const target = d && typeof d === "object" && d.payload !== undefined ? d.payload : d;

  assertJsonByteBudget(target, maxBytes);

  const cleaned = stripIgnoredKeys(target, ignoreKeys);
  return computeDataHash(cleaned);
}

export const DEFAULT_IGNORE_HASH_KEYS: string[] = [
  "data_hash",
  "created_at",
  "updated_at",
  "deleted_at",
  "status",
  "timestamp",
  "captured_at",
  "host",
  "id",
  "idempotency_key",
  "traceId",
  "requestId",
];

export function computeCanonicalHash(obj: unknown): string {
  return computeHashExcluding(obj, DEFAULT_IGNORE_HASH_KEYS);
}