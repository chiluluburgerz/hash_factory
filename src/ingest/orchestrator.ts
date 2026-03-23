// ============================================================================
// File: src/ingest/orchestrator.ts
// Version: 1.2-hf-ingest-orchestrator-root-anchor-submit | 2026-03-20
// Purpose:
//   Compose pure local ingest evidence generation with Core anchor side effects.
//   - Keeps local evidence deterministic and testable.
//   - Adds Core anchor side effects in deterministic order.
// Security:
//   - Uses pass-through Core auth via CoreRequestCtx (recommended).
//   - Propagates computed idempotency_key to Core writes.
// Notes:
//   - register_and_anchor now:
//       1) anchors deterministic receipt JSON
//       2) requests trusted HF root anchor for certificate-eligible flow
//   - submit supports local-first evidence finalization using pasted evidence.
//   - hash_only / merkle_only remain local-only.
// ============================================================================

import type { CoreRequestCtx } from "../core/coreClient.js";
import type { MerkleAnchorClient } from "../core/merkleAnchorClient.js";
import type { MerkleClient } from "../core/merkleClient.js";
import { IngestError } from "./errors.js";
import { executeIngest, type ExecuteHooks } from "./execute.js";
import {
  parseIngestExecuteRequestV1,
  parseIngestSubmitRequestV1,
  type IngestExecuteRequestV1,
  type IngestSubmitRequestV1,
} from "./validators.js";
import { verifySubmittedIngestEvidence } from "./verifier.js";
import { buildIngestReceiptV1, type IngestReceiptV1 } from "./receipt.js";
import type { IngestMode, IngestResult } from "./types.js";

export type IngestOrchestratorResponse = Readonly<{
  mode: IngestMode;
  evidence: IngestResult;
  receipt: IngestReceiptV1;
  core?: Readonly<{
    receipt_anchor?: Record<string, unknown>;
    root_build?: Record<string, unknown>;
    root_publish?: Record<string, unknown>;
    root_anchor?: Record<string, unknown>;
  }>;
}>;

function asNonEmptyString(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function pick(
  obj: Record<string, unknown> | null | undefined,
  keys: readonly string[]
): Record<string, unknown> | undefined {
  if (!obj) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function shapeAnchorResult(resultLike: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(resultLike)) return undefined;

  const anchor = isPlainObject(resultLike.anchor) ? resultLike.anchor : null;
  const publish = isPlainObject(resultLike.publish) ? resultLike.publish : null;
  const certificate = isPlainObject(resultLike.certificate) ? resultLike.certificate : null;

  const out: Record<string, unknown> = {
    ok: Boolean(resultLike.ok),
    deduped: Boolean(resultLike.deduped),
    queued_only: Boolean(resultLike.queued_only),
  };

  const shapedAnchor = pick(anchor, [
    "id",
    "proof_date",
    "domain",
    "anchor_kind",
    "root_id",
    "root_hash",
    "payload_type",
    "payload_hash",
    "payload_bytes",
    "leaf_id",
    "leaf_hash",
    "anchor_hash",
    "hcs_topic_id",
    "hcs_transaction_id",
    "hcs_message_id",
    "status",
    "published_at",
    "confirmed_at",
    "created_at",
    "updated_at",
  ]);
  if (shapedAnchor) out.anchor = shapedAnchor;

  const shapedPublish = publish
    ? {
        ...(pick(publish, [
          "topic_key",
          "topic_name",
          "topic_id",
          "hcs_topic_id",
          "transaction_id",
          "hcs_transaction_id",
          "message_id",
          "hcs_message_id",
          "sequence_number",
        ]) ?? {}),
      }
    : undefined;
  if (shapedPublish && Object.keys(shapedPublish).length > 0) out.publish = shapedPublish;

  const shapedCertificate = certificate
    ? {
        attempted: Boolean(certificate.attempted),
        skipped: Boolean(certificate.skipped),
        issued: Boolean(certificate.issued),
        deduped: Boolean(certificate.deduped),
        ...(certificate.reason !== undefined ? { reason: certificate.reason } : {}),
        ...(pick(
          isPlainObject(certificate.nft) ? certificate.nft : null,
          ["id", "nft_id", "token_id", "serial_number", "wallet_address", "status", "proof_date", "minted_at"]
        )
          ? {
              nft: pick(
                isPlainObject(certificate.nft) ? certificate.nft : null,
                ["id", "nft_id", "token_id", "serial_number", "wallet_address", "status", "proof_date", "minted_at"]
              ),
            }
          : {}),
        ...(pick(
          isPlainObject(certificate.token) ? certificate.token : null,
          ["id", "token_id", "purpose", "symbol", "name"]
        )
          ? {
              token: pick(
                isPlainObject(certificate.token) ? certificate.token : null,
                ["id", "token_id", "purpose", "symbol", "name"]
              ),
            }
          : {}),
      }
    : undefined;
  if (shapedCertificate && Object.keys(shapedCertificate).length > 0) {
    out.certificate = shapedCertificate;
  }

  return out;
}

function shapeRootResult(resultLike: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(resultLike)) return undefined;

  const out: Record<string, unknown> = {
    ...(pick(resultLike, [
      "success",
      "skipped",
      "reason",
      "id",
      "root_id",
      "proof_date",
      "domain",
      "status",
      "root_hash",
      "leaf_count",
      "snapshot_cutoff_ts",
      "snapshot_leaf_count",
      "build_version",
      "hash_alg",
      "tree_alg",
      "mirror_verified",
      "mirror_verified_at",
      "verified_at",
      "created_at",
      "updated_at",
    ]) ?? {}),
  };

  const publish = pick(resultLike, [
    "topic_name",
    "hcs_topic_id",
    "hcs_transaction_id",
    "hcs_message_id",
    "message_id",
  ]);
  if (publish) out.publish = publish;

  return Object.keys(out).length > 0 ? out : undefined;
}

