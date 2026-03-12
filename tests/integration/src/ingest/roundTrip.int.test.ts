// ============================================================================
// File: tests/integration/ingest/roundTrip.int.test.ts
// Version: 1.0.0-hf-ingest-roundtrip-int | 2026-03-07
// Purpose:
//   Integration tests for real ingest round-trip flows.
// Notes:
//   - Uses real hashing / bundle / receipt / verifier code.
//   - Uses a real temp directory for file_set replay verification.
//   - Keeps scope intentionally small: one json flow, one file_set flow.
// ============================================================================

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import { executeIngest } from "../../../../src/ingest/execute.js";
import { buildIngestReceiptV1 } from "../../../../src/ingest/receipt.js";
import {
  verifyIngestBundle,
  verifyIngestReceipt,
  verifyIngestFileSetAgainstReceiptOrBundle,
} from "../../../../src/ingest/verifier.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("ingest round-trip (integration)", () => {
  it("executes json ingest, builds a real receipt, and verifies both bundle and receipt", async () => {
    const evidence = await executeIngest({
      mode: "hash_only",
      identity: {
        object_key: "obj.int.json.1",
        object_kind: "json",
        version_label: "v1",
        program: "sage",
      },
      material: {
        kind: "json",
        value: {
          z: 2,
          a: 1,
          nested: {
            b: true,
            c: ["x", 3, null],
          },
        },
      },
      metadata: {
        run_id: "int-json-1",
        tags: ["alpha", "beta"],
      },
      evidence_pointer: "file:///tmp/evidence.json",
      domain: "transcriptomics",
      proof_date: "2026-03-07",
    });

    const receipt = buildIngestReceiptV1({
      mode: "hash_only",
      evidence,
      domain: "transcriptomics",
      proof_date: "2026-03-07",
      evidence_pointer: "file:///tmp/evidence.json",
      metadata: {
        run_id: "int-json-1",
        tags: ["alpha", "beta"],
      },
      core: null,
    });

    const bundleCheck = verifyIngestBundle(evidence.bundle);
    const receiptCheck = verifyIngestReceipt(receipt);

    expect(bundleCheck.ok).toBe(true);
    expect(bundleCheck.mismatches).toEqual([]);
    expect(bundleCheck.computed).toEqual({
      bundle_digest: evidence.bundle_digest,
      fingerprint: evidence.fingerprint,
      idempotency_key: evidence.idempotency_key,
      merkle_root: evidence.merkle_root,
      item_count: 1,
      total_bytes: evidence.bundle.summary.total_bytes,
    });

    expect(receiptCheck.ok).toBe(true);
    expect(receiptCheck.mismatches).toEqual([]);
    expect(receiptCheck.computed).toEqual({
      receipt_id: receipt.receipt_id,
      idempotency_key: evidence.idempotency_key,
    });

    expect(evidence.object_key).toBe("obj.int.json.1");
    expect(evidence.object_kind).toBe("json");
    expect(evidence.bundle.summary.item_count).toBe(1);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it("executes file_set ingest on a real temp directory and verifies local replay against the real receipt", async () => {
    const rootDir = await makeTempDir("hf-ingest-fileset-");

    await fs.mkdir(path.join(rootDir, "nested"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "a.tsv"), "gene\tvalue\nA\t1\n", "utf8");
    await fs.writeFile(path.join(rootDir, "nested", "b.tsv"), "gene\tvalue\nB\t2\n", "utf8");
    await fs.writeFile(path.join(rootDir, "ignore.tmp"), "skip me\n", "utf8");

    const evidence = await executeIngest({
      mode: "hash_only",
      identity: {
        object_key: "obj.int.fileset.1",
        object_kind: "file_set",
        version_label: "v1",
        program: "sage",
      },
      material: {
        kind: "file_set",
        root_dir: rootDir,
        rules: {
          include_globs: ["a.tsv", "nested", "nested/**", "ignore.tmp"],
          exclude_globs: ["ignore.tmp"],
          allowed_suffixes: [".tsv"],
          follow_symlinks: false,
          redact_paths: false,
          normalize_line_endings: false,
        },
      },
      metadata: {
        run_id: "int-fileset-1",
      },
      evidence_pointer: `file://${rootDir}`,
      domain: "spatial",
      proof_date: "2026-03-07",
    });

    const receipt = buildIngestReceiptV1({
      mode: "hash_only",
      evidence,
      domain: "spatial",
      proof_date: "2026-03-07",
      evidence_pointer: `file://${rootDir}`,
      metadata: {
        run_id: "int-fileset-1",
      },
      core: null,
    });

    const bundleCheck = verifyIngestBundle(evidence.bundle);
    const receiptCheck = verifyIngestReceipt(receipt);
    const replayCheck = await verifyIngestFileSetAgainstReceiptOrBundle({
      receipt,
      root_dir: rootDir,
    });

    expect(evidence.object_key).toBe("obj.int.fileset.1");
    expect(evidence.object_kind).toBe("file_set");
    expect(evidence.bundle.summary.item_count).toBe(2);
    expect(evidence.bundle.items.map((it) => it.path_rel)).toEqual([
      "a.tsv",
      "nested/b.tsv",
    ]);

    expect(bundleCheck.ok).toBe(true);
    expect(bundleCheck.mismatches).toEqual([]);

    expect(receiptCheck.ok).toBe(true);
    expect(receiptCheck.mismatches).toEqual([]);

    expect(replayCheck.ok).toBe(true);
    expect(replayCheck.mismatches).toEqual([]);
    expect(replayCheck.computed).toEqual({
      local_fingerprint: evidence.fingerprint,
      local_bundle_digest: evidence.bundle_digest,
      local_merkle_root: evidence.merkle_root ?? null,
      local_idempotency_key: evidence.idempotency_key,
      local_item_count: 2,
      local_total_bytes: evidence.bundle.summary.total_bytes,
    });
  });
});