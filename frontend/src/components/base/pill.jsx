// ============================================================================
// File: src/components/base/pill.jsx
// Version: 1.0.0 | 2026-03-16-31
// Purpose:
//   Canonical pill/chip primitive for the app (status, tone, live/sync, etc.).
// Notes:
//   • Built on Badge but standardizes size, borders, gradients, and dot support.
//   • Keeps token alignment (border-*, bg-*, text-*) and avoids hard white/black.
// ============================================================================

import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/base/badge";

const pillVariants = cva(
  [
    "inline-flex items-center gap-2 rounded-full border font-semibold leading-none",
    "shadow-[0_0_0_1px_rgba(255,255,255,0.03)]",
    "select-none whitespace-nowrap",
  ].join(" "),
  {
    variants: {
      tone: {
        default: "border-border/70 bg-muted/18 text-foreground/80",
        neutral: "border-border/60 bg-muted/14 text-foreground/75",
        good:
          "border-emerald-500/25 bg-gradient-to-b from-emerald-500/12 to-transparent text-emerald-100/90 " +
          "shadow-[0_0_0_1px_rgba(16,185,129,0.08)]",
        warn:
          "border-amber-500/25 bg-gradient-to-b from-amber-500/12 to-transparent text-amber-100/90 " +
          "shadow-[0_0_0_1px_rgba(245,158,11,0.08)]",
        danger:
          "border-rose-500/25 bg-gradient-to-b from-rose-500/14 to-transparent text-rose-100/90 " +
          "shadow-[0_0_0_1px_rgba(244,63,94,0.10)]",
        info:
          "border-cyan-500/25 bg-gradient-to-b from-cyan-500/14 to-transparent text-cyan-100/90 " +
          "shadow-[0_0_0_1px_rgba(34,211,238,0.10)]",
        sky:
          "border-sky-500/28 bg-gradient-to-b from-sky-500/14 to-transparent text-sky-100/90 " +
          "shadow-[0_0_0_1px_rgba(56,189,248,0.10)]",
        violet:
          "border-violet-500/25 bg-gradient-to-b from-violet-500/14 to-transparent text-violet-100/90 " +
          "shadow-[0_0_0_1px_rgba(139,92,246,0.10)]",
      },
      size: {
        xs: "px-2.5 py-1 text-[10px] uppercase tracking-wide",
        sm: "px-3 py-1 text-[11px]",
        md: "px-3.5 py-1.5 text-xs",
      },
      // For when you want pills to read like "premium chips" in headers
      emphasis: {
        false: "",
        true: "backdrop-blur-sm",
      },
    },
    defaultVariants: {
      tone: "default",
      size: "sm",
      emphasis: true,
    },
  }
);

function Dot({ tone }) {
  const dotCls =
    tone === "good"
      ? "bg-emerald-300"
      : tone === "warn"
      ? "bg-amber-300"
      : tone === "danger"
      ? "bg-rose-300"
      : tone === "info" || tone === "sky"
      ? "bg-cyan-300"
      : "bg-foreground/35";

  return <span className={cn("h-1.5 w-1.5 rounded-full", dotCls)} />;
}

const Pill = React.forwardRef(function Pill(
  { tone = "default", size = "sm", emphasis = true, dot = false, className, children, ...props },
  ref
) {
  return (
    <Badge
      ref={ref}
      variant="outline"
      className={cn(pillVariants({ tone, size, emphasis }), className)}
      {...props}
    >
      {dot ? <Dot tone={tone} /> : null}
      {children}
    </Badge>
  );
});

Pill.displayName = "Pill";

export { Pill, pillVariants };
