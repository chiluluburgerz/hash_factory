import React from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Radio,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Waypoints,
  Hash,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import MirrorStatusPill from "@/components/hedera/mirror-status-pill.jsx";
import HashscanButton from "@/components/hedera/hashscan-button.jsx";
import CopyIconButton from "@/components/base/copy-icon-button";
import { HederaActionLink } from "@/components/hedera/hedera-overview-ui.jsx";
import {
  shortValue,
  formatDateTime,
  formatRelative,
  topicDetailPath,
  hcsTopicNameOf,
  hcsMessageIdOf,
  hcsTransactionIdOf,
  hcsStatusOf,
  hcsMirrorVerified,
  hederaDecryptPath,
} from "@/components/hedera/hedera-ui-helpers.js";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";

function normalizeDetailEnvelope(payload) {
  const root = payload?.result ?? payload ?? null;
  return root && typeof root === "object" && !Array.isArray(root) ? root : {};
}

function topicIdOf(row) {
  return row?.topic_id || null;
}

function sequenceNumberOf(row) {
  const n = Number(row?.sequence_number);
  return Number.isFinite(n) ? n : null;
}

function bestObservedAt(row) {
  return (
    row?.consensus_timestamp ||
    row?.created_at ||
    row?.valid_start_timestamp ||
    row?.updated_at ||
    null
  );
}

function rawMessageValue(row) {
  return row?.message ?? null;
}

function normalizeMessageForDisplay(value) {
  if (value == null) {
    return { text: "", format: "empty" };
  }

  if (typeof value === "string") {
    return { text: value, format: "text" };
  }

  if (
    value &&
    typeof value === "object" &&
    value.type === "Buffer" &&
    Array.isArray(value.data)
  ) {
    try {
      const decoded = new TextDecoder().decode(new Uint8Array(value.data));
      return { text: decoded, format: "buffer" };
    } catch {
      return { text: JSON.stringify(value, null, 2), format: "json" };
    }
  }

  if (value && typeof value === "object") {
    try {
      return { text: JSON.stringify(value, null, 2), format: "json" };
    } catch {
      return { text: String(value), format: "text" };
    }
  }

  return { text: String(value), format: "text" };
}

function DetailItem({ label, value, mono = false, copyValue = null }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/25 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>

      <div className="mt-2 flex items-start justify-between gap-3">
        <div className={mono ? "font-mono text-xs break-all text-foreground/90" : "text-sm text-foreground/90"}>
          {value || "—"}
        </div>

        {copyValue ? (
          <CopyIconButton
            text={String(copyValue)}
            label={`Copy ${label}`}
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-md p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
          />
        ) : null}
      </div>
    </div>
  );
}

