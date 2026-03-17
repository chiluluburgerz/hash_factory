// ============================================================================
// File: src/services/tokenService.ts
// Version: 1.0-hash-factory-token-service | 2026-03-12
// Purpose:
//   HF TokenService (proxy + guard layer) -> Core Backend.
//   - Preserves Core as source of truth for token RLS, scopes, and entitlements
//   - Uses HF entitlement preflight only when actor is tenant_admin/system_admin
//   - Avoids false 403s for normal authenticated users, since current HF
//     entitlement helper depends on tenant-admin-only Core entitlement routes
// Notes:
//   - Token reads may be valid for normal users depending on Core policy.
//   - Token writes remain tenant-admin/system-admin only at HF boundary.
// ============================================================================

import type { FastifyRequest } from "fastify";
import type { CoreRequestCtx } from "../core/coreClient.js";
import type { TokensClient } from "../core/tokensClient.js";
import { TokensClientError } from "../core/tokensClient.js";
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

export type TokenServiceOpts = Readonly<{
  tokens: TokensClient;
  entitlements?: HfEntitlements | null;
}>;

export class TokenServiceError extends Error {
  statusCode: number;
  code: string;
  detail?: unknown;

  constructor(message: string, opts: { statusCode: number; code: string; detail?: unknown }) {
    super(message);
    this.name = "TokenServiceError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.detail = opts.detail;
  }
}

function requireActor(actor: Actor | null | undefined): asserts actor is Actor {
  if (actor && typeof actor === "object") return;
  throw new TokenServiceError("unauthorized", { statusCode: 401, code: "AUTH_REQUIRED" });
}

function isSystemAdmin(actor: Actor | null | undefined): boolean {
  return Boolean(actor?.is_system_admin || actor?.is_admin || actor?.isAdmin);
}

function isTenantAdmin(actor: Actor | null | undefined): boolean {
  return String(actor?.org_role ?? "") === "tenant_admin";
}

function requireTenantAdminOrSystem(actor: Actor | null | undefined): void {
  if (isSystemAdmin(actor) || isTenantAdmin(actor)) return;
  throw new TokenServiceError("forbidden", {
    statusCode: 403,
    code: "ORG_TENANT_ADMIN_REQUIRED",
  });
}

function canUseTenantAdminEntitlementPreflight(actor: Actor | null | undefined): boolean {
  return isSystemAdmin(actor) || isTenantAdmin(actor);
}

export class TokenService {
  private tokens: TokensClient;
  private entitlements: HfEntitlements | null;

  constructor(opts: TokenServiceOpts) {
    if (!opts?.tokens) throw new Error("TokenService requires tokens client");
    this.tokens = opts.tokens;
    this.entitlements = opts.entitlements ?? null;
  }

  ctxFromReq(req: FastifyRequest, actor?: Actor | null, forWrite = false): CoreRequestCtx {
    return buildGatewayCtx(req, actor, {
      forWrite,
      requirePassThroughAuth: true,
    });
  }

