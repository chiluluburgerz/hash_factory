// ============================================================================
// File: tests/units/ingest/execute.test.ts
// Version: 1.0.0-hf-ingest-execute-unit | 2026-03-07
// Purpose:
//   Unit tests for src/ingest/execute.ts
// Notes:
//   - Focuses on exported orchestration boundaries:
//       • planIngest()
//       • executeIngest()
//   - Uses mocks for filesystem/hash/scan/bundle/merkle/validation boundaries.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const lstatMock = vi.fn();

vi.mock("node:fs", () => ({
  default: {
    promises: {
      lstat: lstatMock,
    },
  },
}));

const hashJsonMock = vi.fn();
const hashUtf8Mock = vi.fn();

vi.mock("../../../../src/hashing/hashFactory.js", () => ({
  hashJson: hashJsonMock,
  hashUtf8: hashUtf8Mock,
}));

const normalizeJsonValueMock = vi.fn();
vi.mock("../../../../src/ingest/jsonNorm.js", () => ({
  normalizeJsonValue: normalizeJsonValueMock,
}));

const normalizeRelPathMock = vi.fn((p: string) => String(p).replace(/\\/g, "/"));
vi.mock("../../../../src/ingest/pathNorm.js", () => ({
  normalizeRelPath: normalizeRelPathMock,
}));

const scanIngestFilesMock = vi.fn();
vi.mock("../../../../src/ingest/scan.js", () => ({
  scanIngestFiles: scanIngestFilesMock,
}));

const normalizeTextMock = vi.fn();
vi.mock("../../../../src/ingest/textNorm.js", () => ({
  normalizeText: normalizeTextMock,
}));

const buildPathHashMock = vi.fn((p: string) => `pathhash:${p}`);
const hashScannedFileMock = vi.fn();
vi.mock("../../../../src/ingest/fileHash.js", () => ({
  buildPathHash: buildPathHashMock,
  hashScannedFile: hashScannedFileMock,
}));

const buildIngestBundleV1Mock = vi.fn();
const ingestBundleDigestMock = vi.fn();
const ingestFingerprintMock = vi.fn();
const ingestIdempotencyKeyMock = vi.fn();
vi.mock("../../../../src/ingest/bundle.js", () => ({
  buildIngestBundleV1: buildIngestBundleV1Mock,
  ingestBundleDigest: ingestBundleDigestMock,
  ingestFingerprint: ingestFingerprintMock,
  ingestIdempotencyKey: ingestIdempotencyKeyMock,
}));

const merkleRootFromItemsMock = vi.fn();
vi.mock("../../../../src/ingest/merkle.js", () => ({
  merkleRootFromItems: merkleRootFromItemsMock,
}));

const parseIngestExecuteRequestV1Mock = vi.fn();
vi.mock("../../../../src/ingest/validators.js", () => ({
  parseIngestExecuteRequestV1: parseIngestExecuteRequestV1Mock,
}));

const hashJsonDigestMock = vi.fn((input: any) => `plan:${input.domain}:${JSON.stringify(input.value)}`);
vi.mock("../../../../src/hashing/contract.js", () => ({
  hashJsonDigest: hashJsonDigestMock,
}));

