import React from "react";
import {
  KeyRound,
  Plus,
  RefreshCw,
  RotateCw,
  Copy,
  ShieldCheck,
  ShieldOff,
  Ban,
  Search,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import { Button } from "@/components/base/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/base/table.jsx";
import { fetchJsonOrThrow, setStoredApiKey } from "@/lib/apiClient.js";

function normalizeApiKeysEnvelope(payload) {
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
    Number(
      root?.total ??
      payload?.total ??
      rows.length
    ) || 0;

  return {
    rows,
    total,
    limit: Number(root?.limit ?? payload?.limit ?? rows.length) || rows.length,
    offset: Number(root?.offset ?? payload?.offset ?? 0) || 0,
    hasMore: Boolean(root?.hasMore ?? payload?.hasMore ?? false),
  };
}

function getApiKeyStatus(row) {
  const explicit = String(row?.status ?? "").trim().toLowerCase();
  if (explicit) return explicit;

  if (row?.deleted_at) return "deleted";
  if (row?.revoked_at) return "revoked";
  if (row?.disabled_at) return "disabled";

  const expiresAt = row?.expires_at ? Date.parse(row.expires_at) : NaN;
  if (Number.isFinite(expiresAt) && expiresAt < Date.now()) return "expired";

  return "active";
}

function statusVariant(status) {
  switch (status) {
    case "active":
      return "success";
    case "disabled":
      return "warn";
    case "revoked":
    case "deleted":
      return "outline";
    case "expired":
      return "warn";
    default:
      return "outline";
  }
}

function statusLabel(status) {
  switch (status) {
    case "active":
      return "active";
    case "disabled":
      return "disabled";
    case "revoked":
      return "revoked";
    case "deleted":
      return "deleted";
    case "expired":
      return "expired";
    default:
      return status || "unknown";
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

function parseScopesInput(raw) {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
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

function extractOneTimeSecret(payload) {
  const root = payload?.result ?? payload ?? null;
  if (!root || typeof root !== "object") return null;

  return (
    root.secret ??
    root.api_key ??
    root.apiKey ??
    root.plaintext_key ??
    root.plaintext ??
    root.token ??
    root.one_time_secret ??
    null
  );
}

function stringifyScopes(scopes) {
  return Array.isArray(scopes) ? scopes.join("\n") : "";
}

function buildRotateInitialForm(row) {
  return {
    keyHint: String(row?.key_hint ?? "").trim(),
    expiresInDays: "30",
    scopesText: stringifyScopes(row?.scopes),
    disableOld: false,
    useForSession: false,
  };
}

function matchesQuery(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    row?.key_hint,
    row?.id,
    row?.user_id,
    row?.org_id,
    ...(Array.isArray(row?.scopes) ? row.scopes : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

function summarizeScopes(scopes, maxVisible = 3) {
  const items = Array.isArray(scopes) ? scopes : [];
  if (items.length === 0) {
    return {
      visible: [],
      hiddenCount: 0,
    };
  }

  return {
    visible: items.slice(0, maxVisible),
    hiddenCount: Math.max(0, items.length - maxVisible),
  };
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
  return <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>;
}

function ScopeList({ scopes }) {
  const items = Array.isArray(scopes) ? scopes : [];
  if (items.length === 0) {
    return <span className="text-sm text-muted-foreground">No scopes</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((scope) => (
        <Badge key={scope} variant="outline">
          <span className="font-mono text-[11px]">{scope}</span>
        </Badge>
      ))}
    </div>
  );
}

function SecretRevealCard({
  secret,
  onDismiss,
  title = "New API key created",
  description = "This secret is shown only once. Copy it now and store it securely.",
}) {
  const [copied, setCopied] = React.useState(false);
  const [show, setShow] = React.useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="border-emerald-500/30 bg-emerald-500/10">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-border/60 bg-background/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 break-all font-mono text-sm text-foreground/90">
              {show ? secret : "•".repeat(Math.max(24, Math.min(secret.length, 64)))}
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShow((v) => !v)}>
                {show ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                {show ? "Hide" : "Reveal"}
              </Button>

              <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
                <Copy className="mr-2 h-4 w-4" />
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateApiKeyCard({
  canCreate,
  submitting,
  submitError,
  form,
  onChange,
  onSubmit,
}) {
  return (
    <Card className="border-border/60 bg-card/35 backdrop-blur">
      <CardHeader>
        <CardTitle className="text-base">Create API key</CardTitle>
        <CardDescription>
          Issue a new key with explicit scopes and a required expiry. Secrets are only revealed once.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {!canCreate ? (
          <div className="rounded-xl border border-border/60 bg-card/25 p-4 text-sm text-muted-foreground">
            Your current context cannot create or manage API keys.
          </div>
        ) : (
          <form
            className="grid gap-4 lg:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void onSubmit();
            }}
          >
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/90">Key hint</label>
              <input
                type="text"
                value={form.keyHint}
                onChange={(e) => onChange("keyHint", e.target.value)}
                maxLength={64}
                placeholder="analytics-ci, owner-bootstrap, demo-key"
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                Human-friendly label shown in the UI. Never a secret.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/90">Expiry (days)</label>
              <input
                type="number"
                min="1"
                max="3650"
                value={form.expiresInDays}
                onChange={(e) => onChange("expiresInDays", e.target.value)}
                placeholder="90"
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                Required. Use a bounded lifetime for every issued key.
              </p>
            </div>

            <div className="space-y-2 lg:col-span-2">
              <label className="text-sm font-medium text-foreground/90">Scopes</label>
              <textarea
                value={form.scopesText}
                onChange={(e) => onChange("scopesText", e.target.value)}
                placeholder={"api_keys:read\napi_keys:write\norgs:self:read"}
                className="min-h-32 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                Enter one scope per line or comma-separated.
              </p>
            </div>

            <div className="space-y-2 lg:col-span-2">
              <label className="text-sm font-medium text-foreground/90">Metadata JSON</label>
              <textarea
                value={form.metadataText}
                onChange={(e) => onChange("metadataText", e.target.value)}
                placeholder={'{"purpose":"hackathon-demo","surface":"hf-ui"}'}
                className="min-h-24 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
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
                {submitting ? "Creating..." : "Create key"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function RotateApiKeyCard({
  row,
  form,
  submitting,
  submitError,
  onChange,
  onSubmit,
  onCancel,
}) {
  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
      <div className="mb-4">
        <div className="text-sm font-semibold text-foreground/90">
          Rotate API key
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          A new secret will be generated and shown once. You can optionally replace the current browser session with the new key.
        </div>
      </div>

      <form
        className="grid gap-4 lg:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground/90">Current key</label>
          <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground/85">
            {row?.key_hint || "Unnamed key"}{" "}
            <span className="text-muted-foreground">({shortUuid(row?.id)})</span>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground/90">New key hint</label>
          <input
            type="text"
            value={form.keyHint}
            onChange={(e) => onChange("keyHint", e.target.value)}
            maxLength={64}
            placeholder="rotated-demo-key"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">
            Optional. Leave as-is or set a new operator-friendly hint.
          </p>
        </div>

        <div className="space-y-2">
         <label className="text-sm font-medium text-foreground/90">New expiry (days)</label>
          <input
            type="number"
            min="1"
            max="3650"
            value={form.expiresInDays}
            onChange={(e) => onChange("expiresInDays", e.target.value)}
            placeholder="90"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">
            Required. Rotated keys must also have a bounded lifetime.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground/90">Disable old key</label>
          <label className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground/90">
            <input
              type="checkbox"
              checked={Boolean(form.disableOld)}
              onChange={(e) => onChange("disableOld", e.target.checked)}
              disabled={submitting}
            />
            Disable the old key after successful rotation
          </label>
          <p className="text-xs text-muted-foreground">
            Safer after all clients have been switched to the new key.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground/90">Browser session</label>
          <label className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground/90">
            <input
              type="checkbox"
              checked={Boolean(form.useForSession)}
              onChange={(e) => onChange("useForSession", e.target.checked)}
              disabled={submitting}
            />
            Replace this browser session with the new key
          </label>
          <p className="text-xs text-muted-foreground">
            Use this when rotating the same key currently authenticating this UI.
          </p>
        </div>

        <div className="space-y-2 lg:col-span-2">
          <label className="text-sm font-medium text-foreground/90">New scopes</label>
          <textarea
            value={form.scopesText}
            onChange={(e) => onChange("scopesText", e.target.value)}
            placeholder={"api_keys:read\napi_keys:write"}
            className="min-h-28 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">
            Defaults to the current key scopes. Edit only if the rotated key should have a different scope set.
          </p>
        </div>

        {submitError ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200 lg:col-span-2">
            {submitError}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-3 lg:col-span-2">
          <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            <RotateCw className="mr-2 h-4 w-4" />
            {submitting ? "Rotating..." : "Rotate key"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function ApiKeysTableRow({
  row,
  actionState,
  rotateState,
  onArmAction,
  onCancelAction,
  onRunAction,
  onRotateFieldChange,
  onRotateSubmit,
}) {
  const status = getApiKeyStatus(row);
  const pending = actionState?.rowId === row.id ? actionState.action : null;
  const isBusy = Boolean(actionState?.busy && actionState?.rowId === row.id);
  const rotateOpen = rotateState?.rowId === row.id;
  const rotateBusy = Boolean(rotateState?.busy && rotateOpen);

  const canDisable = status === "active";
  const canEnable = status === "disabled";
  const canRevoke = status !== "revoked" && status !== "deleted";
  const canRotate = status !== "revoked" && status !== "deleted";

  const scopeSummary = summarizeScopes(row?.scopes, 3);

  return (
    <>
      <TableRow>
        <TableCell className="w-[44px]">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-card/30 hover:bg-muted/30"
            onClick={() => (rotateOpen ? onCancelAction() : onArmAction(row.id, "rotate"))}
            aria-label={rotateOpen ? "Collapse row" : "Expand row"}
          >
            {rotateOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </TableCell>

        <TableCell className="min-w-[180px]">
          <div>
            <Link
              to={`/app/api-keys/${row?.id}`}
              className="text-sm font-semibold text-foreground/90 underline-offset-4 hover:underline"
            >
              {row?.key_hint || "Unnamed key"}
            </Link>
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {shortUuid(row?.id)}
          </div>
        </TableCell>

        <TableCell>
          <StatusBadge status={status} />
        </TableCell>

        <TableCell className="min-w-[120px]">
          <div className="font-mono text-xs text-foreground/85">
            {shortUuid(row?.user_id)}
          </div>
        </TableCell>

        <TableCell className="min-w-[260px]">
          <div className="flex flex-wrap gap-2">
            {scopeSummary.visible.length === 0 ? (
              <span className="text-sm text-muted-foreground">No scopes</span>
            ) : (
              scopeSummary.visible.map((scope) => (
                <Badge key={scope} variant="outline">
                  <span className="font-mono text-[11px]">{scope}</span>
                </Badge>
              ))
            )}

            {scopeSummary.hiddenCount > 0 ? (
              <Badge variant="outline">
                +{scopeSummary.hiddenCount} more
              </Badge>
            ) : null}
          </div>
        </TableCell>

        <TableCell className="min-w-[130px]">
          <div className="text-sm text-foreground/85">
            {row?.last_used_at ? formatRelative(row.last_used_at) : "Never"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatDateTime(row?.last_used_at)}
          </div>
        </TableCell>

        <TableCell className="min-w-[130px]">
          <div className="text-sm text-foreground/85">
            {row?.expires_at ? formatRelative(row.expires_at) : "Legacy / unset"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatDateTime(row?.expires_at)}
          </div>
        </TableCell>

        <TableCell className="min-w-[260px]">
          <div className="flex flex-wrap gap-2">
            {canRotate ? (
              <Button
                type="button"
                variant={rotateOpen ? "default" : "outline"}
                size="sm"
                disabled={isBusy || rotateBusy}
                onClick={() => onArmAction(row.id, "rotate")}
              >
                <RotateCw className="mr-2 h-4 w-4" />
                Rotate
              </Button>
            ) : null}

            {canDisable ? (
              pending === "disable" ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => void onRunAction(row.id, "disable")}
                  >
                    <ShieldOff className="mr-2 h-4 w-4" />
                    {isBusy ? "Disabling..." : "Confirm"}
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
                  onClick={() => onArmAction(row.id, "disable")}
                >
                  <ShieldOff className="mr-2 h-4 w-4" />
                  Disable
                </Button>
              )
            ) : null}

            {canEnable ? (
              pending === "enable" ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => void onRunAction(row.id, "enable")}
                  >
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    {isBusy ? "Enabling..." : "Confirm"}
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
                  onClick={() => onArmAction(row.id, "enable")}
                >
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Enable
                </Button>
              )
            ) : null}

            {canRevoke ? (
              pending === "revoke" ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => void onRunAction(row.id, "revoke")}
                  >
                    <Ban className="mr-2 h-4 w-4" />
                    {isBusy ? "Revoking..." : "Confirm"}
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
                  onClick={() => onArmAction(row.id, "revoke")}
                >
                  <Ban className="mr-2 h-4 w-4" />
                  Revoke
                </Button>
              )
            ) : null}
          </div>
        </TableCell>
      </TableRow>

      {rotateOpen ? (
        <TableRow>
          <TableCell colSpan={8} className="bg-card/20">
            <RotateApiKeyCard
              row={row}
              form={rotateState.form}
              submitting={rotateBusy}
              submitError={rotateState.error}
              onChange={onRotateFieldChange}
              onSubmit={() => onRotateSubmit(row)}
              onCancel={onCancelAction}
            />
            <div className="mt-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Full scope set
              </div>
              <div className="mt-2">
                <ScopeList scopes={row?.scopes} />
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

export default function ApiKeysPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const successNotice =
    typeof location.state?.notice === "string" && location.state.notice.trim()
      ? location.state.notice.trim()
      : "";

  const {
    entitlements,
    resourceErrors,
    refreshAppContext,
  } = useAppContext();

  const canCreateApiKeys = Boolean(entitlements?.canCreateApiKeys || entitlements?.canManageApiKeys);
  const canManageApiKeys = Boolean(entitlements?.canManageApiKeys);

  const [scopeView, setScopeView] = React.useState(canManageApiKeys ? "org" : "my");
  const [rows, setRows] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [submitError, setSubmitError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [revealedSecret, setRevealedSecret] = React.useState("");
  const [revealedSecretLabel, setRevealedSecretLabel] = React.useState("New API key created");

  const [actionState, setActionState] = React.useState({
    rowId: null,
    action: null,
    busy: false,
  });

  const [rotateState, setRotateState] = React.useState({
    rowId: null,
    busy: false,
    error: "",
    form: {
      keyHint: "",
      expiresInDays: "30",
      scopesText: "",
      disableOld: false,
      useForSession: false,
    },
  });

  const [form, setForm] = React.useState({
    keyHint: "",
    expiresInDays: "30",
    scopesText: "",
    metadataText: "",
  });

  const topError = pageError || resourceErrors?.apiKeys?.message || "";

  const loadKeys = React.useCallback(async () => {
    setIsLoading(true);
    setPageError("");
    setSubmitError("");

    try {
      const path =
        scopeView === "org" && canManageApiKeys
          ? "/api-keys/org?limit=100&offset=0"
          : "/api-keys/my?limit=100&offset=0";

      const payload = await fetchJsonOrThrow(path);
      const normalized = normalizeApiKeysEnvelope(payload);

      setRows(Array.isArray(normalized.rows) ? normalized.rows : []);
      setTotal(Number(normalized.total ?? 0) || 0);
    } catch (err) {
      setRows([]);
      setTotal(0);
      setPageError(err?.message || "Failed to load API keys.");
    } finally {
      setIsLoading(false);
    }
  }, [scopeView, canManageApiKeys]);

  React.useEffect(() => {
    if (!successNotice) return;

    navigate(location.pathname + location.search, {
      replace: true,
      state: {},
    });
  }, [successNotice, navigate, location.pathname, location.search]);

  React.useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const filteredRows = React.useMemo(() => {
    return rows.filter((row) => {
      const status = getApiKeyStatus(row);
      const matchesStatus = statusFilter === "all" ? true : status === statusFilter;
      return matchesStatus && matchesQuery(row, search);
    });
  }, [rows, statusFilter, search]);

  const stats = React.useMemo(() => {
    const active = rows.filter((row) => getApiKeyStatus(row) === "active").length;
    const disabled = rows.filter((row) => getApiKeyStatus(row) === "disabled").length;
    const revoked = rows.filter((row) => getApiKeyStatus(row) === "revoked").length;
    return {
      active,
      disabled,
      revoked,
    };
  }, [rows]);

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateRotateForm(field, value) {
    setRotateState((prev) => ({
      ...prev,
      error: "",
      form: {
        ...prev.form,
        [field]: value,
      },
    }));
  }

  async function handleCreate() {
    setSubmitting(true);
    setSubmitError("");

    try {
      const scopes = parseScopesInput(form.scopesText);
      if (scopes.length === 0) {
        throw new Error("At least one scope is required.");
      }
      if (scopes.length > 32) {
        throw new Error("A maximum of 32 scopes is allowed.");
      }

      const expiresInDays = String(form.expiresInDays || "").trim();
      if (!expiresInDays) {
        throw new Error("Expiry is required for key creation.");
      }

      const metadata = parseMetadataInput(form.metadataText);

      const body = {
        ...(form.keyHint.trim() ? { key_hint: form.keyHint.trim() } : {}),
        expires_in_days: Number(expiresInDays),
        scopes,
        ...(metadata ? { metadata } : {}),
      };

      const result = await fetchJsonOrThrow("/api-keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const secret = extractOneTimeSecret(result);
      if (secret) {
        setRevealedSecret(String(secret));
        setRevealedSecretLabel("New API key created");
      }

      setForm({
        keyHint: "",
        expiresInDays: "30",
        scopesText: "",
        metadataText: "",
      });

      await loadKeys();
      await refreshAppContext();
    } catch (err) {
      setSubmitError(err?.message || "Failed to create API key.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRotate(row) {
    if (!row?.id) return;

    setRotateState((prev) => ({
      ...prev,
      busy: true,
      error: "",
    }));
    setPageError("");

    try {
      const scopes = parseScopesInput(rotateState.form.scopesText);
      if (scopes.length === 0) {
        throw new Error("At least one scope is required for rotation.");
      }
      if (scopes.length > 32) {
        throw new Error("A maximum of 32 scopes is allowed.");
      }

      const expiresInDays = String(rotateState.form.expiresInDays || "").trim();

      const body = {
        old_api_key_id: row.id,
        ...(rotateState.form.keyHint.trim() ? { new_key_hint: rotateState.form.keyHint.trim() } : {}),
        ...(expiresInDays ? { new_expires_in_days: Number(expiresInDays) } : {}),
        new_scopes: scopes,
        disable_old: Boolean(rotateState.form.disableOld),
      };

      const result = await fetchJsonOrThrow("/api-keys/rotate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const secret = extractOneTimeSecret(result);
      if (secret) {
        const nextSecret = String(secret);
        setRevealedSecret(nextSecret);
        setRevealedSecretLabel("API key rotated");

        if (rotateState.form.useForSession) {
          setStoredApiKey(nextSecret);
        }
      }

      setRotateState({
        rowId: null,
        busy: false,
        error: "",
        form: {
          keyHint: "",
          expiresInDays: "30",
          scopesText: "",
          disableOld: false,
          useForSession: false,
        },
      });

      await loadKeys();
      await refreshAppContext();
    } catch (err) {
      setRotateState((prev) => ({
        ...prev,
        busy: false,
        error: err?.message || "Failed to rotate API key.",
      }));
    }
  }

  function armAction(rowId, action) {
    if (action === "rotate") {
      const row = rows.find((r) => r?.id === rowId) ?? null;
      if (!row) return;

      setActionState({ rowId: null, action: null, busy: false });
      setRotateState({
        rowId,
        busy: false,
        error: "",
        form: buildRotateInitialForm(row),
      });
      return;
    }

    setRotateState({
      rowId: null,
      busy: false,
      error: "",
      form: {
        keyHint: "",
        expiresInDays: "30",
        scopesText: "",
        disableOld: false,
        useForSession: false,
      },
    });

    setActionState({ rowId, action, busy: false });
  }

  function cancelAction() {
    setActionState({ rowId: null, action: null, busy: false });
    setRotateState({
      rowId: null,
      busy: false,
      error: "",
      form: {
        keyHint: "",
        expiresInDays: "30",
        scopesText: "",
        disableOld: false,
        useForSession: false,
      },
    });
  }

  async function runAction(rowId, action) {
    setActionState({ rowId, action, busy: true });
    setPageError("");

    try {
      await fetchJsonOrThrow(`/api-keys/${rowId}/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      setActionState({ rowId: null, action: null, busy: false });
      await loadKeys();
      await refreshAppContext();
    } catch (err) {
      setActionState({ rowId: null, action: null, busy: false });
      setPageError(err?.message || `Failed to ${action} API key.`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            API Keys
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Create, inspect, rotate, and control API keys for authenticated Hash Factory access.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManageApiKeys ? (
            <>
              <Button
                type="button"
                variant={scopeView === "org" ? "default" : "outline"}
                onClick={() => setScopeView("org")}
              >
                Org keys
              </Button>
              <Button
                type="button"
                variant={scopeView === "my" ? "default" : "outline"}
                onClick={() => setScopeView("my")}
              >
                My keys
              </Button>
            </>
          ) : null}

          <Button type="button" variant="outline" onClick={() => void loadKeys()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {revealedSecret ? (
        <SecretRevealCard
          secret={revealedSecret}
          title={revealedSecretLabel}
          onDismiss={() => setRevealedSecret("")}
        />
      ) : null}

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
      
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CountCard
          title="Total keys"
          value={Number(total).toLocaleString()}
          hint={scopeView === "org" ? "Keys visible in this organization." : "Keys belonging to your current actor."}
        />
        <CountCard
          title="Active"
          value={Number(stats.active).toLocaleString()}
          hint="Keys currently able to authenticate requests."
        />
        <CountCard
          title="Disabled"
          value={Number(stats.disabled).toLocaleString()}
          hint="Keys paused without full revocation."
        />
        <CountCard
          title="Revoked"
          value={Number(stats.revoked).toLocaleString()}
          hint="Keys permanently taken out of service."
        />
      </div>

      <CreateApiKeyCard
        canCreate={canCreateApiKeys}
        submitting={submitting}
        submitError={submitError}
        form={form}
        onChange={updateForm}
        onSubmit={handleCreate}
      />

      <EntitySection
        title="Key inventory"
        description="Review current keys, status, scopes, expiry posture, and lifecycle actions."
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by hint, user id, key id, or scope"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {["all", "active", "disabled", "revoked", "expired"].map((value) => (
              <Button
                key={value}
                type="button"
                variant={statusFilter === value ? "default" : "outline"}
                onClick={() => setStatusFilter(value)}
              >
                {value}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          {isLoading ? (
            <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
              Loading API keys...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
              No API keys matched the current view.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[44px]"></TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filteredRows.map((row) => (
                  <ApiKeysTableRow
                    key={row.id || `${row.user_id}-${row.key_hint}`}
                    row={row}
                    actionState={actionState}
                    rotateState={rotateState}
                    onArmAction={armAction}
                    onCancelAction={cancelAction}
                    onRunAction={runAction}
                    onRotateFieldChange={updateRotateForm}
                    onRotateSubmit={handleRotate}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </EntitySection>

      <EntitySection
        title="Operational guidance"
        description="Recommended posture for secure API key lifecycle management."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <KeyRound className="h-4 w-4" />
              Least privilege
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Issue narrow scopes for each integration. Avoid broad multi-purpose keys wherever possible.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <ShieldCheck className="h-4 w-4" />
              Time-bound issuance
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Prefer expiry windows for demos, automation, and external integrations rather than perpetual credentials.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Ban className="h-4 w-4" />
              Fast revocation
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Revoke exposed or retired keys immediately. Use disable when you need a reversible pause.
            </p>
          </div>
        </div>
      </EntitySection>
    </div>
  );
}