export default function HederaHcsDetailPage() {
  const {
    messageId: routeMessageId = "",
    transactionId: routeTransactionId = "",
  } = useParams();

  const {
    isLoading: appLoading,
    org,
    membership,
    refreshAppContext,
  } = useAppContext();

  const [detail, setDetail] = React.useState({});
  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");

  const decodedMessageId = React.useMemo(() => {
    try {
      return decodeURIComponent(String(routeMessageId || ""));
    } catch {
      return String(routeMessageId || "");
    }
  }, [routeMessageId]);

  const decodedTransactionId = React.useMemo(() => {
    try {
      return decodeURIComponent(String(routeTransactionId || ""));
    } catch {
      return String(routeTransactionId || "");
    }
  }, [routeTransactionId]);

  const identifierType = decodedTransactionId ? "transaction_id" : "message_id";
  const routeIdentifier = decodedTransactionId || decodedMessageId || "";

  const loadPage = React.useCallback(async () => {
    if (!routeIdentifier) {
      setPageError("HCS record identifier is missing.");
      setDetail({});
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setPageError("");

    try {
      const path =
        identifierType === "transaction_id"
          ? `/v1/hedera/hcs/transactions/${encodeURIComponent(routeIdentifier)}`
          : `/v1/hedera/hcs/messages/${encodeURIComponent(routeIdentifier)}`;

      const payload = await fetchJsonOrThrow(path);
      setDetail(normalizeDetailEnvelope(payload));
    } catch (err) {
      setDetail({});
      setPageError(err?.message || "Failed to load HCS detail.");
    } finally {
      setIsLoading(false);
    }
  }, [identifierType, routeIdentifier]);

  React.useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const resolvedMessageId = hcsMessageIdOf(detail) || "";
  const transactionId = hcsTransactionIdOf(detail);
  const resolvedRecordId = resolvedMessageId || transactionId || routeIdentifier || "Unknown";
  const topicName = hcsTopicNameOf(detail, "HCS record");
  const topicId = topicIdOf(detail);
  const sequenceNumber = sequenceNumberOf(detail);
  const status = hcsStatusOf(detail);
  const mirrorVerified = hcsMirrorVerified(detail);
  const observedAt = bestObservedAt(detail);
  const rawMessage = rawMessageValue(detail);
  const normalizedMessage = normalizeMessageForDisplay(rawMessage);
  const isTenantAdmin = String(membership?.role || "") === "tenant_admin";

  const batchGroupId = detail?.batch_group_id || null;
  const hasBatchGroupId = Boolean(batchGroupId);

  const verifyPath = resolvedMessageId
    ? hederaDecryptPath({ messageId: resolvedMessageId, mode: "verify_only" })
    : transactionId
      ? hederaDecryptPath({ transactionId, mode: "verify_only" })
      : "";

  const decryptPath = resolvedMessageId
    ? hederaDecryptPath({ messageId: resolvedMessageId, mode: "decrypt_only" })
    : transactionId
      ? hederaDecryptPath({ transactionId, mode: "decrypt_only" })
      : "";

  const decryptVerifyPath = resolvedMessageId
    ? hederaDecryptPath({ messageId: resolvedMessageId, mode: "decrypt_and_verify" })
    : transactionId
      ? hederaDecryptPath({ transactionId, mode: "decrypt_and_verify" })
      : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Link to="/app/hedera" className="hover:text-foreground/80">
              Hedera
            </Link>
            <span>/</span>
            <Link to="/app/hedera/hcs" className="hover:text-foreground/80">
              HCS Activity
            </Link>
            <span>/</span>
            <span className="max-w-[260px] truncate">{resolvedRecordId}</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            HCS Detail
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Review record identity, topic context, mirror status, and stored message content for this HCS entry.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/app/hedera/hcs"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 text-sm font-medium text-foreground/90 transition-colors hover:border-border hover:bg-card/35"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to HCS Activity
          </Link>

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void refreshAppContext();
              void loadPage();
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>

          {(resolvedMessageId || transactionId) ? (
            <>
              <Link
                to={verifyPath}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 text-sm font-medium text-foreground/90 transition-colors hover:border-border hover:bg-card/35"
              >
                Verify
              </Link>

              <Link
                to={decryptPath}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 text-sm font-medium text-foreground/90 transition-colors hover:border-border hover:bg-card/35"
              >
                Decrypt
              </Link>

              <Link
                to={decryptVerifyPath}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 text-sm font-medium text-foreground/90 transition-colors hover:border-border hover:bg-card/35"
              >
                Decrypt &amp; Verify
              </Link>
            </>
          ) : null}
        </div>
      </div>

      {pageError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {pageError}
        </div>
      ) : null}

      <EntitySection
        title="Record context"
        description="Selected HCS record in the current authenticated workspace."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Radio className="h-3.5 w-3.5" />
              Record
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground/90">
              {isLoading ? "Loading..." : shortValue(resolvedRecordId, 14, 10)}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Status: {status}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              Organization
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground/90">
              {appLoading ? "Loading..." : org?.name || "No org"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Role: {membership?.role || "—"}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Mirror status
            </div>
            <div className="mt-2">
              <MirrorStatusPill
                hasAnchor={Boolean(routeIdentifier || resolvedMessageId || transactionId)}
                mirrorVerified={mirrorVerified}
              />
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              {mirrorVerified ? "Mirror confirmation is visible." : "Mirror confirmation is not yet visible."}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="outline">{status}</Badge>
          <Badge variant={mirrorVerified ? "success" : "warn"}>
            {mirrorVerified ? "mirror verified" : "mirror pending"}
          </Badge>
          <Badge variant={topicName ? "outline" : "warn"}>
            topic {topicName ? "present" : "missing"}
          </Badge>
          <Badge variant={transactionId ? "success" : "warn"}>
            tx id {transactionId ? "present" : "missing"}
          </Badge>
          <Badge variant={isTenantAdmin ? "info" : "outline"}>
            access {isTenantAdmin ? "admin-capable" : "read-focused"}
          </Badge>
        </div>
      </EntitySection>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <Waypoints className="h-3.5 w-3.5" />
              Topic
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : topicName || "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Associated trust channel.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <Hash className="h-3.5 w-3.5" />
              Sequence
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : sequenceNumber != null ? sequenceNumber.toLocaleString() : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Message position in the topic stream.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <ShieldCheck className="h-3.5 w-3.5" />
              Mirror posture
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : mirrorVerified ? "Verified" : "Pending"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Current mirror confirmation state.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <ScrollText className="h-3.5 w-3.5" />
              Observed
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : observedAt ? formatRelative(observedAt) : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Best available timestamp for this record.
            </div>
          </CardContent>
        </Card>
      </div>

      <EntitySection
        title="Record summary"
        description="Identity, timing, and topic details."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-4">
            <DetailItem
              label="Message id"
              value={resolvedMessageId || "—"}
              mono
              copyValue={resolvedMessageId || null}
            />

            <DetailItem
              label="Transaction id"
              value={transactionId}
              mono
              copyValue={transactionId}
            />

            <DetailItem
              label="Topic name"
              value={topicName}
            />

            <DetailItem
              label="Topic id"
              value={topicId}
              mono
              copyValue={topicId}
            />

            <DetailItem
              label="Sequence number"
              value={sequenceNumber != null ? String(sequenceNumber) : "—"}
            />
          </div>

          <div className="space-y-4">
            <DetailItem
              label="Valid start timestamp"
              value={detail?.valid_start_timestamp ? `${formatDateTime(detail.valid_start_timestamp, true)} • ${formatRelative(detail.valid_start_timestamp)}` : "—"}
            />

            <DetailItem
              label="Consensus timestamp"
              value={detail?.consensus_timestamp ? `${formatDateTime(detail.consensus_timestamp, true)} • ${formatRelative(detail.consensus_timestamp)}` : "—"}
            />

            <DetailItem
              label="Mirror verified at"
              value={detail?.mirror_verified_at ? `${formatDateTime(detail.mirror_verified_at, true)} • ${formatRelative(detail.mirror_verified_at)}` : "—"}
            />

            <DetailItem
              label="Created at"
              value={detail?.created_at ? `${formatDateTime(detail.created_at, true)} • ${formatRelative(detail.created_at)}` : "—"}
            />

            <DetailItem
              label="Updated at"
              value={detail?.updated_at ? `${formatDateTime(detail.updated_at, true)} • ${formatRelative(detail.updated_at)}` : "—"}
            />
          </div>
        </div>
      </EntitySection>

      <EntitySection
        title="Integrity and lifecycle"
        description="Integrity identifiers and batch metadata attached to this record."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <DetailItem
            label="Data hash"
            value={detail?.data_hash || "—"}
            mono
            copyValue={detail?.data_hash || null}
          />

          <DetailItem
            label="Payer account id"
            value={detail?.payer_account_id || "—"}
            mono
            copyValue={detail?.payer_account_id || null}
          />

          <DetailItem
            label="Batch count"
            value={detail?.batch_count != null ? String(detail.batch_count) : "—"}
          />

          {hasBatchGroupId ? (
            <DetailItem
              label="Batch group id"
              value={batchGroupId}
              mono
              copyValue={batchGroupId}
            />
          ) : null}

          <DetailItem
            label="Memo"
            value={detail?.memo || "None"}
            copyValue={detail?.memo || null}
          />
        </div>
      </EntitySection>

      <EntitySection
        title="Stored message"
        description="Raw stored message content for this HCS record."
      >
        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Raw message payload</CardTitle>
                <CardDescription>
                  Displayed as text, decoded buffer text, or JSON depending on the stored value.
                </CardDescription>
              </div>

              {normalizedMessage.text ? (
                <CopyIconButton
                  text={normalizedMessage.text}
                  label="Copy raw message"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 rounded-md p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                />
              ) : null}
            </div>
          </CardHeader>

          <CardContent>
            {normalizedMessage.text ? (
              <pre className="overflow-x-auto rounded-xl border border-border/60 bg-card/25 p-4 text-xs leading-6 text-foreground/90 whitespace-pre-wrap break-all">
                {normalizedMessage.text}
              </pre>
            ) : (
              <div className="rounded-xl border border-border/60 bg-card/25 p-4 text-sm text-muted-foreground">
                No stored message payload is available for this record.
              </div>
            )}
          </CardContent>
        </Card>
      </EntitySection>

      <EntitySection
        title="Next actions"
        description="Move from this record into related trust and verification flows."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Waypoints className="h-4 w-4" />
              Topic detail
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Review the broader trust channel and related topic activity.
            </p>
            <div className="mt-3">
              <HederaActionLink to={topicDetailPath(detail)}>
                Open topic detail
              </HederaActionLink>
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <ShieldCheck className="h-4 w-4" />
              Verify or decrypt
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Open the verification workspace with this record prefilled.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {(resolvedMessageId || transactionId) ? (
                <>
                  <HederaActionLink to={verifyPath}>
                    Verify
                  </HederaActionLink>

                  <HederaActionLink to={decryptVerifyPath}>
                    Decrypt &amp; verify
                  </HederaActionLink>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Record identifier unavailable.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <ScrollText className="h-4 w-4" />
              External network view
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Open the linked transaction in HashScan when a transaction id is available.
            </p>
            <div className="mt-3">
              {transactionId ? (
                <HashscanButton
                  id={transactionId}
                  label="Open in HashScan"
                  size="sm"
                  title="Open transaction in HashScan"
                />
              ) : (
                <div className="text-sm text-muted-foreground">
                  Transaction id unavailable.
                </div>
              )}
            </div>
          </div>
        </div>
      </EntitySection>
    </div>
  );
}