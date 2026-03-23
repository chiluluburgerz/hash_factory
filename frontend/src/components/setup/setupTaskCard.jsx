import React from "react";
import { Badge } from "@/components/base/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/base/card";

function badgeForStatus(status, taskId = "") {
  if (taskId === "first_ingest" && status === "action_required") {
    return <Badge variant="info">recommended</Badge>;
  }
  switch (status) {
    case "complete":
      return <Badge variant="success">complete</Badge>;
    case "action_required":
      return <Badge variant="warn">action required</Badge>;
    case "unknown":
      return <Badge variant="info">needs review</Badge>;
    default:
      return <Badge variant="outline">not required</Badge>;
  }
}

export default function SetupTaskCard({
  icon: Icon,
  task,
  children,
}) {
  if (!task) return null;

  const showRequiredBadge = Boolean(task.required) && task.status !== "complete";

  return (
    <Card className="border-border/60 bg-card/25">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
              {String(task.id || "").replaceAll("_", " ")}
            </CardDescription>

            <CardTitle className="text-xl tracking-tight">
              {task.title}
            </CardTitle>

            <div className="text-sm text-muted-foreground">
              {task.description}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {badgeForStatus(task.status, task.id)}
            {showRequiredBadge ? (
              <Badge variant="warn">required</Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        {children}
      </CardContent>
    </Card>
  );
}