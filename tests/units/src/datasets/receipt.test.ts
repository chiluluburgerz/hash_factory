// ============================================================================
// File: tests/units/datasets/receipt.test.ts
// Version: 1.0.0-hf-datasets-receipt-unit | 2026-03-07
// Purpose:
//   Unit tests for src/datasets/receipt.ts
// Notes:
//   - Pure deterministic tests.
//   - Verifies body shaping, bundle-backed defaults, Core projections,
//     and deterministic receipt_id hashing payload.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const hashJsonDigestMock = vi.fn((input: any) => {
  return `receipt:${input.domain}:${JSON.stringify(input.value)}`;
});

vi.mock("../../../../src/hashing/contract.js", () => ({
  hashJsonDigest: hashJsonDigestMock,
}));

describe("datasets/receipt (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a deterministic receipt from bundle-backed evidence and hashes body excluding receipt_id", async () => {
    const { buildDatasetReceiptV1 } = await import("../../../../src/datasets/receipt.js");

    const evidence = Object.freeze({
      dataset_key: "dataset.1",
      dataset_fingerprint: "fp-1",
      bundle_digest: "bundle-1",
      merkle_root: "root-1",
      idempotency_key: "idem-1",
      bundle: Object.freeze({
        dataset_identity: Object.freeze({
          dataset_key: "dataset.1",
          version_label: "v1",
          program: "sage",
        }),
        rules: Object.freeze({
          path_normalization: "posix_rel_no_dotdot",
          follow_symlinks: true,
          redact_paths: true,
          ordering: "path_rel_ascii_asc",
          merkle_rule: "dup_last_on_odd",
        }),
        summary: Object.freeze({
          file_count: 2,
          total_bytes: 123,
        }),
      }),
    }) as any;

    const receipt = buildDatasetReceiptV1({
      mode: "register_and_anchor",
      evidence,
      evidence_pointer: "s3://bucket/evidence.json",
      core: {
        dataset: {
          id: "ds-1",
          dataset_key: "dataset.1",
          org_id: "org-1",
          program: "sage",
          display_name: "Dataset 1",
          visibility: "private",
          active_version: "v1",
          active_manifest_hash: "mh-1",
          hcs_topic_id: "0.0.123",
          hcs_transaction_id: "tx-1",
          hcs_message_id: "msg-1",
          ignored: "nope",
        },
        version: {
          id: "ver-1",
          dataset_key: "dataset.1",
          version: "v1",
          dataset_fingerprint: "fp-1",
          matrix_path: "s3://bucket/evidence.json",
          artifact_bytes: 123,
          bytes_estimate: 123,
          schema_hash: "schema-1",
          manifest_hash: "manifest-1",
          sealed_at: "2026-03-07T00:00:00Z",
          hcs_topic_id: "0.0.123",
          hcs_transaction_id: "tx-1",
          hcs_message_id: "msg-1",
          ignored: "nope",
        },
        published: {
          published: true,
          target: "active",
          ignored: "nope",
        },
      } as any,
    });

    expect(hashJsonDigestMock).toHaveBeenCalledTimes(1);
    expect(hashJsonDigestMock).toHaveBeenCalledWith({
      domain: "va:dataset:receipt:v1",
      value: {
        v: "v1",
        kind: "dataset_anchor_receipt",
        mode: "register_and_anchor",
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
        },
        evidence: {
          dataset_fingerprint: "fp-1",
          bundle_digest: "bundle-1",
          merkle_root: "root-1",
          idempotency_key: "idem-1",
          file_count: 2,
          total_bytes: 123,
        },
        pointers: {
          evidence_pointer: "s3://bucket/evidence.json",
        },
        core: {
          dataset: {
            id: "ds-1",
            dataset_key: "dataset.1",
            org_id: "org-1",
            program: "sage",
            display_name: "Dataset 1",
            visibility: "private",
            active_version: "v1",
            active_manifest_hash: "mh-1",
            hcs_topic_id: "0.0.123",
            hcs_transaction_id: "tx-1",
            hcs_message_id: "msg-1",
          },
          version: {
            id: "ver-1",
            dataset_key: "dataset.1",
            version: "v1",
            dataset_fingerprint: "fp-1",
            matrix_path: "s3://bucket/evidence.json",
            artifact_bytes: 123,
            bytes_estimate: 123,
            schema_hash: "schema-1",
            manifest_hash: "manifest-1",
            sealed_at: "2026-03-07T00:00:00Z",
            hcs_topic_id: "0.0.123",
            hcs_transaction_id: "tx-1",
            hcs_message_id: "msg-1",
          },
          published: {
            published: true,
            target: "active",
          },
        },
      },
      alg: "sha3-512",
      encoding: "hex_lower",
    });

    expect(receipt).toEqual({
      v: "v1",
      kind: "dataset_anchor_receipt",
      receipt_id: expect.stringContaining("va:dataset:receipt:v1"),
      mode: "register_and_anchor",
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
      },
      evidence: {
        dataset_fingerprint: "fp-1",
        bundle_digest: "bundle-1",
        merkle_root: "root-1",
        idempotency_key: "idem-1",
        file_count: 2,
        total_bytes: 123,
      },
      pointers: {
        evidence_pointer: "s3://bucket/evidence.json",
      },
      core: {
        dataset: {
          id: "ds-1",
          dataset_key: "dataset.1",
          org_id: "org-1",
          program: "sage",
          display_name: "Dataset 1",
          visibility: "private",
          active_version: "v1",
          active_manifest_hash: "mh-1",
          hcs_topic_id: "0.0.123",
          hcs_transaction_id: "tx-1",
          hcs_message_id: "msg-1",
        },
        version: {
          id: "ver-1",
          dataset_key: "dataset.1",
          version: "v1",
          dataset_fingerprint: "fp-1",
          matrix_path: "s3://bucket/evidence.json",
          artifact_bytes: 123,
          bytes_estimate: 123,
          schema_hash: "schema-1",
          manifest_hash: "manifest-1",
          sealed_at: "2026-03-07T00:00:00Z",
          hcs_topic_id: "0.0.123",
          hcs_transaction_id: "tx-1",
          hcs_message_id: "msg-1",
        },
        published: {
          published: true,
          target: "active",
        },
      },
    });

    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it("falls back to evidence identity and empty rules when bundle fields are missing", async () => {
    const { buildDatasetReceiptV1 } = await import("../../../../src/datasets/receipt.js");

    const evidence = Object.freeze({
      dataset_key: "dataset.2",
      dataset_fingerprint: "fp-2",
      bundle_digest: "bundle-2",
      merkle_root: "root-2",
      idempotency_key: "idem-2",
      bundle: Object.freeze({}),
    }) as any;

    const receipt = buildDatasetReceiptV1({
      mode: "hash_only",
      evidence,
      evidence_pointer: null,
      core: null,
    });

    expect(receipt.dataset_identity).toEqual({
      dataset_key: "dataset.2",
    });

    expect(receipt.rules).toEqual({});

    expect(receipt.evidence).toEqual({
      dataset_fingerprint: "fp-2",
      bundle_digest: "bundle-2",
      merkle_root: "root-2",
      idempotency_key: "idem-2",
      file_count: 0,
      total_bytes: 0,
    });

    expect(receipt.pointers).toBeUndefined();
    expect(receipt.core).toBeUndefined();
  });

  it("omits pointers block when evidence_pointer is absent", async () => {
    const { buildDatasetReceiptV1 } = await import("../../../../src/datasets/receipt.js");

    const evidence = Object.freeze({
      dataset_key: "dataset.3",
      dataset_fingerprint: "fp-3",
      bundle_digest: "bundle-3",
      merkle_root: "root-3",
      idempotency_key: "idem-3",
      bundle: Object.freeze({
        summary: Object.freeze({ file_count: 1, total_bytes: 5 }),
      }),
    }) as any;

    const receipt = buildDatasetReceiptV1({
      mode: "hash_only",
      evidence,
      evidence_pointer: null,
      core: null,
    });

    expect(receipt.pointers).toBeUndefined();
  });

  it("accepts nested dataset/version wrappers in core projection", async () => {
    const { buildDatasetReceiptV1 } = await import("../../../../src/datasets/receipt.js");

    const evidence = Object.freeze({
      dataset_key: "dataset.4",
      dataset_fingerprint: "fp-4",
      bundle_digest: "bundle-4",
      merkle_root: "root-4",
      idempotency_key: "idem-4",
      bundle: Object.freeze({
        summary: Object.freeze({ file_count: 1, total_bytes: 5 }),
      }),
    }) as any;

    const receipt = buildDatasetReceiptV1({
      mode: "register_and_anchor",
      evidence,
      core: {
        dataset: {
          dataset: {
            id: "ds-4",
            dataset_key: "dataset.4",
          },
        },
        version: {
          version: {
            id: "ver-4",
            dataset_key: "dataset.4",
            version: "v4",
          },
        },
      } as any,
    });

    expect(receipt.core).toEqual({
      dataset: {
        id: "ds-4",
        dataset_key: "dataset.4",
      },
      version: {
        id: "ver-4",
        dataset_key: "dataset.4",
        version: "v4",
      },
    });
  });

  it("omits empty core projection when no recognized core fields exist", async () => {
    const { buildDatasetReceiptV1 } = await import("../../../../src/datasets/receipt.js");

    const evidence = Object.freeze({
      dataset_key: "dataset.5",
      dataset_fingerprint: "fp-5",
      bundle_digest: "bundle-5",
      merkle_root: "root-5",
      idempotency_key: "idem-5",
      bundle: Object.freeze({
        summary: Object.freeze({ file_count: 1, total_bytes: 5 }),
      }),
    }) as any;

    const receipt = buildDatasetReceiptV1({
      mode: "hash_only",
      evidence,
      core: {
        nonsense: true,
      } as any,
    });

    expect(receipt.core).toBeUndefined();
  });
});