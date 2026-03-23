// ============================================================================
// File: tests/units/ingest/receipt.test.ts
// Version: 1.1.1-hf-ingest-receipt-unit | 2026-03-20
// Purpose:
//   Unit tests for src/ingest/receipt.ts
// Notes:
//   - Pure deterministic tests.
//   - Verifies body shaping, default fallbacks, core anchor projection,
//     and deterministic receipt_id hashing payload.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const hashJsonDigestMock = vi.fn((input: any) => {
  return `receipt:${input.domain}:${JSON.stringify(input.value)}`;
});

vi.mock("../../../../src/hashing/contract.js", () => ({
  hashJsonDigest: hashJsonDigestMock,
}));

describe("ingest/receipt (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a deterministic receipt from bundle-backed evidence and hashes body excluding receipt_id", async () => {
    const { buildIngestReceiptV1 } = await import("../../../../src/ingest/receipt.js");

    const evidence = Object.freeze({
      object_key: "obj.1",
      object_kind: "dataset",
      fingerprint: "fp-1",
      bundle_digest: "bundle-1",
      merkle_root: "root-1",
      idempotency_key: "idem-1",
      bundle: Object.freeze({
        identity: Object.freeze({
          object_key: "obj.1",
          object_kind: "dataset",
          version_label: "v1",
          program: "sage",
        }),
        rules: Object.freeze({
          path_normalization: "posix_rel_no_dotdot",
          follow_symlinks: true,
          redact_paths: true,
          normalize_line_endings: true,
          ordering: "deterministic_sort_v1",
          merkle_rule: "dup_last_on_odd",
        }),
        summary: Object.freeze({
          item_count: 2,
          total_bytes: 123,
        }),
      }),
    }) as any;

    const receipt = buildIngestReceiptV1({
      mode: "register_and_anchor" as any,
      evidence,
      domain: "genomics",
      proof_date: "2026-03-06",
      evidence_pointer: "s3://bucket/evidence.json",
      metadata: Object.freeze({ run_id: "run-1" }),
      core: {
        receipt_anchor: {
          id: "anchor-1",
          anchor_request_id: "req-1",
          domain: "genomics",
          payload_type: "ingest_receipt_v1",
          proof_date: "2026-03-06",
          status: "anchored",
          root_id: "root-row-1",
          leaf_hash: "leaf-1",
          ignored: "nope",
        },
        root_anchor: {
          id: "root-1",
          root_hash: "root-1",
          status: "anchored",
          publish: {
            topic_key: "HCS_EVENTS",
            topic_name: "hcs_events",
            topic_id: "0.0.123",
            transaction_id: "tx-1",
            message_id: "msg-1",
            sequence_number: 7,
            ignored: "nope",
          },
        },
      } as any,
    });

    expect(hashJsonDigestMock).toHaveBeenCalledTimes(1);
    expect(hashJsonDigestMock).toHaveBeenCalledWith({
      domain: "va:ingest:receipt:v1",
      value: {
        v: "v1",
        kind: "ingest_receipt",
        mode: "register_and_anchor",
        identity: {
          object_key: "obj.1",
          object_kind: "dataset",
          version_label: "v1",
          program: "sage",
        },
        rules: {
          path_normalization: "posix_rel_no_dotdot",
          follow_symlinks: true,
          redact_paths: true,
          normalize_line_endings: true,
          ordering: "deterministic_sort_v1",
          merkle_rule: "dup_last_on_odd",
        },
        evidence: {
          fingerprint: "fp-1",
          bundle_digest: "bundle-1",
          merkle_root: "root-1",
          idempotency_key: "idem-1",
          item_count: 2,
          total_bytes: 123,
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
            domain: "genomics",
            payload_type: "ingest_receipt_v1",
            proof_date: "2026-03-06",
            status: "anchored",
            root_id: "root-row-1",
            leaf_hash: "leaf-1",
          },
          root_anchor: {
            id: "root-1",
            root_hash: "root-1",
            status: "anchored",
            publish: {
              topic_key: "HCS_EVENTS",
              topic_name: "hcs_events",
              topic_id: "0.0.123",
              transaction_id: "tx-1",
              message_id: "msg-1",
              sequence_number: 7,
            },
          },
        },
      },
      alg: "sha3-512",
      encoding: "hex_lower",
    });

    expect(receipt).toEqual({
      v: "v1",
      kind: "ingest_receipt",
      receipt_id: expect.stringContaining("va:ingest:receipt:v1"),
      mode: "register_and_anchor",
      identity: {
        object_key: "obj.1",
        object_kind: "dataset",
        version_label: "v1",
        program: "sage",
      },
      rules: {
        path_normalization: "posix_rel_no_dotdot",
        follow_symlinks: true,
        redact_paths: true,
        normalize_line_endings: true,
        ordering: "deterministic_sort_v1",
        merkle_rule: "dup_last_on_odd",
      },
      evidence: {
        fingerprint: "fp-1",
        bundle_digest: "bundle-1",
        merkle_root: "root-1",
        idempotency_key: "idem-1",
        item_count: 2,
        total_bytes: 123,
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
          domain: "genomics",
          payload_type: "ingest_receipt_v1",
          proof_date: "2026-03-06",
          status: "anchored",
          root_id: "root-row-1",
          leaf_hash: "leaf-1",
        },
        root_anchor: {
          id: "root-1",
          root_hash: "root-1",
          status: "anchored",
          publish: {
            topic_key: "HCS_EVENTS",
            topic_name: "hcs_events",
            topic_id: "0.0.123",
            transaction_id: "tx-1",
            message_id: "msg-1",
            sequence_number: 7,
          },
        },
      },
    });

    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it("falls back to evidence identity and default rules when bundle fields are missing", async () => {
    const { buildIngestReceiptV1 } = await import("../../../../src/ingest/receipt.js");

    const evidence = Object.freeze({
      object_key: "obj.2",
      object_kind: "artifact",
      fingerprint: "fp-2",
      bundle_digest: "bundle-2",
      idempotency_key: "idem-2",
      bundle: Object.freeze({}),
    }) as any;

    const receipt = buildIngestReceiptV1({
      mode: "hash_only" as any,
      evidence,
      core: null,
      metadata: null,
      domain: null,
      proof_date: null,
      evidence_pointer: null,
    });

    expect(receipt.identity).toEqual({
      object_key: "obj.2",
      object_kind: "artifact",
    });

    expect(receipt.rules).toEqual({
      path_normalization: "posix_rel_no_dotdot",
      follow_symlinks: false,
      redact_paths: false,
      normalize_line_endings: false,
      ordering: "deterministic_sort_v1",
      merkle_rule: "dup_last_on_odd",
    });

    expect(receipt.evidence).toEqual({
      fingerprint: "fp-2",
      bundle_digest: "bundle-2",
      idempotency_key: "idem-2",
      item_count: 0,
      total_bytes: 0,
    });

    expect(receipt.anchor).toBeUndefined();
    expect(receipt.pointers).toBeUndefined();
    expect(receipt.metadata).toBeUndefined();
    expect(receipt.core).toBeUndefined();
  });

  it("omits anchor block when both domain and proof_date are absent", async () => {
    const { buildIngestReceiptV1 } = await import("../../../../src/ingest/receipt.js");

    const evidence = Object.freeze({
      object_key: "obj.3",
      object_kind: "dataset",
      fingerprint: "fp-3",
      bundle_digest: "bundle-3",
      idempotency_key: "idem-3",
      bundle: Object.freeze({
        summary: Object.freeze({ item_count: 1, total_bytes: 5 }),
      }),
    }) as any;

    const receipt = buildIngestReceiptV1({
      mode: "hash_only" as any,
      evidence,
      domain: null,
      proof_date: null,
      evidence_pointer: null,
      metadata: null,
      core: null,
    });

    expect(receipt.anchor).toBeUndefined();
  });

  it("includes anchor block when either domain or proof_date is present", async () => {
    const { buildIngestReceiptV1 } = await import("../../../../src/ingest/receipt.js");

    const evidence = Object.freeze({
      object_key: "obj.4",
      object_kind: "dataset",
      fingerprint: "fp-4",
      bundle_digest: "bundle-4",
      idempotency_key: "idem-4",
      bundle: Object.freeze({
        summary: Object.freeze({ item_count: 1, total_bytes: 5 }),
      }),
    }) as any;

    const withDomain = buildIngestReceiptV1({
      mode: "hash_only" as any,
      evidence,
      domain: "rna",
      proof_date: null,
      evidence_pointer: null,
      metadata: null,
      core: null,
    });

    const withProofDate = buildIngestReceiptV1({
      mode: "hash_only" as any,
      evidence,
      domain: null,
      proof_date: "2026-03-06",
      evidence_pointer: null,
      metadata: null,
      core: null,
    });

    expect(withDomain.anchor).toEqual({ domain: "rna" });
    expect(withProofDate.anchor).toEqual({ proof_date: "2026-03-06" });
  });

  it("projects stable snake_case fields from receipt_anchor blocks", async () => {
    const { buildIngestReceiptV1 } = await import("../../../../src/ingest/receipt.js");

    const evidence = Object.freeze({
      object_key: "obj.5",
      object_kind: "dataset",
      fingerprint: "fp-5",
      bundle_digest: "bundle-5",
      idempotency_key: "idem-5",
      bundle: Object.freeze({
        summary: Object.freeze({ item_count: 1, total_bytes: 5 }),
      }),
    }) as any;

    const receipt = buildIngestReceiptV1({
      mode: "register_and_anchor" as any,
      evidence,
      core: {
        receipt_anchor: {
          anchor_request_id: "req-5",
          root_id: "root-5",
          proof_date: "2026-03-06",
          ignored: "nope",
        },
      } as any,
    });

    expect(receipt.core).toEqual({
      receipt_anchor: {
        root_id: "root-5",
        proof_date: "2026-03-06",
      },
    });
  });

  it("omits empty core projection when no recognized anchor fields exist", async () => {
    const { buildIngestReceiptV1 } = await import("../../../../src/ingest/receipt.js");

    const evidence = Object.freeze({
      object_key: "obj.6",
      object_kind: "dataset",
      fingerprint: "fp-6",
      bundle_digest: "bundle-6",
      idempotency_key: "idem-6",
      bundle: Object.freeze({
        summary: Object.freeze({ item_count: 1, total_bytes: 5 }),
      }),
    }) as any;

    const receipt = buildIngestReceiptV1({
      mode: "hash_only" as any,
      evidence,
      core: {
        nonsense: true,
      } as any,
    });

    expect(receipt.core).toBeUndefined();
  });
});