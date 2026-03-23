import React from "react";
import {
  Building2,
  RefreshCw,
  ShieldCheck,
  Users,
  Wallet,
  ScrollText,
  Layers3,
  Pencil,
  Save,
  X,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import CollapsibleSection from "@/components/base/collapsible-section.jsx";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import EntitySummaryCard from "@/components/entities/entity-summary-card.jsx";
import EntityKeyValueGrid from "@/components/entities/entity-key-value-grid.jsx";
import JsonBlock from "@/components/entities/json-block.jsx";
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

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function asBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (["true", "1", "yes", "enabled", "on"].includes(s)) return true;
    if (["false", "0", "no", "disabled", "off"].includes(s)) return false;
  }
  return fallback;
}

function shortUuid(value) {
  const s = String(value || "").trim();
  if (!s) return "—";
  if (s.length <= 16) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

function shortWallet(value) {
  const s = String(value || "").trim();
  if (!s) return "—";
  if (s.length <= 20) return s;
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

function statusVariant(value) {
  const s = String(value || "").trim().toLowerCase();

  if (s === "active" || s === "approved" || s === "enabled") return "success";
  if (s === "pending" || s === "restricted") return "warn";
  if (s === "deleted" || s === "disabled" || s === "rejected") return "outline";

  return "outline";
}

function normalizeOrg(payload) {
  const row = payload?.result ?? payload ?? null;
  if (!isPlainObject(row)) return null;

  return {
    id: row.id ?? row.org_id ?? null,
    name: row.name ?? row.org_name ?? "Organization",
    slug: row.slug ?? "",
    email: row.email ?? "",
    walletAddress: row.wallet_address ?? row.walletAddress ?? null,
    status: row.status ?? null,
    kycStatus: row.kyc_status ?? row.kycStatus ?? null,
    billingTier: row.billing_tier ?? row.billingTier ?? row.tier ?? null,
    description: row.description ?? "",
    metadata: isPlainObject(row.metadata) ? row.metadata : row.metadata ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
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

function normalizeEffectiveEntitlements(payload) {
  const root = payload?.result ?? payload ?? null;
  return isPlainObject(root) ? root : {};
}

function derivePolicyState(effectiveEntitlements, appEntitlements, membershipRole) {
  const tier = firstDefined(
    effectiveEntitlements?.billing?.tier,
    effectiveEntitlements?.billing_tier,
    effectiveEntitlements?.tier,
    appEntitlements?.tier,
    null
  );

  const explorerEnabled = asBool(
    firstDefined(
      effectiveEntitlements?.explorer?.enabled
    ),
    true
  );

  const hederaEnabled = asBool(
    firstDefined(
      effectiveEntitlements?.hedera?.enabled
    ),
    false
  );

  const merkleEnabled = asBool(
    firstDefined(
      effectiveEntitlements?.merkle?.enabled
    ),
    false
  );

  const isTenantAdmin = String(membershipRole || "") === "tenant_admin";

  return {
    tier,
    explorerEnabled,
    hederaEnabled,
    merkleEnabled,
    isTenantAdmin,
  };
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

function parseMetadataInput(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Metadata must be a JSON object.");
  }
  return parsed;
}

export default function OrgPage() {
  const {
    isLoading: appIsLoading,
    org: appOrg,
    membership,
    entitlements: appEntitlements,
    primaryWallet,
    refreshAppContext,
  } = useAppContext();

  const isTenantAdmin = String(membership?.role || "") === "tenant_admin";

  const [org, setOrg] = React.useState(appOrg ?? null);
  const [membersPage, setMembersPage] = React.useState({ items: [], total: 0, limit: 0, offset: 0 });
  const [effectiveEntitlements, setEffectiveEntitlements] = React.useState({});
  const [pageError, setPageError] = React.useState("");
  const [membersError, setMembersError] = React.useState("");
  const [entitlementsError, setEntitlementsError] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(true);

  const [isEditing, setIsEditing] = React.useState(false);
  const [saveBusy, setSaveBusy] = React.useState(false);
  const [saveError, setSaveError] = React.useState("");
  const [saveNotice, setSaveNotice] = React.useState("");

  const [kycBusy, setKycBusy] = React.useState(false);
  const [kycError, setKycError] = React.useState("");

  const [form, setForm] = React.useState({
    name: "",
    slug: "",
    email: "",
    description: "",
    metadataText: "",
  });

  const syncFormFromOrg = React.useCallback((nextOrg) => {
    setForm({
      name: String(nextOrg?.name ?? ""),
      slug: String(nextOrg?.slug ?? ""),
      email: String(nextOrg?.email ?? ""),
      description: String(nextOrg?.description ?? ""),
      metadataText: nextOrg?.metadata ? JSON.stringify(nextOrg.metadata, null, 2) : "",
    });
  }, []);

  React.useEffect(() => {
    if (appOrg && !org?.id) {
      setOrg(appOrg);
      syncFormFromOrg(appOrg);
    }
  }, [appOrg, org?.id, syncFormFromOrg]);

  const loadPage = React.useCallback(async () => {
    setIsLoading(true);
    setPageError("");
    setMembersError("");
    setEntitlementsError("");

    try {
      const orgPayload = await fetchJsonOrThrow("/v1/orgs/me");
      const nextOrg = normalizeOrg(orgPayload);

      if (!nextOrg) {
        throw new Error("Failed to load organization.");
      }

      setOrg(nextOrg);
      syncFormFromOrg(nextOrg);

      await Promise.all([
        fetchJsonOrThrow("/v1/org-entitlements/me/effective")
          .then((payload) => {
            setEffectiveEntitlements(normalizeEffectiveEntitlements(payload));
          })
          .catch((err) => {
            setEffectiveEntitlements({});
            setEntitlementsError(err?.message || "Failed to load effective entitlements.");
          }),
        fetchJsonOrThrow("/v1/orgs/me/members?limit=100&offset=0")
          .then((payload) => {
            setMembersPage(normalizeMembersEnvelope(payload));
          })
          .catch((err) => {
            setMembersPage({ items: [], total: 0, limit: 0, offset: 0 });
            setMembersError(err?.message || "Failed to load organization members.");
          }),
      ]);
    } catch (err) {
      setOrg(null);
      setMembersPage({ items: [], total: 0, limit: 0, offset: 0 });
      setEffectiveEntitlements({});
      setPageError(err?.message || "Failed to load organization page.");
    } finally {
      setIsLoading(false);
    }
  }, [syncFormFromOrg]);

  React.useEffect(() => {
    void loadPage();
  }, [loadPage]);

  function updateForm(field, value) {
    setSaveError("");
    setSaveNotice("");
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function cancelEdit() {
    syncFormFromOrg(org);
    setIsEditing(false);
    setSaveError("");
    setSaveNotice("");
  }

  async function handleSave() {
    if (!org?.id) return;

    setSaveBusy(true);
    setSaveError("");
    setSaveNotice("");

    try {
      const metadata = parseMetadataInput(form.metadataText);

      const body = {
        name: String(form.name || "").trim(),
        slug: String(form.slug || "").trim() || null,
        email: String(form.email || "").trim() || undefined,
        description: String(form.description || "").trim() || null,
        metadata,
      };

      const payload = await fetchJsonOrThrow(`/v1/orgs/${encodeURIComponent(org.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const updated = normalizeOrg(payload);
      if (!updated) {
        throw new Error("Organization update returned an invalid response.");
      }

      setOrg(updated);
      syncFormFromOrg(updated);
      setIsEditing(false);
      await refreshAppContext();
      await loadPage();
      setSaveNotice("Organization profile updated.");
    } catch (err) {
      setSaveError(err?.message || "Failed to save organization changes.");
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleSetKyc(nextStatus) {
    if (!org?.id) return;
    if (String(org?.kycStatus || "") === String(nextStatus)) return;

    setKycBusy(true);
    setKycError("");
    setSaveNotice("");

    try {
      const payload = await fetchJsonOrThrow(`/v1/orgs/${encodeURIComponent(org.id)}/kyc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ kyc_status: nextStatus }),
      });

      const updated = normalizeOrg(payload);
      if (!updated) {
        throw new Error("KYC update returned an invalid response.");
      }

      setOrg(updated);
      syncFormFromOrg(updated);
      await refreshAppContext();
      await loadPage();
      setSaveNotice(`KYC status updated to ${nextStatus}.`);
    } catch (err) {
      setKycError(err?.message || "Failed to update KYC status.");
    } finally {
      setKycBusy(false);
    }
  }

  const policy = React.useMemo(
    () => derivePolicyState(effectiveEntitlements, appEntitlements, membership?.role),
    [effectiveEntitlements, appEntitlements, membership?.role]
  );

  const billingTier = firstDefined(policy.tier, org?.billingTier, appOrg?.billingTier, "—");
  const orgStatus = org?.status || appOrg?.status || "unknown";
  const kycStatus = org?.kycStatus || appOrg?.kycStatus || "unknown";
  const memberCount = Number(membersPage?.total ?? membersPage?.items?.length ?? 0) || 0;

  const orgWallet = firstDefined(
    org?.walletAddress,
    appOrg?.walletAddress,
    primaryWallet?.wallet_address,
    primaryWallet?.address,
    primaryWallet?.evm_address,
    null
  );

  const updatedAt = firstDefined(org?.updatedAt, org?.raw?.updated_at, appOrg?.raw?.updated_at, null);
  const createdAt = firstDefined(org?.createdAt, org?.raw?.created_at, appOrg?.raw?.created_at, null);

  const showLoading = isLoading || appIsLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Organization
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Review your tenant identity, admin posture, members, and effective operating policy for Hash Factory.
          </p>
        </div>

        <Button type="button" variant="outline" onClick={() => void loadPage()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {saveNotice ? (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          {saveNotice}
        </div>
      ) : null}

      {showLoading ? (
        <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
          Loading organization...
        </div>
      ) : pageError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {pageError}
        </div>
      ) : !org ? (
        <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
          Organization not found.
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <EntitySummaryCard
              title="Billing tier"
              value={String(billingTier || "—")}
              hint="Effective plan and entitlement posture for this tenant."
              icon={Layers3}
            />
            <EntitySummaryCard
              title="KYC"
              value={String(kycStatus || "unknown")}
              hint="Current organizational KYC status."
              icon={ShieldCheck}
            />
            <EntitySummaryCard
              title="Members"
              value={Number(memberCount).toLocaleString()}
              hint="Visible organization membership records."
              icon={Users}
            />
            <EntitySummaryCard
              title="Updated"
              value={formatRelative(updatedAt)}
              hint={formatDateTime(updatedAt)}
              icon={RefreshCw}
            />
          </div>

          <EntitySection
            title="Organization posture"
            description="Identity, current status, wallet posture, and effective HF readiness."
          >
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" />
                  Organization
                </div>
                <div className="mt-2 text-lg font-semibold text-foreground/90">
                  {org?.name || "Unnamed organization"}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {org?.slug ? `slug: ${org.slug}` : "No slug configured"}
                </div>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Status
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant={statusVariant(orgStatus)}>{String(orgStatus || "unknown")}</Badge>
                  <Badge variant={isTenantAdmin ? "success" : "outline"}>
                    {`role ${membership?.role || "unknown"}`}
                  </Badge>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Billing tier: {String(billingTier || "—")}
                </div>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Wallet className="h-3.5 w-3.5" />
                  Wallet
                </div>
                <div className="mt-2 font-mono text-sm text-foreground/90">
                  {shortWallet(orgWallet)}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Wallet Address
                </div>
              </div>
            </div>
          </EntitySection>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              icon={ShieldCheck}
              title="Explorer"
              value={policy.explorerEnabled ? "Enabled" : "Restricted"}
              hint="Public explorer visibility for this org."
            />
            <SummaryCard
              icon={Wallet}
              title="Hedera"
              value={policy.hederaEnabled ? "Enabled" : "Restricted"}
              hint="Hedera-integrated workflows allowed by effective policy."
            />
            <SummaryCard
              icon={ScrollText}
              title="Merkle"
              value={policy.merkleEnabled ? "Enabled" : "Restricted"}
              hint="Merkle-linked trust and anchor flows."
            />
            <SummaryCard
              icon={Users}
              title="Tenant admin"
              value={isTenantAdmin ? "Yes" : "No"}
              hint="Whether this actor can use admin-gated org routes."
            />
          </div>

          <EntitySection
            title="Organization identity"
            description="Core organization fields visible to the authenticated actor."
          >
            <EntityKeyValueGrid
              items={[
                { key: "id", label: "Org id", value: org?.id, mono: true },
                { key: "name", label: "Name", value: org?.name || "—" },
                { key: "slug", label: "Slug", value: org?.slug || "—" },
                { key: "email", label: "Email", value: org?.email || "—" },
                { key: "wallet_address", label: "Wallet", value: orgWallet || "—", mono: true },
                { key: "status", label: "Status", value: orgStatus },
                { key: "kyc_status", label: "KYC", value: kycStatus },
                { key: "billing_tier", label: "Billing tier", value: String(billingTier || "—") },
                { key: "created_at", label: "Created at", value: formatDateTime(createdAt) },
                { key: "updated_at", label: "Updated at", value: formatDateTime(updatedAt) },
              ]}
            />
          </EntitySection>

          <CollapsibleSection
            title="Profile settings"
            description="Tenant-admin management for core organization identity fields."
            defaultCollapsed={true}
            toggleSide="right"
          >
            {!isTenantAdmin ? (
              <div className="rounded-2xl border border-border/60 bg-card/25 p-4 text-sm text-muted-foreground">
                Your current actor can view organization state, but tenant-admin privileges are required for editing.
              </div>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap gap-2">
                  {!isEditing ? (
                    <Button type="button" variant="outline" onClick={() => setIsEditing(true)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit profile
                    </Button>
                  ) : (
                    <>
                      <Button type="button" disabled={saveBusy} onClick={() => void handleSave()}>
                        <Save className="mr-2 h-4 w-4" />
                        {saveBusy ? "Saving..." : "Save changes"}
                      </Button>
                      <Button type="button" variant="outline" disabled={saveBusy} onClick={cancelEdit}>
                        <X className="mr-2 h-4 w-4" />
                        Cancel
                      </Button>
                    </>
                  )}
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground/90">Name</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => updateForm("name", e.target.value)}
                      disabled={!isEditing || saveBusy}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                      placeholder="Organization name"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground/90">Slug</label>
                    <input
                      type="text"
                      value={form.slug}
                      onChange={(e) => updateForm("slug", e.target.value)}
                      disabled={!isEditing || saveBusy}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                      placeholder="organization-slug"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground/90">Email</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => updateForm("email", e.target.value)}
                      disabled={!isEditing || saveBusy}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                      placeholder="team@example.com"
                    />
                  </div>

                  <div className="space-y-2 lg:col-span-2">
                    <label className="text-sm font-medium text-foreground/90">Description</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => updateForm("description", e.target.value)}
                      disabled={!isEditing || saveBusy}
                      className="min-h-28 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                      placeholder="Short organization description"
                    />
                  </div>

                  <div className="space-y-2 lg:col-span-2">
                    <label className="text-sm font-medium text-foreground/90">Metadata JSON</label>
                    <textarea
                      value={form.metadataText}
                      onChange={(e) => updateForm("metadataText", e.target.value)}
                      disabled={!isEditing || saveBusy}
                      className="min-h-32 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                      placeholder='{"surface":"hf-ui"}'
                    />
                  </div>
                </div>

                {saveError ? (
                  <div className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
                    {saveError}
                  </div>
                ) : null}
              </>
            )}
          </CollapsibleSection>

          <EntitySection
            title="Members"
            description="Organization membership currently visible to this actor."
          >
            {membersError ? (
              <div className="rounded-2xl border border-border/60 bg-card/25 p-4 text-sm text-muted-foreground">
                {membersError}
              </div>
            ) : membersPage.items.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-card/25 p-4 text-sm text-muted-foreground">
                No members were returned for this organization.
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
                  {membersPage.items.map((row, index) => {
                    const key = row?.id || row?.membership_id || row?.user_id || `member-${index}`;
                    const role = row?.org_role || row?.role || "—";
                    const status = row?.status || "—";

                    return (
                      <TableRow key={key}>
                        <TableCell className="min-w-[180px]">
                          <div className="font-mono text-xs text-foreground/90">
                            {shortUuid(row?.user_id)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {row?.email || row?.display_name || row?.name || "Member"}
                          </div>
                        </TableCell>

                        <TableCell>
                          <Badge variant={String(role) === "tenant_admin" ? "success" : "outline"}>
                            {String(role)}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          <Badge variant={statusVariant(status)}>
                            {String(status)}
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

          <CollapsibleSection
            title="Effective policy"
            description="Derived organization policy currently shaping explorer, Hedera, and Merkle behavior."
            defaultCollapsed={true}
            toggleSide="right"
          >
            {entitlementsError ? (
              <div className="rounded-2xl border border-border/60 bg-card/25 p-4 text-sm text-muted-foreground">
                {entitlementsError}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
                    <ShieldCheck className="h-4 w-4" />
                    Explorer
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {policy.explorerEnabled
                      ? "Read-oriented explorer access is enabled."
                      : "Explorer access is restricted."}
                  </p>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
                    <Wallet className="h-4 w-4" />
                    Hedera
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {policy.hederaEnabled
                      ? "Hedera-backed flows are enabled."
                      : "Hedera-backed flows are restricted."}
                  </p>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
                    <ScrollText className="h-4 w-4" />
                    Merkle
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {policy.merkleEnabled
                      ? "Merkle trust and anchor flows are enabled."
                      : "Merkle trust and anchor flows are restricted."}
                  </p>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
                    <Layers3 className="h-4 w-4" />
                    Billing
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Tier: {effectiveEntitlements?.billing?.tier ?? "—"}
                  </p>
                </div>
              </div>
            )}

            <div className="mt-4">
              <JsonBlock
                value={effectiveEntitlements}
                emptyLabel="No effective policy returned"
              />
            </div>
          </CollapsibleSection>

          {org?.metadata &&
          typeof org.metadata === "object" &&
          !Array.isArray(org.metadata) &&
          Object.keys(org.metadata).length > 0 ? (
            <EntitySection
              title="Organization metadata"
              description="Raw metadata associated with this organization."
            >
              <JsonBlock value={org.metadata} emptyLabel="No metadata" />
            </EntitySection>
          ) : null}
        </>
      )}
    </div>
  );
}