// ============================================================================
// File: src/services/onboardingService.ts
// Version: 1.0-hash-factory-onboarding-service | 2026-02-18
// Purpose:
//   Hash Factory OnboardingService (proxy + guard layer) -> Core Backend.
//   - Performs strict runtime validation and DoS guards at the boundary
//   - Never logs or returns secrets (passwords)
//   - Enforces safe authz checks (system admin / tenant admin) before calling core
//   - Propagates request correlation ids to core
//
// Notes:
//   - Core remains the source of truth (RLS + constraints).
//   - This service is a hardened façade and a stable contract for Hash Factory.
// ============================================================================

import type { FastifyRequest } from "fastify";
import { CoreClient, CoreClientError, makeCoreOnboarding } from "../core/coreClient.js";

export type Actor = Readonly<{
  user_id?: string | null;
  org_id?: string | null;
  org_role?: string | null;
  is_system_admin?: boolean | null;
  is_admin?: boolean | null;
  isAdmin?: boolean | null;
}>;

export type RequestCtx = Readonly<{
  requestId?: string | null;
  clientRequestId?: string | null;
}>;

export type OnboardingServiceOpts = Readonly<{
  core: CoreClient;
  maxMetadataBytes?: number;
}>;

export class OnboardingError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, opts: { statusCode: number; code: string }) {
    super(message);
    this.name = "OnboardingError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
  }
}

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
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

function normalizeEmail(email: unknown): string {
  const s = String(email ?? "").trim().toLowerCase();
  if (s.length < 6 || s.length > 255) throw new OnboardingError("invalid_email", { statusCode: 400, code: "INVALID_EMAIL" });
  // Conservative sanity check (core does the real validation/uniqueness).
  if (!s.includes("@") || !s.includes(".")) {
    throw new OnboardingError("invalid_email", { statusCode: 400, code: "INVALID_EMAIL" });
  }
  return s;
}

function normalizeName(name: unknown): string {
  const s = String(name ?? "").trim();
  if (s.length < 3 || s.length > 150) {
    throw new OnboardingError("invalid_name", { statusCode: 400, code: "INVALID_NAME" });
  }
  return s;
}

function normalizeSlugOrNull(slug: unknown): string | null {
  const s = String(slug ?? "").trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z0-9][a-z0-9-]{0,98}$/.test(s)) {
    throw new OnboardingError("invalid_slug", { statusCode: 400, code: "INVALID_SLUG" });
  }
  return s;
}

function normalizeWalletOrNull(wallet: unknown): string | null {
  const s = String(wallet ?? "").trim();
  if (!s) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(s)) {
    throw new OnboardingError("invalid_wallet_address", { statusCode: 400, code: "INVALID_WALLET" });
  }
  return s.toLowerCase();
}

function normalizeRole(role: unknown, fallback: "viewer" | "editor" | "tenant_admin"): "viewer" | "editor" | "tenant_admin" {
  const s = String(role ?? "").trim();
  if (!s) return fallback;
  if (s !== "viewer" && s !== "editor" && s !== "tenant_admin") {
    throw new OnboardingError("invalid_role", { statusCode: 400, code: "INVALID_ROLE" });
  }
  return s;
}

function normalizeStatus(status: unknown, fallback: "active" | "disabled"): "active" | "disabled" {
  const s = String(status ?? "").trim();
  if (!s) return fallback;
  if (s !== "active" && s !== "disabled") {
    throw new OnboardingError("invalid_status", { statusCode: 400, code: "INVALID_STATUS" });
  }
  return s;
}

function isSystemAdmin(actor: Actor | null | undefined): boolean {
  return Boolean(actor?.is_system_admin || actor?.is_admin || actor?.isAdmin);
}

function requireSystemAdmin(actor: Actor | null | undefined) {
  if (isSystemAdmin(actor)) return;
  throw new OnboardingError("forbidden", { statusCode: 403, code: "SYSTEM_ADMIN_REQUIRED" });
}

function requireTenantAdminForOrgOrSystem(actor: Actor | null | undefined, orgId: string) {
  if (isSystemAdmin(actor)) return;

  const aOrg = asString(actor?.org_id);
  const role = asString(actor?.org_role);

  if (!aOrg || aOrg !== orgId) {
    throw new OnboardingError("forbidden", { statusCode: 403, code: "CROSS_ORG_DENIED" });
  }
  if (role !== "tenant_admin") {
    throw new OnboardingError("forbidden", { statusCode: 403, code: "TENANT_ADMIN_REQUIRED" });
  }
}