function lowerString(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function hasPublishedRootIdentifiers(root: Record<string, unknown> | undefined): boolean {
  if (!root) return false;

  const publish = isPlainObject(root.publish) ? root.publish : null;

  return Boolean(
    asNonEmptyString(root.hcs_transaction_id) ||
      asNonEmptyString(root.hcs_message_id) ||
      asNonEmptyString(root.message_id) ||
      asNonEmptyString(root.anchor_hcs_transaction_id) ||
      asNonEmptyString(root.anchor_hcs_message_id) ||
      asNonEmptyString(publish?.hcs_transaction_id) ||
      asNonEmptyString(publish?.hcs_message_id) ||
      asNonEmptyString(publish?.message_id)
  );
}

function normalizeReplayRootBuild(
  rootBuild: Record<string, unknown> | undefined,
  rootPublish: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!rootBuild) return rootBuild;
  if (!rootPublish) return rootBuild;

  const skipped = rootBuild.skipped === true;
  const reason = lowerString(rootBuild.reason);

  const publishLooksReusable =
    (lowerString(rootPublish.status) === "published" ||
      lowerString(rootPublish.status) === "verified") &&
    Boolean(asNonEmptyString(rootPublish.id) || asNonEmptyString(rootPublish.root_id)) &&
    Boolean(asNonEmptyString(rootPublish.root_hash)) &&
    hasPublishedRootIdentifiers(rootPublish);

  if (!(skipped && reason === "empty_snapshot" && publishLooksReusable)) {
    return rootBuild;
  }

  return {
    ...rootBuild,
    success: true,
    skipped: true,
    reason: "reused_existing_root",
    reused_existing_root: true,
    id: rootPublish.id ?? rootPublish.root_id ?? rootBuild.id ?? null,
    root_id: rootPublish.root_id ?? rootPublish.id ?? rootBuild.root_id ?? null,
    proof_date: rootBuild.proof_date ?? rootPublish.proof_date ?? null,
    domain: rootBuild.domain ?? rootPublish.domain ?? null,
    status: rootPublish.status ?? rootBuild.status ?? null,
    root_hash: rootPublish.root_hash ?? rootBuild.root_hash ?? null,
    leaf_count:
      rootPublish.leaf_count ??
      rootPublish.snapshot_leaf_count ??
      rootBuild.leaf_count ??
      null,
    snapshot_cutoff_ts:
      rootPublish.snapshot_cutoff_ts ??
      rootBuild.snapshot_cutoff_ts ??
      null,
  };
}

function normalizeReplayRootPublish(
  rootPublish: Record<string, unknown> | undefined,
  rootBuild: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!rootPublish) return rootPublish;

  const alreadyPublished =
    (lowerString(rootPublish.status) === "published" ||
      lowerString(rootPublish.status) === "verified") &&
    hasPublishedRootIdentifiers(rootPublish);

  const buildReused = rootBuild?.reused_existing_root === true;

  if (!(alreadyPublished && buildReused)) {
    return rootPublish;
  }

  return {
    ...rootPublish,
    success: true,
    skipped: true,
    reason: "reused_existing_root",
    reused_existing_root: true,
  };
}

