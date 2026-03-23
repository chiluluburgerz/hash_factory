import React from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  Wallet,
  KeyRound,
  ShieldCheck,
  ScrollText,
  Database,
  FlaskConical,
  RefreshCw,
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

function QuickActionCard({ title, description }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
      <div className="text-sm font-semibold text-foreground/90">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{description}</div>
    </div>
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
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Overview
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Your authenticated Hash Factory control plane for tenant-aware ingest,
            ownership, verification, and trust workflows.
          </p>
        </div>

        <Button type="button" variant="outline" onClick={() => void refreshAppContext()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Reload context
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
                Your workspace still has {Number(setup?.blockingCount ?? 0)} blocking setup task
                {Number(setup?.blockingCount ?? 0) === 1 ? "" : "s"} before trust workflows are fully ready.
              </div>
            </div>

            <Button asChild>
              <Link to="/app/setup">Open setup</Link>
            </Button>
          </div>
        </div>
      ) : null}

      <EntitySection
        title="Current context"
        description="The active authenticated user, organization, role, entitlement tier, and wallet posture."
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
              User context
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
          hint="Linked wallet identities available in this tenant."
        />
        <SummaryCard
          icon={KeyRound}
          title="Active API Keys"
          value={apiKeysError ? "ERROR" : Number(apiKeys?.active ?? 0).toLocaleString()}
          hint={
            apiKeysError
              ? "API key lookup failed. See the global error banner above."
              : "Currently active keys visible to this authenticated context."
          }
        />
        <SummaryCard
          icon={FlaskConical}
          title="Ingest Access"
          value={entitlements?.canUseIngest ? "Enabled" : "Restricted"}
          hint="User-facing anchored ingest workflows through Hash Factory."
        />
        <SummaryCard
          icon={ScrollText}
          title="Certificate Minting"
          value={entitlements?.canMintCertificates ? "Enabled" : "Restricted"}
          hint="Controls issuance posture for proof-backed certificates."
        />
      </div>

      <EntitySection
        title="Quick actions"
        description="The first workflows to make demoable as HF UI comes online."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <QuickActionCard
            title="Run ingest"
            description="Build evidence, anchor a receipt, and surface trust results."
          />
          <QuickActionCard
            title="Inspect datasets"
            description="Review registry-backed dataset identities and trust metadata."
          />
          <QuickActionCard
            title="Manage wallets"
            description="Link, review, and promote the user’s primary ownership wallet."
          />
          <QuickActionCard
            title="Verify proofs"
            description="Confirm receipts, bundles, and local object fingerprints."
          />
        </div>
      </EntitySection>

      <EntitySection
        title="What this console represents"
        description="HF is the authenticated tenant-side control plane, not just a public explorer."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <FlaskConical className="h-4 w-4" />
              Write-capable trust workflows
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              HF is where tenant users initiate ingest, registration, verification,
              and ownership-linked flows.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Database className="h-4 w-4" />
              Tenant-aware operating context
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Every workflow is grounded in user, org, role, wallet, and entitlement context.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <ShieldCheck className="h-4 w-4" />
              Verifiable user-side trust
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              The goal is not only to show public evidence, but to let users create
              and inspect it from their own authenticated surface.
            </p>
          </div>
        </div>
      </EntitySection>
    </div>
  );
}