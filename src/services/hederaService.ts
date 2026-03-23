// ============================================================================
// File: src/services/hederaService.ts
// Version: 1.2-hash-factory-hedera-service-expanded-read-surface | 2026-03-17
// Purpose:
//   HF HederaService (proxy + guard layer) -> Core Backend.
//   - Preserves Core as source of truth for actor visibility, RLS, scopes,
//     topic membership policy, and Hedera enforcement.
//   - Uses HF entitlement preflight only when actor is tenant_admin/system_admin
//     to avoid false 403s for normal self-service users.
// Notes:
//   - This mirrors the WalletService posture intentionally.
//   - HF exposes admin topic membership at /v1/admin/hedera/... while Core
//     upstream remains /v1/hedera/....
//   - Hedera entitlement preflight reads effective policy from Core:
//       hedera.enabled
//       hedera.allow_topic_list
//       hedera.allow_topic_bootstrap
// ============================================================================

import type { FastifyRequest } from "fastify";
import type { CoreRequestCtx } from "../core/coreClient.js";
import type { HederaClient } from "../core/hederaClient.js";
import { HederaClientError } from "../core/hederaClient.js";
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

export type HederaServiceOpts = Readonly<{
  hedera: HederaClient;
  entitlements?: HfEntitlements | null;
}>;

export class HederaServiceError extends Error {
  statusCode: number;
  code: string;
  detail?: unknown;

  constructor(message: string, opts: { statusCode: number; code: string; detail?: unknown }) {
    super(message);
    this.name = "HederaServiceError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.detail = opts.detail;
  }
}

function requireActor(actor: Actor | null | undefined): asserts actor is Actor {
  if (actor && typeof actor === "object") return;
  throw new HederaServiceError("unauthorized", { statusCode: 401, code: "AUTH_REQUIRED" });
}

function isSystemAdmin(actor: Actor | null | undefined): boolean {
  return Boolean(actor?.is_system_admin || actor?.is_admin || actor?.isAdmin);
}

function isTenantAdmin(actor: Actor | null | undefined): boolean {
  return String(actor?.org_role ?? "") === "tenant_admin";
}

function requireTenantAdminOrSystem(actor: Actor | null | undefined): void {
  if (isSystemAdmin(actor) || isTenantAdmin(actor)) return;
  throw new HederaServiceError("forbidden", {
    statusCode: 403,
    code: "TENANT_ADMIN_OR_SYSTEM_REQUIRED",
  });
}

function canUseTenantAdminEntitlementPreflight(actor: Actor | null | undefined): boolean {
  return isSystemAdmin(actor) || isTenantAdmin(actor);
}

export class HederaService {
  private hedera: HederaClient;
  private entitlements: HfEntitlements | null;

  constructor(opts: HederaServiceOpts) {
    if (!opts?.hedera) throw new Error("HederaService requires hedera client");
    this.hedera = opts.hedera;
    this.entitlements = opts.entitlements ?? null;
  }

  ctxFromReq(req: FastifyRequest, actor?: Actor | null, forWrite = false): CoreRequestCtx {
    return buildGatewayCtx(req, actor, {
      forWrite,
      requirePassThroughAuth: true,
    });
  }

  async getOverview(
    req: FastifyRequest,
    opts: { recentLimit?: unknown } | undefined,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.#requireHederaReadEnabled(req, actor);
    }

