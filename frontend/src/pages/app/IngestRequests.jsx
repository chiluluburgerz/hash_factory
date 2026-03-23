import React from "react";
import { Link } from "react-router-dom";
import {
  RefreshCw,
  Search,
  ListTree,
  Link2,
  ShieldCheck,
  Layers3,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  Clock3,
  Radio,
  CheckCircle2,
  ScrollText,
  X,
  Filter,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import EntitySummaryCard from "@/components/entities/entity-summary-card.jsx";
import EntityKeyValueGrid from "@/components/entities/entity-key-value-grid.jsx";
import JsonBlock from "@/components/entities/json-block.jsx";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/base/table.jsx";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";
import {
  deriveIngestPosture,
  normalizeAnchorRequestsEnvelope,
  extractApiErrorMessage,
  formatDateTime,
  formatRelative,
  shortText,
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
  matchesRequestQuery,
  getRequestUpdatedAt,
} from "@/lib/ingestUtils.js";

const STATUS_FILTERS = [
  ["all", "All"],
  ["pending", "Pending"],
  ["publishing", "Publishing"],
  ["published", "Published"],
  ["confirmed", "Confirmed"],
  ["failed", "Failed"],
  ["cancelled", "Cancelled"],
];

const KIND_FILTERS = [
  ["all", "All"],
  ["root", "Root"],
  ["custom", "Custom"],
];

function hasValue(value) {
  return !(value == null || value === "" || value === "—");
}

function compactItems(items) {
  return items.filter((item) => hasValue(item?.value));
}

function formatCount(value) {
  return value != null ? Number(value).toLocaleString() : null;
}

function RequestStatusBadge({ status }) {
  return <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>;
}

function RequestTrustBadge({ trust }) {
  return <Badge variant={trustVariant(trust)}>{trustLabel(trust)}</Badge>;
}

function RequestKindBadge({ kind }) {
  return <Badge variant={kindVariant(kind)}>{kindLabel(kind)}</Badge>;
}

function FilterChipGroup({ label, options, activeValue, onChange }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map(([value, chipLabel]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={activeValue === value ? "default" : "outline"}
            onClick={() => onChange(value)}
            className="h-8"
          >
            {chipLabel}
          </Button>
        ))}
      </div>
    </div>
  );
}

