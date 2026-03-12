// ============================================================================
// File: tests/units/src/datasets/validators.test.ts
// Version: 1.0.0-hf-datasets-validators-unit | 2026-03-07
// Purpose:
//   Unit tests for src/datasets/validators.ts
// Notes:
//   - Covers plan request, execute request, bundle, receipt, and verify request.
//   - Mocks hash contract boundary for deterministic bundle contract checks.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/hashing/contract.js", () => ({
  HF_HASH_CONTRACT_INFO: Object.freeze({
    contract_id: "hf-contract-v1",
    frame: "hf:frame:v1",
    canonical_json: "hf:canonical-json:v1",
    algorithm: "sha3-512",
    encoding: "hex_lower",
  }),
}));

const HEX512_A = "a".repeat(128);
const HEX512_B = "b".repeat(128);
const HEX512_C = "c".repeat(128);
const HEX512_D = "d".repeat(128);

describe("datasets/validators (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parseAnchorPlanRequestV1 parses a valid request with normalized optional rules", async () => {
    const { parseAnchorPlanRequestV1 } = await import("../../../../src/datasets/validators.js");

    const out = parseAnchorPlanRequestV1({
      mode: "register_and_anchor",
      identity: {
        dataset_key: "org.sage.dataset.v1",
        version_label: "v1",
        program: "sage",
      },
      rules: {
        redact_paths: "true",
        follow_symlinks: false,
        include_globs: [" keep/*.tsv ", "nested/**"],
        exclude_globs: ["tmp/**"],
        allowed_suffixes: [".TSV", ".CSV"],
        max_files: 10,
        max_total_bytes: 1000,
        max_single_file_bytes: 250,
      },
    });

    expect(out).toEqual({
      mode: "register_and_anchor",
      identity: {
        dataset_key: "org.sage.dataset.v1",
        version_label: "v1",
        program: "sage",
      },
      rules: {
        redact_paths: true,
        follow_symlinks: false,
        include_globs: ["keep/*.tsv", "nested/**"],
        exclude_globs: ["tmp/**"],
        allowed_suffixes: [".tsv", ".csv"],
        max_files: 10,
        max_total_bytes: 1000,
        max_single_file_bytes: 250,
      },
    });

    expect(Object.isFrozen(out)).toBe(true);
  });

  it("parseAnchorPlanRequestV1 rejects unknown top-level keys", async () => {
    const { parseAnchorPlanRequestV1 } = await import("../../../../src/datasets/validators.js");

    expect(() =>
      parseAnchorPlanRequestV1({
        mode: "hash_only",
        identity: {
          dataset_key: "dataset.1",
        },
        nope: true,
      }),
    ).toThrow(/AnchorPlanRequestV1_unknown_key: nope/i);
  });

  it("parseAnchorExecuteRequestV1 parses a valid register_and_anchor request", async () => {
    const { parseAnchorExecuteRequestV1 } = await import("../../../../src/datasets/validators.js");

    const out = parseAnchorExecuteRequestV1({
      mode: "register_and_anchor",
      identity: {
        dataset_key: "dataset.exec.1",
        version_label: "v1",
        program: "sage",
      },
      root_dir: " /tmp/data ",
      rules: {
        redact_paths: true,
        follow_symlinks: "false",
        allowed_suffixes: [".TSV"],
      },
      display_name: "Test Dataset",
      metadata: {
        run_id: "run-1",
        nested: { a: [1, true, null, "x"] },
      },
      evidence_pointer: "s3://bucket/evidence.json",
      set_active: "true",
    });

    expect(out).toEqual({
      mode: "register_and_anchor",
      identity: {
        dataset_key: "dataset.exec.1",
        version_label: "v1",
        program: "sage",
      },
      root_dir: "/tmp/data",
      rules: {
        redact_paths: true,
        follow_symlinks: false,
        allowed_suffixes: [".tsv"],
      },
      display_name: "Test Dataset",
      metadata: {
        run_id: "run-1",
        nested: { a: [1, true, null, "x"] },
      },
      evidence_pointer: "s3://bucket/evidence.json",
      set_active: true,
    });
  });

  it("parseAnchorExecuteRequestV1 requires evidence_pointer for register_and_anchor", async () => {
    const { parseAnchorExecuteRequestV1 } = await import("../../../../src/datasets/validators.js");

    expect(() =>
      parseAnchorExecuteRequestV1({
        mode: "register_and_anchor",
        identity: {
          dataset_key: "dataset.exec.2",
        },
        root_dir: "/tmp/data",
      }),
    ).toThrow(/evidence_pointer_required/i);
  });

  it("parseAnchorExecuteRequestV1 rejects unsafe metadata keys", async () => {
    const { parseAnchorExecuteRequestV1 } = await import("../../../../src/datasets/validators.js");

    expect(() =>
      parseAnchorExecuteRequestV1({
        mode: "hash_only",
        identity: {
          dataset_key: "dataset.exec.3",
        },
        root_dir: "/tmp/data",
        metadata: {
          constructor: "bad",
        },
      } as any),
    ).toThrow(/metadata_invalid_key/i);
  });

  it("parseAnchorExecuteRequestV1 rejects invalid root_dir", async () => {
    const { parseAnchorExecuteRequestV1 } = await import("../../../../src/datasets/validators.js");

    expect(() =>
      parseAnchorExecuteRequestV1({
        mode: "hash_only",
        identity: {
          dataset_key: "dataset.exec.4",
        },
        root_dir: "   ",
      }),
    ).toThrow(/root_dir_invalid/i);
  });

  it("parseDatasetBundleV1 parses a valid bundle with path_rel files", async () => {
    const { parseDatasetBundleV1 } = await import("../../../../src/datasets/validators.js");

    const out = parseDatasetBundleV1({
      bundle_version: "v1",
      hash_contract: {
        contract_id: "hf-contract-v1",
        frame: "hf:frame:v1",
        canonical_json: "hf:canonical-json:v1",
        algorithm: "sha3-512",
        encoding: "hex_lower",
      },
      dataset_identity: {
        dataset_key: "dataset.bundle.1",
        version_label: "v1",
        program: "sage",
      },
      rules: {
        path_normalization: "posix_rel_no_dotdot",
        follow_symlinks: false,
        redact_paths: false,
        ordering: "path_rel_ascii_asc",
        merkle_rule: "dup_last_on_odd",
        include_globs: ["**/*.tsv"],
        exclude_globs: ["tmp/**"],
        allowed_suffixes: [".TSV"],
      },
      files: [
        {
          path_rel: "a.tsv",
          bytes: 10,
          sha3_512: HEX512_A,
          leaf_hash: HEX512_B,
        },
      ],
      merkle: {
        leaf_count: 1,
        root: HEX512_C,
      },
      summary: {
        file_count: 1,
        total_bytes: 10,
      },
    });

    expect(out).toEqual({
      bundle_version: "v1",
      hash_contract: {
        contract_id: "hf-contract-v1",
        frame: "hf:frame:v1",
        canonical_json: "hf:canonical-json:v1",
        algorithm: "sha3-512",
        encoding: "hex_lower",
      },
      dataset_identity: {
        dataset_key: "dataset.bundle.1",
        version_label: "v1",
        program: "sage",
      },
      rules: {
        path_normalization: "posix_rel_no_dotdot",
        follow_symlinks: false,
        redact_paths: false,
        ordering: "path_rel_ascii_asc",
        merkle_rule: "dup_last_on_odd",
        include_globs: ["**/*.tsv"],
        exclude_globs: ["tmp/**"],
        allowed_suffixes: [".tsv"],
      },
      files: [
        {
          path_rel: "a.tsv",
          bytes: 10,
          sha3_512: HEX512_A,
          leaf_hash: HEX512_B,
        },
      ],
      merkle: {
        leaf_count: 1,
        root: HEX512_C,
      },
      summary: {
        file_count: 1,
        total_bytes: 10,
      },
    });
  });

  it("parseDatasetBundleV1 parses a valid bundle with path_hash files", async () => {
    const { parseDatasetBundleV1 } = await import("../../../../src/datasets/validators.js");

    const out = parseDatasetBundleV1({
      bundle_version: "v1",
      hash_contract: {
        contract_id: "hf-contract-v1",
        frame: "hf:frame:v1",
        canonical_json: "hf:canonical-json:v1",
        algorithm: "sha3-512",
        encoding: "hex_lower",
      },
      dataset_identity: {
        dataset_key: "dataset.bundle.2",
      },
      rules: {
        path_normalization: "posix_rel_no_dotdot",
        follow_symlinks: false,
        redact_paths: true,
        ordering: "path_rel_ascii_asc",
        merkle_rule: "dup_last_on_odd",
      },
      files: [
        {
          path_hash: HEX512_A,
          bytes: 9,
          sha3_512: HEX512_B,
          leaf_hash: HEX512_C,
        },
      ],
      merkle: {
        leaf_count: 1,
        root: HEX512_D,
      },
      summary: {
        file_count: 1,
        total_bytes: 9,
      },
    });

    expect(out.files).toEqual([
      {
        path_hash: HEX512_A,
        bytes: 9,
        sha3_512: HEX512_B,
        leaf_hash: HEX512_C,
      },
    ]);
  });

  it("parseDatasetBundleV1 rejects hash contract mismatches", async () => {
    const { parseDatasetBundleV1 } = await import("../../../../src/datasets/validators.js");

    expect(() =>
      parseDatasetBundleV1({
        bundle_version: "v1",
        hash_contract: {
          contract_id: "wrong",
          frame: "hf:frame:v1",
          canonical_json: "hf:canonical-json:v1",
          algorithm: "sha3-512",
          encoding: "hex_lower",
        },
        dataset_identity: {
          dataset_key: "dataset.bundle.bad",
        },
        rules: {
          path_normalization: "posix_rel_no_dotdot",
          follow_symlinks: false,
          redact_paths: false,
          ordering: "path_rel_ascii_asc",
          merkle_rule: "dup_last_on_odd",
        },
        files: [
          {
            path_rel: "a.tsv",
            bytes: 1,
            sha3_512: HEX512_A,
            leaf_hash: HEX512_B,
          },
        ],
        merkle: {
          leaf_count: 1,
          root: HEX512_C,
        },
        summary: {
          file_count: 1,
          total_bytes: 1,
        },
      }),
    ).toThrow(/hash_contract_contract_id_mismatch/i);
  });

  it("parseDatasetBundleV1 rejects invalid file path variants", async () => {
    const { parseDatasetBundleV1 } = await import("../../../../src/datasets/validators.js");

    expect(() =>
      parseDatasetBundleV1({
        bundle_version: "v1",
        hash_contract: {
          contract_id: "hf-contract-v1",
          frame: "hf:frame:v1",
          canonical_json: "hf:canonical-json:v1",
          algorithm: "sha3-512",
          encoding: "hex_lower",
        },
        dataset_identity: {
          dataset_key: "dataset.bundle.bad2",
        },
        rules: {
          path_normalization: "posix_rel_no_dotdot",
          follow_symlinks: false,
          redact_paths: false,
          ordering: "path_rel_ascii_asc",
          merkle_rule: "dup_last_on_odd",
        },
        files: [
          {
            path_rel: "a.tsv",
            path_hash: HEX512_A,
            bytes: 1,
            sha3_512: HEX512_B,
            leaf_hash: HEX512_C,
          },
        ],
        merkle: {
          leaf_count: 1,
          root: HEX512_D,
        },
        summary: {
          file_count: 1,
          total_bytes: 1,
        },
      }),
    ).toThrow(/file_path_variant_invalid/i);
  });

  it("parseDatasetReceiptV1 parses a valid receipt with optional blocks", async () => {
    const { parseDatasetReceiptV1 } = await import("../../../../src/datasets/validators.js");

    const out = parseDatasetReceiptV1({
      v: "v1",
      kind: "dataset_anchor_receipt",
      receipt_id: HEX512_A,
      mode: "register_and_anchor",
      dataset_identity: {
        dataset_key: "dataset.receipt.1",
        version_label: "v1",
        program: "sage",
      },
      rules: {
        path_normalization: "posix_rel_no_dotdot",
        follow_symlinks: false,
        redact_paths: true,
        ordering: "path_rel_ascii_asc",
        merkle_rule: "dup_last_on_odd",
      },
      evidence: {
        dataset_fingerprint: HEX512_B,
        bundle_digest: HEX512_C,
        merkle_root: HEX512_D,
        idempotency_key: HEX512_A,
        file_count: 2,
        total_bytes: 20,
      },
      pointers: {
        evidence_pointer: "s3://bucket/evidence.json",
      },
      core: {
        dataset: {
          id: "ds-1",
        },
      },
    });

    expect(out).toEqual({
      v: "v1",
      kind: "dataset_anchor_receipt",
      receipt_id: HEX512_A,
      mode: "register_and_anchor",
      dataset_identity: {
        dataset_key: "dataset.receipt.1",
        version_label: "v1",
        program: "sage",
      },
      rules: {
        path_normalization: "posix_rel_no_dotdot",
        follow_symlinks: false,
        redact_paths: true,
        ordering: "path_rel_ascii_asc",
        merkle_rule: "dup_last_on_odd",
      },
      evidence: {
        dataset_fingerprint: HEX512_B,
        bundle_digest: HEX512_C,
        merkle_root: HEX512_D,
        idempotency_key: HEX512_A,
        file_count: 2,
        total_bytes: 20,
      },
      pointers: {
        evidence_pointer: "s3://bucket/evidence.json",
      },
      core: {
        dataset: {
          id: "ds-1",
        },
      },
    });
  });

  it("parseDatasetReceiptV1 rejects invalid receipt_id and invalid evidence shape", async () => {
    const { parseDatasetReceiptV1 } = await import("../../../../src/datasets/validators.js");

    expect(() =>
      parseDatasetReceiptV1({
        v: "v1",
        kind: "dataset_anchor_receipt",
        receipt_id: "not-hex",
        mode: "hash_only",
        dataset_identity: {
          dataset_key: "dataset.receipt.bad",
        },
        rules: {},
        evidence: {
          dataset_fingerprint: HEX512_B,
          bundle_digest: HEX512_C,
          merkle_root: HEX512_D,
          idempotency_key: HEX512_A,
          file_count: 1,
          total_bytes: 1,
        },
      }),
    ).toThrow(/receipt_id_invalid/i);

    expect(() =>
      parseDatasetReceiptV1({
        v: "v1",
        kind: "dataset_anchor_receipt",
        receipt_id: HEX512_A,
        mode: "hash_only",
        dataset_identity: {
        dataset_key: "dataset.receipt.bad2",
        },
        rules: {},
        evidence: {
        dataset_fingerprint: HEX512_B,
        bundle_digest: HEX512_C,
        merkle_root: HEX512_D,
        idempotency_key: "not-hex",
        file_count: 1,
        total_bytes: 1,
        },
      }),
    ).toThrow(/idempotency_key_invalid_hex512/i);
  });

  it("parseDatasetVerifyRequestV1 parses receipt/bundle/root_dir combinations", async () => {
    const { parseDatasetVerifyRequestV1 } = await import("../../../../src/datasets/validators.js");

    const out = parseDatasetVerifyRequestV1({
      receipt: {
        v: "v1",
        kind: "dataset_anchor_receipt",
        receipt_id: HEX512_A,
        mode: "hash_only",
        dataset_identity: {
          dataset_key: "dataset.verify.1",
        },
        rules: {},
        evidence: {
          dataset_fingerprint: HEX512_B,
          bundle_digest: HEX512_C,
          merkle_root: HEX512_D,
          idempotency_key: HEX512_A,
          file_count: 1,
          total_bytes: 1,
        },
      },
      root_dir: " /tmp/data ",
    });

    expect(out).toEqual({
      receipt: {
        v: "v1",
        kind: "dataset_anchor_receipt",
        receipt_id: HEX512_A,
        mode: "hash_only",
        dataset_identity: {
          dataset_key: "dataset.verify.1",
        },
        rules: {},
        evidence: {
          dataset_fingerprint: HEX512_B,
          bundle_digest: HEX512_C,
          merkle_root: HEX512_D,
          idempotency_key: HEX512_A,
          file_count: 1,
          total_bytes: 1,
        },
      },
      root_dir: "/tmp/data",
    });
  });

  it("parseDatasetVerifyRequestV1 requires receipt or bundle", async () => {
    const { parseDatasetVerifyRequestV1 } = await import("../../../../src/datasets/validators.js");

    expect(() => parseDatasetVerifyRequestV1({})).toThrow(/verify_requires_receipt_or_bundle/i);
  });

  it("parseDatasetVerifyRequestV1 rejects invalid root_dir", async () => {
    const { parseDatasetVerifyRequestV1 } = await import("../../../../src/datasets/validators.js");

    expect(() =>
      parseDatasetVerifyRequestV1({
        receipt: {
          v: "v1",
          kind: "dataset_anchor_receipt",
          receipt_id: HEX512_A,
          mode: "hash_only",
          dataset_identity: {
            dataset_key: "dataset.verify.2",
          },
          rules: {},
          evidence: {
            dataset_fingerprint: HEX512_B,
            bundle_digest: HEX512_C,
            merkle_root: HEX512_D,
            idempotency_key: HEX512_A,
            file_count: 1,
            total_bytes: 1,
          },
        },
        root_dir: "   ",
      }),
    ).toThrow(/root_dir_invalid/i);
  });
});