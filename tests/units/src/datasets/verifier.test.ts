// ============================================================================
// File: tests/units/src/datasets/verifier.test.ts
// Version: 1.0.0-hf-datasets-verifier-unit | 2026-03-07
// Purpose:
//   Unit tests for src/datasets/verifier.ts
// Notes:
//   - Mocks bundle/merkle/workflow/validator/hash boundaries.
//   - Covers bundle verification, receipt verification, and local material verification.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const bundleDigestMock = vi.fn();
const datasetFingerprintMock = vi.fn();
const idempotencyKeyMock = vi.fn();

vi.mock("../../../../src/datasets/bundle.js", () => ({
  bundleDigest: bundleDigestMock,
  datasetFingerprint: datasetFingerprintMock,
  idempotencyKey: idempotencyKeyMock,
}));

const merkleRootMock = vi.fn();
vi.mock("../../../../src/datasets/merkle.js", () => ({
  merkleRoot: merkleRootMock,
}));

const executeAnchorMock = vi.fn();
vi.mock("../../../../src/datasets/workflow.js", () => ({
  executeAnchor: executeAnchorMock,
}));

const parseDatasetBundleV1Mock = vi.fn();
const parseDatasetReceiptV1Mock = vi.fn();
vi.mock("../../../../src/datasets/validators.js", () => ({
  parseDatasetBundleV1: parseDatasetBundleV1Mock,
  parseDatasetReceiptV1: parseDatasetReceiptV1Mock,
}));

const hashJsonDigestMock = vi.fn();
vi.mock("../../../../src/hashing/contract.js", () => ({
  hashJsonDigest: hashJsonDigestMock,
}));

