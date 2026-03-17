// ============================================================================
// File: src/services/nftCertificateService.ts
// Version: 1.2-hash-factory-nft-certificate-service-readonly-hardened | 2026-03-16
// Purpose:
//   HF NFT CertificateService (read-only proxy + guard layer) -> Core Backend.
//   - Exposes certificate reads and deterministic existence checks only
//   - Does not expose certificate issuance from HF
//   - Preserves Core as source of truth for ownership, RLS, entitlements,
//     certificate identity, and visibility
// Notes:
//   - Core remains authoritative for authz and tenancy.
//   - HF preflight is intentionally minimal to avoid false 403s.
// ============================================================================

import type { FastifyRequest } from "fastify";
import type { CoreRequestCtx } from "../core/coreClient.js";
import type {
  NftCertificatesClient,
  CertificateKind,
  CertificateListQuery,
  CertificatePageQuery,
  CertificateLatestQuery,
  ExistingCertificateBody,
} from "../core/nftCertificateClient.js";
import { NftCertificatesClientError } from "../core/nftCertificateClient.js";
import { CoreClientError } from "../core/coreClient.js";
import { buildGatewayCtx } from "../lib/gateway/requestContext.js";
import { HfEntitlements } from "../lib/entitlements/hfOrgEntitlements.js";
import { HfEntitlementError } from "../lib/entitlements/hfEntitlementErrors.js";

export type Actor = Readonly<{
  user_id?: string | null;
  org_id?: string | null;
  org_role?: string | null;
  is_system_admin?: boolean | null;
  is_admin?: boolean | null;
  isAdmin?: boolean | null;
}>;

export type NftCertificateServiceOpts = Readonly<{
  certificates: NftCertificatesClient;
  entitlements?: HfEntitlements | null;
}>;

export class NftCertificateServiceError extends Error {
  statusCode: number;
  code: string;
  detail?: unknown;

  constructor(message: string, opts: { statusCode: number; code: string; detail?: unknown }) {
    super(message);
    this.name = "NftCertificateServiceError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.detail = opts.detail;
  }
}

function requireActor(actor: Actor | null | undefined): asserts actor is Actor {
  if (actor && typeof actor === "object") return;
  throw new NftCertificateServiceError("unauthorized", {
    statusCode: 401,
    code: "AUTH_REQUIRED",
  });
}

function isSystemAdmin(actor: Actor | null | undefined): boolean {
  return Boolean(actor?.is_system_admin || actor?.is_admin || actor?.isAdmin);
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function actorUserId(actor: Actor | null | undefined): string | null {
  return asString(actor?.user_id);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function normalizeCertificateKind(v: unknown): CertificateKind {
  const s = String(v ?? "").trim();
  if (
    s !== "dataset_certificate" &&
    s !== "merkle_anchor_certificate" &&
    s !== "ingest_certificate"
  ) {
    throw new NftCertificateServiceError("invalid_certificate_kind", {
      statusCode: 400,
      code: "INVALID_CERTIFICATE_KIND",
    });
  }
  return s;
}

function normalizeProofDate(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new NftCertificateServiceError("invalid_proof_date", {
      statusCode: 400,
      code: "INVALID_PROOF_DATE",
    });
  }
  return s;
}

function isUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizeUuid(v: unknown, code: string): string {
  const s = String(v ?? "").trim();
  if (!isUuid(s)) {
    throw new NftCertificateServiceError(code.toLowerCase(), {
      statusCode: 400,
      code,
    });
  }
  return s;
}

function normalizeStatus(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > 64) {
    throw new NftCertificateServiceError("invalid_status", {
      statusCode: 400,
      code: "INVALID_STATUS",
    });
  }
  return s;
}

function normalizeTokenPurpose(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(s)) {
    throw new NftCertificateServiceError("invalid_token_purpose", {
      statusCode: 400,
      code: "INVALID_TOKEN_PURPOSE",
    });
  }
  return s;
}

function ensureSelfOrSystemAdmin(actor: Actor, userId: unknown): string | null {
  if (userId == null || userId === "") return null;
  const normalized = normalizeUuid(userId, "INVALID_USER_ID");
  const actorUid = actorUserId(actor);

  if (normalized !== actorUid && !isSystemAdmin(actor)) {
    throw new NftCertificateServiceError("forbidden", {
      statusCode: 403,
      code: "USER_MISMATCH",
    });
  }

  return normalized;
}