function mergeFinalRootView(
  rootBuild: Record<string, unknown> | undefined,
  rootPublish: Record<string, unknown> | undefined,
  rootAnchor: Record<string, unknown> | undefined
): Record<string, unknown> {
  const publish = rootPublish ?? {};
  const anchor = isPlainObject(rootAnchor?.anchor) ? rootAnchor.anchor : {};

  return {
    ...(rootBuild ?? {}),
    ...(publish ?? {}),
    ...(rootBuild?.reused_existing_root === true || rootPublish?.reused_existing_root === true
      ? { reused_existing_root: true }
      : {}),
    ...(anchor.root_id != null && publish.root_id == null ? { root_id: anchor.root_id } : {}),
    ...(anchor.root_hash != null && publish.root_hash == null ? { root_hash: anchor.root_hash } : {}),
    ...(anchor.domain != null && publish.domain == null ? { domain: anchor.domain } : {}),
    ...(anchor.proof_date != null && publish.proof_date == null ? { proof_date: anchor.proof_date } : {}),
    ...(anchor.status != null ? { anchor_status: anchor.status } : {}),
    ...(anchor.id != null ? { anchor_id: anchor.id } : {}),
    ...(anchor.anchor_hash != null ? { anchor_hash: anchor.anchor_hash } : {}),
    ...(anchor.hcs_topic_id != null ? { anchor_hcs_topic_id: anchor.hcs_topic_id } : {}),
    ...(anchor.hcs_transaction_id != null ? { anchor_hcs_transaction_id: anchor.hcs_transaction_id } : {}),
    ...(anchor.hcs_message_id != null ? { anchor_hcs_message_id: anchor.hcs_message_id } : {}),
    ...(anchor.confirmed_at != null ? { anchor_confirmed_at: anchor.confirmed_at } : {}),
  };
}

