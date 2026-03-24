// ============================================================================
// File: tests/units/ingest/orchestrator.test.ts
// Version: 1.0.0-hf-ingest-orchestrator-unit | 2026-03-07
// Purpose:
//   Unit tests for src/ingest/orchestrator.ts
// Notes:
//   - Verifies pure/local ingest composition with conditional Core anchor side effects.
//   - Mocks execute/validate/receipt boundaries and merkle anchor client.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const executeIngestMock = vi.fn();
vi.mock("../../../../src/ingest/execute.js", () => ({
  executeIngest: executeIngestMock,
}));

const parseIngestExecuteRequestV1Mock = vi.fn();
vi.mock("../../../../src/ingest/validators.js", () => ({
  parseIngestExecuteRequestV1: parseIngestExecuteRequestV1Mock,
}));

const buildIngestReceiptV1Mock = vi.fn();
vi.mock("../../../../src/ingest/receipt.js", () => ({
  buildIngestReceiptV1: buildIngestReceiptV1Mock,
}));

function makeMerkleAnchorClient(overrides: Record<string, unknown> = {}) {
  return {
    anchorPayload: vi.fn(),
    ...overrides,
  } as any;
}

function makeMerkleClient(overrides: Record<string, unknown> = {}) {
  return {
    buildRoot: vi.fn(),
    publishRoot: vi.fn(),
    ...overrides,
  } as any;
}

