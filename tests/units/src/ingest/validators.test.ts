// ============================================================================
// File: tests/units/ingest/validators.test.ts
// Version: 1.0.0-hf-ingest-validators-unit | 2026-03-07
// Purpose:
//   Unit tests for src/ingest/validators.ts
// Notes:
//   - Covers execute request, bundle, receipt, plan request, and verify request.
//   - Mocks path normalization + hash contract boundary for deterministic tests.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const normalizeRelPathMock = vi.fn((p: string) => String(p).replace(/\\/g, "/").replace(/^\.\/+/, ""));

vi.mock("../../../../src/ingest/pathNorm.js", () => ({
  normalizeRelPath: normalizeRelPathMock,
}));

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

describe("ingest/validators (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parseIngestExecuteRequestV1 parses a valid file_set request with normalized rules and metadata", async () => {
    const { parseIngestExecuteRequestV1 } = await import("../../../../src/ingest/validators.js");

    const out = parseIngestExecuteRequestV1({
      mode: "register_and_anchor",
      identity: {
        object_key: "org.prog.bundle.v1",
        object_kind: "file_set",
        version_label: "v1",
        program: "sage",
      },
      material: {
        kind: "file_set",
        root_dir: "/tmp/data",
        rules: {
          include_globs: [" keep/a.tsv ", "drop/b.tsv"],
          exclude_globs: ["tmp/**"],
          allowed_suffixes: [".TSV", ".CSV"],
          max_files: 10,
          max_total_bytes: 1000,
          max_single_file_bytes: 250,
          follow_symlinks: "true",
          redact_paths: false,
          normalize_line_endings: "false",
        },
      },
      metadata: {
        run_id: "run-1",
        nested: { a: [1, true, null, "x"] },
      },
      evidence_pointer: "s3://bucket/evidence.json",
      domain: "genomics",
      proof_date: "2026-03-06",
    });

    expect(out).toEqual({
      mode: "register_and_anchor",
      identity: {
        object_key: "org.prog.bundle.v1",
        object_kind: "file_set",
        version_label: "v1",
        program: "sage",
      },
      material: {
        kind: "file_set",
        root_dir: "/tmp/data",
        rules: {
          include_globs: ["keep/a.tsv", "drop/b.tsv"],
          exclude_globs: ["tmp/**"],
          allowed_suffixes: [".tsv", ".csv"],
          max_files: 10,
          max_total_bytes: 1000,
          max_single_file_bytes: 250,
          follow_symlinks: true,
          redact_paths: false,
          normalize_line_endings: false,
        },
      },
      metadata: {
        run_id: "run-1",
        nested: { a: [1, true, null, "x"] },
      },
      evidence_pointer: "s3://bucket/evidence.json",
      domain: "genomics",
      proof_date: "2026-03-06",
    });

    expect(Object.isFrozen(out)).toBe(true);
    expect(normalizeRelPathMock).not.toHaveBeenCalled();
  });

  it("parseIngestExecuteRequestV1 rejects unknown top-level keys", async () => {
    const { parseIngestExecuteRequestV1 } = await import("../../../../src/ingest/validators.js");

    expect(() =>
      parseIngestExecuteRequestV1({
        mode: "hash_only",
        identity: {
          object_key: "obj.1",
          object_kind: "json",
        },
        material: {
          kind: "json",
          value: { a: 1 },
        },
        nope: true,
      }),
    ).toThrow(/IngestExecuteRequestV1_unknown_key: nope/i);
  });

  it("parseIngestExecuteRequestV1 rejects identity/material kind mismatch", async () => {
    const { parseIngestExecuteRequestV1 } = await import("../../../../src/ingest/validators.js");

    expect(() =>
      parseIngestExecuteRequestV1({
        mode: "hash_only",
        identity: {
          object_key: "obj.1",
          object_kind: "json",
        },
        material: {
          kind: "text",
          text: "hello",
        },
      }),
    ).toThrow(/identity_material_kind_mismatch/i);
  });

  it("parseIngestExecuteRequestV1 requires domain for register_and_anchor", async () => {
    const { parseIngestExecuteRequestV1 } = await import("../../../../src/ingest/validators.js");

    expect(() =>
      parseIngestExecuteRequestV1({
        mode: "register_and_anchor",
        identity: {
          object_key: "obj.1",
          object_kind: "json",
        },
        material: {
          kind: "json",
          value: { a: 1 },
        },
      }),
    ).toThrow(/domain_required/i);
  });

  it("parseIngestExecuteRequestV1 rejects invalid proof_date format", async () => {
    const { parseIngestExecuteRequestV1 } = await import("../../../../src/ingest/validators.js");

    expect(() =>
      parseIngestExecuteRequestV1({
        mode: "hash_only",
        identity: {
          object_key: "obj.1",
          object_kind: "json",
        },
        material: {
          kind: "json",
          value: { a: 1 },
        },
        proof_date: "03-06-2026",
      }),
    ).toThrow(/proof_date_invalid/i);
  });

  it("parseIngestExecuteRequestV1 rejects unsafe metadata keys and invalid numbers", async () => {
    const { parseIngestExecuteRequestV1 } = await import("../../../../src/ingest/validators.js");

    expect(() =>
      parseIngestExecuteRequestV1({
        mode: "hash_only",
        identity: {
          object_key: "obj.1",
          object_kind: "json",
        },
        material: {
          kind: "json",
          value: { a: 1 },
        },
        metadata: {
          constructor: "bad",
        },
      } as any),
    ).toThrow(/metadata_invalid_key/i);

    expect(() =>
      parseIngestExecuteRequestV1({
        mode: "hash_only",
        identity: {
          object_key: "obj.1",
          object_kind: "json",
        },
        material: {
          kind: "json",
          value: { a: 1 },
        },
        metadata: {
          value: Number.NaN,
        },
      }),
    ).toThrow(/metadata_invalid_number/i);
  });

  it("parseIngestPlanRequestV1 strips execute-only fields and keeps plan fields", async () => {
    const { parseIngestPlanRequestV1 } = await import("../../../../src/ingest/validators.js");

    const out = parseIngestPlanRequestV1({
      mode: "register_and_anchor",
      identity: {
        object_key: "obj.plan.1",
        object_kind: "file_set",
      },
      material: {
        kind: "file_set",
        root_dir: "/tmp/data",
      },
      metadata: { ignored: true },
      evidence_pointer: "file:///tmp/evidence.json",
      domain: "rna",
      proof_date: "2026-03-06",
    });

    expect(out).toEqual({
      mode: "register_and_anchor",
      identity: {
        object_key: "obj.plan.1",
        object_kind: "file_set",
      },
      material: {
        kind: "file_set",
        root_dir: "/tmp/data",
      },
      domain: "rna",
      proof_date: "2026-03-06",
    });
  });

  it("parseIngestBundleV1 parses a valid file bundle with path_rel variant", async () => {
    const { parseIngestBundleV1 } = await import("../../../../src/ingest/validators.js");

    const bundle = parseIngestBundleV1({
      bundle_version: "v1",
      hash_contract: {
        contract_id: "hf-contract-v1",
        frame: "hf:frame:v1",
        canonical_json: "hf:canonical-json:v1",
        algorithm: "sha3-512",
        encoding: "hex_lower",
      },
      identity: {
        object_key: "obj.bundle.1",
        object_kind: "file",
        version_label: "v1",
        program: "sage",
      },
      rules: {
        path_normalization: "posix_rel_no_dotdot",
        follow_symlinks: false,
        redact_paths: false,
        normalize_line_endings: true,
        ordering: "deterministic_sort_v1",
        merkle_rule: "dup_last_on_odd",
        include_globs: ["**/*.tsv"],
        exclude_globs: ["tmp/**"],
        allowed_suffixes: [".TSV"],
      },
      items: [
        {
          item_kind: "file",
          path_rel: "subdir\\a.tsv",
          media_type: "text/tab-separated-values",
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
        item_count: 1,
        total_bytes: 10,
      },
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
      identity: {
        object_key: "obj.bundle.1",
        object_kind: "file",
        version_label: "v1",
        program: "sage",
      },
      rules: {
        path_normalization: "posix_rel_no_dotdot",
        follow_symlinks: false,
        redact_paths: false,
        normalize_line_endings: true,
        ordering: "deterministic_sort_v1",
        merkle_rule: "dup_last_on_odd",
        include_globs: ["**/*.tsv"],
        exclude_globs: ["tmp/**"],
        allowed_suffixes: [".tsv"],
      },
      items: [
        {
          item_kind: "file",
          path_rel: "subdir/a.tsv",
          media_type: "text/tab-separated-values",
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
        item_count: 1,
        total_bytes: 10,
      },
    });

    expect(normalizeRelPathMock).toHaveBeenCalledWith("subdir\\a.tsv");
  });

  it("parseIngestBundleV1 parses a valid file bundle with path_hash variant", async () => {
    const { parseIngestBundleV1 } = await import("../../../../src/ingest/validators.js");

    const bundle = parseIngestBundleV1({
      bundle_version: "v1",
      hash_contract: {
        contract_id: "hf-contract-v1",
        frame: "hf:frame:v1",
        canonical_json: "hf:canonical-json:v1",
        algorithm: "sha3-512",
        encoding: "hex_lower",
      },
      identity: {
        object_key: "obj.bundle.2",
        object_kind: "file",
      },
      rules: {
        path_normalization: "posix_rel_no_dotdot",
        follow_symlinks: false,
        redact_paths: true,
        normalize_line_endings: false,
        ordering: "deterministic_sort_v1",
        merkle_rule: "dup_last_on_odd",
      },
      items: [
        {
          item_kind: "file",
          path_hash: HEX512_A,
          bytes: 9,
          sha3_512: HEX512_B,
          leaf_hash: HEX512_C,
        },
      ],
      summary: {
        item_count: 1,
        total_bytes: 9,
      },
    });

    expect(bundle.items).toEqual([
      {
        item_kind: "file",
        path_hash: HEX512_A,
        bytes: 9,
        sha3_512: HEX512_B,
        leaf_hash: HEX512_C,
      },
    ]);
  });

  it("parseIngestBundleV1 rejects hash contract mismatches and summary mismatches", async () => {
    const { parseIngestBundleV1 } = await import("../../../../src/ingest/validators.js");

    expect(() =>
      parseIngestBundleV1({
        bundle_version: "v1",
        hash_contract: {
          contract_id: "wrong",
          frame: "hf:frame:v1",
          canonical_json: "hf:canonical-json:v1",
          algorithm: "sha3-512",
          encoding: "hex_lower",
        },
        identity: {
          object_key: "obj.bundle.bad",
          object_kind: "file",
        },
        rules: {
          path_normalization: "posix_rel_no_dotdot",
          follow_symlinks: false,
          redact_paths: false,
          normalize_line_endings: false,
          ordering: "deterministic_sort_v1",
          merkle_rule: "dup_last_on_odd",
        },
        items: [
          {
            item_kind: "file",
            path_hash: HEX512_A,
            bytes: 1,
            sha3_512: HEX512_B,
            leaf_hash: HEX512_C,
          },
        ],
        summary: {
          item_count: 1,
          total_bytes: 1,
        },
      }),
    ).toThrow(/hash_contract_contract_id_mismatch/i);

    expect(() =>
      parseIngestBundleV1({
        bundle_version: "v1",
        hash_contract: {
          contract_id: "hf-contract-v1",
          frame: "hf:frame:v1",
          canonical_json: "hf:canonical-json:v1",
          algorithm: "sha3-512",
          encoding: "hex_lower",
        },
        identity: {
          object_key: "obj.bundle.bad2",
          object_kind: "file",
        },
        rules: {
          path_normalization: "posix_rel_no_dotdot",
          follow_symlinks: false,
          redact_paths: false,
          normalize_line_endings: false,
          ordering: "deterministic_sort_v1",
          merkle_rule: "dup_last_on_odd",
        },
        items: [
          {
            item_kind: "file",
            path_hash: HEX512_A,
            bytes: 1,
            sha3_512: HEX512_B,
            leaf_hash: HEX512_C,
          },
        ],
        summary: {
          item_count: 2,
          total_bytes: 1,
        },
      }),
    ).toThrow(/bundle_summary_item_count_mismatch/i);
  });

  it("parseIngestBundleV1 rejects merkle leaf_count mismatch", async () => {
    const { parseIngestBundleV1 } = await import("../../../../src/ingest/validators.js");

    expect(() =>
      parseIngestBundleV1({
        bundle_version: "v1",
        hash_contract: {
          contract_id: "hf-contract-v1",
          frame: "hf:frame:v1",
          canonical_json: "hf:canonical-json:v1",
          algorithm: "sha3-512",
          encoding: "hex_lower",
        },
        identity: {
          object_key: "obj.bundle.bad3",
          object_kind: "file",
        },
        rules: {
          path_normalization: "posix_rel_no_dotdot",
          follow_symlinks: false,
          redact_paths: false,
          normalize_line_endings: false,
          ordering: "deterministic_sort_v1",
          merkle_rule: "dup_last_on_odd",
        },
        items: [
          {
            item_kind: "file",
            path_hash: HEX512_A,
            bytes: 1,
            sha3_512: HEX512_B,
            leaf_hash: HEX512_C,
          },
        ],
        merkle: {
          leaf_count: 2,
          root: HEX512_D,
        },
        summary: {
          item_count: 1,
          total_bytes: 1,
        },
      }),
    ).toThrow(/bundle_merkle_leaf_count_mismatch/i);
  });

  it("parseIngestBundleV1 should accept json/text items without path_rel or path_hash", async () => {
    const { parseIngestBundleV1 } = await import("../../../../src/ingest/validators.js");

    expect(() =>
      parseIngestBundleV1({
        bundle_version: "v1",
        hash_contract: {
          contract_id: "hf-contract-v1",
          frame: "hf:frame:v1",
          canonical_json: "hf:canonical-json:v1",
          algorithm: "sha3-512",
          encoding: "hex_lower",
        },
        identity: {
          object_key: "obj.bundle.json",
          object_kind: "json",
        },
        rules: {
          path_normalization: "posix_rel_no_dotdot",
          follow_symlinks: false,
          redact_paths: false,
          normalize_line_endings: false,
          ordering: "deterministic_sort_v1",
          merkle_rule: "dup_last_on_odd",
        },
        items: [
          {
            item_kind: "json",
            media_type: "application/json",
            bytes: 10,
            sha3_512: HEX512_A,
            leaf_hash: HEX512_B,
          },
        ],
        summary: {
          item_count: 1,
          total_bytes: 10,
        },
      }),
    ).not.toThrow();

    expect(() =>
      parseIngestBundleV1({
        bundle_version: "v1",
        hash_contract: {
          contract_id: "hf-contract-v1",
          frame: "hf:frame:v1",
          canonical_json: "hf:canonical-json:v1",
          algorithm: "sha3-512",
          encoding: "hex_lower",
        },
        identity: {
          object_key: "obj.bundle.text",
          object_kind: "text",
        },
        rules: {
          path_normalization: "posix_rel_no_dotdot",
          follow_symlinks: false,
          redact_paths: false,
          normalize_line_endings: false,
          ordering: "deterministic_sort_v1",
          merkle_rule: "dup_last_on_odd",
        },
        items: [
          {
            item_kind: "text",
            media_type: "text/plain",
            bytes: 11,
            sha3_512: HEX512_A,
            leaf_hash: HEX512_B,
          },
        ],
        summary: {
          item_count: 1,
          total_bytes: 11,
        },
      }),
    ).not.toThrow();
  });

  it("parseIngestReceiptV1 parses a valid receipt with optional blocks", async () => {
    const { parseIngestReceiptV1 } = await import("../../../../src/ingest/validators.js");

    const receipt = parseIngestReceiptV1({
      v: "v1",
      kind: "ingest_receipt",
      receipt_id: HEX512_A,
      mode: "register_and_anchor",
      identity: {
        object_key: "obj.receipt.1",
        object_kind: "file_set",
        program: "sage",
      },
      rules: {
        path_normalization: "posix_rel_no_dotdot",
        follow_symlinks: false,
        redact_paths: true,
        normalize_line_endings: true,
        ordering: "deterministic_sort_v1",
        merkle_rule: "dup_last_on_odd",
      },
      evidence: {
        fingerprint: HEX512_B,
        bundle_digest: HEX512_C,
        merkle_root: HEX512_D,
        idempotency_key: HEX512_A,
        item_count: 2,
        total_bytes: 20,
      },
      anchor: {
        domain: "genomics",
        proof_date: "2026-03-06",
      },
      pointers: {
        evidence_pointer: "s3://bucket/evidence.json",
      },
      metadata: {
        run_id: "run-1",
      },
      core: {
        receipt_anchor: {
          id: "anchor-1",
          status: "anchored",
        },
      },
    });

    expect(receipt).toEqual({
      v: "v1",
      kind: "ingest_receipt",
      receipt_id: HEX512_A,
      mode: "register_and_anchor",
      identity: {
        object_key: "obj.receipt.1",
        object_kind: "file_set",
        program: "sage",
      },
      rules: {
        path_normalization: "posix_rel_no_dotdot",
        follow_symlinks: false,
        redact_paths: true,
        normalize_line_endings: true,
        ordering: "deterministic_sort_v1",
        merkle_rule: "dup_last_on_odd",
      },
      evidence: {
        fingerprint: HEX512_B,
        bundle_digest: HEX512_C,
        merkle_root: HEX512_D,
        idempotency_key: HEX512_A,
        item_count: 2,
        total_bytes: 20,
      },
      anchor: {
        domain: "genomics",
        proof_date: "2026-03-06",
      },
      pointers: {
        evidence_pointer: "s3://bucket/evidence.json",
      },
      metadata: {
        run_id: "run-1",
      },
      core: {
        receipt_anchor: {
          id: "anchor-1",
          status: "anchored",
        },
      },
    });
  });

  it("parseIngestReceiptV1 rejects invalid receipt_id and invalid evidence shape", async () => {
    const { parseIngestReceiptV1 } = await import("../../../../src/ingest/validators.js");

    expect(() =>
      parseIngestReceiptV1({
        v: "v1",
        kind: "ingest_receipt",
        receipt_id: "not-hex",
        mode: "hash_only",
        identity: {
          object_key: "obj.receipt.bad",
          object_kind: "file",
        },
        rules: {
          path_normalization: "posix_rel_no_dotdot",
          follow_symlinks: false,
          redact_paths: false,
          normalize_line_endings: false,
          ordering: "deterministic_sort_v1",
          merkle_rule: "dup_last_on_odd",
        },
        evidence: {
          fingerprint: HEX512_B,
          bundle_digest: HEX512_C,
          idempotency_key: HEX512_A,
          item_count: 1,
          total_bytes: 1,
        },
      }),
    ).toThrow(/receipt_id_invalid/i);

    expect(() =>
      parseIngestReceiptV1({
        v: "v1",
        kind: "ingest_receipt",
        receipt_id: HEX512_A,
        mode: "hash_only",
        identity: {
          object_key: "obj.receipt.bad2",
          object_kind: "file",
        },
        rules: {
          path_normalization: "posix_rel_no_dotdot",
          follow_symlinks: false,
          redact_paths: false,
          normalize_line_endings: false,
          ordering: "deterministic_sort_v1",
          merkle_rule: "dup_last_on_odd",
        },
        evidence: {
          fingerprint: HEX512_B,
          bundle_digest: HEX512_C,
          item_count: 1,
          total_bytes: 1,
        },
      }),
    ).toThrow(/receipt_evidence_invalid/i);
  });

  it("parseIngestVerifyRequestV1 parses receipt/bundle/root_dir combinations and enforces file_set for root_dir", async () => {
    const { parseIngestVerifyRequestV1 } = await import("../../../../src/ingest/validators.js");

    const out = parseIngestVerifyRequestV1({
      receipt: {
        v: "v1",
        kind: "ingest_receipt",
        receipt_id: HEX512_A,
        mode: "hash_only",
        identity: {
          object_key: "obj.verify.1",
          object_kind: "file_set",
        },
        rules: {
          path_normalization: "posix_rel_no_dotdot",
          follow_symlinks: false,
          redact_paths: false,
          normalize_line_endings: false,
          ordering: "deterministic_sort_v1",
          merkle_rule: "dup_last_on_odd",
        },
        evidence: {
          fingerprint: HEX512_B,
          bundle_digest: HEX512_C,
          idempotency_key: HEX512_D,
          item_count: 1,
          total_bytes: 1,
        },
      },
      root_dir: " /tmp/data ",
    });

    expect(out.root_dir).toBe("/tmp/data");

    expect(() =>
      parseIngestVerifyRequestV1({
        bundle: {
          bundle_version: "v1",
          hash_contract: {
            contract_id: "hf-contract-v1",
            frame: "hf:frame:v1",
            canonical_json: "hf:canonical-json:v1",
            algorithm: "sha3-512",
            encoding: "hex_lower",
          },
          identity: {
            object_key: "obj.verify.2",
            object_kind: "file",
          },
          rules: {
            path_normalization: "posix_rel_no_dotdot",
            follow_symlinks: false,
            redact_paths: false,
            normalize_line_endings: false,
            ordering: "deterministic_sort_v1",
            merkle_rule: "dup_last_on_odd",
          },
          items: [
            {
              item_kind: "file",
              path_hash: HEX512_A,
              bytes: 1,
              sha3_512: HEX512_B,
              leaf_hash: HEX512_C,
            },
          ],
          summary: {
            item_count: 1,
            total_bytes: 1,
          },
        },
        root_dir: "/tmp/data",
      }),
    ).toThrow(/verify_request_root_dir_requires_file_set/i);

    expect(() =>
      parseIngestVerifyRequestV1({}),
    ).toThrow(/verify_request_receipt_or_bundle_required/i);
  });

  it("parseIngestBundleV1 rejects path_rel/path_hash on non-file items", async () => {
    const { parseIngestBundleV1 } = await import("../../../../src/ingest/validators.js");

    expect(() =>
      parseIngestBundleV1({
        bundle_version: "v1",
        hash_contract: {
          contract_id: "hf-contract-v1",
          frame: "hf:frame:v1",
          canonical_json: "hf:canonical-json:v1",
          algorithm: "sha3-512",
          encoding: "hex_lower",
        },
        identity: { object_key: "obj.bundle.json.bad", object_kind: "json" },
        rules: {
          path_normalization: "posix_rel_no_dotdot",
          follow_symlinks: false,
          redact_paths: false,
          normalize_line_endings: false,
          ordering: "deterministic_sort_v1",
          merkle_rule: "dup_last_on_odd",
        },
        items: [
          {
            item_kind: "json",
            path_rel: "bad.json",
            bytes: 10,
            sha3_512: HEX512_A,
            leaf_hash: HEX512_B,
          },
        ],
        summary: { item_count: 1, total_bytes: 10 },
      }),
    ).toThrow(/item_path_variant_invalid/i);
  });
});
