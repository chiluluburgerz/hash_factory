// ============================================================================
// File: src/datasets/verifier.ts
// Version: 1.0-hf-datasets-verifier-v1 | 2026-03-06
// Purpose:
//   Verify dataset bundles / receipts and optionally verify against a local directory.
// Notes:
//   - Uses runtime validation for safety.
//   - Keeps verification offline/local-first when root_dir is supplied.
// ============================================================================

import { bundleDigest, datasetFingerprint, idempotencyKey } from "./bundle.js";
import { merkleRoot } from "./merkle.js";
import { executeAnchor } from "./workflow.js";
import {
  parseDatasetBundleV1,
  parseDatasetReceiptV1,
  type DatasetReceiptV1,
} from "./validators.js";
import { hashJsonDigest } from "../hashing/contract.js";
import type { DatasetBundleV1 } from "./types.js";

export type DatasetVerifyMismatch = Readonly<{
  field: string;
  expected: unknown;
  actual: unknown;
}>;

export type DatasetVerifyResult = Readonly<{
  ok: boolean;
  mismatches: ReadonlyArray<DatasetVerifyMismatch>;
  computed?: Readonly<Record<string, unknown>>;
}>;

function mismatch(field: string, expected: unknown, actual: unknown): DatasetVerifyMismatch {
  return Object.freeze({ field, expected, actual });
}

function recomputeReceiptId(receipt: DatasetReceiptV1): string {
  const { receipt_id: _discard, ...body } = receipt as any;
  return hashJsonDigest({
    domain: "va:dataset:receipt:v1",
    value: body,
    alg: "sha3-512",
    encoding: "hex_lower",
  });
}

export function verifyDatasetBundle(bundle: unknown): DatasetVerifyResult {
  const parsed = parseDatasetBundleV1(bundle) as DatasetBundleV1;
  const mismatches: DatasetVerifyMismatch[] = [];

  const recomputedMerkle = merkleRoot(parsed.files as any);
  const recomputedBundleDigest = bundleDigest(parsed);
  const recomputedFingerprint = datasetFingerprint(parsed);
  const recomputedIdem = idempotencyKey(String(parsed.dataset_identity.dataset_key), recomputedFingerprint);

  const sumBytes = parsed.files.reduce((acc, f) => acc + Number((f as any).bytes || 0), 0);

  if (parsed.merkle.leaf_count !== parsed.files.length) {
    mismatches.push(mismatch("merkle.leaf_count", parsed.files.length, parsed.merkle.leaf_count));
  }
  if (parsed.merkle.root !== recomputedMerkle.root) {
    mismatches.push(mismatch("merkle.root", recomputedMerkle.root, parsed.merkle.root));
  }
  if (parsed.summary.file_count !== parsed.files.length) {
    mismatches.push(mismatch("summary.file_count", parsed.files.length, parsed.summary.file_count));
  }
  if (parsed.summary.total_bytes !== sumBytes) {
    mismatches.push(mismatch("summary.total_bytes", sumBytes, parsed.summary.total_bytes));
  }

  return Object.freeze({
    ok: mismatches.length === 0,
    mismatches: Object.freeze(mismatches.slice()),
    computed: Object.freeze({
      bundle_digest: recomputedBundleDigest,
      dataset_fingerprint: recomputedFingerprint,
      merkle_root: recomputedMerkle.root,
      idempotency_key: recomputedIdem,
      file_count: parsed.files.length,
      total_bytes: sumBytes,
    }),
  });
}

export function verifyDatasetReceipt(receipt: unknown): DatasetVerifyResult {
  const parsed = parseDatasetReceiptV1(receipt);
  const mismatches: DatasetVerifyMismatch[] = [];

  const receiptId = recomputeReceiptId(parsed);
  if (parsed.receipt_id !== receiptId) {
    mismatches.push(mismatch("receipt_id", receiptId, parsed.receipt_id));
  }

  const idem = idempotencyKey(
    String(parsed.dataset_identity.dataset_key),
    String(parsed.evidence.dataset_fingerprint)
  );
  if (parsed.evidence.idempotency_key !== idem) {
    mismatches.push(mismatch("evidence.idempotency_key", idem, parsed.evidence.idempotency_key));
  }

  return Object.freeze({
    ok: mismatches.length === 0,
    mismatches: Object.freeze(mismatches.slice()),
    computed: Object.freeze({
      receipt_id: receiptId,
      idempotency_key: idem,
    }),
  });
}

