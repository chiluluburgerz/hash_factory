import React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  RefreshCw,
  RotateCw,
  ShieldCheck,
  ShieldOff,
  Ban,
  KeyRound,
  Eye,
  EyeOff,
  Copy,
} from "lucide-react";

import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import EntitySummaryCard from "@/components/entities/entity-summary-card.jsx";
import EntityKeyValueGrid from "@/components/entities/entity-key-value-grid.jsx";
import JsonBlock from "@/components/entities/json-block.jsx";
import { fetchJsonOrThrow, setStoredApiKey } from "@/lib/apiClient.js";

function extractApiKeyFromPayload(payload) {
  const root = payload?.result ?? payload ?? null;
  if (root && typeof root === "object" && !Array.isArray(root)) {
    if (root.api_key && typeof root.api_key === "object") return root.api_key;
    if (root.item && typeof root.item === "object") return root.item;
    return root;
  }
  return null;
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

function stringifyScopes(scopes) {
  return Array.isArray(scopes) ? scopes.join("\n") : "";
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

function ScopeList({ scopes }) {
  const items = Array.isArray(scopes) ? scopes : [];
  if (items.length === 0) {
    return <div className="text-sm text-muted-foreground">No scopes</div>;
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
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
      <div className="space-y-2">
        <div className="text-base font-semibold text-foreground">{title}</div>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>

      <div className="mt-4 rounded-xl border border-border/60 bg-background/60 p-3">
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

      <div className="mt-4 flex justify-end">
        <Button type="button" variant="outline" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
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
        <div className="text-sm font-semibold text-foreground/90">Rotate API key</div>
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

export default function ApiKeyDetailPage() {
  const navigate = useNavigate();
  const { apiKeyId } = useParams();

  const [apiKey, setApiKey] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");
  const [actionBusy, setActionBusy] = React.useState("");
  const [revealedSecret, setRevealedSecret] = React.useState("");
  const [revealedSecretLabel, setRevealedSecretLabel] = React.useState("API key rotated");

  const [rotateState, setRotateState] = React.useState({
    open: false,
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

  const loadApiKey = React.useCallback(async () => {
    setIsLoading(true);
    setPageError("");

    try {
      const payload = await fetchJsonOrThrow(`/api-keys/${encodeURIComponent(apiKeyId || "")}`);
      const found = extractApiKeyFromPayload(payload);

      if (!found) {
        throw new Error("API key not found.");
      }

      setApiKey(found);
    } catch (err) {
      setApiKey(null);
      setPageError(err?.message || "Failed to load API key.");
    } finally {
      setIsLoading(false);
    }
  }, [apiKeyId]);

  React.useEffect(() => {
    void loadApiKey();
  }, [loadApiKey]);

  function openRotate() {
    if (!apiKey) return;
    setRotateState({
      open: true,
      busy: false,
      error: "",
      form: {
        keyHint: String(apiKey?.key_hint ?? "").trim(),
        expiresInDays: "30",
        scopesText: stringifyScopes(apiKey?.scopes),
        disableOld: false,
        useForSession: false,
      },
    });
  }

  function closeRotate() {
    setRotateState({
      open: false,
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

  async function handleRotate() {
    if (!apiKey?.id) return;

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
        old_api_key_id: apiKey.id,
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

      closeRotate();
      await loadApiKey();
    } catch (err) {
      setRotateState((prev) => ({
        ...prev,
        busy: false,
        error: err?.message || "Failed to rotate API key.",
      }));
    }
  }

  async function runLifecycleAction(action) {
    if (!apiKey?.id) return;

    setActionBusy(action);
    setPageError("");

    try {
      await fetchJsonOrThrow(`/api-keys/${apiKey.id}/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      if (action === "revoke") {
        navigate("/app/api-keys", {
          replace: true,
          state: {
            notice: "API key revoked successfully.",
          },
        });
        return;
      }

      await loadApiKey();
    } catch (err) {
      setPageError(err?.message || `Failed to ${action} API key.`);
      setActionBusy("");
    }
  }

  const status = apiKey ? getApiKeyStatus(apiKey) : "unknown";
  const canDisable = status === "active";
  const canEnable = status === "disabled";
  const canRotate = status !== "revoked" && status !== "deleted";
  const canRevoke = status !== "revoked" && status !== "deleted";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            <Link to="/app/api-keys" className="hover:underline">
              API Keys
            </Link>
            <span className="mx-2">/</span>
            <span>Detail</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {apiKey?.key_hint || "Unnamed key"}
          </h1>

          <p className="font-mono text-sm text-muted-foreground">
            {apiKey?.id || apiKeyId || "unknown"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void loadApiKey()}>
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

      {pageError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {pageError}
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
          Loading API key...
        </div>
      ) : !apiKey ? (
        <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
          API key not found.
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <EntitySummaryCard
              title="Status"
              value={statusLabel(status)}
              hint="Current lifecycle posture for this API key."
              icon={KeyRound}
            />

            <EntitySummaryCard
              title="Last used"
              value={apiKey?.last_used_at ? formatRelative(apiKey.last_used_at) : "Never"}
              hint={formatDateTime(apiKey?.last_used_at)}
              icon={RefreshCw}
            />

            <EntitySummaryCard
              title="Expires"
              value={apiKey?.expires_at ? formatRelative(apiKey.expires_at) : "Legacy / unset"}
              hint={formatDateTime(apiKey?.expires_at)}
              icon={ShieldCheck}
            />

            <EntitySummaryCard
              title="User"
              value={shortUuid(apiKey?.user_id)}
              hint="Owning user for this API key."
              icon={KeyRound}
              mono
            />
          </div>

          <EntitySection
            title="Key identity"
            description="Core ownership and key identity fields."
          >
            <EntityKeyValueGrid
              items={[
                { key: "id", label: "API key id", value: apiKey?.id, mono: true },
                { key: "key_hint", label: "Key hint", value: apiKey?.key_hint || "Unnamed key" },
                { key: "user_id", label: "User id", value: apiKey?.user_id, mono: true },
                { key: "org_id", label: "Org id", value: apiKey?.org_id, mono: true },
                { key: "status", label: "Status", value: statusLabel(status) },
              ]}
            />
          </EntitySection>

          <EntitySection
            title="Scopes"
            description="Authorized scope set for this key."
          >
            <ScopeList scopes={apiKey?.scopes} />
          </EntitySection>

          <EntitySection
            title="Lifecycle"
            description="Timestamps and lifecycle markers."
          >
            <EntityKeyValueGrid
              items={[
                { key: "created_at", label: "Created at", value: formatDateTime(apiKey?.created_at) },
                { key: "updated_at", label: "Updated at", value: formatDateTime(apiKey?.updated_at) },
                { key: "last_used_at", label: "Last used at", value: formatDateTime(apiKey?.last_used_at) },
                { key: "expires_at", label: "Expires at", value: formatDateTime(apiKey?.expires_at) },
                { key: "disabled_at", label: "Disabled at", value: formatDateTime(apiKey?.disabled_at) },
                { key: "revoked_at", label: "Revoked at", value: formatDateTime(apiKey?.revoked_at) },
                { key: "deleted_at", label: "Deleted at", value: formatDateTime(apiKey?.deleted_at) },
              ]}
            />
          </EntitySection>

          <EntitySection
            title="Metadata"
            description="Metadata visible to the authenticated actor."
          >
            <JsonBlock value={apiKey?.metadata} emptyLabel="No metadata" />
          </EntitySection>

          <EntitySection
            title="Actions"
            description="Lifecycle and rotation operations for this API key."
          >
            <div className="flex flex-wrap gap-3">
              {canRotate ? (
                <Button
                  type="button"
                  variant={rotateState.open ? "default" : "outline"}
                  disabled={Boolean(actionBusy)}
                  onClick={() => (rotateState.open ? closeRotate() : openRotate())}
                >
                  <RotateCw className="mr-2 h-4 w-4" />
                  {rotateState.open ? "Close rotate" : "Rotate key"}
                </Button>
              ) : null}

              {canDisable ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={actionBusy === "disable"}
                  onClick={() => void runLifecycleAction("disable")}
                >
                  <ShieldOff className="mr-2 h-4 w-4" />
                  {actionBusy === "disable" ? "Disabling..." : "Disable"}
                </Button>
              ) : null}

              {canEnable ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={actionBusy === "enable"}
                  onClick={() => void runLifecycleAction("enable")}
                >
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  {actionBusy === "enable" ? "Enabling..." : "Enable"}
                </Button>
              ) : null}

              {canRevoke ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={actionBusy === "revoke"}
                  onClick={() => void runLifecycleAction("revoke")}
                >
                  <Ban className="mr-2 h-4 w-4" />
                  {actionBusy === "revoke" ? "Revoking..." : "Revoke"}
                </Button>
              ) : null}

              <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>
            </div>

            {rotateState.open ? (
              <div className="mt-4">
                <RotateApiKeyCard
                  row={apiKey}
                  form={rotateState.form}
                  submitting={rotateState.busy}
                  submitError={rotateState.error}
                  onChange={updateRotateForm}
                  onSubmit={handleRotate}
                  onCancel={closeRotate}
                />
              </div>
            ) : null}
          </EntitySection>
        </>
      )}
    </div>
  );
}