function RequestTableRow({ row, expandedRowId, onToggleExpanded }) {
  const requestId = getAnchorRequestId(row);
  const expanded = expandedRowId === requestId;
  const status = getAnchorStatus(row);
  const trust = getAnchorTrustState(row);
  const kind = getAnchorKind(row);
  const updatedAt = getRequestUpdatedAt(row);

  const isRootRequest = kind === "root";
  const isCustomRequest = kind === "custom";

  const requestIdentityItems = compactItems([
    { key: "id", label: "Request id", value: requestId || null, mono: true },
    { key: "proof_date", label: "Proof date", value: row?.proof_date || null },
    { key: "domain", label: "Domain", value: row?.domain || null, mono: true },
    { key: "anchor_kind", label: "Anchor kind", value: kindLabel(kind) },
    { key: "status", label: "Status", value: statusLabel(status) },
    { key: "trust", label: "Trust posture", value: trustLabel(trust) },
  ]);

  const boundMaterialItems = isRootRequest
    ? compactItems([
        { key: "root_id", label: "Root id", value: row?.root_id || null, mono: true },
        { key: "root_hash", label: "Root hash", value: row?.root_hash ? shortHash(row.root_hash) : null, mono: true },
        { key: "anchor_hash", label: "Anchor hash", value: row?.anchor_hash ? shortHash(row.anchor_hash) : null, mono: true },
      ])
    : compactItems([
        { key: "leaf_id", label: "Leaf id", value: row?.leaf_id || null, mono: true },
        { key: "leaf_hash", label: "Leaf hash", value: row?.leaf_hash ? shortHash(row.leaf_hash) : null, mono: true },
        { key: "payload_type", label: "Payload type", value: row?.payload_type || null },
        { key: "payload_bytes", label: "Payload bytes", value: formatCount(row?.payload_bytes) },
        { key: "payload_hash", label: "Payload hash", value: row?.payload_hash ? shortHash(row.payload_hash) : null, mono: true },
        { key: "anchor_hash", label: "Anchor hash", value: row?.anchor_hash ? shortHash(row.anchor_hash) : null, mono: true },
      ]);

  const trustLinkageItems = compactItems([
    { key: "hcs_topic_id", label: "Topic id", value: row?.hcs_topic_id || null, mono: true },
    { key: "hcs_transaction_id", label: "Transaction id", value: row?.hcs_transaction_id || null, mono: true },
    { key: "hcs_message_id", label: "Message id", value: row?.hcs_message_id || null, mono: true },
    { key: "published_at", label: "Published at", value: row?.published_at ? formatDateTime(row.published_at) : null },
    { key: "confirmed_at", label: "Confirmed at", value: row?.confirmed_at ? formatDateTime(row.confirmed_at) : null },
  ]);

  const diagnosticsItems = compactItems([
    {
      key: "attempt_count",
      label: "Attempt",
      value:
        row?.attempt_count != null && Number.isFinite(Number(row.attempt_count))
          ? String(Number(row.attempt_count) + 1)
          : null,
    },
    { key: "retry_at", label: "Retry at", value: row?.retry_at ? formatDateTime(row.retry_at) : null },
    {
      key: "publishing_claimed_at",
      label: "Claimed at",
      value: row?.publishing_claimed_at ? formatDateTime(row.publishing_claimed_at) : null,
    },
    { key: "failed_at", label: "Failed at", value: row?.failed_at ? formatDateTime(row.failed_at) : null },
    { key: "cancelled_at", label: "Cancelled at", value: row?.cancelled_at ? formatDateTime(row.cancelled_at) : null },
    { key: "last_error_code", label: "Last error code", value: row?.last_error_code || null, mono: true },
  ]);

  const notesPayload = {
    reason: row?.reason || null,
    last_error: row?.last_error || null,
  };

  const hasNotes = Boolean(notesPayload.reason || notesPayload.last_error);

  return (
    <>
      <TableRow className="align-top">
        <TableCell className="w-[44px]">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-card/30 hover:bg-muted/30"
            onClick={() => onToggleExpanded(requestId)}
            aria-label={expanded ? "Collapse row" : "Expand row"}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </TableCell>

        <TableCell className="min-w-[280px]">
          <div>
            <Link
              to={`/app/ingest/requests/${encodeURIComponent(requestId)}`}
              className="text-sm font-semibold text-foreground/90 underline-offset-4 hover:underline"
            >
              {getAnchorLabel(row)}
            </Link>
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {shortText(requestId, 48)}
          </div>
        </TableCell>

        <TableCell className="min-w-[110px]">
          <RequestKindBadge kind={kind} />
        </TableCell>

        <TableCell className="min-w-[120px]">
          <RequestStatusBadge status={status} />
        </TableCell>

        <TableCell className="min-w-[120px]">
          <RequestTrustBadge trust={trust} />
        </TableCell>

        <TableCell className="min-w-[180px]">
          <div className="text-sm text-foreground/85">{row?.proof_date || "—"}</div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {shortText(row?.domain, 36)}
          </div>
        </TableCell>

        <TableCell className="min-w-[140px]">
          <div className="text-sm text-foreground/85">
            {updatedAt ? formatRelative(updatedAt) : "—"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatDateTime(updatedAt)}
          </div>
        </TableCell>
      </TableRow>

      {expanded ? (
        <TableRow>
          <TableCell colSpan={7} className="bg-card/20">
            <div className="grid gap-6 lg:grid-cols-2">
              <EntityKeyValueGrid
                title="Request identity"
                items={requestIdentityItems}
              />

              <EntityKeyValueGrid
                title="Bound material"
                items={boundMaterialItems}
              />
            </div>

            {(trustLinkageItems.length > 0 || diagnosticsItems.length > 0) ? (
              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                {trustLinkageItems.length > 0 ? (
                  <EntityKeyValueGrid
                    title="Trust linkage"
                    items={trustLinkageItems}
                  />
                ) : (
                  <div className="rounded-2xl border border-border/60 bg-card/25 p-4 text-sm text-muted-foreground">
                    No trust linkage is visible on this request yet.
                  </div>
                )}

                {diagnosticsItems.length > 0 ? (
                  <EntityKeyValueGrid
                    title="Diagnostics"
                    items={diagnosticsItems}
                  />
                ) : (
                  <div className="rounded-2xl border border-border/60 bg-card/25 p-4 text-sm text-muted-foreground">
                    No active diagnostics on this request.
                  </div>
                )}
              </div>
            ) : null}

            {hasNotes ? (
              <div className="mt-6">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Notes and diagnostics
                </div>
                <JsonBlock
                  value={notesPayload}
                  emptyLabel="No request notes"
                />
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to={`/app/ingest/requests/${encodeURIComponent(requestId)}`}>
                  <ArrowRight className="mr-2 h-4 w-4" />
                  Open request detail
                </Link>
              </Button>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

export default function IngestRequestsPage() {
  const { org, membership, entitlements, resourceErrors } = useAppContext();

  const posture = React.useMemo(
    () => deriveIngestPosture(entitlements, membership),
    [entitlements, membership]
  );

  const ingestDomain = React.useMemo(() => {
    if (!org?.id) return "";
    return `hf:ingest|org:${org.id}`;
  }, [org?.id]);

  const [rows, setRows] = React.useState([]);
  const [limit, setLimit] = React.useState(0);
  const [offset, setOffset] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [kindFilter, setKindFilter] = React.useState("all");
  const [expandedRowId, setExpandedRowId] = React.useState(null);

  const topError = pageError || resourceErrors?.ingest?.message || "";
  const hasActiveFilters = statusFilter !== "all" || kindFilter !== "all" || Boolean(String(search).trim());

  const loadRequests = React.useCallback(async () => {
    if (!ingestDomain) {
      setRows([]);
      setLimit(0);
      setOffset(0);
      setPageError("");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setPageError("");

    try {
      const qs = new URLSearchParams();
      qs.set("domain", ingestDomain);
      qs.set("limit", "100");
      qs.set("offset", "0");
      qs.set("order", "DESC");

      if (statusFilter !== "all") {
        qs.set("status", statusFilter);
      }

      if (kindFilter !== "all") {
        qs.set("anchor_kind", kindFilter);
      }

      const payload = await fetchJsonOrThrow(`/v1/merkle/anchor/requests?${qs.toString()}`);
      const normalized = normalizeAnchorRequestsEnvelope(payload);

      setRows(Array.isArray(normalized.rows) ? normalized.rows : []);
      setLimit(normalized.limit || 0);
      setOffset(normalized.offset || 0);
    } catch (err) {
      setRows([]);
      setLimit(0);
      setOffset(0);
      setPageError(extractApiErrorMessage(err, "Failed to load ingest requests."));
    } finally {
      setIsLoading(false);
    }
  }, [ingestDomain, statusFilter, kindFilter]);

  React.useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const filteredRows = React.useMemo(() => {
    return rows.filter((row) => matchesRequestQuery(row, search));
  }, [rows, search]);

  const stats = React.useMemo(() => {
    const total = rows.length;
    const ready = rows.filter((row) => {
      const status = getAnchorStatus(row);
      return status === "published" || status === "confirmed";
    }).length;
    const roots = rows.filter((row) => getAnchorKind(row) === "root").length;
    const payloads = rows.filter((row) => getAnchorKind(row) !== "root").length;
    const failed = rows.filter((row) => getAnchorStatus(row) === "failed").length;

    return {
      total,
      ready,
      roots,
      payloads,
      failed,
    };
  }, [rows]);

  function toggleExpanded(rowId) {
    setExpandedRowId((prev) => (prev === rowId ? null : rowId));
  }

  function clearAllFilters() {
    setSearch("");
    setStatusFilter("all");
    setKindFilter("all");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            <Link to="/app/ingest" className="hover:underline">
              Ingest
            </Link>
            <span className="mx-2">/</span>
            <span>Requests</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Submission requests
          </h1>

          <p className="max-w-3xl text-sm text-muted-foreground">
            Review durable ingest request history for the current org ingest domain, track lifecycle state and trust linkage, and open individual requests for deeper audit-level inspection.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link to="/app/ingest/anchor">
              <ScrollText className="mr-2 h-4 w-4" />
              Guided ingest
            </Link>
          </Button>

          <Button type="button" variant="outline" onClick={() => void loadRequests()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {topError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {topError}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <EntitySummaryCard
          title="Visible requests"
          value={Number(stats.total).toLocaleString()}
          hint="Requests visible to the current authenticated actor in this ingest domain."
          icon={ListTree}
        />

        <EntitySummaryCard
          title="Published / confirmed"
          value={Number(stats.ready).toLocaleString()}
          hint="Requests that have already reached published or confirmed trust posture."
          icon={Link2}
        />

        <EntitySummaryCard
          title="Root requests"
          value={Number(stats.roots).toLocaleString()}
          hint="Root-level requests currently visible in this ingest domain."
          icon={ShieldCheck}
        />

        <EntitySummaryCard
          title="Payload requests"
          value={Number(stats.payloads).toLocaleString()}
          hint="Non-root requests currently visible in this ingest domain."
          icon={Layers3}
        />
      </div>

      <EntitySection
        title="Registry posture"
        description="Current ingest domain scope, effective access posture, and live registry snapshot."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-border/60 bg-card/35 backdrop-blur">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Radio className="h-4 w-4" />
                Domain scope
              </CardTitle>
              <CardDescription>
                Requests in this view are scoped to the active org ingest domain.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="rounded-xl border border-border/60 bg-card/25 px-3 py-3 font-mono text-sm text-muted-foreground break-all">
                {ingestDomain || "No active ingest domain"}
              </div>

              <div className="text-xs text-muted-foreground">
                Durable request history is shown for this domain rather than only the current root snapshot.
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/35 backdrop-blur">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="h-4 w-4" />
                Access posture
              </CardTitle>
              <CardDescription>
                Current capability available to this actor in the ingest surface.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant={posture.canUseIngest ? "success" : "warn"}>
                  {posture.canUseIngest ? "ingest enabled" : "ingest restricted"}
                </Badge>
                <Badge variant={posture.canRegisterAndAnchor ? "success" : "warn"}>
                  {posture.canRegisterAndAnchor ? "register + anchor available" : "register + anchor limited"}
                </Badge>
              </div>

              <div className="text-xs text-muted-foreground">
                This panel reflects current role and entitlement posture for request history and anchor workflows.
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/35 backdrop-blur">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ListTree className="h-4 w-4" />
                Registry snapshot
              </CardTitle>
              <CardDescription>
                High-level request mix in the current registry view.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Published / confirmed
                  </div>
                  <div className="mt-2 text-xl font-semibold text-foreground">
                    {Number(stats.ready).toLocaleString()}
                  </div>
                </div>

                <div className="rounded-xl border border-border/60 bg-card/25 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Total visible
                  </div>
                  <div className="mt-2 text-xl font-semibold text-foreground">
                    {Number(stats.total).toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Root requests: {Number(stats.roots).toLocaleString()} • Payload requests: {Number(stats.payloads).toLocaleString()}
              </div>
            </CardContent>
          </Card>
        </div>
      </EntitySection>

      <EntitySection
        title="Request registry"
        description="Search by id, hash, domain, or error fields. Use the filters only when you want to narrow the lifecycle view."
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-border/60 bg-card/25 px-4 py-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search request id, payload type, domain, root hash, leaf hash, HCS ids, or error fields"
                className="w-full min-w-0 bg-transparent text-sm outline-none"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border/60 bg-background/40 hover:bg-muted/30"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-card/20 px-3 py-2 text-xs text-muted-foreground">
                <Filter className="h-3.5 w-3.5" />
                Filters
              </div>

              {hasActiveFilters ? (
                <Button type="button" variant="outline" size="sm" onClick={clearAllFilters}>
                  <X className="mr-2 h-4 w-4" />
                  Clear all
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/60 bg-card/20">
              <CardContent className="pt-5">
                <FilterChipGroup
                  label="Status"
                  options={STATUS_FILTERS}
                  activeValue={statusFilter}
                  onChange={setStatusFilter}
                />
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/20">
              <CardContent className="pt-5">
                <FilterChipGroup
                  label="Kind"
                  options={KIND_FILTERS}
                  activeValue={kindFilter}
                  onChange={setKindFilter}
                />
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="mt-5">
          {isLoading ? (
            <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
              Loading submission requests...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
              No submission requests matched the current view.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[44px]"></TableHead>
                  <TableHead>Request</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trust</TableHead>
                  <TableHead>Proof / domain</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filteredRows.map((row) => {
                  const requestId = getAnchorRequestId(row);
                  return (
                    <RequestTableRow
                      key={requestId || `${row?.proof_date}-${row?.anchor_hash || "row"}`}
                      row={row}
                      expandedRowId={expandedRowId}
                      onToggleExpanded={toggleExpanded}
                    />
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </EntitySection>

      <EntitySection
        title="How to use this page"
        description="This page is the durable ingest request registry and audit entry point."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <ListTree className="h-4 w-4" />
              Durable history
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Use this registry to review what has been submitted over time, rather than only the current root or current tree snapshot.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Clock3 className="h-4 w-4" />
              Lifecycle visibility
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Status, retry posture, publish timing, and trust linkage make it easier to distinguish queued work from anchored or confirmed state.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <ArrowRight className="h-4 w-4" />
              Drill into detail
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Expand a row for a fast operational summary, then open the request detail page for a deeper audit and support view.
            </p>
          </div>
        </div>
      </EntitySection>
    </div>
  );
}