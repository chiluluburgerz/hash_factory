// ============================================================================
// File: tests/units/ingest/fileHash.test.ts
// Version: 1.0.0-hf-ingest-file-hash-unit | 2026-03-07
// Purpose:
//   Unit tests for src/ingest/fileHash.ts
// Notes:
//   - Covers media inference/classification, raw hashing, normalized text hashing,
//     expected-bytes mutation protection, and path-hash derivation.
//   - Mocks fs/crypto/hashFactory/pathNorm boundaries.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const statMock = vi.fn();
const readFileMock = vi.fn();
const createReadStreamMock = vi.fn();

vi.mock("node:fs", () => ({
  default: {
    promises: {
      stat: statMock,
      readFile: readFileMock,
    },
    createReadStream: createReadStreamMock,
  },
}));

const createHashUpdateMock = vi.fn();
const createHashDigestMock = vi.fn();
const createHashMock = vi.fn();

vi.mock("node:crypto", () => ({
  default: {
    createHash: createHashMock,
  },
}));

const hashJsonMock = vi.fn();
const hashUtf8Mock = vi.fn();

vi.mock("../../../../src/hashing/hashFactory.js", () => ({
  hashJson: hashJsonMock,
  hashUtf8: hashUtf8Mock,
}));

const normalizeRelPathMock = vi.fn((p: string) => String(p).replace(/\\/g, "/").trim());

vi.mock("../../../../src/ingest/pathNorm.js", () => ({
  normalizeRelPath: normalizeRelPathMock,
}));

