// ============================================================================
// File: src/core/usersClient.ts
// Version: 1.0-hash-factory-users-client | 2026-03-11
// Purpose:
//   Hash Factory -> Core "Users" client.
//   - Default auth: service key via CoreClient
//   - Optional per-request auth override via CoreRequestCtx for pass-through
//   - Strict input normalization for UUIDs, limits, offsets, and self patch body
// ============================================================================

import { CoreClient, CoreClientError, CoreRequestCtx } from "./coreClient.js";

export class UsersClientError extends Error {
  statusCode: number;
  code: string;
  detail?: unknown;
  requestId?: string | null;

  constructor(
    message: string,
    opts: { statusCode: number; code: string; detail?: unknown; requestId?: string | null }
  ) {
    super(message);
    this.name = "UsersClientError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.detail = opts.detail;
    this.requestId = opts.requestId ?? null;
  }
}

type JsonObject = Record<string, unknown>;

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

function clampInt(v: unknown, min: number, max: number, d: number): number {
  const n = Number(v);
  const val = Number.isFinite(n) ? Math.trunc(n) : d;
  return Math.max(min, Math.min(max, val));
}

function normalizeUuid(v: unknown, message: string, code: string): string {
  const s = String(v ?? "").trim();
  if (!isUuid(s)) {
    throw new UsersClientError(message, { statusCode: 400, code });
  }
  return s;
}

function normalizeSlugOrNull(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z0-9][a-z0-9-]{0,98}$/.test(s)) {
    throw new UsersClientError("invalid_slug", { statusCode: 400, code: "INVALID_SLUG" });
  }
  return s;
}

function normalizeWalletOrNull(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(s)) {
    throw new UsersClientError("invalid_wallet_address", { statusCode: 400, code: "INVALID_WALLET" });
  }
  return s.toLowerCase();
}

function unwrapResult(res: unknown): unknown {
  return (res as any)?.result ?? res;
}

function buildQueryString(q: Record<string, string | number | boolean | null | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === null || v === undefined) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

function mapCoreError(err: unknown): Error {
  if (err instanceof UsersClientError) return err;

  if (err instanceof CoreClientError) {
    const status = err.status;
    const code = err.code || null;
    const detail = (err as any).detail;
    const requestId = err.requestId ?? null;

    if (status === 400) {
      return new UsersClientError("bad_request", {
        statusCode: 400,
        code: code ?? "BAD_REQUEST",
        detail,
        requestId,
      });
    }
    if (status === 401) {
      return new UsersClientError("unauthorized", {
        statusCode: 401,
        code: code ?? "AUTH_REQUIRED",
        detail,
        requestId,
      });
    }
    if (status === 403) {
      return new UsersClientError("forbidden", {
        statusCode: 403,
        code: code ?? "FORBIDDEN",
        detail,
        requestId,
      });
    }
    if (status === 404) {
      return new UsersClientError("not_found", {
        statusCode: 404,
        code: code ?? "NOT_FOUND",
        detail,
        requestId,
      });
    }
    if (status === 409) {
      return new UsersClientError("conflict", {
        statusCode: 409,
        code: code ?? "CONFLICT",
        detail,
        requestId,
      });
    }

    return new UsersClientError("upstream_error", {
      statusCode: 502,
      code: code ?? "UPSTREAM_ERROR",
      detail,
      requestId,
    });
  }

  return new UsersClientError("internal_error", { statusCode: 500, code: "INTERNAL_ERROR" });
}

export type ListOrgUsersQuery = Readonly<{
  limit?: unknown;
  offset?: unknown;
  includeDeleted?: unknown;
}>;

export type PatchMeInput = Readonly<{
  name?: unknown;
  slug?: unknown;
  wallet_address?: unknown;
  metadata?: unknown;
}>;

export type UsersClient = Readonly<{
  getMe: (ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  patchMe: (body: PatchMeInput, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  listOrgUsers: (q?: ListOrgUsersQuery | null, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  getUserById: (userId: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
}>;

export function makeCoreUsers(core: CoreClient): UsersClient {
  if (!core) throw new Error("makeCoreUsers requires core client");

  async function getMe(ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const res = await core.get<any>("/v1/users/me", ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function patchMe(body: PatchMeInput, ctx?: CoreRequestCtx) {
    try {
      if (!isPlainObject(body)) {
        throw new UsersClientError("invalid_body", { statusCode: 400, code: "INVALID_BODY" });
      }

      const payload: JsonObject = {};
      if (body.name !== undefined) payload.name = String(body.name ?? "").trim();
      if (body.slug !== undefined) payload.slug = normalizeSlugOrNull(body.slug);
      if (body.wallet_address !== undefined) payload.wallet_address = normalizeWalletOrNull(body.wallet_address);
      if (body.metadata !== undefined) {
        if (body.metadata !== null && !isPlainObject(body.metadata)) {
          throw new UsersClientError("invalid_metadata", { statusCode: 400, code: "INVALID_METADATA" });
        }
        payload.metadata = body.metadata as any;
      }

      if (Object.keys(payload).length === 0) {
        throw new UsersClientError("empty_patch", { statusCode: 400, code: "EMPTY_PATCH" });
      }

      const res = await core.patch<any>("/v1/users/me", payload, ctx, { maxRetries: 0 });
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function listOrgUsers(q?: ListOrgUsersQuery | null, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const limit = clampInt(q?.limit, 1, 1000, 50);
      const offset = clampInt(q?.offset, 0, 10_000_000, 0);

      let includeDeleted: boolean | undefined;
      if (q?.includeDeleted !== undefined && q?.includeDeleted !== null && q?.includeDeleted !== "") {
        if (q.includeDeleted === true || q.includeDeleted === "true") includeDeleted = true;
        else if (q.includeDeleted === false || q.includeDeleted === "false") includeDeleted = false;
        else throw new UsersClientError("invalid_include_deleted", { statusCode: 400, code: "INVALID_INCLUDE_DELETED" });
      }

      const qs = buildQueryString({
        limit,
        offset,
        includeDeleted,
      });

      const res = await core.get<any>(`/v1/users/org${qs}`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getUserById(userId: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const id = normalizeUuid(userId, "invalid_user_id", "INVALID_USER_ID");
      const res = await core.get<any>(`/v1/users/${encodeURIComponent(id)}`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  return {
    getMe,
    patchMe,
    listOrgUsers,
    getUserById,
  };
}

export default makeCoreUsers;