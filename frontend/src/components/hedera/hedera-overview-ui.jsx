import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Clock3, MinusCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";
import { Badge } from "@/components/base/badge";
import { cn } from "@/lib/utils";

export function HederaMetricCard({ icon: Icon, title, value, hint }) {
  return (
    <Card className="border-border/60 bg-card/35 backdrop-blur">
      <CardHeader className="pb-3">
        <CardDescription className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
          {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
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

export function HederaWorkspaceCard({
  title,
  description,
  to = null,
  status = null,
  disabled = false,
}) {
  const inner = (
    <Card
      className={cn(
        "h-full border-border/60 bg-card/25 transition-colors backdrop-blur",
        disabled ? "opacity-80" : "hover:border-border hover:bg-card/35"
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>

          {status ? <Badge variant={status.variant || "outline"}>{status.label}</Badge> : null}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground/85">
          <span>{disabled ? "Coming next" : "Open workspace"}</span>
          {!disabled ? <ArrowRight className="h-4 w-4" /> : null}
        </div>
      </CardContent>
    </Card>
  );

  if (!to || disabled) return inner;

  return (
    <Link to={to} className="block h-full">
      {inner}
    </Link>
  );
}

export function HederaTrustStep({
  title,
  description,
  state = "idle",
}) {
  const meta =
    state === "good"
      ? {
          icon: CheckCircle2,
          iconClassName: "text-emerald-300",
          badge: { variant: "success", label: "Ready" },
        }
      : state === "pending"
        ? {
            icon: Clock3,
            iconClassName: "text-amber-300",
            badge: { variant: "warn", label: "Partial" },
          }
        : {
            icon: MinusCircle,
            iconClassName: "text-muted-foreground",
            badge: { variant: "outline", label: "Not yet" },
          };

  const Icon = meta.icon;

  return (
    <div className="rounded-2xl border border-border/60 bg-card/25 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.iconClassName)} />
          <div className="text-sm font-semibold text-foreground/90">{title}</div>
        </div>
        <Badge variant={meta.badge.variant}>{meta.badge.label}</Badge>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function HederaActionLink({ to, children, className = "" }) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border border-border/60 bg-card/25 px-3 py-2 text-sm font-medium text-foreground/90 transition-colors hover:border-border hover:bg-card/35",
        className
      )}
    >
      <span>{children}</span>
      <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

export function HederaRecentEmpty({ label }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/25 p-4 text-sm text-muted-foreground">
      {label}
    </div>
  );
}