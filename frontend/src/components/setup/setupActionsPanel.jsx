import React from "react";
import { Link } from "react-router-dom";

import { fetchJsonOrThrow } from "@/lib/apiClient.js";
import useAppContext from "@/app/hooks/useAppContext.js";
import { Badge } from "@/components/base/badge";
import { Button } from "@/components/base/button";
import OrgProfileEditor from "@/components/orgs/orgProfileEditor.jsx";
import UserProfileEditor from "@/components/users/userProfileEditor.jsx";

function parseMetadataInput(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Metadata must be a JSON object.");
  }

  return parsed;
}

export default function SetupActionsPanel({ task }) {
  const {
    user,
    org,
    membership,
    topicReadiness,
    refreshAppContext,
  } = useAppContext();

  const isTenantAdmin = String(membership?.role ?? "") === "tenant_admin";

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [success, setSuccess] = React.useState("");
  const [error, setError] = React.useState("");

  const [walletForm, setWalletForm] = React.useState({
    makePrimary: true,
    metadataText: '{\n  "source": "hf_setup",\n  "initiated_from": "setup_page"\n}',
  });

  function resetMessages() {
    setSuccess("");
    setError("");
  }

  async function refreshSetupStateSmoothly() {
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

  function renderDefaultLink(label = "Open task") {
    if (!task?.href || task.href === "/app/setup") return null;

    return (
      <Button asChild variant="outline">
        <Link to={task.href}>{label}</Link>
      </Button>
    );
  }

  async function runCreateWallet() {
    setIsSubmitting(true);
    resetMessages();

    try {
      const metadata = parseMetadataInput(walletForm.metadataText);

      const body = {
        make_primary: Boolean(walletForm.makePrimary),
        ...(metadata ? { metadata } : {}),
      };

      await fetchJsonOrThrow("/v1/wallets/me", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      setSuccess("Wallet created successfully.");
      await refreshSetupStateSmoothly();
    } catch (err) {
      setError(err?.message || "Failed to create wallet.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function runGenerateUserKey() {
    if (!user?.id) {
      setError("Missing authenticated user id.");
      return;
    }

    setIsSubmitting(true);
    resetMessages();

    try {
      await fetchJsonOrThrow(`/user-keys/${encodeURIComponent(user.id)}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key_type: "rsa-2048",
          metadata: {
            source: "hf_setup",
            initiated_from: "setup_page",
          },
        }),
      });

      setSuccess("Encryption key generated successfully.");
      await refreshSetupStateSmoothly();
    } catch (err) {
      setError(err?.message || "Failed to generate encryption key.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function runBootstrapTopics() {
    if (!org?.id) {
      setError("Missing active organization id.");
      return;
    }

    setIsSubmitting(true);
    resetMessages();

    try {
      await fetchJsonOrThrow(`/v1/orgs/${encodeURIComponent(org.id)}/hedera/topics/bootstrap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      setSuccess("Tenant topics bootstrap submitted successfully.");
      await refreshSetupStateSmoothly();
    } catch (err) {
      setError(err?.message || "Failed to bootstrap tenant topics.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function renderMessages() {
    return (
      <>
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
      </>
    );
  }

  function renderTopicReadinessSummary() {
    const readiness = task?.readiness ?? topicReadiness ?? null;
    if (!readiness) return null;

    const missing = Array.isArray(readiness.missingTopicNames)
      ? readiness.missingTopicNames
      : [];

    const present = Array.isArray(readiness.presentTopicNames)
      ? readiness.presentTopicNames
      : [];

    return (
      <div className="rounded-xl border border-border/60 bg-background/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={readiness.ready ? "success" : "warn"}>
            {readiness.ready ? "ready" : "missing topics"}
          </Badge>
          <div className="text-xs text-muted-foreground">
            {present.length} present
            {missing.length ? ` • ${missing.length} missing` : ""}
          </div>
        </div>

        {missing.length ? (
          <div className="mt-3 space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Missing topics
            </div>
            <div className="flex flex-wrap gap-2">
              {missing.map((name) => (
                <Badge key={name} variant="outline">
                  {name}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (!task) return null;

  if (task.id === "profile") {
    return (
      <div className="space-y-3">
        <UserProfileEditor
          showWorkspaceLinks={false}
          smoothRefreshOnSave
        />
        {renderMessages()}
      </div>
    );
  }

  if (task.id === "org_profile") {
    return (
      <div className="space-y-3">
        <OrgProfileEditor
          showWorkspaceLinks={false}
          smoothRefreshOnSave
        />
        {renderMessages()}
      </div>
    );
  }

  if (task.id === "wallet") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {task.status === "complete" ? (
            <Badge variant="success">linked</Badge>
          ) : (
            <>
              <Button
                type="button"
                onClick={() => void runCreateWallet()}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Creating wallet..." : "Create wallet"}
              </Button>
              {renderDefaultLink("Open wallets")}
            </>
          )}
        </div>

        {task.status !== "complete" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/90">
                Primary wallet
              </label>
              <label className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground/90">
                <input
                  type="checkbox"
                  checked={Boolean(walletForm.makePrimary)}
                  onChange={(e) =>
                    setWalletForm((prev) => ({
                      ...prev,
                      makePrimary: e.target.checked,
                    }))
                  }
                  disabled={isSubmitting}
                />
                Set the created wallet as the primary wallet
              </label>
              <p className="text-xs text-muted-foreground">
                This becomes the default wallet for ownership-oriented flows.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/90">
                Metadata JSON
              </label>
              <textarea
                value={walletForm.metadataText}
                onChange={(e) =>
                  setWalletForm((prev) => ({
                    ...prev,
                    metadataText: e.target.value,
                  }))
                }
                className="min-h-28 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                Optional. Must be a JSON object.
              </p>
            </div>
          </div>
        ) : null}

        {renderMessages()}
      </div>
    );
  }

  if (task.id === "user_key") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {task.status === "complete" ? (
            <Badge variant="success">key detected</Badge>
          ) : isTenantAdmin ? (
            <>
              <Button
                type="button"
                onClick={() => void runGenerateUserKey()}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Generating key..." : "Generate key"}
              </Button>
              {renderDefaultLink("Open keys")}
            </>
          ) : (
            <>
              {renderDefaultLink("Open keys")}
              <div className="text-sm text-muted-foreground">
                This step requires a tenant admin.
              </div>
            </>
          )}
        </div>

        {renderMessages()}
      </div>
    );
  }

  if (task.id === "topics") {
    return (
      <div className="space-y-3">
        {renderTopicReadinessSummary()}
        <div className="flex flex-wrap items-center gap-3">
          {task.status === "complete" ? (
            <Badge variant="success">bootstrapped</Badge>
          ) : isTenantAdmin ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => void runBootstrapTopics()}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Bootstrapping topics..." : "Bootstrap topics"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void refreshSetupStateSmoothly()}
                disabled={isSubmitting}
              >
                Refresh readiness
              </Button>
              {renderDefaultLink("Open Hedera")}
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              This step requires a tenant admin.
            </div>
          )}
        </div>

        {renderMessages()}
      </div>
    );
  }

  if (task.id === "first_ingest") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {task.status === "complete" ? (
            <Badge variant="success">completed</Badge>
          ) : (
            <>
              <Button asChild>
                <Link to={task.href || "/app/ingest/anchor?onboarding=first"}>
                  Start guided ingest
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/app/ingest">Open full ingest workspace</Link>
              </Button>
            </>
          )}
        </div>

        <div className="text-sm text-muted-foreground">
          This step is recommended but optional. It walks through plan, ingest, verify, and result review.
        </div>

        {renderMessages()}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {task.actionable && task.href ? (
          <Button asChild variant="outline">
            <Link to={task.href}>Open task</Link>
          </Button>
        ) : null}

        {!task.actionable && task.status === "action_required" ? (
          <div className="text-sm text-muted-foreground">
            This step requires a tenant admin.
          </div>
        ) : null}
      </div>

      {renderMessages()}
    </div>
  );
}