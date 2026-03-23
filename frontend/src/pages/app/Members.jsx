import React from "react";
import { Link } from "react-router-dom";
import {
  RefreshCw,
  Users,
  ShieldCheck,
  Search,
  Building2,
  KeyRound,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import EntitySummaryCard from "@/components/entities/entity-summary-card.jsx";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/base/table.jsx";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeOrg(payload) {
  const row = payload?.result ?? payload ?? null;
  if (!isPlainObject(row)) return null;

  return {
    id: row.id ?? row.org_id ?? null,
    name: row.name ?? row.org_name ?? "Organization",
    slug: row.slug ?? "",
    email: row.email ?? "",
    billingTier: row.billing_tier ?? row.billingTier ?? row.tier ?? null,
    status: row.status ?? null,
    kycStatus: row.kyc_status ?? row.kycStatus ?? null,
    raw: row,
  };
}

function normalizeMembersEnvelope(payload) {
  const root = payload?.result ?? payload ?? null;

  const items =
    Array.isArray(root?.items) && root.items.length > 0 ? root.items
    : Array.isArray(root?.rows) && root.rows.length > 0 ? root.rows
    : Array.isArray(root?.items) ? root.items
    : Array.isArray(root?.rows) ? root.rows
    : Array.isArray(root) ? root
    : [];

  return {
    items,
    total: Number(root?.total ?? items.length) || 0,
    limit: Number(root?.limit ?? items.length) || items.length,
    offset: Number(root?.offset ?? 0) || 0,
  };
}

function shortUuid(value) {
  const s = String(value || "").trim();
  if (!s) return "—";
  if (s.length <= 16) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
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

function statusVariant(value) {
  const s = String(value || "").trim().toLowerCase();

  if (s === "active" || s === "approved" || s === "enabled") return "success";
  if (s === "pending" || s === "restricted") return "warn";
  if (s === "disabled" || s === "deleted" || s === "rejected") return "outline";

  return "outline";
}

function roleVariant(value) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "tenant_admin") return "success";
  if (s === "editor") return "info";
  return "outline";
}

function normalizedMemberRole(row) {
  return String(row?.org_role ?? row?.role ?? "viewer").trim().toLowerCase() || "viewer";
}

function normalizedMemberStatus(row) {
  return String(row?.status ?? "unknown").trim().toLowerCase() || "unknown";
}

function memberDisplayLabel(row, isCurrentActor = false) {
  const label = String(
    row?.email ??
    row?.display_name ??
    row?.name ??
    row?.full_name ??
    ""
  ).trim();

  if (label) return label;
  if (isCurrentActor) return "Current user";
  if (row?.user_id) return shortUuid(row.user_id);
  return "Member";
}

function matchesSearch(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    row?.email,
    row?.display_name,
    row?.name,
    row?.full_name,
    row?.user_id,
    row?.id,
    row?.membership_id,
    row?.org_role,
    row?.role,
    row?.status,
  ]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");

  return haystack.includes(q);
}

