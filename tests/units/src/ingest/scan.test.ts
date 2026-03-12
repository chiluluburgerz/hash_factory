// ============================================================================
// File: tests/units/ingest/scan.test.ts
// Version: 1.0.0-hf-ingest-scan-unit | 2026-03-07
// Purpose:
//   Unit tests for src/ingest/scan.ts
// Notes:
//   - Uses mocked fs + picomatch + pathNorm boundaries.
//   - Verifies deterministic discovery, filtering, symlink policy, limits,
//     and progress signaling.
// ============================================================================

import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

const lstatMock = vi.fn();
const statMock = vi.fn();
const readdirMock = vi.fn();
const realpathMock = vi.fn();

vi.mock("node:fs", () => ({
  default: {
    promises: {
      lstat: lstatMock,
      stat: statMock,
      readdir: readdirMock,
      realpath: realpathMock,
    },
  },
}));

const picomatchMock = vi.fn();
vi.mock("picomatch", () => ({
  default: picomatchMock,
}));

const normalizeRelPathMock = vi.fn((p: string) => String(p).replace(/\\/g, "/"));
vi.mock("../../../../src/ingest/pathNorm.js", () => ({
  normalizeRelPath: normalizeRelPathMock,
}));

const ROOT = path.resolve("/root");

function rootPath(...parts: string[]): string {
  return path.join(ROOT, ...parts);
}

function makeDirent(name: string, kind: "file" | "dir" | "other" = "file") {
  return {
    name,
    isFile: () => kind === "file",
    isDirectory: () => kind === "dir",
    isSymbolicLink: () => false,
  };
}

function makeStats(opts: {
  isDirectory?: boolean;
  isFile?: boolean;
  isSymbolicLink?: boolean;
  size?: number;
}) {
  return {
    isDirectory: () => Boolean(opts.isDirectory),
    isFile: () => Boolean(opts.isFile),
    isSymbolicLink: () => Boolean(opts.isSymbolicLink),
    size: opts.size ?? 0,
  };
}

