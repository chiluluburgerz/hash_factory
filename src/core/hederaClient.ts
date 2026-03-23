// ============================================================================
// File: src/core/hederaClient.ts
// Version: 1.1-hash-factory-hedera-client-expanded-read-surface | 2026-03-17
// Purpose:
//   Hash Factory -> Core "Hedera" client.
//   - Default auth: service key via CoreClient
//   - Optional pass-through auth via CoreRequestCtx
//   - Strict input normalization for Hedera read/admin routes
// Notes:
//   - Thin proxy only. Core remains source of truth for auth, RLS, topic
//     visibility, topic membership semantics, and Hedera policy enforcement.
//   - HF intentionally exposes add-user-to-topic on an admin-prefixed route,
//     but the Core upstream route remains /v1/hedera/topics/:topicName/users.
// ============================================================================

import { CoreClient, CoreClientError, type CoreRequestCtx } from "./coreClient.js";

type JsonObject = Record<string, unknown>;

export type HederaOverviewResult = Readonly<{
  summary: Readonly<{
    visible_topics: number;
    hcs_total: number;
    hcs_mirror_verified: number;
    hts_total: number;
    hts_mirror_verified: number;
  }>;
  recent: Readonly<{
    topics: unknown[];
    hcs: unknown[];
    hts: unknown[];
  }>;
}>;

export type HederaTopicDetailResult = Readonly<Record<string, unknown>>;
export type HederaDetailResult = Readonly<Record<string, unknown>>;

export type TopicMessagesResult = Readonly<{
  topic_name: string;
  count: number;
  messages: unknown[];
  limit: number;
  offset: number;
}>;

export type HederaListResult = Readonly<{
  rows: unknown[];
  total: number;
  limit: number;
  offset: number;
}>;

type AddUserToTopicResult = Readonly<{
  ok: boolean;
  topic_name: string;
  user_id: string;
  result: JsonObject | null;
}>;

type ListTopicUsersResult = Readonly<{
  topic: JsonObject | null;
  rows: unknown[];
  total: number;
  limit: number;
  offset: number;
}>;

type RemoveUserFromTopicResult = Readonly<{
  ok: boolean;
  topic_name: string;
  user_id: string;
  revoked: boolean;
  result: JsonObject | null;
}>;

export type HederaDecryptVerifyInput = Readonly<{
  message_id?: string;
  transaction_id?: string;
  mode?: "verify_only" | "decrypt_only" | "decrypt_and_verify";
  include_decrypted?: boolean;
}>;

export type HederaDecryptVerifyResult = Readonly<Record<string, unknown>>;

export type HederaVerifyJobResult = Readonly<Record<string, unknown>>;

export class HederaClientError extends Error {
  statusCode: number;
  code: string;
  detail?: unknown;
  requestId?: string | null;

  constructor(
    message: string,
    opts: { statusCode: number; code: string; detail?: unknown; requestId?: string | null }
  ) {
    super(message);
    this.name = "HederaClientError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.detail = opts.detail;
    this.requestId = opts.requestId ?? null;
  }
}

