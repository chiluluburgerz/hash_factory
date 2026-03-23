// ============================================================================
// File: src/routes/nftCertificates.ts
// Version: 1.2-hash-factory-nft-certificate-routes-readonly | 2026-03-16
// Purpose:
//   Fastify routes for HF certificate slice.
//   - Auth required
//   - Read-only certificate routes + deterministic existence checks
//   - No issuance routes exposed from HF
//   - No fake admin certificate route
//   - Pass-through auth to Core
//   - Strict query/body allowlists
//   - No-store responses
// ============================================================================

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { NftCertificateService, Actor } from "../services/nftCertificateService.js";

const MAX_BODY_BYTES_DEFAULT = 128 * 1024;
const MAX_KEYS = Number.parseInt(process.env.HF_NFT_CERTIFICATES_MAX_KEYS || "128", 10);
const MAX_DEPTH = Number.parseInt(process.env.HF_NFT_CERTIFICATES_MAX_DEPTH || "6", 10);
const MAX_ARRAY = Number.parseInt(process.env.HF_NFT_CERTIFICATES_MAX_ARRAY || "64", 10);
const MAX_STRING = Number.parseInt(process.env.HF_NFT_CERTIFICATES_MAX_STRING || "4096", 10);
const MAX_LIMIT = 200;

function requireActor(req: FastifyRequest): Actor {
  const actor = (req as any).actor ?? null;
  if (actor && typeof actor === "object") return actor as Actor;
  const e: any = new Error("Unauthorized");
  e.statusCode = 401;
  e.code = "AUTH_REQUIRED";
  throw e;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function bytesOfJson(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? {}), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function toInt(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function maxRouteBodyBytes(): number {
  const raw =
    process.env.HF_NFT_CERTIFICATES_ROUTE_BODY_MAX_BYTES ??
    process.env.HTTP_ROUTE_BODY_MAX_BYTES ??
    null;
  if (raw == null || raw === "") return MAX_BODY_BYTES_DEFAULT;
  const v = toInt(raw, MAX_BODY_BYTES_DEFAULT);
  return Math.max(256, Math.min(2_000_000, v));
}

function isUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function requireUuidParam(v: unknown, code: string): string {
  const s = String(v ?? "").trim();
  if (!isUuid(s)) {
    const e: any = new Error(code.toLowerCase());
    e.statusCode = 400;
    e.code = code;
    throw e;
  }
  return s;
}

function requireProofDate(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const e: any = new Error("invalid_proof_date");
    e.statusCode = 400;
    e.code = "INVALID_PROOF_DATE";
    throw e;
  }
  return s;
}

function requireCertificateKind(v: unknown): "dataset_certificate" | "merkle_anchor_certificate" {
  const s = String(v ?? "").trim();
  if (
    s !== "dataset_certificate" &&
    s !== "merkle_anchor_certificate"
  ) {
    const e: any = new Error("invalid_certificate_kind");
    e.statusCode = 400;
    e.code = "INVALID_CERTIFICATE_KIND";
    throw e;
  }
  return s;
}

function parseLimit(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(n)));
}

function parseOffset(v: unknown, fallback = 0): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(10_000_000, Math.trunc(n)));
}

function parseStatus(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > 64) {
    const e: any = new Error("invalid_status");
    e.statusCode = 400;
    e.code = "INVALID_STATUS";
    throw e;
  }
  return s;
}

function parseAfter(v: unknown): { proof_date: string; id: string } | null {
  if (v == null || v === "") return null;
  if (typeof v !== "string") {
    const e: any = new Error("invalid_after");
    e.statusCode = 400;
    e.code = "INVALID_AFTER";
    throw e;
  }

  try {
    const parsed = JSON.parse(v);
    if (!parsed || typeof parsed !== "object") throw new Error("INVALID_AFTER");

    const proof_date = requireProofDate((parsed as any).proof_date);
    const id = requireUuidParam((parsed as any).id, "INVALID_AFTER_ID");
    return { proof_date, id };
  } catch {
    const e: any = new Error("invalid_after");
    e.statusCode = 400;
    e.code = "INVALID_AFTER";
    throw e;
  }
}

