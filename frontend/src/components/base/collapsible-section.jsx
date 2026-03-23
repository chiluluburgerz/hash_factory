// ============================================================================
// File: src/components/base/collapsible-section.jsx
// Version: 1.0.0 | 2026-03-22
// Purpose:
//   Canonical collapsible section header + body.
//   • Title + description
//   • Right-side badges/pills/actions
//   • Accessible toggle button w/ chevron
// Notes:
//   • UI-only; no hooks besides local state.
//   • Use for Cost/Planning/Anchors/Ledger subpanels.
// ============================================================================

import React, { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/base/button";

export default function CollapsibleSection({
  title,
  description,
  defaultCollapsed = false,
  right, // badges/pills/actions
  toggleSide = "left",
  children,
  className = "",
  headerClassName = "",
  bodyClassName = "",
  chrome = true, // if false, renders a “bare” header+body
}) {
  const [open, setOpen] = useState(!defaultCollapsed);

  const frameCls = useMemo(() => {
    return chrome
      ? cn("rounded-2xl border border-border/60 bg-card/40 overflow-hidden", className)
      : className;
  }, [chrome, className]);

  return (
    <section className={frameCls}>
      <div
        className={cn(
          "flex flex-wrap items-start justify-between gap-3",
          chrome ? "px-4 py-4 md:px-6" : "",
          headerClassName
        )}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {toggleSide === "left" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setOpen((v) => !v)}
                className={cn(
                  "h-8 w-8 rounded-lg",
                  "border border-border/50 bg-card/20",
                  "hover:bg-muted/15 hover:border-border/70"
                )}
                aria-label={open ? "Collapse section" : "Expand section"}
                title={open ? "Collapse" : "Expand"}
              >
                <ChevronDown
                  className={cn("h-4 w-4 transition-transform", open ? "rotate-0" : "-rotate-90")}
                />
              </Button>
            ) : null}

            <h3 className="text-sm font-semibold text-foreground/90">{title}</h3>
          </div>

          {description ? (
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{description}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {right ? right : null}

          {toggleSide === "right" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setOpen((v) => !v)}
              className={cn(
                "h-8 w-8 rounded-lg",
                "border border-border/50 bg-card/20",
                "hover:bg-muted/15 hover:border-border/70"
              )}
              aria-label={open ? "Collapse section" : "Expand section"}
              title={open ? "Collapse" : "Expand"}
            >
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", open ? "rotate-0" : "-rotate-90")}
              />
            </Button>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className={cn(chrome ? "px-4 pb-4 md:px-6 md:pb-6" : "", bodyClassName)}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
