// ============================================================================
// File: tests/units/ingest/verifier.test.ts
// Version: 1.0.0-hf-ingest-verifier-unit | 2026-03-07
// Purpose:
//   Unit tests for src/ingest/verifier.ts
// Notes:
//   - Mocks bundle/merkle/execute/validator/hash boundaries.
//   - Covers bundle verification, receipt verification, and local file_set verification.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const ingestBundleDigestMock = vi.fn();
const ingestFingerprintMock = vi.fn();
const ingestIdempotencyKeyMock = vi.fn();

vi.mock("../../../../src/ingest/bundle.js", () => ({
  ingestBundleDigest: ingestBundleDigestMock,
  ingestFingerprint: ingestFingerprintMock,
  ingestIdempotencyKey: ingestIdempotencyKeyMock,
}));

const merkleRootFromItemsMock = vi.fn();
vi.mock("../../../../src/ingest/merkle.js", () => ({
  merkleRootFromItems: merkleRootFromItemsMock,
}));

const executeIngestMock = vi.fn();
vi.mock("../../../../src/ingest/execute.js", () => ({
  executeIngest: executeIngestMock,
}));

const parseIngestBundleV1Mock = vi.fn();
const parseIngestReceiptV1Mock = vi.fn();
vi.mock("../../../../src/ingest/validators.js", () => ({
  parseIngestBundleV1: parseIngestBundleV1Mock,
  parseIngestReceiptV1: parseIngestReceiptV1Mock,
}));

const hashJsonDigestMock = vi.fn();
vi.mock("../../../../src/hashing/contract.js", () => ({
  hashJsonDigest: hashJsonDigestMock,
}));

