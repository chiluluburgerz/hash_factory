// ============================================================================
// File: src/services/orgEntitlementsService.ts
// Version: 1.1-hash-factory-org-entitlements-service-typed-inputs | 2026-03-12
// Purpose:
//   HF OrgEntitlementsService (proxy + guard layer) -> Core Backend.
//   - Strict runtime validation and boundary authz
//   - Preserves Core as source of truth for entitlement shaping and policy derivation
//   - Read-only surface
//   - Same-org tenant-admin reads, system-admin override
// Changes (v1.1):
//   - Uses exact client input types for path/check calls
//   - Fixes TS assignability errors for q/body arguments
// Notes:
//   - HF intentionally does NOT re-implement entitlement normalization logic.
//   - Core is authoritative for raw entitlements, effective policy, and checks.
// ============================================================================

import type { FastifyRequest } from "fastify";
import { CoreClientError } from "../core/coreClient.js";
import {
  makeCoreOrgEntitlements,
  OrgEntitlementsClientError,
} from "../core/orgEntitlementsClient.js";
import type {
  CoreClient,
  CoreRequestCtx,
} from "../core/coreClient.js";
import type {
  EntitlementPathQuery,
  EntitlementCheckInput,
} from "../core/orgEntitlementsClient.js";
import { buildGatewayCtx } from "../lib/gateway/requestContext.js";

export type Actor = Readonly<{
  user_id?: string | null;
  org_id?: string | null;
  org_role?: string | null;
  is_system_admin?: boolean | null;
  is_admin?: boolean | null;
  isAdmin?: boolean | null;
}>;

export type OrgEntitlementsServiceOpts = Readonly<{
  core: CoreClient;
}>;

export class OrgEntitlementsServiceError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, opts: { statusCode: number; code: string }) {
    super(message);
    this.name = "OrgEntitlementsServiceError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
  }
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function isUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isSystemAdmin(actor: Actor | null | undefined): boolean {
  return Boolean(actor?.is_system_admin || actor?.is_admin || actor?.isAdmin);
}

function isTenantAdmin(actor: Actor | null | undefined): boolean {
  return String(actor?.org_role ?? "") === "tenant_admin";
}

function requireActor(actor: Actor | null | undefined) {
  if (actor && typeof actor === "object") return;
  throw new OrgEntitlementsServiceError("unauthorized", {
    statusCode: 401,
    code: "AUTH_REQUIRED",
  });
}

function requireTenantAdminForOrgOrSystem(actor: Actor | null | undefined, orgId: string) {
  if (isSystemAdmin(actor)) return;

  const actorOrgId = asString(actor?.org_id);
  if (!actorOrgId || actorOrgId !== orgId) {
    throw new OrgEntitlementsServiceError("forbidden", {
      statusCode: 403,
      code: "CROSS_ORG_DENIED",
    });
  }

  if (!isTenantAdmin(actor)) {
    throw new OrgEntitlementsServiceError("forbidden", {
      statusCode: 403,
      code: "ORG_TENANT_ADMIN_REQUIRED",
    });
  }
}

export class OrgEntitlementsService {
  private ents: ReturnType<typeof makeCoreOrgEntitlements>;

  constructor(opts: OrgEntitlementsServiceOpts) {
    if (!opts?.core) throw new Error("OrgEntitlementsService requires core client");
    this.ents = makeCoreOrgEntitlements(opts.core);
  }

