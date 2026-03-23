import React from "react";
import { Link, useParams } from "react-router-dom";
import {
  Copy,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import EntitySummaryCard from "@/components/entities/entity-summary-card.jsx";
import EntityKeyValueGrid from "@/components/entities/entity-key-value-grid.jsx";
import JsonBlock from "@/components/entities/json-block.jsx";
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

function formatRequiredDateTime(value) {
  return value ? formatDateTime(value) : "Missing";
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

function normalizeKeyRecord(payload) {
  const root = payload?.result ?? payload ?? null;
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  return root;
}

function publicKeyOf(row) {
  return row?.public_key_pem ?? row?.public_key ?? null;
}

function keyStatusOf(row) {
  const explicit = String(row?.status ?? "").trim().toLowerCase();
  if (explicit) return explicit;

  if (row?.deleted_at) return "revoked";
  if (row?.rotation_triggered_at) return "rotated";
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

function statusLabel(status) {
  switch (status) {
    case "active":
      return "active";
    case "rotated":
      return "rotated";
    case "revoked":
      return "revoked";
    case "compromised":
      return "compromised";
    case "historical":
      return "historical";
    default:
      return status || "unknown";
  }
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

export default function EncryptionKeyDetailPage() {
  const { userId, keyVersion } = useParams();

  const [keyRecord, setKeyRecord] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");

  const loadKeyRecord = React.useCallback(async () => {
    setIsLoading(true);
    setPageError("");

    try {
      const payload = await fetchJsonOrThrow(
        `/user-keys/${encodeURIComponent(userId || "")}/versions/${encodeURIComponent(keyVersion || "")}`
      );

      const found = normalizeKeyRecord(payload);
      if (!found) {
        throw new Error("Encryption key version not found.");
      }

      setKeyRecord(found);
    } catch (err) {
      setKeyRecord(null);
      setPageError(err?.message || "Failed to load encryption key version.");
    } finally {
      setIsLoading(false);
    }
  }, [userId, keyVersion]);

  React.useEffect(() => {
    void loadKeyRecord();
  }, [loadKeyRecord]);

  const status = keyStatusOf(keyRecord);
  const publicMaterial = publicKeyOf(keyRecord);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            <Link to="/app/keys" className="hover:underline">
              Keys
            </Link>
            <span className="mx-2">/</span>
            <Link to="/app/keys/encryption" className="hover:underline">
              Encryption Keys
            </Link>
            <span className="mx-2">/</span>
            <span>Detail</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Encryption Key Version {keyRecord?.key_version ?? keyVersion ?? "—"}
          </h1>

          <p className="font-mono text-sm text-muted-foreground">
            {keyRecord?.id || userId || "unknown-user"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void loadKeyRecord()}>
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

      {isLoading ? (
        <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
          Loading encryption key version...
        </div>
      ) : !keyRecord ? (
        <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
          Encryption key version not found.
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <EntitySummaryCard
              title="Status"
              value={statusLabel(status)}
              hint="Current lifecycle posture for this key version."
              icon={ShieldCheck}
            />

            <EntitySummaryCard
              title="Key type"
              value={keyRecord?.key_type || "—"}
              hint="Algorithm and modulus profile."
              icon={KeyRound}
            />

            <EntitySummaryCard
              title="Created"
              value={keyRecord?.created_at ? formatRelative(keyRecord.created_at) : "—"}
              hint={formatDateTime(keyRecord?.created_at)}
              icon={RefreshCw}
            />

            <EntitySummaryCard
              title="User"
              value={shortUuid(userId)}
              hint="Owning user for this encryption key version."
              icon={LockKeyhole}
              mono
            />
          </div>

          <EntitySection
            title="Key identity"
            description="Versioned identity fields for this encryption key record."
          >
            <EntityKeyValueGrid
              items={[
                { key: "user_id", label: "User id", value: keyRecord?.id || userId, mono: true },
                { key: "key_version", label: "Key version", value: String(keyRecord?.key_version ?? "—") },
                { key: "key_type", label: "Key type", value: keyRecord?.key_type || "—" },
                { key: "status", label: "Status", value: statusLabel(status) },
              ]}
            />
          </EntitySection>

          <EntitySection
            title="Lifecycle"
            description="Timestamps and lifecycle markers for this version."
          >
            <EntityKeyValueGrid
              items={[
                { key: "created_at", label: "Created at", value: formatRequiredDateTime(keyRecord?.created_at) },
                { key: "updated_at", label: "Updated at", value: formatRequiredDateTime(keyRecord?.updated_at) },
                { key: "rotation_triggered_at", label: "Rotation triggered at", value: formatDateTime(keyRecord?.rotation_triggered_at) },
                { key: "deleted_at", label: "Deleted at", value: formatDateTime(keyRecord?.deleted_at) },
              ]}
            />
          </EntitySection>

          <EntitySection
            title="Public key"
            description="Public material only. Private key material is never exposed here."
          >
            {!publicMaterial ? (
              <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
                No public key material is available for this record.
              </div>
            ) : (
              <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>
                  </div>
                  <CopyValueButton value={publicMaterial} />
                </div>

                <pre className="overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border/60 bg-background/60 p-3 text-xs text-foreground/85">
                  {String(publicMaterial)}
                </pre>
              </div>
            )}
          </EntitySection>

          <EntitySection
            title="Metadata"
            description="Metadata visible to the authenticated actor."
          >
            <JsonBlock value={keyRecord?.metadata} emptyLabel="No metadata" />
          </EntitySection>
        </>
      )}
    </div>
  );
}