function sanitizeJsonObjectOrEmpty(v: unknown, maxBytes: number, name: string): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (!isPlainObject(v)) throw new OnboardingError(`invalid_${name}`, { statusCode: 400, code: "INVALID_METADATA" });

  // Prototype pollution defense (reject dangerous keys).
  for (const k of Object.keys(v)) {
    if (k === "__proto__" || k === "prototype" || k === "constructor") {
      throw new OnboardingError(`invalid_${name}`, { statusCode: 400, code: "INVALID_METADATA" });
    }
  }

  if (bytesOfJson(v) > maxBytes) {
    throw new OnboardingError(`${name}_too_large`, { statusCode: 400, code: "METADATA_TOO_LARGE" });
  }

  return v;
}

function redactPasswordDeep(v: unknown): unknown {
  if (!v) return v;
  if (Array.isArray(v)) return v.map(redactPasswordDeep);
  if (!isPlainObject(v)) return v;

  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === "password") continue;
    out[k] = redactPasswordDeep(val);
  }
  return out;
}

function ctxFromReq(req: FastifyRequest): RequestCtx {
  return {
    requestId: (req as any)?.requestId ?? (req as any)?.id ?? null,
    clientRequestId: (req as any)?.clientRequestId ?? null,
  };
}

// ----------------------------------------------------------------------------
// Public Types
// ----------------------------------------------------------------------------
export type CreateOrgWithOwnerInput = Readonly<{
  organization?: Record<string, unknown>;
  org?: Record<string, unknown>;
  owner?: Record<string, unknown>;
  user?: Record<string, unknown>;
  membership?: Record<string, unknown> | null;
}>;

export type AddMemberInput = Readonly<{
  org_id: string;
  user_id: string;
  role?: "viewer" | "editor" | "tenant_admin" | null;
  status?: "active" | "disabled" | null;
  metadata?: Record<string, unknown> | null;
}>;

// ----------------------------------------------------------------------------
// Service
// ----------------------------------------------------------------------------
export class OnboardingService {
  private coreOnboarding: ReturnType<typeof makeCoreOnboarding>;
  private maxMetadataBytes: number;

  constructor(opts: OnboardingServiceOpts) {
    if (!opts?.core) throw new Error("OnboardingService requires core client");

    this.coreOnboarding = makeCoreOnboarding(opts.core);
    this.maxMetadataBytes = Math.max(1024, Math.min(Number(opts.maxMetadataBytes ?? 16 * 1024), 256 * 1024));
  }

