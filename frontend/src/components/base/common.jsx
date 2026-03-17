// ============================================================================
// File: src/components/base/common.jsx
// Purpose: Shared HF UI primitives.
// ============================================================================

import { cn } from "@/lib/utils";
import CopyIconButton from "@/components/base/copy-icon-button";

export function Mono({ children, className = "" }) {
  return (
    <code className={cn("font-mono break-all text-foreground/85", className)}>
      {children}
    </code>
  );
}

export function KeyValueRow({
  k,
  v,
  valueMinW0 = false,
  className = "",
  keyClassName = "",
  valueClassName = "",
}) {
  return (
    <div className={cn("flex justify-between gap-4", className)}>
      <div className={cn("text-muted-foreground", keyClassName)}>{k}</div>
      <div
        className={cn(
          "text-right",
          valueMinW0 ? "min-w-0" : "",
          valueClassName
        )}
      >
        {v}
      </div>
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }) {
  return (
    <CopyIconButton
      text={text}
      label={label}
      size="icon"
      variant="ghost"
      className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent"
      stopPropagation={true}
    />
  );
}