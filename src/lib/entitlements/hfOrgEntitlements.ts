// ============================================================================
// File: src/lib/entitlements/hfOrgEntitlements.ts
// Version: 1.0-hf-entitlements-helper | 2026-03-12
// Purpose:
//   Internal reusable HF entitlement helper layer.
//   - Fetches effective org entitlements through Core via pass-through auth
//   - Provides small reusable helpers for policy checks and wallet policy reads
//   - Centralizes entitlement error mapping for downstream HF services/routes
// Notes:
//   - Internal-only. Do not expose this directly as a route.
//   - Core remains source of truth for entitlement semantics.
//   - HF uses this to avoid duplicating entitlement fetch/check logic.
// ============================================================================

import type { FastifyRequest } from "fastify";
import { CoreClientError } from "../../core/coreClient.js";
import type { CoreClient, CoreRequestCtx } from "../../core/coreClient.js";
import {
  makeCoreOrgEntitlements,
  OrgEntitlementsClientError,
} from "../../core/orgEntitlementsClient.js";
import type { EntitlementCheckInput } from "../../core/orgEntitlementsClient.js";
import { buildGatewayCtx } from "../gateway/requestContext.js";
import { HfEntitlementError } from "./hfEntitlementErrors.js";

export type HfActor = Readonly<{
  user_id?: string | null;
  org_id?: string | null;
  org_role?: string | null;
  is_system_admin?: boolean | null;
  is_admin?: boolean | null;
  isAdmin?: boolean | null;
}>;

export type HfEntitlementsOpts = Readonly<{
  core: CoreClient;
}>;

export type EffectiveEntitlements = Readonly<Record<string, unknown>>;

export type TokenPolicy = Readonly<{
  enabled: boolean;
  read: boolean;
  manage: boolean;
  resolve: boolean;
}>;

export type WalletPolicy = Readonly<{
  enabled: boolean;
  self_create: boolean;
  self_manage: boolean;
  balances: boolean;
  reconcile: boolean;
  nfts: boolean;
}>;

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function isUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isSystemAdmin(actor: HfActor | null | undefined): boolean {
  return Boolean(actor?.is_system_admin || actor?.is_admin || actor?.isAdmin);
}

function isTenantAdmin(actor: HfActor | null | undefined): boolean {
  return String(actor?.org_role ?? "") === "tenant_admin";
}

function requireActor(actor: HfActor | null | undefined): asserts actor is HfActor {
  if (actor && typeof actor === "object") return;
  throw new HfEntitlementError("unauthorized", {
    statusCode: 401,
    code: "AUTH_REQUIRED",
  });
}

function requireTenantAdminForOrgOrSystem(actor: HfActor | null | undefined, orgId: string) {
  if (isSystemAdmin(actor)) return;

  const actorOrgId = asString(actor?.org_id);
  if (!actorOrgId || actorOrgId !== orgId) {
    throw new HfEntitlementError("forbidden", {
      statusCode: 403,
      code: "CROSS_ORG_DENIED",
    });
  }

  if (!isTenantAdmin(actor)) {
    throw new HfEntitlementError("forbidden", {
      statusCode: 403,
      code: "ORG_TENANT_ADMIN_REQUIRED",
    });
  }
}

function toBool(v: unknown, dflt = false): boolean {
  if (v === true) return true;
  if (v === false) return false;
  if (v == null) return dflt;

  const s = String(v).trim().toLowerCase();
  if (["1", "true", "t", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "f", "no", "n", "off"].includes(s)) return false;
  return dflt;
}

function getPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;

  const parts = String(path || "")
    .split(".")
    .map((s) => s.trim())
    .filter((s): s is string => s.length > 0);

  if (parts.length === 0) return undefined;

  let cur: unknown = obj;

  for (const [i, p] of parts.entries()) {
    if (!cur || typeof cur !== "object") return undefined;

    const remaining = parts.slice(i).join(".");
    if (Object.prototype.hasOwnProperty.call(cur, remaining)) {
      return (cur as Record<string, unknown>)[remaining];
    }

    if (!Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }

  return cur;
}

export class HfEntitlements {
  private ents: ReturnType<typeof makeCoreOrgEntitlements>;

  constructor(opts: HfEntitlementsOpts) {
    if (!opts?.core) throw new Error("HfEntitlements requires core client");
    this.ents = makeCoreOrgEntitlements(opts.core);
  }

  ctxFromReq(
    req: FastifyRequest,
    actor?: HfActor | null,
    forWrite = false
  ): CoreRequestCtx {
    return buildGatewayCtx(req, actor, {
      forWrite,
      requirePassThroughAuth: true,
    });
  }

