// ============================================================================
// File: tests/units/datasets/orchestrator.test.ts
// Version: 1.0.0-hf-datasets-orchestrator-unit | 2026-03-07
// Purpose:
//   Unit tests for src/datasets/orchestrator.ts
// Notes:
//   - Verifies pure/local dataset evidence composition with conditional Core
//     side effects.
//   - Mocks workflow/validator/receipt boundaries and datasets client.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const executeAnchorMock = vi.fn();
vi.mock("../../../../src/datasets/workflow.js", () => ({
  executeAnchor: executeAnchorMock,
}));

const parseAnchorExecuteRequestV1Mock = vi.fn();
vi.mock("../../../../src/datasets/validators.js", () => ({
  parseAnchorExecuteRequestV1: parseAnchorExecuteRequestV1Mock,
}));

const buildDatasetReceiptV1Mock = vi.fn();
vi.mock("../../../../src/datasets/receipt.js", () => ({
  buildDatasetReceiptV1: buildDatasetReceiptV1Mock,
}));

function makeDatasetsClient(overrides: Record<string, unknown> = {}) {
  return {
    upsertDataset: vi.fn(),
    ingestVersionFromArtifact: vi.fn(),
    publishDatasetVersion: vi.fn(),
    ...overrides,
  } as any;
}

