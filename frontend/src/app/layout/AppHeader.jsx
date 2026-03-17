import React from "react";
import { Badge } from "@/components/base/badge";
import { Avatar, AvatarFallback } from "@/components/base/avatar";
import { Button } from "@/components/base/button";
import { clearStoredApiKey } from "@/lib/apiClient.js";
import useAppContext from "@/app/hooks/useAppContext.js";

function initialsFor(nameOrEmail) {
  const raw = String(nameOrEmail || "").trim();
  if (!raw) return "HF";

  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }

  return raw.slice(0, 2).toUpperCase();
}

function shortWallet(wallet) {
  const addr =
    wallet?.wallet_address ??
    wallet?.address ??
    wallet?.evm_address ??
    "";
  const s = String(addr || "").trim();
  if (!s) return "No wallet";
  if (s.length <= 14) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export default function AppHeader({ onSignedOut }) {
  const {
    isLoading,
    user,
    org,
    membership,
    entitlements,
    primaryWallet,
    apiKeys,
  } = useAppContext();

  function handleSignOut() {
    clearStoredApiKey();
    onSignedOut?.();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold tracking-tight text-foreground">
            Hash Factory
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {isLoading
              ? "Loading tenant context..."
              : org?.name || "Authenticated trust console"}
          </div>
        </div>

        <div className="hidden flex-wrap items-center gap-2 lg:flex">
          <Badge variant="outline">
            role <span className="ml-1 font-mono">{membership?.role || "—"}</span>
          </Badge>

          <Badge variant="outline">
            tier <span className="ml-1 font-mono">{entitlements?.tier || "—"}</span>
          </Badge>

          <Badge variant={primaryWallet ? "success" : "warn"}>
            wallet <span className="ml-1 font-mono">{shortWallet(primaryWallet)}</span>
          </Badge>

          <Badge variant="outline">
            keys <span className="ml-1 font-mono">{Number(apiKeys?.active ?? 0)}</span>
          </Badge>
        </div>

        <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border/60 bg-card/35 px-3 py-2">
          <Avatar className="h-9 w-9 border border-border/60">
            <AvatarFallback className="bg-muted text-xs font-semibold text-foreground/85">
              {initialsFor(user?.displayName || user?.email)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground/90">
              {user?.displayName || "User"}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {user?.email || "Authenticated session"}
            </div>
          </div>

          <Button type="button" variant="outline" size="sm" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}