import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/base/card";

export default function EntitySummaryCard({
  title,
  value,
  hint,
  icon: Icon = null,
  mono = false,
  valueClassName = "",
}) {
  return (
    <Card className="border-border/60 bg-card/35 backdrop-blur">
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
          {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
          {title}
        </CardDescription>

        <CardTitle
          className={[
            mono ? "font-mono" : "",
            "text-2xl tracking-tight",
            valueClassName,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {value || "—"}
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="text-sm text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}