describe("datasets/orchestrator (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("makeDatasetAnchorOrchestrator requires datasets client", async () => {
    const { makeDatasetAnchorOrchestrator } = await import("../../../../src/datasets/orchestrator.js");

    expect(() => makeDatasetAnchorOrchestrator(null as any)).toThrow(/requires datasets client/i);
  });

  it("returns local-only response for hash_only without Core side effects", async () => {
    const { makeDatasetAnchorOrchestrator } = await import("../../../../src/datasets/orchestrator.js");

    const parsed = {
      mode: "hash_only",
      identity: {
        dataset_key: "dataset.1",
        version_label: "v1",
        program: "sage",
      },
      root_dir: "/tmp/data",
      rules: {
        redact_paths: true,
      },
      evidence_pointer: "file:///tmp/evidence.json",
      display_name: "Demo Dataset",
      metadata: { a: 1 },
      set_active: true,
    };

    const evidence = Object.freeze({
      dataset_key: "dataset.1",
      dataset_fingerprint: "fp-1",
      bundle_digest: "bundle-1",
      merkle_root: "root-1",
      idempotency_key: "idem-1",
      bundle: {
        summary: {
          total_bytes: 123,
        },
      },
    });

    const receiptLocal = Object.freeze({
      v: "v1",
      kind: "dataset_anchor_receipt",
      mode: "hash_only",
      evidence,
      core: null,
    });

    parseAnchorExecuteRequestV1Mock.mockReturnValue(parsed);
    executeAnchorMock.mockResolvedValue(evidence);
    buildDatasetReceiptV1Mock.mockReturnValue(receiptLocal);

    const datasets = makeDatasetsClient();
    const orchestrator = makeDatasetAnchorOrchestrator(datasets);

    const ctx = Object.freeze({
      authHeader: "Bearer abc",
    });

    const out = await orchestrator.execute({ any: true } as any, ctx as any);

    expect(parseAnchorExecuteRequestV1Mock).toHaveBeenCalledWith({ any: true });
    expect(executeAnchorMock).toHaveBeenCalledWith(
      {
        mode: "hash_only",
        identity: parsed.identity,
        root_dir: "/tmp/data",
        rules: {
          redact_paths: true,
        },
      },
      undefined,
    );

    expect(buildDatasetReceiptV1Mock).toHaveBeenCalledTimes(1);
    expect(buildDatasetReceiptV1Mock).toHaveBeenCalledWith({
      mode: "hash_only",
      evidence,
      evidence_pointer: "file:///tmp/evidence.json",
      core: null,
    });

    expect(datasets.upsertDataset).not.toHaveBeenCalled();
    expect(datasets.ingestVersionFromArtifact).not.toHaveBeenCalled();
    expect(datasets.publishDatasetVersion).not.toHaveBeenCalled();

    expect(out).toEqual({
      mode: "hash_only",
      evidence,
      receipt: receiptLocal,
    });
    expect(Object.isFrozen(out)).toBe(true);
  });

  it("runs deterministic Core side effects for register_and_anchor and rebuilds anchored receipt", async () => {
    const { makeDatasetAnchorOrchestrator } = await import("../../../../src/datasets/orchestrator.js");

    const parsed = {
      mode: "register_and_anchor",
      identity: {
        dataset_key: "dataset.2",
        version_label: "v2",
        program: "sage",
      },
      root_dir: "/tmp/data",
      rules: {
        redact_paths: false,
      },
      evidence_pointer: "s3://bucket/dataset",
      display_name: "Dataset Two",
      metadata: { run_id: "run-2" },
      set_active: true,
    };

    const evidence = Object.freeze({
      dataset_key: "dataset.2",
      dataset_fingerprint: "fp-2",
      bundle_digest: "bundle-2",
      merkle_root: "root-2",
      idempotency_key: "idem-2",
      bundle: {
        summary: {
          total_bytes: 456,
        },
      },
    });

    const ds = Object.freeze({
      id: "ds-1",
      dataset_key: "dataset.2",
    });

    const ver = Object.freeze({
      id: "ver-1",
      dataset_key: "dataset.2",
      dataset_fingerprint: "fp-2",
    });

    const pub = Object.freeze({
      published: true,
      target: "active",
    });

    const receiptLocal = Object.freeze({
      v: "v1",
      kind: "dataset_anchor_receipt",
      mode: "register_and_anchor",
      evidence,
      core: null,
    });

    const receiptAnchored = Object.freeze({
      v: "v1",
      kind: "dataset_anchor_receipt",
      mode: "register_and_anchor",
      evidence,
      core: {
        dataset: ds,
        version: ver,
        published: pub,
      },
    });

    parseAnchorExecuteRequestV1Mock.mockReturnValue(parsed);
    executeAnchorMock.mockResolvedValue(evidence);
    buildDatasetReceiptV1Mock
      .mockReturnValueOnce(receiptLocal)
      .mockReturnValueOnce(receiptAnchored);

    const datasets = makeDatasetsClient({
      upsertDataset: vi.fn().mockResolvedValue(ds),
      ingestVersionFromArtifact: vi.fn().mockResolvedValue(ver),
      publishDatasetVersion: vi.fn().mockResolvedValue(pub),
    });

    const orchestrator = makeDatasetAnchorOrchestrator(datasets);

    const ctx = Object.freeze({
      authHeader: "Bearer abc",
      requestId: "req-1",
      tenantId: "tenant-1",
    });

    const out = await orchestrator.execute({ req: true } as any, ctx as any);

    expect(executeAnchorMock).toHaveBeenCalledWith(
      {
        mode: "register_and_anchor",
        identity: parsed.identity,
        root_dir: "/tmp/data",
        rules: {
          redact_paths: false,
        },
      },
      undefined,
    );

    expect(buildDatasetReceiptV1Mock).toHaveBeenNthCalledWith(1, {
      mode: "register_and_anchor",
      evidence,
      evidence_pointer: "s3://bucket/dataset",
      core: null,
    });

    expect(datasets.upsertDataset).toHaveBeenCalledTimes(1);
    expect(datasets.upsertDataset).toHaveBeenCalledWith(
      {
        dataset_key: "dataset.2",
        program: "sage",
        display_name: "Dataset Two",
        meta: {
          run_id: "run-2",
          va_dataset_fingerprint_v1: "fp-2",
          va_bundle_digest_v1: "bundle-2",
          va_merkle_root_v1: "root-2",
          va_evidence_pointer_v1: "s3://bucket/dataset",
        },
      },
      {
        authHeader: "Bearer abc",
        requestId: "req-1",
        tenantId: "tenant-1",
        idempotencyKey: "idem-2",
      },
    );

    expect(datasets.ingestVersionFromArtifact).toHaveBeenCalledTimes(1);
    expect(datasets.ingestVersionFromArtifact).toHaveBeenCalledWith(
      "dataset.2",
      {
        matrix_path: "s3://bucket/dataset",
        dataset_fingerprint: "fp-2",
        artifact_bytes: 456,
        bytes_estimate: 456,
      },
      {
        setActive: true,
      },
      {
        authHeader: "Bearer abc",
        requestId: "req-1",
        tenantId: "tenant-1",
        idempotencyKey: "idem-2",
      },
    );

    expect(datasets.publishDatasetVersion).toHaveBeenCalledTimes(1);
    expect(datasets.publishDatasetVersion).toHaveBeenCalledWith(
      "dataset.2",
      {},
      {
        authHeader: "Bearer abc",
        requestId: "req-1",
        tenantId: "tenant-1",
        idempotencyKey: "idem-2",
      },
    );

    expect(buildDatasetReceiptV1Mock).toHaveBeenNthCalledWith(2, {
      mode: "register_and_anchor",
      evidence,
      evidence_pointer: "s3://bucket/dataset",
      core: {
        dataset: ds,
        version: ver,
        published: pub,
      },
    });

    expect(out).toEqual({
      mode: "register_and_anchor",
      evidence,
      receipt: receiptAnchored,
      core: {
        dataset: ds,
        version: ver,
        published: pub,
      },
    });
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.core!)).toBe(true);
  });

  it("omits program, display_name, and evidence pointer metadata when absent", async () => {
    const { makeDatasetAnchorOrchestrator } = await import("../../../../src/datasets/orchestrator.js");

    const parsed = {
      mode: "register_and_anchor",
      identity: {
        dataset_key: "dataset.3",
      },
      root_dir: "/tmp/data",
      rules: undefined,
      evidence_pointer: null,
      display_name: null,
      metadata: undefined,
      set_active: true,
    };

    const evidence = Object.freeze({
      dataset_key: "dataset.3",
      dataset_fingerprint: "fp-3",
      bundle_digest: "bundle-3",
      merkle_root: "root-3",
      idempotency_key: "idem-3",
      bundle: {
        summary: {
          total_bytes: 50,
        },
      },
    });

    parseAnchorExecuteRequestV1Mock.mockReturnValue(parsed);
    executeAnchorMock.mockResolvedValue(evidence);
    buildDatasetReceiptV1Mock.mockReturnValue({ ok: true });

    const datasets = makeDatasetsClient({
      upsertDataset: vi.fn().mockResolvedValue({}),
      ingestVersionFromArtifact: vi.fn().mockResolvedValue({}),
      publishDatasetVersion: vi.fn().mockResolvedValue({}),
    });

    const orchestrator = makeDatasetAnchorOrchestrator(datasets);
    await orchestrator.execute({ req: true } as any, {} as any);

    expect(datasets.upsertDataset).toHaveBeenCalledWith(
      {
        dataset_key: "dataset.3",
        meta: {
          va_dataset_fingerprint_v1: "fp-3",
          va_bundle_digest_v1: "bundle-3",
          va_merkle_root_v1: "root-3",
        },
      },
      {
        idempotencyKey: "idem-3",
      },
    );
  });

  it("passes null total-bytes fields through ingestVersionFromArtifact when summary bytes is invalid", async () => {
    const { makeDatasetAnchorOrchestrator } = await import("../../../../src/datasets/orchestrator.js");

    const parsed = {
      mode: "register_and_anchor",
      identity: {
        dataset_key: "dataset.4",
      },
      root_dir: "/tmp/data",
      evidence_pointer: "s3://bucket/4",
      set_active: false,
    };

    const evidence = Object.freeze({
      dataset_key: "dataset.4",
      dataset_fingerprint: "fp-4",
      bundle_digest: "bundle-4",
      merkle_root: "root-4",
      idempotency_key: "idem-4",
      bundle: {
        summary: {
          total_bytes: "NaN",
        },
      },
    });

    parseAnchorExecuteRequestV1Mock.mockReturnValue(parsed);
    executeAnchorMock.mockResolvedValue(evidence);
    buildDatasetReceiptV1Mock.mockReturnValue({ ok: true });

    const datasets = makeDatasetsClient({
      upsertDataset: vi.fn().mockResolvedValue({}),
      ingestVersionFromArtifact: vi.fn().mockResolvedValue({}),
      publishDatasetVersion: vi.fn().mockResolvedValue({}),
    });

    const orchestrator = makeDatasetAnchorOrchestrator(datasets);
    await orchestrator.execute({ req: true } as any, null as any);

    expect(datasets.ingestVersionFromArtifact).toHaveBeenCalledWith(
      "dataset.4",
      {
        matrix_path: "s3://bucket/4",
        dataset_fingerprint: "fp-4",
      },
      {
        setActive: false,
      },
      {
        idempotencyKey: "idem-4",
      },
    );
  });

  it("propagates executeAnchor failures without Core writes", async () => {
    const { makeDatasetAnchorOrchestrator } = await import("../../../../src/datasets/orchestrator.js");

    const cause = new Error("execute failed");

    parseAnchorExecuteRequestV1Mock.mockReturnValue({
      mode: "register_and_anchor",
      identity: { dataset_key: "dataset.err.1" },
      root_dir: "/tmp/data",
    });

    executeAnchorMock.mockRejectedValue(cause);

    const datasets = makeDatasetsClient();
    const orchestrator = makeDatasetAnchorOrchestrator(datasets);

    await expect(
      orchestrator.execute({ req: true } as any, {} as any),
    ).rejects.toBe(cause);

    expect(buildDatasetReceiptV1Mock).not.toHaveBeenCalled();
    expect(datasets.upsertDataset).not.toHaveBeenCalled();
    expect(datasets.ingestVersionFromArtifact).not.toHaveBeenCalled();
    expect(datasets.publishDatasetVersion).not.toHaveBeenCalled();
  });

  it("propagates Core write failures after local receipt is built", async () => {
    const { makeDatasetAnchorOrchestrator } = await import("../../../../src/datasets/orchestrator.js");

    const cause = new Error("upsert failed");

    parseAnchorExecuteRequestV1Mock.mockReturnValue({
      mode: "register_and_anchor",
      identity: { dataset_key: "dataset.err.2" },
      root_dir: "/tmp/data",
      evidence_pointer: "s3://bucket/x",
    });

    const evidence = Object.freeze({
      dataset_key: "dataset.err.2",
      dataset_fingerprint: "fp-err-2",
      bundle_digest: "bundle-err-2",
      merkle_root: "root-err-2",
      idempotency_key: "idem-err-2",
      bundle: {
        summary: {
          total_bytes: 99,
        },
      },
    });

    const receiptLocal = Object.freeze({
      v: "v1",
      kind: "dataset_anchor_receipt",
      mode: "register_and_anchor",
      evidence,
      core: null,
    });

    executeAnchorMock.mockResolvedValue(evidence);
    buildDatasetReceiptV1Mock.mockReturnValue(receiptLocal);

    const datasets = makeDatasetsClient({
      upsertDataset: vi.fn().mockRejectedValue(cause),
    });

    const orchestrator = makeDatasetAnchorOrchestrator(datasets);

    await expect(
      orchestrator.execute({ req: true } as any, {} as any),
    ).rejects.toBe(cause);

    expect(buildDatasetReceiptV1Mock).toHaveBeenCalledTimes(1);
    expect(datasets.upsertDataset).toHaveBeenCalledTimes(1);
    expect(datasets.ingestVersionFromArtifact).not.toHaveBeenCalled();
    expect(datasets.publishDatasetVersion).not.toHaveBeenCalled();
  });
});