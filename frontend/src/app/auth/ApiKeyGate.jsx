import React from "react";
import { setStoredApiKey, getStoredApiKey, clearStoredApiKey, fetchJsonOrThrow } from "@/lib/apiClient.js";
import { Button } from "@/components/base/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";

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
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-lg border-border/60 bg-card/35">
        <CardHeader>
          <CardTitle>Hash Factory sign in</CardTitle>
          <CardDescription>
            Paste a user API key to authenticate this browser session for local development.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/90">User API key</label>
              <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="min-h-32 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                placeholder="Paste user API key here"
                disabled={submitting}
              />
            </div>

            {error ? <div className="text-sm text-red-300">{error}</div> : null}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Signing in..." : "Save and continue"}
              </Button>
              <Button type="button" variant="outline" onClick={clear} disabled={submitting}>
                Clear
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}