// src/db.ts
import { Pool, type PoolClient } from "pg";

function toInt(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function envStr(name: string, def = ""): string {
  const v = process.env[name];
  return v == null ? def : String(v);
}

function envBool(name: string, def = false): boolean {
  const raw = process.env[name];
  if (raw == null) return def;
  const s = String(raw).trim().toLowerCase();
  if (!s) return def;
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

const NODE_ENV = envStr("NODE_ENV", "development").trim().toLowerCase();
const IS_PROD = NODE_ENV === "production";

const DB_URL =
  envStr("DATABASE_URL").trim();

if (!DB_URL) {
  throw new Error("DATABASE_URL (or HASH_FACTORY_DATABASE_URL / READ_API_DATABASE_URL) is required");
}

const APP_NAME = envStr("PG_APP_NAME", "hash-factory").trim() || "hash-factory";

// Pool sizing
const POOL_MAX = Math.max(1, toInt(process.env.PG_POOL_MAX, IS_PROD ? 10 : 3));
const CONNECT_TIMEOUT_MS = Math.max(1000, toInt(process.env.PG_CONNECT_MS, 10_000));
const IDLE_TIMEOUT_MS = Math.max(1000, toInt(process.env.PG_IDLE_MS, 30_000));
const MAX_USES = Math.max(0, toInt(process.env.PG_MAX_USES, 0)); // 0 = never rotate

// Per-connection timeouts
const STMT_TIMEOUT_MS = Math.max(250, toInt(process.env.PG_STATEMENT_TIMEOUT_MS, 15_000));
const IDLE_TXN_TIMEOUT_MS = Math.max(
  250,
  toInt(process.env.PG_IDLE_IN_TXN_SESSION_TIMEOUT_MS, 60_000)
);
const IDLE_SESS_TIMEOUT_MS = Math.max(
  1000,
  toInt(process.env.PG_IDLE_SESSION_TIMEOUT_MS, 300_000)
);

export const pool = new Pool({
  connectionString: DB_URL,
  max: POOL_MAX,
  connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
  application_name: APP_NAME,
  maxUses: MAX_USES,
  keepAlive: true,
});

// Apply session settings on every new pooled connection
pool.on("connect", (client) => {
  const stmt = Math.max(250, STMT_TIMEOUT_MS);
  const idleTxn = Math.max(250, IDLE_TXN_TIMEOUT_MS);
  const idleSess = Math.max(1000, IDLE_SESS_TIMEOUT_MS);

  const tasks: Array<Promise<unknown>> = [];

  // Keep search_path aligned with your DB layout. Adjust if needed.
  tasks.push(client.query("SET search_path TO core, utils, public"));

  tasks.push(client.query(`SET statement_timeout = '${stmt}ms'`));
  tasks.push(client.query(`SET idle_in_transaction_session_timeout = '${idleTxn}ms'`));
  tasks.push(client.query(`SET idle_session_timeout = '${idleSess}ms'`));

  Promise.all(tasks).catch(() => {});
});

// Non-fatal pool errors on idle clients
pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[db] pg pool error:", err?.message || err);
});

// Warn if pool is saturated 
async function connectWithWarn(): Promise<PoolClient> {
  const warnAfterMs = Math.max(50, toInt(process.env.PG_CONNECT_WARN_MS, 750));
  const t = setTimeout(() => {
    // eslint-disable-next-line no-console
    console.warn("[db] connect() waiting for a free client (pool contention)");
  }, warnAfterMs);

  try {
    const c = await pool.connect();
    clearTimeout(t);
    return c;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

export async function healthcheck(): Promise<boolean> {
  try {
    const r = await pool.query("SELECT 1");
    return r.rowCount === 1;
  } catch {
    return false;
  }
}

/**
 * Auth prereq check: ensures core.api_keys exists.
 */
export async function assertAuthPrereqs(): Promise<void> {
  const r = await pool.query<{ ok: boolean; has_table: boolean }>(`
    SELECT
      to_regprocedure('core.api_key_lookup(text)') IS NOT NULL AS ok,
      to_regclass('core.api_keys') IS NOT NULL AS has_table
  `);

  if (!r.rows?.[0]?.ok) {
    throw new Error("db_missing_prereq: core.api_key_lookup(text) not found");
  }
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await connectWithWarn();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  await pool.end();
}