// ============================================================================
// File: tests/units/datasets/fileHash.test.ts
// Version: 1.0.0-hf-datasets-file-hash-unit | 2026-03-07
// Purpose:
//   Unit tests for src/datasets/fileHash.ts
// Notes:
//   - Covers streamed file hashing, redacted/non-redacted leaf payloads,
//     progress callbacks, error wrapping, and stable output shape.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const createReadStreamMock = vi.fn();
vi.mock("node:fs", () => ({
  default: {
    createReadStream: createReadStreamMock,
  },
}));

const hashUpdateMock = vi.fn();
const hashDigestMock = vi.fn();
const createHashMock = vi.fn();

vi.mock("node:crypto", () => ({
  default: {
    createHash: createHashMock,
  },
}));

const hashJsonMock = vi.fn();
const hashRawMock = vi.fn();

vi.mock("../../../../src/hashing/contract.js", () => ({
  hashJson: hashJsonMock,
  hashRaw: hashRawMock,
}));

describe("datasets/fileHash (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    hashDigestMock.mockReturnValue(Buffer.from("ab".repeat(64), "hex"));
    createHashMock.mockReturnValue({
      update: hashUpdateMock,
      digest: hashDigestMock,
    });

    hashJsonMock.mockImplementation(({ domain, value }) => ({
      digest: `hashjson:${domain}:${JSON.stringify(value)}`,
    }));

    hashRawMock.mockImplementation(({ domain, bytes }) => ({
      digest: `hashraw:${domain}:${Buffer.from(bytes).toString("utf8")}`,
    }));
  });

  it("hashFiles hashes each file, emits progress, and preserves path_rel when redact_paths=false", async () => {
    const { hashFiles } = await import("../../../../src/datasets/fileHash.js");

    const streamA = {
      on(event: string, cb: (...args: any[]) => void) {
        if (event === "data") {
          cb(Buffer.from("abc"));
        }
        if (event === "end") {
          cb();
        }
        return this;
      },
    };

    const streamB = {
      on(event: string, cb: (...args: any[]) => void) {
        if (event === "data") {
          cb(Buffer.from("def"));
        }
        if (event === "end") {
          cb();
        }
        return this;
      },
    };

    createReadStreamMock
      .mockReturnValueOnce(streamA as any)
      .mockReturnValueOnce(streamB as any);

    const progress = vi.fn();

    const out = await hashFiles(
      [
        {
          path_rel: "a.tsv",
          abs_path: "/tmp/a.tsv",
          bytes: 10,
        },
        {
          path_rel: "nested/b.tsv",
          abs_path: "/tmp/nested/b.tsv",
          bytes: 20,
        },
      ] as any,
      {
        redact_paths: false,
      } as any,
      progress,
    );

    const sha = "ab".repeat(64);

    expect(createHashMock).toHaveBeenCalledTimes(2);
    expect(createReadStreamMock).toHaveBeenNthCalledWith(1, "/tmp/a.tsv", {
      highWaterMark: 1_048_576,
    });
    expect(createReadStreamMock).toHaveBeenNthCalledWith(2, "/tmp/nested/b.tsv", {
      highWaterMark: 1_048_576,
    });

    expect(hashJsonMock).toHaveBeenNthCalledWith(1, {
      domain: "va:dataset:leaf:v1",
      value: {
        bytes: 10,
        sha3_512: sha,
        path_rel: "a.tsv",
      },
      alg: "sha3-512",
      encoding: "hex_lower",
    });

    expect(hashJsonMock).toHaveBeenNthCalledWith(2, {
      domain: "va:dataset:leaf:v1",
      value: {
        bytes: 20,
        sha3_512: sha,
        path_rel: "nested/b.tsv",
      },
      alg: "sha3-512",
      encoding: "hex_lower",
    });

    expect(out).toEqual([
      Object.freeze({
        path_rel: "a.tsv",
        bytes: 10,
        sha3_512: sha,
        leaf_hash: `hashjson:va:dataset:leaf:v1:${JSON.stringify({
          bytes: 10,
          sha3_512: sha,
          path_rel: "a.tsv",
        })}`,
      }),
      Object.freeze({
        path_rel: "nested/b.tsv",
        bytes: 20,
        sha3_512: sha,
        leaf_hash: `hashjson:va:dataset:leaf:v1:${JSON.stringify({
          bytes: 20,
          sha3_512: sha,
          path_rel: "nested/b.tsv",
        })}`,
      }),
    ]);

    expect(progress).toHaveBeenNthCalledWith(1, {
      event: "file_start",
      path_rel: "a.tsv",
      index: 1,
      total: 2,
    });

    expect(progress).toHaveBeenNthCalledWith(2, {
      event: "file_done",
      path_rel: "a.tsv",
      index: 1,
      total: 2,
      bytes: 10,
      sha3_512_prefix: sha.slice(0, 16),
    });

    expect(progress).toHaveBeenNthCalledWith(3, {
      event: "file_start",
      path_rel: "nested/b.tsv",
      index: 2,
      total: 2,
    });

    expect(progress).toHaveBeenNthCalledWith(4, {
      event: "file_done",
      path_rel: "nested/b.tsv",
      index: 2,
      total: 2,
      bytes: 20,
      sha3_512_prefix: sha.slice(0, 16),
    });

    expect(Object.isFrozen(out)).toBe(true);
  });

  it("hashFiles hashes path_hash instead of path_rel when redact_paths=true", async () => {
    const { hashFiles } = await import("../../../../src/datasets/fileHash.js");

    const stream = {
      on(event: string, cb: (...args: any[]) => void) {
        if (event === "data") {
          cb(Buffer.from("abc"));
        }
        if (event === "end") {
          cb();
        }
        return this;
      },
    };

    createReadStreamMock.mockReturnValue(stream as any);

    const out = await hashFiles(
      [
        {
          path_rel: "secret/path.tsv",
          abs_path: "/tmp/secret/path.tsv",
          bytes: 11,
        },
      ] as any,
      {
        redact_paths: true,
      } as any,
    );

    const sha = "ab".repeat(64);
    const pathHash = "hashraw:va:dataset:path:v1:secret/path.tsv";

    expect(hashRawMock).toHaveBeenCalledWith({
      domain: "va:dataset:path:v1",
      bytes: Buffer.from("secret/path.tsv", "utf8"),
      alg: "sha3-512",
      encoding: "hex_lower",
    });

    expect(hashJsonMock).toHaveBeenCalledWith({
      domain: "va:dataset:leaf:v1",
      value: {
        bytes: 11,
        sha3_512: sha,
        path_hash: pathHash,
      },
      alg: "sha3-512",
      encoding: "hex_lower",
    });

    expect(out).toEqual([
      Object.freeze({
        path_hash: pathHash,
        bytes: 11,
        sha3_512: sha,
        leaf_hash: `hashjson:va:dataset:leaf:v1:${JSON.stringify({
          bytes: 11,
          sha3_512: sha,
          path_hash: pathHash,
        })}`,
      }),
    ]);
  });

  it("hashFiles wraps stream/hash failures as HASH_FAILED", async () => {
    const { hashFiles } = await import("../../../../src/datasets/fileHash.js");

    const boom = new Error("stream broke");
    const brokenStream = {
      on(event: string, cb: (...args: any[]) => void) {
        if (event === "error") {
          cb(boom);
        }
        return this;
      },
    };

    createReadStreamMock.mockReturnValue(brokenStream as any);

    await expect(
      hashFiles(
        [
          {
            path_rel: "bad.tsv",
            abs_path: "/tmp/bad.tsv",
            bytes: 1,
          },
        ] as any,
        undefined,
      ),
    ).rejects.toMatchObject({
      name: "DatasetError",
      message: "file_hash_failed",
      code: "HASH_FAILED",
      statusCode: 500,
    });
  });

  it("hashFiles returns an empty frozen array for empty input", async () => {
    const { hashFiles } = await import("../../../../src/datasets/fileHash.js");

    const out = await hashFiles([]);

    expect(out).toEqual([]);
    expect(Object.isFrozen(out)).toBe(true);
    expect(createReadStreamMock).not.toHaveBeenCalled();
    expect(hashJsonMock).not.toHaveBeenCalled();
  });
});