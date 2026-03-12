// ============================================================================
// File: tests/units/src/datasets/workflow.test.ts
// Version: 1.0.0-hf-datasets-workflow-unit | 2026-03-07
// Purpose:
//   Unit tests for src/datasets/workflow.ts
// Notes:
//   - Focuses on exported orchestration boundaries:
//       • planAnchor()
//       • executeAnchor()
//   - Uses mocks for scan/hash/merkle/bundle/validation boundaries.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const scanDatasetMock = vi.fn();
vi.mock("../../../../src/datasets/scan.js", () => ({
  scanDataset: scanDatasetMock,
}));

const hashFilesMock = vi.fn();
vi.mock("../../../../src/datasets/fileHash.js", () => ({
  hashFiles: hashFilesMock,
}));

const merkleRootMock = vi.fn();
vi.mock("../../../../src/datasets/merkle.js", () => ({
  merkleRoot: merkleRootMock,
}));

const buildBundleV1Mock = vi.fn();
const bundleDigestMock = vi.fn();
const datasetFingerprintMock = vi.fn();
const idempotencyKeyMock = vi.fn();
vi.mock("../../../../src/datasets/bundle.js", () => ({
  buildBundleV1: buildBundleV1Mock,
  bundleDigest: bundleDigestMock,
  datasetFingerprint: datasetFingerprintMock,
  idempotencyKey: idempotencyKeyMock,
}));

const parseAnchorPlanRequestV1Mock = vi.fn();
vi.mock("../../../../src/datasets/validators.js", () => ({
  parseAnchorPlanRequestV1: parseAnchorPlanRequestV1Mock,
}));

const hashJsonDigestMock = vi.fn((input: any) => `plan:${input.domain}:${JSON.stringify(input.value)}`);
vi.mock("../../../../src/hashing/contract.js", () => ({
  hashJsonDigest: hashJsonDigestMock,
}));