export type HederaClient = Readonly<{
  getOverview: (
    opts?: { recentLimit?: unknown },
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<HederaOverviewResult>;

  listTopics: (
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<unknown[]>;

  getTopicByName: (
    topicName: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<HederaTopicDetailResult>;

  getTopicMessages: (
    topicName: unknown,
    opts?: { limit?: unknown; offset?: unknown },
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<TopicMessagesResult>;

  listHcsActivity: (
    opts?: {
      topic_name?: unknown;
      mirror_verified?: unknown;
      limit?: unknown;
      offset?: unknown;
    },
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<HederaListResult>;

  listHtsActivity: (
    opts?: {
      token_id?: unknown;
      type?: unknown;
      mirror_verified?: unknown;
      limit?: unknown;
      offset?: unknown;
    },
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<HederaListResult>;

  getHcsActivityByMessageId: (
    messageId: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<HederaDetailResult>;

  getHcsActivityByTransactionId: (
    transactionId: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<HederaDetailResult>;

  getHtsActivityByTransactionId: (
    transactionId: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<HederaDetailResult>;

  getTokenAssociation: (
    tokenId: unknown,
    accountId: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<JsonObject>;

  verifyNftOwnership: (
    tokenId: unknown,
    serial: unknown,
    expectedAccountId: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<JsonObject>;

  addUserToTopic: (
    topicName: unknown,
    body: Record<string, unknown>,
    ctx?: CoreRequestCtx
  ) => Promise<AddUserToTopicResult>;

  listTopicUsers: (
    topicName: unknown,
    opts?: {
      includeRevoked?: unknown;
      limit?: unknown;
      offset?: unknown;
      org_id?: unknown;
      scope?: unknown;
    },
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<ListTopicUsersResult>;

  removeUserFromTopic: (
    topicName: unknown,
    userId: unknown,
    opts?: {
      org_id?: unknown;
      scope?: unknown;
    },
    ctx?: CoreRequestCtx
  ) => Promise<RemoveUserFromTopicResult>;

  verifyAndMaybeDecrypt: (
    body: HederaDecryptVerifyInput,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<HederaDecryptVerifyResult>;

  enqueueVerifyJob: (
    body: Record<string, unknown>,
    ctx?: CoreRequestCtx
  ) => Promise<HederaVerifyJobResult>;

  getVerifyJob: (
    id: unknown,
    opts?: { with_tx?: unknown },
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ) => Promise<HederaVerifyJobResult>;
}>;

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

function normalizeTopicName(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,64}$/.test(s)) {
    throw new HederaClientError("invalid_topic_name", {
      statusCode: 400,
      code: "INVALID_TOPIC_NAME",
    });
  }
  return s;
}

function normalizeHederaId(v: unknown, code: string): string {
  const s = String(v ?? "").trim();
  if (!/^0\.0\.\d+$/.test(s)) {
    throw new HederaClientError(code.toLowerCase(), {
      statusCode: 400,
      code,
    });
  }
  return s;
}

function normalizePositiveInt(v: unknown, code: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new HederaClientError(code.toLowerCase(), {
      statusCode: 400,
      code,
    });
  }
  return n;
}

function normalizeLimit(v: unknown, fallback = 50): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 200) {
    throw new HederaClientError("invalid_limit", {
      statusCode: 400,
      code: "INVALID_LIMIT",
    });
  }
  return n;
}

function normalizeOffset(v: unknown, fallback = 0): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10_000) {
    throw new HederaClientError("invalid_offset", {
      statusCode: 400,
      code: "INVALID_OFFSET",
    });
  }
  return n;
}

function normalizeRecentLimit(v: unknown, fallback = 5): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 20) {
    throw new HederaClientError("invalid_recent_limit", {
      statusCode: 400,
      code: "INVALID_RECENT_LIMIT",
    });
  }
  return n;
}

function normalizeUuid(v: unknown, message: string, code: string): string {
  const s = String(v ?? "").trim();
  if (!isUuid(s)) {
    throw new HederaClientError(message, { statusCode: 400, code });
  }
  return s;
}

function normalizeTopicScope(v: unknown): "org" | "shared" | "global" | undefined {
  if (v == null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === "org" || s === "shared" || s === "global") return s;
  throw new HederaClientError("invalid_scope", {
    statusCode: 400,
    code: "INVALID_SCOPE",
  });
}

function normalizeBoolish(v: unknown): boolean | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "boolean") return v;

  const s = String(v).trim().toLowerCase();
  if (["true", "1"].includes(s)) return true;
  if (["false", "0"].includes(s)) return false;

  throw new HederaClientError("invalid_boolean", {
    statusCode: 400,
    code: "INVALID_BOOLEAN",
  });
}

function normalizeHtsType(v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  if (["create", "mint", "burn", "transfer", "associate"].includes(s)) return s;
  throw new HederaClientError("invalid_type", {
    statusCode: 400,
    code: "INVALID_TYPE",
  });
}

function normalizeTextId(v: unknown, message: string, code: string): string {
  const s = String(v ?? "").trim();
  if (!s || s.length > 256 || /[\u0000-\u001f\u007f]/.test(s)) {
    throw new HederaClientError(message, {
      statusCode: 400,
      code,
    });
  }
  return s;
}

function normalizeDecryptMode(
  v: unknown
): "verify_only" | "decrypt_only" | "decrypt_and_verify" | undefined {
  if (v == null || v === "") return undefined;
  const s = String(v).trim();
  if (s === "verify_only" || s === "decrypt_only" || s === "decrypt_and_verify") {
    return s;
  }
  throw new HederaClientError("invalid_mode", {
    statusCode: 400,
    code: "INVALID_MODE",
  });
}

function normalizeDecryptVerifyBody(body: Record<string, unknown>): HederaDecryptVerifyInput {
  if (!isPlainObject(body)) {
    throw new HederaClientError("invalid_body", {
      statusCode: 400,
      code: "INVALID_BODY",
    });
  }

  const message_id =
    body.message_id == null ? undefined : normalizeTextId(body.message_id, "invalid_message_id", "INVALID_MESSAGE_ID");

  const transaction_id =
    body.transaction_id == null
      ? undefined
      : normalizeTextId(body.transaction_id, "invalid_transaction_id", "INVALID_TRANSACTION_ID");

  const hasMessage = Boolean(message_id);
  const hasTransaction = Boolean(transaction_id);

  if (hasMessage === hasTransaction) {
    throw new HederaClientError("invalid_request", {
      statusCode: 400,
      code: "INVALID_REQUEST",
    });
  }

  const mode = normalizeDecryptMode(body.mode);
  const include_decrypted = normalizeBoolish(body.include_decrypted);

  const allowed = new Set(["message_id", "transaction_id", "mode", "include_decrypted"]);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) {
      throw new HederaClientError("invalid_request", {
        statusCode: 400,
        code: "INVALID_REQUEST",
      });
    }
  }

  return {
    ...(message_id ? { message_id } : {}),
    ...(transaction_id ? { transaction_id } : {}),
    ...(mode ? { mode } : {}),
    ...(include_decrypted !== undefined ? { include_decrypted } : {}),
  };
}

function normalizeVerifyJobBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(body)) {
    throw new HederaClientError("invalid_body", {
      statusCode: 400,
      code: "INVALID_BODY",
    });
  }

  const message_id =
    body.message_id == null ? undefined : normalizeTextId(body.message_id, "invalid_message_id", "INVALID_MESSAGE_ID");

  const transaction_id =
    body.transaction_id == null
      ? undefined
      : normalizeTextId(body.transaction_id, "invalid_transaction_id", "INVALID_TRANSACTION_ID");

  const hasMessage = Boolean(message_id);
  const hasTransaction = Boolean(transaction_id);

  if (hasMessage === hasTransaction) {
    throw new HederaClientError("invalid_request", {
      statusCode: 400,
      code: "INVALID_REQUEST",
    });
  }

  const idempotency_key = normalizeTextId(
    body.idempotency_key,
    "invalid_idempotency_key",
    "INVALID_IDEMPOTENCY_KEY"
  );

  const max_attempts =
    body.max_attempts == null || body.max_attempts === ""
      ? undefined
      : normalizePositiveInt(body.max_attempts, "INVALID_MAX_ATTEMPTS");

  return {
    ...(message_id ? { message_id } : {}),
    ...(transaction_id ? { transaction_id } : {}),
    idempotency_key,
    mode: "verify_only",
    ...(max_attempts !== undefined ? { max_attempts } : {}),
  };
}

function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function unwrapTopics(res: unknown): unknown[] {
  const out = (res as any)?.topics ?? (res as any)?.result?.topics ?? (res as any)?.result ?? res;
  return Array.isArray(out) ? out : [];
}