export async function verifyDatasetMaterialAgainstReceiptOrBundle(opts: {
  receipt?: unknown;
  bundle?: unknown;
  root_dir: string;
}): Promise<DatasetVerifyResult> {
  const mismatches: DatasetVerifyMismatch[] = [];

  const receipt = opts.receipt ? parseDatasetReceiptV1(opts.receipt) : null;
  const bundle = opts.bundle ? (parseDatasetBundleV1(opts.bundle) as DatasetBundleV1) : null;

  const identity = receipt?.dataset_identity ?? bundle?.dataset_identity;
  const rules = (receipt?.rules as any) ?? bundle?.rules;
  if (!identity) {
    throw new Error("verifyDatasetMaterialAgainstReceiptOrBundle requires receipt or bundle");
  }

  const local = await executeAnchor({
    mode: "hash_only",
    identity: identity as any,
    root_dir: opts.root_dir,
    ...(rules ? { rules: rules as any } : {}),
  });

  if (receipt) {
    if (local.dataset_fingerprint !== receipt.evidence.dataset_fingerprint) {
      mismatches.push(mismatch("evidence.dataset_fingerprint", local.dataset_fingerprint, receipt.evidence.dataset_fingerprint));
    }
    if (local.bundle_digest !== receipt.evidence.bundle_digest) {
      mismatches.push(mismatch("evidence.bundle_digest", local.bundle_digest, receipt.evidence.bundle_digest));
    }
    if (local.merkle_root !== receipt.evidence.merkle_root) {
      mismatches.push(mismatch("evidence.merkle_root", local.merkle_root, receipt.evidence.merkle_root));
    }
    if (local.idempotency_key !== receipt.evidence.idempotency_key) {
      mismatches.push(mismatch("evidence.idempotency_key", local.idempotency_key, receipt.evidence.idempotency_key));
    }
    if (Number((local as any).bundle?.summary?.file_count ?? 0) !== Number(receipt.evidence.file_count)) {
      mismatches.push(mismatch("evidence.file_count", Number((local as any).bundle?.summary?.file_count ?? 0), receipt.evidence.file_count));
    }
    if (Number((local as any).bundle?.summary?.total_bytes ?? 0) !== Number(receipt.evidence.total_bytes)) {
      mismatches.push(mismatch("evidence.total_bytes", Number((local as any).bundle?.summary?.total_bytes ?? 0), receipt.evidence.total_bytes));
    }
  }

  if (bundle) {
    const bundleCheck = verifyDatasetBundle(bundle);
    mismatches.push(...bundleCheck.mismatches);

    const recomputedBundleDigest = bundleDigest(bundle);
    const recomputedFingerprint = datasetFingerprint(bundle);
    const recomputedMerkleRoot = merkleRoot(bundle.files as any).root;

    if (local.bundle_digest !== recomputedBundleDigest) {
      mismatches.push(mismatch("local.bundle_digest", recomputedBundleDigest, local.bundle_digest));
    }
    if (local.dataset_fingerprint !== recomputedFingerprint) {
      mismatches.push(mismatch("local.dataset_fingerprint", recomputedFingerprint, local.dataset_fingerprint));
    }
    if (local.merkle_root !== recomputedMerkleRoot) {
      mismatches.push(mismatch("local.merkle_root", recomputedMerkleRoot, local.merkle_root));
    }
  }

  return Object.freeze({
    ok: mismatches.length === 0,
    mismatches: Object.freeze(mismatches.slice()),
    computed: Object.freeze({
      local_dataset_fingerprint: local.dataset_fingerprint,
      local_bundle_digest: local.bundle_digest,
      local_merkle_root: local.merkle_root,
      local_idempotency_key: local.idempotency_key,
      local_file_count: (local as any).bundle?.summary?.file_count ?? null,
      local_total_bytes: (local as any).bundle?.summary?.total_bytes ?? null,
    }),
  });
}