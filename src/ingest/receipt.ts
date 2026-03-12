// ============================================================================
// File: src/ingest/receipt.ts
// Version: 1.0-hf-ingest-receipt-v1 | 2026-03-06
// Purpose:
//   Deterministic receipt builder for generic ingest flows.
// Notes:
//   - Pure, side-effect free.
//   - Receipt ID is a deterministic hash over the receipt body excluding
//     receipt_id.
//   - Supports local-only evidence and optional Core anchor enrichment.
// ============================================================================

import { hashJsonDigest } from "../hashing/contract.js";
import type { IngestBundleV1, IngestMode, IngestResult } from "./types.js";

export type IngestReceiptV1 = Readonly<{
  v: "v1";
  kind: "ingest_receipt";
  receipt_id: string;
  mode: IngestMode;

  identity: Readonly<{
    object_key: string;
    object_kind: string;
    version_label?: string | null;
    program?: string | null;
  }>;

  rules: IngestBundleV1["rules"];

  evidence: Readonly<{
    fingerprint: string;
    bundle_digest: string;
    merkle_root?: string;
    idempotency_key: string;
    item_count: number;
    total_bytes: number;
  }>;

  anchor?: Readonly<{
    domain?: string | null;
    proof_date?: string | null;
  }>;

  pointers?: Readonly<{
    evidence_pointer?: string | null;
  }>;

  metadata?: Readonly<Record<string, unknown>>;

  core?: Readonly<{
    anchor?: Readonly<Record<string, unknown>>;
  }>;
}>;

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

function pickAnchorCore(core: unknown): Record<string, unknown> | undefined {
  const src =
    (core as any)?.anchor ??
    core ??
    null;

  if (!src || typeof src !== "object") return undefined;

  const projected = stripUndefined({
    id: (src as any).id ?? undefined,
    anchor_request_id: (src as any).anchor_request_id ?? (src as any).anchorRequestId ?? undefined,
    domain: (src as any).domain ?? undefined,
    payload_type: (src as any).payload_type ?? undefined,
    proof_date: (src as any).proof_date ?? (src as any).proofDate ?? undefined,
    status: (src as any).status ?? undefined,
    root_id: (src as any).root_id ?? (src as any).rootId ?? undefined,
    merkle_root: (src as any).merkle_root ?? undefined,
    leaf_hash: (src as any).leaf_hash ?? undefined,
    topic_id: (src as any).topic_id ?? undefined,
    transaction_id: (src as any).transaction_id ?? undefined,
    message_id: (src as any).message_id ?? undefined,
    consensus_timestamp: (src as any).consensus_timestamp ?? undefined,
  });

  return Object.keys(projected).length > 0
    ? projected
    : undefined;
}

export function buildIngestReceiptV1(opts: {
  mode: IngestMode;
  evidence: IngestResult;
  domain?: string | null;
  proof_date?: string | null;
  evidence_pointer?: string | null;
  metadata?: Readonly<Record<string, unknown>> | null;
  core?: Record<string, unknown> | null;
}): IngestReceiptV1 {
  const bundle = opts.evidence.bundle;

  const identity = bundle?.identity ?? {
    object_key: opts.evidence.object_key,
    object_kind: opts.evidence.object_kind,
  };

  const rules = bundle?.rules ?? Object.freeze({
    path_normalization: "posix_rel_no_dotdot" as const,
    follow_symlinks: false,
    redact_paths: false,
    normalize_line_endings: false,
    ordering: "deterministic_sort_v1" as const,
    merkle_rule: "dup_last_on_odd" as const,
  });
  const item_count = Number(bundle?.summary?.item_count ?? 0);
  const total_bytes = Number(bundle?.summary?.total_bytes ?? 0);

  const core = opts.core
    ? stripUndefined({
        ...(pickAnchorCore(opts.core) ? { anchor: pickAnchorCore(opts.core) } : {}),
      })
    : undefined;

  const body = stripUndefined({
    v: "v1" as const,
    kind: "ingest_receipt" as const,
    mode: opts.mode,
    identity,
    rules,
    evidence: {
      fingerprint: opts.evidence.fingerprint,
      bundle_digest: opts.evidence.bundle_digest,
      ...(opts.evidence.merkle_root ? { merkle_root: opts.evidence.merkle_root } : {}),
      idempotency_key: opts.evidence.idempotency_key,
      item_count,
      total_bytes,
    },
    ...((opts.domain ?? opts.proof_date)
      ? {
          anchor: stripUndefined({
            domain: opts.domain ?? undefined,
            proof_date: opts.proof_date ?? undefined,
          }),
        }
      : {}),
    ...(opts.evidence_pointer ? { pointers: { evidence_pointer: opts.evidence_pointer } } : {}),
    ...(opts.metadata ? { metadata: opts.metadata } : {}),
    ...(core && Object.keys(core).length > 0 ? { core } : {}),
  });

  const receipt_id = hashJsonDigest({
    domain: "va:ingest:receipt:v1",
    value: body,
    alg: "sha3-512",
    encoding: "hex_lower",
  });

  return Object.freeze({
    ...body,
    receipt_id,
  }) as IngestReceiptV1;
}