function unwrapOverview(res: unknown): HederaOverviewResult {
  const raw = ((res as any)?.result ?? res ?? {}) as any;
  return {
    summary: {
      visible_topics: Number(raw?.summary?.visible_topics ?? 0) || 0,
      hcs_total: Number(raw?.summary?.hcs_total ?? 0) || 0,
      hcs_mirror_verified: Number(raw?.summary?.hcs_mirror_verified ?? 0) || 0,
      hts_total: Number(raw?.summary?.hts_total ?? 0) || 0,
      hts_mirror_verified: Number(raw?.summary?.hts_mirror_verified ?? 0) || 0,
    },
    recent: {
      topics: Array.isArray(raw?.recent?.topics) ? raw.recent.topics : [],
      hcs: Array.isArray(raw?.recent?.hcs) ? raw.recent.hcs : [],
      hts: Array.isArray(raw?.recent?.hts) ? raw.recent.hts : [],
    },
  };
}

function unwrapTopicDetail(res: unknown): HederaTopicDetailResult {
  const raw = (res as any)?.result ?? res;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as HederaTopicDetailResult) : {};
}

function unwrapTopicMessages(res: unknown): TopicMessagesResult {
  const raw = ((res as any)?.result ?? res ?? null) as any;

  if (Array.isArray(raw)) {
    return {
      topic_name: "",
      count: raw.length,
      messages: raw,
      limit: raw.length,
      offset: 0,
    };
  }

  const messages =
    Array.isArray(raw?.messages) ? raw.messages :
    Array.isArray(raw?.rows) ? raw.rows :
    Array.isArray(raw?.items) ? raw.items :
    [];

  return {
    topic_name: String(raw?.topic_name ?? raw?.topicName ?? ""),
    count: Number(raw?.count ?? raw?.total ?? messages.length ?? 0) || 0,
    messages,
    limit: Number(raw?.limit ?? messages.length ?? 0) || 0,
    offset: Number(raw?.offset ?? 0) || 0,
  };
}

function unwrapListResult(res: unknown): HederaListResult {
  const raw = ((res as any)?.result ?? res ?? {}) as any;
  return {
    rows: Array.isArray(raw?.rows) ? raw.rows : [],
    total: Number(raw?.total ?? 0) || 0,
    limit: Number(raw?.limit ?? 0) || 0,
    offset: Number(raw?.offset ?? 0) || 0,
  };
}

function unwrapObject(res: unknown): JsonObject {
  const out = (res as any)?.result ?? res;
  return out && typeof out === "object" && !Array.isArray(out) ? (out as JsonObject) : {};
}

function unwrapAddUserToTopic(res: unknown): AddUserToTopicResult {
  const raw = ((res as any)?.result ?? res ?? {}) as any;
  return {
    ok: Boolean(raw?.ok),
    topic_name: String(raw?.topic_name ?? ""),
    user_id: String(raw?.user_id ?? ""),
    result:
      raw?.result && typeof raw.result === "object" && !Array.isArray(raw.result)
        ? raw.result
        : null,
  };
}

function unwrapListTopicUsers(res: unknown): ListTopicUsersResult {
  const raw = ((res as any)?.result ?? res ?? {}) as any;
  return {
    topic:
      raw?.topic && typeof raw.topic === "object" && !Array.isArray(raw.topic)
        ? raw.topic
        : null,
    rows: Array.isArray(raw?.rows) ? raw.rows : [],
    total: Number(raw?.total ?? 0) || 0,
    limit: Number(raw?.limit ?? 0) || 0,
    offset: Number(raw?.offset ?? 0) || 0,
  };
}

function unwrapRemoveUserFromTopic(res: unknown): RemoveUserFromTopicResult {
  const raw = ((res as any)?.result ?? res ?? {}) as any;
  return {
    ok: Boolean(raw?.ok),
    topic_name: String(raw?.topic_name ?? ""),
    user_id: String(raw?.user_id ?? ""),
    revoked: Boolean(raw?.revoked),
    result:
      raw?.result && typeof raw.result === "object" && !Array.isArray(raw.result)
        ? raw.result
        : null,
  };
}

