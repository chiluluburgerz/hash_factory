// ============================================================================
// File: tests/units/ingest/bundle.test.ts
// Version: 1.0.0-hf-ingest-bundle-unit | 2026-03-07
// Purpose:
//   Unit tests for src/ingest/bundle.ts
// Notes:
//   - Pure deterministic tests.
//   - Mocks hashing contract boundary to verify exact domain/value wiring.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const hashJsonDigest = vi.fn((input: any) => {
  return `digest:${input.domain}:${JSON.stringify(input.value)}`;
});

vi.mock("../../../../src/hashing/contract.js", () => ({
  HF_HASH_CONTRACT_INFO: Object.freeze({
    contract_version: "hf-contract-v1",
    alg: "sha3-512",
    encoding: "hex_lower",
  }),
  hashJsonDigest,
}));

describe("ingest/bundle (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buildIngestBundleV1 requires identity", async () => {
    const { buildIngestBundleV1 } = await import("../../../../src/ingest/bundle.js");

    expect(() =>
      buildIngestBundleV1({
        identity: null as any,
        items: [{ item_kind: "text", bytes: 1, sha3_512: "a", leaf_hash: "b" }] as any,
      }),
    ).toThrow(/bundle_identity_required/i);
  });

  it("buildIngestBundleV1 requires non-empty items", async () => {
    const { buildIngestBundleV1 } = await import("../../../../src/ingest/bundle.js");

    expect(() =>
      buildIngestBundleV1({
        identity: {
          object_key: "obj-1",
          object_kind: "dataset",
        } as any,
        items: [],
      }),
    ).toThrow(/bundle_items_required/i);
  });

  it("buildIngestBundleV1 builds deterministic bundle with summary, rules, and lowercased merkle root", async () => {
    const { buildIngestBundleV1 } = await import("../../../../src/ingest/bundle.js");

    const items = Object.freeze([
      Object.freeze({
        item_kind: "file",
        path_rel: "a.txt",
        bytes: 10,
        sha3_512: "aaa",
        leaf_hash: "leaf-a",
      }),
      Object.freeze({
        item_kind: "file",
        path_rel: "b.txt",
        bytes: 20,
        sha3_512: "bbb",
        leaf_hash: "leaf-b",
      }),
    ]) as any;

    const bundle = buildIngestBundleV1({
      identity: {
        object_key: "dataset-1",
        object_kind: "dataset",
        version_label: "v1",
        program: "sage",
      } as any,
      rules: {
        follow_symlinks: true,
        redact_paths: true,
        normalize_line_endings: true,
        include_globs: ["**/*.tsv"],
        exclude_globs: ["**/tmp/**"],
        allowed_suffixes: [".tsv", ".csv"],
      } as any,
      items,
      merkle: {
        leaf_count: 2,
        root: "ABCDEF1234",
      } as any,
    });

    expect(bundle).toEqual({
      bundle_version: "v1",
      hash_contract: {
        contract_version: "hf-contract-v1",
        alg: "sha3-512",
        encoding: "hex_lower",
      },
      identity: {
        object_key: "dataset-1",
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
        include_globs: ["**/*.tsv"],
        exclude_globs: ["**/tmp/**"],
        allowed_suffixes: [".tsv", ".csv"],
      },
      items,
      merkle: {
        leaf_count: 2,
        root: "abcdef1234",
      },
      summary: {
        item_count: 2,
        total_bytes: 30,
      },
    });

    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.identity)).toBe(true);
    expect(Object.isFrozen(bundle.rules)).toBe(true);
    expect(Object.isFrozen(bundle.items)).toBe(true);
    expect(Object.isFrozen(bundle.summary)).toBe(true);
  });

  it("buildIngestBundleV1 omits empty optional rule arrays", async () => {
    const { buildIngestBundleV1 } = await import("../../../../src/ingest/bundle.js");

    const bundle = buildIngestBundleV1({
      identity: {
        object_key: "dataset-2",
        object_kind: "dataset",
      } as any,
      rules: {
        follow_symlinks: false,
        redact_paths: false,
        normalize_line_endings: false,
        include_globs: [],
        exclude_globs: [],
        allowed_suffixes: [],
      } as any,
      items: [
        {
          item_kind: "text",
          bytes: 5,
          sha3_512: "x",
          leaf_hash: "y",
        },
      ] as any,
    });

    expect(bundle.rules).toEqual({
      path_normalization: "posix_rel_no_dotdot",
      follow_symlinks: false,
      redact_paths: false,
      normalize_line_endings: false,
      ordering: "deterministic_sort_v1",
      merkle_rule: "dup_last_on_odd",
    });
  });

  it("buildIngestBundleV1 throws BUNDLE_INVALID when any item bytes is negative", async () => {
    const { buildIngestBundleV1 } = await import("../../../../src/ingest/bundle.js");

    expect(() =>
      buildIngestBundleV1({
        identity: {
          object_key: "dataset-3",
          object_kind: "dataset",
        } as any,
        items: [
          {
            item_kind: "file",
            path_rel: "bad.bin",
            bytes: -1,
            sha3_512: "dead",
            leaf_hash: "beef",
          },
        ] as any,
      }),
    ).toThrow(/bundle_item_bytes_invalid/i);
  });

  it("ingestBundleDigest hashes bundle under the bundle domain", async () => {
    const { ingestBundleDigest } = await import("../../../../src/ingest/bundle.js");

    const bundle = Object.freeze({
      bundle_version: "v1",
      identity: { object_key: "obj-1", object_kind: "dataset" },
    }) as any;

    const out = ingestBundleDigest(bundle);

    expect(out).toBe(`digest:va:ingest:bundle:v1:${JSON.stringify(bundle)}`);
    expect(hashJsonDigest).toHaveBeenCalledWith({
      domain: "va:ingest:bundle:v1",
      value: bundle,
      alg: "sha3-512",
      encoding: "hex_lower",
    });
  });

  it("ingestFingerprint hashes bundle under the fingerprint domain", async () => {
    const { ingestFingerprint } = await import("../../../../src/ingest/bundle.js");

    const bundle = Object.freeze({
      bundle_version: "v1",
      identity: { object_key: "obj-2", object_kind: "report" },
    }) as any;

    const out = ingestFingerprint(bundle);

    expect(out).toBe(`digest:va:ingest:fingerprint:v1:${JSON.stringify(bundle)}`);
    expect(hashJsonDigest).toHaveBeenCalledWith({
      domain: "va:ingest:fingerprint:v1",
      value: bundle,
      alg: "sha3-512",
      encoding: "hex_lower",
    });
  });

  it("ingestIdempotencyKey hashes object_key + fingerprint with explicit null separator payload", async () => {
    const { ingestIdempotencyKey } = await import("../../../../src/ingest/bundle.js");

    const out = ingestIdempotencyKey("obj-3", "fp-123");

    expect(out).toBe(
      `digest:va:ingest:idem:v1:${JSON.stringify({
        object_key: "obj-3",
        fingerprint: "fp-123",
        sep: "\u0000",
        combined: "obj-3\u0000fp-123",
      })}`,
    );

    expect(hashJsonDigest).toHaveBeenCalledWith({
      domain: "va:ingest:idem:v1",
      value: {
        object_key: "obj-3",
        fingerprint: "fp-123",
        sep: "\u0000",
        combined: "obj-3\u0000fp-123",
      },
      alg: "sha3-512",
      encoding: "hex_lower",
    });
  });
});