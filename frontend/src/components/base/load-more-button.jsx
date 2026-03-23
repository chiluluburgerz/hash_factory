// ============================================================================
// File: src/components/base/load-more-button.jsx
// Version: 1.0.0-soft-blue | 2026-03-18
// Purpose:
//   Canonical “Load more” button used in table footers + pagination.
// Notes:
//   • Default visual is a soft blue that fits your system.
//   • Handles disabled + loading consistently.
// ============================================================================

import React, { useMemo } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import { Button } from "@/components/base/button";
import { cn } from "@/lib/utils";

function softBlueClass() {
  // Soft blue (not loud primary), consistent with your premium chrome.
  return cn(
    "border border-cyan-400/45",
    "bg-cyan-500/14 text-foreground",
    "hover:bg-cyan-500/18 hover:border-cyan-400/60",
    "shadow-[0_8px_22px_rgba(0,0,0,0.28)]",
    "backdrop-blur-sm"
  );
}

export default function LoadMoreButton({
  onClick,
  disabled = false,
  loading = false,
  label = "Load more",
  icon = true,
  className = "",
  size = "sm",
  variant = "outline", // we override with soft blue styling; variant kept for API
  type = "button",
  ...rest
}) {
  const cls = useMemo(() => cn(softBlueClass(), className), [className]);

  return (
    <Button
      type={type}
      size={size}
      variant={variant}
      onClick={onClick}
      disabled={disabled || loading}
      className={cls}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : icon ? (
        <ArrowDown className="h-4 w-4" />
      ) : null}
      {label}
    </Button>
  );
}