export default function MembersPage() {
  const {
    isLoading: appIsLoading,
    user,
    org: appOrg,
    membership,
  } = useAppContext();

  const isTenantAdmin = String(membership?.role || "") === "tenant_admin";

  const [org, setOrg] = React.useState(appOrg ?? null);
  const [membersPage, setMembersPage] = React.useState({
    items: [],
    total: 0,
    limit: 0,
    offset: 0,
  });

  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState("");

  const [search, setSearch] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("all");
  const [statusFilter, setStatusFilter] = React.useState("all");

  const loadPage = React.useCallback(async () => {
    setIsLoading(true);
    setPageError("");

    try {
      const [orgPayload, membersPayload] = await Promise.all([
        fetchJsonOrThrow("/v1/orgs/me"),
        fetchJsonOrThrow("/v1/orgs/me/members?limit=100&offset=0"),
      ]);

      const nextOrg = normalizeOrg(orgPayload);
      const nextMembers = normalizeMembersEnvelope(membersPayload);

      if (!nextOrg) {
        throw new Error("Failed to load organization.");
      }

      setOrg(nextOrg);
      setMembersPage(nextMembers);
    } catch (err) {
      setOrg(null);
      setMembersPage({ items: [], total: 0, limit: 0, offset: 0 });
      setPageError(err?.message || "Failed to load members page.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const allItems = Array.isArray(membersPage?.items) ? membersPage.items : [];

  const visibleItems = React.useMemo(() => {
    return allItems.filter((row) => {
      const role = normalizedMemberRole(row);
      const status = normalizedMemberStatus(row);

      if (!matchesSearch(row, search)) return false;
      if (roleFilter !== "all" && role !== roleFilter) return false;
      if (statusFilter !== "all" && status !== statusFilter) return false;

      return true;
    });
  }, [allItems, search, roleFilter, statusFilter]);

  const counts = React.useMemo(() => {
    let tenantAdmins = 0;
    let editors = 0;
    let viewers = 0;
    let active = 0;

    for (const row of allItems) {
      const role = normalizedMemberRole(row);
      const status = normalizedMemberStatus(row);

      if (role === "tenant_admin") tenantAdmins += 1;
      else if (role === "editor") editors += 1;
      else viewers += 1;

      if (status === "active") active += 1;
    }

    return {
      total: Number(membersPage?.total ?? allItems.length) || 0,
      tenantAdmins,
      editors,
      viewers,
      active,
    };
  }, [allItems, membersPage?.total]);

  const showLoading = isLoading || appIsLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Members
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            View organization members, roles, and account status in one place.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/app/org">
              <Building2 className="mr-2 h-4 w-4" />
              Open organization
            </Link>
          </Button>

          <Button type="button" variant="outline" onClick={() => void loadPage()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {!showLoading && !pageError ? (
        <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isTenantAdmin ? "success" : "outline"}>
              {isTenantAdmin ? "tenant admin" : "read only"}
            </Badge>
            <Badge variant="outline">
              {org?.name || "Organization"}
            </Badge>
            {org?.billingTier ? (
              <Badge variant="outline">
                {`tier ${org.billingTier}`}
              </Badge>
            ) : null}
          </div>

          <div className="mt-3 text-sm text-muted-foreground">
            {isTenantAdmin
              ? "Review members, roles, and access status for this organization."
              : "View the members and access status available to your role."}
          </div>
        </div>
      ) : null}

      {showLoading ? (
        <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
          Loading members...
        </div>
      ) : pageError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {pageError}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <EntitySummaryCard
              title="Total members"
              value={counts.total.toLocaleString()}
              hint="People with membership records in this organization."
              icon={Users}
            />
            <EntitySummaryCard
              title="Tenant admins"
              value={counts.tenantAdmins.toLocaleString()}
              hint="Members with administrative access."
              icon={ShieldCheck}
            />
            <EntitySummaryCard
              title="Editors"
              value={counts.editors.toLocaleString()}
              hint="Members who can work within organization workflows."
              icon={KeyRound}
            />
            <EntitySummaryCard
              title="Active"
              value={counts.active.toLocaleString()}
              hint="Members currently marked active."
              icon={RefreshCw}
            />
          </div>

          <EntitySection
            title="Filters"
            description="Narrow the list by member, role, or status."
          >
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Search</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by email, name, user ID, or role"
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Role</label>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                >
                  <option value="all">All roles</option>
                  <option value="tenant_admin">Tenant admin</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/90">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
            </div>
          </EntitySection>

          <EntitySection
            title="Members"
            description="Browse organization members and their assigned roles and status."
          >
            {visibleItems.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-card/25 p-4 text-sm text-muted-foreground">
                No members match the current filters.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Membership</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {visibleItems.map((row, index) => {
                    const key =
                      row?.id ||
                      row?.membership_id ||
                      row?.user_id ||
                      `member-${index}`;

                    const role = normalizedMemberRole(row);
                    const status = normalizedMemberStatus(row);
                    const isCurrentActor =
                      String(row?.user_id || "") &&
                      String(row?.user_id || "") === String(user?.id || "");

                    const display = memberDisplayLabel(row, isCurrentActor);

                    return (
                      <TableRow key={key} className={isCurrentActor ? "bg-muted/20" : undefined}>
                        <TableCell className="min-w-[220px]">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium text-foreground/90">
                              {display}
                            </div>
                            {isCurrentActor ? (
                              <Badge variant="outline">You</Badge>
                            ) : null}
                          </div>

                          <div className="mt-1 font-mono text-xs text-muted-foreground">
                            {shortUuid(row?.user_id)}
                          </div>
                        </TableCell>

                        <TableCell>
                          <Badge variant={roleVariant(role)}>
                            {role}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          <Badge variant={statusVariant(status)}>
                            {status}
                          </Badge>
                        </TableCell>

                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {shortUuid(row?.id || row?.membership_id)}
                        </TableCell>

                        <TableCell>
                          <div className="text-sm text-foreground/85">
                            {formatRelative(row?.created_at)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {formatDateTime(row?.created_at)}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </EntitySection>
        </>
      )}
    </div>
  );
}