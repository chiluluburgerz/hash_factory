// ============================================================================
// File: src/services/userService.ts
// Version: 1.1-hash-factory-user-service-gateway-ctx | 2026-03-12
// Purpose:
//   HF UserService (proxy + guard layer) -> Core Backend.
//   - Strict runtime validation and boundary authz
//   - Preserves Core as source of truth for RLS and data policy
//   - Self-service + org-visible reads for HF
// Changes (v1.1):
//   - Uses shared gateway request-context builder
//   - Requires pass-through auth for HF -> Core user-bound calls
//   - Adds 409 conflict mapping
// ============================================================================

import type { FastifyRequest } from "fastify";
import { CoreClientError } from "../core/coreClient.js";
import { makeCoreUsers, UsersClientError } from "../core/usersClient.js";
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

export type UserServiceOpts = Readonly<{
  core: CoreClient;
  maxMetadataBytes?: number;
}>;

export class UserServiceError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, opts: { statusCode: number; code: string }) {
    super(message);
    this.name = "UserServiceError";
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
  throw new UserServiceError("unauthorized", { statusCode: 401, code: "AUTH_REQUIRED" });
}

function requireTenantAdminOrSystem(actor: Actor | null | undefined) {
  if (isSystemAdmin(actor) || isTenantAdmin(actor)) return;
  throw new UserServiceError("forbidden", { statusCode: 403, code: "TENANT_ADMIN_REQUIRED" });
}

function requireSelfOrTenantAdminOrSystem(actor: Actor | null | undefined, userId: string) {
  const actorUserId = asString(actor?.user_id);
  if (actorUserId && actorUserId === userId) return;
  if (isSystemAdmin(actor) || isTenantAdmin(actor)) return;
  throw new UserServiceError("forbidden", { statusCode: 403, code: "SELF_OR_TENANT_ADMIN_REQUIRED" });
}

function normalizeNameOrUndefined(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  const s = String(v ?? "").trim();
  if (s.length < 3 || s.length > 150) {
    throw new UserServiceError("invalid_name", { statusCode: 400, code: "INVALID_NAME" });
  }
  return s;
}

function normalizeSlugOrUndefined(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) {
    throw new UserServiceError("invalid_slug", { statusCode: 400, code: "INVALID_SLUG" });
  }
  if (!/^[a-z0-9][a-z0-9-]{0,98}$/.test(s)) {
    throw new UserServiceError("invalid_slug", { statusCode: 400, code: "INVALID_SLUG" });
  }
  return s;
}

function sanitizeMetadataOrUndefined(v: unknown, maxBytes: number): Record<string, unknown> | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!isPlainObject(v)) {
    throw new UserServiceError("invalid_metadata", { statusCode: 400, code: "INVALID_METADATA" });
  }
  for (const k of Object.keys(v)) {
    if (k === "__proto__" || k === "prototype" || k === "constructor") {
      throw new UserServiceError("invalid_metadata", { statusCode: 400, code: "INVALID_METADATA" });
    }
  }
  if (bytesOfJson(v) > maxBytes) {
    throw new UserServiceError("metadata_too_large", { statusCode: 400, code: "METADATA_TOO_LARGE" });
  }
  return v;
}

function redactUser(v: unknown): unknown {
  if (!isPlainObject(v)) return v;
  const out: Record<string, unknown> = { ...v };
  delete out.password;
  delete out.password_hash;
  delete out.hash;
  return out;
}

function redactUsersPage(v: unknown): unknown {
  if (!isPlainObject(v)) return v;
  const out: Record<string, unknown> = { ...v };

  if (Array.isArray(out.items)) {
    out.items = out.items.map(redactUser);
  }

  if (Array.isArray(out.rows)) {
    out.rows = out.rows.map(redactUser);
  }

  return out;
}

export class UserService {
  private users: ReturnType<typeof makeCoreUsers>;
  private maxMetadataBytes: number;

  constructor(opts: UserServiceOpts) {
    if (!opts?.core) throw new Error("UserService requires core client");
    this.users = makeCoreUsers(opts.core);
    this.maxMetadataBytes = Math.max(1024, Math.min(Number(opts.maxMetadataBytes ?? 16 * 1024), 256 * 1024));
  }

  async getMe(actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    try {
      const out = await this.users.getMe(ctx, { maxRetries: 1 });
      return redactUser(out);
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async patchMe(input: Record<string, unknown>, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    if (!isPlainObject(input)) {
      throw new UserServiceError("invalid_body", { statusCode: 400, code: "INVALID_BODY" });
    }

    const payload: Record<string, unknown> = {};

    if (input.name !== undefined) payload.name = normalizeNameOrUndefined(input.name);
    if (input.slug !== undefined) payload.slug = normalizeSlugOrUndefined(input.slug);
    if (input.metadata !== undefined) payload.metadata = sanitizeMetadataOrUndefined(input.metadata, this.maxMetadataBytes);

    const allowed = new Set(["name", "slug", "metadata"]);
    for (const k of Object.keys(input)) {
      if (!allowed.has(k)) {
        throw new UserServiceError("invalid_request", { statusCode: 400, code: "INVALID_REQUEST" });
      }
    }

    if (Object.keys(payload).length === 0) {
      throw new UserServiceError("empty_patch", { statusCode: 400, code: "EMPTY_PATCH" });
    }

    try {
      const out = await this.users.patchMe(payload, ctx);
      return redactUser(out);
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async listOrgUsers(q: Record<string, unknown>, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);
    requireTenantAdminOrSystem(actor);

    try {
      const out = await this.users.listOrgUsers(q, ctx, { maxRetries: 1 });
      return redactUsersPage(out);
    } catch (e) {
      throw this.#mapCoreError(e);
    }
  }

  async getUserById(userId: unknown, actor: Actor, ctx?: CoreRequestCtx) {
    requireActor(actor);

    const id = String(userId ?? "").trim();
    if (!isUuid(id)) {
      throw new UserServiceError("invalid_user_id", { statusCode: 400, code: "INVALID_USER_ID" });
    }

    requireSelfOrTenantAdminOrSystem(actor, id);

    try {
      const out = await this.users.getUserById(id, ctx, { maxRetries: 1 });
      return redactUser(out);
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
    if (err instanceof UserServiceError) return err;

    if (err instanceof UsersClientError) {
      return new UserServiceError(err.message || "upstream_error", {
        statusCode: err.statusCode,
        code: err.code,
      });
    }

    if (err instanceof CoreClientError) {
      const status = err.status;
      const code = err.code || null;

      if (status === 400) return new UserServiceError("bad_request", { statusCode: 400, code: code ?? "BAD_REQUEST" });
      if (status === 401) return new UserServiceError("unauthorized", { statusCode: 401, code: code ?? "AUTH_REQUIRED" });
      if (status === 403) return new UserServiceError("forbidden", { statusCode: 403, code: code ?? "FORBIDDEN" });
      if (status === 404) return new UserServiceError("not_found", { statusCode: 404, code: code ?? "NOT_FOUND" });
      if (status === 409) return new UserServiceError("conflict", { statusCode: 409, code: code ?? "CONFLICT" });
      return new UserServiceError("upstream_error", { statusCode: 502, code: code ?? "UPSTREAM_ERROR" });
    }

    return new UserServiceError("internal_error", { statusCode: 500, code: "INTERNAL_ERROR" });
  }
}

export default UserService;