  async getMe(
    actor: Actor,
    q?: { view?: unknown } | null,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    const orgId = asString(actor?.org_id);
    if (!orgId || !isUuid(orgId)) {
      throw new OrgEntitlementsServiceError("invalid_actor_org_id", {
        statusCode: 400,
        code: "INVALID_ACTOR_ORG_ID",
      });
    }

    requireTenantAdminForOrgOrSystem(actor, orgId);

    try {
      return await this.ents.getMe(q, ctx, { maxRetries: 1 });
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async getMeEffective(actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);

    const orgId = asString(actor?.org_id);
    if (!orgId || !isUuid(orgId)) {
      throw new OrgEntitlementsServiceError("invalid_actor_org_id", {
        statusCode: 400,
        code: "INVALID_ACTOR_ORG_ID",
      });
    }

    requireTenantAdminForOrgOrSystem(actor, orgId);

    try {
      return await this.ents.getMeEffective(ctx, { maxRetries: 1 });
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async getMePath(
    actor: Actor,
    q: EntitlementPathQuery,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    const orgId = asString(actor?.org_id);
    if (!orgId || !isUuid(orgId)) {
      throw new OrgEntitlementsServiceError("invalid_actor_org_id", {
        statusCode: 400,
        code: "INVALID_ACTOR_ORG_ID",
      });
    }

    requireTenantAdminForOrgOrSystem(actor, orgId);

    try {
      return await this.ents.getMePath(q, ctx, { maxRetries: 1 });
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async getMeFeature(
    actor: Actor,
    featureKey: unknown,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    const orgId = asString(actor?.org_id);
    if (!orgId || !isUuid(orgId)) {
      throw new OrgEntitlementsServiceError("invalid_actor_org_id", {
        statusCode: 400,
        code: "INVALID_ACTOR_ORG_ID",
      });
    }

    requireTenantAdminForOrgOrSystem(actor, orgId);

    try {
      return await this.ents.getMeFeature(featureKey, ctx, { maxRetries: 1 });
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async checkMe(
    actor: Actor,
    body: EntitlementCheckInput,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    const orgId = asString(actor?.org_id);
    if (!orgId || !isUuid(orgId)) {
      throw new OrgEntitlementsServiceError("invalid_actor_org_id", {
        statusCode: 400,
        code: "INVALID_ACTOR_ORG_ID",
      });
    }

    requireTenantAdminForOrgOrSystem(actor, orgId);

    try {
      return await this.ents.checkMe(body, ctx);
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async getForOrg(
    orgId: unknown,
    actor: Actor,
    q?: { view?: unknown } | null,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    const id = String(orgId ?? "").trim();
    if (!isUuid(id)) {
      throw new OrgEntitlementsServiceError("invalid_org_id", {
        statusCode: 400,
        code: "INVALID_ORG_ID",
      });
    }

    requireTenantAdminForOrgOrSystem(actor, id);

    try {
      return await this.ents.getForOrg(id, q, ctx, { maxRetries: 1 });
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async getForOrgEffective(
    orgId: unknown,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    const id = String(orgId ?? "").trim();
    if (!isUuid(id)) {
      throw new OrgEntitlementsServiceError("invalid_org_id", {
        statusCode: 400,
        code: "INVALID_ORG_ID",
      });
    }

    requireTenantAdminForOrgOrSystem(actor, id);

    try {
      return await this.ents.getForOrgEffective(id, ctx, { maxRetries: 1 });
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async getForOrgPath(
    orgId: unknown,
    q: EntitlementPathQuery,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    const id = String(orgId ?? "").trim();
    if (!isUuid(id)) {
      throw new OrgEntitlementsServiceError("invalid_org_id", {
        statusCode: 400,
        code: "INVALID_ORG_ID",
      });
    }

    requireTenantAdminForOrgOrSystem(actor, id);

    try {
      return await this.ents.getForOrgPath(id, q, ctx, { maxRetries: 1 });
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async getForOrgFeature(
    orgId: unknown,
    featureKey: unknown,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    const id = String(orgId ?? "").trim();
    if (!isUuid(id)) {
      throw new OrgEntitlementsServiceError("invalid_org_id", {
        statusCode: 400,
        code: "INVALID_ORG_ID",
      });
    }

    requireTenantAdminForOrgOrSystem(actor, id);

    try {
      return await this.ents.getForOrgFeature(id, featureKey, ctx, { maxRetries: 1 });
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async checkForOrg(
    orgId: unknown,
    body: EntitlementCheckInput,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    const id = String(orgId ?? "").trim();
    if (!isUuid(id)) {
      throw new OrgEntitlementsServiceError("invalid_org_id", {
        statusCode: 400,
        code: "INVALID_ORG_ID",
      });
    }

    requireTenantAdminForOrgOrSystem(actor, id);

    try {
      return await this.ents.checkForOrg(id, body, ctx);
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
    if (err instanceof OrgEntitlementsServiceError) return err;

    if (err instanceof OrgEntitlementsClientError) {
      return new OrgEntitlementsServiceError(err.message || "upstream_error", {
        statusCode: err.statusCode,
        code: err.code,
      });
    }

    if (err instanceof CoreClientError) {
      const status = err.status;
      const code = err.code || null;

      if (status === 400) {
        return new OrgEntitlementsServiceError("bad_request", {
          statusCode: 400,
          code: code ?? "BAD_REQUEST",
        });
      }
      if (status === 401) {
        return new OrgEntitlementsServiceError("unauthorized", {
          statusCode: 401,
          code: code ?? "AUTH_REQUIRED",
        });
      }
      if (status === 403) {
        return new OrgEntitlementsServiceError("forbidden", {
          statusCode: 403,
          code: code ?? "FORBIDDEN",
        });
      }
      if (status === 404) {
        return new OrgEntitlementsServiceError("not_found", {
          statusCode: 404,
          code: code ?? "NOT_FOUND",
        });
      }
      if (status === 409) {
        return new OrgEntitlementsServiceError("conflict", {
          statusCode: 409,
          code: code ?? "CONFLICT",
        });
      }

      return new OrgEntitlementsServiceError("upstream_error", {
        statusCode: 502,
        code: code ?? "UPSTREAM_ERROR",
      });
    }

    return new OrgEntitlementsServiceError("internal_error", {
      statusCode: 500,
      code: "INTERNAL_ERROR",
    });
  }
}

export default OrgEntitlementsService;