    try {
      return await this.hedera.getOverview(
        opts,
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async listTopics(req: FastifyRequest, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.#requireHederaReadEnabled(req, actor);
    }

    try {
      return await this.hedera.listTopics(
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async getTopicByName(
    req: FastifyRequest,
    topicName: unknown,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.#requireHederaReadEnabled(req, actor);
    }

    try {
      return await this.hedera.getTopicByName(
        topicName,
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async getTopicMessages(
    req: FastifyRequest,
    topicName: unknown,
    opts: { limit?: unknown; offset?: unknown } | undefined,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.#requireHederaReadEnabled(req, actor);
    }

    try {
      return await this.hedera.getTopicMessages(
        topicName,
        opts,
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async listHcsActivity(
    req: FastifyRequest,
    opts:
      | {
          topic_name?: unknown;
          mirror_verified?: unknown;
          limit?: unknown;
          offset?: unknown;
        }
      | undefined,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.#requireHederaReadEnabled(req, actor);
    }

    try {
      return await this.hedera.listHcsActivity(
        opts,
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async listHtsActivity(
    req: FastifyRequest,
    opts:
      | {
          token_id?: unknown;
          type?: unknown;
          mirror_verified?: unknown;
          limit?: unknown;
          offset?: unknown;
        }
      | undefined,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.#requireHederaReadEnabled(req, actor);
    }

    try {
      return await this.hedera.listHtsActivity(
        opts,
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async getHcsActivityByMessageId(
    req: FastifyRequest,
    messageId: unknown,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.#requireHederaReadEnabled(req, actor);
    }

    try {
      return await this.hedera.getHcsActivityByMessageId(
        messageId,
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async getHcsActivityByTransactionId(
    req: FastifyRequest,
    transactionId: unknown,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.#requireHederaReadEnabled(req, actor);
    }

    try {
      return await this.hedera.getHcsActivityByTransactionId(
        transactionId,
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async getHtsActivityByTransactionId(
    req: FastifyRequest,
    transactionId: unknown,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.#requireHederaReadEnabled(req, actor);
    }

    try {
      return await this.hedera.getHtsActivityByTransactionId(
        transactionId,
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async getTokenAssociation(
    req: FastifyRequest,
    tokenId: unknown,
    accountId: unknown,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.#requireHederaReadEnabled(req, actor);
    }

    try {
      return await this.hedera.getTokenAssociation(
        tokenId,
        accountId,
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async verifyNftOwnership(
    req: FastifyRequest,
    tokenId: unknown,
    serial: unknown,
    expectedAccountId: unknown,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.#requireHederaReadEnabled(req, actor);
    }

    try {
      return await this.hedera.verifyNftOwnership(
        tokenId,
        serial,
        expectedAccountId,
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async adminAddUserToTopic(
    req: FastifyRequest,
    topicName: unknown,
    body: Record<string, unknown>,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);
    requireTenantAdminOrSystem(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.#requireHederaEnabled(req, actor);
      await this.#requireHederaTopicAdminEnabled(req, actor);
    }

    try {
      return await this.hedera.addUserToTopic(
        topicName,
        body,
        ctx ?? this.ctxFromReq(req, actor, true)
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }


  async adminListTopicUsers(
    req: FastifyRequest,
    topicName: unknown,
    opts:
      | {
          includeRevoked?: unknown;
          limit?: unknown;
          offset?: unknown;
          org_id?: unknown;
          scope?: unknown;
        }
      | undefined,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);
    requireTenantAdminOrSystem(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.#requireHederaReadEnabled(req, actor);
      await this.#requireHederaTopicAdminEnabled(req, actor);
    }

    try {
      return await this.hedera.listTopicUsers(
        topicName,
        opts,
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 1 }
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async adminRemoveUserFromTopic(
    req: FastifyRequest,
    topicName: unknown,
    userId: unknown,
    opts:
      | {
          org_id?: unknown;
          scope?: unknown;
        }
      | undefined,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);
    requireTenantAdminOrSystem(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.#requireHederaEnabled(req, actor);
      await this.#requireHederaTopicAdminEnabled(req, actor);
    }

    try {
      return await this.hedera.removeUserFromTopic(
        topicName,
        userId,
        opts,
        ctx ?? this.ctxFromReq(req, actor, true)
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async enqueueVerifyJob(
    req: FastifyRequest,
    body: Record<string, unknown>,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.#requireHederaReadEnabled(req, actor);
    }

    try {
      return await this.hedera.enqueueVerifyJob(
        body,
        ctx ?? this.ctxFromReq(req, actor, false)
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async getVerifyJob(
    req: FastifyRequest,
    id: unknown,
    opts: { with_tx?: unknown } | undefined,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.#requireHederaReadEnabled(req, actor);
    }

    try {
      return await this.hedera.getVerifyJob(id, opts, ctx ?? this.ctxFromReq(req, actor, false), { maxRetries: 1 });
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  async #requireHederaEnabled(req: FastifyRequest, actor: Actor): Promise<void> {
    const ent = this.entitlements;
    if (!ent) return;

    if (typeof ent.requireHederaEnabled === "function") {
      await ent.requireHederaEnabled(req, actor);
    }
  }

  async #requireHederaReadEnabled(req: FastifyRequest, actor: Actor): Promise<void> {
    const ent = this.entitlements;
    if (!ent) return;

    if (typeof ent.requireHederaTopicList === "function") {
      await ent.requireHederaTopicList(req, actor);
      return;
    }

    if (typeof ent.requireHederaEnabled === "function") {
      await ent.requireHederaEnabled(req, actor);
      return;
    }
  }

  async #requireHederaTopicAdminEnabled(req: FastifyRequest, actor: Actor): Promise<void> {
    const ent = this.entitlements;
    if (!ent) return;

    if (typeof ent.requireHederaTopicAdmin === "function") {
      await ent.requireHederaTopicAdmin(req, actor);
      return;
    }

    if (typeof ent.requireHederaEnabled === "function") {
      await ent.requireHederaEnabled(req, actor);
      return;
    }
  }

  #mapError(err: unknown): Error {
    if (err instanceof HederaServiceError) return err;

    if (err instanceof HfEntitlementError) {
      return new HederaServiceError(err.message || "forbidden", {
        statusCode: err.statusCode,
        code: err.code,
        detail: err.detail,
      });
    }

    if (err instanceof HederaClientError) {
      return new HederaServiceError(err.message || "upstream_error", {
        statusCode: err.statusCode,
        code: err.code,
        detail: err.detail,
      });
    }

    if (err instanceof CoreClientError) {
      const status = err.status;
      const code = err.code || null;

      if (status === 400) return new HederaServiceError("bad_request", { statusCode: 400, code: code ?? "BAD_REQUEST" });
      if (status === 401) return new HederaServiceError("unauthorized", { statusCode: 401, code: code ?? "AUTH_REQUIRED" });
      if (status === 403) return new HederaServiceError("forbidden", { statusCode: 403, code: code ?? "FORBIDDEN" });
      if (status === 404) return new HederaServiceError("not_found", { statusCode: 404, code: code ?? "NOT_FOUND" });
      if (status === 409) return new HederaServiceError("conflict", { statusCode: 409, code: code ?? "CONFLICT" });
      return new HederaServiceError("upstream_error", { statusCode: 502, code: code ?? "UPSTREAM_ERROR" });
    }

    return new HederaServiceError("internal_error", {
      statusCode: 500,
      code: "INTERNAL_ERROR",
    });
  }

  async verifyAndMaybeDecrypt(
    req: FastifyRequest,
    body: Record<string, unknown>,
    actor: Actor,
    ctx?: CoreRequestCtx
  ) {
    requireActor(actor);

    if (this.entitlements && canUseTenantAdminEntitlementPreflight(actor)) {
      await this.#requireHederaReadEnabled(req, actor);
    }

    try {
      return await this.hedera.verifyAndMaybeDecrypt(
        body,
        ctx ?? this.ctxFromReq(req, actor, false),
        { maxRetries: 0 }
      );
    } catch (e) {
      throw this.#mapError(e);
    }
  }
}

export default HederaService;