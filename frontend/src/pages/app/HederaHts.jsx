import React from "react";
import { Link } from "react-router-dom";
import {
  Coins,
  Building2,
  RefreshCw,
  Search,
  ShieldCheck,
  ScrollText,
  Radio,
  ArrowRight,
  Hash,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import MirrorStatusPill from "@/components/hedera/mirror-status-pill.jsx";
import HashscanButton from "@/components/hedera/hashscan-button.jsx";
import { HederaActionLink } from "@/components/hedera/hedera-overview-ui.jsx";
import {
  formatDateTime,
  formatRelative,
  htsTypeOf,
  htsTokenIdOf,
  htsTransactionIdOf,
  htsAccountIdOf,
  htsCreatedAtOf,
  htsMirrorVerified,
  htsStatusOf,
  htsSymbolOf,
  htsNameOf,
  htsSerialOf,
  htsDetailPath,
  htsTitleOf,
} from "@/components/hedera/hedera-ui-helpers.js";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";

const PAGE_SIZE = 25;

function normalizeHtsEnvelope(payload) {
  const root = payload?.result ?? payload ?? null;
  return {
    rows: Array.isArray(root?.rows) ? root.rows : [],
    total: Number(root?.total ?? 0) || 0,
    limit: Number(root?.limit ?? 0) || 0,
    offset: Number(root?.offset ?? 0) || 0,
  };
}

function rowIdentity(row, fallbackIndex = 0) {
  return [
    htsTransactionIdOf(row) || "",
    htsTokenIdOf(row) || "",
    htsTypeOf(row) || "",
    htsCreatedAtOf(row) || "",
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

function tokenOptionsFromRows(rows) {
  const map = new Map();

  for (const row of rows) {
    const tokenId = String(htsTokenIdOf(row) || "").trim();
    if (!tokenId) continue;

    const symbol = String(htsSymbolOf(row) || "").trim();
    const name = String(htsNameOf(row) || "").trim();

    const labelParts = [tokenId];
    if (symbol) labelParts.push(symbol);
    else if (name) labelParts.push(name);

    map.set(tokenId, labelParts.join(" • "));
  }

  return [...map.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function sortRows(rows, sortKey) {
  const copy = [...rows];

  copy.sort((a, b) => {
    if (sortKey === "type") {
      return htsTypeOf(a).localeCompare(htsTypeOf(b));
    }

    if (sortKey === "token") {
      return String(htsTokenIdOf(a) || "").localeCompare(String(htsTokenIdOf(b) || ""));
    }

    if (sortKey === "status") {
      return htsStatusOf(a).localeCompare(htsStatusOf(b));
    }

    const ams = Date.parse(htsCreatedAtOf(a) || "") || 0;
    const bms = Date.parse(htsCreatedAtOf(b) || "") || 0;
    return bms - ams;
  });

  return copy;
}

function typeLabel(type) {
  const raw = String(type || "").trim().toLowerCase();
  if (!raw) return "Activity";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/25 p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-border/60 bg-card/35">
        <Coins className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground/90">
        No visible HTS activity
      </h3>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
        No token-side activity is currently visible in this workspace.
      </p>
    </div>
  );
}

function HtsRow({ row }) {
  const type = htsTypeOf(row);
  const tokenId = htsTokenIdOf(row);
  const transactionId = htsTransactionIdOf(row);
  const accountId = htsAccountIdOf(row);
  const createdAt = htsCreatedAtOf(row);
  const mirrorVerified = htsMirrorVerified(row);
  const status = htsStatusOf(row);
  const symbol = htsSymbolOf(row);
  const name = htsNameOf(row);
  const serial = htsSerialOf(row);
  const title = htsTitleOf(row, "HTS transaction");

  return (
    <Card className="border-border/60 bg-card/35 backdrop-blur">
      <CardContent className="p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-base font-semibold text-foreground/90">
                  {title}
                </div>
                <Badge variant="outline">{typeLabel(type)}</Badge>
                <Badge variant="outline">{status}</Badge>
              </div>

              <div className="text-sm text-muted-foreground">
                Hedera Token Service activity visible in the current organization context.
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Token id
                </div>
                <div className="mt-1 font-mono text-xs break-all text-foreground/90">
                  {tokenId || "—"}
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Transaction id
                </div>
                <div className="mt-1 font-mono text-xs break-all text-foreground/90">
                  {transactionId || "—"}
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Account
                </div>
                <div className="mt-1 font-mono text-xs break-all text-foreground/90">
                  {accountId || "—"}
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Observed
                </div>
                <div className="mt-1 text-sm text-foreground/90">
                  {createdAt ? formatRelative(createdAt) : "—"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(createdAt)}
                </div>
              </div>
            </div>

            {name || symbol || serial != null ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Token name
                  </div>
                  <div className="mt-1 text-sm text-foreground/90">
                    {name || "—"}
                  </div>
                </div>

                <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Token symbol
                  </div>
                  <div className="mt-1 text-sm text-foreground/90">
                    {symbol || "—"}
                  </div>
                </div>

                <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Serial number
                  </div>
                  <div className="mt-1 text-sm text-foreground/90">
                    {serial != null ? serial.toLocaleString() : "—"}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 xl:justify-end">
            <MirrorStatusPill
              hasAnchor={Boolean(transactionId)}
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

            {transactionId ? (
              <HederaActionLink to={htsDetailPath(transactionId)}>
                Transaction detail
              </HederaActionLink>
            ) : null}

            {tokenId ? (
              <Link
                to={`/app/certificates?token_id=${encodeURIComponent(tokenId)}`}
                className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 py-2 text-sm font-medium text-foreground/90 transition-colors hover:border-border hover:bg-card/35"
              >
                Certificates
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function HederaHtsPage() {
  const {
    isLoading: appLoading,
    org,
    membership,
    refreshAppContext,
  } = useAppContext();

  const [rows, setRows] = React.useState([]);
  const [meta, setMeta] = React.useState({ total: 0, limit: PAGE_SIZE, offset: 0 });
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [pageError, setPageError] = React.useState("");

  const [query, setQuery] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState("all");
  const [tokenFilter, setTokenFilter] = React.useState("all");
  const [mirrorFilter, setMirrorFilter] = React.useState("all");
  const [sortKey, setSortKey] = React.useState("recent");

  const fetchPage = React.useCallback(async (offset = 0) => {
    const payload = await fetchJsonOrThrow(`/v1/hedera/hts?limit=${PAGE_SIZE}&offset=${offset}`);
    return normalizeHtsEnvelope(payload);
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
      setPageError(err?.message || "Failed to load HTS activity.");
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
      setPageError(err?.message || "Failed to load additional HTS activity.");
    } finally {
      setIsLoadingMore(false);
    }
  }, [fetchPage, isLoadingMore, meta?.total, rows.length]);

  React.useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const tokenOptions = React.useMemo(() => tokenOptionsFromRows(rows), [rows]);

  const filteredRows = React.useMemo(() => {
    const q = String(query || "").trim().toLowerCase();

    const base = rows.filter((row) => {
      const type = String(htsTypeOf(row) || "").toLowerCase();
      const tokenId = String(htsTokenIdOf(row) || "").toLowerCase();
      const txId = String(htsTransactionIdOf(row) || "").toLowerCase();
      const accountId = String(htsAccountIdOf(row) || "").toLowerCase();
      const symbol = String(htsSymbolOf(row) || "").toLowerCase();
      const name = String(htsNameOf(row) || "").toLowerCase();
      const status = String(htsStatusOf(row) || "").toLowerCase();
      const mirrorVerified = htsMirrorVerified(row);

      const matchesQuery =
        !q ||
        type.includes(q) ||
        tokenId.includes(q) ||
        txId.includes(q) ||
        accountId.includes(q) ||
        symbol.includes(q) ||
        name.includes(q) ||
        status.includes(q);

      const matchesType =
        typeFilter === "all" ? true : type === String(typeFilter).toLowerCase();

      const matchesToken =
        tokenFilter === "all"
          ? true
          : tokenId === String(tokenFilter).toLowerCase();

      const matchesMirror =
        mirrorFilter === "all"
          ? true
          : mirrorFilter === "verified"
            ? mirrorVerified === true
            : mirrorVerified === false;

      return matchesQuery && matchesType && matchesToken && matchesMirror;
    });

    return sortRows(base, sortKey);
  }, [rows, query, typeFilter, tokenFilter, mirrorFilter, sortKey]);

  const totalRows = Number(meta?.total ?? rows.length ?? 0) || 0;
  const loadedRows = rows.length;
  const visibleRows = filteredRows.length;
  const verifiedCount = rows.filter((row) => htsMirrorVerified(row)).length;
  const pendingCount = rows.filter((row) => !htsMirrorVerified(row)).length;
  const distinctTokenCount = new Set(rows.map((row) => htsTokenIdOf(row)).filter(Boolean)).size;
  const nftRows = rows.filter((row) => htsSerialOf(row) != null).length;
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
            <span>HTS Activity</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            HTS Activity
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Review token-side activity, confirm mirror status, and move from network transactions into certificates and detail views.
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
        title="HTS workspace context"
        description="Token activity visible in the current organization context."
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
              <Coins className="h-3.5 w-3.5" />
              Activity visibility
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground/90">
              {totalRows > 0 ? "Visible" : "Limited"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {totalRows} HTS row{totalRows === 1 ? "" : "s"} returned in this workspace
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
              Network activity and product-facing certificate paths are available from this surface.
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant={totalRows > 0 ? "success" : "warn"}>
            hts {totalRows > 0 ? "visible" : "not visible"}
          </Badge>
          <Badge variant={verifiedCount > 0 ? "success" : "outline"}>
            mirror verified {verifiedCount}
          </Badge>
          <Badge variant={pendingCount > 0 ? "warn" : "outline"}>
            mirror pending {pendingCount}
          </Badge>
          <Badge variant="outline">
            tokens represented {distinctTokenCount}
          </Badge>
          <Badge variant={nftRows > 0 ? "info" : "outline"}>
            nft-linked rows {nftRows}
          </Badge>
        </div>
      </EntitySection>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <Coins className="h-3.5 w-3.5" />
              Total HTS rows
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : totalRows.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Visible token-side records returned by the authenticated workspace.
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
              Records currently showing mirror confirmation.
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
              Records still awaiting visible mirror confirmation here.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <Hash className="h-3.5 w-3.5" />
              Tokens represented
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {isLoading ? "…" : distinctTokenCount.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm text-muted-foreground">
              Distinct tokens represented in the current HTS slice.
            </div>
          </CardContent>
        </Card>
      </div>

      <EntitySection
        title="Browse HTS activity"
        description="Search, filter, and sort visible HTS records."
      >
        <div className="grid gap-3 xl:grid-cols-[1.4fr,180px,220px,220px,180px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by token, symbol, tx id, account, type, or status"
              className="pl-10"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-10 rounded-xl border border-border/60 bg-card/35 px-3 text-sm text-foreground outline-none"
          >
            <option value="all">All types</option>
            <option value="create">Create</option>
            <option value="mint">Mint</option>
            <option value="burn">Burn</option>
            <option value="transfer">Transfer</option>
            <option value="associate">Associate</option>
          </select>

          <select
            value={tokenFilter}
            onChange={(e) => setTokenFilter(e.target.value)}
            className="h-10 rounded-xl border border-border/60 bg-card/35 px-3 text-sm text-foreground outline-none"
          >
            <option value="all">All tokens</option>
            {tokenOptions.map((token) => (
              <option key={token.value} value={token.value}>
                {token.label}
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
            <option value="type">Sort by type</option>
            <option value="token">Sort by token</option>
            <option value="status">Sort by status</option>
          </select>
        </div>

        <div className="mt-4 text-sm text-muted-foreground">
          Showing {visibleRows.toLocaleString()} filtered row{visibleRows === 1 ? "" : "s"} from {loadedRows.toLocaleString()} loaded of {totalRows.toLocaleString()} total.
        </div>
      </EntitySection>

      <EntitySection
        title="Visible HTS rows"
        description="Each row represents token-side activity recorded through Hedera."
      >
        {isLoading ? (
          <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
            Loading HTS activity...
          </div>
        ) : filteredRows.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="space-y-4">
              {filteredRows.map((row, index) => (
                <HtsRow
                  key={rowIdentity(row, index)}
                  row={row}
                />
              ))}
            </div>

            <div className="mt-5 flex flex-col items-center gap-3">
              <div className="text-sm text-muted-foreground">
                Loaded {loadedRows.toLocaleString()} of {totalRows.toLocaleString()} HTS row{totalRows === 1 ? "" : "s"}.
              </div>

              {hasMoreRows ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void loadMore();
                  }}
                  disabled={isLoading || isLoadingMore}
                >
                  {isLoadingMore ? "Loading..." : "Load more HTS activity"}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </EntitySection>

      <EntitySection
        title="Explore from each record"
        description="Use HTS activity to move between network evidence and product-facing ownership views."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Coins className="h-4 w-4" />
              Review token activity
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Each row shows a token-side event with identity, timing, and mirror posture.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <ShieldCheck className="h-4 w-4" />
              Confirm network state
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Open HashScan from any transaction to compare the on-chain transaction with the workspace view.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <ArrowRight className="h-4 w-4" />
              Continue into certificates
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Move from token activity into certificates to inspect user-facing proof assets and ownership.
            </p>
          </div>
        </div>
      </EntitySection>
    </div>
  );
}