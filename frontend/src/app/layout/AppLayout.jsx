import React from "react";
import AppHeader from "./AppHeader.jsx";
import AppSidebar from "./AppSidebar.jsx";
import useAppContext from "@/app/hooks/useAppContext.js";

function GlobalErrorBanner() {
  const { error } = useAppContext();

  if (!error) return null;

  return (
    <div className="mb-6 rounded-2xl border border-red-500/40 bg-red-500/10 p-4">
      <div className="text-sm font-semibold text-red-200">
        HF UI request error
      </div>
      <div className="mt-2 text-sm text-red-100/90">
        {error.message || "Unknown error"}
      </div>

      <div className="mt-3 grid gap-2 text-xs text-red-100/80 sm:grid-cols-2">
        <div>
          <span className="font-semibold">Status:</span> {String(error.status ?? "—")}
        </div>
        <div>
          <span className="font-semibold">URL:</span> {error.url || "—"}
        </div>
      </div>

      {error.payload ? (
        <pre className="mt-3 overflow-auto rounded-xl border border-red-500/30 bg-black/20 p-3 text-xs text-red-50 whitespace-pre-wrap">
          {JSON.stringify(error.payload, null, 2)}
        </pre>
      ) : error.responseText ? (
        <pre className="mt-3 overflow-auto rounded-xl border border-red-500/30 bg-black/20 p-3 text-xs text-red-50 whitespace-pre-wrap">
          {error.responseText}
        </pre>
      ) : null}
    </div>
  );
}

export default function AppLayout({ children, onSignedOut }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[280px_minmax(0,1fr)]">
        <AppSidebar />

        <div className="min-w-0">
          <AppHeader onSignedOut={onSignedOut} />
          <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <GlobalErrorBanner />
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}