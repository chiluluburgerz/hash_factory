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
import type { AnchorResult as EvidenceResult, DatasetAnchorMode } from "./types.js";
import { executeAnchor } from "./workflow.js";
import { parseAnchorExecuteRequestV1, type AnchorExecuteRequestV1, type DatasetReceiptV1 } from "./validators.js";
import { buildDatasetReceiptV1 } from "./receipt.js";

export type AnchorMode = DatasetAnchorMode;

export type AnchorExecuteRequest = AnchorExecuteRequestV1;

export type AnchorExecuteResponse = Readonly<{
  mode: AnchorMode;
  evidence: EvidenceResult;
  receipt: DatasetReceiptV1;

  // Present only when mode=register_and_anchor
  core?: Readonly<{
    dataset?: Record<string, unknown>;
    version?: Record<string, unknown>;
    published?: Record<string, unknown>;
    hcs_attach?: Record<string, unknown>;
  }>;
}>;

function asOptionalNonNegativeInt(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const out = Math.trunc(n);
  return out >= 0 ? out : null;
}

export function makeDatasetAnchorOrchestrator(datasets: DatasetsClient) {
  if (!datasets) throw new Error("makeDatasetAnchorOrchestrator requires datasets client");

  async function execute(req: AnchorExecuteRequest, ctx: CoreRequestCtx): Promise<AnchorExecuteResponse> {
    const parsed = parseAnchorExecuteRequestV1(req);
    const mode = parsed.mode;
 
    // 1) Pure evidence pipeline
    const evidence = await executeAnchor(
      {
        mode,
        identity: parsed.identity,
        root_dir: parsed.root_dir,
        ...(parsed.rules ? { rules: parsed.rules } : {}),
      },
      undefined,
    );

    const receiptHashOnly = buildDatasetReceiptV1({
      mode,
      evidence,
      evidence_pointer: parsed.evidence_pointer ?? null,
      core: null,
    });

    const out: AnchorExecuteResponse = Object.freeze({ mode, evidence, receipt: receiptHashOnly });

    if (mode === "hash_only") return out;

    // 2) Side effects against Core (deterministic order)
    // Use computed idempotency_key for all Core writes in this workflow
    const ctx2: CoreRequestCtx = Object.freeze({
      ...(ctx ?? {}),
      idempotencyKey: evidence.idempotency_key,
    });

    const dataset_key = String(evidence.dataset_key);
    const program = String((parsed.identity as any)?.program ?? "").trim() || null;

    const display_name = parsed.display_name ?? null;
    const metadata = parsed.metadata ?? {};
    const evidence_pointer = parsed.evidence_pointer ?? null;
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

    const ver = await datasets.ingestVersionFromArtifact(
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

    const pub = await datasets.publishDatasetVersion(
      dataset_key,
      {
      },
      ctx2
    );

    const receipt = buildDatasetReceiptV1({
      mode,
      evidence,
      evidence_pointer,
      core: {
        dataset: ds,
        version: ver,
        published: pub,
      },
    });

    return Object.freeze({
      mode,
      evidence,
      receipt,
      core: Object.freeze({
        dataset: ds,
        version: ver,
        published: pub,
      }),
    });
  }

  return Object.freeze({ execute });
}