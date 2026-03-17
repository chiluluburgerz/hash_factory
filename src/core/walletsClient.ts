// ============================================================================
// File: src/core/walletsClient.ts
// Version: 1.0-hash-factory-wallets-client | 2026-03-12
// Purpose:
//   Hash Factory -> Core "Wallets" client.
//   - Default auth: service key via CoreClient
//   - Optional pass-through auth via CoreRequestCtx
//   - Strict input normalization for wallet routes
// Notes:
//   - Thin proxy only. Core remains source of truth for wallet semantics,
//     ownership, RLS, and entitlement enforcement.
// ============================================================================

import { CoreClient, CoreClientError, CoreRequestCtx } from "./coreClient.js";

type JsonObject = Record<string, unknown>;

type WalletCreateResult = Readonly<{
  wallet: JsonObject | null;
  created: boolean;
}>;

export class WalletsClientError extends Error {
  statusCode: number;
  code: string;
  detail?: unknown;
  requestId?: string | null;

  constructor(
    message: string,
    opts: { statusCode: number; code: string; detail?: unknown; requestId?: string | null }
  ) {
    super(message);
    this.name = "WalletsClientError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.detail = opts.detail;
    this.requestId = opts.requestId ?? null;
  }
}

export type WalletsClient = Readonly<{
  listMine: (ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<unknown[]>;
  getMyPrimary: (ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject | null>;
  getById: (walletId: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject | null>;
  createMyWallet: (body: Record<string, unknown>, ctx?: CoreRequestCtx) => Promise<WalletCreateResult>;
  setMyPrimary: (walletId: unknown, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  retireMyWallet: (walletId: unknown, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  getBalanceRow: (walletId: unknown, tokenId: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject | null>;
  getAvailable: (walletId: unknown, tokenId: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<unknown>;

  adminCreateWallet: (body: Record<string, unknown>, ctx?: CoreRequestCtx) => Promise<WalletCreateResult>;
  adminBalanceOp: (body: Record<string, unknown>, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  adminTransfer: (body: Record<string, unknown>, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  adminReconcile: (body: Record<string, unknown>, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  adminListUserWallets: (userId: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<unknown[]>;
  adminGetUserPrimary: (userId: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject | null>;
}>;

function isUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizeUuid(v: unknown, message: string, code: string): string {
  const s = String(v ?? "").trim();
  if (!isUuid(s)) {
    throw new WalletsClientError(message, { statusCode: 400, code });
  }
  return s;
}

function normalizeWalletAddress(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(s)) {
    throw new WalletsClientError("invalid_wallet_address", {
      statusCode: 400,
      code: "INVALID_WALLET",
    });
  }
  return s;
}

function normalizeTokenId(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(s)) {
    throw new WalletsClientError("invalid_token_id", {
      statusCode: 400,
      code: "INVALID_TOKEN_ID",
    });
  }
  return s;
}

function normalizeIdempotencyKey(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(s)) {
    throw new WalletsClientError("invalid_idempotency_key", {
      statusCode: 400,
      code: "INVALID_IDEMPOTENCY_KEY",
    });
  }
  return s;
}

function withBodyIdempotency(
  ctx: CoreRequestCtx | undefined,
  body: Record<string, unknown>
): CoreRequestCtx | undefined {
  const idem = normalizeIdempotencyKey(body.idempotency_key);
  if (!idem) return ctx;
  return {
    ...(ctx ?? {}),
    idempotencyKey: ctx?.idempotencyKey ?? idem,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function unwrapWallet(res: unknown): JsonObject | null {
  const out = (res as any)?.wallet ?? (res as any)?.result ?? res;
  return out && typeof out === "object" && !Array.isArray(out) ? (out as JsonObject) : null;
}

function unwrapWalletCreate(res: unknown): WalletCreateResult {
  const wallet = unwrapWallet(res);
  return {
    wallet,
    created: Boolean((res as any)?.created),
  };
}

function unwrapWallets(res: unknown): unknown[] {
  const out = (res as any)?.wallets ?? (res as any)?.items ?? (res as any)?.result ?? res;
  return Array.isArray(out) ? out : [];
}

function unwrapBalance(res: unknown): JsonObject | null {
  const out = (res as any)?.balance ?? (res as any)?.result ?? res;
  return out && typeof out === "object" && !Array.isArray(out) ? (out as JsonObject) : null;
}

function unwrapValue(res: unknown): unknown {
  return (res as any)?.available ?? (res as any)?.result ?? res;
}

function mapCoreError(err: unknown): Error {
  if (err instanceof WalletsClientError) return err;

  if (err instanceof CoreClientError) {
    const status = err.status;
    const code = err.code || null;
    const detail = (err as any).detail;
    const requestId = err.requestId ?? null;

    if (status === 400) {
      return new WalletsClientError("bad_request", { statusCode: 400, code: code ?? "BAD_REQUEST", detail, requestId });
    }
    if (status === 401) {
      return new WalletsClientError("unauthorized", { statusCode: 401, code: code ?? "AUTH_REQUIRED", detail, requestId });
    }
    if (status === 403) {
      return new WalletsClientError("forbidden", { statusCode: 403, code: code ?? "FORBIDDEN", detail, requestId });
    }
    if (status === 404) {
      return new WalletsClientError("not_found", { statusCode: 404, code: code ?? "NOT_FOUND", detail, requestId });
    }
    if (status === 409) {
      return new WalletsClientError("conflict", { statusCode: 409, code: code ?? "CONFLICT", detail, requestId });
    }

    return new WalletsClientError("upstream_error", {
      statusCode: 502,
      code: code ?? "UPSTREAM_ERROR",
      detail,
      requestId,
    });
  }

  return new WalletsClientError("internal_error", {
    statusCode: 500,
    code: "INTERNAL_ERROR",
  });
}

function sanitizeMetadata(v: unknown): Record<string, unknown> | undefined {
  if (v === undefined) return undefined;
  if (!isPlainObject(v)) {
    throw new WalletsClientError("invalid_metadata", {
      statusCode: 400,
      code: "INVALID_METADATA",
    });
  }
  for (const k of Object.keys(v)) {
    if (k === "__proto__" || k === "prototype" || k === "constructor") {
      throw new WalletsClientError("invalid_metadata", {
        statusCode: 400,
        code: "INVALID_METADATA",
      });
    }
  }
  return v;
}

function normalizeCreateMyWalletBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(body)) {
    throw new WalletsClientError("invalid_body", { statusCode: 400, code: "INVALID_BODY" });
  }

  const out: Record<string, unknown> = {};

  if (body.make_primary !== undefined) out.make_primary = Boolean(body.make_primary);

  const metadata = sanitizeMetadata(body.metadata);
  if (metadata !== undefined) out.metadata = metadata;

  const allowed = new Set(["make_primary", "metadata"]);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) {
      throw new WalletsClientError("invalid_request", { statusCode: 400, code: "INVALID_REQUEST" });
    }
  }

  return out;
}

function normalizeAdminCreateWalletBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(body)) {
    throw new WalletsClientError("invalid_body", { statusCode: 400, code: "INVALID_BODY" });
  }

  const out: Record<string, unknown> = {
    user_id: normalizeUuid(body.user_id, "invalid_user_id", "INVALID_USER_ID"),
  };

  if (body.wallet_address !== undefined) {
    out.wallet_address = normalizeWalletAddress(body.wallet_address);
  }

  if (body.make_primary !== undefined) out.make_primary = Boolean(body.make_primary);

  const metadata = sanitizeMetadata(body.metadata);
  if (metadata !== undefined) out.metadata = metadata;

  const allowed = new Set(["user_id", "wallet_address", "make_primary", "metadata"]);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) {
      throw new WalletsClientError("invalid_request", { statusCode: 400, code: "INVALID_REQUEST" });
    }
  }

  return out;
}

function normalizeBalanceOpBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(body)) {
    throw new WalletsClientError("invalid_body", { statusCode: 400, code: "INVALID_BODY" });
  }

  const op = String(body.op ?? "").trim();
  if (!["credit", "debit", "reserve", "commit", "release"].includes(op)) {
    throw new WalletsClientError("invalid_op", { statusCode: 400, code: "INVALID_OP" });
  }

  const out: Record<string, unknown> = {
    op,
    wallet_id: normalizeUuid(body.wallet_id, "invalid_wallet_id", "INVALID_WALLET_ID"),
    token_id: normalizeTokenId(body.token_id),
    amount: body.amount,
  };

  if (body.source_type !== undefined) out.source_type = String(body.source_type ?? "").trim();
  if (body.source_ref !== undefined) out.source_ref = sanitizeMetadata(body.source_ref);
  const idem = normalizeIdempotencyKey(body.idempotency_key);
  if (idem === undefined) {
    throw new WalletsClientError("idempotency_key_required", {
      statusCode: 400,
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
  }
  out.idempotency_key = idem;

  const allowed = new Set(["op", "wallet_id", "token_id", "amount", "source_type", "source_ref", "idempotency_key"]);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) {
      throw new WalletsClientError("invalid_request", { statusCode: 400, code: "INVALID_REQUEST" });
    }
  }

  return out;
}

function normalizeTransferBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(body)) {
    throw new WalletsClientError("invalid_body", { statusCode: 400, code: "INVALID_BODY" });
  }

  const out: Record<string, unknown> = {
    from_wallet_id: normalizeUuid(body.from_wallet_id, "invalid_wallet_id", "INVALID_WALLET_ID"),
    to_wallet_id: normalizeUuid(body.to_wallet_id, "invalid_wallet_id", "INVALID_WALLET_ID"),
    token_id: normalizeTokenId(body.token_id),
    amount: body.amount,
  };

  if (body.source_ref !== undefined) out.source_ref = sanitizeMetadata(body.source_ref);
  const idem = normalizeIdempotencyKey(body.idempotency_key);
  if (idem === undefined) {
    throw new WalletsClientError("idempotency_key_required", {
      statusCode: 400,
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
  }
  out.idempotency_key = idem;

  const allowed = new Set(["from_wallet_id", "to_wallet_id", "token_id", "amount", "source_ref", "idempotency_key"]);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) {
      throw new WalletsClientError("invalid_request", { statusCode: 400, code: "INVALID_REQUEST" });
    }
  }

  return out;
}

function normalizeReconcileBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(body)) {
    throw new WalletsClientError("invalid_body", { statusCode: 400, code: "INVALID_BODY" });
  }

  const out: Record<string, unknown> = {
    wallet_id: normalizeUuid(body.wallet_id, "invalid_wallet_id", "INVALID_WALLET_ID"),
    token_id: normalizeTokenId(body.token_id),
    newBalance: body.newBalance,
  };

  if (body.source_type !== undefined) out.source_type = String(body.source_type ?? "").trim();
  if (body.source_ref !== undefined) out.source_ref = sanitizeMetadata(body.source_ref);
  const idem = normalizeIdempotencyKey(body.idempotency_key);
  if (idem === undefined) {
    throw new WalletsClientError("idempotency_key_required", {
      statusCode: 400,
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
  }
  out.idempotency_key = idem;

  const allowed = new Set(["wallet_id", "token_id", "newBalance", "source_type", "source_ref", "idempotency_key"]);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) {
      throw new WalletsClientError("invalid_request", { statusCode: 400, code: "INVALID_REQUEST" });
    }
  }

  return out;
}

export function makeCoreWallets(core: CoreClient): WalletsClient {
  if (!core) throw new Error("makeCoreWallets requires core client");

  async function listMine(ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const res = await core.get<any>("/wallets/me", ctx, retry ?? undefined);
      return unwrapWallets(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getMyPrimary(ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const res = await core.get<any>("/wallets/me/primary", ctx, retry ?? undefined);
      return unwrapWallet(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getById(walletId: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const id = normalizeUuid(walletId, "invalid_wallet_id", "INVALID_WALLET_ID");
      const res = await core.get<any>(`/wallets/${encodeURIComponent(id)}`, ctx, retry ?? undefined);
      return unwrapWallet(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function createMyWallet(body: Record<string, unknown>, ctx?: CoreRequestCtx) {
    try {
      const payload = normalizeCreateMyWalletBody(body);
      const res = await core.post<any>("/wallets/me", payload, ctx, { maxRetries: 0 });
      return unwrapWalletCreate(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function setMyPrimary(walletId: unknown, ctx?: CoreRequestCtx) {
    try {
      const id = normalizeUuid(walletId, "invalid_wallet_id", "INVALID_WALLET_ID");
      const res = await core.post<any>(`/wallets/${encodeURIComponent(id)}/primary`, {}, ctx, { maxRetries: 0 });
      return unwrapWallet(res) ?? {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function retireMyWallet(walletId: unknown, ctx?: CoreRequestCtx) {
    try {
      const id = normalizeUuid(walletId, "invalid_wallet_id", "INVALID_WALLET_ID");
      const res = await core.delete<any>(`/wallets/${encodeURIComponent(id)}`, ctx, { maxRetries: 0 });
      return unwrapWallet(res) ?? {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getBalanceRow(walletId: unknown, tokenId: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const wid = normalizeUuid(walletId, "invalid_wallet_id", "INVALID_WALLET_ID");
      const tid = normalizeTokenId(tokenId);
      const res = await core.get<any>(`/wallets/${encodeURIComponent(wid)}/balances/${encodeURIComponent(tid)}`, ctx, retry ?? undefined);
      return unwrapBalance(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getAvailable(walletId: unknown, tokenId: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const wid = normalizeUuid(walletId, "invalid_wallet_id", "INVALID_WALLET_ID");
      const tid = normalizeTokenId(tokenId);
      const res = await core.get<any>(`/wallets/${encodeURIComponent(wid)}/available/${encodeURIComponent(tid)}`, ctx, retry ?? undefined);
      return unwrapValue(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function adminCreateWallet(body: Record<string, unknown>, ctx?: CoreRequestCtx) {
    try {
      const payload = normalizeAdminCreateWalletBody(body);
      const res = await core.post<any>("/admin/wallets", payload, ctx, { maxRetries: 0 });
      return unwrapWalletCreate(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function adminBalanceOp(body: Record<string, unknown>, ctx?: CoreRequestCtx) {
    try {
      const payload = normalizeBalanceOpBody(body);
      const reqCtx = withBodyIdempotency(ctx, payload);
      const res = await core.post<any>("/admin/wallets/balance-ops", payload, reqCtx, { maxRetries: 1 });
      return ((res as any)?.result ?? res ?? {}) as JsonObject;
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function adminTransfer(body: Record<string, unknown>, ctx?: CoreRequestCtx) {
    try {
      const payload = normalizeTransferBody(body);
      const reqCtx = withBodyIdempotency(ctx, payload);
      const res = await core.post<any>("/admin/wallets/transfers", payload, reqCtx, { maxRetries: 1 });
      return ((res as any)?.result ?? res ?? {}) as JsonObject;
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function adminReconcile(body: Record<string, unknown>, ctx?: CoreRequestCtx) {
    try {
      const payload = normalizeReconcileBody(body);
      const reqCtx = withBodyIdempotency(ctx, payload);
      const res = await core.post<any>("/admin/wallets/reconcile", payload, reqCtx, { maxRetries: 1 });
      return ((res as any)?.result ?? res ?? {}) as JsonObject;
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function adminListUserWallets(userId: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const id = normalizeUuid(userId, "invalid_user_id", "INVALID_USER_ID");
      const res = await core.get<any>(`/admin/users/${encodeURIComponent(id)}/wallets`, ctx, retry ?? undefined);
      return unwrapWallets(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function adminGetUserPrimary(userId: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const id = normalizeUuid(userId, "invalid_user_id", "INVALID_USER_ID");
      const res = await core.get<any>(`/admin/users/${encodeURIComponent(id)}/wallets/primary`, ctx, retry ?? undefined);
      return unwrapWallet(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  return {
    listMine,
    getMyPrimary,
    getById,
    createMyWallet,
    setMyPrimary,
    retireMyWallet,
    getBalanceRow,
    getAvailable,
    adminCreateWallet,
    adminBalanceOp,
    adminTransfer,
    adminReconcile,
    adminListUserWallets,
    adminGetUserPrimary,
  };
}

export default makeCoreWallets;