describe("ingest/execute (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    hashJsonMock.mockReturnValue({ digest: "json-digest" });
    hashUtf8Mock.mockReturnValue({ digest: "text-digest" });

    normalizeJsonValueMock.mockReturnValue({
      canonical_text: '{"a":1,"b":2}',
      bytes: 13,
    });

    normalizeTextMock.mockImplementation(({ text }) => ({
      text: String(text),
      bytes: Buffer.byteLength(String(text), "utf8"),
    }));

    buildIngestBundleV1Mock.mockReturnValue(Object.freeze({ bundle_version: "v1", ok: true }));
    ingestBundleDigestMock.mockReturnValue("bundle-digest-1");
    ingestFingerprintMock.mockReturnValue("fingerprint-1");
    ingestIdempotencyKeyMock.mockReturnValue("idem-1");

    merkleRootFromItemsMock.mockReturnValue({
      leaf_count: 1,
      root: "merkle-root-1",
    });
  });

  it("planIngest returns deterministic plan for file_set register_and_anchor", async () => {
    const { planIngest } = await import("../../../../src/ingest/execute.js");

    parseIngestExecuteRequestV1Mock.mockReturnValue({
      identity: {
        object_key: "org.prog.dataset.v1",
        object_kind: "dataset",
        version_label: "v1",
        program: "sage",
      },
      mode: "register_and_anchor",
      domain: "rna",
      proof_date: "2026-03-06",
      material: {
        kind: "file_set",
        root_dir: "/tmp/data",
        rules: {
          redact_paths: true,
          normalize_line_endings: true,
        },
      },
    });

    const plan = planIngest({ anything: true } as any);

    expect(plan).toEqual({
      object_key: "org.prog.dataset.v1",
      plan_id: expect.stringContaining("va:ingest:plan:v1"),
      steps: ["scan", "hash", "merkle", "bundle", "anchor_payload"],
    });

    expect(hashJsonDigestMock).toHaveBeenCalledWith({
      domain: "va:ingest:plan:v1",
      value: {
        object_key: "org.prog.dataset.v1",
        object_kind: "dataset",
        version_label: "v1",
        program: "sage",
        mode: "register_and_anchor",
        material_kind: "file_set",
        rules: {
          redact_paths: true,
          normalize_line_endings: true,
        },
        domain: "rna",
        proof_date: "2026-03-06",
      },
      alg: "sha3-512",
      encoding: "hex_lower",
    });
  });

  it("planIngest returns normalize/hash/merkle/bundle for non-file_set hash_only", async () => {
    const { planIngest } = await import("../../../../src/ingest/execute.js");

    parseIngestExecuteRequestV1Mock.mockReturnValue({
      identity: {
        object_key: "text.object",
        object_kind: "note",
      },
      mode: "hash_only",
      domain: null,
      proof_date: null,
      material: {
        kind: "text",
        text: "hello",
      },
    });

    const plan = planIngest({} as any);

    expect(plan.steps).toEqual(["normalize", "hash", "merkle", "bundle"]);
  });

  it("planIngest throws INPUT_INVALID when object_key trims to empty", async () => {
    const { planIngest } = await import("../../../../src/ingest/execute.js");

    parseIngestExecuteRequestV1Mock.mockReturnValue({
      identity: {
        object_key: "   ",
        object_kind: "dataset",
      },
      mode: "hash_only",
      material: {
        kind: "json",
        value: { a: 1 },
      },
    });

    expect(() => planIngest({} as any)).toThrow(/object_key_required/i);
  });

  it("executeIngest runs json path and returns derived result", async () => {
    const { executeIngest } = await import("../../../../src/ingest/execute.js");

    parseIngestExecuteRequestV1Mock.mockReturnValue({
      identity: {
        object_key: "obj.json.1",
        object_kind: "dataset",
        program: "sage",
      },
      mode: "hash_only",
      material: {
        kind: "json",
        value: { b: 2, a: 1 },
      },
    });

    const result = await executeIngest({ any: "input" } as any);

    expect(normalizeJsonValueMock).toHaveBeenCalledWith({ b: 2, a: 1 });

    expect(hashJsonMock).toHaveBeenCalledWith({
      domain: "va:ingest:json:v1",
      value: { a: 1, b: 2 },
      alg: "sha3-512",
      encoding: "hex_lower",
    });

    expect(hashJsonMock).toHaveBeenCalledWith({
      domain: "va:ingest:leaf:v1",
      value: {
        item_kind: "json",
        media_type: "application/json",
        bytes: 13,
        sha3_512: "json-digest",
      },
      alg: "sha3-512",
      encoding: "hex_lower",
    });

    expect(merkleRootFromItemsMock).toHaveBeenCalledTimes(1);

    expect(buildIngestBundleV1Mock).toHaveBeenCalledWith({
      identity: {
        object_key: "obj.json.1",
        object_kind: "dataset",
        program: "sage",
      },
      items: [
        {
          item_kind: "json",
          media_type: "application/json",
          bytes: 13,
          sha3_512: "json-digest",
          leaf_hash: "json-digest",
        },
      ],
      merkle: {
        leaf_count: 1,
        root: "merkle-root-1",
      },
    });

    expect(ingestBundleDigestMock).toHaveBeenCalledWith({ bundle_version: "v1", ok: true });
    expect(ingestFingerprintMock).toHaveBeenCalledWith({ bundle_version: "v1", ok: true });
    expect(ingestIdempotencyKeyMock).toHaveBeenCalledWith("obj.json.1", "fingerprint-1");

    expect(result).toEqual({
      object_key: "obj.json.1",
      object_kind: "dataset",
      fingerprint: "fingerprint-1",
      bundle_digest: "bundle-digest-1",
      merkle_root: "merkle-root-1",
      bundle: { bundle_version: "v1", ok: true },
      idempotency_key: "idem-1",
    });
  });

  it("executeIngest runs text path without media_type when absent", async () => {
    const { executeIngest } = await import("../../../../src/ingest/execute.js");

    parseIngestExecuteRequestV1Mock.mockReturnValue({
      identity: {
        object_key: "obj.txt.1",
        object_kind: "note",
      },
      mode: "hash_only",
      material: {
        kind: "text",
        text: "hello",
        media_type: null,
      },
    });

    const result = await executeIngest({} as any);

    expect(normalizeTextMock).toHaveBeenCalledWith({
      text: "hello",
      normalize_line_endings: false,
    });

    expect(hashUtf8Mock).toHaveBeenCalledWith({
      domain: "va:ingest:text:v1",
      text: "hello",
      alg: "sha3-512",
      encoding: "hex_lower",
    });

    expect(result.object_key).toBe("obj.txt.1");
    expect(result.merkle_root).toBe("merkle-root-1");
  });

  it("executeIngest runs single-file path, stats file, hashes it, and emits hash progress", async () => {
    const { executeIngest } = await import("../../../../src/ingest/execute.js");

    parseIngestExecuteRequestV1Mock.mockReturnValue({
      identity: {
        object_key: "obj.file.1",
        object_kind: "artifact",
      },
      mode: "hash_only",
      material: {
        kind: "file",
        path: "/tmp/subdir/report.tsv",
      },
    });

    lstatMock.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      size: 123,
    });

    hashScannedFileMock.mockResolvedValue({
      path_rel: "report.tsv",
      media_type: "text/tab-separated-values",
      bytes: 123,
      sha3_512: "file-digest-1",
    });

    hashJsonMock.mockImplementation(({ domain, value }) => ({
      digest: domain === "va:ingest:leaf:v1" ? `leaf:${JSON.stringify(value)}` : "json-digest",
    }));

    const onHashProgress = vi.fn();

    const result = await executeIngest(
      {} as any,
      {
        onHashProgress,
      },
    );

    expect(lstatMock).toHaveBeenCalledWith(expect.stringContaining("report.tsv"));
    expect(hashScannedFileMock).toHaveBeenCalledWith(
      {
        path_rel: "report.tsv",
        abs_path: expect.stringContaining("report.tsv"),
        bytes: 123,
      },
      {
        normalize_line_endings: false,
      },
    );

    expect(onHashProgress).toHaveBeenCalledWith({
      event: "item",
      index: 1,
      total: 1,
      item_kind: "file",
      path_rel: "report.tsv",
      bytes: 123,
    });

    expect(buildIngestBundleV1Mock).toHaveBeenCalledWith({
      identity: {
        object_key: "obj.file.1",
        object_kind: "artifact",
      },
      items: [
        {
          item_kind: "file",
          path_rel: "report.tsv",
          media_type: "text/tab-separated-values",
          bytes: 123,
          sha3_512: "file-digest-1",
          leaf_hash: expect.stringContaining('"item_kind":"file"'),
        },
      ],
      merkle: {
        leaf_count: 1,
        root: "merkle-root-1",
      },
    });

    expect(result.object_key).toBe("obj.file.1");
  });

  it("executeIngest rejects single-file material when stat says path is not a file", async () => {
    const { executeIngest } = await import("../../../../src/ingest/execute.js");

    parseIngestExecuteRequestV1Mock.mockReturnValue({
      identity: {
        object_key: "obj.file.bad",
        object_kind: "artifact",
      },
      mode: "hash_only",
      material: {
        kind: "file",
        path: "/tmp/not-a-file",
      },
    });

    lstatMock.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => false,
      size: 0,
    });

    await expect(executeIngest({} as any)).rejects.toMatchObject({
      name: "IngestError",
      message: "material.path_not_file",
      code: "INPUT_INVALID",
      statusCode: 400,
    });
  });

  it("executeIngest wraps single-file stat failures as FILE_READ_FAILED", async () => {
    const { executeIngest } = await import("../../../../src/ingest/execute.js");

    parseIngestExecuteRequestV1Mock.mockReturnValue({
      identity: {
        object_key: "obj.file.err",
        object_kind: "artifact",
      },
      mode: "hash_only",
      material: {
        kind: "file",
        path: "/tmp/missing.txt",
      },
    });

    const cause = new Error("ENOENT");
    lstatMock.mockRejectedValue(cause);

    await expect(executeIngest({} as any)).rejects.toMatchObject({
      name: "IngestError",
      message: "material.path_stat_failed",
      code: "FILE_READ_FAILED",
      statusCode: 500,
    });
  });

  it("executeIngest runs file_set path, redacts paths, sorts deterministically, and forwards scan/hash progress", async () => {
    const { executeIngest } = await import("../../../../src/ingest/execute.js");

    parseIngestExecuteRequestV1Mock.mockReturnValue({
      identity: {
        object_key: "obj.fileset.1",
        object_kind: "dataset",
      },
      mode: "register_and_anchor",
      material: {
        kind: "file_set",
        root_dir: "/tmp/dataset",
        rules: {
          redact_paths: true,
          normalize_line_endings: true,
        },
      },
    });

    const scanned = [
      { path_rel: "z-last.tsv", abs_path: "/tmp/dataset/z-last.tsv", bytes: 9 },
      { path_rel: "a-first.tsv", abs_path: "/tmp/dataset/a-first.tsv", bytes: 5 },
    ];

    scanIngestFilesMock.mockResolvedValue(scanned);

    hashScannedFileMock.mockImplementation(async (file: any) => {
      if (file.path_rel === "z-last.tsv") {
        return {
          path_rel: "z-last.tsv",
          media_type: "text/tab-separated-values",
          bytes: 9,
          sha3_512: "sha-z",
        };
      }
      return {
        path_rel: "a-first.tsv",
        media_type: "text/tab-separated-values",
        bytes: 5,
        sha3_512: "sha-a",
      };
    });

    hashJsonMock.mockImplementation(({ domain, value }) => ({
      digest: domain === "va:ingest:leaf:v1" ? `leaf:${JSON.stringify(value)}` : "json-digest",
    }));

    merkleRootFromItemsMock.mockReturnValue({
      leaf_count: 2,
      root: "merkle-root-fileset",
    });

    const onScanProgress = vi.fn();
    const onHashProgress = vi.fn();

    const result = await executeIngest(
      {} as any,
      {
        onScanProgress,
        onHashProgress,
      },
    );

    expect(scanIngestFilesMock).toHaveBeenCalledWith(
      "/tmp/dataset",
      {
        redact_paths: true,
        normalize_line_endings: true,
      },
      onScanProgress,
    );

    expect(hashScannedFileMock).toHaveBeenNthCalledWith(
      1,
      scanned[0],
      { normalize_line_endings: true },
    );
    expect(hashScannedFileMock).toHaveBeenNthCalledWith(
      2,
      scanned[1],
      { normalize_line_endings: true },
    );

    expect(buildPathHashMock).toHaveBeenCalledWith("z-last.tsv");
    expect(buildPathHashMock).toHaveBeenCalledWith("a-first.tsv");

    expect(onHashProgress).toHaveBeenNthCalledWith(1, {
      event: "item",
      index: 1,
      total: 2,
      item_kind: "file",
      bytes: 9,
    });
    expect(onHashProgress).toHaveBeenNthCalledWith(2, {
      event: "item",
      index: 2,
      total: 2,
      item_kind: "file",
      bytes: 5,
    });

    expect(merkleRootFromItemsMock).toHaveBeenCalledWith([
      {
        item_kind: "file",
        path_hash: "pathhash:a-first.tsv",
        media_type: "text/tab-separated-values",
        bytes: 5,
        sha3_512: "sha-a",
        leaf_hash: expect.any(String),
      },
      {
        item_kind: "file",
        path_hash: "pathhash:z-last.tsv",
        media_type: "text/tab-separated-values",
        bytes: 9,
        sha3_512: "sha-z",
        leaf_hash: expect.any(String),
      },
    ]);

    expect(buildIngestBundleV1Mock).toHaveBeenCalledWith({
      identity: {
        object_key: "obj.fileset.1",
        object_kind: "dataset",
      },
      rules: {
        redact_paths: true,
        normalize_line_endings: true,
      },
      items: [
        {
          item_kind: "file",
          path_hash: "pathhash:a-first.tsv",
          media_type: "text/tab-separated-values",
          bytes: 5,
          sha3_512: "sha-a",
          leaf_hash: expect.any(String),
        },
        {
          item_kind: "file",
          path_hash: "pathhash:z-last.tsv",
          media_type: "text/tab-separated-values",
          bytes: 9,
          sha3_512: "sha-z",
          leaf_hash: expect.any(String),
        },
      ],
      merkle: {
        leaf_count: 2,
        root: "merkle-root-fileset",
      },
    });

    expect(result).toEqual({
      object_key: "obj.fileset.1",
      object_kind: "dataset",
      fingerprint: "fingerprint-1",
      bundle_digest: "bundle-digest-1",
      merkle_root: "merkle-root-fileset",
      bundle: { bundle_version: "v1", ok: true },
      idempotency_key: "idem-1",
    });
  });

  it("executeIngest throws EXECUTE_EMPTY when material execution returns no items", async () => {
    const { executeIngest } = await import("../../../../src/ingest/execute.js");

    parseIngestExecuteRequestV1Mock.mockReturnValue({
      identity: {
        object_key: "obj.empty.1",
        object_kind: "dataset",
      },
      mode: "hash_only",
      material: {
        kind: "file_set",
        root_dir: "/tmp/empty",
        rules: {},
      },
    });

    scanIngestFilesMock.mockResolvedValue([]);

    await expect(executeIngest({} as any)).rejects.toMatchObject({
      name: "IngestError",
      message: "items_empty",
      code: "EXECUTE_EMPTY",
      statusCode: 400,
    });
  });

  it("executeIngest throws INPUT_INVALID when parsed object_key trims to empty", async () => {
    const { executeIngest } = await import("../../../../src/ingest/execute.js");

    parseIngestExecuteRequestV1Mock.mockReturnValue({
      identity: {
        object_key: "   ",
        object_kind: "dataset",
      },
      mode: "hash_only",
      material: {
        kind: "json",
        value: { a: 1 },
      },
    });

    await expect(executeIngest({} as any)).rejects.toMatchObject({
      name: "IngestError",
      message: "object_key_required",
      code: "INPUT_INVALID",
      statusCode: 400,
    });
  });
});