// ============================================================================
// File: src/core/nftCertificateClient.ts
// Version: 1.1-hash-factory-nft-certificates-client | 2026-03-16
// Purpose:
//   Hash Factory -> Core "NFT Certificates" client.
//   - Read-only certificate access + deterministic existence checks
//   - No certificate issuance methods exposed here
//   - Service-key fallback via CoreClient, with pass-through auth support
// Notes:
//   - Core remains source of truth for ownership, RLS, entitlements, and
//     certificate identity semantics.
// ============================================================================

import { CoreClient, CoreClientError, CoreRequestCtx } from "./coreClient.js";

type JsonObject = Record<string, unknown>;

export type CertificateKind =
  | "dataset_certificate"
  | "merkle_anchor_certificate"
  | "ingest_certificate";

export type CertificateListQuery = Readonly<{
  certificate_kind?: CertificateKind | null;
  status?: string | null;
  limit?: number | null;
  offset?: number | null;
  includeDeleted?: boolean | null;
}>;

export type CertificatePageQuery = Readonly<{
  certificate_kind?: CertificateKind | null;
  status?: string | null;
  limit?: number | null;
  after?: { proof_date?: string | null; id?: string | null } | null;
}>;

export type CertificateLatestQuery = Readonly<{
  certificate_kind?: CertificateKind | null;
  status?: string | null;
}>;

export type ExistingCertificateBody = Readonly<{
  certificate_kind: CertificateKind;
  proof_date: string;
  user_id?: string | null;
  token_purpose?: string | null;
  subject: Record<string, unknown>;
}>;

export class NftCertificatesClientError extends Error {
  statusCode: number;
  code: string;
  detail?: unknown;
  requestId?: string | null;

  constructor(
    message: string,
    opts: { statusCode: number; code: string; detail?: unknown; requestId?: string | null }
  ) {
    super(message);
    this.name = "NftCertificatesClientError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.detail = opts.detail;
    this.requestId = opts.requestId ?? null;
  }
}

export type NftCertificatesClient = Readonly<{
  listMine: (
    query?: CertificateListQuery,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<{ certificates: unknown[]; page: JsonObject }>;

  getMinePage: (
    query?: CertificatePageQuery,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<{ rows: unknown[]; next: unknown }>;

  getMineLatest: (
    query?: CertificateLatestQuery,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<JsonObject | null>;

  getByBusinessKey: (
    nftId: unknown,
    proofDate: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<JsonObject | null>;

  checkExisting: (
    body: ExistingCertificateBody,
    ctx?: CoreRequestCtx
  ) => Promise<JsonObject>;
}>;

const MAX_LIMIT = 200;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizeUuid(v: unknown, message: string, code: string): string {
  const s = String(v ?? "").trim();
  if (!isUuid(s)) {
    throw new NftCertificatesClientError(message, { statusCode: 400, code });
  }
  return s;
}

function normalizeProofDate(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new NftCertificatesClientError("invalid_proof_date", {
      statusCode: 400,
      code: "INVALID_PROOF_DATE",
    });
  }
  return s;
}

function normalizeCertificateKind(v: unknown): CertificateKind {
  const s = String(v ?? "").trim();
  if (
    s !== "dataset_certificate" &&
    s !== "merkle_anchor_certificate" &&
    s !== "ingest_certificate"
  ) {
    throw new NftCertificatesClientError("invalid_certificate_kind", {
      statusCode: 400,
      code: "INVALID_CERTIFICATE_KIND",
    });
  }
  return s;
}

function normalizeStatus(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (s.length > 64) {
    throw new NftCertificatesClientError("invalid_status", {
      statusCode: 400,
      code: "INVALID_STATUS",
    });
  }
  return s;
}

function normalizeTokenPurpose(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(s)) {
    throw new NftCertificatesClientError("invalid_token_purpose", {
      statusCode: 400,
      code: "INVALID_TOKEN_PURPOSE",
    });
  }
  return s;
}

function normalizeLimit(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(n)));
}

function normalizeOffset(v: unknown, fallback = 0): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(10_000_000, Math.trunc(n)));
}

function encodeQuery(query: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v == null) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function normalizeAfter(after: unknown): string | undefined {
  if (after == null) return undefined;
  if (!isPlainObject(after)) {
    throw new NftCertificatesClientError("invalid_after", {
      statusCode: 400,
      code: "INVALID_AFTER",
    });
  }

  const proof_date =
    after.proof_date == null ? null : normalizeProofDate(after.proof_date);
  const id =
    after.id == null ? null : normalizeUuid(after.id, "invalid_after_id", "INVALID_AFTER_ID");

  if (!proof_date || !id) {
    throw new NftCertificatesClientError("invalid_after", {
      statusCode: 400,
      code: "INVALID_AFTER",
    });
  }

  return JSON.stringify({ proof_date, id });
}

function normalizeSubject(v: unknown): Record<string, unknown> {
  if (!isPlainObject(v)) {
    throw new NftCertificatesClientError("invalid_subject", {
      statusCode: 400,
      code: "INVALID_SUBJECT",
    });
  }

  for (const k of Object.keys(v)) {
    if (k === "__proto__" || k === "prototype" || k === "constructor") {
      throw new NftCertificatesClientError("invalid_subject", {
        statusCode: 400,
        code: "INVALID_SUBJECT",
      });
    }
  }

  return v;
}

function unwrapList(res: unknown): { certificates: unknown[]; page: JsonObject } {
  const certificates = Array.isArray((res as any)?.certificates) ? (res as any).certificates : [];
  const page =
    isPlainObject((res as any)?.page) ? ((res as any).page as JsonObject) : {};
  return { certificates, page };
}

