// ============================================================================
// File: src/services/orgService.ts
// Version: 1.1-hash-factory-org-service-gateway-ctx | 2026-03-12
// Purpose:
//   HF OrgService (proxy + guard layer) -> Core Backend.
//   - Strict runtime validation and boundary authz
//   - Preserves Core as source of truth for RLS and data policy
//   - Same-org reads, tenant-admin member access, tenant-admin org mutations
//   - System-admin-only billing tier mutation
// Changes (v1.1):
//   - Uses shared gateway request-context builder
//   - Requires pass-through auth for HF -> Core user-bound calls
//   - Adds 409 conflict mapping
// ============================================================================

import type { FastifyRequest } from "fastify";
import { CoreClientError } from "../core/coreClient.js";
import { makeCoreOrgs, OrgsClientError } from "../core/orgsClient.js";
import type { CoreClient, CoreRequestCtx } from "../core/coreClient.js";
import { buildGatewayCtx } from "../lib/gateway/requestContext.js";

export type Actor = Readonly<{
  user_id?: string | null;
  org_id?: string | null;
  org_role?: string | null;
  is_system_admin?: boolean | null;
  is_admin?: boolean | null;
  isAdmin?: boolean | null;
}>;

export type OrgServiceOpts = Readonly<{
  core: CoreClient;
  maxMetadataBytes?: number;
}>;

export class OrgServiceError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, opts: { statusCode: number; code: string }) {
    super(message);
    this.name = "OrgServiceError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
  }
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s ? s : null;
}

function isUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
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

function isSystemAdmin(actor: Actor | null | undefined): boolean {
  return Boolean(actor?.is_system_admin || actor?.is_admin || actor?.isAdmin);
}

function isTenantAdmin(actor: Actor | null | undefined): boolean {
  return String(actor?.org_role ?? "") === "tenant_admin";
}

function requireActor(actor: Actor | null | undefined) {
  if (actor && typeof actor === "object") return;
  throw new OrgServiceError("unauthorized", { statusCode: 401, code: "AUTH_REQUIRED" });
}

function requireSameOrgOrSystem(actor: Actor | null | undefined, orgId: string) {
  if (isSystemAdmin(actor)) return;
  const actorOrgId = asString(actor?.org_id);
  if (!actorOrgId || actorOrgId !== orgId) {
    throw new OrgServiceError("forbidden", { statusCode: 403, code: "CROSS_ORG_DENIED" });
  }
}

function requireTenantAdminForOrgOrSystem(actor: Actor | null | undefined, orgId: string) {
  if (isSystemAdmin(actor)) return;

  const actorOrgId = asString(actor?.org_id);
  if (!actorOrgId || actorOrgId !== orgId) {
    throw new OrgServiceError("forbidden", { statusCode: 403, code: "CROSS_ORG_DENIED" });
  }

  if (!isTenantAdmin(actor)) {
    throw new OrgServiceError("forbidden", { statusCode: 403, code: "ORG_TENANT_ADMIN_REQUIRED" });
  }
}

function requireSystemAdmin(actor: Actor | null | undefined) {
  if (isSystemAdmin(actor)) return;
  throw new OrgServiceError("forbidden", { statusCode: 403, code: "SYSTEM_ADMIN_REQUIRED" });
}

function normalizeNameOrUndefined(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  const s = String(v ?? "").trim();
  if (s.length < 3 || s.length > 150) {
    throw new OrgServiceError("invalid_name", { statusCode: 400, code: "INVALID_NAME" });
  }
  return s;
}

function normalizeSlugOrNullOrUndefined(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z0-9][a-z0-9-]{0,98}$/.test(s)) {
    throw new OrgServiceError("invalid_slug", { statusCode: 400, code: "INVALID_SLUG" });
  }
  return s;
}

function normalizeEmailOrUndefined(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s || s.length < 6 || s.length > 255 || !s.includes("@") || !s.includes(".")) {
    throw new OrgServiceError("invalid_email", { statusCode: 400, code: "INVALID_EMAIL" });
  }
  return s;
}

function normalizeWalletOrNullOrUndefined(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(s)) {
    throw new OrgServiceError("invalid_wallet_address", { statusCode: 400, code: "INVALID_WALLET" });
  }
  return s.toLowerCase();
}

