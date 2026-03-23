import React from "react";
import {
  CheckCircle2,
  Clock3,
  FlaskConical,
  KeyRound,
  ShieldCheck,
  Wallet,
  Waypoints,
  Building2,
  RefreshCw,
  UserRound,
} from "lucide-react";

import useAppContext from "@/app/hooks/useAppContext.js";
import EntitySection from "@/components/base/entity-section.jsx";
import { Button } from "@/components/base/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/base/card";

import SetupTaskCard from "@/components/setup/setupTaskCard.jsx";
import SetupActionsPanel from "@/components/setup/setupActionsPanel.jsx";

function iconForTask(taskId) {
  switch (taskId) {
    case "first_ingest":
      return FlaskConical;
    case "profile":
      return UserRound;
    case "org_profile":
      return Building2;
    case "wallet":
      return Wallet;
    case "user_key":
      return KeyRound;
    case "topics":
      return Waypoints;
    default:
      return ShieldCheck;
  }
}

export default function SetupPage() {
  const {
    isLoading,
    setup,
    membership,
    entitlements,
    topicReadiness,
    refreshAppContext,
  } = useAppContext();

  const tasks = Array.isArray(setup?.tasks) ? setup.tasks : [];
  const requiredCount = Number(setup?.requiredCount ?? setup?.blockingCount ?? 0);
  const completedCount = Number(setup?.completedCount ?? 0);
  const totalCount = Number(setup?.totalCount ?? 0);
  const loadError = String(setup?.loadError || "").trim();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Setup
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Complete the minimum account and tenant setup required to unlock trusted Hash Factory workflows.
          </p>
        </div>

        <Button type="button" variant="outline" onClick={() => void refreshAppContext()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Reload setup state
        </Button>
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="text-sm font-semibold text-foreground">
            Setup state could not be fully loaded
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {loadError}
          </div>
        </div>
      ) : null}

      {!isLoading && !setup?.isReady ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="text-sm font-semibold text-foreground">
            Welcome to the Vera Anchor Hash Factory
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Work through the setup actions below to finish configuring your account and run your first test workflow.
          </div>
        </div>
      ) : null}

      <EntitySection
        title="Setup readiness"
        description="These cards summarize whether the current authenticated workspace is ready for protected trust workflows."
      >
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="border-border/60 bg-card/35 backdrop-blur">
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Ready state
              </CardDescription>
              <CardTitle className="text-2xl tracking-tight">
                {isLoading ? "Loading..." : setup?.isReady ? "Ready" : "Setup required"}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted-foreground">
              Required tasks remaining: {requiredCount}
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/35 backdrop-blur">
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                <Clock3 className="h-3.5 w-3.5" />
                Completion
              </CardDescription>
              <CardTitle className="text-2xl tracking-tight">
                {completedCount} / {totalCount}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted-foreground">
              Tasks completed across account and tenant setup.
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/35 backdrop-blur">
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                <ShieldCheck className="h-3.5 w-3.5" />
                Active posture
              </CardDescription>
              <CardTitle className="text-2xl tracking-tight">
                {membership?.role || "user"}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted-foreground">
              Tier: {entitlements?.tier || "—"}
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/35 backdrop-blur">
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                <Waypoints className="h-3.5 w-3.5" />
                Topic readiness
              </CardDescription>
              <CardTitle className="text-2xl tracking-tight">
                {isLoading
                  ? "Loading..."
                  : topicReadiness?.ready
                    ? "Ready"
                    : `${Number(topicReadiness?.meta?.missingCount ?? 0)} missing`}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted-foreground">
              Topics ensured
            </CardContent>
          </Card>
        </div>
      </EntitySection>

      <EntitySection
        title="Tasks"
        description="Work through these items in order. Complete encryption keys first, then topics, then wallets, before moving into your first workflow."
      >
        <div className="grid gap-4">
          {tasks.length === 0 && !isLoading ? (
            <div className="rounded-2xl border border-border/60 bg-card/25 p-6 text-sm text-muted-foreground">
              No setup tasks are available for this workspace.
            </div>
          ) : null}

          {tasks.map((task) => {
            const Icon = iconForTask(task.id);

            return (
              <SetupTaskCard
                key={task.id}
                icon={Icon}
                task={task}
              >
                <SetupActionsPanel task={task} />
              </SetupTaskCard>
            );
          })}
        </div>
      </EntitySection>
    </div>
  );
}