function mapCoreError(err: unknown): Error {
  if (err instanceof HederaClientError) return err;

  if (err instanceof CoreClientError) {
    const status = err.status;
    const code = err.code || null;
    const detail = (err as any).detail;
    const requestId = err.requestId ?? null;

    if (status === 400) {
      return new HederaClientError("bad_request", {
        statusCode: 400,
        code: code ?? "BAD_REQUEST",
        detail,
        requestId,
      });
    }
    if (status === 401) {
      return new HederaClientError("unauthorized", {
        statusCode: 401,
        code: code ?? "AUTH_REQUIRED",
        detail,
        requestId,
      });
    }
    if (status === 403) {
      return new HederaClientError("forbidden", {
        statusCode: 403,
        code: code ?? "FORBIDDEN",
        detail,
        requestId,
      });
    }
    if (status === 404) {
      return new HederaClientError("not_found", {
        statusCode: 404,
        code: code ?? "NOT_FOUND",
        detail,
        requestId,
      });
    }
    if (status === 409) {
      return new HederaClientError("conflict", {
        statusCode: 409,
        code: code ?? "CONFLICT",
        detail,
        requestId,
      });
    }

    return new HederaClientError("upstream_error", {
      statusCode: 502,
      code: code ?? "UPSTREAM_ERROR",
      detail,
      requestId,
    });
  }

  return new HederaClientError("internal_error", {
    statusCode: 500,
    code: "INTERNAL_ERROR",
  });
}

function normalizeAddUserBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(body)) {
    throw new HederaClientError("invalid_body", {
      statusCode: 400,
      code: "INVALID_BODY",
    });
  }

  const out: Record<string, unknown> = {
    userId: normalizeUuid(body.userId, "invalid_user_id", "INVALID_USER_ID"),
  };

  if (body.org_id !== undefined) {
    out.org_id = normalizeUuid(body.org_id, "invalid_org_id", "INVALID_ORG_ID");
  }

  const scope = normalizeTopicScope(body.scope);
  if (scope !== undefined) out.scope = scope;

  const allowed = new Set(["userId", "org_id", "scope"]);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) {
      throw new HederaClientError("invalid_request", {
        statusCode: 400,
        code: "INVALID_REQUEST",
      });
    }
  }

  return out;
}