  async getCurrentEffective(
    req: FastifyRequest,
    actor: HfActor
  ): Promise<EffectiveEntitlements> {
    requireActor(actor);

    const orgId = asString(actor.org_id);
    if (!orgId || !isUuid(orgId)) {
      throw new HfEntitlementError("invalid_actor_org_id", {
        statusCode: 400,
        code: "INVALID_ACTOR_ORG_ID",
      });
    }

    requireTenantAdminForOrgOrSystem(actor, orgId);

    try {
      const out = await this.ents.getMeEffective(
        this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
      return out && typeof out === "object" ? Object.freeze({ ...out }) : Object.freeze({});
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async checkCurrent(
    req: FastifyRequest,
    actor: HfActor,
    input: EntitlementCheckInput
  ): Promise<Readonly<{ path: string; enabled: boolean }>> {
    requireActor(actor);

    const orgId = asString(actor.org_id);
    if (!orgId || !isUuid(orgId)) {
      throw new HfEntitlementError("invalid_actor_org_id", {
        statusCode: 400,
        code: "INVALID_ACTOR_ORG_ID",
      });
    }

    requireTenantAdminForOrgOrSystem(actor, orgId);

    try {
      const out = await this.ents.checkMe(
        input,
        this.ctxFromReq(req, actor, true)
      );

      const path = String((out as any)?.path ?? input.path ?? "").trim();
      const enabled = Boolean((out as any)?.enabled);

      return Object.freeze({ path, enabled });
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async requireCurrent(
    req: FastifyRequest,
    actor: HfActor,
    path: string,
    opts?: {
      code?: string;
      message?: string;
    }
  ): Promise<true> {
    const result = await this.checkCurrent(req, actor, {
      path,
      required: true,
      ...(opts?.code ? { code: opts.code } : {}),
      ...(opts?.message ? { message: opts.message } : {}),
    });

    if (!result.enabled) {
      throw new HfEntitlementError(opts?.message || "forbidden", {
        statusCode: 403,
        code: opts?.code || "ENTITLEMENT_REQUIRED",
        detail: { path: result.path },
      });
    }

    return true;
  }

  async getTokenPolicy(
    req: FastifyRequest,
    actor: HfActor
  ): Promise<TokenPolicy> {
    const effective = await this.getCurrentEffective(req, actor);

    const enabled = toBool(getPath(effective, "features.tokens.enabled"), false);
    const read = toBool(getPath(effective, "features.tokens.read"), false);
    const manage = toBool(getPath(effective, "features.tokens.manage"), false);
    const resolve = toBool(getPath(effective, "features.tokens.resolve"), false);

    return Object.freeze({
      enabled,
      read: enabled && read,
      manage: enabled && manage,
      resolve: enabled && resolve,
    });
  }

  async requireDatasetAnchor(req: FastifyRequest, actor: HfActor): Promise<true> {
    return this.requireCurrent(req, actor, "features.dataset_anchor", {
      code: "DATASET_ANCHOR_NOT_ENABLED",
      message: "Dataset anchoring is not enabled for this organization",
    });
  }

  async requireDatasetIngest(req: FastifyRequest, actor: HfActor): Promise<true> {
    return this.requireCurrent(req, actor, "features.dataset_ingest", {
      code: "DATASET_INGEST_NOT_ENABLED",
      message: "Dataset ingest is not enabled for this organization",
    });
  }

  async requireMerkleAnchor(req: FastifyRequest, actor: HfActor): Promise<true> {
    return this.requireCurrent(req, actor, "features.merkle_anchor", {
      code: "MERKLE_ANCHOR_NOT_ENABLED",
      message: "Merkle anchoring is not enabled for this organization",
    });
  }

  async requireMerkleRootAnchor(req: FastifyRequest, actor: HfActor): Promise<true> {
    return this.requireCurrent(req, actor, "features.merkle_root_anchor", {
      code: "MERKLE_ROOT_ANCHOR_NOT_ENABLED",
      message: "Merkle root anchoring is not enabled for this organization",
    });
  }

  async requireTokensEnabled(req: FastifyRequest, actor: HfActor): Promise<true> {
    return this.requireCurrent(req, actor, "features.tokens.enabled", {
      code: "TOKENS_NOT_ENABLED",
      message: "Tokens are not enabled for this organization",
    });
  }

  async requireTokensRead(req: FastifyRequest, actor: HfActor): Promise<true> {
    return this.requireCurrent(req, actor, "features.tokens.read", {
      code: "TOKENS_READ_NOT_ENABLED",
      message: "Token reads are not enabled for this organization",
    });
  }

  async requireTokensManage(req: FastifyRequest, actor: HfActor): Promise<true> {
    return this.requireCurrent(req, actor, "features.tokens.manage", {
      code: "TOKENS_MANAGE_NOT_ENABLED",
      message: "Token management is not enabled for this organization",
    });
  }

  async requireTokensResolve(req: FastifyRequest, actor: HfActor): Promise<true> {
    return this.requireCurrent(req, actor, "features.tokens.resolve", {
      code: "TOKENS_RESOLVE_NOT_ENABLED",
      message: "Token resolution is not enabled for this organization",
    });
  }

  async getWalletPolicy(
    req: FastifyRequest,
    actor: HfActor
  ): Promise<WalletPolicy> {
    const effective = await this.getCurrentEffective(req, actor);

    const enabled = toBool(getPath(effective, "features.wallets.enabled"), false);
    const selfCreate = toBool(getPath(effective, "features.wallets.self_create"), false);
    const selfManage = toBool(getPath(effective, "features.wallets.self_manage"), false);
    const balances = toBool(getPath(effective, "features.wallets.balances"), false);
    const reconcile = toBool(getPath(effective, "features.wallets.reconcile"), false);
    const nfts = toBool(getPath(effective, "features.wallets.nfts"), false);

    return Object.freeze({
      enabled,
      self_create: enabled && selfCreate,
      self_manage: enabled && selfManage,
      balances: enabled && balances,
      reconcile: enabled && reconcile,
      nfts: enabled && nfts,
    });
  }

  async requireWalletEnabled(req: FastifyRequest, actor: HfActor): Promise<true> {
    return this.requireCurrent(req, actor, "features.wallets.enabled", {
      code: "WALLETS_NOT_ENABLED",
      message: "Wallets are not enabled for this organization",
    });
  }

  async requireWalletSelfCreate(req: FastifyRequest, actor: HfActor): Promise<true> {
    return this.requireCurrent(req, actor, "features.wallets.self_create", {
      code: "WALLETS_SELF_CREATE_NOT_ENABLED",
      message: "Wallet self-create is not enabled for this organization",
    });
  }

  async requireWalletSelfManage(req: FastifyRequest, actor: HfActor): Promise<true> {
    return this.requireCurrent(req, actor, "features.wallets.self_manage", {
      code: "WALLETS_SELF_MANAGE_NOT_ENABLED",
      message: "Wallet self-manage is not enabled for this organization",
    });
  }

  async requireWalletBalances(req: FastifyRequest, actor: HfActor): Promise<true> {
    return this.requireCurrent(req, actor, "features.wallets.balances", {
      code: "WALLETS_BALANCES_NOT_ENABLED",
      message: "Wallet balances are not enabled for this organization",
    });
  }

  async requireWalletReconcile(req: FastifyRequest, actor: HfActor): Promise<true> {
    return this.requireCurrent(req, actor, "features.wallets.reconcile", {
      code: "WALLETS_RECONCILE_NOT_ENABLED",
      message: "Wallet reconciliation is not enabled for this organization",
    });
  }

  async requireWalletNfts(req: FastifyRequest, actor: HfActor): Promise<true> {
    return this.requireCurrent(req, actor, "features.wallets.nfts", {
      code: "WALLETS_NFTS_NOT_ENABLED",
      message: "Wallet NFT support is not enabled for this organization",
    });
  }

  #mapError(err: unknown): Error {
    if (err instanceof HfEntitlementError) return err;

    if (err instanceof OrgEntitlementsClientError) {
      return new HfEntitlementError(err.message || "upstream_error", {
        statusCode: err.statusCode,
        code: err.code,
        detail: err.detail,
      });
    }

    if (err instanceof CoreClientError) {
      const status = err.status;
      const code = err.code || null;

      if (status === 400) {
        return new HfEntitlementError("bad_request", {
          statusCode: 400,
          code: code ?? "BAD_REQUEST",
        });
      }
      if (status === 401) {
        return new HfEntitlementError("unauthorized", {
          statusCode: 401,
          code: code ?? "AUTH_REQUIRED",
        });
      }
      if (status === 403) {
        return new HfEntitlementError("forbidden", {
          statusCode: 403,
          code: code ?? "FORBIDDEN",
        });
      }
      if (status === 404) {
        return new HfEntitlementError("not_found", {
          statusCode: 404,
          code: code ?? "NOT_FOUND",
        });
      }
      if (status === 409) {
        return new HfEntitlementError("conflict", {
          statusCode: 409,
          code: code ?? "CONFLICT",
        });
      }

      return new HfEntitlementError("upstream_error", {
        statusCode: 502,
        code: code ?? "UPSTREAM_ERROR",
      });
    }

    return new HfEntitlementError("internal_error", {
      statusCode: 500,
      code: "INTERNAL_ERROR",
    });
  }
}

export default HfEntitlements;