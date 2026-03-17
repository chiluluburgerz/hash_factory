import React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RefreshCw, ShieldCheck, Trash2, Wallet } from "lucide-react";

import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import EntitySummaryCard from "@/components/entities/entity-summary-card.jsx";
import EntityKeyValueGrid from "@/components/entities/entity-key-value-grid.jsx";
import JsonBlock from "@/components/entities/json-block.jsx";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";

function extractWalletFromPayload(payload) {
  const root = payload?.result ?? payload ?? null;
  if (root && typeof root === "object" && !Array.isArray(root)) {
    if (root.wallet && typeof root.wallet === "object") return root.wallet;
    return root;
  }
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

export default function WalletDetailPage() {
  const navigate = useNavigate();
  const { walletId } = useParams();

  const [wallet, setWallet] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");
  const [actionBusy, setActionBusy] = React.useState("");

  const loadWallet = React.useCallback(async () => {
    setIsLoading(true);
    setPageError("");

    try {
      const payload = await fetchJsonOrThrow(`/v1/wallets/${encodeURIComponent(walletId || "")}`);
      const found = extractWalletFromPayload(payload);

      if (!found) {
        throw new Error("Wallet not found.");
      }

      setWallet(found);
    } catch (err) {
      setWallet(null);
      setPageError(err?.message || "Failed to load wallet.");
    } finally {
      setIsLoading(false);
    }
  }, [walletId]);

  React.useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  async function handleSetPrimary() {
    if (!wallet?.id) return;
    setActionBusy("primary");
    setPageError("");

    try {
      await fetchJsonOrThrow(`/v1/wallets/${wallet.id}/primary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await loadWallet();
    } catch (err) {
      setPageError(err?.message || "Failed to set primary wallet.");
    } finally {
      setActionBusy("");
    }
  }

  async function handleRetire() {
    if (!wallet?.id) return;
    setActionBusy("retire");
    setPageError("");

    try {
      await fetchJsonOrThrow(`/v1/wallets/${wallet.id}`, {
        method: "DELETE",
      });

      navigate("/app/wallets", {
        replace: true,
        state: {
          notice: "Wallet retired successfully.",
        },
      });
    } catch (err) {
      setPageError(err?.message || "Failed to retire wallet.");
      setActionBusy("");
    }
  }

  const status = wallet ? getWalletStatus(wallet) : "unknown";
  const trust = wallet ? getWalletTrustState(wallet) : "unknown";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            <Link to="/app/wallets" className="hover:underline">
              Wallets
            </Link>
            <span className="mx-2">/</span>
            <span>Detail</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {wallet?.wallet_address || "Wallet detail"}
          </h1>

          <p className="font-mono text-sm text-muted-foreground">
            {wallet?.id || walletId || "unknown"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void loadWallet()}>
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
          Loading wallet...
        </div>
      ) : !wallet ? (
        <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
          Wallet not found.
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <EntitySummaryCard
              title="Role"
              value={wallet?.is_primary ? "Primary" : "Secondary"}
              hint="Ownership and default-flow posture for this wallet."
              icon={Wallet}
            />

            <EntitySummaryCard
              title="Status"
              value={walletStatusLabel(status)}
              hint={status === "active" ? "Wallet currently available for use." : "Wallet has been retired."}
            />

            <EntitySummaryCard
              title="Trust state"
              value={trustLabel(trust)}
              hint={
                trust === "verified"
                  ? "Mirror-confirmed trust state."
                  : trust === "anchored"
                    ? "HCS anchor present."
                    : "No trust anchor observed yet."
              }
            />

            <EntitySummaryCard
              title="Created"
              value={wallet?.created_at ? formatRelative(wallet.created_at) : "—"}
              hint={formatDateTime(wallet?.created_at)}
            />
          </div>

          <EntitySection
            title="Wallet identity"
            description="Core ownership and identity fields for this wallet."
          >
            <EntityKeyValueGrid
              items={[
                { key: "wallet_address", label: "Wallet address", value: wallet?.wallet_address, mono: true },
                { key: "wallet_id", label: "Wallet id", value: wallet?.id, mono: true },
                { key: "user_id", label: "User id", value: wallet?.user_id, mono: true },
                { key: "org_id", label: "Org id", value: wallet?.org_id, mono: true },
                { key: "is_primary", label: "Primary", value: wallet?.is_primary ? "true" : "false" },
              ]}
            />
          </EntitySection>

          <EntitySection
            title="Trust and lifecycle"
            description="Observed anchor posture and lifecycle timestamps."
          >
            <EntityKeyValueGrid
              items={[
                { key: "mirror_verified", label: "Mirror verified", value: wallet?.mirror_verified ? "true" : "false" },
                { key: "mirror_verified_at", label: "Mirror verified at", value: formatDateTime(wallet?.mirror_verified_at) },
                { key: "hcs_topic_id", label: "HCS topic id", value: wallet?.hcs_topic_id, mono: true },
                { key: "hcs_transaction_id", label: "HCS transaction id", value: wallet?.hcs_transaction_id, mono: true },
                { key: "hcs_message_id", label: "HCS message id", value: wallet?.hcs_message_id, mono: true },
                { key: "created_at", label: "Created at", value: formatDateTime(wallet?.created_at) },
                { key: "updated_at", label: "Updated at", value: formatDateTime(wallet?.updated_at) },
                { key: "deleted_at", label: "Deleted at", value: formatDateTime(wallet?.deleted_at) },
              ]}
            />
          </EntitySection>

          <EntitySection
            title="Metadata"
            description="Wallet metadata visible to the authenticated actor."
          >
            <JsonBlock value={wallet?.metadata} emptyLabel="No metadata" />
          </EntitySection>

          <EntitySection
            title="Actions"
            description="Self-service wallet lifecycle operations."
          >
            <div className="flex flex-wrap gap-3">
              {!wallet?.is_primary && status !== "deleted" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={actionBusy === "primary"}
                  onClick={() => void handleSetPrimary()}
                >
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  {actionBusy === "primary" ? "Setting..." : "Set primary"}
                </Button>
              ) : null}

              {status !== "deleted" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={actionBusy === "retire"}
                  onClick={() => void handleRetire()}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {actionBusy === "retire" ? "Retiring..." : "Retire wallet"}
                </Button>
              ) : (
                <Badge variant="outline">Retired</Badge>
              )}

              <Badge variant={walletStatusVariant(status)}>
                {walletStatusLabel(status)}
              </Badge>
              <Badge variant={trustVariant(trust)}>
                {trustLabel(trust)}
              </Badge>
            </div>
          </EntitySection>
        </>
      )}
    </div>
  );
}