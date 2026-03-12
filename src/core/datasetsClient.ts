// ============================================================================
// File: src/core/datasetsClient.ts
// Version: 1.0-hash-factory-datasets-client | 2026-03-04
// Purpose:
//   Hash Factory -> Core "Dataset Registry" client.
//   - Default auth: service key via CoreClient (CORE_SERVICE_API_KEY)
//   - Optional per-request auth override via CoreRequestCtx (coreAuthHeader/coreApiKey) for user pass-through
//   - Strict input normalization (dataset_key regex, UUIDs, pagination bounds)
//   - No retries by default; callers may opt-in for safe GETs
// ============================================================================

import { CoreClient, CoreClientError, CoreRequestCtx } from "./coreClient.js";

export class DatasetsClientError extends Error {
  statusCode: number;
  code: string;
  detail?: unknown;
  requestId?: string | null;
  constructor(
    message: string,
    opts: { statusCode: number; code: string; detail?: unknown; requestId?: string | null }
  ) {
    super(message);
    this.name = "DatasetsClientError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.detail = opts.detail;
    this.requestId = opts.requestId ?? null;
  }
}

type JsonObject = Record<string, unknown>;

const RE_DATASET_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;

function isUuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function toInt(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function clampInt(v: unknown, min: number, max: number, d: number): number {
  const n = toInt(v, d);
  return Math.max(min, Math.min(max, n));
}

function normalizeDatasetKey(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!RE_DATASET_KEY.test(s)) {
    throw new DatasetsClientError("invalid_dataset_key", { statusCode: 400, code: "INVALID_DATASET_KEY" });
  }
  return s;
}

function normalizeProgram(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9_:-]{1,63}$/.test(s)) {
    throw new DatasetsClientError("invalid_program", { statusCode: 400, code: "INVALID_PROGRAM" });
  }
  return s;
}

function normalizeVisibility(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (s !== "private" && s !== "org" && s !== "public") {
    throw new DatasetsClientError("invalid_visibility", { statusCode: 400, code: "INVALID_VISIBILITY" });
  }
  return s;
}

function normalizeOptionalBoolean(
  v: unknown,
  message: string,
  code: string
): boolean | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  throw new DatasetsClientError(message, { statusCode: 400, code });
}

function normalizeDatasetOrderBy(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim();
  const allowed = new Set([
    "created_at DESC",
    "created_at ASC",
    "updated_at DESC",
    "updated_at ASC",
    "dataset_key ASC",
    "dataset_key DESC",
    "program ASC",
    "program DESC",
    "display_name ASC",
    "display_name DESC",
  ]);
  if (!allowed.has(s)) {
    throw new DatasetsClientError("invalid_order_by", { statusCode: 400, code: "INVALID_ORDER_BY" });
  }
  return s;
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
  if (err instanceof DatasetsClientError) return err;
  if (err instanceof CoreClientError) {
    const status = err.status;
    const code = err.code || null;
    const detail = (err as any).detail;
    const requestId = err.requestId ?? null;
    if (status === 400) {
      return new DatasetsClientError("bad_request", {
        statusCode: 400,
        code: code ?? "BAD_REQUEST",
        detail,
        requestId,
      });
    }
    if (status === 401) {
      return new DatasetsClientError("unauthorized", {
        statusCode: 401,
        code: code ?? "AUTH_REQUIRED",
        detail,
        requestId,
      });
    }
    if (status === 403) {
      return new DatasetsClientError("forbidden", {
        statusCode: 403,
        code: code ?? "FORBIDDEN",
        detail,
        requestId,
      });
    }
    if (status === 404) {
      return new DatasetsClientError("not_found", {
        statusCode: 404,
        code: code ?? "NOT_FOUND",
        detail,
        requestId,
      });
    }
    if (status === 409) {
      return new DatasetsClientError("conflict", {
        statusCode: 409,
        code: code ?? "CONFLICT",
        detail,
        requestId,
      });
    }
    if (status === 422) {
      return new DatasetsClientError("unprocessable_entity", {
        statusCode: 422,
        code: code ?? "UNPROCESSABLE_ENTITY",
        detail,
        requestId,
      });
    }
    return new DatasetsClientError("upstream_error", {
      statusCode: 502,
      code: code ?? "UPSTREAM_ERROR",
      detail,
      requestId,
    });
  }
  return new DatasetsClientError("internal_error", { statusCode: 500, code: "INTERNAL_ERROR" });
}

function unwrapResult(res: unknown): unknown {
  return (res as any)?.result ?? res;
}

