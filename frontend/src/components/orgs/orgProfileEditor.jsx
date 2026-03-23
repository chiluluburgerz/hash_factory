import React from "react";
import { Link } from "react-router-dom";

import useAppContext from "@/app/hooks/useAppContext.js";
import { fetchJsonOrThrow } from "@/lib/apiClient.js";
import { Button } from "@/components/base/button";
import { Badge } from "@/components/base/badge";

function normalizeSlugInput(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 99);
}

function shortWallet(walletAddress) {
  const s = String(walletAddress || "").trim();
  if (!s) return "No wallet linked";
  if (s.length <= 18) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

export default function OrgProfileEditor({
  compact = false,
  onSaved = null,
  showWorkspaceLinks = true,
  smoothRefreshOnSave = false,
}) {
  const { org, entitlements, refreshAppContext } = useAppContext();

  const canManageOrg = Boolean(entitlements?.canManageOrg);

  const [form, setForm] = React.useState({
    name: String(org?.name ?? org?.raw?.name ?? "").trim(),
    slug: String(org?.slug ?? org?.raw?.slug ?? "").trim(),
    email: String(org?.email ?? org?.raw?.email ?? "").trim(),
  });

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [success, setSuccess] = React.useState("");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    setForm({
      name: String(org?.name ?? org?.raw?.name ?? "").trim(),
      slug: String(org?.slug ?? org?.raw?.slug ?? "").trim(),
      email: String(org?.email ?? org?.raw?.email ?? "").trim(),
    });
  }, [org?.name, org?.raw?.name, org?.slug, org?.raw?.slug, org?.email, org?.raw?.email]);

  function updateField(field, value) {
    setSuccess("");
    setError("");
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function refreshAfterSave() {
    if (!smoothRefreshOnSave) {
      await refreshAppContext();
      return;
    }

    const scrollY =
      typeof window !== "undefined"
        ? window.scrollY || window.pageYOffset || 0
        : 0;

    await refreshAppContext({ silent: true });

    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        window.scrollTo({
          top: scrollY,
          behavior: "auto",
        });
      });
    }
  }

  function validate() {
    const name = String(form.name || "").trim();
    const slug = normalizeSlugInput(form.slug);
    const email = String(form.email || "").trim().toLowerCase();

    if (name.length < 3 || name.length > 150) {
      throw new Error("Organization name must be between 3 and 150 characters.");
    }

    if (!slug) {
      throw new Error("Organization slug is required.");
    }

    if (!/^[a-z0-9][a-z0-9-]{0,98}$/.test(slug)) {
      throw new Error("Organization slug must contain lowercase letters, numbers, or hyphens.");
    }

    if (email && !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
      throw new Error("Organization email must be a valid email address.");
    }

    return {
      name,
      slug,
      email: email || null,
    };
  }

  async function handleSave() {
    if (!canManageOrg) {
      setError("Only a tenant admin can update organization settings.");
      return;
    }

    if (!org?.id) {
      setError("Missing active organization id.");
      return;
    }

    setIsSubmitting(true);
    setSuccess("");
    setError("");

    try {
      const payload = validate();

      await fetchJsonOrThrow(`/v1/orgs/${encodeURIComponent(org.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      await refreshAfterSave();
      setSuccess("Organization updated.");
      if (typeof onSaved === "function") onSaved();
    } catch (err) {
      const code = String(
        err?.payload?.code ??
        err?.code ??
        ""
      ).trim().toUpperCase();

      if (code.includes("SLUG") || code === "CONFLICT") {
        setError("That organization slug is already in use.");
      } else if (code.includes("EMAIL")) {
        setError("That organization email is already in use or invalid.");
      } else if (code === "INVALID_SLUG") {
        setError("Organization slug must contain lowercase letters, numbers, or hyphens.");
      } else if (code === "INVALID_NAME") {
        setError("Organization name must be between 3 and 150 characters.");
      } else if (code === "INVALID_EMAIL") {
        setError("Organization email must be a valid email address.");
      } else if (code === "FORBIDDEN") {
        setError("You do not have permission to update organization settings.");
      } else {
        setError(err?.message || "Failed to update organization.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {!compact ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/90">Billing tier</label>
            <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm text-muted-foreground">
              {org?.billingTier || "—"}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/90">Status</label>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{org?.status || "active"}</Badge>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/90">KYC</label>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{org?.kycStatus || "pending"}</Badge>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/90">Permissions</label>
            <div className="flex items-center gap-2">
              <Badge variant={canManageOrg ? "success" : "outline"}>
                {canManageOrg ? "tenant admin" : "read only"}
              </Badge>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground/90">Organization name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => updateField("name", e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
            maxLength={150}
            disabled={isSubmitting || !canManageOrg}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground/90">Organization slug</label>
          <input
            type="text"
            value={form.slug}
            onChange={(e) => updateField("slug", normalizeSlugInput(e.target.value))}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
            maxLength={99}
            disabled={isSubmitting || !canManageOrg}
          />
          <p className="text-xs text-muted-foreground">
            Lowercase letters, numbers, and hyphens only.
          </p>
        </div>

        <div className="space-y-2 lg:col-span-2">
          <label className="text-sm font-medium text-foreground/90">Organization email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => updateField("email", e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
            maxLength={255}
            disabled={isSubmitting || !canManageOrg}
            placeholder="team@example.com"
          />
        </div>

        <div className="space-y-2 lg:col-span-2">
          <label className="text-sm font-medium text-foreground/90">Organization wallet</label>
          <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-mono text-sm text-foreground/90">
                {shortWallet(org?.walletAddress ?? org?.raw?.wallet_address)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Organization wallet links and ownership changes are managed from the organization workspace.
              </div>
            </div>

            {showWorkspaceLinks ? (
              <Button asChild type="button" variant="outline" size="sm">
                <Link to="/app/org">Manage organization</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {success ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          {success}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {canManageOrg ? (
          <Button type="button" onClick={() => void handleSave()} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save organization"}
          </Button>
        ) : showWorkspaceLinks ? (
          <Button asChild type="button" variant="outline">
            <Link to="/app/org">Open organization</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}