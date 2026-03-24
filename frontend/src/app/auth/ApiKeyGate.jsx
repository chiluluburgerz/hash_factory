import React from "react";
import {
  setStoredApiKey,
  getStoredApiKey,
  clearStoredApiKey,
  fetchJsonOrThrow,
} from "@/lib/apiClient.js";
import { Button } from "@/components/base/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/base/card";
import { Badge } from "@/components/base/badge";
import {
  FlaskConical,
  ShieldCheck,
  ScrollText,
  KeyRound,
  ArrowRight,
  Mail,
} from "lucide-react";

function FeatureCard({ icon: Icon, title, description }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
        <Icon className="h-4 w-4" />
        {title}
      </div>
      <div className="mt-2 text-sm text-muted-foreground">{description}</div>
    </div>
  );
}

export default function ApiKeyGate({ onAuthenticated }) {
  const [value, setValue] = React.useState(() => getStoredApiKey());
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function submit(e) {
    e.preventDefault();
    const trimmed = String(value || "").trim().replace(/^bearer\s+/i, "");

    if (!trimmed) {
      setError("API key is required.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      setStoredApiKey(trimmed);
      await fetchJsonOrThrow("/v1/users/me");
      onAuthenticated?.();
    } catch (err) {
      clearStoredApiKey();
      setError(err?.message || "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  }

  function clear() {
    clearStoredApiKey();
    setValue("");
    setError("");
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Card className="border-border/60 bg-card/35 backdrop-blur">
            <CardHeader className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Hash Factory</Badge>
                <Badge variant="success">Early access</Badge>
              </div>

              <div className="space-y-3">
                <CardTitle className="text-3xl tracking-tight">
                  Verifiable scientific workflows, built for real trust.
                </CardTitle>
                <CardDescription className="max-w-3xl text-sm leading-6">
                  Hash Factory is the authenticated user-facing surface for Vera Anchor.
                  It helps users submit evidence, finalize trust records, inspect anchored
                  workflow results, and verify scientific artifacts through a structured,
                  tenant-aware control plane.
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <FeatureCard
                  icon={FlaskConical}
                  title="Ingest"
                  description="Run guided or local-first ingest flows that produce structured trust artifacts."
                />
                <FeatureCard
                  icon={ScrollText}
                  title="Verify"
                  description="Re-check receipts, bundles, and object-linked evidence through a user-facing workflow."
                />
                <FeatureCard
                  icon={ShieldCheck}
                  title="Trust records"
                  description="Inspect anchored results and workflow state from an authenticated tenant surface."
                />
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
                <div className="flex items-start gap-3">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-foreground/80" />
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-foreground/90">
                      Early access
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Hash Factory is currently in early access. To request access, reach
                      out to{" "}
                      <a
                        href="mailto:contact@veraanchor.com"
                        className="font-medium text-foreground underline underline-offset-4"
                      >
                        contact@veraanchor.com
                      </a>
                      . To explore the public Vera Anchor platform, visit{" "}
                      <a
                        href="https://veraanchor.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-foreground underline underline-offset-4"
                      >
                        veraanchor.com
                      </a>
                      .
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/35 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Sign in with API key
              </CardTitle>
              <CardDescription>
                Enter a user API key to authenticate this browser session.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">
                    User API key 
                  </label>
                  <textarea
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className="min-h-36 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                    placeholder="Paste user API key here"
                    disabled={submitting}
                  />
                </div>

                {error ? (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {error}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" disabled={submitting}>
                    <ArrowRight className="mr-2 h-4 w-4" />
                    {submitting ? "Signing in..." : "Continue"}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={clear}
                    disabled={submitting}
                  >
                    Clear
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
