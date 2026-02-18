// ============================================================================
// File: src/routes/health.ts
// Version: 1.0-routes-health-v1 | 2026-02-17
// Purpose:
//   /v1/health: liveness + best-effort dependency checks.
// Notes:
//   - Never throws; always returns { ok, checks }.
//   - Cache-Control: no-store.
// ============================================================================

import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { sendNoStore } from "./_util.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/v1/health", async (_req, reply) => {
    sendNoStore(reply);

    const isProd = String(process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
    const out: any = { ok: true, checks: {} };

    // DB check
    try {
      const r = await pool.query("SELECT now() AT TIME ZONE 'utc' as now");
      out.checks.db = { ok: true, now: r.rows?.[0]?.now ?? null };
    } catch (e: any) {
      out.ok = false;
      out.checks.db = { ok: false, error: isProd ? "db_unavailable" : String(e?.message || e) };
    }

    // Mirror freshness check (best-effort, never flips overall ok)
    try {
      const pres = await pool.query(`
        select
          to_regclass('core.v_hcs_transactions_public') is not null as has_view,
          to_regclass('core.hcs_transactions') is not null as has_table
      `);

      const hasView = Boolean(pres.rows?.[0]?.has_view);
      const hasTable = Boolean(pres.rows?.[0]?.has_table);

      if (hasView) {
        const r = await pool.query(`
          SELECT EXTRACT(EPOCH FROM (now() - MAX(consensus_at)))::int AS lag_sec
          FROM core.v_hcs_transactions_public
        `);
        out.checks.mirror = {
          ok: true,
          lag_sec: r.rows?.[0]?.lag_sec ?? null,
          source: "v_hcs_transactions_public",
        };
      } else if (hasTable) {
        const r = await pool.query(`
          SELECT EXTRACT(EPOCH FROM (now() - MAX(consensus_at)))::int AS lag_sec
          FROM core.hcs_transactions
        `);
        out.checks.mirror = {
          ok: true,
          lag_sec: r.rows?.[0]?.lag_sec ?? null,
          source: "hcs_transactions",
        };
      } else {
        out.checks.mirror = { ok: false, lag_sec: null, source: null };
      }
    } catch {
      out.checks.mirror = { ok: false, lag_sec: null, source: null };
    }

    return reply.send(out);
  });
}