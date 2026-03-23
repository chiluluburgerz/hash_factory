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

export default function UserProfileEditor({
  compact = false,
  onSaved = null,
  showWorkspaceLinks = true,
  smoothRefreshOnSave = false,
}) {
  const { user, org, membership, primaryWallet, refreshAppContext } = useAppContext();

  const initialName = String(user?.displayName ?? user?.raw?.name ?? "").trim();
  const initialSlug = String(user?.raw?.slug ?? "").trim();

  const [form, setForm] = React.useState({
    name: initialName,
    slug: initialSlug,
  });

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [success, setSuccess] = React.useState("");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    setForm({
      name: String(user?.displayName ?? user?.raw?.name ?? "").trim(),
      slug: String(user?.raw?.slug ?? "").trim(),
    });
  }, [user?.displayName, user?.raw?.name, user?.raw?.slug]);

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

    if (name.length < 3 || name.length > 150) {
      throw new Error("Name must be between 3 and 150 characters.");
    }

    if (!slug) {
      throw new Error("Slug is required.");
    }

    if (!/^[a-z0-9][a-z0-9-]{0,98}$/.test(slug)) {
      throw new Error("Slug must contain lowercase letters, numbers, or hyphens.");
    }

    return {
      name,
      slug,
    };
  }

  async function handleSave() {
    setIsSubmitting(true);
    setSuccess("");
    setError("");

    try {
      const payload = validate();

      await fetchJsonOrThrow("/v1/users/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      await refreshAfterSave();
      setSuccess("Profile updated.");
      if (typeof onSaved === "function") onSaved();
    } catch (err) {
      const code = String(
        err?.payload?.code ??
        err?.code ??
        ""
      ).trim().toUpperCase();

      if (code.includes("SLUG") || code === "CONFLICT") {
        setError("That slug is already in use.");
      } else if (code === "INVALID_SLUG") {
        setError("Slug must contain lowercase letters, numbers, or hyphens.");
      } else if (code === "INVALID_NAME") {
        setError("Name must be between 3 and 150 characters.");
      } else {
        setError(err?.message || "Failed to update profile.");
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
            <label className="text-sm font-medium text-foreground/90">Email</label>
            <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm text-muted-foreground">
              {user?.email || "—"}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/90">Organization</label>
            <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm text-muted-foreground">
              {org?.name || "—"}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/90">Role</label>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{membership?.role || "viewer"}</Badge>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/90">KYC</label>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{user?.raw?.kyc_status || "pending"}</Badge>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground/90">Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => updateField("name", e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
            maxLength={150}
            disabled={isSubmitting}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground/90">Slug</label>
          <input
            type="text"
            value={form.slug}
            onChange={(e) => updateField("slug", normalizeSlugInput(e.target.value))}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
            maxLength={99}
            disabled={isSubmitting}
          />
          <p className="text-xs text-muted-foreground">
            Lowercase letters, numbers, and hyphens only.
          </p>
        </div>

        <div className="space-y-2 lg:col-span-2">
          <label className="text-sm font-medium text-foreground/90">Primary wallet</label>
          <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-mono text-sm text-foreground/90">
                {shortWallet(
                  primaryWallet?.wallet_address ??
                  primaryWallet?.address ??
                  primaryWallet?.evm_address ??
                  user?.raw?.wallet_address
                )}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Wallet links and ownership changes are managed from the wallets workspace.
              </div>
            </div>

            {showWorkspaceLinks ? (
              <Button asChild type="button" variant="outline" size="sm">
                <Link to="/app/wallets">Manage wallets</Link>
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
        <Button type="button" onClick={() => void handleSave()} disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save profile"}
        </Button>
      </div>
    </div>
  );
}