function normalizeDescriptionOrNullOrUndefined(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (s.length > 2000) {
    throw new OrgServiceError("invalid_description", { statusCode: 400, code: "INVALID_DESCRIPTION" });
  }
  return s;
}

function sanitizeMetadataOrUndefined(v: unknown, maxBytes: number): Record<string, unknown> | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!isPlainObject(v)) {
    throw new OrgServiceError("invalid_metadata", { statusCode: 400, code: "INVALID_METADATA" });
  }
  for (const k of Object.keys(v)) {
    if (k === "__proto__" || k === "prototype" || k === "constructor") {
      throw new OrgServiceError("invalid_metadata", { statusCode: 400, code: "INVALID_METADATA" });
    }
  }
  if (bytesOfJson(v) > maxBytes) {
    throw new OrgServiceError("metadata_too_large", { statusCode: 400, code: "METADATA_TOO_LARGE" });
  }
  return v;
}

function redactOrg(v: unknown): unknown {
  if (!isPlainObject(v)) return v;
  return { ...v };
}

function redactMembersPage(v: unknown): unknown {
  if (!isPlainObject(v)) return v;
  const out: Record<string, unknown> = { ...v };
  if (!Array.isArray(out.items)) out.items = [];
  return out;
}

export class OrgService {
  private orgs: ReturnType<typeof makeCoreOrgs>;
  private maxMetadataBytes: number;

  constructor(opts: OrgServiceOpts) {
    if (!opts?.core) throw new Error("OrgService requires core client");
    this.orgs = makeCoreOrgs(opts.core);
    this.maxMetadataBytes = Math.max(1024, Math.min(Number(opts.maxMetadataBytes ?? 16 * 1024), 256 * 1024));
  }