  async listActive(req: FastifyRequest, actor: Actor, q?: Record<string, unknown>, ctx?: CoreRequestCtx) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireTokensEnabled(req, actor);
      await this.entitlements.requireTokensRead(req, actor);
    }

    try {
      return await this.tokens.listActive(q ?? {}, ctx ?? this.ctxFromReq(req, actor, false), { maxRetries: 1 });
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async search(req: FastifyRequest, actor: Actor, q?: Record<string, unknown>, ctx?: CoreRequestCtx) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireTokensEnabled(req, actor);
      await this.entitlements.requireTokensRead(req, actor);
    }

    try {
      return await this.tokens.search(q ?? {}, ctx ?? this.ctxFromReq(req, actor, false), { maxRetries: 1 });
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async getByRowId(req: FastifyRequest, actor: Actor, id: unknown, ctx?: CoreRequestCtx) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireTokensEnabled(req, actor);
      await this.entitlements.requireTokensRead(req, actor);
    }

    try {
      return await this.tokens.getByRowId(id, ctx ?? this.ctxFromReq(req, actor, false), { maxRetries: 1 });
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async getByTokenId(req: FastifyRequest, actor: Actor, tokenId: unknown, ctx?: CoreRequestCtx) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireTokensEnabled(req, actor);
      await this.entitlements.requireTokensRead(req, actor);
    }

    try {
      return await this.tokens.getByTokenId(tokenId, ctx ?? this.ctxFromReq(req, actor, false), { maxRetries: 1 });
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async getBySymbolPurpose(
    req: FastifyRequest,
    actor: Actor,
    symbol: unknown,
    purpose: unknown,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireTokensEnabled(req, actor);
      await this.entitlements.requireTokensRead(req, actor);
    }

    try {
      return await this.tokens.getBySymbolPurpose(
        symbol,
        purpose,
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async listByPurpose(
    req: FastifyRequest,
    actor: Actor,
    purpose: unknown,
    q?: Record<string, unknown>,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireTokensEnabled(req, actor);
      await this.entitlements.requireTokensRead(req, actor);
    }

    try {
      return await this.tokens.listByPurpose(
        purpose,
        q ?? {},
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async resolveForPurpose(req: FastifyRequest, actor: Actor, purpose: unknown, ctx?: CoreRequestCtx) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireTokensEnabled(req, actor);
      await this.entitlements.requireTokensResolve(req, actor);
    }

    try {
      return await this.tokens.resolveForPurpose(
        purpose,
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async create(req: FastifyRequest, body: Record<string, unknown>, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    requireTenantAdminOrSystem(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireTokensEnabled(req, actor);
      await this.entitlements.requireTokensManage(req, actor);
    }

    try {
      return await this.tokens.create(body, ctx ?? this.ctxFromReq(req, actor, true));
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async upsert(req: FastifyRequest, body: Record<string, unknown>, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    requireTenantAdminOrSystem(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireTokensEnabled(req, actor);
      await this.entitlements.requireTokensManage(req, actor);
    }

    try {
      return await this.tokens.upsert(body, ctx ?? this.ctxFromReq(req, actor, true));
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async patchMetadata(
    req: FastifyRequest,
    tokenId: unknown,
    body: Record<string, unknown>,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);
    requireTenantAdminOrSystem(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireTokensEnabled(req, actor);
      await this.entitlements.requireTokensManage(req, actor);
    }

    try {
      return await this.tokens.patchMetadata(tokenId, body, ctx ?? this.ctxFromReq(req, actor, true));
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async delete(req: FastifyRequest, tokenId: unknown, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    requireTenantAdminOrSystem(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireTokensEnabled(req, actor);
      await this.entitlements.requireTokensManage(req, actor);
    }

    try {
      return await this.tokens.delete(tokenId, ctx ?? this.ctxFromReq(req, actor, true));
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async restore(req: FastifyRequest, tokenId: unknown, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    requireTenantAdminOrSystem(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.entitlements.requireTokensEnabled(req, actor);
      await this.entitlements.requireTokensManage(req, actor);
    }

    try {
      return await this.tokens.restore(tokenId, ctx ?? this.ctxFromReq(req, actor, true));
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  #mapError(err: unknown): Error {
    if (err instanceof TokenServiceError) return err;

    if (err instanceof HfEntitlementError) {
      return new TokenServiceError(err.message || "forbidden", {
        statusCode: err.statusCode,
        code: err.code,
        detail: err.detail,
      });
    }

    if (err instanceof TokensClientError) {
      return new TokenServiceError(err.message || "upstream_error", {
        statusCode: err.statusCode,
        code: err.code,
        detail: err.detail,
      });
    }

    if (err instanceof CoreClientError) {
      const status = err.status;
      const code = err.code || null;

      if (status === 400) return new TokenServiceError("bad_request", { statusCode: 400, code: code ?? "BAD_REQUEST" });
      if (status === 401) return new TokenServiceError("unauthorized", { statusCode: 401, code: code ?? "AUTH_REQUIRED" });
      if (status === 403) return new TokenServiceError("forbidden", { statusCode: 403, code: code ?? "FORBIDDEN" });
      if (status === 404) return new TokenServiceError("not_found", { statusCode: 404, code: code ?? "NOT_FOUND" });
      if (status === 409) return new TokenServiceError("conflict", { statusCode: 409, code: code ?? "CONFLICT" });
      return new TokenServiceError("upstream_error", { statusCode: 502, code: code ?? "UPSTREAM_ERROR" });
    }

    return new TokenServiceError("internal_error", { statusCode: 500, code: "INTERNAL_ERROR" });
  }
}

export default TokenService;