function requireBodyObject(req: FastifyRequest): Record<string, unknown> {
  const body = (req as any).body;
  if (!isPlainObject(body)) {
    const e: any = new Error("invalid_body");
    e.statusCode = 400;
    e.code = "INVALID_BODY";
    throw e;
  }

  if (bytesOfJson(body) > maxRouteBodyBytes()) {
    const e: any = new Error("payload_too_large");
    e.statusCode = 413;
    e.code = "PAYLOAD_TOO_LARGE";
    throw e;
  }

  function isDangerousKey(k: string): boolean {
    return k === "__proto__" || k === "prototype" || k === "constructor";
  }

  function sanitizeValue(value: unknown, depth: number, keysSeen: { count: number }): unknown {
    if (depth > MAX_DEPTH) {
      const e: any = new Error("invalid_body");
      e.statusCode = 400;
      e.code = "INVALID_BODY";
      throw e;
    }

    if (value == null) return null;

    const t = typeof value;
    if (t === "string") {
      if ((value as string).length > MAX_STRING) {
        const e: any = new Error("invalid_body");
        e.statusCode = 400;
        e.code = "INVALID_BODY";
        throw e;
      }
      return value;
    }

    if (t === "number") {
      if (!Number.isFinite(value)) {
        const e: any = new Error("invalid_body");
        e.statusCode = 400;
        e.code = "INVALID_BODY";
        throw e;
      }
      return value;
    }

    if (t === "boolean") return value;

    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY) {
        const e: any = new Error("invalid_body");
        e.statusCode = 400;
        e.code = "INVALID_BODY";
        throw e;
      }
      return value.map((v) => sanitizeValue(v, depth + 1, keysSeen));
    }

    if (!isPlainObject(value)) {
      const e: any = new Error("invalid_body");
      e.statusCode = 400;
      e.code = "INVALID_BODY";
      throw e;
    }

    const entries = Object.entries(value);
    if (entries.length + keysSeen.count > MAX_KEYS) {
      const e: any = new Error("invalid_body");
      e.statusCode = 400;
      e.code = "INVALID_BODY";
      throw e;
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      if (isDangerousKey(k)) {
        const e: any = new Error("invalid_body");
        e.statusCode = 400;
        e.code = "INVALID_BODY";
        throw e;
      }
      keysSeen.count += 1;
      out[k] = sanitizeValue(v, depth + 1, keysSeen);
    }
    return out;
  }

  return sanitizeValue(body, 0, { count: 0 }) as Record<string, unknown>;
}

function ensureNoStore(app: FastifyInstance) {
  app.addHook("onSend", async (req, reply, payload) => {
    const rp = String((req as any).routerPath ?? "");
    const url = String((req as any).routeOptions?.url ?? "");
    const path = rp || url;

    if (path.startsWith("/v1/certificates")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("vary", "Accept");
    }

    return payload;
  });
}

export type NftCertificateRoutesOpts = Readonly<{
  nftCertificateService: NftCertificateService;
}>;

const nftCertificateRoutes: FastifyPluginAsync<NftCertificateRoutesOpts> = async (app, opts) => {
  if (!opts?.nftCertificateService) {
    throw new Error("nftCertificateRoutes requires nftCertificateService");
  }

  const svc = opts.nftCertificateService;
  const requireAuth = app.requireAuth();
  ensureNoStore(app);

  app.get("/v1/certificates/me", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const query = req.query as Record<string, unknown>;

    const result = await svc.listMine(
      req,
      actor,
      {
        certificate_kind: query?.certificate_kind ? requireCertificateKind(query.certificate_kind) : null,
        status: parseStatus(query?.status),
        limit: parseLimit(query?.limit, 100),
        offset: parseOffset(query?.offset, 0),
        includeDeleted:
          query?.includeDeleted == null ? false : String(query.includeDeleted).trim() === "true",
      },
      svc.ctxFromReq(req, actor, false)
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/certificates/me/page", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const query = req.query as Record<string, unknown>;

    const result = await svc.getMinePage(
      req,
      actor,
      {
        certificate_kind: query?.certificate_kind ? requireCertificateKind(query.certificate_kind) : null,
        status: parseStatus(query?.status),
        limit: parseLimit(query?.limit, 50),
        after: parseAfter(query?.after),
      },
      svc.ctxFromReq(req, actor, false)
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/certificates/me/latest", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const query = req.query as Record<string, unknown>;

    const result = await svc.getMineLatest(
      req,
      actor,
      {
        certificate_kind: query?.certificate_kind ? requireCertificateKind(query.certificate_kind) : null,
        status: parseStatus(query?.status),
      },
      svc.ctxFromReq(req, actor, false)
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.get("/v1/certificates/:nft_id/:proof_date", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const nftId = requireUuidParam((req.params as any)?.nft_id, "INVALID_NFT_ID");
    const proofDate = requireProofDate((req.params as any)?.proof_date);

    const result = await svc.getByBusinessKey(
      req,
      nftId,
      proofDate,
      actor,
      svc.ctxFromReq(req, actor, false)
    );

    return reply.code(200).send({ ok: true, result });
  });

  app.post("/v1/certificates/existing", { preHandler: requireAuth }, async (req, reply) => {
    const actor = requireActor(req);
    const body = requireBodyObject(req);

    const subject = isPlainObject(body.subject)
      ? body.subject
      : (() => {
          const e: any = new Error("invalid_subject");
          e.statusCode = 400;
          e.code = "INVALID_SUBJECT";
          throw e;
        })();

    const result = await svc.checkExisting(
      req,
      {
        certificate_kind: requireCertificateKind(body.certificate_kind),
        proof_date: requireProofDate(body.proof_date),
        user_id: body.user_id == null ? null : String(body.user_id),
        token_purpose: body.token_purpose == null ? null : String(body.token_purpose),
        subject,
      },
      actor,
      svc.ctxFromReq(req, actor, true)
    );

    return reply.code(200).send({ ok: true, result });
  });
};

export { nftCertificateRoutes };
export default nftCertificateRoutes;