function normalizeSubjectForKind(
  certificateKind: CertificateKind,
  subject: unknown
): Record<string, unknown> {
  if (!isPlainObject(subject)) {
    throw new NftCertificateServiceError("invalid_subject", {
      statusCode: 400,
      code: "INVALID_SUBJECT",
    });
  }

  const s = subject;

  if (certificateKind === "dataset_certificate") {
    const datasetKey = String(s.dataset_key ?? "").trim();
    const datasetVersionId = s.dataset_version_id == null ? null : String(s.dataset_version_id).trim();
    const hasVersion = s.version != null || datasetVersionId != null;

    if (!datasetKey && !datasetVersionId) {
      throw new NftCertificateServiceError("invalid_subject", {
        statusCode: 400,
        code: "INVALID_SUBJECT",
        detail: { reason: "dataset_key_or_dataset_version_id_required" },
      });
    }

    if (datasetVersionId && !isUuid(datasetVersionId)) {
      throw new NftCertificateServiceError("invalid_subject", {
        statusCode: 400,
        code: "INVALID_SUBJECT",
      });
    }

    if (!datasetVersionId && !hasVersion) {
      throw new NftCertificateServiceError("invalid_subject", {
        statusCode: 400,
        code: "INVALID_SUBJECT",
        detail: { reason: "version_or_dataset_version_id_required" },
      });
    }

    return s;
  }

  if (certificateKind === "merkle_anchor_certificate") {
    const anchorRequestId = s.anchor_request_id == null ? null : String(s.anchor_request_id).trim();
    const rootId = s.root_id == null ? null : String(s.root_id).trim();

    if (!anchorRequestId && !rootId) {
      throw new NftCertificateServiceError("invalid_subject", {
        statusCode: 400,
        code: "INVALID_SUBJECT",
        detail: { reason: "anchor_request_id_or_root_id_required" },
      });
    }

    if (anchorRequestId && !isUuid(anchorRequestId)) {
      throw new NftCertificateServiceError("invalid_subject", {
        statusCode: 400,
        code: "INVALID_SUBJECT",
      });
    }

    if (rootId && !isUuid(rootId)) {
      throw new NftCertificateServiceError("invalid_subject", {
        statusCode: 400,
        code: "INVALID_SUBJECT",
      });
    }

    return s;
  }

  const objectKey = String(s.object_key ?? "").trim();
  const datasetKey = String(s.dataset_key ?? "").trim();
  const datasetVersionId = s.dataset_version_id == null ? null : String(s.dataset_version_id).trim();

  if (!objectKey && !datasetKey && !datasetVersionId) {
    throw new NftCertificateServiceError("invalid_subject", {
      statusCode: 400,
      code: "INVALID_SUBJECT",
      detail: { reason: "object_key_or_dataset_key_or_dataset_version_id_required" },
    });
  }

  if (datasetVersionId && !isUuid(datasetVersionId)) {
    throw new NftCertificateServiceError("invalid_subject", {
      statusCode: 400,
      code: "INVALID_SUBJECT",
    });
  }

  return s;
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && typeof err.message === "string" && err.message.trim()) {
    return err.message;
  }
  return fallback;
}

function getCoreErrorDetail(err: CoreClientError): unknown {
  return err.detail;
}

export class NftCertificateService {
  private certificates: NftCertificatesClient;
  private entitlements: HfEntitlements | null;

  constructor(opts: NftCertificateServiceOpts) {
    if (!opts?.certificates) throw new Error("NftCertificateService requires certificates client");
    this.certificates = opts.certificates;
    this.entitlements = opts.entitlements ?? null;
  }

  ctxFromReq(req: FastifyRequest, actor?: Actor | null, forWrite = false): CoreRequestCtx {
    return buildGatewayCtx(req, actor, {
      forWrite,
      requirePassThroughAuth: true,
    });
  }

