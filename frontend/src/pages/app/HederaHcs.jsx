import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Building2,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Waypoints,
  ScrollText,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import LoadMoreButton from "@/components/base/load-more-button.jsx";
import { Input } from "@/components/base/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import MirrorStatusPill from "@/components/hedera/mirror-status-pill.jsx";
import HashscanButton from "@/components/hedera/hashscan-button.jsx";
import { HederaActionLink } from "@/components/hedera/hedera-overview-ui.jsx";
import {
  formatDateTime,
  formatRelative,
  topicDetailPath,
  hcsTopicNameOf,
  hcsMessageIdOf,
  hcsTransactionIdOf,
  hcsCreatedAtOf,
  hcsStatusOf,
  hcsMirrorVerified,
  hcsBestDetailPath,
  hederaDecryptPath,
} from "@/components/hedera/hedera-ui-helpers.js";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";

const PAGE_SIZE = 25;

function normalizeHcsEnvelope(payload) {
  const root = payload?.result ?? payload ?? null;
  return {
    rows: Array.isArray(root?.rows) ? root.rows : [],
    total: Number(root?.total ?? 0) || 0,
    limit: Number(root?.limit ?? 0) || 0,
    offset: Number(root?.offset ?? 0) || 0,
  };
}

function topicIdOf(row) {
  return row?.topic_id || null;
}

function dataHashOf(row) {
  return row?.data_hash || null;
}

function rowIdentity(row, fallbackIndex = 0) {
  return [
    hcsMessageIdOf(row) || "",
    hcsTransactionIdOf(row) || "",
    hcsCreatedAtOf(row) || "",
    hcsTopicNameOf(row) || "",
    String(fallbackIndex),
  ].join("|");
}

function mergeUniqueRows(existingRows, nextRows) {
  const merged = [...existingRows];
  const seen = new Set(existingRows.map((row, index) => rowIdentity(row, index)));

  for (let i = 0; i < nextRows.length; i += 1) {
    const row = nextRows[i];
    const key = rowIdentity(row, i);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(row);
    }
  }

  return merged;
}