describe("ingest/fileHash (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createHashUpdateMock.mockReset();
    createHashDigestMock.mockReset();

    createHashDigestMock.mockReturnValue("ABCDEF123456");
    createHashMock.mockReturnValue({
      update: createHashUpdateMock,
      digest: createHashDigestMock,
    });

    hashJsonMock.mockImplementation(({ domain, value }) => ({
      digest: `hashjson:${domain}:${JSON.stringify(value)}`,
    }));

    hashUtf8Mock.mockImplementation(({ domain, text }) => ({
      digest: `hashutf8:${domain}:${text}`,
    }));
  });

  it("inferMediaTypeFromPath returns image media types by suffix", async () => {
    const { inferMediaTypeFromPath } = await import("../../../../src/ingest/fileHash.js");

    expect(inferMediaTypeFromPath("image.PNG")).toBe("image/png");
    expect(inferMediaTypeFromPath("photo.jpg")).toBe("image/jpeg");
    expect(inferMediaTypeFromPath("vector.SVG")).toBe("image/svg+xml");
    expect(inferMediaTypeFromPath("slide.tiff")).toBe("image/tiff");
  });

  it("inferMediaTypeFromPath returns text/application media types by suffix", async () => {
    const { inferMediaTypeFromPath } = await import("../../../../src/ingest/fileHash.js");

    expect(inferMediaTypeFromPath("notes.txt")).toBe("text/plain");
    expect(inferMediaTypeFromPath("table.csv")).toBe("text/csv");
    expect(inferMediaTypeFromPath("matrix.tsv")).toBe("text/tab-separated-values");
    expect(inferMediaTypeFromPath("data.json")).toBe("application/json");
    expect(inferMediaTypeFromPath("stream.ndjson")).toBe("application/x-ndjson");
    expect(inferMediaTypeFromPath("doc.yaml")).toBe("application/yaml");
    expect(inferMediaTypeFromPath("page.html")).toBe("text/html");
  });

  it("inferMediaTypeFromPath returns null for unknown suffixes", async () => {
    const { inferMediaTypeFromPath } = await import("../../../../src/ingest/fileHash.js");

    expect(inferMediaTypeFromPath("blob.bin")).toBeNull();
    expect(inferMediaTypeFromPath("noext")).toBeNull();
  });

  it("classifyFileKind returns image/text/binary conservatively by suffix", async () => {
    const { classifyFileKind } = await import("../../../../src/ingest/fileHash.js");

    expect(classifyFileKind("plot.png")).toBe("image");
    expect(classifyFileKind("reads.fasta")).toBe("text");
    expect(classifyFileKind("reads.faa")).toBe("text");
    expect(classifyFileKind("payload.JSON")).toBe("text");
    expect(classifyFileKind("archive.bin")).toBe("binary");
    expect(classifyFileKind("README")).toBe("binary");
  });

  it("buildPathHash normalizes the relative path and hashes it under the path domain", async () => {
    const { buildPathHash } = await import("../../../../src/ingest/fileHash.js");

    const out = buildPathHash("subdir\\file.tsv");

    expect(normalizeRelPathMock).toHaveBeenCalledWith("subdir\\file.tsv");
    expect(hashJsonMock).toHaveBeenCalledWith({
      domain: "va:ingest:path:v1",
      value: { path_rel: "subdir/file.tsv" },
      alg: "sha3-512",
      encoding: "hex_lower",
    });
    expect(out).toBe('hashjson:va:ingest:path:v1:{"path_rel":"subdir/file.tsv"}');
  });

  it("hashScannedFile hashes binary/image files as raw bytes and lowercases digest", async () => {
    const { hashScannedFile } = await import("../../../../src/ingest/fileHash.js");

    statMock.mockResolvedValue({
      isFile: () => true,
      size: 9,
    });

    const stream = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from("abc");
        yield Buffer.from("def");
      },
      destroy: vi.fn(),
    };
    createReadStreamMock.mockReturnValue(stream);

    const out = await hashScannedFile(
      {
        path_rel: "images\\plot.PNG",
        abs_path: "/tmp/images/plot.PNG",
        bytes: 9,
      } as any,
      {
        normalize_line_endings: true,
      },
    );

    expect(normalizeRelPathMock).toHaveBeenCalledWith("images\\plot.PNG");
    expect(statMock).toHaveBeenCalledWith("/tmp/images/plot.PNG");
    expect(createReadStreamMock).toHaveBeenCalledWith("/tmp/images/plot.PNG", {
      highWaterMark: 1_048_576,
    });
    expect(createHashMock).toHaveBeenCalledWith("sha3-512");
    expect(createHashUpdateMock).toHaveBeenCalledTimes(2);
    expect(createHashDigestMock).toHaveBeenCalledWith("hex");

    expect(hashUtf8Mock).not.toHaveBeenCalled();

    expect(out).toEqual({
      path_rel: "images/plot.PNG",
      abs_path: "/tmp/images/plot.PNG",
      bytes: 9,
      media_type: "image/png",
      media_kind: "image",
      sha3_512: "abcdef123456",
    });
    expect(Object.isFrozen(out)).toBe(true);
  });

  it("hashScannedFile hashes text files with normalized line endings when enabled", async () => {
    const { hashScannedFile } = await import("../../../../src/ingest/fileHash.js");

    statMock.mockResolvedValue({
      isFile: () => true,
      size: 14,
    });

    readFileMock.mockResolvedValue("a\r\nb\rc\n");

    const out = await hashScannedFile(
      {
        path_rel: "docs\\notes.txt",
        abs_path: "/tmp/docs/notes.txt",
        bytes: 14,
      } as any,
      {
        normalize_line_endings: true,
      },
    );

    expect(statMock).toHaveBeenCalledWith("/tmp/docs/notes.txt");
    expect(readFileMock).toHaveBeenCalledWith("/tmp/docs/notes.txt", "utf8");
    expect(hashUtf8Mock).toHaveBeenCalledWith({
      domain: "va:ingest:file-text:v1",
      text: "a\nb\nc\n",
      alg: "sha3-512",
      encoding: "hex_lower",
    });
    expect(createReadStreamMock).not.toHaveBeenCalled();

    expect(out).toEqual({
      path_rel: "docs/notes.txt",
      abs_path: "/tmp/docs/notes.txt",
      bytes: 14,
      media_type: "text/plain",
      media_kind: "text",
      sha3_512: "hashutf8:va:ingest:file-text:v1:a\nb\nc\n",
    });
  });

  it("hashScannedFile hashes text files as raw bytes when line normalization is disabled", async () => {
    const { hashScannedFile } = await import("../../../../src/ingest/fileHash.js");

    statMock.mockResolvedValue({
      isFile: () => true,
      size: 4,
    });

    const stream = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from("x\r\n");
      },
      destroy: vi.fn(),
    };
    createReadStreamMock.mockReturnValue(stream);

    const out = await hashScannedFile(
      {
        path_rel: "table.csv",
        abs_path: "/tmp/table.csv",
        bytes: 4,
      } as any,
      {
        normalize_line_endings: false,
      },
    );

    expect(readFileMock).not.toHaveBeenCalled();
    expect(createReadStreamMock).toHaveBeenCalledTimes(1);
    expect(out.media_kind).toBe("text");
    expect(out.media_type).toBe("text/csv");
    expect(out.sha3_512).toBe("abcdef123456");
  });

  it("hashScannedFile throws FILE_MUTATED when actual bytes differ from scanned bytes", async () => {
    const { hashScannedFile } = await import("../../../../src/ingest/fileHash.js");

    statMock.mockResolvedValue({
      isFile: () => true,
      size: 999,
    });

    await expect(
      hashScannedFile(
        {
          path_rel: "data.tsv",
          abs_path: "/tmp/data.tsv",
          bytes: 123,
        } as any,
        {
          normalize_line_endings: false,
        },
      ),
    ).rejects.toMatchObject({
      name: "IngestError",
      message: "file_changed_since_scan",
      code: "FILE_MUTATED",
      statusCode: 409,
    });
  });

  it("hashScannedFile throws FILE_READ_FAILED when scanned bytes is invalid", async () => {
    const { hashScannedFile } = await import("../../../../src/ingest/fileHash.js");

    statMock.mockResolvedValue({
      isFile: () => true,
      size: 10,
    });

    await expect(
      hashScannedFile(
        {
          path_rel: "data.tsv",
          abs_path: "/tmp/data.tsv",
          bytes: -1,
        } as any,
        {
          normalize_line_endings: false,
        },
      ),
    ).rejects.toMatchObject({
      name: "IngestError",
      message: "file_expected_bytes_invalid",
      code: "FILE_READ_FAILED",
      statusCode: 400,
    });
  });

  it("hashScannedFile throws FILE_READ_FAILED when stat fails before raw hashing", async () => {
    const { hashScannedFile } = await import("../../../../src/ingest/fileHash.js");

    const cause = new Error("ENOENT");
    statMock.mockRejectedValue(cause);

    await expect(
      hashScannedFile(
        {
          path_rel: "missing.bin",
          abs_path: "/tmp/missing.bin",
          bytes: 1,
        } as any,
        {
          normalize_line_endings: false,
        },
      ),
    ).rejects.toMatchObject({
      name: "IngestError",
      message: "file_stat_failed",
      code: "FILE_READ_FAILED",
      statusCode: 500,
    });
  });

  it("hashScannedFile throws FILE_READ_FAILED when path is not a regular file", async () => {
    const { hashScannedFile } = await import("../../../../src/ingest/fileHash.js");

    statMock.mockResolvedValue({
      isFile: () => false,
      size: 1,
    });

    await expect(
      hashScannedFile(
        {
          path_rel: "dir/file.bin",
          abs_path: "/tmp/dir/file.bin",
          bytes: 1,
        } as any,
        {
          normalize_line_endings: false,
        },
      ),
    ).rejects.toMatchObject({
      name: "IngestError",
      message: "not_regular_file",
      code: "FILE_READ_FAILED",
      statusCode: 400,
    });
  });

  it("hashScannedFile destroys the stream and throws FILE_READ_FAILED when raw read fails", async () => {
    const { hashScannedFile } = await import("../../../../src/ingest/fileHash.js");

    statMock.mockResolvedValue({
      isFile: () => true,
      size: 4,
    });

    const destroy = vi.fn();
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from("ab");
        throw new Error("stream broke");
      },
      destroy,
    };
    createReadStreamMock.mockReturnValue(stream);

    await expect(
      hashScannedFile(
        {
          path_rel: "broken.bin",
          abs_path: "/tmp/broken.bin",
          bytes: 4,
        } as any,
        {
          normalize_line_endings: false,
        },
      ),
    ).rejects.toMatchObject({
      name: "IngestError",
      message: "file_read_failed",
      code: "FILE_READ_FAILED",
      statusCode: 500,
    });

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("hashScannedFile throws FILE_READ_FAILED when normalized text read fails", async () => {
    const { hashScannedFile } = await import("../../../../src/ingest/fileHash.js");

    statMock.mockResolvedValue({
      isFile: () => true,
      size: 6,
    });

    const cause = new Error("EACCES");
    readFileMock.mockRejectedValue(cause);

    await expect(
      hashScannedFile(
        {
          path_rel: "secret.txt",
          abs_path: "/tmp/secret.txt",
          bytes: 6,
        } as any,
        {
          normalize_line_endings: true,
        },
      ),
    ).rejects.toMatchObject({
      name: "IngestError",
      message: "text_file_read_failed",
      code: "FILE_READ_FAILED",
      statusCode: 500,
    });
  });

  it("hashScannedFile throws TEXT_TOO_LARGE when normalized text exceeds budget", async () => {
    const { hashScannedFile } = await import("../../../../src/ingest/fileHash.js");

    statMock.mockResolvedValue({
      isFile: () => true,
      size: 6_000_000,
    });

    readFileMock.mockResolvedValue("x".repeat(5_000_001));

    await expect(
      hashScannedFile(
        {
          path_rel: "huge.txt",
          abs_path: "/tmp/huge.txt",
          bytes: 6_000_000,
        } as any,
        {
          normalize_line_endings: true,
        },
      ),
    ).rejects.toMatchObject({
      name: "IngestError",
      message: "text_file_too_large_for_normalized_hash",
      code: "TEXT_TOO_LARGE",
      statusCode: 413,
    });
  });

  it("hashScannedFile does not normalize non-text files even when normalize_line_endings=true", async () => {
    const { hashScannedFile } = await import("../../../../src/ingest/fileHash.js");

    statMock.mockResolvedValue({
      isFile: () => true,
      size: 8,
    });

    const stream = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from([0, 1, 2, 3]);
      },
      destroy: vi.fn(),
    };
    createReadStreamMock.mockReturnValue(stream);

    const out = await hashScannedFile(
      {
        path_rel: "blob.bin",
        abs_path: "/tmp/blob.bin",
        bytes: 8,
      } as any,
      {
        normalize_line_endings: true,
      },
    );

    expect(readFileMock).not.toHaveBeenCalled();
    expect(createReadStreamMock).toHaveBeenCalledTimes(1);
    expect(out.media_kind).toBe("binary");
    expect(out.media_type).toBeNull();
  });
});