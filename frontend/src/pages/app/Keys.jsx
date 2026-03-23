import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Wallet,
  Database,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";

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

function shortValue(value, left = 12, right = 10) {
  const s = String(value || "").trim();
  if (!s) return "—";
  if (s.length <= left + right + 3) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

function normalizeUserKeyPublic(payload) {
  const root = payload?.result ?? payload ?? null;
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  return root;
}

function CountCard({ icon: Icon, title, value, hint }) {
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

function PillarCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  badges,
  to,
  cta,
}) {
  return (
    <Card className="border-border/60 bg-card/35 backdrop-blur">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {eyebrow}
        </div>
        <CardTitle className="text-xl tracking-tight">{title}</CardTitle>
        <CardDescription className="max-w-2xl text-sm leading-6">
          {description}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(Array.isArray(badges) ? badges : []).map((item) => (
            <Badge key={item.label} variant={item.variant || "outline"}>
              {item.label}
            </Badge>
          ))}
        </div>

        <div className="flex justify-end">
          <Button asChild>
            <Link to={to}>
              {cta}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function KeysPage() {
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
  } = useAppContext();

  const [userKeyPublic, setUserKeyPublic] = React.useState(null);
  const [userKeyError, setUserKeyError] = React.useState("");
  const [userKeyLoading, setUserKeyLoading] = React.useState(true);

  const apiKeysError = resourceErrors?.apiKeys ?? null;
  const canManageApiKeys = Boolean(entitlements?.canManageApiKeys || entitlements?.canCreateApiKeys);
  const canAdminUserKeys = String(membership?.role || "") === "tenant_admin";

  const loadUserKeyPublic = React.useCallback(async () => {
    setUserKeyLoading(true);
    setUserKeyError("");

    try {
      const payload = await fetchJsonOrThrow("/user-keys/me/public");
      setUserKeyPublic(normalizeUserKeyPublic(payload));
    } catch (err) {
      setUserKeyPublic(null);
      setUserKeyError(err?.message || "Failed to load encryption key status.");
    } finally {
      setUserKeyLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadUserKeyPublic();
  }, [loadUserKeyPublic]);

  const publicKeyMaterial =
    userKeyPublic?.public_key_pem ??
    userKeyPublic?.public_key ??
    null;

  const encryptionStatus =
    userKeyLoading
      ? "Loading..."
      : userKeyPublic
        ? "Active"
        : userKeyError
          ? "Unavailable"
          : "Not provisioned";

  const encryptionHint =
    userKeyLoading
      ? "Loading current key state."
      : userKeyPublic
        ? `Visible ${shortValue(publicKeyMaterial, 18, 12)}`
        : userKeyError
          ? "Unable to load current key state."
          : "No active key is available.";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Keys
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Manage API credentials and user encryption keys.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void refreshAppContext();
            void loadUserKeyPublic();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <EntitySection
        title="Current context"
        description="Authenticated user, organization, and primary wallet."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              User
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
              <Database className="h-3.5 w-3.5" />
              Organization
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground/90">
              {isLoading ? "Loading..." : org?.name || "No organization"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Tier: {entitlements?.tier || "—"}
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
      </EntitySection>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CountCard
          icon={KeyRound}
          title="Active API Keys"
          value={apiKeysError ? "Error" : Number(apiKeys?.active ?? 0).toLocaleString()}
          hint={
            apiKeysError
              ? "API key data unavailable."
              : "Currently active credentials."
          }
        />
        <CountCard
          icon={LockKeyhole}
          title="Encryption Key"
          value={encryptionStatus}
          hint={encryptionHint}
        />
        <CountCard
          icon={KeyRound}
          title="API Key Access"
          value={canManageApiKeys ? "Available" : "Restricted"}
          hint="Create and manage API keys."
        />
        <CountCard
          icon={ShieldCheck}
          title="Encryption Key Access"
          value={canAdminUserKeys ? "Admin" : "Restricted"}
          hint="Generate, rotate, and revoke user keys."
        />
      </div>

      <EntitySection
        title="Key surfaces"
        description="Separate surfaces for access credentials and encryption key lifecycle."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <PillarCard
            icon={KeyRound}
            eyebrow="Access"
            title="API Keys"
            description="Scoped credentials for clients, automation, and authenticated workflows."
            badges={[
              { label: "scoped", variant: "outline" },
              { label: "expiring", variant: "outline" },
              { label: "rotatable", variant: "outline" },
              { label: canManageApiKeys ? "manageable" : "restricted", variant: canManageApiKeys ? "info" : "outline" },
            ]}
            to="/app/api-keys"
            cta="Open API keys"
          />

          <PillarCard
            icon={LockKeyhole}
            eyebrow="Encryption"
            title="Encryption Keys"
            description="Public-key state and lifecycle history for protected workflows."
            badges={[
              { label: "public material only", variant: "outline" },
              { label: "history", variant: "outline" },
              { label: "no private key exposure", variant: "success" },
              { label: canAdminUserKeys ? "admin lifecycle" : "restricted", variant: canAdminUserKeys ? "info" : "outline" },
            ]}
            to="/app/keys/encryption"
            cta="Open encryption keys"
          />
        </div>
      </EntitySection>
    </div>
  );
}