  async listMine(
    req: FastifyRequest,
    actor: Actor,
    query: CertificateListQuery,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    try {
      return await this.certificates.listMine(
        {
          certificate_kind: query?.certificate_kind ? normalizeCertificateKind(query.certificate_kind) : null,
          status: normalizeStatus(query?.status),
          limit: query?.limit ?? 100,
          offset: query?.offset ?? 0,
          includeDeleted: Boolean(query?.includeDeleted),
        },
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (err: unknown) {
      throw this.#mapError(err);
    }
  }

  async getMinePage(
    req: FastifyRequest,
    actor: Actor,
    query: CertificatePageQuery,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    try {
      return await this.certificates.getMinePage(
        {
          certificate_kind: query?.certificate_kind ? normalizeCertificateKind(query.certificate_kind) : null,
          status: normalizeStatus(query?.status),
          limit: query?.limit ?? 50,
          after: query?.after ?? null,
        },
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (err: unknown) {
      throw this.#mapError(err);
    }
  }

  async getMineLatest(
    req: FastifyRequest,
    actor: Actor,
    query: CertificateLatestQuery,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    try {
      return await this.certificates.getMineLatest(
        {
          certificate_kind: query?.certificate_kind ? normalizeCertificateKind(query.certificate_kind) : null,
          status: normalizeStatus(query?.status),
        },
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (err: unknown) {
      throw this.#mapError(err);
    }
  }

  async getByBusinessKey(
    req: FastifyRequest,
    nftId: unknown,
    proofDate: unknown,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    try {
      return await this.certificates.getByBusinessKey(
        normalizeUuid(nftId, "INVALID_NFT_ID"),
        normalizeProofDate(proofDate),
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (err: unknown) {
      throw this.#mapError(err);
    }
  }

  async checkExisting(
    req: FastifyRequest,
    body: ExistingCertificateBody,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    const certificate_kind = normalizeCertificateKind(body?.certificate_kind);
    const proof_date = normalizeProofDate(body?.proof_date);
    const user_id = ensureSelfOrSystemAdmin(actor, body?.user_id);
    const token_purpose = normalizeTokenPurpose(body?.token_purpose);
    const subject = normalizeSubjectForKind(certificate_kind, body?.subject);

    try {
      return await this.certificates.checkExisting(
        {
          certificate_kind,
          proof_date,
          user_id,
          token_purpose,
          subject,
        },
        ctx ?? this.ctxFromReq(req, actor, true)
      );
    } catch (err: unknown) {
      throw this.#mapError(err);
    }
  }

  #mapError(err: unknown): NftCertificateServiceError {
    if (err instanceof NftCertificateServiceError) return err;

    if (err instanceof HfEntitlementError) {
      return new NftCertificateServiceError(getErrorMessage(err, "forbidden"), {
        statusCode: err.statusCode,
        code: err.code,
        detail: err.detail,
      });
    }

    if (err instanceof NftCertificatesClientError) {
      return new NftCertificateServiceError(getErrorMessage(err, "upstream_error"), {
        statusCode: err.statusCode,
        code: err.code,
        detail: err.detail,
      });
    }

    if (err instanceof CoreClientError) {
      const status = err.status;
      const code = err.code ?? null;
      const detail = getCoreErrorDetail(err);

      if (status === 400) {
        return new NftCertificateServiceError("bad_request", {
          statusCode: 400,
          code: code ?? "BAD_REQUEST",
          detail,
        });
      }
      if (status === 401) {
        return new NftCertificateServiceError("unauthorized", {
          statusCode: 401,
          code: code ?? "AUTH_REQUIRED",
          detail,
        });
      }
      if (status === 403) {
        return new NftCertificateServiceError("forbidden", {
          statusCode: 403,
          code: code ?? "FORBIDDEN",
          detail,
        });
      }
      if (status === 404) {
        return new NftCertificateServiceError("not_found", {
          statusCode: 404,
          code: code ?? "NOT_FOUND",
          detail,
        });
      }
      if (status === 409) {
        return new NftCertificateServiceError("conflict", {
          statusCode: 409,
          code: code ?? "CONFLICT",
          detail,
        });
      }

      return new NftCertificateServiceError("upstream_error", {
        statusCode: 502,
        code: code ?? "UPSTREAM_ERROR",
        detail,
      });
    }

    return new NftCertificateServiceError("internal_error", {
      statusCode: 500,
      code: "INTERNAL_ERROR",
    });
  }
}

export default NftCertificateService;