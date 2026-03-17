import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutGrid,
  FlaskConical,
  Database,
  ScrollText,
  Wallet,
  KeyRound,
  Building2,
  ShieldCheck,
  Activity,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/base/badge";
import useAppContext from "@/app/hooks/useAppContext.js";

const navItemBase =
  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors";
const navItemInactive =
  "text-muted-foreground hover:bg-accent/60 hover:text-foreground";
const navItemActive =
  "bg-accent text-foreground ring-1 ring-border/60 shadow-sm";

function shortWallet(wallet) {
  const addr =
    wallet?.wallet_address ??
    wallet?.address ??
    wallet?.evm_address ??
    "";
  const s = String(addr || "").trim();
  if (!s) return "Not linked";
  if (s.length <= 18) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

export default function AppSidebar() {
  const {
    isLoading,
    org,
    membership,
    entitlements,
    primaryWallet,
  } = useAppContext();

  const links = [
    { to: "/app/overview", label: "Overview", icon: LayoutGrid, show: true },
    { to: "/app/ingest", label: "Ingest", icon: FlaskConical, show: true },
    { to: "/app/datasets", label: "Datasets", icon: Database, show: true },
    { to: "/app/certificates", label: "Certificates", icon: ScrollText, show: true },
    { to: "/app/wallets", label: "Wallets", icon: Wallet, show: true },
    { to: "/app/api-keys", label: "API Keys", icon: KeyRound, show: !!entitlements?.canManageApiKeys },
    { to: "/app/org", label: "Org", icon: Building2, show: true },
    { to: "/app/org/members", label: "Members", icon: Building2, show: !!entitlements?.canManageOrg },
    { to: "/app/verify", label: "Verification", icon: ShieldCheck, show: true },
    { to: "/app/activity", label: "Activity", icon: Activity, show: true },
  ].filter((x) => x.show);

  return (
    <aside className="hidden border-r border-border/60 bg-card/15 lg:block">
      <div className="sticky top-0 flex h-screen flex-col">
        <div className="border-b border-border/60 px-5 py-5">
          <div className="text-lg font-semibold tracking-tight text-foreground">
            HF Console
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Authenticated tenant trust workflows
          </div>
        </div>

        <div className="border-b border-border/60 px-5 py-4">
          <div className="space-y-3 rounded-2xl border border-border/60 bg-card/35 p-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Current org
              </div>
              <div className="mt-1 text-sm font-medium text-foreground/90">
                {isLoading ? "Loading..." : org?.name || "No org"}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                role <span className="ml-1 font-mono">{membership?.role || "—"}</span>
              </Badge>
              <Badge variant="outline">
                tier <span className="ml-1 font-mono">{entitlements?.tier || "—"}</span>
              </Badge>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Primary wallet
              </div>
              <div className="mt-1 font-mono text-xs text-foreground/85">
                {shortWallet(primaryWallet)}
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(navItemBase, isActive ? navItemActive : navItemInactive)
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{link.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}