describe("datasets/workflow (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    buildBundleV1Mock.mockReturnValue(Object.freeze({ bundle_version: "v1", ok: true }));
    bundleDigestMock.mockReturnValue("bundle-digest-1");
    datasetFingerprintMock.mockReturnValue("dataset-fingerprint-1");
    idempotencyKeyMock.mockReturnValue("idem-1");
    merkleRootMock.mockReturnValue({
      leaf_count: 2,
      root: "merkle-root-1",
    });
  });

  it("planAnchor returns deterministic plan for register_and_anchor", async () => {
    const { planAnchor } = await import("../../../../src/datasets/workflow.js");

    parseAnchorPlanRequestV1Mock.mockReturnValue({
      mode: "register_and_anchor",
      identity: {
        dataset_key: "org.sage.dataset.v1",
        version_label: "v1",
        program: "sage",
      },
      rules: {
        redact_paths: true,
        follow_symlinks: false,
      },
    });

    const plan = planAnchor({ anything: true } as any);

    expect(plan).toEqual({
      dataset_key: "org.sage.dataset.v1",
      plan_id: expect.stringContaining("va:dataset:plan:v1"),
      steps: ["scan", "hash", "bundle", "core_upsert", "core_version", "core_publish"],
    });

    expect(hashJsonDigestMock).toHaveBeenCalledWith({
      domain: "va:dataset:plan:v1",
      value: {
        dataset_key: "org.sage.dataset.v1",
        version_label: "v1",
        program: "sage",
        rules: {
          redact_paths: true,
          follow_symlinks: false,
        },
        mode: "register_and_anchor",
      },
      alg: "sha3-512",
      encoding: "hex_lower",
    });
  });

  it("planAnchor returns scan/hash/bundle for hash_only", async () => {
    const { planAnchor } = await import("../../../../src/datasets/workflow.js");

    parseAnchorPlanRequestV1Mock.mockReturnValue({
      mode: "hash_only",
      identity: {
        dataset_key: "dataset.hash.only",
      },
      rules: undefined,
    });

    const plan = planAnchor({} as any);

    expect(plan.steps).toEqual(["scan", "hash", "bundle"]);
  });

  it("planAnchor throws INPUT_INVALID when dataset_key trims to empty", async () => {
    const { planAnchor } = await import("../../../../src/datasets/workflow.js");

    parseAnchorPlanRequestV1Mock.mockReturnValue({
      mode: "hash_only",
      identity: {
        dataset_key: "   ",
      },
    });

    expect(() => planAnchor({} as any)).toThrow(/dataset_key_required/i);
  });

  it("executeAnchor runs scan -> hash -> merkle -> bundle and returns derived result", async () => {
    const { executeAnchor } = await import("../../../../src/datasets/workflow.js");

    const scanned = Object.freeze([
      Object.freeze({ path_rel: "a.tsv", abs_path: "/tmp/data/a.tsv", bytes: 10 }),
      Object.freeze({ path_rel: "b.tsv", abs_path: "/tmp/data/b.tsv", bytes: 20 }),
    ]);

    const hashed = Object.freeze([
      Object.freeze({ path_rel: "a.tsv", bytes: 10, sha3_512: "sha-a", leaf_hash: "leaf-a" }),
      Object.freeze({ path_rel: "b.tsv", bytes: 20, sha3_512: "sha-b", leaf_hash: "leaf-b" }),
    ]);

    scanDatasetMock.mockResolvedValue(scanned);
    hashFilesMock.mockResolvedValue(hashed);

    const onScanProgress = vi.fn();
    const onHashProgress = vi.fn();

    const result = await executeAnchor(
      {
        mode: "hash_only",
        identity: {
          dataset_key: "dataset.exec.1",
          version_label: "v1",
          program: "sage",
        },
        root_dir: "/tmp/data",
        rules: {
          redact_paths: true,
          follow_symlinks: false,
        },
      },
      {
        onScanProgress,
        onHashProgress,
      },
    );

    expect(scanDatasetMock).toHaveBeenCalledWith(
      "/tmp/data",
      {
        redact_paths: true,
        follow_symlinks: false,
      },
      onScanProgress,
    );

    expect(hashFilesMock).toHaveBeenCalledWith(
      scanned,
      {
        redact_paths: true,
        follow_symlinks: false,
      },
      onHashProgress,
    );

    expect(merkleRootMock).toHaveBeenCalledWith(hashed);

    expect(buildBundleV1Mock).toHaveBeenCalledWith({
      identity: {
        dataset_key: "dataset.exec.1",
        version_label: "v1",
        program: "sage",
      },
      rules: {
        redact_paths: true,
        follow_symlinks: false,
      },
      files: hashed,
      merkle: {
        leaf_count: 2,
        root: "merkle-root-1",
      },
    });

    expect(bundleDigestMock).toHaveBeenCalledWith({ bundle_version: "v1", ok: true });
    expect(datasetFingerprintMock).toHaveBeenCalledWith({ bundle_version: "v1", ok: true });
    expect(idempotencyKeyMock).toHaveBeenCalledWith("dataset.exec.1", "dataset-fingerprint-1");

    expect(result).toEqual({
      dataset_key: "dataset.exec.1",
      dataset_fingerprint: "dataset-fingerprint-1",
      bundle_digest: "bundle-digest-1",
      merkle_root: "merkle-root-1",
      bundle: { bundle_version: "v1", ok: true },
      idempotency_key: "idem-1",
    });
  });

  it("executeAnchor omits rules when none are provided", async () => {
    const { executeAnchor } = await import("../../../../src/datasets/workflow.js");

    const scanned = Object.freeze([
      Object.freeze({ path_rel: "a.tsv", abs_path: "/tmp/data/a.tsv", bytes: 10 }),
    ]);

    const hashed = Object.freeze([
      Object.freeze({ path_rel: "a.tsv", bytes: 10, sha3_512: "sha-a", leaf_hash: "leaf-a" }),
    ]);

    scanDatasetMock.mockResolvedValue(scanned);
    hashFilesMock.mockResolvedValue(hashed);
    merkleRootMock.mockReturnValue({
      leaf_count: 1,
      root: "merkle-root-1",
    });

    await executeAnchor({
      identity: {
        dataset_key: "dataset.exec.2",
      },
      root_dir: "/tmp/data",
    } as any);

    expect(buildBundleV1Mock).toHaveBeenCalledWith({
      identity: {
        dataset_key: "dataset.exec.2",
      },
      files: hashed,
      merkle: {
        leaf_count: 1,
        root: "merkle-root-1",
      },
    });
  });

  it("executeAnchor throws INPUT_INVALID when dataset_key trims to empty", async () => {
    const { executeAnchor } = await import("../../../../src/datasets/workflow.js");

    await expect(
      executeAnchor({
        identity: {
          dataset_key: "   ",
        },
        root_dir: "/tmp/data",
      } as any),
    ).rejects.toMatchObject({
      name: "DatasetError",
      message: "dataset_key_required",
      code: "INPUT_INVALID",
      statusCode: 400,
    });
  });

  it("executeAnchor throws INPUT_INVALID when root_dir trims to empty", async () => {
    const { executeAnchor } = await import("../../../../src/datasets/workflow.js");

    await expect(
      executeAnchor({
        identity: {
          dataset_key: "dataset.exec.3",
        },
        root_dir: "   ",
      } as any),
    ).rejects.toMatchObject({
      name: "DatasetError",
      message: "root_dir_required",
      code: "INPUT_INVALID",
      statusCode: 400,
    });
  });

  it("executeAnchor propagates scanDataset failures", async () => {
    const { executeAnchor } = await import("../../../../src/datasets/workflow.js");

    const cause = new Error("scan failed");
    scanDatasetMock.mockRejectedValue(cause);

    await expect(
      executeAnchor({
        identity: {
          dataset_key: "dataset.exec.4",
        },
        root_dir: "/tmp/data",
      } as any),
    ).rejects.toBe(cause);

    expect(hashFilesMock).not.toHaveBeenCalled();
    expect(merkleRootMock).not.toHaveBeenCalled();
    expect(buildBundleV1Mock).not.toHaveBeenCalled();
  });

  it("executeAnchor propagates hashFiles failures", async () => {
    const { executeAnchor } = await import("../../../../src/datasets/workflow.js");

    const scanned = Object.freeze([
      Object.freeze({ path_rel: "a.tsv", abs_path: "/tmp/data/a.tsv", bytes: 10 }),
    ]);

    scanDatasetMock.mockResolvedValue(scanned);

    const cause = new Error("hash failed");
    hashFilesMock.mockRejectedValue(cause);

    await expect(
      executeAnchor({
        identity: {
          dataset_key: "dataset.exec.5",
        },
        root_dir: "/tmp/data",
      } as any),
    ).rejects.toBe(cause);

    expect(merkleRootMock).not.toHaveBeenCalled();
    expect(buildBundleV1Mock).not.toHaveBeenCalled();
  });
});