export function makeIngestOrchestrator(
  merkleAnchor: MerkleAnchorClient,
  merkle: MerkleClient
) {
  if (!merkleAnchor) {
    throw new IngestError("merkle_anchor_client_required", {
      code: "INTERNAL_ERROR",
      statusCode: 500,
    });
  }
  if (!merkle) {
    throw new IngestError("merkle_client_required", {
      code: "INTERNAL_ERROR",
      statusCode: 500,
    });
  }

  async function finalizeFromEvidence(
    parsed: {
      mode: "register_and_anchor";
      identity: {
        object_key: string;
        object_kind: string;
        version_label?: string | null;
        program?: string | null;
      };
      metadata?: Record<string, unknown>;
      evidence_pointer?: string;
      domain: string;
      proof_date: string;
    },
    evidence: IngestResult,
    ctx: CoreRequestCtx
  ): Promise<IngestOrchestratorResponse> {
    const ctx2: CoreRequestCtx = Object.freeze({
      ...(ctx ?? {}),
      idempotencyKey: evidence.idempotency_key,
    });

    const receiptLocal = buildIngestReceiptV1({
      mode: "register_and_anchor",
      evidence,
      domain: parsed.domain,
      proof_date: parsed.proof_date,
      evidence_pointer: parsed.evidence_pointer ?? null,
      metadata: parsed.metadata ?? null,
      core: null,
    });

    const receipt_anchor = await merkleAnchor.anchorPayload(
      {
        domain: parsed.domain,
        proofDate: parsed.proof_date,
        payload_type: "ingest_receipt_v1",
        payload_json: receiptLocal,
      },
      ctx2
    );

    const domain = asNonEmptyString(parsed.domain);
    const proofDate = asNonEmptyString(parsed.proof_date);

    if (!domain) {
      throw new IngestError("register_and_anchor_requires_domain", {
        code: "SCHEMA_INVALID",
        statusCode: 400,
      });
    }

    if (!proofDate) {
      throw new IngestError("register_and_anchor_requires_proof_date", {
        code: "SCHEMA_INVALID",
        statusCode: 400,
      });
    }

    const root_build = await merkle.buildRoot(
      {
        domain,
        proofDate,
      },
      {
        ...ctx2,
        idempotencyKey: `${evidence.idempotency_key}:root_build`,
      }
    );

    const rootBuildShaped = shapeRootResult(root_build);

    const builtRootId =
      asNonEmptyString((root_build as any)?.id) ??
      asNonEmptyString((root_build as any)?.root_id) ??
      null;

    const builtRootDomain =
      asNonEmptyString((root_build as any)?.domain) ??
      domain;

    if (!builtRootId && !builtRootDomain) {
      throw new IngestError("root_build_missing_root_reference", {
        code: "UPSTREAM_INVALID",
        statusCode: 502,
      });
    }

    const rootPublishPayload: Record<string, unknown> = {
      proofDate,
      ...(builtRootId ? { rootId: builtRootId } : {}),
      ...(builtRootDomain ? { domain: builtRootDomain } : {}),
    };

    const root_publish = await merkle.publishRoot(
      rootPublishPayload,
      {
        ...ctx2,
        idempotencyKey: `${evidence.idempotency_key}:root_publish`,
      }
    );

    const rawRootPublishShaped = shapeRootResult(root_publish);
    const normalizedRootBuildShaped = normalizeReplayRootBuild(
      rootBuildShaped,
      rawRootPublishShaped
    );
    const rootPublishShaped = normalizeReplayRootPublish(
      rawRootPublishShaped,
      normalizedRootBuildShaped
    );

    const rootId =
      asNonEmptyString((root_publish as any)?.id) ??
      asNonEmptyString((root_publish as any)?.root_id) ??
      builtRootId;

    const rootDomain =
      asNonEmptyString((root_publish as any)?.domain) ??
      builtRootDomain;

    if (!rootId) {
      throw new IngestError("root_publish_missing_root_id", {
        code: "UPSTREAM_INVALID",
        statusCode: 502,
      });
    }

    if (!rootDomain) {
      throw new IngestError("root_publish_missing_domain", {
        code: "UPSTREAM_INVALID",
        statusCode: 502,
      });
    }

    const root_anchor = await merkleAnchor.requestRootAnchorFromHf(
      {
        rootId,
        domain: rootDomain,
        proofDate,
        anchor_kind: "root",
        reason: "hf_local_ingest_register_and_anchor",
        idempotency_key: `${evidence.idempotency_key}:root`,
      },
      ctx2
    );

    const receiptAnchorShaped = shapeAnchorResult(receipt_anchor);
    const rootAnchorShaped = shapeAnchorResult(root_anchor);

    const finalRoot = mergeFinalRootView(
      normalizedRootBuildShaped,
      rootPublishShaped,
      rootAnchorShaped
    );

    const receiptAnchored = buildIngestReceiptV1({
      mode: "register_and_anchor",
      evidence,
      domain: rootDomain,
      proof_date: proofDate,
      evidence_pointer: parsed.evidence_pointer ?? null,
      metadata: parsed.metadata ?? null,
      core: {
        ...(receiptAnchorShaped ? { receipt_anchor: receiptAnchorShaped } : {}),
        ...(rootAnchorShaped ? { root_anchor: rootAnchorShaped } : {}),
      },
    });

    const coreOut = Object.freeze({
      ...(receiptAnchorShaped ? { receipt_anchor: receiptAnchorShaped } : {}),
      ...(normalizedRootBuildShaped ? { root_build: normalizedRootBuildShaped } : {}),
      ...(Object.keys(finalRoot).length > 0 ? { root_publish: finalRoot } : {}),
      ...(rootAnchorShaped ? { root_anchor: rootAnchorShaped } : {}),
    });

    return Object.freeze({
      mode: "register_and_anchor",
      evidence,
      receipt: receiptAnchored,
      ...(Object.keys(coreOut).length > 0 ? { core: coreOut } : {}),
    });
  }

  async function execute(
    req: IngestExecuteRequestV1,
    ctx: CoreRequestCtx,
    hooks?: ExecuteHooks
  ): Promise<IngestOrchestratorResponse> {
    const parsed = parseIngestExecuteRequestV1(req);
    const mode = parsed.mode;

    const evidence = await executeIngest(parsed, hooks);

    const receiptLocal = buildIngestReceiptV1({
      mode,
      evidence,
      domain: parsed.domain ?? null,
      proof_date: parsed.proof_date ?? null,
      evidence_pointer: parsed.evidence_pointer ?? null,
      metadata: parsed.metadata ?? null,
      core: null,
    });

    if (mode !== "register_and_anchor") {
      return Object.freeze({
        mode,
        evidence,
        receipt: receiptLocal,
      });
    }

    return finalizeFromEvidence(
      {
        mode: "register_and_anchor",
        identity: parsed.identity,
        ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
        ...(parsed.evidence_pointer ? { evidence_pointer: parsed.evidence_pointer } : {}),
        domain: parsed.domain!,
        proof_date: parsed.proof_date!,
      },
      evidence,
      ctx
    );
  }

  async function submit(
    req: IngestSubmitRequestV1,
    ctx: CoreRequestCtx
  ): Promise<IngestOrchestratorResponse> {
    const parsed = parseIngestSubmitRequestV1(req);

    const verify = verifySubmittedIngestEvidence({
      identity: parsed.identity,
      evidence: parsed.evidence,
    });

    if (!verify.ok) {
      const err: any = new Error("submitted_evidence_invalid");
      err.statusCode = 400;
      err.code = "SUBMITTED_EVIDENCE_INVALID";
      err.detail = {
        mismatches: verify.mismatches,
        computed: verify.computed,
      };
      throw err;
    }

    return finalizeFromEvidence(parsed, parsed.evidence, ctx);
  }

  return Object.freeze({ execute, submit });
}

export default makeIngestOrchestrator;