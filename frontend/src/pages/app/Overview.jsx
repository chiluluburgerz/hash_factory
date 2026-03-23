import React from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  Wallet,
  KeyRound,
  ShieldCheck,
  ScrollText,
  FlaskConical,
  RefreshCw,
  Database,
  ArrowRight,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import { Button } from "@/components/base/button";

function shortWallet(wallet) {
  const addr =
    wallet?.wallet_address ??
    wallet?.address ??
    wallet?.evm_address ??
    "";
  const s = String(addr || "").trim();
  if (!s) return "No wallet linked";
  if (s.length <= 20) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

function SummaryCard({ icon: Icon, title, value, hint }) {
  return (
    <Card className="border-border/60 bg-card/35 backdrop-blur">
      <CardHeader className="pb-3">
        <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
          <Icon className="h-3.5 w-3.5" />
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

function QuickActionCard({ icon: Icon, title, description, to }) {
  return (
    <Link
      to={to}
      className="group rounded-2xl border border-border/60 bg-card/25 p-4 transition-colors hover:bg-card/50 hover:border-border/80 block"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          {title}
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{description}</div>
    </Link>
  );
}

export default function OverviewPage() {
  const {
    isLoading,
    user,
    org,
    membership,
    entitlements,
    wallets,
    primaryWallet,
    apiKeys,
    resourceErrors,
    refreshAppContext,
    setup,
  } = useAppContext();

  const apiKeysError = resourceErrors?.apiKeys ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Overview
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Your Hash Factory control plane. Seamlessly ingest, anchor, verify, and manage your evidence workflows.
          </p> 
        </div>

        <Button type="button" variant="outline" onClick={() => void refreshAppContext()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {!isLoading && !setup?.isReady ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-foreground">
                Setup incomplete
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {Number(setup?.blockingCount ?? 0)} blocking task
                {Number(setup?.blockingCount ?? 0) === 1 ? "" : "s"} remaining before trust workflows are active.
              </div>
            </div>
            <Button asChild>
              <Link to="/app/setup">Complete setup</Link>
            </Button>
          </div>
        </div>
      ) : null}

      <EntitySection
        title="Active context"
        description="Your current organization, role, entitlement tier, and linked wallet."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              Organization
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground/90">
              {isLoading ? "Loading..." : org?.name || "No org"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Tier: {entitlements?.tier || "—"}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Signed in as
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground/90">
              {user?.displayName || user?.email || "Authenticated user"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Role: {membership?.role || "—"}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" />
              Primary wallet
            </div>
            <div className="mt-2 font-mono text-sm text-foreground/90">
              {shortWallet(primaryWallet)}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {Number(wallets?.length ?? 0)} wallet{Number(wallets?.length ?? 0) === 1 ? "" : "s"} linked
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant={entitlements?.canUseIngest ? "success" : "warn"}>
            ingest {entitlements?.canUseIngest ? "enabled" : "restricted"}
          </Badge>
          <Badge variant={entitlements?.canUseDatasets ? "success" : "warn"}>
            datasets {entitlements?.canUseDatasets ? "enabled" : "restricted"}
          </Badge>
          <Badge variant={entitlements?.canMintCertificates ? "success" : "warn"}>
            certificates {entitlements?.canMintCertificates ? "enabled" : "restricted"}
          </Badge>
          <Badge variant={entitlements?.canManageApiKeys ? "info" : "outline"}>
            api key admin {entitlements?.canManageApiKeys ? "available" : "limited"}
          </Badge>
        </div>
      </EntitySection>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={Wallet}
          title="Wallets"
          value={Number(wallets?.length ?? 0).toLocaleString()}
          hint="Linked Hedera wallet identities."
        />
        <SummaryCard
          icon={KeyRound}
          title="Active API keys"
          value={apiKeysError ? "Error" : Number(apiKeys?.active ?? 0).toLocaleString()}
          hint={
            apiKeysError
              ? "Key lookup failed — check the error banner."
              : "Active keys for this account."
          }
        />
        <SummaryCard
          icon={FlaskConical}
          title="Ingest"
          value={entitlements?.canUseIngest ? "Enabled" : "Restricted"}
          hint="Anchored ingest workflows through Hash Factory."
        />
        <SummaryCard
          icon={ScrollText}
          title="Certificates"
          value={entitlements?.canMintCertificates ? "Enabled" : "Restricted"}
          hint="Proof-backed HTS certificate minting."
        />
      </div>

      <EntitySection
        title="Quick actions"
        description="Jump directly into your most common workflows."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <QuickActionCard
            icon={FlaskConical}
            title="Start ingest"
            description="Submit and anchor a new evidence package."
            to="/app/ingest/submit"
          />
          <QuickActionCard
            icon={Database}
            title="View datasets"
            description="Browse your anchored datasets and trust metadata."
            to="/app/datasets"
          />
          <QuickActionCard
            icon={Wallet}
            title="Manage wallets"
            description="View and manage your linked Hedera wallets."
            to="/app/wallets"
          />
          <QuickActionCard
            icon={ShieldCheck}
            title="Verify a proof"
            description="Confirm receipts, bundles, and evidence fingerprints."
            to="/app/verify"
          />
        </div>
      </EntitySection>
    </div>
  );
}