function topicOptionsFromRows(rows) {
  const set = new Set();
  for (const row of rows) {
    const name = String(hcsTopicNameOf(row) || "").trim();
    if (name) set.add(name);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function sortRows(rows, sortKey) {
  const copy = [...rows];

  copy.sort((a, b) => {
    if (sortKey === "topic") {
      return hcsTopicNameOf(a).localeCompare(hcsTopicNameOf(b));
    }

    if (sortKey === "status") {
      return hcsStatusOf(a).localeCompare(hcsStatusOf(b));
    }

    const ams = Date.parse(hcsCreatedAtOf(a) || "") || 0;
    const bms = Date.parse(hcsCreatedAtOf(b) || "") || 0;
    return bms - ams;
  });

  return copy;
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/25 p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-border/60 bg-card/35">
        <Radio className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground/90">
        No visible HCS activity
      </h3>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
        No actor-visible HCS records are currently available in this workspace.
      </p>
    </div>
  );
}

function HcsRow({ row }) {
  const topicName = hcsTopicNameOf(row);
  const messageId = hcsMessageIdOf(row);
  const transactionId = hcsTransactionIdOf(row);
  const topicId = topicIdOf(row);
  const createdAt = hcsCreatedAtOf(row);
  const status = hcsStatusOf(row);
  const mirrorVerified = hcsMirrorVerified(row);
  const dataHash = dataHashOf(row);
  const detailPath = hcsBestDetailPath(row);
  const decryptPath = messageId
    ? hederaDecryptPath({ messageId, mode: "decrypt_and_verify" })
    : transactionId
      ? hederaDecryptPath({ transactionId, mode: "decrypt_and_verify" })
      : "";

  return (
    <Card className="border-border/60 bg-card/35 backdrop-blur">
      <CardContent className="p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-base font-semibold text-foreground/90">
                  {topicName}
                </div>
                <Badge variant="outline">{status}</Badge>
              </div>

              <div className="text-sm text-muted-foreground">
                Anchored HCS activity visible in the authenticated workspace.
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Message id
                </div>
                <div className="mt-1 font-mono text-xs break-all text-foreground/90">
                  {messageId || "Unavailable"}
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Transaction id
                </div>
                <div className="mt-1 font-mono text-xs break-all text-foreground/90">
                  {transactionId || "Unavailable"}
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Topic id
                </div>
                <div className="mt-1 font-mono text-xs break-all text-foreground/90">
                  {topicId || "Unavailable"}
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Observed
                </div>
                <div className="mt-1 text-sm text-foreground/90">
                  {createdAt ? formatRelative(createdAt) : "No timestamp"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(createdAt)}
                </div>
              </div>
            </div>

            {dataHash ? (
              <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Data hash
                </div>
                <div className="mt-1 font-mono text-xs break-all text-foreground/90">
                  {dataHash}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 xl:justify-end">
            <MirrorStatusPill
              hasAnchor={Boolean(messageId || transactionId)}
              mirrorVerified={mirrorVerified}
              size="sm"
            />

            {transactionId ? (
              <HashscanButton
                id={transactionId}
                label="HashScan"
                size="sm"
                title="Open transaction in HashScan"
              />
            ) : null}

            {detailPath ? (
              <HederaActionLink to={detailPath}>
                HCS detail
              </HederaActionLink>
            ) : null}

            {decryptPath ? (
              <HederaActionLink to={decryptPath}>
                Decrypt & verify
              </HederaActionLink>
            ) : null}

            <HederaActionLink to={topicDetailPath(row)}>
              Topic detail
            </HederaActionLink>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function HederaHcsPage() {
  const [searchParams] = useSearchParams();

  const {
    isLoading: appLoading,
    org,
    membership,
    refreshAppContext,
  } = useAppContext();

  const initialTopicFilter = React.useMemo(() => {
    const raw = String(searchParams.get("topic_name") || "").trim();
    return raw || "all";
  }, [searchParams]);

  const [rows, setRows] = React.useState([]);
  const [meta, setMeta] = React.useState({ total: 0, limit: PAGE_SIZE, offset: 0 });
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [pageError, setPageError] = React.useState("");

  const [query, setQuery] = React.useState("");
  const [topicFilter, setTopicFilter] = React.useState(initialTopicFilter);
  const [mirrorFilter, setMirrorFilter] = React.useState("all");
  const [sortKey, setSortKey] = React.useState("recent");

  React.useEffect(() => {
    setTopicFilter(initialTopicFilter);
  }, [initialTopicFilter]);

  const fetchPage = React.useCallback(async (offset = 0) => {
    const payload = await fetchJsonOrThrow(`/v1/hedera/hcs?limit=${PAGE_SIZE}&offset=${offset}`);
    return normalizeHcsEnvelope(payload);
  }, []);

  const loadPage = React.useCallback(async () => {
    setIsLoading(true);
    setPageError("");

    try {
      const normalized = await fetchPage(0);
      setRows(normalized.rows);
      setMeta({
        total: normalized.total,
        limit: normalized.limit || PAGE_SIZE,
        offset: normalized.offset,
      });
    } catch (err) {
      setRows([]);
      setMeta({ total: 0, limit: PAGE_SIZE, offset: 0 });
      setPageError(err?.message || "Failed to load HCS activity.");
    } finally {
      setIsLoading(false);
    }
  }, [fetchPage]);

  const loadMore = React.useCallback(async () => {
    if (isLoadingMore) return;
    if (rows.length >= Number(meta?.total ?? 0)) return;

    setIsLoadingMore(true);
    setPageError("");

    try {
      const normalized = await fetchPage(rows.length);

      setRows((prev) => mergeUniqueRows(prev, normalized.rows));
      setMeta((prev) => ({
        total: Number(normalized.total ?? prev.total ?? 0) || 0,
        limit: Number(normalized.limit ?? prev.limit ?? PAGE_SIZE) || PAGE_SIZE,
        offset: Number(normalized.offset ?? rows.length) || rows.length,
      }));
    } catch (err) {
      setPageError(err?.message || "Failed to load additional HCS activity.");
    } finally {
      setIsLoadingMore(false);
    }
  }, [fetchPage, isLoadingMore, meta?.total, rows.length]);

  React.useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const topicOptions = React.useMemo(() => topicOptionsFromRows(rows), [rows]);

  const filteredRows = React.useMemo(() => {
    const q = String(query || "").trim().toLowerCase();

    const base = rows.filter((row) => {
      const topicName = String(hcsTopicNameOf(row) || "").toLowerCase();
      const messageId = String(hcsMessageIdOf(row) || "").toLowerCase();
      const txId = String(hcsTransactionIdOf(row) || "").toLowerCase();
      const topicId = String(topicIdOf(row) || "").toLowerCase();
      const status = String(hcsStatusOf(row) || "").toLowerCase();
      const mirrorVerified = hcsMirrorVerified(row);

      const matchesQuery =
        !q ||
        topicName.includes(q) ||
        messageId.includes(q) ||
        txId.includes(q) ||
        topicId.includes(q) ||
        status.includes(q);

      const matchesTopic =
        topicFilter === "all"
          ? true
          : topicName === String(topicFilter).trim().toLowerCase();

      const matchesMirror =
        mirrorFilter === "all"
          ? true
          : mirrorFilter === "verified"
            ? mirrorVerified === true
            : mirrorVerified === false;

      return matchesQuery && matchesTopic && matchesMirror;
    });

    return sortRows(base, sortKey);
  }, [rows, query, topicFilter, mirrorFilter, sortKey]);

  const totalRows = Number(meta?.total ?? rows.length ?? 0) || 0;
  const loadedRows = rows.length;
  const visibleRows = filteredRows.length;
  const verifiedCount = rows.filter((row) => hcsMirrorVerified(row)).length;
  const pendingCount = rows.filter((row) => !hcsMirrorVerified(row)).length;
  const topicCount = topicOptions.length;
  const hasMoreRows = loadedRows < totalRows;
  const isTenantAdmin = String(membership?.role || "") === "tenant_admin";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Link to="/app/hedera" className="hover:text-foreground/80">
              Hedera
            </Link>
            <span>/</span>
            <span>HCS Activity</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            HCS Activity
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Review actor-visible HCS records, inspect mirror posture, and move from message activity into detail and verification flows.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </div>

      {pageError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {pageError}
        </div>
      ) : null}

      <EntitySection
        title="HCS workspace context"
        description="The current organization context and actor-visible HCS surface."
      >
        <div className="grid gap-4 lg:grid-cols-3">
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
              <Radio className="h-3.5 w-3.5" />
              Activity posture
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground/90">
              {totalRows > 0 ? "Visible" : "Limited"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {totalRows} HCS row{totalRows === 1 ? "" : "s"} available in this actor context
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Access posture
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground/90">
              {isTenantAdmin ? "Admin-capable" : "Read-focused"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              This page is optimized for investigating message history and verification state.
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant={totalRows > 0 ? "success" : "warn"}>
            hcs {totalRows > 0 ? "visible" : "not visible"}
          </Badge>
          <Badge variant={verifiedCount > 0 ? "success" : "outline"}>
            mirror verified {verifiedCount}
          </Badge>
          <Badge variant={pendingCount > 0 ? "warn" : "outline"}>
            mirror pending {pendingCount}
          </Badge>
          <Badge variant="outline">
            topics represented {topicCount}
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
              <Radio className="h-3.5 w-3.5" />
              Total HCS rows
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : totalRows.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Visible HCS activity rows returned by the actor-scoped workspace.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <ShieldCheck className="h-3.5 w-3.5" />
              Mirror verified
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : verifiedCount.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              HCS rows currently showing mirror confirmation.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <ScrollText className="h-3.5 w-3.5" />
              Mirror pending
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : pendingCount.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Rows awaiting visible mirror confirmation on this surface.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <Waypoints className="h-3.5 w-3.5" />
              Topics represented
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : topicCount.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Distinct visible topic channels represented in this HCS slice.
            </div>
          </CardContent>
        </Card>
      </div>

      <EntitySection
        title="Browse HCS activity"
        description="Search, filter, and sort actor-visible HCS records."
      >
        <div className="grid gap-3 xl:grid-cols-[1.4fr,220px,220px,220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by topic, message id, transaction id, or status"
              className="pl-10"
            />
          </div>

          <select
            value={topicFilter}
            onChange={(e) => setTopicFilter(e.target.value)}
            className="h-10 rounded-xl border border-border/60 bg-card/35 px-3 text-sm text-foreground outline-none"
          >
            <option value="all">All topics</option>
            {topicOptions.map((topic) => (
              <option key={topic} value={topic}>
                {topic}
              </option>
            ))}
          </select>

          <select
            value={mirrorFilter}
            onChange={(e) => setMirrorFilter(e.target.value)}
            className="h-10 rounded-xl border border-border/60 bg-card/35 px-3 text-sm text-foreground outline-none"
          >
            <option value="all">All mirror states</option>
            <option value="verified">Mirror verified</option>
            <option value="pending">Mirror pending</option>
          </select>

          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            className="h-10 rounded-xl border border-border/60 bg-card/35 px-3 text-sm text-foreground outline-none"
          >
            <option value="recent">Sort by recent</option>
            <option value="topic">Sort by topic</option>
            <option value="status">Sort by status</option>
          </select>
        </div>

        <div className="mt-4 text-sm text-muted-foreground">
          Showing {visibleRows.toLocaleString()} filtered row{visibleRows === 1 ? "" : "s"} from {loadedRows.toLocaleString()} loaded of {totalRows.toLocaleString()} total.
        </div>
      </EntitySection>

      <EntitySection
        title="Visible HCS rows"
        description="Actor-visible message activity anchored through Hedera."
      >
        {isLoading ? (
          <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
            Loading HCS activity...
          </div>
        ) : filteredRows.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="space-y-4">
              {filteredRows.map((row, index) => (
                <HcsRow
                  key={rowIdentity(row, index)}
                  row={row}
                />
              ))}
            </div>

            <div className="mt-5 flex flex-col items-center gap-3">
              <div className="text-sm text-muted-foreground">
                Loaded {loadedRows.toLocaleString()} of {totalRows.toLocaleString()} HCS row{totalRows === 1 ? "" : "s"}.
              </div>

              {hasMoreRows ? (
                <LoadMoreButton
                  onClick={() => {
                    void loadMore();
                  }}
                  loading={isLoadingMore}
                  disabled={isLoading || isLoadingMore}
                  label="Load more HCS activity"
                />
              ) : null}
            </div>
          </>
        )}
      </EntitySection>
    </div>
  );
}