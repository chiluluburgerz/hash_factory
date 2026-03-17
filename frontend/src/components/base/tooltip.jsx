// ============================================================================
// File: src/components/base/tooltip.jsx
// Version: 1.1-token-popover | 2025-12-29
// Purpose: Radix Tooltip with premium token-aligned styling.
// Notes:
//   • Uses popover tokens (bg-popover/text-popover-foreground) instead of bg-primary.
//   • Adds border + shadow consistent with cards/menus.
// ============================================================================

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef(function TooltipContent(
  { className, sideOffset = 6, ...props },
  ref
) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          [
            "z-50 overflow-hidden rounded-lg px-3 py-1.5 text-xs",
            "bg-popover text-popover-foreground",
            "border border-border/70 shadow-[0_18px_55px_rgba(0,0,0,0.45)] backdrop-blur-xl",
            "animate-in fade-in-0 zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "data-[side=bottom]:slide-in-from-top-2",
            "data-[side=left]:slide-in-from-right-2",
            "data-[side=right]:slide-in-from-left-2",
            "data-[side=top]:slide-in-from-bottom-2",
            "origin-[--radix-tooltip-content-transform-origin]",
          ].join(" "),
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
