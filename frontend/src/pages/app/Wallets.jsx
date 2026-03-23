import React from "react";
import {
  Wallet,
  Plus,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Link2,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import { Button } from "@/components/base/button";
import EntitySummaryCard from "@/components/entities/entity-summary-card.jsx";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/base/table.jsx";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";

function isWalletLike(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;

  const id = String(row.id ?? "").trim();
  const walletAddress = String(
    row.wallet_address ?? row.address ?? row.evm_address ?? ""
  ).trim();
  const userId = String(row.user_id ?? "").trim();
  const orgId = String(row.org_id ?? "").trim();

  return Boolean(id || walletAddress || userId || orgId);
}

function normalizeWalletsEnvelope(payload) {
  const root = payload?.result ?? payload ?? null;

  const rowsRaw =
    Array.isArray(root)
      ? root
      : Array.isArray(root?.rows)
        ? root.rows
        : Array.isArray(root?.items)
          ? root.items
          : Array.isArray(root?.wallets)
            ? root.wallets
            : Array.isArray(payload?.rows)
              ? payload.rows
              : Array.isArray(payload?.items)
                ? payload.items
                : Array.isArray(payload?.wallets)
                  ? payload.wallets
                  : [];

  const rows = rowsRaw.filter(isWalletLike);

  const reportedTotal = Number(root?.total ?? payload?.total);
  const total = Number.isFinite(reportedTotal) ? reportedTotal : rows.length;

  return {
    rows,
    total: Math.max(rows.length, total),
  };
}

function extractWalletFromPayload(payload) {
  const root = payload?.result ?? payload ?? null;
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;

  if (isWalletLike(root?.wallet)) return root.wallet;
  if (isWalletLike(root)) return root;

  return null;
}

function getWalletStatus(row) {
  if (row?.deleted_at) return "deleted";
  return "active";
}

function walletStatusVariant(status) {
  switch (status) {
    case "active":
      return "success";
    case "deleted":
      return "outline";
    default:
      return "outline";
  }
}

function walletStatusLabel(status) {
  switch (status) {
    case "active":
      return "active";
    case "deleted":
      return "deleted";
    default:
      return status || "unknown";
  }
}

function getWalletTrustState(row) {
  if (row?.mirror_verified) return "verified";
  if (row?.hcs_topic_id || row?.hcs_transaction_id || row?.hcs_message_id) return "anchored";
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
      return "verified";
    case "anchored":
      return "anchored";
    case "unanchored":
      return "unanchored";
    default:
      return trust || "unknown";
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

function shortUuid(value) {
  const s = String(value || "").trim();
  if (!s) return "—";
  if (s.length <= 16) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

function parseMetadataInput(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Metadata must be a JSON object.");
  }
  return parsed;
}

function matchesWalletQuery(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    row?.wallet_address,
    row?.id,
    row?.user_id,
    row?.org_id,
    row?.hcs_topic_id,
    row?.hcs_transaction_id,
    row?.hcs_message_id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

function WalletStatusBadge({ status }) {
  return <Badge variant={walletStatusVariant(status)}>{walletStatusLabel(status)}</Badge>;
}

function WalletTrustBadge({ trust }) {
  const label =
    trust === "verified"
      ? "mirror verified"
      : trust === "anchored"
        ? "anchor observed"
        : "not anchored";

  return (
    <div className="inline-flex w-fit">
      <Badge variant={trustVariant(trust)}>{label}</Badge>
    </div>
  );
}

function KeyValueRow({ label, value, mono = false }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[140px,1fr] sm:gap-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={mono ? "break-all font-mono text-xs text-foreground/90" : "text-sm text-foreground/90"}>
        {value || "—"}
      </div>
    </div>
  );
}

function WalletMetadataBlock({ metadata }) {
  const pretty = React.useMemo(() => {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
    try {
      return JSON.stringify(metadata, null, 2);
    } catch {
      return "";
    }
  }, [metadata]);

  if (!pretty) {
    return <div className="text-sm text-muted-foreground">No metadata</div>;
  }

  return (
    <pre className="overflow-x-auto rounded-xl border border-border/60 bg-background/40 p-3 text-xs text-foreground/85">
      {pretty}
    </pre>
  );
}

function CreateWalletCard({
  submitting,
  submitError,
  form,
  onChange,
  onSubmit,
}) {
  return (
    <Card className="border-border/60 bg-card/35 backdrop-blur">
      <CardHeader>
        <CardTitle className="text-base">Create wallet</CardTitle>
        <CardDescription>
          Provision a platform-managed wallet for your authenticated user context. Self-service currently supports one active wallet per user. If an active wallet already exists, the existing wallet will be returned instead of provisioning a second active wallet.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          className="grid gap-4 lg:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/90">Primary wallet</label>
            <label className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground/90">
              <input
                type="checkbox"
                checked={Boolean(form.makePrimary)}
                onChange={(e) => onChange("makePrimary", e.target.checked)}
                disabled={submitting}
              />
              Set the created wallet as the primary wallet
            </label>
            <p className="text-xs text-muted-foreground">
              Primary wallet status controls the default wallet used for ownership-oriented flows.
            </p>
          </div>

          <div className="space-y-2 lg:col-span-1">
            <label className="text-sm font-medium text-foreground/90">Metadata JSON</label>
            <textarea
              value={form.metadataText}
              onChange={(e) => onChange("metadataText", e.target.value)}
              placeholder={'{"purpose":"hf-ui","environment":"demo"}'}
              className="min-h-28 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              Optional. Must be a JSON object.
            </p>
          </div>

          {submitError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200 lg:col-span-2">
              {submitError}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 lg:col-span-2">
            <Button type="submit" disabled={submitting}>
              <Plus className="mr-2 h-4 w-4" />
              {submitting ? "Creating..." : "Create wallet"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function WalletsTableRow({
  row,
  actionState,
  expandedRowId,
  onToggleExpanded,
  onArmAction,
  onCancelAction,
  onRunAction,
  canManagePrimary = false,
}) {
  const status = getWalletStatus(row);
  const trust = getWalletTrustState(row);
  const pending = actionState?.rowId === row.id ? actionState.action : null;
  const isBusy = Boolean(actionState?.busy && actionState?.rowId === row.id);
  const expanded = expandedRowId === row.id;

  const canSetPrimary = canManagePrimary && status !== "deleted" && !row?.is_primary;
  const canRetire = status !== "deleted";

  return (
    <>
      <TableRow>
        <TableCell className="w-[44px]">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-card/30 hover:bg-muted/30"
            onClick={() => onToggleExpanded(row.id)}
            aria-label={expanded ? "Collapse row" : "Expand row"}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </TableCell>

        <TableCell className="min-w-[190px]">
          <div>
            <Link
              to={`/app/wallets/${row?.id}`}
              className="text-sm font-semibold text-foreground/90 underline-offset-4 hover:underline"
            >
              {row?.wallet_address || "No wallet address"}
            </Link>
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {shortUuid(row?.id)}
          </div>
        </TableCell>

        <TableCell className="min-w-[110px]">
          {row?.is_primary ? (
            <Badge variant="success">Primary</Badge>
          ) : (
            <Badge variant="outline">Secondary</Badge>
          )}
        </TableCell>

        <TableCell className="min-w-[110px]">
          <WalletStatusBadge status={status} />
        </TableCell>

        <TableCell className="min-w-[150px]">
          <div className="flex flex-col gap-2">
            <WalletTrustBadge trust={trust} />
          </div>
        </TableCell>

        <TableCell className="min-w-[130px]">
          <div className="text-sm text-foreground/85">
            {row?.created_at ? formatRelative(row.created_at) : "—"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatDateTime(row?.created_at)}
          </div>
        </TableCell>

        <TableCell className="min-w-[250px]">
          <div className="flex flex-wrap gap-2">
            {canSetPrimary ? (
              pending === "primary" ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => void onRunAction(row.id, "primary")}
                  >
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    {isBusy ? "Setting..." : "Confirm"}
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={onCancelAction}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => onArmAction(row.id, "primary")}
                >
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Set primary
                </Button>
              )
            ) : null}

            {canRetire ? (
              pending === "retire" ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => void onRunAction(row.id, "retire")}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {isBusy ? "Retiring..." : "Confirm"}
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={onCancelAction}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => onArmAction(row.id, "retire")}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Retire
                </Button>
              )
            ) : (
              <Button type="button" variant="outline" size="sm" disabled>
                <ShieldOff className="mr-2 h-4 w-4" />
                Retired
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>

      {expanded ? (
        <TableRow>
          <TableCell colSpan={7} className="bg-card/20">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Wallet identity
                </div>
                <KeyValueRow label="Wallet address" value={row?.wallet_address} mono />
                <KeyValueRow label="Wallet id" value={row?.id} mono />
                <KeyValueRow label="User id" value={row?.user_id} mono />
                <KeyValueRow label="Org id" value={row?.org_id} mono />
                <KeyValueRow label="Primary" value={row?.is_primary ? "true" : "false"} />
              </div>

              <div className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Trust and lifecycle
                </div>
                <KeyValueRow label="Mirror verified" value={row?.mirror_verified ? "true" : "false"} />
                <KeyValueRow label="Mirror verified at" value={formatDateTime(row?.mirror_verified_at)} />
                <KeyValueRow label="HCS topic id" value={row?.hcs_topic_id} mono />
                <KeyValueRow label="HCS transaction id" value={row?.hcs_transaction_id} mono />
                <KeyValueRow label="HCS message id" value={row?.hcs_message_id} mono />
                <KeyValueRow label="Created at" value={formatDateTime(row?.created_at)} />
                <KeyValueRow label="Updated at" value={formatDateTime(row?.updated_at)} />
                <KeyValueRow label="Deleted at" value={formatDateTime(row?.deleted_at)} />
              </div>
            </div>

            <div className="mt-6">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Metadata
              </div>
              <WalletMetadataBlock metadata={row?.metadata} />
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

export default function WalletsPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const {
    resourceErrors,
    refreshAppContext,
  } = useAppContext();

  const [rows, setRows] = React.useState([]);
  const [primaryWalletId, setPrimaryWalletId] = React.useState(null);
  const [total, setTotal] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const [submitError, setSubmitError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [expandedRowId, setExpandedRowId] = React.useState(null);

  const [actionState, setActionState] = React.useState({
    rowId: null,
    action: null,
    busy: false,
  });

  const [form, setForm] = React.useState({
    makePrimary: true,
    metadataText: "",
  });

  const successNotice =
    typeof location.state?.notice === "string" && location.state.notice.trim()
      ? location.state.notice.trim()
      : "";

  const topError = pageError || resourceErrors?.wallets?.message || "";

  const loadWallets = React.useCallback(async () => {
    setIsLoading(true);
    setPageError("");
    setSubmitError("");

    try {
      const [walletsPayload, primaryPayload] = await Promise.all([
        fetchJsonOrThrow("/v1/wallets/me"),
        fetchJsonOrThrow("/v1/wallets/me/primary").catch(() => null),
      ]);

      const normalized = normalizeWalletsEnvelope(walletsPayload);
      const primaryWallet = primaryPayload ? extractWalletFromPayload(primaryPayload) : null;
      const safeRows = Array.isArray(normalized.rows) ? normalized.rows.filter(isWalletLike) : [];

      setRows(safeRows);
      setTotal(safeRows.length);
      setPrimaryWalletId(
        safeRows.find((row) => row?.is_primary)?.id ||
        (primaryWallet && isWalletLike(primaryWallet) ? primaryWallet.id || null : null)
      );
    } catch (err) {
      setRows([]);
      setTotal(0);
      setPrimaryWalletId(null);
      setPageError(err?.message || "Failed to load wallets.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!successNotice) return;

    navigate(location.pathname + location.search, {
      replace: true,
      state: {},
    });
  }, [successNotice, navigate, location.pathname, location.search]);

  React.useEffect(() => {
    void loadWallets();
  }, [loadWallets]);

  const filteredRows = React.useMemo(() => {
    return rows.filter((row) => {
      const matchesFilter =
        filter === "primary"
          ? Boolean(row?.is_primary)
          : true;

      return matchesFilter && matchesWalletQuery(row, search);
    });
  }, [rows, filter, search]);

  const activeRows = React.useMemo(
    () => rows.filter((row) => getWalletStatus(row) === "active"),
    [rows]
  );

  const hasActiveWallet = activeRows.length > 0;
  const canManagePrimary = activeRows.length > 1;

  const primaryWalletRow = React.useMemo(() => {
    return rows.find((row) => Boolean(row?.is_primary) || row?.id === primaryWalletId) ?? null;
  }, [rows, primaryWalletId]);

  const primaryWalletStatus = primaryWalletRow ? getWalletStatus(primaryWalletRow) : "none";
  const primaryWalletTrust = primaryWalletRow ? getWalletTrustState(primaryWalletRow) : "unknown";
  const primaryWalletCreatedAt = primaryWalletRow?.created_at ?? null;

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleExpanded(rowId) {
    setExpandedRowId((prev) => (prev === rowId ? null : rowId));
  }

  function armAction(rowId, action) {
    setActionState({ rowId, action, busy: false });
  }

  function cancelAction() {
    setActionState({ rowId: null, action: null, busy: false });
  }

  async function handleCreate() {
    setSubmitting(true);
    setSubmitError("");
    setPageError("");

    try {
      const metadata = parseMetadataInput(form.metadataText);

      const body = {
        make_primary: Boolean(form.makePrimary),
        ...(metadata ? { metadata } : {}),
      };

      await fetchJsonOrThrow("/v1/wallets/me", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      setForm({
        makePrimary: true,
        metadataText: "",
      });

      await loadWallets();
      await refreshAppContext();
    } catch (err) {
      setSubmitError(err?.message || "Failed to create wallet.");
    } finally {
      setSubmitting(false);
    }
  }

  async function runAction(rowId, action) {
    setActionState({ rowId, action, busy: true });
    setPageError("");

    try {
      if (action === "primary") {
        await fetchJsonOrThrow(`/v1/wallets/${rowId}/primary`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });
      } else if (action === "retire") {
        await fetchJsonOrThrow(`/v1/wallets/${rowId}`, {
          method: "DELETE",
        });
      } else {
        throw new Error(`Unsupported wallet action: ${action}`);
      }

      setActionState({ rowId: null, action: null, busy: false });
      await loadWallets();
      await refreshAppContext();
    } catch (err) {
      setActionState({ rowId: null, action: null, busy: false });
      setPageError(
        err?.message ||
          (action === "primary"
            ? "Failed to set primary wallet."
            : "Failed to retire wallet.")
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Wallets
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Provision, inspect, and manage platform-linked wallets for authenticated Hash Factory workflows.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void loadWallets()}>
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

      {successNotice ? (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          {successNotice}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <EntitySummaryCard
          title="Primary wallet"
          value={primaryWalletRow?.wallet_address || "None"}
          hint="Default wallet for ownership-oriented flows."
          icon={Wallet}
          mono
        />

        <EntitySummaryCard
          title="Trust state"
          value={trustLabel(primaryWalletTrust)}
          hint={
            primaryWalletTrust === "verified"
              ? "Mirror-confirmed trust state."
              : primaryWalletTrust === "anchored"
                ? "HCS anchor present, awaiting or preceding mirror confirmation."
                : "No HCS trust signal observed yet."
          }
          icon={Link2}
        />

        <EntitySummaryCard
          title="Created"
          value={primaryWalletCreatedAt ? formatRelative(primaryWalletCreatedAt) : "—"}
          hint={primaryWalletCreatedAt ? formatDateTime(primaryWalletCreatedAt) : "No wallet provisioned."}
          icon={RefreshCw}
        />

        <EntitySummaryCard
          title="Status"
          value={walletStatusLabel(primaryWalletStatus)}
          hint={
            primaryWalletStatus === "active"
              ? "Wallet currently available for use."
              : primaryWalletStatus === "deleted"
                ? "Wallet has been retired."
                : "No wallet provisioned."
          }
          icon={ShieldCheck}
        />
      </div>

      {!hasActiveWallet ? (
        <CreateWalletCard
          submitting={submitting}
          submitError={submitError}
          form={form}
          onChange={updateForm}
          onSubmit={handleCreate}
        />
      ) : (
        <Card className="border-border/60 bg-card/35 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-base">Wallet provisioned</CardTitle>
            <CardDescription>
              Self-service currently supports one active wallet per user. Retire your active wallet before provisioning a replacement.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <EntitySection
        title="Wallet inventory"
        description="Review current wallets, primary role, trust posture, lifecycle state, and self-service actions."
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by wallet address, wallet id, user id, org id, or HCS ids"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {["all", "primary"].map((value) => (
              <Button
                key={value}
                type="button"
                variant={filter === value ? "default" : "outline"}
                onClick={() => setFilter(value)}
              >
                {value}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          {isLoading ? (
            <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
              Loading wallets...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
              No wallets matched the current view.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[44px]"></TableHead>
                  <TableHead>Wallet</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trust</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filteredRows.map((row) => (
                  <WalletsTableRow
                    key={row.id || `${row.user_id}-${row.wallet_address}`}
                    row={row}
                    actionState={actionState}
                    expandedRowId={expandedRowId}
                    onToggleExpanded={toggleExpanded}
                    onArmAction={armAction}
                    onCancelAction={cancelAction}
                    onRunAction={runAction}
                    canManagePrimary={canManagePrimary}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </EntitySection>

      <EntitySection
        title="Operational guidance"
        description="Recommended posture for wallet ownership and lifecycle management."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Wallet className="h-4 w-4" />
              Primary wallet discipline
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Keep one clear primary wallet for default ownership and signing-oriented flows, and avoid unnecessary switching.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Link2 className="h-4 w-4" />
              Trust visibility
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              HCS anchor fields and mirror verification help you inspect whether wallet lifecycle events have reached the trust layer.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Trash2 className="h-4 w-4" />
              Controlled retirement
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Retire wallets when they should no longer be active, while preserving audit-oriented lifecycle history.            </p>
          </div>
        </div>
      </EntitySection>
    </div>
  );
}