export type ListDatasetsQuery = Readonly<{
  program?: unknown;
  visibility?: unknown;
  owner_user_id?: unknown;
  includeDisabled?: unknown;
  limit?: unknown;
  offset?: unknown;
  orderBy?: unknown;
}>;

export type ListLatestVersionsQuery = Readonly<{
  program?: unknown;
  limit?: unknown;
  offset?: unknown;
}>;

export type DatasetsClient = Readonly<{
  // Read routes
  getMetrics: (q?: { program?: unknown } | null, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  listDatasets: (q?: ListDatasetsQuery | null, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  listLatestVersions: (q?: ListLatestVersionsQuery | null, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  getDataset: (datasetKey: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  getActiveManifest: (datasetKey: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;
  resolveActiveVersionRow: (datasetKey: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) => Promise<JsonObject>;

  // Admin/write routes (no retries)
  upsertDataset: (body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  ingestVersionFromArtifact: (datasetKey: unknown, body: JsonObject, q?: { setActive?: unknown } | null, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  createVersionStrict: (datasetKey: unknown, body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  activateVersion: (datasetKey: unknown, body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  setVisibility: (datasetKey: unknown, body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  setDisabled: (datasetKey: unknown, body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  attachDatasetHcs: (datasetKey: unknown, body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  attachVersionHcs: (datasetKey: unknown, version: unknown, body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  publishDatasetVersion: (datasetKey: unknown, body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
  unpublishDatasetVersion: (datasetVersionId: unknown, body: JsonObject, ctx?: CoreRequestCtx) => Promise<JsonObject>;
}>;

export function makeCoreDatasets(core: CoreClient): DatasetsClient {
  if (!core) throw new Error("makeCoreDatasets requires core client");

  async function getMetrics(q?: { program?: unknown } | null, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const program = normalizeProgram(q?.program);
      const qs = buildQueryString({ program: program ?? undefined });
      const res = await core.get<any>(`/datasets/metrics${qs}`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function listDatasets(q?: ListDatasetsQuery | null, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const program = normalizeProgram(q?.program);
      const visibility = normalizeVisibility(q?.visibility);

      const owner = q?.owner_user_id == null ? null : String(q.owner_user_id).trim();
      if (owner && !isUuid(owner)) throw new DatasetsClientError("invalid_owner_user_id", { statusCode: 400, code: "INVALID_OWNER_USER_ID" });

      const includeDisabled = normalizeOptionalBoolean(q?.includeDisabled, "invalid_include_disabled", "INVALID_INCLUDE_DISABLED");

      const limit = clampInt(q?.limit, 1, 1000, 50);
      const offset = clampInt(q?.offset, 0, 10_000_000, 0);
      const orderBy = normalizeDatasetOrderBy(q?.orderBy);

      const qs = buildQueryString({
        program: program ?? undefined,
        visibility: visibility ?? undefined,
        owner_user_id: owner || undefined,
        includeDisabled: includeDisabled === undefined ? undefined : includeDisabled,
        limit,
        offset,
        orderBy,
      });

      const res = await core.get<any>(`/datasets${qs}`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function listLatestVersions(q?: ListLatestVersionsQuery | null, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const program = normalizeProgram(q?.program);
      const limit = clampInt(q?.limit, 1, 1000, 200);
      const offset = clampInt(q?.offset, 0, 10_000_000, 0);
      const qs = buildQueryString({ program: program ?? undefined, limit, offset });
      const res = await core.get<any>(`/dataset-versions/latest${qs}`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getDataset(datasetKey: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const key = normalizeDatasetKey(datasetKey);
      const res = await core.get<any>(`/datasets/${encodeURIComponent(key)}`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function getActiveManifest(datasetKey: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const key = normalizeDatasetKey(datasetKey);
      const res = await core.get<any>(`/datasets/${encodeURIComponent(key)}/manifest/active`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function resolveActiveVersionRow(datasetKey: unknown, ctx?: CoreRequestCtx, retry?: { maxRetries?: number } | null) {
    try {
      const key = normalizeDatasetKey(datasetKey);
      const res = await core.get<any>(`/datasets/${encodeURIComponent(key)}/active-version-row`, ctx, retry ?? undefined);
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  // -----------------------------
  // Admin/write routes (no retry)
  // -----------------------------

  async function upsertDataset(body: JsonObject, ctx?: CoreRequestCtx) {
    try {
      const res = await core.post<any>(`/admin/datasets`, body ?? {}, ctx, { maxRetries: 0 });
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function ingestVersionFromArtifact(datasetKey: unknown, body: JsonObject, q?: { setActive?: unknown } | null, ctx?: CoreRequestCtx) {
    try {
      const key = normalizeDatasetKey(datasetKey);
      const setActive = normalizeOptionalBoolean(q?.setActive, "invalid_set_active", "INVALID_SET_ACTIVE");
      const qs = buildQueryString({ setActive: setActive === undefined ? undefined : setActive });
      const res = await core.post<any>(
        `/admin/datasets/${encodeURIComponent(key)}/versions/ingest${qs}`,
        body ?? {},
        ctx,
        { maxRetries: 0 }
      );
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function createVersionStrict(datasetKey: unknown, body: JsonObject, ctx?: CoreRequestCtx) {
    try {
      const key = normalizeDatasetKey(datasetKey);
      const res = await core.post<any>(`/admin/datasets/${encodeURIComponent(key)}/versions`, body ?? {}, ctx, { maxRetries: 0 });
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function activateVersion(datasetKey: unknown, body: JsonObject, ctx?: CoreRequestCtx) {
    try {
      const key = normalizeDatasetKey(datasetKey);
      const res = await core.post<any>(`/admin/datasets/${encodeURIComponent(key)}/activate`, body ?? {}, ctx, { maxRetries: 0 });
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function setVisibility(datasetKey: unknown, body: JsonObject, ctx?: CoreRequestCtx) {
    try {
      const key = normalizeDatasetKey(datasetKey);
      const res = await core.post<any>(`/admin/datasets/${encodeURIComponent(key)}/visibility`, body ?? {}, ctx, { maxRetries: 0 });
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function setDisabled(datasetKey: unknown, body: JsonObject, ctx?: CoreRequestCtx) {
    try {
      const key = normalizeDatasetKey(datasetKey);
      const res = await core.post<any>(`/admin/datasets/${encodeURIComponent(key)}/disabled`, body ?? {}, ctx, { maxRetries: 0 });
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function attachDatasetHcs(datasetKey: unknown, body: JsonObject, ctx?: CoreRequestCtx) {
    try {
      const key = normalizeDatasetKey(datasetKey);
      const res = await core.post<any>(`/admin/datasets/${encodeURIComponent(key)}/hcs`, body ?? {}, ctx, { maxRetries: 0 });
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function attachVersionHcs(datasetKey: unknown, version: unknown, body: JsonObject, ctx?: CoreRequestCtx) {
    try {
      const key = normalizeDatasetKey(datasetKey);
      const ver = clampInt(version, 1, 1_000_000_000, 0);
      if (ver < 1) throw new DatasetsClientError("invalid_version", { statusCode: 400, code: "INVALID_VERSION" });
      const res = await core.post<any>(
        `/admin/datasets/${encodeURIComponent(key)}/versions/${encodeURIComponent(String(ver))}/hcs`,
        body ?? {},
        ctx,
        { maxRetries: 0 }
      );
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function publishDatasetVersion(datasetKey: unknown, body: JsonObject, ctx?: CoreRequestCtx) {
    try {
      const key = normalizeDatasetKey(datasetKey);
      const res = await core.post<any>(`/admin/datasets/${encodeURIComponent(key)}/publish`, body ?? {}, ctx, { maxRetries: 0 });
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  async function unpublishDatasetVersion(datasetVersionId: unknown, body: JsonObject, ctx?: CoreRequestCtx) {
    try {
      const id = String(datasetVersionId ?? "").trim();
      if (!isUuid(id)) {
        throw new DatasetsClientError("invalid_dataset_version_id", { statusCode: 400, code: "INVALID_DATASET_VERSION_ID" });
      }
      const res = await core.post<any>(
        `/admin/datasets/versions/${encodeURIComponent(id)}/unpublish`,
        body ?? {},
        ctx,
        { maxRetries: 0 }
      );
      const out = unwrapResult(res);
      return out && typeof out === "object" ? (out as JsonObject) : {};
    } catch (e) {
      throw mapCoreError(e);
    }
  }

  return {
    getMetrics,
    listDatasets,
    listLatestVersions,
    getDataset,
    getActiveManifest,
    resolveActiveVersionRow,

    upsertDataset,
    ingestVersionFromArtifact,
    createVersionStrict,
    activateVersion,
    setVisibility,
    setDisabled,
    attachDatasetHcs,
    attachVersionHcs,
    publishDatasetVersion,
    unpublishDatasetVersion,
  };
}

export default makeCoreDatasets;