// ============================================================================
// File: tests/integration/src/datasets/roundTrip.int.test.ts
// Version: 1.0.0-hf-datasets-roundtrip-int | 2026-03-07
// Purpose:
//   Integration tests for real dataset anchor round-trip flows.
// Notes:
//   - Uses real scan/hash/merkle/bundle/receipt/verifier code.
//   - Uses real temp directories for dataset material verification.
//   - Keeps scope intentionally small but high-value:
//       1) normal file_set-style dataset round trip
//       2) redact_paths round trip
//       3) tamper detection on real generated receipt + bundle
// ============================================================================

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import { executeAnchor } from "../../../../src/datasets/workflow.js";
import { buildDatasetReceiptV1 } from "../../../../src/datasets/receipt.js";
import {
  verifyDatasetBundle,
  verifyDatasetReceipt,
  verifyDatasetMaterialAgainstReceiptOrBundle,
} from "../../../../src/datasets/verifier.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("datasets round-trip (integration)", () => {
  it("executes dataset anchor on a real temp directory and verifies bundle + receipt + local replay", async () => {
    const rootDir = await makeTempDir("hf-dataset-roundtrip-");

    await fs.mkdir(path.join(rootDir, "nested"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "a.tsv"), "gene\tvalue\nA\t1\n", "utf8");
    await fs.writeFile(path.join(rootDir, "nested", "b.tsv"), "gene\tvalue\nB\t2\n", "utf8");
    await fs.writeFile(path.join(rootDir, "ignore.tmp"), "skip me\n", "utf8");

    const evidence = await executeAnchor({
      mode: "hash_only",
      identity: {
        dataset_key: "dataset.int.1",
        version_label: "v1",
        program: "sage",
      },
      root_dir: rootDir,
      rules: {
        include_globs: ["a.tsv", "nested", "nested/**", "ignore.tmp"],
        exclude_globs: ["ignore.tmp"],
        allowed_suffixes: [".tsv"],
        follow_symlinks: false,
        redact_paths: false,
      },
    });

    const receipt = buildDatasetReceiptV1({
      mode: "hash_only",
      evidence,
      evidence_pointer: `file://${rootDir}`,
      core: null,
    });

    const bundleCheck = verifyDatasetBundle(evidence.bundle);
    const receiptCheck = verifyDatasetReceipt(receipt);
    const replayCheck = await verifyDatasetMaterialAgainstReceiptOrBundle({
      receipt,
      root_dir: rootDir,
    });

    expect(evidence.dataset_key).toBe("dataset.int.1");
    expect(evidence.bundle.summary.file_count).toBe(2);
    expect(evidence.bundle.files.map((f) => f.path_rel)).toEqual([
      "a.tsv",
      "nested/b.tsv",
    ]);

    expect(bundleCheck.ok).toBe(true);
    expect(bundleCheck.mismatches).toEqual([]);
    expect(bundleCheck.computed).toEqual({
      bundle_digest: evidence.bundle_digest,
      dataset_fingerprint: evidence.dataset_fingerprint,
      merkle_root: evidence.merkle_root,
      idempotency_key: evidence.idempotency_key,
      file_count: 2,
      total_bytes: evidence.bundle.summary.total_bytes,
    });

    expect(receiptCheck.ok).toBe(true);
    expect(receiptCheck.mismatches).toEqual([]);
    expect(receiptCheck.computed).toEqual({
      receipt_id: receipt.receipt_id,
      idempotency_key: evidence.idempotency_key,
    });

    expect(replayCheck.ok).toBe(true);
    expect(replayCheck.mismatches).toEqual([]);
    expect(replayCheck.computed).toEqual({
      local_dataset_fingerprint: evidence.dataset_fingerprint,
      local_bundle_digest: evidence.bundle_digest,
      local_merkle_root: evidence.merkle_root,
      local_idempotency_key: evidence.idempotency_key,
      local_file_count: 2,
      local_total_bytes: evidence.bundle.summary.total_bytes,
    });

    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it("executes dataset anchor with redact_paths=true and verifies replay against the real receipt", async () => {
    const rootDir = await makeTempDir("hf-dataset-redacted-");

    await fs.mkdir(path.join(rootDir, "nested"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "a.tsv"), "gene\tvalue\nA\t1\n", "utf8");
    await fs.writeFile(path.join(rootDir, "nested", "b.tsv"), "gene\tvalue\nB\t2\n", "utf8");

    const evidence = await executeAnchor({
      mode: "hash_only",
      identity: {
        dataset_key: "dataset.int.redacted.1",
        version_label: "v1",
        program: "sage",
      },
      root_dir: rootDir,
      rules: {
        include_globs: ["a.tsv", "nested", "nested/**"],
        allowed_suffixes: [".tsv"],
        follow_symlinks: false,
        redact_paths: true,
      },
    });

    const receipt = buildDatasetReceiptV1({
      mode: "hash_only",
      evidence,
      evidence_pointer: `file://${rootDir}`,
      core: null,
    });

    const bundleCheck = verifyDatasetBundle(evidence.bundle);
    const receiptCheck = verifyDatasetReceipt(receipt);
    const replayCheck = await verifyDatasetMaterialAgainstReceiptOrBundle({
      receipt,
      root_dir: rootDir,
    });

    expect(evidence.bundle.summary.file_count).toBe(2);

    for (const file of evidence.bundle.files) {
      expect(file.path_rel).toBeUndefined();
      expect(typeof file.path_hash).toBe("string");
      expect(file.path_hash).toMatch(/^[0-9a-f]{128}$/);
    }

    expect(bundleCheck.ok).toBe(true);
    expect(bundleCheck.mismatches).toEqual([]);

    expect(receiptCheck.ok).toBe(true);
    expect(receiptCheck.mismatches).toEqual([]);

    expect(replayCheck.ok).toBe(true);
    expect(replayCheck.mismatches).toEqual([]);
    expect(replayCheck.computed).toEqual({
      local_dataset_fingerprint: evidence.dataset_fingerprint,
      local_bundle_digest: evidence.bundle_digest,
      local_merkle_root: evidence.merkle_root,
      local_idempotency_key: evidence.idempotency_key,
      local_file_count: 2,
      local_total_bytes: evidence.bundle.summary.total_bytes,
    });
  });

  it("detects tampered receipt and tampered bundle from real generated evidence", async () => {
    const rootDir = await makeTempDir("hf-dataset-tamper-");

    await fs.writeFile(path.join(rootDir, "a.tsv"), "gene\tvalue\nA\t1\n", "utf8");
    await fs.writeFile(path.join(rootDir, "b.tsv"), "gene\tvalue\nB\t2\n", "utf8");

    const evidence = await executeAnchor({
      mode: "hash_only",
      identity: {
        dataset_key: "dataset.int.tamper.1",
        version_label: "v1",
        program: "sage",
      },
      root_dir: rootDir,
      rules: {
        allowed_suffixes: [".tsv"],
        redact_paths: false,
        follow_symlinks: false,
      },
    });

    const receipt = buildDatasetReceiptV1({
      mode: "hash_only",
      evidence,
      evidence_pointer: `file://${rootDir}`,
      core: null,
    });

    const tamperedReceipt = Object.freeze({
      ...receipt,
      evidence: Object.freeze({
        ...receipt.evidence,
        idempotency_key: "0".repeat(128),
      }),
    });

    const tamperedBundle = Object.freeze({
      ...evidence.bundle,
      summary: Object.freeze({
        ...evidence.bundle.summary,
        total_bytes: evidence.bundle.summary.total_bytes + 1,
      }),
    });

    const receiptCheck = verifyDatasetReceipt(tamperedReceipt);
    const bundleCheck = verifyDatasetBundle(tamperedBundle);

    
    expect(receiptCheck.ok).toBe(false);
    expect(receiptCheck.mismatches).toEqual(
    expect.arrayContaining([
      {
        field: "receipt_id",
        expected: receiptCheck.computed?.receipt_id,
        actual: tamperedReceipt.receipt_id,
      },
      {
        field: "evidence.idempotency_key",
        expected: evidence.idempotency_key,
        actual: "0".repeat(128),
      },
    ]),
    );
    expect(receiptCheck.mismatches).toHaveLength(2);

    expect(bundleCheck.ok).toBe(false);
    expect(bundleCheck.mismatches).toEqual([
      {
        field: "summary.total_bytes",
        expected: evidence.bundle.summary.total_bytes,
        actual: evidence.bundle.summary.total_bytes + 1,
      },
    ]);
  });
});