describe("datasets/verifier (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    bundleDigestMock.mockReturnValue("bundle-digest-recomputed");
    datasetFingerprintMock.mockReturnValue("dataset-fingerprint-recomputed");
    idempotencyKeyMock.mockImplementation((datasetKey: string, fp: string) => `idem:${datasetKey}:${fp}`);
    merkleRootMock.mockReturnValue({
      leaf_count: 2,
      root: "merkle-root-recomputed",
    });
    hashJsonDigestMock.mockReturnValue("receipt-id-recomputed");
  });

  it("verifyDatasetBundle returns ok=true with recomputed fields when bundle is internally consistent", async () => {
    const { verifyDatasetBundle } = await import("../../../../src/datasets/verifier.js");

    const parsedBundle = Object.freeze({
      dataset_identity: {
        dataset_key: "dataset.bundle.1",
      },
      files: [
        { bytes: 10, leaf_hash: "a" },
        { bytes: 20, leaf_hash: "b" },
      ],
      merkle: {
        leaf_count: 2,
        root: "merkle-root-recomputed",
      },
      summary: {
        file_count: 2,
        total_bytes: 30,
      },
    });

    parseDatasetBundleV1Mock.mockReturnValue(parsedBundle);

    const out = verifyDatasetBundle({ any: true });

    expect(parseDatasetBundleV1Mock).toHaveBeenCalledWith({ any: true });
    expect(merkleRootMock).toHaveBeenCalledWith(parsedBundle.files);
    expect(bundleDigestMock).toHaveBeenCalledWith(parsedBundle);
    expect(datasetFingerprintMock).toHaveBeenCalledWith(parsedBundle);
    expect(idempotencyKeyMock).toHaveBeenCalledWith("dataset.bundle.1", "dataset-fingerprint-recomputed");

    expect(out).toEqual({
      ok: true,
      mismatches: [],
      computed: {
        bundle_digest: "bundle-digest-recomputed",
        dataset_fingerprint: "dataset-fingerprint-recomputed",
        merkle_root: "merkle-root-recomputed",
        idempotency_key: "idem:dataset.bundle.1:dataset-fingerprint-recomputed",
        file_count: 2,
        total_bytes: 30,
      },
    });

    expect(Object.isFrozen(out)).toBe(true);
  });

  it("verifyDatasetBundle reports merkle and summary mismatches", async () => {
    const { verifyDatasetBundle } = await import("../../../../src/datasets/verifier.js");

    parseDatasetBundleV1Mock.mockReturnValue({
      dataset_identity: {
        dataset_key: "dataset.bundle.2",
      },
      files: [
        { bytes: 10, leaf_hash: "a" },
        { bytes: 20, leaf_hash: "b" },
      ],
      merkle: {
        leaf_count: 99,
        root: "wrong-root",
      },
      summary: {
        file_count: 7,
        total_bytes: 999,
      },
    });

    const out = verifyDatasetBundle({ bad: true });

    expect(out.ok).toBe(false);
    expect(out.mismatches).toEqual([
      { field: "merkle.leaf_count", expected: 2, actual: 99 },
      { field: "merkle.root", expected: "merkle-root-recomputed", actual: "wrong-root" },
      { field: "summary.file_count", expected: 2, actual: 7 },
      { field: "summary.total_bytes", expected: 30, actual: 999 },
    ]);
  });

  it("verifyDatasetReceipt returns ok=true when receipt_id and idempotency_key match recomputed values", async () => {
    const { verifyDatasetReceipt } = await import("../../../../src/datasets/verifier.js");

    parseDatasetReceiptV1Mock.mockReturnValue({
      receipt_id: "receipt-id-recomputed",
      dataset_identity: {
        dataset_key: "dataset.receipt.1",
      },
      evidence: {
        dataset_fingerprint: "fp-1",
        idempotency_key: "idem:dataset.receipt.1:fp-1",
      },
      mode: "hash_only",
      v: "v1",
      kind: "dataset_anchor_receipt",
    });

    const out = verifyDatasetReceipt({ any: true });

    expect(hashJsonDigestMock).toHaveBeenCalledWith({
      domain: "va:dataset:receipt:v1",
      value: {
        dataset_identity: {
          dataset_key: "dataset.receipt.1",
        },
        evidence: {
          dataset_fingerprint: "fp-1",
          idempotency_key: "idem:dataset.receipt.1:fp-1",
        },
        mode: "hash_only",
        v: "v1",
        kind: "dataset_anchor_receipt",
      },
      alg: "sha3-512",
      encoding: "hex_lower",
    });

    expect(idempotencyKeyMock).toHaveBeenCalledWith("dataset.receipt.1", "fp-1");
    expect(out).toEqual({
      ok: true,
      mismatches: [],
      computed: {
        receipt_id: "receipt-id-recomputed",
        idempotency_key: "idem:dataset.receipt.1:fp-1",
      },
    });
  });

  it("verifyDatasetReceipt reports receipt_id and idempotency_key mismatches", async () => {
    const { verifyDatasetReceipt } = await import("../../../../src/datasets/verifier.js");

    parseDatasetReceiptV1Mock.mockReturnValue({
      receipt_id: "wrong-receipt-id",
      dataset_identity: {
        dataset_key: "dataset.receipt.2",
      },
      evidence: {
        dataset_fingerprint: "fp-2",
        idempotency_key: "wrong-idem",
      },
    });

    const out = verifyDatasetReceipt({ bad: true });

    expect(out.ok).toBe(false);
    expect(out.mismatches).toEqual([
      { field: "receipt_id", expected: "receipt-id-recomputed", actual: "wrong-receipt-id" },
      { field: "evidence.idempotency_key", expected: "idem:dataset.receipt.2:fp-2", actual: "wrong-idem" },
    ]);
  });

  it("verifyDatasetMaterialAgainstReceiptOrBundle throws when neither receipt nor bundle provides identity", async () => {
    const { verifyDatasetMaterialAgainstReceiptOrBundle } = await import("../../../../src/datasets/verifier.js");

    await expect(
      verifyDatasetMaterialAgainstReceiptOrBundle({
        root_dir: "/tmp/data",
      }),
    ).rejects.toThrow(/requires receipt or bundle/i);
  });

  it("verifyDatasetMaterialAgainstReceiptOrBundle verifies against receipt fields", async () => {
    const { verifyDatasetMaterialAgainstReceiptOrBundle } = await import("../../../../src/datasets/verifier.js");

    parseDatasetReceiptV1Mock.mockReturnValue({
      dataset_identity: {
        dataset_key: "dataset.material.1",
        version_label: "v1",
        program: "sage",
      },
      rules: {
        redact_paths: true,
        follow_symlinks: true,
        include_globs: Object.freeze(["**/*.tsv"]),
        exclude_globs: Object.freeze(["tmp/**"]),
        allowed_suffixes: Object.freeze([".tsv"]),
      },
      evidence: {
        dataset_fingerprint: "fp-local",
        bundle_digest: "bundle-local",
        merkle_root: "root-local",
        idempotency_key: "idem-local",
        file_count: 2,
        total_bytes: 30,
      },
    });

    executeAnchorMock.mockResolvedValue({
      dataset_fingerprint: "fp-local",
      bundle_digest: "bundle-local",
      merkle_root: "root-local",
      idempotency_key: "idem-local",
      bundle: {
        summary: {
          file_count: 2,
          total_bytes: 30,
        },
      },
    });

    const out = await verifyDatasetMaterialAgainstReceiptOrBundle({
      receipt: { any: true },
      root_dir: "/tmp/data",
    });

    expect(executeAnchorMock).toHaveBeenCalledWith({
      mode: "hash_only",
      identity: {
        dataset_key: "dataset.material.1",
        version_label: "v1",
        program: "sage",
      },
      root_dir: "/tmp/data",
      rules: {
        redact_paths: true,
        follow_symlinks: true,
        include_globs: ["**/*.tsv"],
        exclude_globs: ["tmp/**"],
        allowed_suffixes: [".tsv"],
      },
    });

    expect(out).toEqual({
      ok: true,
      mismatches: [],
      computed: {
        local_dataset_fingerprint: "fp-local",
        local_bundle_digest: "bundle-local",
        local_merkle_root: "root-local",
        local_idempotency_key: "idem-local",
        local_file_count: 2,
        local_total_bytes: 30,
      },
    });
  });

  it("verifyDatasetMaterialAgainstReceiptOrBundle reports receipt mismatches", async () => {
    const { verifyDatasetMaterialAgainstReceiptOrBundle } = await import("../../../../src/datasets/verifier.js");

    parseDatasetReceiptV1Mock.mockReturnValue({
      dataset_identity: {
        dataset_key: "dataset.material.2",
      },
      rules: {
        redact_paths: false,
        follow_symlinks: false,
      },
      evidence: {
        dataset_fingerprint: "receipt-fp",
        bundle_digest: "receipt-bundle",
        merkle_root: "receipt-root",
        idempotency_key: "receipt-idem",
        file_count: 9,
        total_bytes: 999,
      },
    });

    executeAnchorMock.mockResolvedValue({
      dataset_fingerprint: "local-fp",
      bundle_digest: "local-bundle",
      merkle_root: "local-root",
      idempotency_key: "local-idem",
      bundle: {
        summary: {
          file_count: 2,
          total_bytes: 20,
        },
      },
    });

    const out = await verifyDatasetMaterialAgainstReceiptOrBundle({
      receipt: { any: true },
      root_dir: "/tmp/data",
    });

    expect(out.ok).toBe(false);
    expect(out.mismatches).toEqual([
      { field: "evidence.dataset_fingerprint", expected: "local-fp", actual: "receipt-fp" },
      { field: "evidence.bundle_digest", expected: "local-bundle", actual: "receipt-bundle" },
      { field: "evidence.merkle_root", expected: "local-root", actual: "receipt-root" },
      { field: "evidence.idempotency_key", expected: "local-idem", actual: "receipt-idem" },
      { field: "evidence.file_count", expected: 2, actual: 9 },
      { field: "evidence.total_bytes", expected: 20, actual: 999 },
    ]);
  });

  it("verifyDatasetMaterialAgainstReceiptOrBundle verifies against bundle and local recomputation", async () => {
    const { verifyDatasetMaterialAgainstReceiptOrBundle } = await import("../../../../src/datasets/verifier.js");

    const parsedBundle = {
      dataset_identity: {
        dataset_key: "dataset.material.3",
      },
      rules: {
        redact_paths: true,
        follow_symlinks: false,
        include_globs: Object.freeze(["**/*.tsv"]),
        allowed_suffixes: Object.freeze([".tsv"]),
      },
      files: [
        { bytes: 5, leaf_hash: "a" },
        { bytes: 7, leaf_hash: "b" },
      ],
      merkle: {
        leaf_count: 2,
        root: "merkle-root-recomputed",
      },
      summary: {
        file_count: 2,
        total_bytes: 12,
      },
    };

    parseDatasetBundleV1Mock.mockReturnValue(parsedBundle);
    executeAnchorMock.mockResolvedValue({
      dataset_fingerprint: "dataset-fingerprint-recomputed",
      bundle_digest: "bundle-digest-recomputed",
      merkle_root: "merkle-root-recomputed",
      idempotency_key: "idem:dataset.material.3:dataset-fingerprint-recomputed",
      bundle: {
        summary: {
          file_count: 2,
          total_bytes: 12,
        },
      },
    });

    const out = await verifyDatasetMaterialAgainstReceiptOrBundle({
      bundle: { any: true },
      root_dir: "/tmp/data",
    });

    expect(out.ok).toBe(true);
    expect(out.mismatches).toEqual([]);
  });

  it("verifyDatasetMaterialAgainstReceiptOrBundle includes bundle-check mismatches and local-vs-bundle mismatches", async () => {
    const { verifyDatasetMaterialAgainstReceiptOrBundle } = await import("../../../../src/datasets/verifier.js");

    parseDatasetBundleV1Mock.mockReturnValue({
      dataset_identity: {
        dataset_key: "dataset.material.4",
      },
      rules: {
        redact_paths: false,
        follow_symlinks: false,
      },
      files: [
        { bytes: 1, leaf_hash: "a" },
        { bytes: 2, leaf_hash: "b" },
      ],
      merkle: {
        leaf_count: 99,
        root: "wrong-root",
      },
      summary: {
        file_count: 7,
        total_bytes: 999,
      },
    });

    executeAnchorMock.mockResolvedValue({
      dataset_fingerprint: "local-fp",
      bundle_digest: "local-bundle",
      merkle_root: "local-root",
      idempotency_key: "local-idem",
      bundle: {
        summary: {
          file_count: 2,
          total_bytes: 3,
        },
      },
    });

    const out = await verifyDatasetMaterialAgainstReceiptOrBundle({
      bundle: { any: true },
      root_dir: "/tmp/data",
    });

    expect(out.ok).toBe(false);
    expect(out.mismatches).toEqual([
      { field: "merkle.leaf_count", expected: 2, actual: 99 },
      { field: "merkle.root", expected: "merkle-root-recomputed", actual: "wrong-root" },
      { field: "summary.file_count", expected: 2, actual: 7 },
      { field: "summary.total_bytes", expected: 3, actual: 999 },
      { field: "local.bundle_digest", expected: "bundle-digest-recomputed", actual: "local-bundle" },
      { field: "local.dataset_fingerprint", expected: "dataset-fingerprint-recomputed", actual: "local-fp" },
      { field: "local.merkle_root", expected: "merkle-root-recomputed", actual: "local-root" },
    ]);
  });

  it("verifyDatasetMaterialAgainstReceiptOrBundle merges receipt and bundle mismatch sets together", async () => {
    const { verifyDatasetMaterialAgainstReceiptOrBundle } = await import("../../../../src/datasets/verifier.js");

    parseDatasetReceiptV1Mock.mockReturnValue({
      dataset_identity: {
        dataset_key: "dataset.material.5",
      },
      rules: {
        redact_paths: false,
        follow_symlinks: false,
      },
      evidence: {
        dataset_fingerprint: "receipt-fp",
        bundle_digest: "receipt-bundle",
        merkle_root: "receipt-root",
        idempotency_key: "receipt-idem",
        file_count: 7,
        total_bytes: 700,
      },
    });

    parseDatasetBundleV1Mock.mockReturnValue({
      dataset_identity: {
        dataset_key: "dataset.material.5",
      },
      rules: {
        redact_paths: false,
        follow_symlinks: false,
      },
      files: [
        { bytes: 1, leaf_hash: "a" },
      ],
      merkle: {
        leaf_count: 1,
        root: "wrong-root",
      },
      summary: {
        file_count: 9,
        total_bytes: 999,
      },
    });

    merkleRootMock.mockReturnValue({
      leaf_count: 1,
      root: "merkle-root-recomputed",
    });

    executeAnchorMock.mockResolvedValue({
      dataset_fingerprint: "local-fp",
      bundle_digest: "local-bundle",
      merkle_root: "local-root",
      idempotency_key: "local-idem",
      bundle: {
        summary: {
          file_count: 1,
          total_bytes: 1,
        },
      },
    });

    const out = await verifyDatasetMaterialAgainstReceiptOrBundle({
      receipt: { receipt: true },
      bundle: { bundle: true },
      root_dir: "/tmp/data",
    });

    expect(out.ok).toBe(false);
    expect(out.mismatches.length).toBeGreaterThan(0);
    expect(out.computed).toEqual({
      local_dataset_fingerprint: "local-fp",
      local_bundle_digest: "local-bundle",
      local_merkle_root: "local-root",
      local_idempotency_key: "local-idem",
      local_file_count: 1,
      local_total_bytes: 1,
    });
  });
});