  async getMe(actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    try {
      const out = await this.orgs.getMe(ctx, { maxRetries: 1 });
      return redactOrg(out);
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async getMyMembers(q: Record<string, unknown>, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    const orgId = asString(actor?.org_id);
    if (!orgId || !isUuid(orgId)) {
      throw new OrgServiceError("invalid_actor_org_id", { statusCode: 400, code: "INVALID_ACTOR_ORG_ID" });
    }
    requireTenantAdminForOrgOrSystem(actor, orgId);

    try {
      const out = await this.orgs.getMyMembers(q, ctx, { maxRetries: 1 });
      return redactMembersPage(out);
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async getById(orgId: unknown, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);

    const id = String(orgId ?? "").trim();
    if (!isUuid(id)) {
      throw new OrgServiceError("invalid_org_id", { statusCode: 400, code: "INVALID_ORG_ID" });
    }

    requireSameOrgOrSystem(actor, id);

    try {
      const out = await this.orgs.getById(id, ctx, { maxRetries: 1 });
      return redactOrg(out);
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async getMembersByOrgId(orgId: unknown, q: Record<string, unknown>, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);

    const id = String(orgId ?? "").trim();
    if (!isUuid(id)) {
      throw new OrgServiceError("invalid_org_id", { statusCode: 400, code: "INVALID_ORG_ID" });
    }

    requireTenantAdminForOrgOrSystem(actor, id);

    try {
      const out = await this.orgs.getMembersByOrgId(id, q, ctx, { maxRetries: 1 });
      return redactMembersPage(out);
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async patchOrg(orgId: unknown, input: Record<string, unknown>, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    if (!isPlainObject(input)) {
      throw new OrgServiceError("invalid_body", { statusCode: 400, code: "INVALID_BODY" });
    }

    const id = String(orgId ?? "").trim();
    if (!isUuid(id)) {
      throw new OrgServiceError("invalid_org_id", { statusCode: 400, code: "INVALID_ORG_ID" });
    }

    requireTenantAdminForOrgOrSystem(actor, id);

    const payload: Record<string, unknown> = {};
    if (input.name !== undefined) payload.name = normalizeNameOrUndefined(input.name);
    if (input.slug !== undefined) payload.slug = normalizeSlugOrNullOrUndefined(input.slug);
    if (input.email !== undefined) payload.email = normalizeEmailOrUndefined(input.email);
    if (input.wallet_address !== undefined) payload.wallet_address = normalizeWalletOrNullOrUndefined(input.wallet_address);
    if (input.description !== undefined) payload.description = normalizeDescriptionOrNullOrUndefined(input.description);
    if (input.metadata !== undefined) payload.metadata = sanitizeMetadataOrUndefined(input.metadata, this.maxMetadataBytes);

    const allowed = new Set(["name", "slug", "email", "wallet_address", "description", "metadata"]);
    for (const k of Object.keys(input)) {
      if (!allowed.has(k)) {
        throw new OrgServiceError("invalid_request", { statusCode: 400, code: "INVALID_REQUEST" });
      }
    }

    if (Object.keys(payload).length === 0) {
      throw new OrgServiceError("empty_patch", { statusCode: 400, code: "EMPTY_PATCH" });
    }

    try {
      const out = await this.orgs.patchOrg(id, payload, ctx);
      return redactOrg(out);
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async setBillingTier(orgId: unknown, billing_tier: unknown, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    requireSystemAdmin(actor);

    const id = String(orgId ?? "").trim();
    if (!isUuid(id)) {
      throw new OrgServiceError("invalid_org_id", { statusCode: 400, code: "INVALID_ORG_ID" });
    }

    try {
      const out = await this.orgs.setBillingTier(id, billing_tier, ctx);
      return redactOrg(out);
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async setKyc(orgId: unknown, kyc_status: unknown, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);

    const id = String(orgId ?? "").trim();
    if (!isUuid(id)) {
      throw new OrgServiceError("invalid_org_id", { statusCode: 400, code: "INVALID_ORG_ID" });
    }

    requireTenantAdminForOrgOrSystem(actor, id);

    try {
      const out = await this.orgs.setKyc(id, kyc_status, ctx);
      return redactOrg(out);
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async softDelete(orgId: unknown, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);

    const id = String(orgId ?? "").trim();
    if (!isUuid(id)) {
      throw new OrgServiceError("invalid_org_id", { statusCode: 400, code: "INVALID_ORG_ID" });
    }

    requireTenantAdminForOrgOrSystem(actor, id);

    try {
      const out = await this.orgs.softDelete(id, ctx);
      return redactOrg(out);
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async restore(orgId: unknown, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);

    const id = String(orgId ?? "").trim();
    if (!isUuid(id)) {
      throw new OrgServiceError("invalid_org_id", { statusCode: 400, code: "INVALID_ORG_ID" });
    }

    requireTenantAdminForOrgOrSystem(actor, id);

    try {
      const out = await this.orgs.restore(id, ctx);
      return redactOrg(out);
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  ctxFromReq(req: FastifyRequest, actor?: Actor | null, forWrite: boolean = false): CoreRequestCtx {
    return buildGatewayCtx(req, actor, {
      forWrite,
      requirePassThroughAuth: true,
    });
  }

  #mapCoreError(err: unknown): Error {
    if (err instanceof OrgServiceError) return err;

    if (err instanceof OrgsClientError) {
      return new OrgServiceError(err.message || "upstream_error", {
        statusCode: err.statusCode,
        code: err.code,
      });
    }

    if (err instanceof CoreClientError) {
      const status = err.status;
      const code = err.code || null;

      if (status === 400) return new OrgServiceError("bad_request", { statusCode: 400, code: code ?? "BAD_REQUEST" });
      if (status === 401) return new OrgServiceError("unauthorized", { statusCode: 401, code: code ?? "AUTH_REQUIRED" });
      if (status === 403) return new OrgServiceError("forbidden", { statusCode: 403, code: code ?? "FORBIDDEN" });
      if (status === 404) return new OrgServiceError("not_found", { statusCode: 404, code: code ?? "NOT_FOUND" });
      if (status === 409) return new OrgServiceError("conflict", { statusCode: 409, code: code ?? "CONFLICT" });
      return new OrgServiceError("upstream_error", { statusCode: 502, code: code ?? "UPSTREAM_ERROR" });
    }

    return new OrgServiceError("internal_error", { statusCode: 500, code: "INTERNAL_ERROR" });
  }
}

export default OrgService;