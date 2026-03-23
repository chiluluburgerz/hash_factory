import React from "react";
import { Link, useParams } from "react-router-dom";
import {
  RefreshCw,
  ListTree,
  Link2,
  ShieldCheck,
  Clock3,
  Radio,
  ScrollText,
  ExternalLink,
} from "lucide-react";

import EntitySection from "@/components/base/entity-section.jsx";
import CollapsibleSection from "@/components/base/collapsible-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import EntitySummaryCard from "@/components/entities/entity-summary-card.jsx";
import EntityKeyValueGrid from "@/components/entities/entity-key-value-grid.jsx";
import JsonBlock from "@/components/entities/json-block.jsx";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";
import {
  normalizeEnvelope,
  extractApiErrorMessage,
  formatDateTime,
  shortHash,
  getAnchorRequestId,
  getAnchorStatus,
  getAnchorKind,
  getAnchorLabel,
  getAnchorTrustState,
  statusVariant,
  statusLabel,
  trustVariant,
  trustLabel,
  kindVariant,
  kindLabel,
} from "@/lib/ingestUtils.js";

function compactItems(items) {
  return items.filter((item) => {
    const value = item?.value;
    if (value == null) return false;
    if (value === "") return false;
    if (value === "—") return false;
    return true;
  });
}

function hasValue(value) {
  return !(value == null || value === "" || value === "—");
}

function formatCount(value) {
  return value != null ? Number(value).toLocaleString() : "—";
}