describe("ingest/verifier (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    ingestBundleDigestMock.mockReturnValue("bundle-digest-recomputed");
    ingestFingerprintMock.mockReturnValue("fingerprint-recomputed");
    ingestIdempotencyKeyMock.mockImplementation((objectKey: string, fp: string) => `idem:${objectKey}:${fp}`);
    merkleRootFromItemsMock.mockReturnValue({
      leaf_count: 2,
      root: "merkle-root-recomputed",
    });
    hashJsonDigestMock.mockReturnValue("receipt-id-recomputed");
  });

  it("verifyIngestBundle returns ok=true with recomputed fields when bundle is internally consistent", async () => {
    const { verifyIngestBundle } = await import("../../../../src/ingest/verifier.js");

    const parsedBundle = Object.freeze({
      identity: {
        object_key: "obj.bundle.1",
        object_kind: "file_set",
      },
      items: [
        { bytes: 10, leaf_hash: "a" },
        { bytes: 20, leaf_hash: "b" },
      ],
      merkle: {
        leaf_count: 2,
        root: "merkle-root-recomputed",
      },
      summary: {
        item_count: 2,
        total_bytes: 30,
      },
    });

    parseIngestBundleV1Mock.mockReturnValue(parsedBundle);

    const out = verifyIngestBundle({ any: true });

    expect(parseIngestBundleV1Mock).toHaveBeenCalledWith({ any: true });
    expect(merkleRootFromItemsMock).toHaveBeenCalledWith(parsedBundle.items);
    expect(ingestBundleDigestMock).toHaveBeenCalledWith(parsedBundle);
    expect(ingestFingerprintMock).toHaveBeenCalledWith(parsedBundle);
    expect(ingestIdempotencyKeyMock).toHaveBeenCalledWith("obj.bundle.1", "fingerprint-recomputed");

    expect(out).toEqual({
      ok: true,
      mismatches: [],
      computed: {
        bundle_digest: "bundle-digest-recomputed",
        fingerprint: "fingerprint-recomputed",
        idempotency_key: "idem:obj.bundle.1:fingerprint-recomputed",
        merkle_root: "merkle-root-recomputed",
        item_count: 2,
        total_bytes: 30,
      },
    });
    expect(Object.isFrozen(out)).toBe(true);
  });

  it("verifyIngestBundle reports summary and merkle mismatches", async () => {
    const { verifyIngestBundle } = await import("../../../../src/ingest/verifier.js");

    parseIngestBundleV1Mock.mockReturnValue({
      identity: {
        object_key: "obj.bundle.2",
        object_kind: "file_set",
      },
      items: [
        { bytes: 10, leaf_hash: "a" },
        { bytes: 20, leaf_hash: "b" },
      ],
      merkle: {
        leaf_count: 99,
        root: "wrong-root",
      },
      summary: {
        item_count: 7,
        total_bytes: 999,
      },
    });

    const out = verifyIngestBundle({ bad: true });

    expect(out.ok).toBe(false);
    expect(out.mismatches).toEqual([
      { field: "summary.item_count", expected: 2, actual: 7 },
      { field: "summary.total_bytes", expected: 30, actual: 999 },
      { field: "merkle.leaf_count", expected: 2, actual: 99 },
      { field: "merkle.root", expected: "merkle-root-recomputed", actual: "wrong-root" },
    ]);
  });

  it("verifyIngestBundle omits merkle checks when bundle has no merkle block", async () => {
    const { verifyIngestBundle } = await import("../../../../src/ingest/verifier.js");

    parseIngestBundleV1Mock.mockReturnValue({
      identity: {
        object_key: "obj.bundle.3",
        object_kind: "file",
      },
      items: [{ bytes: 1, leaf_hash: "a" }],
      summary: {
        item_count: 1,
        total_bytes: 1,
      },
    });

    const out = verifyIngestBundle({});

    expect(merkleRootFromItemsMock).not.toHaveBeenCalled();
    expect(out.ok).toBe(true);
    expect(out.computed).toEqual({
      bundle_digest: "bundle-digest-recomputed",
      fingerprint: "fingerprint-recomputed",
      idempotency_key: "idem:obj.bundle.3:fingerprint-recomputed",
      item_count: 1,
      total_bytes: 1,
    });
  });

  it("verifyIngestReceipt returns ok=true when receipt_id and idempotency_key match recomputed values", async () => {
    const { verifyIngestReceipt } = await import("../../../../src/ingest/verifier.js");

    parseIngestReceiptV1Mock.mockReturnValue({
      receipt_id: "receipt-id-recomputed",
      identity: {
        object_key: "obj.receipt.1",
      },
      evidence: {
        fingerprint: "fp-1",
        idempotency_key: "idem:obj.receipt.1:fp-1",
      },
      mode: "hash_only",
      v: "v1",
      kind: "ingest_receipt",
    });

    const out = verifyIngestReceipt({ any: true });

    expect(hashJsonDigestMock).toHaveBeenCalledWith({
      domain: "va:ingest:receipt:v1",
      value: {
        identity: {
          object_key: "obj.receipt.1",
        },
        evidence: {
          fingerprint: "fp-1",
          idempotency_key: "idem:obj.receipt.1:fp-1",
        },
        mode: "hash_only",
        v: "v1",
        kind: "ingest_receipt",
      },
      alg: "sha3-512",
      encoding: "hex_lower",
    });

    expect(ingestIdempotencyKeyMock).toHaveBeenCalledWith("obj.receipt.1", "fp-1");
    expect(out).toEqual({
      ok: true,
      mismatches: [],
      computed: {
        receipt_id: "receipt-id-recomputed",
        idempotency_key: "idem:obj.receipt.1:fp-1",
      },
    });
  });

  it("verifyIngestReceipt reports receipt_id and idempotency_key mismatches", async () => {
    const { verifyIngestReceipt } = await import("../../../../src/ingest/verifier.js");

    parseIngestReceiptV1Mock.mockReturnValue({
      receipt_id: "wrong-receipt-id",
      identity: {
        object_key: "obj.receipt.2",
      },
      evidence: {
        fingerprint: "fp-2",
        idempotency_key: "wrong-idem",
      },
    });

    const out = verifyIngestReceipt({ bad: true });

    expect(out.ok).toBe(false);
    expect(out.mismatches).toEqual([
      { field: "receipt_id", expected: "receipt-id-recomputed", actual: "wrong-receipt-id" },
      { field: "evidence.idempotency_key", expected: "idem:obj.receipt.2:fp-2", actual: "wrong-idem" },
    ]);
  });

  it("verifyIngestFileSetAgainstReceiptOrBundle throws when neither receipt nor bundle provides identity", async () => {
    const { verifyIngestFileSetAgainstReceiptOrBundle } = await import("../../../../src/ingest/verifier.js");

    await expect(
      verifyIngestFileSetAgainstReceiptOrBundle({
        root_dir: "/tmp/data",
      }),
    ).rejects.toThrow(/requires receipt or bundle/i);
  });

  it("verifyIngestFileSetAgainstReceiptOrBundle verifies against receipt fields", async () => {
    const { verifyIngestFileSetAgainstReceiptOrBundle } = await import("../../../../src/ingest/verifier.js");

    parseIngestReceiptV1Mock.mockReturnValue({
      identity: {
        object_key: "obj.fileset.1",
        object_kind: "file_set",
        version_label: "v1",
        program: "sage",
      },
      rules: {
        follow_symlinks: true,
        redact_paths: true,
        normalize_line_endings: true,
        include_globs: Object.freeze(["**/*.tsv"]),
        exclude_globs: Object.freeze(["tmp/**"]),
        allowed_suffixes: Object.freeze([".tsv"]),
      },
      evidence: {
        fingerprint: "fp-local",
        bundle_digest: "bundle-local",
        merkle_root: "root-local",
        idempotency_key: "idem-local",
        item_count: 2,
        total_bytes: 30,
      },
    });

    executeIngestMock.mockResolvedValue({
      fingerprint: "fp-local",
      bundle_digest: "bundle-local",
      merkle_root: "root-local",
      idempotency_key: "idem-local",
      bundle: {
        summary: {
          item_count: 2,
          total_bytes: 30,
        },
      },
    });

    const out = await verifyIngestFileSetAgainstReceiptOrBundle({
      receipt: { any: true },
      root_dir: "/tmp/data",
    });

    expect(executeIngestMock).toHaveBeenCalledWith({
      mode: "hash_only",
      identity: {
        object_key: "obj.fileset.1",
        object_kind: "file_set",
        version_label: "v1",
        program: "sage",
      },
      material: {
        kind: "file_set",
        root_dir: "/tmp/data",
        rules: {
          follow_symlinks: true,
          redact_paths: true,
          normalize_line_endings: true,
          include_globs: ["**/*.tsv"],
          exclude_globs: ["tmp/**"],
          allowed_suffixes: [".tsv"],
        },
      },
    });

    expect(out).toEqual({
      ok: true,
      mismatches: [],
      computed: {
        local_fingerprint: "fp-local",
        local_bundle_digest: "bundle-local",
        local_merkle_root: "root-local",
        local_idempotency_key: "idem-local",
        local_item_count: 2,
        local_total_bytes: 30,
      },
    });
  });

  it("verifyIngestFileSetAgainstReceiptOrBundle reports receipt mismatches", async () => {
    const { verifyIngestFileSetAgainstReceiptOrBundle } = await import("../../../../src/ingest/verifier.js");

    parseIngestReceiptV1Mock.mockReturnValue({
      identity: {
        object_key: "obj.fileset.2",
        object_kind: "file_set",
      },
      rules: {
        follow_symlinks: false,
        redact_paths: false,
        normalize_line_endings: false,
      },
      evidence: {
        fingerprint: "receipt-fp",
        bundle_digest: "receipt-bundle",
        merkle_root: "receipt-root",
        idempotency_key: "receipt-idem",
        item_count: 9,
        total_bytes: 999,
      },
    });

    executeIngestMock.mockResolvedValue({
      fingerprint: "local-fp",
      bundle_digest: "local-bundle",
      merkle_root: "local-root",
      idempotency_key: "local-idem",
      bundle: {
        summary: {
          item_count: 2,
          total_bytes: 20,
        },
      },
    });

    const out = await verifyIngestFileSetAgainstReceiptOrBundle({
      receipt: { any: true },
      root_dir: "/tmp/data",
    });

    expect(out.ok).toBe(false);
    expect(out.mismatches).toEqual([
      { field: "evidence.fingerprint", expected: "local-fp", actual: "receipt-fp" },
      { field: "evidence.bundle_digest", expected: "local-bundle", actual: "receipt-bundle" },
      { field: "evidence.merkle_root", expected: "local-root", actual: "receipt-root" },
      { field: "evidence.idempotency_key", expected: "local-idem", actual: "receipt-idem" },
      { field: "evidence.item_count", expected: 2, actual: 9 },
      { field: "evidence.total_bytes", expected: 20, actual: 999 },
    ]);
  });

  it("verifyIngestFileSetAgainstReceiptOrBundle verifies against bundle and local recomputation", async () => {
    const { verifyIngestFileSetAgainstReceiptOrBundle } = await import("../../../../src/ingest/verifier.js");

    const parsedBundle = {
      identity: {
        object_key: "obj.fileset.3",
        object_kind: "file_set",
      },
      rules: {
        follow_symlinks: false,
        redact_paths: true,
        normalize_line_endings: true,
        include_globs: Object.freeze(["**/*.tsv"]),
        allowed_suffixes: Object.freeze([".tsv"]),
      },
      items: [
        { bytes: 5, leaf_hash: "a" },
        { bytes: 7, leaf_hash: "b" },
      ],
      merkle: {
        leaf_count: 2,
        root: "merkle-root-recomputed",
      },
      summary: {
        item_count: 2,
        total_bytes: 12,
      },
    };

    parseIngestBundleV1Mock.mockReturnValue(parsedBundle);
    executeIngestMock.mockResolvedValue({
      fingerprint: "fingerprint-recomputed",
      bundle_digest: "bundle-digest-recomputed",
      merkle_root: "merkle-root-recomputed",
      idempotency_key: "idem:obj.fileset.3:fingerprint-recomputed",
      bundle: {
        summary: {
          item_count: 2,
          total_bytes: 12,
        },
      },
    });

    const out = await verifyIngestFileSetAgainstReceiptOrBundle({
      bundle: { any: true },
      root_dir: "/tmp/data",
    });

    expect(out.ok).toBe(true);
    expect(out.mismatches).toEqual([]);
  });

  it("verifyIngestFileSetAgainstReceiptOrBundle includes bundle-check mismatches and local-vs-bundle mismatches", async () => {
    const { verifyIngestFileSetAgainstReceiptOrBundle } = await import("../../../../src/ingest/verifier.js");

    parseIngestBundleV1Mock.mockReturnValue({
      identity: {
        object_key: "obj.fileset.4",
        object_kind: "file_set",
      },
      rules: {
        follow_symlinks: false,
        redact_paths: false,
        normalize_line_endings: false,
      },
      items: [
        { bytes: 1, leaf_hash: "a" },
        { bytes: 2, leaf_hash: "b" },
      ],
      merkle: {
        leaf_count: 99,
        root: "wrong-root",
      },
      summary: {
        item_count: 7,
        total_bytes: 999,
      },
    });

    executeIngestMock.mockResolvedValue({
      fingerprint: "local-fp",
      bundle_digest: "local-bundle",
      merkle_root: "local-root",
      idempotency_key: "local-idem",
      bundle: {
        summary: {
          item_count: 2,
          total_bytes: 3,
        },
      },
    });

    const out = await verifyIngestFileSetAgainstReceiptOrBundle({
      bundle: { any: true },
      root_dir: "/tmp/data",
    });

    expect(out.ok).toBe(false);
    expect(out.mismatches).toEqual([
      { field: "summary.item_count", expected: 2, actual: 7 },
      { field: "summary.total_bytes", expected: 3, actual: 999 },
      { field: "merkle.leaf_count", expected: 2, actual: 99 },
      { field: "merkle.root", expected: "merkle-root-recomputed", actual: "wrong-root" },
      { field: "local.bundle_digest", expected: "bundle-digest-recomputed", actual: "local-bundle" },
      { field: "local.fingerprint", expected: "fingerprint-recomputed", actual: "local-fp" },
      { field: "local.merkle_root", expected: "merkle-root-recomputed", actual: "local-root" },
    ]);
  });

  it("verifyIngestFileSetAgainstReceiptOrBundle merges receipt and bundle mismatch sets together", async () => {
    const { verifyIngestFileSetAgainstReceiptOrBundle } = await import("../../../../src/ingest/verifier.js");

    parseIngestReceiptV1Mock.mockReturnValue({
      identity: {
        object_key: "obj.fileset.5",
        object_kind: "file_set",
      },
      rules: {
        follow_symlinks: false,
        redact_paths: false,
        normalize_line_endings: false,
      },
      evidence: {
        fingerprint: "receipt-fp",
        bundle_digest: "receipt-bundle",
        merkle_root: "receipt-root",
        idempotency_key: "receipt-idem",
        item_count: 7,
        total_bytes: 700,
      },
    });

    parseIngestBundleV1Mock.mockReturnValue({
      identity: {
        object_key: "obj.fileset.5",
        object_kind: "file_set",
      },
      rules: {
        follow_symlinks: false,
        redact_paths: false,
        normalize_line_endings: false,
      },
      items: [
        { bytes: 1, leaf_hash: "a" },
      ],
      merkle: {
        leaf_count: 1,
        root: "wrong-root",
      },
      summary: {
        item_count: 9,
        total_bytes: 999,
      },
    });

    merkleRootFromItemsMock.mockReturnValue({
      leaf_count: 1,
      root: "merkle-root-recomputed",
    });

    executeIngestMock.mockResolvedValue({
      fingerprint: "local-fp",
      bundle_digest: "local-bundle",
      merkle_root: "local-root",
      idempotency_key: "local-idem",
      bundle: {
        summary: {
          item_count: 1,
          total_bytes: 1,
        },
      },
    });

    const out = await verifyIngestFileSetAgainstReceiptOrBundle({
      receipt: { receipt: true },
      bundle: { bundle: true },
      root_dir: "/tmp/data",
    });

    expect(out.ok).toBe(false);
    expect(out.mismatches.length).toBeGreaterThan(0);
    expect(out.computed).toEqual({
      local_fingerprint: "local-fp",
      local_bundle_digest: "local-bundle",
      local_merkle_root: "local-root",
      local_idempotency_key: "local-idem",
      local_item_count: 1,
      local_total_bytes: 1,
    });
  });
});