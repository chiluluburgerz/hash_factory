// ============================================================================
// File: src/ingest/orchestrator.ts
// Version: 1.0-hf-ingest-orchestrator-v1 | 2026-03-06
// Purpose:
//   Compose pure local ingest evidence generation with Core anchor side effects.
//   - Keeps local evidence deterministic and testable.
//   - Adds Core anchor side effects in deterministic order.
// Security:
//   - Uses pass-through Core auth via CoreRequestCtx (recommended).
//   - Propagates computed idempotency_key to Core writes.
// Notes:
//   - register_and_anchor anchors the receipt JSON to Core.
//   - hash_only / merkle_only remain local-only.
// ============================================================================

import type { CoreRequestCtx } from "../core/coreClient.js";
import type { MerkleAnchorClient } from "../core/merkleAnchorClient.js";
import { executeIngest, type ExecuteHooks } from "./execute.js";
import {
  parseIngestExecuteRequestV1,
  type IngestExecuteRequestV1,
} from "./validators.js";
import { buildIngestReceiptV1, type IngestReceiptV1 } from "./receipt.js";
import type { IngestMode, IngestResult } from "./types.js";

export type IngestOrchestratorResponse = Readonly<{
  mode: IngestMode;
  evidence: IngestResult;
  receipt: IngestReceiptV1;
  core?: Readonly<{
    anchor?: Record<string, unknown>;
  }>;
}>;

export function makeIngestOrchestrator(merkleAnchor: MerkleAnchorClient) {
  if (!merkleAnchor) throw new Error("makeIngestOrchestrator requires merkleAnchor client");

  async function execute(
    req: IngestExecuteRequestV1,
    ctx: CoreRequestCtx,
    hooks?: ExecuteHooks
  ): Promise<IngestOrchestratorResponse> {
    const parsed = parseIngestExecuteRequestV1(req);
    const mode = parsed.mode;

    // 1) Pure local evidence pipeline
    const evidence = await executeIngest(parsed, hooks);

    const receiptLocal = buildIngestReceiptV1({
      mode,
      evidence,
      domain: parsed.domain ?? null,
      proof_date: parsed.proof_date ?? null,
      evidence_pointer: parsed.evidence_pointer ?? null,
      metadata: parsed.metadata ?? null,
      core: null,
    });

    if (mode !== "register_and_anchor") {
      return Object.freeze({
        mode,
        evidence,
        receipt: receiptLocal,
      });
    }

    // 2) Core side effect: anchor the deterministic receipt JSON
    const ctx2: CoreRequestCtx = Object.freeze({
      ...(ctx ?? {}),
      idempotencyKey: evidence.idempotency_key,
    });

    const anchor = await merkleAnchor.anchorPayload(
      {
        domain: parsed.domain,
        ...(parsed.proof_date ? { proofDate: parsed.proof_date } : {}),
        payload_type: "ingest_receipt_v1",
        payload_json: receiptLocal,
      },
      ctx2
    );

    const receiptAnchored = buildIngestReceiptV1({
      mode,
      evidence,
      domain: parsed.domain ?? null,
      proof_date: parsed.proof_date ?? null,
      evidence_pointer: parsed.evidence_pointer ?? null,
      metadata: parsed.metadata ?? null,
      core: { anchor },
    });

    return Object.freeze({
      mode,
      evidence,
      receipt: receiptAnchored,
      core: Object.freeze({
        anchor,
      }),
    });
  }

  return Object.freeze({ execute });
}