export default function IngestRequestDetailPage() {
  const { anchorRequestId } = useParams();

  const [requestRow, setRequestRow] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");

  const loadRequest = React.useCallback(async () => {
    setIsLoading(true);
    setPageError("");

    try {
      const encodedId = encodeURIComponent(String(anchorRequestId || "").trim());
      const payload = await fetchJsonOrThrow(`/v1/merkle/anchor/requests/${encodedId}`);
      const normalized = normalizeEnvelope(payload);

      if (!normalized || !getAnchorRequestId(normalized)) {
        throw new Error("Ingest request not found.");
      }

      setRequestRow(normalized);
    } catch (err) {
      setRequestRow(null);
      setPageError(extractApiErrorMessage(err, "Failed to load ingest request."));
    } finally {
      setIsLoading(false);
    }
  }, [anchorRequestId]);

  React.useEffect(() => {
    void loadRequest();
  }, [loadRequest]);

  const row = requestRow || {};
  const resolvedRequestId = String(getAnchorRequestId(row) || anchorRequestId || "");
  const status = getAnchorStatus(row);
  const trust = getAnchorTrustState(row);
  const kind = getAnchorKind(row);
  const displayName = getAnchorLabel(row);

  const isRootRequest = kind === "root";
  const isCustomRequest = kind === "custom";

  const proofDate = row?.proof_date || "—";
  const domain = row?.domain || "—";
  const payloadType = row?.payload_type || null;

  const rootId = row?.root_id || null;
  const rootHash = row?.root_hash || null;
  const leafId = row?.leaf_id || null;
  const leafHash = row?.leaf_hash || null;
  const anchorHash = row?.anchor_hash || null;
  const payloadHash = row?.payload_hash || null;
  const payloadBytes = row?.payload_bytes != null ? formatCount(row.payload_bytes) : null;

  const hcsTopicId = row?.hcs_topic_id || null;
  const hcsTransactionId = row?.hcs_transaction_id || null;
  const hcsMessageId = row?.hcs_message_id || null;

  const createdAt = row?.created_at || null;
  const updatedAt = row?.updated_at || null;
  const publishedAt = row?.published_at || null;
  const confirmedAt = row?.confirmed_at || null;
  const failedAt = row?.failed_at || null;
  const cancelledAt = row?.cancelled_at || null;
  const retryAt = row?.retry_at || null;
  const claimedAt = row?.publishing_claimed_at || null;

  const attemptNumber =
    row?.attempt_count != null && Number.isFinite(Number(row.attempt_count))
      ? String(Number(row.attempt_count) + 1)
      : null;
  const reason = row?.reason || null;
  const lastErrorCode = row?.last_error_code || null;
  const lastError = row?.last_error || null;

  const hasHcsPublication = Boolean(hcsTopicId || hcsTransactionId || hcsMessageId);

  const hcsTxnDetailHref = hcsTransactionId
    ? `/app/hedera/hcs/transactions/${encodeURIComponent(hcsTransactionId)}`
    : null;

  const hcsMsgDetailHref = hcsMessageId
    ? `/app/hedera/hcs/messages/${encodeURIComponent(hcsMessageId)}`
    : null;

  const summaryItems = compactItems([
    { key: "proof_date", label: "Proof date", value: proofDate },
    { key: "domain", label: "Domain", value: domain, mono: true },
    { key: "status", label: "Lifecycle", value: statusLabel(status) },
    { key: "trust", label: "Trust posture", value: trustLabel(trust) },
  ]);

  const recordItems = compactItems([
    { key: "request_id", label: "Request id", value: resolvedRequestId, mono: true },
    { key: "proof_date", label: "Proof date", value: proofDate },
    { key: "domain", label: "Domain", value: domain, mono: true },
    { key: "anchor_kind", label: "Anchor kind", value: kindLabel(kind) },
    ...(hasValue(payloadType) ? [{ key: "payload_type", label: "Payload type", value: payloadType }] : []),
    { key: "created_at", label: "Created at", value: formatDateTime(createdAt) },
    { key: "updated_at", label: "Updated at", value: formatDateTime(updatedAt) },
  ]);

  const boundMaterialItems = isRootRequest
    ? compactItems([
        { key: "root_id", label: "Root id", value: rootId, mono: true },
        { key: "root_hash", label: "Root hash", value: rootHash, mono: true },
        { key: "anchor_hash", label: "Anchor hash", value: anchorHash, mono: true },
      ])
    : compactItems([
        { key: "leaf_id", label: "Leaf id", value: leafId, mono: true },
        { key: "leaf_hash", label: "Leaf hash", value: leafHash, mono: true },
        { key: "payload_type", label: "Payload type", value: payloadType },
        { key: "payload_hash", label: "Payload hash", value: payloadHash, mono: true },
        { key: "payload_bytes", label: "Payload bytes", value: payloadBytes },
        { key: "anchor_hash", label: "Anchor hash", value: anchorHash, mono: true },
      ]);

  const hcsIdentifierItems = compactItems([
    { key: "hcs_topic_id", label: "Topic id", value: hcsTopicId, mono: true },
    { key: "hcs_transaction_id", label: "Transaction id", value: hcsTransactionId, mono: true },
    { key: "hcs_message_id", label: "Message id", value: hcsMessageId, mono: true },
  ]);

  const publicationItems = compactItems([
    { key: "published_at", label: "Published at", value: formatDateTime(publishedAt) },
    { key: "confirmed_at", label: "Confirmed at", value: formatDateTime(confirmedAt) },
    { key: "trust_posture", label: "Trust posture", value: trustLabel(trust) },
  ]);

  const lifecycleItems = compactItems([
    { key: "created_at", label: "Created at", value: formatDateTime(createdAt) },
    { key: "updated_at", label: "Updated at", value: formatDateTime(updatedAt) },
    { key: "claimed_at", label: "Claimed at", value: formatDateTime(claimedAt) },
    { key: "retry_at", label: "Retry at", value: formatDateTime(retryAt) },
    { key: "failed_at", label: "Failed at", value: formatDateTime(failedAt) },
    { key: "cancelled_at", label: "Cancelled at", value: formatDateTime(cancelledAt) },
  ]);

  const diagnosticItems = compactItems([
    { key: "attempt_number", label: "Attempt", value: attemptNumber },
    { key: "last_error_code", label: "Last error code", value: lastErrorCode, mono: true },
    { key: "reason", label: "Reason", value: reason },
    { key: "last_error", label: "Last error", value: lastError },
  ]);

  const rawNotes = {
    reason: reason || null,
    last_error_code: lastErrorCode || null,
    last_error: lastError || null,
  };

  const hasRawNotes = Boolean(reason || lastErrorCode || lastError);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            <Link to="/app/ingest" className="hover:underline">
              Ingest
            </Link>
            <span className="mx-2">/</span>
            <Link to="/app/ingest/requests" className="hover:underline">
              Requests
            </Link>
            <span className="mx-2">/</span>
            <span>Detail</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {displayName}
          </h1>

          <p className="font-mono text-sm text-muted-foreground break-all">
            {resolvedRequestId || "unknown"}
          </p>

          <p className="max-w-3xl text-sm text-muted-foreground">
            Review request identity, bound material, HCS linkage, and any active diagnostics for this ingest request.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void loadRequest()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>

          <Button asChild variant="outline">
            <Link to="/app/ingest/requests">
              <ListTree className="mr-2 h-4 w-4" />
              Back to requests
            </Link>
          </Button>

          <Button asChild variant="outline">
            <Link to="/app/ingest/anchor">
              <ScrollText className="mr-2 h-4 w-4" />
              Guided ingest
            </Link>
          </Button>

          {hcsTxnDetailHref ? (
            <Button asChild>
              <Link to={hcsTxnDetailHref}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Open HCS transaction
              </Link>
            </Button>
          ) : null}

          {hcsMsgDetailHref ? (
            <Button asChild variant="outline">
              <Link to={hcsMsgDetailHref}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Open HCS message
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {pageError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {pageError}
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
          Loading ingest request...
        </div>
      ) : !requestRow ? (
        <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
          Ingest request not found.
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <EntitySummaryCard
              title="Status"
              value={statusLabel(status)}
              hint="Current lifecycle state of this request."
              icon={Clock3}
            />

            <EntitySummaryCard
              title="Trust posture"
              value={trustLabel(trust)}
              hint="Observed trust posture from lifecycle state and visible linkage."
              icon={Link2}
            />

            <EntitySummaryCard
              title="Anchor kind"
              value={kindLabel(kind)}
              hint="Request category and trust model class."
              icon={ShieldCheck}
            />

            <EntitySummaryCard
              title="HCS linkage"
              value={hasHcsPublication ? "Present" : "Not yet"}
              hint={
                hasHcsPublication
                  ? "This request currently exposes trust-layer linkage fields."
                  : "This request does not yet expose trust-layer linkage fields."
              }
              icon={Radio}
            />
          </div>

          <EntitySection
            title="Request summary"
            description="Core scope and lifecycle context for this request."
          >
            <div className="mb-4 flex flex-wrap gap-3">
              <Badge variant={kindVariant(kind)}>{kindLabel(kind)}</Badge>
              <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>
              <Badge variant={trustVariant(trust)}>{trustLabel(trust)}</Badge>
            </div>

            <EntityKeyValueGrid items={summaryItems} />
          </EntitySection>

          <EntitySection
            title="Request record"
            description="Stable request identity and lifecycle metadata."
          >
            <EntityKeyValueGrid items={recordItems} />
          </EntitySection>

          <EntitySection
            title="Bound material"
            description={
              isRootRequest
                ? "Root-level identifiers and hashes bound to this request."
                : isCustomRequest
                  ? "Payload, leaf, and anchor material bound to this request."
                  : "Core identifiers and hashes bound to this request."
            }
          >
            <EntityKeyValueGrid items={boundMaterialItems} />
          </EntitySection>

          <EntitySection
            title="Trust and HCS linkage"
            description="Trust-layer references currently visible on this request."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <EntityKeyValueGrid
                title="HCS identifiers"
                items={hcsIdentifierItems}
              />

              <EntityKeyValueGrid
                title="Publication state"
                items={publicationItems}
              />
            </div>
          </EntitySection>

          <EntitySection
            title="Lifecycle diagnostics"
            description="Operational timestamps and diagnostics shown only when relevant."
          >
            {lifecycleItems.length === 0 && diagnosticItems.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-card/25 p-4 text-sm text-muted-foreground">
                No active diagnostics on this request.
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                {lifecycleItems.length > 0 ? (
                  <EntityKeyValueGrid
                    title="Lifecycle timestamps"
                    items={lifecycleItems}
                  />
                ) : null}

                {diagnosticItems.length > 0 ? (
                  <EntityKeyValueGrid
                    title="Diagnostics"
                    items={diagnosticItems}
                  />
                ) : null}
              </div>
            )}
          </EntitySection>

          <CollapsibleSection
            title="Raw request data"
            description="Expand to inspect the full request payload"
            defaultCollapsed={true}
            toggleSide="right"
          >
            <div className="space-y-6">
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Raw request payload
                </div>
                <JsonBlock value={row} emptyLabel="No request payload" />
              </div>
            </div>
          </CollapsibleSection>
        </>
      )}
    </div>
  );
}