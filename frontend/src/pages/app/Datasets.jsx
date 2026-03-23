import React from "react";
import {
  Database,
  RefreshCw,
  Search,
  Link2,
  ShieldCheck,
  Globe,
  Lock,
  Building2,
  ChevronDown,
  ChevronRight,
  FolderUp,
  ArrowRight,
  Layers3,
  Package,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import { Button } from "@/components/base/button";
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

function normalizeDatasetsEnvelope(payload) {
  const root = payload?.result ?? payload ?? null;

  const rows =
    Array.isArray(root)
      ? root
      : Array.isArray(root?.rows)
        ? root.rows
        : Array.isArray(root?.items)
          ? root.items
          : Array.isArray(root?.datasets)
            ? root.datasets
            : Array.isArray(payload?.rows)
              ? payload.rows
              : Array.isArray(payload?.items)
                ? payload.items
                : Array.isArray(payload?.datasets)
                  ? payload.datasets
                  : [];

  const total = Number(root?.total ?? payload?.total ?? rows.length) || 0;
  const nextCursor = root?.nextCursor ?? payload?.nextCursor ?? null;

  return {
    rows,
    total,
    nextCursor,
  };
}

function normalizeMetricsEnvelope(payload) {
  return payload?.result ?? payload ?? {};
}

function getDatasetKey(row) {
  return row?.dataset_key || row?.key || row?.datasetKey || row?.id || "";
}

function getDatasetLabel(row) {
  return (
    row?.display_name ||
    row?.dataset_label ||
    row?.label ||
    row?.name ||
    row?.dataset_name ||
    row?.dataset_key ||
    "Unnamed dataset"
  );
}

function getDatasetVisibility(row) {
  const raw = String(
    row?.visibility ||
      row?.visibility_kind ||
      row?.publish_visibility ||
      ""
  )
    .trim()
    .toLowerCase();

  if (!raw) return "unknown";
  if (raw === "organization" || raw === "organization_only") return "org";
  return raw;
}

function visibilityVariant(visibility) {
  switch (visibility) {
    case "public":
      return "success";
    case "org":
      return "outline";
    case "private":
      return "warn";
    default:
      return "outline";
  }
}

function visibilityLabel(visibility) {
  switch (visibility) {
    case "public":
      return "Public";
    case "org":
      return "Org";
    case "private":
      return "Private";
    default:
      return visibility || "Unknown";
  }
}

function getDatasetStatus(row) {
  const raw = String(
    row?.status ||
      row?.lifecycle_status ||
      row?.state ||
      ""
  )
    .trim()
    .toLowerCase();

  if (raw) return raw;
  if (row?.disabled === true || row?.is_disabled === true) return "disabled";
  return "active";
}

function statusVariant(status) {
  switch (status) {
    case "active":
    case "ready":
    case "published":
      return "success";
    case "processing":
    case "pending":
    case "building":
      return "warn";
    case "disabled":
    case "archived":
    case "failed":
    case "error":
      return "outline";
    default:
      return "outline";
  }
}

function statusLabel(status) {
  if (!status) return "Unknown";
  return status.replace(/_/g, " ");
}

function getDatasetTrustState(row) {
  if (row?.mirror_verified) return "verified";

  if (
    row?.dataset_hcs_topic_id ||
    row?.dataset_hcs_transaction_id ||
    row?.dataset_hcs_message_id ||
    row?.hcs_topic_id ||
    row?.hcs_transaction_id ||
    row?.hcs_message_id
  ) {
    return "anchored";
  }

  return "unanchored";
}

function trustVariant(trust) {
  switch (trust) {
    case "verified":
      return "success";
    case "anchored":
      return "outline";
    case "unanchored":
      return "warn";
    default:
      return "outline";
  }
}

function trustLabel(trust) {
  switch (trust) {
    case "verified":
      return "Verified";
    case "anchored":
      return "Anchored";
    case "unanchored":
      return "Unanchored";
    default:
      return trust || "Unknown";
  }
}

function formatDateTime(value) {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

function formatRelative(value) {
  if (!value) return "never";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "—";

  const diff = ms - Date.now();
  const abs = Math.abs(diff);

  const units = [
    { max: 60_000, div: 1000, name: "second" },
    { max: 3_600_000, div: 60_000, name: "minute" },
    { max: 86_400_000, div: 3_600_000, name: "hour" },
    { max: 2_592_000_000, div: 86_400_000, name: "day" },
    { max: 31_536_000_000, div: 2_592_000_000, name: "month" },
    { max: Number.POSITIVE_INFINITY, div: 31_536_000_000, name: "year" },
  ];

  const picked = units.find((u) => abs < u.max) || units[units.length - 1];
  const valueInt = Math.max(1, Math.round(abs / picked.div));

  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    diff < 0 ? -valueInt : valueInt,
    picked.name
  );
}

function shortText(value, max = 44) {
  const s = String(value || "").trim();
  if (!s) return "—";
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(12, max - 12))}…${s.slice(-10)}`;
}

function pickFirstNumber(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function hasValue(value) {
  return !(value == null || value === "" || value === "—");
}

function compactItems(items) {
  return items.filter((item) => hasValue(item?.value));
}

function matchesDatasetQuery(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    getDatasetKey(row),
    getDatasetLabel(row),
    row?.program,
    row?.org_id,
    row?.owner_user_id,
    row?.user_id,
    row?.dataset_fingerprint,
    row?.fingerprint_hash,
    row?.fingerprint,
    row?.manifest_hash,
    row?.active_manifest_hash,
    row?.dataset_hcs_topic_id,
    row?.dataset_hcs_transaction_id,
    row?.dataset_hcs_message_id,
    row?.hcs_topic_id,
    row?.hcs_transaction_id,
    row?.hcs_message_id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

function DatasetVisibilityBadge({ visibility }) {
  const Icon =
    visibility === "public"
      ? Globe
      : visibility === "org"
        ? Building2
        : visibility === "private"
          ? Lock
          : Database;

  return (
    <Badge variant={visibilityVariant(visibility)}>
      <Icon className="mr-1 h-3.5 w-3.5" />
      {visibilityLabel(visibility)}
    </Badge>
  );
}

function DatasetStatusBadge({ status }) {
  return <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>;
}

function DatasetTrustBadge({ trust }) {
  return <Badge variant={trustVariant(trust)}>{trustLabel(trust)}</Badge>;
}

function DatasetWorkflowCard({
  icon: Icon,
  title,
  description,
  bullets,
  primaryTo,
  primaryLabel,
}) {
  return (
    <Card className="border-border/60 bg-card/35 backdrop-blur">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2 text-sm text-muted-foreground">
          {bullets.map((item) => (
            <div key={item} className="flex items-start gap-2">
              <span className="mt-[0.45rem] h-1.5 w-1.5 rounded-full bg-foreground/50" />
              <span>{item}</span>
            </div>
          ))}
        </div>

        <Button asChild>
          <Link to={primaryTo}>
            <ArrowRight className="mr-2 h-4 w-4" />
            {primaryLabel}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function DatasetTableRow({ row, expandedRowId, onToggleExpanded }) {
  const datasetKey = getDatasetKey(row);
  const expanded = expandedRowId === datasetKey;
  const visibility = getDatasetVisibility(row);
  const status = getDatasetStatus(row);
  const trust = getDatasetTrustState(row);

  const fingerprint =
    row?.dataset_fingerprint ||
    row?.fingerprint_hash ||
    row?.fingerprint ||
    row?.input_hash ||
    null;

  const updatedAt = row?.updated_at || row?.sealed_at || row?.created_at || null;

  const identityItems = compactItems([
    { key: "dataset_key", label: "Dataset key", value: datasetKey, mono: true },
    { key: "label", label: "Label", value: getDatasetLabel(row) },
    { key: "program", label: "Program", value: row?.program || null },
    { key: "org_id", label: "Org id", value: row?.org_id || null, mono: true },
    {
      key: "owner_user_id",
      label: "Owner user id",
      value: row?.owner_user_id || row?.user_id || null,
      mono: true,
    },
  ]);

  const registryItems = compactItems([
    { key: "visibility", label: "Visibility", value: visibilityLabel(visibility) },
    { key: "status", label: "Status", value: statusLabel(status) },
    { key: "trust", label: "Trust state", value: trustLabel(trust) },
    {
      key: "active_version",
      label: "Active version",
      value: row?.active_version != null ? String(row.active_version) : null,
    },
    { key: "fingerprint", label: "Fingerprint", value: fingerprint, mono: true },
    {
      key: "manifest_hash",
      label: "Manifest hash",
      value: row?.active_manifest_hash || row?.manifest_hash || null,
      mono: true,
    },
    {
      key: "dataset_hcs_transaction_id",
      label: "Dataset HCS txn",
      value: row?.dataset_hcs_transaction_id || row?.hcs_transaction_id || null,
      mono: true,
    },
    {
      key: "dataset_hcs_message_id",
      label: "Dataset HCS msg",
      value: row?.dataset_hcs_message_id || row?.hcs_message_id || null,
      mono: true,
    },
  ]);

  const hasMetadata =
    row?.metadata &&
    typeof row.metadata === "object" &&
    !Array.isArray(row.metadata) &&
    Object.keys(row.metadata).length > 0;

  return (
    <>
      <TableRow>
        <TableCell className="w-[44px]">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-card/30 hover:bg-muted/30"
            onClick={() => onToggleExpanded(datasetKey)}
            aria-label={expanded ? "Collapse row" : "Expand row"}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </TableCell>

        <TableCell className="min-w-[260px]">
          <div>
            <Link
              to={`/app/datasets/${encodeURIComponent(datasetKey)}`}
              className="text-sm font-semibold text-foreground/90 underline-offset-4 hover:underline"
            >
              {getDatasetLabel(row)}
            </Link>
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {shortText(datasetKey, 42)}
          </div>
        </TableCell>

        <TableCell className="min-w-[120px]">
          <DatasetVisibilityBadge visibility={visibility} />
        </TableCell>

        <TableCell className="min-w-[120px]">
          <DatasetStatusBadge status={status} />
        </TableCell>

        <TableCell className="min-w-[120px]">
          <DatasetTrustBadge trust={trust} />
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
              <EntityKeyValueGrid title="Dataset identity" items={identityItems} />
              <EntityKeyValueGrid title="Registry posture" items={registryItems} />
            </div>

            {hasMetadata ? (
              <div className="mt-6">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Metadata
                </div>
                <JsonBlock value={row.metadata} emptyLabel="No metadata" />
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to={`/app/datasets/${encodeURIComponent(datasetKey)}`}>
                  <ArrowRight className="mr-2 h-4 w-4" />
                  Open dataset detail
                </Link>
              </Button>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

export default function DatasetsPage() {
  const { resourceErrors } = useAppContext();

  const [rows, setRows] = React.useState([]);
  const [metrics, setMetrics] = React.useState({});
  const [total, setTotal] = React.useState(0);
  const [nextCursor, setNextCursor] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [visibilityFilter, setVisibilityFilter] = React.useState("all");
  const [expandedRowId, setExpandedRowId] = React.useState(null);

  const topError = pageError || resourceErrors?.datasets?.message || "";

  const loadDatasets = React.useCallback(async () => {
    setIsLoading(true);
    setPageError("");

    try {
      const qs = new URLSearchParams();
      qs.set("limit", "100");
      qs.set("offset", "0");

      if (visibilityFilter !== "all") {
        qs.set("visibility", visibilityFilter);
      }

      const [datasetsPayload, metricsPayload] = await Promise.all([
        fetchJsonOrThrow(`/datasets?${qs.toString()}`),
        fetchJsonOrThrow("/datasets/metrics").catch(() => null),
      ]);

      const normalized = normalizeDatasetsEnvelope(datasetsPayload);
      const nextMetrics = metricsPayload ? normalizeMetricsEnvelope(metricsPayload) : {};

      setRows(Array.isArray(normalized.rows) ? normalized.rows : []);
      setTotal(Number(normalized.total ?? 0) || 0);
      setNextCursor(normalized.nextCursor || null);
      setMetrics(nextMetrics);
    } catch (err) {
      setRows([]);
      setTotal(0);
      setNextCursor(null);
      setMetrics({});
      setPageError(err?.message || "Failed to load datasets.");
    } finally {
      setIsLoading(false);
    }
  }, [visibilityFilter]);

  React.useEffect(() => {
    void loadDatasets();
  }, [loadDatasets]);

  const filteredRows = React.useMemo(() => {
    return rows.filter((row) => matchesDatasetQuery(row, search));
  }, [rows, search]);

  const stats = React.useMemo(() => {
    const anchored = rows.filter((row) => {
      const trust = getDatasetTrustState(row);
      return trust === "anchored" || trust === "verified";
    }).length;

    const publicCount = rows.filter((row) => getDatasetVisibility(row) === "public").length;
    const active = rows.filter((row) => {
      const s = getDatasetStatus(row);
      return s === "active" || s === "ready" || s === "published";
    }).length;

    return {
      active,
      anchored,
      publicCount,
      metricsTotal:
        Number(metrics?.total ?? metrics?.datasets_total ?? metrics?.dataset_count ?? total) || total,
    };
  }, [rows, metrics, total]);

  function toggleExpanded(rowId) {
    setExpandedRowId((prev) => (prev === rowId ? null : rowId));
  }

  function clearAllFilters() {
    setSearch("");
    setVisibilityFilter("all");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Datasets
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Browse the registry, inspect trust posture, or start a dataset workflow.
          </p>
        </div>

        <Button type="button" variant="outline" onClick={() => void loadDatasets()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {topError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {topError}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <EntitySummaryCard
          title="Visible datasets"
          value={Number(stats.metricsTotal).toLocaleString()}
          hint="Datasets visible to the current actor."
          icon={Database}
        />

        <EntitySummaryCard
          title="Public datasets"
          value={Number(stats.publicCount).toLocaleString()}
          hint="Datasets with public visibility."
          icon={Globe}
        />

        <EntitySummaryCard
          title="Active / ready"
          value={Number(stats.active).toLocaleString()}
          hint="Datasets currently positioned for use or review."
          icon={ShieldCheck}
        />

        <EntitySummaryCard
          title="Anchored"
          value={Number(stats.anchored).toLocaleString()}
          hint="Datasets with visible trust-layer linkage."
          icon={Link2}
        />
      </div>

      <EntitySection
        title="Choose a workflow"
        description="Use the managed path or finalize evidence computed outside HF."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <DatasetWorkflowCard
            icon={FolderUp}
            title="Guided dataset anchor"
            description="Hash, register, and publish through the managed HF flow."
            bullets={[
              "Best for managed onboarding and operator-led imports.",
              "Uses a dataset root available to the HF runtime.",
              "Returns receipts, publication state, and trust output when available.",
            ]}
            primaryTo="/app/datasets/anchor"
            primaryLabel="Open guided anchor"
          />

          <DatasetWorkflowCard
            icon={Package}
            title="Local-first submit"
            description="Submit deterministic evidence produced outside HF and let HF finalize registry state."
            bullets={[
              "Best for privacy-sensitive and operator-grade flows.",
              "Bridges local evidence into anchored finalization.",
              "Completes dataset, version, publication, and related trust records.",
            ]}
            primaryTo="/app/datasets/submit"
            primaryLabel="Open local-first submit"
          />
        </div>
      </EntitySection>

      <EntitySection
        title="Dataset registry"
        description="Search by key, label, fingerprint, program, or trust identifiers."
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-border/60 bg-card/25 px-4 py-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search dataset key, name, fingerprint, program, org id, or HCS ids"
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
              {[
                ["all", "All"],
                ["public", "Public"],
                ["org", "Org"],
                ["private", "Private"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant={visibilityFilter === value ? "default" : "outline"}
                  onClick={() => setVisibilityFilter(value)}
                >
                  {label}
                </Button>
              ))}

              {(search || visibilityFilter !== "all") ? (
                <Button type="button" variant="outline" onClick={clearAllFilters}>
                  <X className="mr-2 h-4 w-4" />
                  Clear
                </Button>
              ) : null}
            </div>
          </div>

          {isLoading ? (
            <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
              Loading datasets...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
              No datasets matched the current view.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[44px]"></TableHead>
                  <TableHead>Dataset</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trust</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filteredRows.map((row) => {
                  const datasetKey = getDatasetKey(row);
                  return (
                    <DatasetTableRow
                      key={datasetKey || `${row?.org_id}-${row?.created_at || "row"}`}
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

        {nextCursor ? (
          <div className="mt-4 text-xs text-muted-foreground">
            More dataset pages are available.
          </div>
        ) : null}
      </EntitySection>
    </div>
  );
}