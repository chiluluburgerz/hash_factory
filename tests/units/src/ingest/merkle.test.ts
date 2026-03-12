// ============================================================================
// File: tests/units/ingest/merkle.test.ts
// Version: 1.0.0-hf-ingest-merkle-unit | 2026-03-07
// Purpose:
//   Unit tests for src/ingest/merkle.ts
// Notes:
//   - Pure deterministic tests with mocked hashRaw boundary.
//   - Verifies leaf validation, odd-node duplication, and root construction.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const hashRawMock = vi.fn();

vi.mock("../../../../src/hashing/contract.js", () => ({
  hashRaw: hashRawMock,
}));

function hexDigest(fill: string): string {
  return fill.repeat(128);
}

describe("ingest/merkle (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merkleRootFromItems requires at least one leaf", async () => {
    const { merkleRootFromItems } = await import("../../../../src/ingest/merkle.js");

    expect(() => merkleRootFromItems([])).toThrow(/merkle_no_leaves/i);

    try {
      merkleRootFromItems([]);
      expect.fail("expected merkleRootFromItems to throw");
    } catch (err: any) {
      expect(err.name).toBe("IngestError");
      expect(err.code).toBe("MERKLE_EMPTY");
      expect(err.statusCode).toBe(400);
    }
  });

  it("merkleRootFromItems rejects invalid leaf hashes", async () => {
    const { merkleRootFromItems } = await import("../../../../src/ingest/merkle.js");

    expect(() =>
      merkleRootFromItems([{ leaf_hash: "not-hex" } as any]),
    ).toThrow(/merkle_invalid_leaf_hash/i);

    expect(() =>
      merkleRootFromItems([{ leaf_hash: "A".repeat(128) } as any]),
    ).toThrow(/merkle_invalid_leaf_hash/i);

    expect(() =>
      merkleRootFromItems([{ leaf_hash: "a".repeat(127) } as any]),
    ).toThrow(/merkle_invalid_leaf_hash/i);
  });

  it("returns the single leaf as the merkle root when exactly one item is provided", async () => {
    const { merkleRootFromItems } = await import("../../../../src/ingest/merkle.js");

    const leaf = hexDigest("a");
    const out = merkleRootFromItems([{ leaf_hash: leaf } as any]);

    expect(hashRawMock).not.toHaveBeenCalled();
    expect(out).toEqual({
      leaf_count: 1,
      root: leaf,
    });
    expect(Object.isFrozen(out)).toBe(true);
  });

  it("hashes one node for two leaves using the ingest node domain", async () => {
    const { merkleRootFromItems } = await import("../../../../src/ingest/merkle.js");

    const left = hexDigest("1");
    const right = hexDigest("2");
    const node = hexDigest("b");

    hashRawMock.mockReturnValue({
      digest: node,
    });

    const out = merkleRootFromItems([
      { leaf_hash: left } as any,
      { leaf_hash: right } as any,
    ]);

    const expectedBytes = Buffer.concat([
      Buffer.from(left, "hex"),
      Buffer.from(right, "hex"),
    ]);

    expect(hashRawMock).toHaveBeenCalledTimes(1);
    expect(hashRawMock).toHaveBeenCalledWith({
      domain: "va:ingest:node:v1",
      bytes: expectedBytes,
      alg: "sha3-512",
      encoding: "hex_lower",
    });

    expect(out).toEqual({
      leaf_count: 2,
      root: node,
    });
  });

  it("duplicates the last leaf on odd node counts", async () => {
    const { merkleRootFromItems } = await import("../../../../src/ingest/merkle.js");

    const leaf1 = hexDigest("1");
    const leaf2 = hexDigest("2");
    const leaf3 = hexDigest("3");
    const node12 = hexDigest("a");
    const node33 = hexDigest("b");
    const root = hexDigest("c");

    hashRawMock
      .mockReturnValueOnce({ digest: node12 })
      .mockReturnValueOnce({ digest: node33 })
      .mockReturnValueOnce({ digest: root });

    const out = merkleRootFromItems([
      { leaf_hash: leaf1 } as any,
      { leaf_hash: leaf2 } as any,
      { leaf_hash: leaf3 } as any,
    ]);

    expect(hashRawMock).toHaveBeenCalledTimes(3);

    expect(hashRawMock).toHaveBeenNthCalledWith(1, {
      domain: "va:ingest:node:v1",
      bytes: Buffer.concat([Buffer.from(leaf1, "hex"), Buffer.from(leaf2, "hex")]),
      alg: "sha3-512",
      encoding: "hex_lower",
    });

    expect(hashRawMock).toHaveBeenNthCalledWith(2, {
      domain: "va:ingest:node:v1",
      bytes: Buffer.concat([Buffer.from(leaf3, "hex"), Buffer.from(leaf3, "hex")]),
      alg: "sha3-512",
      encoding: "hex_lower",
    });

    expect(hashRawMock).toHaveBeenNthCalledWith(3, {
      domain: "va:ingest:node:v1",
      bytes: Buffer.concat([Buffer.from(node12, "hex"), Buffer.from(node33, "hex")]),
      alg: "sha3-512",
      encoding: "hex_lower",
    });

    expect(out).toEqual({
      leaf_count: 3,
      root,
    });
  });

  it("builds a multi-level tree deterministically for four leaves", async () => {
    const { merkleRootFromItems } = await import("../../../../src/ingest/merkle.js");

    const l1 = hexDigest("1");
    const l2 = hexDigest("2");
    const l3 = hexDigest("3");
    const l4 = hexDigest("4");
    const n12 = hexDigest("a");
    const n34 = hexDigest("b");
    const root = hexDigest("d");

    hashRawMock
      .mockReturnValueOnce({ digest: n12 })
      .mockReturnValueOnce({ digest: n34 })
      .mockReturnValueOnce({ digest: root });

    const out = merkleRootFromItems([
      { leaf_hash: l1 } as any,
      { leaf_hash: l2 } as any,
      { leaf_hash: l3 } as any,
      { leaf_hash: l4 } as any,
    ]);

    expect(hashRawMock).toHaveBeenCalledTimes(3);
    expect(out).toEqual({
      leaf_count: 4,
      root,
    });
  });

  it("propagates invalid node digest shape as MERKLE_INVALID via hex validation", async () => {
    const { merkleRootFromItems } = await import("../../../../src/ingest/merkle.js");

    const left = hexDigest("1");
    const right = hexDigest("2");

    hashRawMock.mockReturnValue({
      digest: "zzzz",
    });

    expect(() =>
      merkleRootFromItems([
        { leaf_hash: left } as any,
        { leaf_hash: right } as any,
      ]),
    ).toThrow(/merkle_invalid_leaf_hash/i);
  });
});