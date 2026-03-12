// ============================================================================
// File: tests/units/datasets/bundle.test.ts
// Version: 1.0.0-hf-datasets-bundle-unit | 2026-03-07
// Purpose:
//   Unit tests for src/datasets/bundle.ts
// Notes:
//   - Pure deterministic tests.
//   - Mocks hashing contract boundary to verify exact domain/value wiring.
//   - Matches current implementation behavior.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const hashJsonDigestMock = vi.fn((input: any) => {
  return `digest:${input.domain}:${JSON.stringify(input.value)}`;
});

vi.mock("../../../../src/hashing/contract.js", () => ({
  HF_HASH_CONTRACT_INFO: Object.freeze({
    contract_id: "hf-contract-v1",
    frame: "hf:frame:v1",
    canonical_json: "hf:canonical-json:v1",
    algorithm: "sha3-512",
    encoding: "hex_lower",
  }),
  hashJsonDigest: hashJsonDigestMock,
}));

describe("datasets/bundle (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buildBundleV1 builds deterministic bundle with summary, rules, and optional identity fields", async () => {
    const { buildBundleV1 } = await import("../../../../src/datasets/bundle.js");

    const files = Object.freeze([
      Object.freeze({
        path_rel: "a.tsv",
        bytes: 10,
        sha3_512: "a".repeat(128),
        leaf_hash: "b".repeat(128),
      }),
      Object.freeze({
        path_rel: "nested/b.tsv",
        bytes: 20,
        sha3_512: "c".repeat(128),
        leaf_hash: "d".repeat(128),
      }),
    ]) as any;

    const bundle = buildBundleV1({
      identity: {
        dataset_key: "dataset.1",
        version_label: "v1",
        program: "sage",
      } as any,
      rules: {
        follow_symlinks: true,
        redact_paths: true,
        include_globs: ["**/*.tsv"],
        exclude_globs: ["tmp/**"],
        allowed_suffixes: [".tsv", ".csv"],
      } as any,
      files,
      merkle: {
        leaf_count: 2,
        root: "ABCDEF1234",
      } as any,
    });

    expect(bundle).toEqual({
      bundle_version: "v1",
      hash_contract: {
        contract_id: "hf-contract-v1",
        frame: "hf:frame:v1",
        canonical_json: "hf:canonical-json:v1",
        algorithm: "sha3-512",
        encoding: "hex_lower",
      },
      dataset_identity: {
        dataset_key: "dataset.1",
        version_label: "v1",
        program: "sage",
      },
      rules: {
        path_normalization: "posix_rel_no_dotdot",
        follow_symlinks: true,
        redact_paths: true,
        ordering: "path_rel_ascii_asc",
        merkle_rule: "dup_last_on_odd",
        include_globs: ["**/*.tsv"],
        exclude_globs: ["tmp/**"],
        allowed_suffixes: [".tsv", ".csv"],
      },
      files,
      merkle: {
        leaf_count: 2,
        root: "ABCDEF1234",
      },
      summary: {
        file_count: 2,
        total_bytes: 30,
      },
    });

    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.dataset_identity)).toBe(true);
    expect(Object.isFrozen(bundle.rules)).toBe(true);
    expect(Object.isFrozen(bundle.files)).toBe(true);
    expect(Object.isFrozen(bundle.merkle)).toBe(true);
    expect(Object.isFrozen(bundle.summary)).toBe(true);
  });

  it("buildBundleV1 omits optional identity fields and optional rule arrays when absent", async () => {
    const { buildBundleV1 } = await import("../../../../src/datasets/bundle.js");

    const bundle = buildBundleV1({
      identity: {
        dataset_key: "dataset.2",
      } as any,
      rules: {
        follow_symlinks: false,
        redact_paths: false,
      } as any,
      files: [
        {
          path_rel: "only.tsv",
          bytes: 5,
          sha3_512: "a".repeat(128),
          leaf_hash: "b".repeat(128),
        },
      ] as any,
      merkle: {
        leaf_count: 1,
        root: "f".repeat(128),
      } as any,
    });

    expect(bundle.dataset_identity).toEqual({
      dataset_key: "dataset.2",
    });

    expect(bundle.rules).toEqual({
      path_normalization: "posix_rel_no_dotdot",
      follow_symlinks: false,
      redact_paths: false,
      ordering: "path_rel_ascii_asc",
      merkle_rule: "dup_last_on_odd",
    });
  });

  it("buildBundleV1 sums bytes conservatively when values are numeric-like or invalid", async () => {
    const { buildBundleV1 } = await import("../../../../src/datasets/bundle.js");

    const bundle = buildBundleV1({
      identity: {
        dataset_key: "dataset.3",
      } as any,
      files: [
        {
          path_rel: "a.tsv",
          bytes: 10,
          sha3_512: "a".repeat(128),
          leaf_hash: "b".repeat(128),
        },
        {
          path_rel: "b.tsv",
          bytes: "7" as any,
          sha3_512: "c".repeat(128),
          leaf_hash: "d".repeat(128),
        },
        {
          path_rel: "c.tsv",
          bytes: "nope" as any,
          sha3_512: "e".repeat(128),
          leaf_hash: "f".repeat(128),
        },
      ] as any,
      merkle: {
        leaf_count: 3,
        root: "1".repeat(128),
      } as any,
    });

    expect(bundle.summary).toEqual({
      file_count: 3,
      total_bytes: 17,
    });
  });

  it("bundleDigest hashes bundle under the dataset bundle domain", async () => {
    const { bundleDigest } = await import("../../../../src/datasets/bundle.js");

    const bundle = Object.freeze({
      bundle_version: "v1",
      dataset_identity: { dataset_key: "dataset.4" },
    }) as any;

    const out = bundleDigest(bundle);

    expect(out).toBe(`digest:va:dataset:bundle:v1:${JSON.stringify(bundle)}`);
    expect(hashJsonDigestMock).toHaveBeenCalledWith({
      domain: "va:dataset:bundle:v1",
      value: bundle,
      alg: "sha3-512",
      encoding: "hex_lower",
    });
  });

  it("datasetFingerprint hashes bundle under the dataset fingerprint domain", async () => {
    const { datasetFingerprint } = await import("../../../../src/datasets/bundle.js");

    const bundle = Object.freeze({
      bundle_version: "v1",
      dataset_identity: { dataset_key: "dataset.5" },
    }) as any;

    const out = datasetFingerprint(bundle);

    expect(out).toBe(`digest:va:dataset:fingerprint:v1:${JSON.stringify(bundle)}`);
    expect(hashJsonDigestMock).toHaveBeenCalledWith({
      domain: "va:dataset:fingerprint:v1",
      value: bundle,
      alg: "sha3-512",
      encoding: "hex_lower",
    });
  });

  it("idempotencyKey hashes dataset_key + fingerprint with explicit null separator payload", async () => {
    const { idempotencyKey } = await import("../../../../src/datasets/bundle.js");

    const out = idempotencyKey("dataset.6", "fp-123");

    expect(out).toBe(
      `digest:va:dataset:idem:v1:${JSON.stringify({
        dataset_key: "dataset.6",
        fingerprint: "fp-123",
        sep: "\u0000",
        combined: "dataset.6\u0000fp-123",
      })}`,
    );

    expect(hashJsonDigestMock).toHaveBeenCalledWith({
      domain: "va:dataset:idem:v1",
      value: {
        dataset_key: "dataset.6",
        fingerprint: "fp-123",
        sep: "\u0000",
        combined: "dataset.6\u0000fp-123",
      },
      alg: "sha3-512",
      encoding: "hex_lower",
    });
  });
});