describe("ingest/scan (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    picomatchMock.mockImplementation((patterns: string[]) => {
      return (candidate: string) => patterns.includes(candidate);
    });
  });

  it("rejects missing root directory", async () => {
    const { scanIngestFiles } = await import("../../../../src/ingest/scan.js");

    lstatMock.mockRejectedValue(new Error("ENOENT"));

    await expect(scanIngestFiles("", {} as any)).rejects.toMatchObject({
      name: "IngestError",
      message: "root_dir_not_found",
      code: "ROOT_INVALID",
      statusCode: 400,
    });
  });

  it("rejects root when it is not a directory", async () => {
    const { scanIngestFiles } = await import("../../../../src/ingest/scan.js");

    lstatMock.mockResolvedValue(makeStats({ isFile: true }));

    await expect(
      scanIngestFiles(path.resolve("/tmp/file.txt"), {} as any),
    ).rejects.toMatchObject({
      message: "root_dir_not_directory",
      code: "ROOT_INVALID",
      statusCode: 400,
    });
  });

  it("scans files deterministically and sorts final output by normalized relative path", async () => {
    const { scanIngestFiles } = await import("../../../../src/ingest/scan.js");

    lstatMock.mockImplementation(async (p: string) => {
      if (p === ROOT) return makeStats({ isDirectory: true });
      if (p === rootPath("b.tsv")) return makeStats({ isFile: true, size: 20 });
      if (p === rootPath("a.tsv")) return makeStats({ isFile: true, size: 10 });
      throw new Error(`unexpected lstat ${p}`);
    });

    realpathMock.mockImplementation(async (p: string) => p);

    readdirMock.mockResolvedValue([
      makeDirent("b.tsv", "file"),
      makeDirent("a.tsv", "file"),
    ]);

    const progress = vi.fn();
    const out = await scanIngestFiles(ROOT, undefined, progress);

    expect(readdirMock).toHaveBeenCalledWith(ROOT, { withFileTypes: true });
    expect(out).toEqual([
      Object.freeze({ path_rel: "a.tsv", abs_path: rootPath("a.tsv"), bytes: 10 }),
      Object.freeze({ path_rel: "b.tsv", abs_path: rootPath("b.tsv"), bytes: 20 }),
    ]);
    expect(Object.isFrozen(out)).toBe(true);

    expect(progress).toHaveBeenNthCalledWith(1, {
      event: "dir",
      rel: ".",
      files_seen: 0,
      total_bytes_seen: 0,
    });

    expect(progress).toHaveBeenCalledWith({
      event: "file",
      rel: "a.tsv",
      files_seen: 1,
      total_bytes_seen: 10,
    });

    expect(progress).toHaveBeenCalledWith({
      event: "file",
      rel: "b.tsv",
      files_seen: 2,
      total_bytes_seen: 30,
    });
  });

  it("rejects invalid allowed_suffixes shape", async () => {
    const { scanIngestFiles } = await import("../../../../src/ingest/scan.js");

    lstatMock.mockResolvedValue(makeStats({ isDirectory: true }));
    realpathMock.mockResolvedValue(ROOT);

    await expect(
      scanIngestFiles(ROOT, { allowed_suffixes: ".tsv" as any }),
    ).rejects.toMatchObject({
      message: "allowed_suffixes_invalid",
      code: "RULES_INVALID",
      statusCode: 400,
    });
  });

  it("rejects allowed suffixes that do not start with dot", async () => {
    const { scanIngestFiles } = await import("../../../../src/ingest/scan.js");

    lstatMock.mockResolvedValue(makeStats({ isDirectory: true }));
    realpathMock.mockResolvedValue(ROOT);

    await expect(
      scanIngestFiles(ROOT, { allowed_suffixes: ["tsv"] as any }),
    ).rejects.toMatchObject({
      message: "allowed_suffixes_must_start_dot",
      code: "RULES_INVALID",
      statusCode: 400,
    });
  });

  it("filters files by allowed suffixes", async () => {
    const { scanIngestFiles } = await import("../../../../src/ingest/scan.js");

    lstatMock.mockImplementation(async (p: string) => {
      if (p === ROOT) return makeStats({ isDirectory: true });
      if (p === rootPath("a.tsv")) return makeStats({ isFile: true, size: 10 });
      if (p === rootPath("b.png")) return makeStats({ isFile: true, size: 20 });
      throw new Error(`unexpected lstat ${p}`);
    });

    realpathMock.mockImplementation(async (p: string) => p);

    readdirMock.mockResolvedValue([
      makeDirent("a.tsv", "file"),
      makeDirent("b.png", "file"),
    ]);

    const progress = vi.fn();
    const out = await scanIngestFiles(ROOT, { allowed_suffixes: [".tsv"] } as any, progress);

    expect(out).toEqual([
      Object.freeze({ path_rel: "a.tsv", abs_path: rootPath("a.tsv"), bytes: 10 }),
    ]);

    expect(progress).toHaveBeenCalledWith({
      event: "skip",
      rel: "b.png",
      reason: "suffix_not_allowed",
    });
  });

  it("filters files through include/exclude glob matcher", async () => {
    const { scanIngestFiles } = await import("../../../../src/ingest/scan.js");

    picomatchMock
        .mockReturnValueOnce(
        (candidate: string) =>
            candidate === "keep" ||
            candidate === "drop" ||
            candidate === "keep/a.tsv" ||
            candidate === "drop/b.tsv",
        )
        .mockReturnValueOnce((candidate: string) => candidate === "drop/b.tsv");

    lstatMock.mockImplementation(async (p: string) => {
        if (p === ROOT) return makeStats({ isDirectory: true });
        if (p === rootPath("keep")) return makeStats({ isDirectory: true });
        if (p === rootPath("drop")) return makeStats({ isDirectory: true });
        if (p === rootPath("keep", "a.tsv")) return makeStats({ isFile: true, size: 10 });
        if (p === rootPath("drop", "b.tsv")) return makeStats({ isFile: true, size: 20 });
        throw new Error(`unexpected lstat ${p}`);
    });

    realpathMock.mockImplementation(async (p: string) => p);

    readdirMock.mockImplementation(async (p: string) => {
        if (p === ROOT) {
        return [makeDirent("keep", "dir"), makeDirent("drop", "dir")];
        }
        if (p === rootPath("keep")) {
        return [makeDirent("a.tsv", "file")];
        }
        if (p === rootPath("drop")) {
        return [makeDirent("b.tsv", "file")];
        }
        throw new Error(`unexpected readdir ${p}`);
    });

    const progress = vi.fn();
    const out = await scanIngestFiles(
        ROOT,
        {
        include_globs: ["keep/a.tsv", "drop/b.tsv"],
        exclude_globs: ["drop/b.tsv"],
        } as any,
        progress,
    );

    expect(out).toEqual([
        Object.freeze({ path_rel: "keep/a.tsv", abs_path: rootPath("keep", "a.tsv"), bytes: 10 }),
    ]);

    expect(progress).toHaveBeenCalledWith({
        event: "skip",
        rel: "drop/b.tsv",
        reason: "glob_filtered",
    });
  });

  it("skips non-regular filesystem entries", async () => {
    const { scanIngestFiles } = await import("../../../../src/ingest/scan.js");

    lstatMock.mockImplementation(async (p: string) => {
      if (p === ROOT) return makeStats({ isDirectory: true });
      if (p === rootPath("a.tsv")) return makeStats({ isFile: true, size: 10 });
      if (p === rootPath("socket")) return makeStats({ isFile: false, isDirectory: false, isSymbolicLink: false });
      throw new Error(`unexpected lstat ${p}`);
    });

    realpathMock.mockImplementation(async (p: string) => p);
    readdirMock.mockResolvedValue([makeDirent("a.tsv", "file"), makeDirent("socket", "file")]);

    const progress = vi.fn();
    const out = await scanIngestFiles(ROOT, undefined, progress);

    expect(out).toEqual([
      Object.freeze({ path_rel: "a.tsv", abs_path: rootPath("a.tsv"), bytes: 10 }),
    ]);

    expect(progress).toHaveBeenCalledWith({
      event: "skip",
      rel: "socket",
      reason: "not_regular_file",
    });
  });

  it("skips symlinks by default", async () => {
    const { scanIngestFiles } = await import("../../../../src/ingest/scan.js");

    lstatMock.mockImplementation(async (p: string) => {
      if (p === ROOT) return makeStats({ isDirectory: true });
      if (p === rootPath("link.tsv")) return makeStats({ isSymbolicLink: true });
      if (p === rootPath("a.tsv")) return makeStats({ isFile: true, size: 10 });
      throw new Error(`unexpected lstat ${p}`);
    });

    realpathMock.mockImplementation(async (p: string) => p);
    readdirMock.mockResolvedValue([makeDirent("link.tsv", "file"), makeDirent("a.tsv", "file")]);

    const progress = vi.fn();
    const out = await scanIngestFiles(ROOT, undefined, progress);

    expect(out).toEqual([
      Object.freeze({ path_rel: "a.tsv", abs_path: rootPath("a.tsv"), bytes: 10 }),
    ]);

    expect(progress).toHaveBeenCalledWith({
      event: "skip",
      rel: "link.tsv",
      reason: "symlink_forbidden",
    });
  });

  it("follows in-root symlinked files when enabled", async () => {
    const { scanIngestFiles } = await import("../../../../src/ingest/scan.js");

    lstatMock.mockImplementation(async (p: string) => {
      if (p === ROOT) return makeStats({ isDirectory: true });
      if (p === rootPath("link.tsv")) return makeStats({ isSymbolicLink: true });
      throw new Error(`unexpected lstat ${p}`);
    });

    realpathMock.mockImplementation(async (p: string) => {
      if (p === ROOT) return ROOT;
      if (p === rootPath("link.tsv")) return rootPath("real.tsv");
      return p;
    });

    statMock.mockImplementation(async (p: string) => {
      if (p === rootPath("link.tsv")) return makeStats({ isFile: true, size: 22 });
      throw new Error(`unexpected stat ${p}`);
    });

    readdirMock.mockResolvedValue([makeDirent("link.tsv", "file")]);

    const out = await scanIngestFiles(ROOT, { follow_symlinks: true } as any);

    expect(out).toEqual([
      Object.freeze({ path_rel: "link.tsv", abs_path: rootPath("link.tsv"), bytes: 22 }),
    ]);
  });

  it("rejects symlinks that escape the root", async () => {
    const { scanIngestFiles } = await import("../../../../src/ingest/scan.js");

    lstatMock.mockImplementation(async (p: string) => {
      if (p === ROOT) return makeStats({ isDirectory: true });
      if (p === rootPath("escape.tsv")) return makeStats({ isSymbolicLink: true });
      throw new Error(`unexpected lstat ${p}`);
    });

    realpathMock.mockImplementation(async (p: string) => {
      if (p === ROOT) return ROOT;
      if (p === rootPath("escape.tsv")) return path.resolve("/outside/escape.tsv");
      return p;
    });

    readdirMock.mockResolvedValue([makeDirent("escape.tsv", "file")]);

    await expect(
      scanIngestFiles(ROOT, { follow_symlinks: true } as any),
    ).rejects.toMatchObject({
      message: "symlink_escapes_root",
      code: "SYMLINK_ESCAPE",
      statusCode: 400,
    });
  });

  it("enforces max_single_file_bytes", async () => {
    const { scanIngestFiles } = await import("../../../../src/ingest/scan.js");

    lstatMock.mockImplementation(async (p: string) => {
      if (p === ROOT) return makeStats({ isDirectory: true });
      if (p === rootPath("big.tsv")) return makeStats({ isFile: true, size: 101 });
      throw new Error(`unexpected lstat ${p}`);
    });

    realpathMock.mockImplementation(async (p: string) => p);
    readdirMock.mockResolvedValue([makeDirent("big.tsv", "file")]);

    await expect(
      scanIngestFiles(ROOT, { max_single_file_bytes: 100 } as any),
    ).rejects.toMatchObject({
      message: "single_file_too_large",
      code: "SCAN_LIMIT",
      statusCode: 400,
    });
  });

  it("enforces max_total_bytes", async () => {
    const { scanIngestFiles } = await import("../../../../src/ingest/scan.js");

    lstatMock.mockImplementation(async (p: string) => {
      if (p === ROOT) return makeStats({ isDirectory: true });
      if (p === rootPath("a.tsv")) return makeStats({ isFile: true, size: 60 });
      if (p === rootPath("b.tsv")) return makeStats({ isFile: true, size: 50 });
      throw new Error(`unexpected lstat ${p}`);
    });

    realpathMock.mockImplementation(async (p: string) => p);
    readdirMock.mockResolvedValue([makeDirent("a.tsv", "file"), makeDirent("b.tsv", "file")]);

    await expect(
      scanIngestFiles(ROOT, { max_total_bytes: 100 } as any),
    ).rejects.toMatchObject({
      message: "total_bytes_exceeded",
      code: "SCAN_LIMIT",
      statusCode: 400,
    });
  });

  it("enforces max_files", async () => {
    const { scanIngestFiles } = await import("../../../../src/ingest/scan.js");

    lstatMock.mockImplementation(async (p: string) => {
      if (p === ROOT) return makeStats({ isDirectory: true });
      if (p === rootPath("a.tsv")) return makeStats({ isFile: true, size: 10 });
      if (p === rootPath("b.tsv")) return makeStats({ isFile: true, size: 10 });
      throw new Error(`unexpected lstat ${p}`);
    });

    realpathMock.mockImplementation(async (p: string) => p);
    readdirMock.mockResolvedValue([makeDirent("a.tsv", "file"), makeDirent("b.tsv", "file")]);

    await expect(
      scanIngestFiles(ROOT, { max_files: 1 } as any),
    ).rejects.toMatchObject({
      message: "max_files_exceeded",
      code: "SCAN_LIMIT",
      statusCode: 400,
    });
  });

  it("throws SCAN_EMPTY when no files survive filtering", async () => {
    const { scanIngestFiles } = await import("../../../../src/ingest/scan.js");

    lstatMock.mockResolvedValue(makeStats({ isDirectory: true }));
    realpathMock.mockResolvedValue(ROOT);
    readdirMock.mockResolvedValue([]);

    await expect(scanIngestFiles(ROOT, undefined)).rejects.toMatchObject({
      message: "no_files_found",
      code: "SCAN_EMPTY",
      statusCode: 400,
    });
  });
});