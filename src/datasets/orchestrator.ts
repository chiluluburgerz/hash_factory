// ============================================================================
// File: src/datasets/orchestrator.ts
// Version: 1.0-hf-datasets-anchor-orchestrator | 2026-03-05
// Purpose:
//   Compose pure evidence pipeline (scan->hash->merkle->bundle) with Core writes.
//   - Keeps evidence generation deterministic and testable.
//   - Adds side effects (Core upsert/ingest/publish/attach) in deterministic order.
// Security:
//   - Uses pass-through Core auth via CoreRequestCtx (recommended).
//   - Propagates computed idempotency_key to Core for all write steps.
// ============================================================================

import type { CoreRequestCtx } from "../core/coreClient.js";
import type { DatasetsClient } from "../core/datasetsClient.js";
import { executeAnchor } from "./workflow.js";
import { buildDatasetReceiptV1 } from "./receipt.js";
import {
  parseAnchorExecuteRequestV1,
  parseAnchorSubmitRequestV1,
  type AnchorExecuteRequestV1,
  type AnchorSubmitRequestV1,
  type DatasetReceiptV1,
} from "./validators.js";
import type { AnchorResult as EvidenceResult, DatasetAnchorMode } from "./types.js";
import { verifySubmittedAnchorEvidence } from "./verifier.js";

export type AnchorMode = DatasetAnchorMode;
export type AnchorExecuteRequest = AnchorExecuteRequestV1;

export type AnchorExecuteResponse = Readonly<{
  mode: AnchorMode;
  evidence: EvidenceResult;
  receipt: DatasetReceiptV1;
  core?: Readonly<{
    dataset?: Record<string, unknown>;
    version?: Record<string, unknown>;
    published?: Record<string, unknown>;
    certificate?: Record<string, unknown>;
    hcs_attach?: Record<string, unknown>;
    replay?: Readonly<{
      reused?: boolean;
      replay?: boolean;
      replay_reason?: string | null;
    }>;
  }>;
}>;

function asOptionalNonNegativeInt(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const out = Math.trunc(n);
  return out >= 0 ? out : null;
}

function asOptionalPositiveInt(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const out = Math.trunc(n);
  return out >= 1 ? out : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function datasetVisibilityForPublishVisibility(
  publishVisibility: "public" | "unlisted" | null
): "public" | "org" | null {
  if (publishVisibility === "public") return "public";
  if (publishVisibility === "unlisted") return "org";
  return null;
}

function unwrapDatasetRow(v: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(v)) return undefined;
  if (isPlainObject(v.dataset)) return v.dataset;
  return v;
}

function unwrapVersionRow(v: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(v)) return undefined;
  if (isPlainObject(v.version)) return v.version;
  return v;
}

function unwrapCertificateResult(v: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(v)) return undefined;
  if (isPlainObject(v.certificate)) return v.certificate;
  return undefined;
}

function unwrapReplayInfo(v: unknown):
  | Readonly<{ reused?: boolean; replay?: boolean; replay_reason?: string | null }>
  | undefined {
  if (!isPlainObject(v)) return undefined;

  const reused = typeof v.reused === "boolean" ? v.reused : undefined;
  const replay = typeof v.replay === "boolean" ? v.replay : undefined;
  const replay_reason =
    v.replay_reason == null ? null : String(v.replay_reason);

  if (reused === undefined && replay === undefined && replay_reason == null) {
    return undefined;
  }

  return Object.freeze({
    ...(reused !== undefined ? { reused } : {}),
    ...(replay !== undefined ? { replay } : {}),
    replay_reason,
  });
}

function pickVersionNumber(v: unknown): number | null {
  if (!isPlainObject(v)) return null;
  return asOptionalPositiveInt(
    (v as any).version ??
    (v as any).dataset_version_number ??
    null
  );
}