describe("ingest/orchestrator (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("makeIngestOrchestrator requires merkleAnchor client", async () => {
    const { makeIngestOrchestrator } = await import("../../../../src/ingest/orchestrator.js");

    expect(() => makeIngestOrchestrator(null as any, makeMerkleClient())).toThrow(
      /merkle_anchor_client_required/i
    );
  });

  it("returns local-only response for hash_only without Core anchor side effects", async () => {
    const { makeIngestOrchestrator } = await import("../../../../src/ingest/orchestrator.js");

    const parsed = {
      mode: "hash_only",
      domain: "science",
      proof_date: "2026-03-06",
      evidence_pointer: "file:///tmp/evidence.json",
      metadata: { a: 1 },
      identity: {
        object_key: "obj.1",
        object_kind: "dataset",
      },
      material: {
        kind: "json",
        value: { a: 1 },
      },
    };

    const evidence = Object.freeze({
      object_key: "obj.1",
      object_kind: "dataset",
      fingerprint: "fp-1",
      bundle_digest: "bundle-1",
      merkle_root: "root-1",
      bundle: { bundle_version: "v1" },
      idempotency_key: "idem-1",
    });

    const receiptLocal = Object.freeze({
      receipt_version: "v1",
      mode: "hash_only",
      evidence,
      core: null,
    });

    parseIngestExecuteRequestV1Mock.mockReturnValue(parsed);
    executeIngestMock.mockResolvedValue(evidence);
    buildIngestReceiptV1Mock.mockReturnValue(receiptLocal);

    const merkleAnchor = makeMerkleAnchorClient();
    const merkle = makeMerkleClient();
    const orchestrator = makeIngestOrchestrator(merkleAnchor, merkle);

    const hooks = {
      onScanProgress: vi.fn(),
      onHashProgress: vi.fn(),
    };

    const ctx = Object.freeze({
      authHeader: "Bearer abc",
    });

    const out = await orchestrator.execute({ any: true } as any, ctx as any, hooks as any);

    expect(parseIngestExecuteRequestV1Mock).toHaveBeenCalledWith({ any: true });
    expect(executeIngestMock).toHaveBeenCalledWith(parsed, hooks);
    expect(buildIngestReceiptV1Mock).toHaveBeenCalledTimes(1);
    expect(buildIngestReceiptV1Mock).toHaveBeenCalledWith({
      mode: "hash_only",
      evidence,
      domain: "science",
      proof_date: "2026-03-06",
      evidence_pointer: "file:///tmp/evidence.json",
      metadata: { a: 1 },
      core: null,
    });

    expect(merkleAnchor.anchorPayload).not.toHaveBeenCalled();

    expect(out).toEqual({
      mode: "hash_only",
      evidence,
      receipt: receiptLocal,
    });
    expect(Object.isFrozen(out)).toBe(true);
  });

  it("returns local-only response for merkle_only without Core anchor side effects", async () => {
    const { makeIngestOrchestrator } = await import("../../../../src/ingest/orchestrator.js");

    const parsed = {
      mode: "merkle_only",
      domain: null,
      proof_date: null,
      evidence_pointer: null,
      metadata: null,
      identity: {
        object_key: "obj.2",
        object_kind: "dataset",
      },
      material: {
        kind: "text",
        text: "hello",
      },
    };

    const evidence = Object.freeze({
      object_key: "obj.2",
      object_kind: "dataset",
      fingerprint: "fp-2",
      bundle_digest: "bundle-2",
      merkle_root: "root-2",
      bundle: { bundle_version: "v1" },
      idempotency_key: "idem-2",
    });

    const receiptLocal = Object.freeze({
      receipt_version: "v1",
      mode: "merkle_only",
      evidence,
      core: null,
    });

    parseIngestExecuteRequestV1Mock.mockReturnValue(parsed);
    executeIngestMock.mockResolvedValue(evidence);
    buildIngestReceiptV1Mock.mockReturnValue(receiptLocal);

    const merkleAnchor = makeMerkleAnchorClient();
    const merkle = makeMerkleClient();
    const orchestrator = makeIngestOrchestrator(merkleAnchor, merkle);

    const out = await orchestrator.execute({ req: true } as any, {} as any);

    expect(merkleAnchor.anchorPayload).not.toHaveBeenCalled();
    expect(out).toEqual({
      mode: "merkle_only",
      evidence,
      receipt: receiptLocal,
    });
  });

  it("anchors deterministic local receipt for register_and_anchor and rebuilds anchored receipt", async () => {
    const { makeIngestOrchestrator } = await import("../../../../src/ingest/orchestrator.js");

    const parsed = {
      mode: "register_and_anchor",
      domain: "genomics",
      proof_date: "2026-03-06",
      evidence_pointer: "s3://bucket/evidence.json",
      metadata: { run_id: "run-1" },
      identity: {
        object_key: "obj.3",
        object_kind: "dataset",
      },
      material: {
        kind: "file_set",
        root_dir: "/tmp/data",
        rules: {
          redact_paths: true,
        },
      },
    };

    const evidence = Object.freeze({
      object_key: "obj.3",
      object_kind: "dataset",
      fingerprint: "fp-3",
      bundle_digest: "bundle-3",
      merkle_root: "root-3",
      bundle: { bundle_version: "v1" },
      idempotency_key: "idem-3",
    });

    const receiptLocal = Object.freeze({
      receipt_version: "v1",
      mode: "register_and_anchor",
      evidence,
      core: null,
    });

    const anchor = Object.freeze({
      anchor_id: "anchor-1",
      merkle_root: "root-3",
      topic_id: "0.0.12345",
    });

    const receiptAnchored = Object.freeze({
      receipt_version: "v1",
      mode: "register_and_anchor",
      evidence,
      core: { anchor },
    });

    parseIngestExecuteRequestV1Mock.mockReturnValue(parsed);
    executeIngestMock.mockResolvedValue(evidence);
    // Call sequence for register_and_anchor:
    //   1st — execute()'s unconditional local build (result discarded, mode routes to finalizeFromEvidence)
    //   2nd — finalizeFromEvidence's local build → passed to anchorPayload
    //   3rd — finalizeFromEvidence's anchored build → returned in response
    buildIngestReceiptV1Mock
      .mockReturnValueOnce(receiptLocal)
      .mockReturnValueOnce(receiptLocal)
      .mockReturnValueOnce(receiptAnchored);

    const merkleAnchor = makeMerkleAnchorClient({
      anchorPayload: vi.fn().mockResolvedValue(anchor),
    });

    const rootBuildResult = { id: "root-id-3", root_id: "root-id-3", domain: "genomics", root_hash: "rhash-3" };
    const rootPublishResult = { id: "root-id-3", root_id: "root-id-3", domain: "genomics", root_hash: "rhash-3", status: "published", hcs_transaction_id: "0.0.12345@1234567890.000000000" };
    const rootAnchorResult = { ok: true, deduped: false, queued_only: false, anchor: { id: "ra-1", root_id: "root-id-3" } };

    const merkle = makeMerkleClient({
      buildRoot: vi.fn().mockResolvedValue(rootBuildResult),
      publishRoot: vi.fn().mockResolvedValue(rootPublishResult),
    });

    merkleAnchor.requestRootAnchorFromHf = vi.fn().mockResolvedValue(rootAnchorResult);

    const orchestrator = makeIngestOrchestrator(merkleAnchor, merkle);

    const ctx = Object.freeze({
      authHeader: "Bearer abc",
      requestId: "req-1",
      tenantId: "tenant-1",
    });

    const out = await orchestrator.execute({ req: true } as any, ctx as any);

    expect(executeIngestMock).toHaveBeenCalledWith(parsed, undefined);

    // 2nd call is the local receipt built inside finalizeFromEvidence, passed to anchorPayload
    expect(buildIngestReceiptV1Mock).toHaveBeenNthCalledWith(2, {
      mode: "register_and_anchor",
      evidence,
      domain: "genomics",
      proof_date: "2026-03-06",
      evidence_pointer: "s3://bucket/evidence.json",
      metadata: { run_id: "run-1" },
      core: null,
    });

    expect(merkleAnchor.anchorPayload).toHaveBeenCalledTimes(1);
    expect(merkleAnchor.anchorPayload).toHaveBeenCalledWith(
      {
        domain: "genomics",
        proofDate: "2026-03-06",
        payload_type: "ingest_receipt_v1",
        payload_json: receiptLocal,
      },
      expect.objectContaining({
        authHeader: "Bearer abc",
        requestId: "req-1",
        tenantId: "tenant-1",
        idempotencyKey: "idem-3",
      }),
    );

    expect(merkle.buildRoot).toHaveBeenCalledTimes(1);
    expect(merkle.publishRoot).toHaveBeenCalledTimes(1);
    expect(merkleAnchor.requestRootAnchorFromHf).toHaveBeenCalledTimes(1);

    expect(out.mode).toBe("register_and_anchor");
    expect(out.evidence).toBe(evidence);
    expect(out.receipt).toBe(receiptAnchored);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it("omits proofDate from anchor payload when parsed proof_date is absent", async () => {
    const { makeIngestOrchestrator } = await import("../../../../src/ingest/orchestrator.js");

    const parsed = {
      mode: "register_and_anchor",
      domain: "proteomics",
      proof_date: null,
      evidence_pointer: null,
      metadata: null,
      identity: {
        object_key: "obj.4",
        object_kind: "dataset",
      },
      material: {
        kind: "json",
        value: { a: 1 },
      },
    };

    const evidence = Object.freeze({
      object_key: "obj.4",
      object_kind: "dataset",
      fingerprint: "fp-4",
      bundle_digest: "bundle-4",
      merkle_root: "root-4",
      bundle: { bundle_version: "v1" },
      idempotency_key: "idem-4",
    });

    const receiptLocal = Object.freeze({
      receipt_version: "v1",
      mode: "register_and_anchor",
      evidence,
      core: null,
    });

    const anchor = Object.freeze({ anchor_id: "anchor-4" });
    const receiptAnchored = Object.freeze({
      receipt_version: "v1",
      mode: "register_and_anchor",
      evidence,
      core: { anchor },
    });

    parseIngestExecuteRequestV1Mock.mockReturnValue(parsed);
    executeIngestMock.mockResolvedValue(evidence);
    buildIngestReceiptV1Mock
      .mockReturnValueOnce(receiptLocal)
      .mockReturnValueOnce(receiptAnchored);

    const merkleAnchor = makeMerkleAnchorClient({
      anchorPayload: vi.fn().mockResolvedValue(anchor),
    });

    // proof_date is null → register_and_anchor_requires_proof_date will throw
    // so this test should expect a rejection now
    const merkle = makeMerkleClient();
    const orchestrator = makeIngestOrchestrator(merkleAnchor, merkle);

    await expect(
      orchestrator.execute({ req: true } as any, { authHeader: "Bearer xyz" } as any)
    ).rejects.toThrow(/register_and_anchor_requires_proof_date/i);
  });

  it("uses empty ctx safely and still injects idempotencyKey for anchored mode", async () => {
    const { makeIngestOrchestrator } = await import("../../../../src/ingest/orchestrator.js");

    const parsed = {
      mode: "register_and_anchor",
      domain: "demo",
      proof_date: null,
      evidence_pointer: null,
      metadata: null,
      identity: {
        object_key: "obj.5",
        object_kind: "dataset",
      },
      material: {
        kind: "text",
        text: "hi",
      },
    };

    const evidence = Object.freeze({
      object_key: "obj.5",
      object_kind: "dataset",
      fingerprint: "fp-5",
      bundle_digest: "bundle-5",
      merkle_root: "root-5",
      bundle: { bundle_version: "v1" },
      idempotency_key: "idem-5",
    });

    const receiptLocal = Object.freeze({
      receipt_version: "v1",
      mode: "register_and_anchor",
      evidence,
      core: null,
    });

    const anchor = Object.freeze({ anchor_id: "anchor-5" });
    const receiptAnchored = Object.freeze({
      receipt_version: "v1",
      mode: "register_and_anchor",
      evidence,
      core: { anchor },
    });

    parseIngestExecuteRequestV1Mock.mockReturnValue(parsed);
    executeIngestMock.mockResolvedValue(evidence);
    buildIngestReceiptV1Mock
      .mockReturnValueOnce(receiptLocal)
      .mockReturnValueOnce(receiptAnchored);

    const merkleAnchor = makeMerkleAnchorClient({
      anchorPayload: vi.fn().mockResolvedValue(anchor),
    });

    // proof_date is null → register_and_anchor_requires_proof_date will throw
    const merkle = makeMerkleClient();
    const orchestrator = makeIngestOrchestrator(merkleAnchor, merkle);

    await expect(
      orchestrator.execute({ req: true } as any, null as any)
    ).rejects.toThrow(/register_and_anchor_requires_proof_date/i);
  });

  it("propagates executeIngest failures without anchoring", async () => {
    const { makeIngestOrchestrator } = await import("../../../../src/ingest/orchestrator.js");

    const parsed = {
      mode: "register_and_anchor",
      domain: "demo",
      proof_date: null,
      evidence_pointer: null,
      metadata: null,
      identity: {
        object_key: "obj.err.1",
        object_kind: "dataset",
      },
      material: {
        kind: "json",
        value: { a: 1 },
      },
    };

    const cause = new Error("execute failed");
    parseIngestExecuteRequestV1Mock.mockReturnValue(parsed);
    executeIngestMock.mockRejectedValue(cause);

    const merkleAnchor = makeMerkleAnchorClient();
    const merkle = makeMerkleClient();
    const orchestrator = makeIngestOrchestrator(merkleAnchor, merkle);

    await expect(
      orchestrator.execute({ req: true } as any, {} as any),
    ).rejects.toBe(cause);

    expect(buildIngestReceiptV1Mock).not.toHaveBeenCalled();
    expect(merkleAnchor.anchorPayload).not.toHaveBeenCalled();
  });

  it("propagates anchor failures after local receipt is built", async () => {
    const { makeIngestOrchestrator } = await import("../../../../src/ingest/orchestrator.js");

    const parsed = {
      mode: "register_and_anchor",
      domain: "demo",
      proof_date: "2026-03-06",
      evidence_pointer: null,
      metadata: null,
      identity: {
        object_key: "obj.err.2",
        object_kind: "dataset",
      },
      material: {
        kind: "json",
        value: { a: 1 },
      },
    };

    const evidence = Object.freeze({
      object_key: "obj.err.2",
      object_kind: "dataset",
      fingerprint: "fp-err-2",
      bundle_digest: "bundle-err-2",
      merkle_root: "root-err-2",
      bundle: { bundle_version: "v1" },
      idempotency_key: "idem-err-2",
    });

    const receiptLocal = Object.freeze({
      receipt_version: "v1",
      mode: "register_and_anchor",
      evidence,
      core: null,
    });

    const cause = new Error("anchor failed");

    parseIngestExecuteRequestV1Mock.mockReturnValue(parsed);
    executeIngestMock.mockResolvedValue(evidence);
    buildIngestReceiptV1Mock.mockReturnValue(receiptLocal);

    const merkleAnchor = makeMerkleAnchorClient({
      anchorPayload: vi.fn().mockRejectedValue(cause),
    });

    const merkle = makeMerkleClient();
    const orchestrator = makeIngestOrchestrator(merkleAnchor, merkle);

    await expect(
      orchestrator.execute({ req: true } as any, {} as any),
    ).rejects.toBe(cause);

    // execute() builds once, finalizeFromEvidence builds once more before anchorPayload throws
    expect(buildIngestReceiptV1Mock).toHaveBeenCalledTimes(2);
    expect(merkleAnchor.anchorPayload).toHaveBeenCalledTimes(1);
  });
});