function unwrapPage(res: unknown): { rows: unknown[]; next: unknown } {
  const page = isPlainObject((res as any)?.page) ? (res as any).page : {};
  const rows = Array.isArray(page.rows) ? page.rows : [];
  return { rows, next: page.next ?? null };
}

function unwrapCertificate(res: unknown): JsonObject | null {
  const out = (res as any)?.certificate ?? (res as any)?.result ?? res;
  return out && typeof out === "object" && !Array.isArray(out) ? (out as JsonObject) : null;
}

function unwrapExisting(res: unknown): JsonObject {
  const out = (res as any)?.result ?? res;
  return out && typeof out === "object" && !Array.isArray(out) ? (out as JsonObject) : {};
}

function mapCoreError(err: unknown): Error {
  if (err instanceof NftCertificatesClientError) return err;

  if (err instanceof CoreClientError) {
    const status = err.status;
    const code = err.code || null;
    const detail = err.detail;
    const requestId = err.requestId ?? null;

    if (status === 400) {
      return new NftCertificatesClientError("bad_request", {
        statusCode: 400,
        code: code ?? "BAD_REQUEST",
        detail,
        requestId,
      });
    }
    if (status === 401) {
      return new NftCertificatesClientError("unauthorized", {
        statusCode: 401,
        code: code ?? "AUTH_REQUIRED",
        detail,
        requestId,
      });
    }
    if (status === 403) {
      return new NftCertificatesClientError("forbidden", {
        statusCode: 403,
        code: code ?? "FORBIDDEN",
        detail,
        requestId,
      });
    }
    if (status === 404) {
      return new NftCertificatesClientError("not_found", {
        statusCode: 404,
        code: code ?? "NOT_FOUND",
        detail,
        requestId,
      });
    }
    if (status === 409) {
      return new NftCertificatesClientError("conflict", {
        statusCode: 409,
        code: code ?? "CONFLICT",
        detail,
        requestId,
      });
    }

    return new NftCertificatesClientError("upstream_error", {
      statusCode: 502,
      code: code ?? "UPSTREAM_ERROR",
      detail,
      requestId,
    });
  }

  return new NftCertificatesClientError("internal_error", {
    statusCode: 500,
    code: "INTERNAL_ERROR",
  });
}

export function makeCoreNftCertificates(core: CoreClient): NftCertificatesClient {
  if (!core) throw new Error("makeCoreNftCertificates requires core client");

  async function listMine(
    query?: CertificateListQuery,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    try {
      const qs = encodeQuery({
        certificate_kind: query?.certificate_kind ?? undefined,
        status: normalizeStatus(query?.status),
        limit: normalizeLimit(query?.limit, 100),
        offset: normalizeOffset(query?.offset, 0),
        includeDeleted:
          query?.includeDeleted == null ? undefined : String(Boolean(query.includeDeleted)),
      });

      const res = await core.get<any>(`/v1/certificates/me${qs}`, ctx, retry ?? undefined);
      return unwrapList(res);
    } catch (err: unknown) {
      throw mapCoreError(err);
    }
  }

  async function getMinePage(
    query?: CertificatePageQuery,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    try {
      const qs = encodeQuery({
        certificate_kind: query?.certificate_kind ?? undefined,
        status: normalizeStatus(query?.status),
        limit: normalizeLimit(query?.limit, 50),
        after: normalizeAfter(query?.after),
      });

      const res = await core.get<any>(`/v1/certificates/me/page${qs}`, ctx, retry ?? undefined);
      return unwrapPage(res);
    } catch (err: unknown) {
      throw mapCoreError(err);
    }
  }

  async function getMineLatest(
    query?: CertificateLatestQuery,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    try {
      const qs = encodeQuery({
        certificate_kind: query?.certificate_kind ?? undefined,
        status: normalizeStatus(query?.status),
      });

      const res = await core.get<any>(`/v1/certificates/me/latest${qs}`, ctx, retry ?? undefined);
      return unwrapCertificate(res);
    } catch (err: unknown) {
      throw mapCoreError(err);
    }
  }

  async function getByBusinessKey(
    nftId: unknown,
    proofDate: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) {
    try {
      const id = normalizeUuid(nftId, "invalid_nft_id", "INVALID_NFT_ID");
      const pd = normalizeProofDate(proofDate);
      const res = await core.get<any>(
        `/v1/certificates/${encodeURIComponent(id)}/${encodeURIComponent(pd)}`,
        ctx,
        retry ?? undefined
      );
      return unwrapCertificate(res);
    } catch (err: unknown) {
      throw mapCoreError(err);
    }
  }

  async function checkExisting(body: ExistingCertificateBody, ctx?: CoreRequestCtx) {
    try {
      const payload: Record<string, unknown> = {
        certificate_kind: normalizeCertificateKind(body?.certificate_kind),
        proof_date: normalizeProofDate(body?.proof_date),
        subject: normalizeSubject(body?.subject),
      };

      if (body?.user_id != null) {
        payload.user_id = normalizeUuid(body.user_id, "invalid_user_id", "INVALID_USER_ID");
      }

      const tokenPurpose = normalizeTokenPurpose(body?.token_purpose);
      if (tokenPurpose) payload.token_purpose = tokenPurpose;

      const res = await core.post<any>("/v1/certificates/existing", payload, ctx, { maxRetries: 0 });
      return unwrapExisting(res);
    } catch (err: unknown) {
      throw mapCoreError(err);
    }
  }

  return {
    listMine,
    getMinePage,
    getMineLatest,
    getByBusinessKey,
    checkExisting,
  };
}

export default makeCoreNftCertificates;