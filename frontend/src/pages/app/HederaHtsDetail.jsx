import React from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Coins,
  Hash,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Radio,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import MirrorStatusPill from "@/components/hedera/mirror-status-pill.jsx";
import HashscanButton from "@/components/hedera/hashscan-button.jsx";
import CopyIconButton from "@/components/base/copy-icon-button";
import {
  shortValue,
  formatDateTime,
  formatRelative,
  htsTypeOf,
  htsTokenIdOf,
  htsTransactionIdOf,
  htsAccountIdOf,
  htsMirrorVerified,
  htsStatusOf,
  htsSymbolOf,
  htsNameOf,
  htsSerialOf,
  htsTitleOf,
  htsBestObservedAtOf,
  htsPayerAccountIdOf,
  htsMemoOf,
  htsBatchGroupIdOf,
  htsBatchCountOf,
} from "@/components/hedera/hedera-ui-helpers.js";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";

function normalizeDetailEnvelope(payload) {
  const root = payload?.result ?? payload ?? null;
  return root && typeof root === "object" && !Array.isArray(root) ? root : {};
}

function normalizeMetadataForDisplay(value) {
  if (value == null) return "";

  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function typeLabel(type) {
  const raw = String(type || "").trim().toLowerCase();
  if (!raw) return "Activity";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
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

function MaybeDetailItem({ show, ...props }) {
  if (!show) return null;
  return <DetailItem {...props} />;
}

export default function HederaHtsDetailPage() {
  const { transactionId: routeTransactionId = "" } = useParams();

  const {
    isLoading: appLoading,
    org,
    membership,
    refreshAppContext,
  } = useAppContext();

  const [detail, setDetail] = React.useState({});
  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");

  const decodedTransactionId = React.useMemo(() => {
    try {
      return decodeURIComponent(String(routeTransactionId || ""));
    } catch {
      return String(routeTransactionId || "");
    }
  }, [routeTransactionId]);

  const loadPage = React.useCallback(async () => {
    if (!decodedTransactionId) {
      setPageError("Transaction id is missing.");
      setDetail({});
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setPageError("");

    try {
      const payload = await fetchJsonOrThrow(
        `/v1/hedera/hts/transactions/${encodeURIComponent(decodedTransactionId)}`
      );
      setDetail(normalizeDetailEnvelope(payload));
    } catch (err) {
      setDetail({});
      setPageError(err?.message || "Failed to load HTS transaction detail.");
    } finally {
      setIsLoading(false);
    }
  }, [decodedTransactionId]);

  React.useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const resolvedTransactionId = htsTransactionIdOf(detail) || decodedTransactionId || "Unknown";
  const tokenId = htsTokenIdOf(detail);
  const accountId = htsAccountIdOf(detail);
  const payerAccountId = htsPayerAccountIdOf(detail);
  const type = htsTypeOf(detail);
  const status = htsStatusOf(detail);
  const mirrorVerified = htsMirrorVerified(detail);
  const symbol = htsSymbolOf(detail);
  const name = htsNameOf(detail);
  const serial = htsSerialOf(detail);
  const observedAt = htsBestObservedAtOf(detail);
  const title = htsTitleOf(detail, "HTS transaction");
  const batchGroupId = htsBatchGroupIdOf(detail);
  const batchCount = htsBatchCountOf(detail);
  const memo = htsMemoOf(detail);
  const metadataText = normalizeMetadataForDisplay(detail?.metadata);
  const hasMetadata =
    detail?.metadata != null &&
    !(
      typeof detail.metadata === "object" &&
      !Array.isArray(detail.metadata) &&
      Object.keys(detail.metadata).length === 0
    );
  const isTenantAdmin = String(membership?.role || "") === "tenant_admin";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Link to="/app/hedera" className="hover:text-foreground/80">
              Hedera
            </Link>
            <span>/</span>
            <Link to="/app/hedera/hts" className="hover:text-foreground/80">
              HTS Activity
            </Link>
            <span>/</span>
            <span className="max-w-[260px] truncate">{resolvedTransactionId}</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            HTS Transaction Detail
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Review transaction identity, token context, mirror status, timing, and attached metadata for this HTS record.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/app/hedera/hts"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 text-sm font-medium text-foreground/90 transition-colors hover:border-border hover:bg-card/35"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to HTS Activity
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

          {resolvedTransactionId ? (
            <HashscanButton
              id={resolvedTransactionId}
              label="HashScan"
              size="sm"
              title="Open transaction in HashScan"
            />
          ) : null}
        </div>
      </div>

      {pageError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {pageError}
        </div>
      ) : null}

      <EntitySection
        title="Transaction context"
        description="The selected HTS record in the current organization context."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Coins className="h-3.5 w-3.5" />
              Record
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground/90">
              {isLoading ? "Loading..." : shortValue(resolvedTransactionId, 14, 10)}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {typeLabel(type)}
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
                hasAnchor={Boolean(resolvedTransactionId)}
                mirrorVerified={mirrorVerified}
              />
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              {mirrorVerified ? "Mirror confirmation is visible." : "Mirror confirmation is not yet visible."}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="outline">{typeLabel(type)}</Badge>
          <Badge variant="outline">{status}</Badge>
          <Badge variant={mirrorVerified ? "success" : "warn"}>
            {mirrorVerified ? "mirror verified" : "mirror pending"}
          </Badge>
          <Badge variant={tokenId ? "outline" : "warn"}>
            token {tokenId ? "present" : "missing"}
          </Badge>
          <Badge variant={accountId ? "outline" : "warn"}>
            account {accountId ? "present" : "missing"}
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
              <Coins className="h-3.5 w-3.5" />
              Token
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : title || "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Token identity associated with this transaction.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <Hash className="h-3.5 w-3.5" />
              Serial
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : serial != null ? serial.toLocaleString() : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Present for serial-specific token activity.
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
              Current mirror confirmation state for this record.
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
              Best available timestamp for this transaction.
            </div>
          </CardContent>
        </Card>
      </div>

      <EntitySection
        title="Record summary"
        description="Transaction identity, token linkage, and lifecycle details."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-4">
            <DetailItem
              label="Transaction id"
              value={resolvedTransactionId}
              mono
              copyValue={resolvedTransactionId}
            />

            <DetailItem
              label="Token id"
              value={tokenId}
              mono
              copyValue={tokenId}
            />

            <DetailItem
              label="Type"
              value={typeLabel(type)}
            />

            <DetailItem
              label="Status"
              value={status}
            />

            <DetailItem
              label="Account id"
              value={accountId}
              mono
              copyValue={accountId}
            />

            <DetailItem
              label="Payer account id"
              value={payerAccountId}
              mono
              copyValue={payerAccountId}
            />
          </div>

          <div className="space-y-4">
            <MaybeDetailItem
              show={Boolean(name)}
              label="Token name"
              value={name}
            />

            <MaybeDetailItem
              show={Boolean(symbol)}
              label="Token symbol"
              value={symbol}
            />

            <MaybeDetailItem
              show={serial != null}
              label="Serial number"
              value={String(serial)}
            />

            <MaybeDetailItem
              show={Boolean(memo)}
              label="Memo"
              value={memo}
              copyValue={memo}
            />

            <MaybeDetailItem
              show={batchCount != null}
              label="Operation count"
              value={String(batchCount)}
            />

            <MaybeDetailItem
              show={Boolean(batchGroupId)}
              label="Batch group id"
              value={batchGroupId}
              mono
              copyValue={batchGroupId}
            />
          </div>
        </div>
      </EntitySection>

      <EntitySection
        title="Timing and lifecycle"
        description="Timestamp details attached to this transaction."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <DetailItem
            label="Created at"
            value={detail?.created_at ? `${formatDateTime(detail.created_at, true)} • ${formatRelative(detail.created_at)}` : "—"}
          />

          <DetailItem
            label="Updated at"
            value={detail?.updated_at ? `${formatDateTime(detail.updated_at, true)} • ${formatRelative(detail.updated_at)}` : "—"}
          />

          <DetailItem
            label="Mirror verified at"
            value={detail?.mirror_verified_at ? `${formatDateTime(detail.mirror_verified_at, true)} • ${formatRelative(detail.mirror_verified_at)}` : "—"}
          />

        </div>
      </EntitySection>

      {hasMetadata ? (
        <EntitySection
          title="Attached metadata"
          description="Additional structured metadata returned with this transaction."
        >
          <Card className="border-border/60 bg-card/35 backdrop-blur">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Metadata</CardTitle>
                  <CardDescription>
                    Displayed as read-only JSON.
                  </CardDescription>
                </div>

                <CopyIconButton
                  text={metadataText}
                  label="Copy metadata"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 rounded-md p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                />
              </div>
            </CardHeader>

            <CardContent>
              <pre className="overflow-x-auto rounded-xl border border-border/60 bg-card/25 p-4 text-xs leading-6 text-foreground/90 whitespace-pre-wrap break-all">
                {metadataText}
              </pre>
            </CardContent>
          </Card>
        </EntitySection>
      ) : null}

      <EntitySection
        title="Next steps"
        description="Continue from this transaction into related product and network views."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Coins className="h-4 w-4" />
              Follow the token
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Open certificates for the associated token to inspect product-facing proof assets and ownership.
            </p>
            <div className="mt-3">
              {tokenId ? (
                <Link
                  to={`/app/certificates?token_id=${encodeURIComponent(tokenId)}`}
                  className="text-sm font-medium text-foreground/90 underline underline-offset-4"
                >
                  Open certificates
                </Link>
              ) : (
                <div className="text-sm text-muted-foreground">Token id unavailable.</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <ShieldCheck className="h-4 w-4" />
              Review trust status
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Use this record to confirm transaction identity, token linkage, and mirror posture before moving into downstream proof flows.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Radio className="h-4 w-4" />
              Open network view
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Open the linked transaction in HashScan to compare the workspace record with the public network view.
            </p>
            <div className="mt-3">
              {resolvedTransactionId ? (
                <HashscanButton
                  id={resolvedTransactionId}
                  label="Open in HashScan"
                  size="sm"
                  title="Open transaction in HashScan"
                />
              ) : (
                <div className="text-sm text-muted-foreground">Transaction id unavailable.</div>
              )}
            </div>
          </div>
        </div>
      </EntitySection>
    </div>
  );
}