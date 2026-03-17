// src/components/base/badge.jsx
import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  [
    "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5",
    "text-xs font-semibold leading-none",
    "transition-colors",
    "shadow-[0_0_0_1px_rgba(255,255,255,0.03)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",

        // Big change: outline/muted get stronger fill + clearer border.
        // These are what your header pills rely on.
        outline: "border-border/85 bg-muted/28 text-foreground",
        muted: "border-border/75 bg-muted/42 text-foreground/85",

        // Status: stronger than before so they show up on aurora + glass.
        success: "border-emerald-400/55 bg-emerald-500/22 text-foreground",
        warn: "border-amber-400/55 bg-amber-500/22 text-foreground",
        info: "border-cyan-400/55 bg-cyan-500/22 text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

const Badge = React.forwardRef(function Badge({ className, variant, ...props }, ref) {
  return <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />;
});
Badge.displayName = "Badge";

export { Badge, badgeVariants };