export function makeCoreHedera(core: CoreClient): HederaClient {
  if (!core) throw new Error("makeCoreHedera requires core client");

  async function getOverview(
    opts?: { recentLimit?: unknown },
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<HederaOverviewResult> {
    try {
      const recentLimit = normalizeRecentLimit(opts?.recentLimit, 5);
      const path = `/v1/hedera/overview${buildQuery({ recentLimit })}`;
      const res = await core.get<any>(path, ctx, retry ?? undefined);
      return unwrapOverview(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function listTopics(ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const res = await core.get<any>("/v1/hedera/topics", ctx, retry ?? undefined);
      return unwrapTopics(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getTopicByName(
    topicName: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<HederaTopicDetailResult> {
    try {
      const name = normalizeTopicName(topicName);
      const path = `/v1/hedera/topics/${encodeURIComponent(name)}`;
      const res = await core.get<any>(path, ctx, retry ?? undefined);
      return unwrapTopicDetail(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getTopicMessages(
    topicName: unknown,
    opts?: { limit?: unknown; offset?: unknown },
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<TopicMessagesResult> {
    try {
      const name = normalizeTopicName(topicName);
      const limit = normalizeLimit(opts?.limit, 50);
      const offset = normalizeOffset(opts?.offset, 0);

      const path =
        `/v1/hedera/topics/${encodeURIComponent(name)}/messages` +
        buildQuery({ limit, offset });

      const res = await core.get<any>(path, ctx, retry ?? undefined);
      return unwrapTopicMessages(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function listHcsActivity(
    opts?: {
      topic_name?: unknown;
      mirror_verified?: unknown;
      limit?: unknown;
      offset?: unknown;
    },
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<HederaListResult> {
    try {
      const topic_name = opts?.topic_name == null ? undefined : normalizeTopicName(opts.topic_name);
      const mirror_verified = normalizeBoolish(opts?.mirror_verified);
      const limit = normalizeLimit(opts?.limit, 50);
      const offset = normalizeOffset(opts?.offset, 0);

      const path =
        `/v1/hedera/hcs` +
        buildQuery({
          topic_name,
          mirror_verified,
          limit,
          offset,
        });

      const res = await core.get<any>(path, ctx, retry ?? undefined);
      return unwrapListResult(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function listHtsActivity(
    opts?: {
      token_id?: unknown;
      type?: unknown;
      mirror_verified?: unknown;
      limit?: unknown;
      offset?: unknown;
    },
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<HederaListResult> {
    try {
      const token_id = opts?.token_id == null ? undefined : normalizeHederaId(opts.token_id, "INVALID_TOKEN_ID");
      const type = normalizeHtsType(opts?.type);
      const mirror_verified = normalizeBoolish(opts?.mirror_verified);
      const limit = normalizeLimit(opts?.limit, 50);
      const offset = normalizeOffset(opts?.offset, 0);

      const path =
        `/v1/hedera/hts` +
        buildQuery({
          token_id,
          type,
          mirror_verified,
          limit,
          offset,
        });

      const res = await core.get<any>(path, ctx, retry ?? undefined);
      return unwrapListResult(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getHcsActivityByMessageId(
    messageId: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<HederaDetailResult> {
    try {
      const mid = normalizeTextId(messageId, "invalid_message_id", "INVALID_MESSAGE_ID");
      const path = `/v1/hedera/hcs/messages/${encodeURIComponent(mid)}`;
      const res = await core.get<any>(path, ctx, retry ?? undefined);
      return unwrapTopicDetail(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getHcsActivityByTransactionId(
    transactionId: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<HederaDetailResult> {
    try {
      const tid = normalizeTextId(transactionId, "invalid_transaction_id", "INVALID_TRANSACTION_ID");
      const path = `/v1/hedera/hcs/transactions/${encodeURIComponent(tid)}`;
      const res = await core.get<any>(path, ctx, retry ?? undefined);
      return unwrapTopicDetail(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getHtsActivityByTransactionId(
    transactionId: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<HederaDetailResult> {
    try {
      const tid = normalizeTextId(transactionId, "invalid_transaction_id", "INVALID_TRANSACTION_ID");
      const path = `/v1/hedera/hts/transactions/${encodeURIComponent(tid)}`;
      const res = await core.get<any>(path, ctx, retry ?? undefined);
      return unwrapTopicDetail(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getTokenAssociation(
    tokenId: unknown,
    accountId: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<JsonObject> {
    try {
      const tid = normalizeHederaId(tokenId, "INVALID_TOKEN_ID");
      const aid = normalizeHederaId(accountId, "INVALID_ACCOUNT_ID");
      const path =
        `/v1/hedera/tokens/${encodeURIComponent(tid)}` +
        `/associations/${encodeURIComponent(aid)}`;

      const res = await core.get<any>(path, ctx, retry ?? undefined);
      return unwrapObject(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function verifyNftOwnership(
    tokenId: unknown,
    serial: unknown,
    expectedAccountId: unknown,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<JsonObject> {
    try {
      const tid = normalizeHederaId(tokenId, "INVALID_TOKEN_ID");
      const s = normalizePositiveInt(serial, "INVALID_SERIAL");
      const aid = normalizeHederaId(expectedAccountId, "INVALID_ACCOUNT_ID");

      const path =
        `/v1/hedera/nfts/${encodeURIComponent(tid)}` +
        `/serials/${encodeURIComponent(String(s))}/ownership` +
        buildQuery({ expectedAccountId: aid });

      const res = await core.get<any>(path, ctx, retry ?? undefined);
      return unwrapObject(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function addUserToTopic(
    topicName: unknown,
    body: Record<string, unknown>,
    ctx?: CoreRequestCtx
  ): Promise<AddUserToTopicResult> {
    try {
      const name = normalizeTopicName(topicName);
      const payload = normalizeAddUserBody(body);

      const res = await core.post<any>(
        `/v1/hedera/topics/${encodeURIComponent(name)}/users`,
        payload,
        ctx,
        { maxRetries: 0 }
      );
      return unwrapAddUserToTopic(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function listTopicUsers(
    topicName: unknown,
    opts?: {
      includeRevoked?: unknown;
      limit?: unknown;
      offset?: unknown;
      org_id?: unknown;
      scope?: unknown;
    },
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<ListTopicUsersResult> {
    try {
      const name = normalizeTopicName(topicName);
      const includeRevoked = normalizeBoolish(opts?.includeRevoked);
      const limit = normalizeLimit(opts?.limit, 50);
      const offset = normalizeOffset(opts?.offset, 0);
      const org_id =
        opts?.org_id == null || opts?.org_id === ""
          ? undefined
          : normalizeUuid(opts.org_id, "invalid_org_id", "INVALID_ORG_ID");
      const scope = normalizeTopicScope(opts?.scope);

      const path =
        `/v1/hedera/topics/${encodeURIComponent(name)}/users` +
        buildQuery({
          includeRevoked,
          limit,
          offset,
          org_id,
          scope,
        });

      const res = await core.get<any>(path, ctx, retry ?? undefined);
      return unwrapListTopicUsers(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function removeUserFromTopic(
    topicName: unknown,
    userId: unknown,
    opts?: {
      org_id?: unknown;
      scope?: unknown;
    },
    ctx?: CoreRequestCtx
  ): Promise<RemoveUserFromTopicResult> {
    try {
      const name = normalizeTopicName(topicName);
      const uid = normalizeUuid(userId, "invalid_user_id", "INVALID_USER_ID");
      const org_id =
        opts?.org_id == null || opts?.org_id === ""
          ? undefined
          : normalizeUuid(opts.org_id, "invalid_org_id", "INVALID_ORG_ID");
      const scope = normalizeTopicScope(opts?.scope);

      const path =
        `/v1/hedera/topics/${encodeURIComponent(name)}` +
        `/users/${encodeURIComponent(uid)}` +
        buildQuery({ org_id, scope });

      const res = await core.delete<any>(path, ctx, { maxRetries: 0 });
      return unwrapRemoveUserFromTopic(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function verifyAndMaybeDecrypt(
    body: HederaDecryptVerifyInput,
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<HederaDecryptVerifyResult> {
    try {
      const payload = normalizeDecryptVerifyBody(body as Record<string, unknown>);
      const res = await core.post<any>(
        "/v1/hcs/verify-decrypt",
        payload,
        ctx,
        retry ?? { maxRetries: 0 }
      );
      return unwrapObject(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function enqueueVerifyJob(
    body: Record<string, unknown>,
    ctx?: CoreRequestCtx
  ): Promise<HederaVerifyJobResult> {
    try {
      const payload = normalizeVerifyJobBody(body);
      const res = await core.post<any>(
        "/v1/hcs/verify-jobs",
        payload,
        ctx,
        { maxRetries: 0 }
      );
      return unwrapObject(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getVerifyJob(
    id: unknown,
    opts?: { with_tx?: unknown },
    ctx?: CoreRequestCtx,
    retry?: { maxRetries?: number } | null
  ): Promise<HederaVerifyJobResult> {
    try {
      const jobId = normalizeUuid(id, "invalid_job_id", "INVALID_JOB_ID");
      const with_tx = normalizeBoolish(opts?.with_tx);
      const path =
        `/v1/hcs/verify-jobs/${encodeURIComponent(jobId)}` +
        buildQuery({ with_tx });

      const res = await core.get<any>(path, ctx, retry ?? undefined);
      return unwrapObject(res);
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  return {
    getOverview,
    listTopics,
    getTopicByName,
    getTopicMessages,
    listHcsActivity,
    listHtsActivity,
    getHcsActivityByMessageId,
    getHcsActivityByTransactionId,
    getHtsActivityByTransactionId,
    getTokenAssociation,
    verifyNftOwnership,
    listTopicUsers,
    addUserToTopic,
    removeUserFromTopic,
    verifyAndMaybeDecrypt,
    enqueueVerifyJob,
    getVerifyJob,
  };
}

export default makeCoreHedera;