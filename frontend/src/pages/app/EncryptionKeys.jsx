import React from "react";
import { Link } from "react-router-dom";
import {
  Ban,
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/base/table.jsx";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";

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
  if (!value) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "—";

  const diff = ms - Date.now();
  const abs = Math.abs(diff);

  const units = [
    { max: 60_000, div: 1000, name: "second" },
    { max: 3_600_000, div: 60_000, name: "minute" },
    { max: 86_400_000, div: 3_600_000, name: "hour" },
    { max: 86_400_000 * 30, div: 86_400_000, name: "day" },
    { max: 86_400_000 * 365, div: 86_400_000 * 30, name: "month" },
    { max: Number.POSITIVE_INFINITY, div: 86_400_000 * 365, name: "year" },
  ];

  const picked = units.find((u) => abs < u.max) || units[units.length - 1];
  const valueInt = Math.max(1, Math.round(abs / picked.div));

  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    diff < 0 ? -valueInt : valueInt,
    picked.name
  );
}

function shortValue(value, left = 12, right = 10) {
  const s = String(value || "").trim();
  if (!s) return "—";
  if (s.length <= left + right + 3) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

function shortUuid(value) {
  return shortValue(value, 8, 6);
}

function normalizePublicKey(payload) {
  const root = payload?.result ?? payload ?? null;
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  return root;
}

function normalizeHistoryEnvelope(payload) {
  const root = payload?.result ?? payload ?? null;

  const rows =
    Array.isArray(root)
      ? root
      : Array.isArray(root?.rows)
        ? root.rows
        : Array.isArray(root?.items)
          ? root.items
          : Array.isArray(payload?.rows)
            ? payload.rows
            : Array.isArray(payload?.items)
              ? payload.items
              : [];

  const total =
    Number(root?.total ?? payload?.total ?? rows.length) || 0;

  return {
    rows: Array.isArray(rows) ? rows : [],
    total,
    limit: Number(root?.limit ?? payload?.limit ?? rows.length) || rows.length,
    offset: Number(root?.offset ?? payload?.offset ?? 0) || 0,
  };
}

function userIdOf(row) {
  return row?.id ?? "";
}

function keyTypeOf(row) {
  return row?.key_type ?? "unknown";
}

function keyVersionOf(row) {
  const value = row?.key_version;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function createdAtOf(row) {
  return row?.created_at ?? null;
}

function updatedAtOf(row) {
  return row?.updated_at ?? null;
}

function deletedAtOf(row) {
  return row?.deleted_at ?? null;
}

function rotationTriggeredAtOf(row) {
  return row?.rotation_triggered_at ?? null;
}

function publicKeyOf(row) {
  return row?.public_key_pem ?? row?.public_key ?? null;
}

function keyStatusOf(row) {
  const explicit = String(row?.status ?? "").trim().toLowerCase();
  if (explicit) return explicit;

  if (deletedAtOf(row)) return "revoked";
  if (rotationTriggeredAtOf(row)) return "rotated";
  return "historical";
}

function statusVariant(status) {
  switch (status) {
    case "active":
      return "success";
    case "rotated":
      return "outline";
    case "revoked":
      return "warn";
    case "compromised":
      return "warn";
    default:
      return "outline";
  }
}

function matchesQuery(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    row?.id,
    row?.key_type,
    row?.key_version,
    row?.status,
    row?.created_at,
    row?.updated_at,
    row?.deleted_at,
    row?.rotation_triggered_at,
    row?.metadata ? JSON.stringify(row.metadata) : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

function CountCard({ title, value, hint }) {
  return (
    <Card className="border-border/60 bg-card/35 backdrop-blur">
      <CardHeader className="pb-3">
        <CardDescription className="text-xs font-semibold uppercase tracking-wide">
          {title}
        </CardDescription>
        <CardTitle className="text-2xl tracking-tight">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-sm text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }) {
  return <Badge variant={statusVariant(status)}>{status || "unknown"}</Badge>;
}

function CopyValueButton({ value }) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
      <Copy className="mr-2 h-4 w-4" />
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function PublicKeyCard({ row }) {
  if (!row) {
    return (
      <Card className="border-border/60 bg-card/35 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-base">Current public key</CardTitle>
          <CardDescription>No active key is available.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const publicMaterial = publicKeyOf(row);
  const status = keyStatusOf(row);

  return (
    <Card className="border-border/60 bg-card/35 backdrop-blur">
      <CardHeader>
        <CardTitle className="text-base">Current public key</CardTitle>
        <CardDescription>Active public key material for the selected user.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Status
            </div>
            <div className="mt-2">
              <StatusBadge status={status} />
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Visibility
            </div>
            <div className="mt-2 text-sm text-foreground/90">
              Public material only
            </div>
          </div>
        </div>

        {publicMaterial ? (
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Public key
            </div>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border/60 bg-background/60 p-3 text-xs text-foreground/85">
                {String(publicMaterial)}
              </pre>
              <div className="shrink-0">
                <CopyValueButton value={publicMaterial} />
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function HistoryRow({ row, expanded, onToggle, userId }) {
  const status = keyStatusOf(row);
  const rowUserId = userIdOf(row);
  const keyType = keyTypeOf(row);
  const keyVersion = keyVersionOf(row);
  const createdAt = createdAtOf(row);
  const updatedAt = updatedAtOf(row);
  const deletedAt = deletedAtOf(row);
  const rotationTriggeredAt = rotationTriggeredAtOf(row);
  const metadata = row?.metadata ?? null;
  const publicMaterial = publicKeyOf(row);

  return (
    <>
      <TableRow>
        <TableCell className="w-[44px]">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-card/30 hover:bg-muted/30"
            onClick={onToggle}
            aria-label={expanded ? "Collapse row" : "Expand row"}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </TableCell>

        <TableCell className="min-w-[180px]">
          <div className="font-mono text-xs text-foreground/90">
            {shortUuid(rowUserId)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Version {keyVersion ?? "—"}
          </div>
          {userId && keyVersion ? (
            <div className="mt-2">
              <Button asChild type="button" variant="outline" size="sm">
                <Link to={`/app/keys/encryption/${encodeURIComponent(userId)}/${encodeURIComponent(String(keyVersion))}`}>
                  View detail
                </Link>
              </Button>
            </div>
          ) : null}
        </TableCell>

        <TableCell>
          <StatusBadge status={status} />
        </TableCell>

        <TableCell className="min-w-[140px]">
          <div className="text-sm text-foreground/85">{keyType}</div>
        </TableCell>

        <TableCell className="min-w-[130px]">
          <div className="text-sm text-foreground/85">
            {createdAt ? formatRelative(createdAt) : "—"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatDateTime(createdAt)}
          </div>
        </TableCell>
      </TableRow>

      {expanded ? (
        <TableRow>
          <TableCell colSpan={6} className="bg-card/20">
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-4">
                <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    User id
                  </div>
                  <div className="mt-2 break-all font-mono text-xs text-foreground/90">
                    {rowUserId || "—"}
                  </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Key type
                  </div>
                  <div className="mt-2 text-sm text-foreground/90">
                    {keyType || "—"}
                  </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Key version
                  </div>
                  <div className="mt-2 text-sm text-foreground/90">
                    {keyVersion ?? "—"}
                  </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Updated
                  </div>
                  <div className="mt-2 text-sm text-foreground/90">
                    {updatedAt ? formatRelative(updatedAt) : "—"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(updatedAt)}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Rotation triggered
                  </div>
                  <div className="mt-2 text-sm text-foreground/90">
                    {rotationTriggeredAt ? formatRelative(rotationTriggeredAt) : "—"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(rotationTriggeredAt)}
                  </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Deleted at
                  </div>
                  <div className="mt-2 text-sm text-foreground/90">
                    {deletedAt ? formatRelative(deletedAt) : "—"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(deletedAt)}
                  </div>
                </div>
              </div>

              {publicMaterial ? (
                <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Public key
                  </div>
                  <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border/60 bg-background/60 p-3 text-xs text-foreground/85">
                      {String(publicMaterial)}
                    </pre>
                    <div className="shrink-0">
                      <CopyValueButton value={publicMaterial} />
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Metadata
                </div>
                <pre className="mt-2 overflow-auto rounded-xl border border-border/60 bg-background/60 p-3 text-xs text-foreground/85">
                  {metadata ? JSON.stringify(metadata, null, 2) : "No metadata"}
                </pre>
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

export default function EncryptionKeysPage() {
  const { user, membership } = useAppContext();

  const selfUserId = String(user?.id || user?.user_id || "").trim();
  const canAdminUserKeys = String(membership?.role || "") === "tenant_admin";

  const [targetUserId, setTargetUserId] = React.useState("");
  const [resolvedUserId, setResolvedUserId] = React.useState("");

  const [publicKey, setPublicKey] = React.useState(null);
  const [historyRows, setHistoryRows] = React.useState([]);
  const [historyTotal, setHistoryTotal] = React.useState(0);

  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");
  const [search, setSearch] = React.useState("");

  const [actionBusy, setActionBusy] = React.useState("");
  const [actionError, setActionError] = React.useState("");
  const [actionNotice, setActionNotice] = React.useState("");

  const [expandedRowId, setExpandedRowId] = React.useState(null);

  const [generateForm, setGenerateForm] = React.useState({
    keyType: "rsa-2048",
    metadataText: '{\n  "surface": "hf-ui",\n  "purpose": "user-identity"\n}',
  });

  const effectiveUserId = String(resolvedUserId || selfUserId || "").trim();
  const currentPublicKeyId = String(publicKey?.id || "");

  function parseMetadataInput(raw) {
    const text = String(raw || "").trim();
    if (!text) return {};
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Metadata must be a JSON object.");
    }
    return parsed;
  }

  const loadPage = React.useCallback(async () => {
    if (!effectiveUserId) {
      setIsLoading(false);
      setPublicKey(null);
      setHistoryRows([]);
      setHistoryTotal(0);
      setPageError("No authenticated user id is available.");
      return;
    }

    setIsLoading(true);
    setPageError("");

    try {
      const [publicPayload, historyPayload] = await Promise.all([
        effectiveUserId === selfUserId
          ? fetchJsonOrThrow("/user-keys/me/public")
          : fetchJsonOrThrow(`/user-keys/${encodeURIComponent(effectiveUserId)}/public`),

        effectiveUserId === selfUserId
          ? fetchJsonOrThrow("/user-keys/me/history?limit=100&offset=0&includeDeleted=true")
          : fetchJsonOrThrow(`/user-keys/${encodeURIComponent(effectiveUserId)}/history?limit=100&offset=0&includeDeleted=true`),
      ]);

      const nextPublic = normalizePublicKey(publicPayload);
      const nextHistory = normalizeHistoryEnvelope(historyPayload);

      setPublicKey(nextPublic);
      setHistoryRows(Array.isArray(nextHistory.rows) ? nextHistory.rows : []);
      setHistoryTotal(Number(nextHistory.total ?? 0) || 0);
    } catch (err) {
      setPublicKey(null);
      setHistoryRows([]);
      setHistoryTotal(0);
      setPageError(err?.message || "Failed to load encryption key data.");
    } finally {
      setIsLoading(false);
    }
  }, [effectiveUserId, selfUserId]);

  React.useEffect(() => {
    if (!selfUserId) return;
    if (!resolvedUserId) {
      setResolvedUserId(selfUserId);
    }
  }, [selfUserId, resolvedUserId]);

  React.useEffect(() => {
    if (!effectiveUserId) return;
    setExpandedRowId(null);
    void loadPage();
  }, [effectiveUserId, loadPage]);

  const filteredRows = React.useMemo(() => {
    return historyRows.filter((row) => matchesQuery(row, search));
  }, [historyRows, search]);

  const stats = React.useMemo(() => {
    const active = historyRows.filter((row) => keyStatusOf(row) === "active").length;
    const rotated = historyRows.filter((row) => keyStatusOf(row) === "rotated").length;
    const revoked = historyRows.filter((row) => keyStatusOf(row) === "revoked").length;
    return { active, rotated, revoked };
  }, [historyRows, currentPublicKeyId]);

  async function handleGenerate() {
    if (!canAdminUserKeys || !effectiveUserId) return;

    setActionBusy("generate");
    setActionError("");
    setActionNotice("");

    try {
      const body = {
        key_type: String(generateForm.keyType || "rsa-2048"),
        metadata: parseMetadataInput(generateForm.metadataText),
      };

      await fetchJsonOrThrow(`/user-keys/${encodeURIComponent(effectiveUserId)}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      setActionNotice("Key generated.");
      await loadPage();
    } catch (err) {
      setActionError(err?.message || "Failed to generate key.");
    } finally {
      setActionBusy("");
    }
  }

  async function handleRevoke() {
    if (!canAdminUserKeys || !effectiveUserId) return;

    setActionBusy("revoke");
    setActionError("");
    setActionNotice("");

    try {
      await fetchJsonOrThrow(`/user-keys/${encodeURIComponent(effectiveUserId)}/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      setActionNotice("Key revoked.");
      await loadPage();
    } catch (err) {
      setActionError(err?.message || "Failed to revoke key.");
    } finally {
      setActionBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Encryption Keys
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            View current public key material and key lifecycle history.
          </p>
        </div>

        <Button type="button" variant="outline" onClick={() => void loadPage()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {pageError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {pageError}
        </div>
      ) : null}

      {actionError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {actionError}
        </div>
      ) : null}

      {actionNotice ? (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          {actionNotice}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CountCard
          title="Current key"
          value={publicKey ? "Present" : isLoading ? "Loading..." : "None"}
          hint="Current public key state."
        />
        <CountCard
          title="History entries"
          value={Number(historyTotal).toLocaleString()}
          hint="Visible key records."
        />
        <CountCard
          title="Active"
          value={Number(stats.active).toLocaleString()}
          hint="Active records."
        />
        <CountCard
          title="Rotated / Revoked"
          value={Number(stats.rotated + stats.revoked).toLocaleString()}
          hint="Inactive records."
        />
      </div>

      <EntitySection
        title="Current key"
        description="Active public key material for the selected user."
      >
        <PublicKeyCard row={publicKey} />
      </EntitySection>

      {canAdminUserKeys ? (
        <EntitySection
          title="Administration"
          description="Manage key lifecycle for a user within tenant scope."
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
              <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">
                    Target user id
                  </label>
                  <input
                    type="text"
                    value={targetUserId}
                    onChange={(e) => setTargetUserId(e.target.value)}
                    placeholder={selfUserId || "Enter a user UUID"}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    Blank uses the current authenticated user.
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setResolvedUserId(selfUserId || "");
                      setTargetUserId("");
                    }}
                  >
                    Use mine
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setResolvedUserId(String(targetUserId || "").trim() || selfUserId || "");
                    }}
                  >
                    Load user
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="border-border/60 bg-card/35 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-base">Generate key</CardTitle>
                  <CardDescription>Create a new RSA key for the selected user.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground/90">Key type</label>
                    <select
                      value={generateForm.keyType}
                      onChange={(e) => setGenerateForm((prev) => ({ ...prev, keyType: e.target.value }))}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                      disabled={actionBusy === "generate"}
                    >
                      <option value="rsa-2048">rsa-2048</option>
                      <option value="rsa-4096">rsa-4096</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground/90">Metadata JSON</label>
                    <textarea
                      value={generateForm.metadataText}
                      onChange={(e) => setGenerateForm((prev) => ({ ...prev, metadataText: e.target.value }))}
                      className="min-h-28 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                      disabled={actionBusy === "generate"}
                    />
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      disabled={actionBusy === "generate" || !effectiveUserId}
                      onClick={() => void handleGenerate()}
                    >
                      <KeyRound className="mr-2 h-4 w-4" />
                      {actionBusy === "generate" ? "Generating..." : "Generate"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-card/35 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-base">Revoke key</CardTitle>
                  <CardDescription>Revoke the active key for the selected user.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-xl border border-border/60 bg-card/25 p-3 text-sm text-muted-foreground">
                    Revoking the active key removes it from active use for the selected user.
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={actionBusy === "revoke" || !effectiveUserId}
                      onClick={() => void handleRevoke()}
                    >
                      <Ban className="mr-2 h-4 w-4" />
                      {actionBusy === "revoke" ? "Revoking..." : "Revoke"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </EntitySection>
      ) : (
        <EntitySection
          title="Administration"
          description="Lifecycle operations require tenant administrator access."
        >
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4 text-sm text-muted-foreground">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <div>Generate and revoke actions are restricted in the current context.</div>
            </div>
          </div>
        </EntitySection>
      )}

      <EntitySection
        title="History"
        description="Lifecycle records for the selected user."
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by key id, version, type, status, dates, or metadata"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
        </div>

        <div className="mt-4">
          {isLoading ? (
            <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
              Loading key history...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
              No records matched the current view.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[44px]"></TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filteredRows.map((row) => (
                  <HistoryRow
                    key={row?.id || `${row?.key_version}-${row?.created_at || ""}`}
                    row={row}
                    expanded={expandedRowId === row?.id}
                    onToggle={() => setExpandedRowId((prev) => (prev === row?.id ? null : row?.id))}
                    userId={effectiveUserId}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </EntitySection>
    </div>
  );
}