  async checkEmailAvailability(email: unknown, actor: Actor, ctx?: RequestCtx) {
    requireSystemAdmin(actor);
    const em = normalizeEmail(email);

    try {
      return await this.coreOnboarding.checkEmail(em, ctx);
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async createOrganizationWithOwner(input: CreateOrgWithOwnerInput, actor: Actor, ctx?: RequestCtx) {
    requireSystemAdmin(actor);
    if (!isPlainObject(input)) throw new OnboardingError("invalid_body", { statusCode: 400, code: "INVALID_BODY" });

    const orgIn = (input.organization ?? input.org) as unknown;
    const ownerIn = (input.owner ?? input.user) as unknown;
    const membershipIn = (input.membership ?? {}) as unknown;

    if (!isPlainObject(orgIn)) throw new OnboardingError("invalid_org", { statusCode: 400, code: "INVALID_ORG" });
    if (!isPlainObject(ownerIn)) throw new OnboardingError("invalid_owner", { statusCode: 400, code: "INVALID_OWNER" });
    if (membershipIn != null && !isPlainObject(membershipIn)) {
      throw new OnboardingError("invalid_membership", { statusCode: 400, code: "INVALID_MEMBERSHIP" });
    }

    const passwordRaw = (ownerIn as any).password;
    // Preserve exact password string; do not trim.
    if (typeof passwordRaw !== "string" || passwordRaw.length < 8 || passwordRaw.length > 1024 || passwordRaw.includes("\u0000")) {
      throw new OnboardingError("invalid_password", { statusCode: 400, code: "INVALID_PASSWORD" });
    }

    const organization = {
      name: normalizeName((orgIn as any).name),
      slug: normalizeSlugOrNull((orgIn as any).slug),
      email: normalizeEmail((orgIn as any).email),
      wallet_address: normalizeWalletOrNull((orgIn as any).wallet_address ?? (orgIn as any).walletAddress),
      description: (orgIn as any).description == null ? null : String((orgIn as any).description).trim().slice(0, 2000),
      metadata: sanitizeJsonObjectOrEmpty((orgIn as any).metadata, this.maxMetadataBytes, "org_metadata"),
    };

    const owner = {
      name: normalizeName((ownerIn as any).name),
      slug: normalizeSlugOrNull((ownerIn as any).slug),
      email: normalizeEmail((ownerIn as any).email),
      wallet_address: normalizeWalletOrNull((ownerIn as any).wallet_address ?? (ownerIn as any).walletAddress),
      password: passwordRaw, // NEVER log / never return
      metadata: sanitizeJsonObjectOrEmpty((ownerIn as any).metadata, this.maxMetadataBytes, "owner_metadata"),
      role: normalizeRole((ownerIn as any).role, "tenant_admin"),
    };

    const membership = membershipIn == null ? {} : {
      role: normalizeRole((membershipIn as any).role, "tenant_admin"),
      status: normalizeStatus((membershipIn as any).status, "active"),
      metadata: sanitizeJsonObjectOrEmpty((membershipIn as any).metadata, this.maxMetadataBytes, "membership_metadata"),
    };

    const payload = { organization, owner, membership };

    try {
      const result = await this.coreOnboarding.createOrg(payload as any, ctx);
      // Defense-in-depth: ensure no password leaks from core responses.
      return redactPasswordDeep(result);
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async addMemberToOrganization(input: AddMemberInput, actor: Actor, ctx?: RequestCtx) {
    if (!isPlainObject(input)) throw new OnboardingError("invalid_body", { statusCode: 400, code: "INVALID_BODY" });

    const orgId = String((input as any).org_id ?? "").trim();
    const userId = String((input as any).user_id ?? "").trim();
    if (!isUuid(orgId)) throw new OnboardingError("invalid_org_id", { statusCode: 400, code: "INVALID_ORG_ID" });
    if (!isUuid(userId)) throw new OnboardingError("invalid_user_id", { statusCode: 400, code: "INVALID_USER_ID" });

    requireTenantAdminForOrgOrSystem(actor, orgId);

    const role = input.role == null ? null : normalizeRole(input.role, "viewer");
    const status = input.status == null ? null : normalizeStatus(input.status, "active");
    const metadata = sanitizeJsonObjectOrEmpty(input.metadata, this.maxMetadataBytes, "metadata");

    const payload = {
      user_id: userId,
      ...(role ? { role } : {}),
      ...(status ? { status } : {}),
      metadata,
    };

    try {
      return await this.coreOnboarding.addMember(orgId, payload as any, ctx);
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  // Convenience: call from routes
  ctxFromReq(req: FastifyRequest): RequestCtx {
    return ctxFromReq(req);
  }

  #mapCoreError(err: unknown): Error {
    if (err instanceof OnboardingError) return err;
    if (err instanceof CoreClientError) {
      const status = err.status;
      const code = err.code || null;

      // Map stable, safe boundary errors.
      if (status === 400) return new OnboardingError("bad_request", { statusCode: 400, code: code ?? "BAD_REQUEST" });
      if (status === 401) return new OnboardingError("unauthorized", { statusCode: 401, code: code ?? "AUTH_REQUIRED" });
      if (status === 403) return new OnboardingError("forbidden", { statusCode: 403, code: code ?? "FORBIDDEN" });
      if (status === 404) return new OnboardingError("not_found", { statusCode: 404, code: code ?? "NOT_FOUND" });

      // Upstream issue / other.
      return new OnboardingError("upstream_error", { statusCode: 502, code: code ?? "UPSTREAM_ERROR" });
    }
    return new OnboardingError("internal_error", { statusCode: 500, code: "INTERNAL_ERROR" });
  }
}

export default OnboardingService;