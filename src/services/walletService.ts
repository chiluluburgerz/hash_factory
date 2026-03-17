// ============================================================================
// File: src/services/walletService.ts
// Version: 1.0-hash-factory-wallet-service | 2026-03-12
// Purpose:
//   HF WalletService (proxy + guard layer) -> Core Backend.
//   - Preserves Core as source of truth for wallet ownership, RLS, and entitlements
//   - Uses HF entitlement preflight only when actor is tenant_admin/system_admin
//   - Avoids false 403s for normal self-service users, since current HF entitlement
//     helper depends on tenant-admin-only Core entitlement routes
// Notes:
//   - This is intentional. Core WalletService remains the authoritative policy layer.
// ============================================================================

import type { FastifyRequest } from "fastify";
import type { CoreRequestCtx } from "../core/coreClient.js";
import type { WalletsClient } from "../core/walletsClient.js";
import { WalletsClientError } from "../core/walletsClient.js";
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

export type WalletServiceOpts = Readonly<{
  wallets: WalletsClient;
  entitlements?: HfEntitlements | null;
}>;

export class WalletServiceError extends Error {
  statusCode: number;
  code: string;
  detail?: unknown;

  constructor(message: string, opts: { statusCode: number; code: string; detail?: unknown }) {
    super(message);
    this.name = "WalletServiceError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.detail = opts.detail;
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

function requireActor(actor: Actor | null | undefined): asserts actor is Actor {
  if (actor && typeof actor === "object") return;
  throw new WalletServiceError("unauthorized", { statusCode: 401, code: "AUTH_REQUIRED" });
}

function requireSystemAdmin(actor: Actor | null | undefined): void {
  if (isSystemAdmin(actor)) return;
  throw new WalletServiceError("forbidden", { statusCode: 403, code: "SYSTEM_ADMIN_REQUIRED" });
}

function canUseTenantAdminEntitlementPreflight(actor: Actor | null | undefined): boolean {
  return isSystemAdmin(actor) || isTenantAdmin(actor);
}

export class WalletService {
  private wallets: WalletsClient;
  private entitlements: HfEntitlements | null;

  constructor(opts: WalletServiceOpts) {
    if (!opts?.wallets) throw new Error("WalletService requires wallets client");
    this.wallets = opts.wallets;
    this.entitlements = opts.entitlements ?? null;
  }

  ctxFromReq(req: FastifyRequest, actor?: Actor | null, forWrite = false): CoreRequestCtx {
    return buildGatewayCtx(req, actor, {
      forWrite,
      requirePassThroughAuth: true,
    });
  }

  async listMine(req: FastifyRequest, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    try {
      return await this.wallets.listMine(ctx ?? this.ctxFromReq(req, actor, false), { maxRetries: 1 });
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async getMyPrimary(req: FastifyRequest, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    try {
      return await this.wallets.getMyPrimary(ctx ?? this.ctxFromReq(req, actor, false), { maxRetries: 1 });
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async getWalletById(req: FastifyRequest, walletId: unknown, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireWalletEnabled(req, actor);
    }

    try {
      return await this.wallets.getById(walletId, ctx ?? this.ctxFromReq(req, actor, false), { maxRetries: 1 });
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async createMyWallet(req: FastifyRequest, body: Record<string, unknown>, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);

    // Advisory preflight only.
    // Core remains authoritative for ownership, entitlement enforcement, and RLS.
    // Non-admin self-service users intentionally do not depend on HF entitlement reads.
    // Preflight only where the helper can succeed without false negatives.
    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireWalletEnabled(req, actor);
      await this.entitlements.requireWalletSelfCreate(req, actor);
    }

    try {
      return await this.wallets.createMyWallet(body, ctx ?? this.ctxFromReq(req, actor, true));
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async setMyPrimary(req: FastifyRequest, walletId: unknown, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);

    // Advisory preflight only. Core remains authoritative.
    // Non-admin self-service users intentionally do not depend on HF entitlement reads.
    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireWalletEnabled(req, actor);
      await this.entitlements.requireWalletSelfManage(req, actor);
    }

    try {
      return await this.wallets.setMyPrimary(walletId, ctx ?? this.ctxFromReq(req, actor, true));
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async retireMyWallet(req: FastifyRequest, walletId: unknown, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);

    // Advisory preflight only. Core remains authoritative.
    // Non-admin self-service users intentionally do not depend on HF entitlement reads.
    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireWalletEnabled(req, actor);
      await this.entitlements.requireWalletSelfManage(req, actor);
    }

    try {
      return await this.wallets.retireMyWallet(walletId, ctx ?? this.ctxFromReq(req, actor, true));
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async getBalanceRow(req: FastifyRequest, walletId: unknown, tokenId: unknown, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);

    // Advisory preflight only. Core remains authoritative.
    // Non-admin self-service users intentionally do not depend on HF entitlement reads.
    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireWalletEnabled(req, actor);
      await this.entitlements.requireWalletBalances(req, actor);
    }

    try {
      return await this.wallets.getBalanceRow(walletId, tokenId, ctx ?? this.ctxFromReq(req, actor, false), { maxRetries: 1 });
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async getAvailable(req: FastifyRequest, walletId: unknown, tokenId: unknown, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);

    // Advisory preflight only. Core remains authoritative.
    // Non-admin self-service users intentionally do not depend on HF entitlement reads.
    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireWalletEnabled(req, actor);
      await this.entitlements.requireWalletBalances(req, actor);
    }

    try {
      return await this.wallets.getAvailable(walletId, tokenId, ctx ?? this.ctxFromReq(req, actor, false), { maxRetries: 1 });
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async adminCreateWallet(req: FastifyRequest, body: Record<string, unknown>, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    requireSystemAdmin(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireWalletEnabled(req, actor);
      await this.entitlements.requireWalletSelfCreate(req, actor);
    }

    try {
      return await this.wallets.adminCreateWallet(body, ctx ?? this.ctxFromReq(req, actor, true));
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async adminBalanceOp(req: FastifyRequest, body: Record<string, unknown>, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    requireSystemAdmin(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireWalletEnabled(req, actor);
      await this.entitlements.requireWalletBalances(req, actor);
    }

    try {
      return await this.wallets.adminBalanceOp(body, ctx ?? this.ctxFromReq(req, actor, true));
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async adminTransfer(req: FastifyRequest, body: Record<string, unknown>, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    requireSystemAdmin(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireWalletEnabled(req, actor);
      await this.entitlements.requireWalletBalances(req, actor);
    }

    try {
      return await this.wallets.adminTransfer(body, ctx ?? this.ctxFromReq(req, actor, true));
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async adminReconcile(req: FastifyRequest, body: Record<string, unknown>, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    requireSystemAdmin(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireWalletEnabled(req, actor);
      await this.entitlements.requireWalletReconcile(req, actor);
    }

    try {
      return await this.wallets.adminReconcile(body, ctx ?? this.ctxFromReq(req, actor, true));
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async adminListUserWallets(req: FastifyRequest, userId: unknown, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    requireSystemAdmin(actor);
    const id = String(userId ?? "").trim();
    if (!isUuid(id)) {
      throw new WalletServiceError("invalid_user_id", { statusCode: 400, code: "INVALID_USER_ID" });
    }

    try {
      return await this.wallets.adminListUserWallets(id, ctx ?? this.ctxFromReq(req, actor, false), { maxRetries: 1 });
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async adminGetUserPrimary(req: FastifyRequest, userId: unknown, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    requireSystemAdmin(actor);
    const id = String(userId ?? "").trim();
    if (!isUuid(id)) {
      throw new WalletServiceError("invalid_user_id", { statusCode: 400, code: "INVALID_USER_ID" });
    }

    try {
      return await this.wallets.adminGetUserPrimary(id, ctx ?? this.ctxFromReq(req, actor, false), { maxRetries: 1 });
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  #mapError(err: unknown): Error {
    if (err instanceof WalletServiceError) return err;

    if (err instanceof HfEntitlementError) {
      return new WalletServiceError(err.message || "forbidden", {
        statusCode: err.statusCode,
        code: err.code,
        detail: err.detail,
      });
    }

    if (err instanceof WalletsClientError) {
      return new WalletServiceError(err.message || "upstream_error", {
        statusCode: err.statusCode,
        code: err.code,
        detail: err.detail,
      });
    }

    if (err instanceof CoreClientError) {
      const status = err.status;
      const code = err.code || null;

      if (status === 400) return new WalletServiceError("bad_request", { statusCode: 400, code: code ?? "BAD_REQUEST" });
      if (status === 401) return new WalletServiceError("unauthorized", { statusCode: 401, code: code ?? "AUTH_REQUIRED" });
      if (status === 403) return new WalletServiceError("forbidden", { statusCode: 403, code: code ?? "FORBIDDEN" });
      if (status === 404) return new WalletServiceError("not_found", { statusCode: 404, code: code ?? "NOT_FOUND" });
      if (status === 409) return new WalletServiceError("conflict", { statusCode: 409, code: code ?? "CONFLICT" });
      return new WalletServiceError("upstream_error", { statusCode: 502, code: code ?? "UPSTREAM_ERROR" });
    }

    return new WalletServiceError("internal_error", { statusCode: 500, code: "INTERNAL_ERROR" });
  }
}

export default WalletService;