export function makeDatasetAnchorOrchestrator(datasets: DatasetsClient) {
  if (!datasets) throw new Error("makeDatasetAnchorOrchestrator requires datasets client");

  async function finalizeFromEvidence(
    parsed: {
      mode: "register_and_anchor";
      identity: { dataset_key: string; program?: string | null; version_label?: string | null };
      display_name?: string;
      metadata?: Record<string, unknown>;
      evidence_pointer?: string;
      publish_visibility?: "public" | "unlisted";
      set_active?: boolean;
    },
    evidence: EvidenceResult,
    ctx: CoreRequestCtx
  ): Promise<AnchorExecuteResponse> {
    const ctx2: CoreRequestCtx = Object.freeze({
      ...(ctx ?? {}),
      idempotencyKey: evidence.idempotency_key,
    });

    const dataset_key = String(evidence.dataset_key);
    const program = String(parsed.identity?.program ?? "").trim() || null;

    const display_name = parsed.display_name ?? null;
    const metadata = parsed.metadata ?? {};
    const evidence_pointer = parsed.evidence_pointer ?? null;
    const publish_visibility = parsed.publish_visibility ?? null;
    const dataset_visibility = datasetVisibilityForPublishVisibility(publish_visibility);
    const setActive = parsed.set_active ?? true;
    const totalBytes = asOptionalNonNegativeInt((evidence as any)?.bundle?.summary?.total_bytes);

    const datasetBody: Record<string, unknown> = {
      dataset_key,
      ...(program ? { program } : {}),
      ...(display_name ? { display_name } : {}),
      meta: {
        ...metadata,
        va_dataset_fingerprint_v1: evidence.dataset_fingerprint,
        va_bundle_digest_v1: evidence.bundle_digest,
        va_merkle_root_v1: evidence.merkle_root,
        ...(evidence_pointer ? { va_evidence_pointer_v1: evidence_pointer } : {}),
      },
    };

    const ds = await datasets.upsertDataset(datasetBody, ctx2);

    let dsEffective = unwrapDatasetRow(ds) ?? {};
    if (dataset_visibility) {
      const visResult = await datasets.setVisibility(
        dataset_key,
        { visibility: dataset_visibility },
        ctx2
      );
      dsEffective = unwrapDatasetRow(visResult) ?? dsEffective;
    }

    const verRaw = await datasets.ingestAnchoredVersionFromArtifact(
      dataset_key,
      {
        matrix_path: evidence_pointer,
        dataset_fingerprint: evidence.dataset_fingerprint,
        ...(totalBytes != null ? { artifact_bytes: totalBytes } : {}),
        ...(totalBytes != null ? { bytes_estimate: totalBytes } : {}),
      },
      { setActive },
      ctx2
    );

    const ver = unwrapVersionRow(verRaw) ?? {};
    const certificate = unwrapCertificateResult(verRaw);
    const replayInfo = unwrapReplayInfo(verRaw);
    const resolvedVersion = pickVersionNumber(ver);

    let pub: Record<string, unknown> | undefined;
    if (publish_visibility) {
      const publishBody: Record<string, unknown> = {
        visibility: publish_visibility,
      };

      if (resolvedVersion != null) {
        publishBody.version = resolvedVersion;
      }

      pub = await datasets.publishDatasetVersion(dataset_key, publishBody, ctx2);
    }

    const dsFinalRaw = await datasets.getDataset(dataset_key, ctx2);
    const dsFinal = unwrapDatasetRow(dsFinalRaw) ?? dsEffective;

    const datasetForOutput =
      dsFinal.active_manifest_hash == null && ver.manifest_hash != null
        ? { ...dsFinal, active_manifest_hash: ver.manifest_hash }
        : dsFinal;

    const receipt = buildDatasetReceiptV1({
      mode: "register_and_anchor",
      evidence,
      evidence_pointer,
      core: {
        dataset: datasetForOutput,
        version: ver,
        ...(pub ? { published: pub } : {}),
        ...(certificate ? { certificate } : {}),
        ...(replayInfo ? { replay: replayInfo } : {}),
      },
    });

    return Object.freeze({
      mode: "register_and_anchor",
      evidence,
      receipt,
      core: Object.freeze({
        dataset: datasetForOutput,
        version: ver,
        ...(pub ? { published: pub } : {}),
        ...(certificate ? { certificate } : {}),
        ...(replayInfo ? { replay: replayInfo } : {}),
      }),
    });
  }

  async function executeServerLocal(
    req: AnchorExecuteRequestV1,
    ctx: CoreRequestCtx
  ): Promise<AnchorExecuteResponse> {
    const parsed = parseAnchorExecuteRequestV1(req);
    const mode = parsed.mode;

    const evidence = await executeAnchor(
      {
        mode,
        identity: parsed.identity,
        root_dir: parsed.root_dir,
        ...(parsed.rules ? { rules: parsed.rules } : {}),
      },
      undefined
    );

    const receiptHashOnly = buildDatasetReceiptV1({
      mode,
      evidence,
      evidence_pointer: parsed.evidence_pointer ?? null,
      core: null,
    });

    if (mode === "hash_only") {
      return Object.freeze({ mode, evidence, receipt: receiptHashOnly });
    }

    return finalizeFromEvidence(parsed as any, evidence, ctx);
  }

  async function submit(
    req: AnchorSubmitRequestV1,
    ctx: CoreRequestCtx
  ): Promise<AnchorExecuteResponse> {
    const parsed = parseAnchorSubmitRequestV1(req);

    const verify = verifySubmittedAnchorEvidence({
      identity: parsed.identity,
      evidence: parsed.evidence as EvidenceResult,
    });

    if (!verify.ok) {
      const err: any = new Error("submitted_evidence_invalid");
      err.statusCode = 400;
      err.code = "SUBMITTED_EVIDENCE_INVALID";
      err.detail = {
        mismatches: verify.mismatches,
        computed: verify.computed,
      };
      throw err;
    }

    return finalizeFromEvidence(parsed as any, parsed.evidence as EvidenceResult, ctx);
  }

  return Object.freeze({
    executeServerLocal,
    submit,
  });
}