// ============================================================================
// File: src/components/base/copy-icon-button.jsx
// Version: 1.0-outline-owned-style | 2026-03-15
// Purpose: Icon copy button with explicit user feedback (no silent copy).
// Notes:
//   • Uses clipboard API when available; falls back to execCommand.
//   • Shows "Copied" / "Copy failed" via icon + tooltip.
//   • Stops event bubbling by default so it works inside Links/Table rows/cards.
//   • Token-aligned focus rings + tooltip styling.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { Copy, Check, X } from "lucide-react";
import { Button } from "@/components/base/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/base/tooltip";
import { cn } from "@/lib/utils";

function legacyCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = String(text ?? "");
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function iconChromeClass({ dense = false } = {}) {
  // Canonical 32px icon button chrome (matches your table rhythm).
  // dense=true can be used for super-tight rows if needed (kept internal).
  return cn(
    dense ? "h-7 w-7" : "h-8 w-8",
    "rounded-lg",
    "border border-border/60",
    "bg-card/30 backdrop-blur-sm",
    "hover:bg-muted/15 hover:border-border/80",
    "transition-colors"
  );
}

export default function CopyIconButton({
  text,
  label = "Copy",
  className = "",
  size = "icon",
  // NOTE: variant is intentionally ignored to prevent drift (always outline).
  onCopied,
  onFailed,
  stopPropagation = true,
  disabled = false,
  resetMs = 1200,
  provider = true, // set false if you wrap a parent TooltipProvider already
  dense = false, // optional: compact 28px variant for very tight tables
  children,
  ...rest
}) {
  const [state, setState] = useState("idle"); // idle | copied | failed

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(
      () => setState("idle"),
      Math.max(250, Number(resetMs) || 1200)
    );
    return () => clearTimeout(t);
  }, [state, resetMs]);

  const payload = useMemo(() => String(text ?? ""), [text]);
  const canCopy = payload.trim().length > 0 && !disabled;

  const doCopy = async () => {
    if (!canCopy) {
      setState("failed");
      onFailed?.(new Error(disabled ? "Copy disabled" : "Empty copy payload"));
      return;
    }

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        setState("copied");
        onCopied?.(payload);
        return;
      }
    } catch (err) {
      onFailed?.(err);
    }

    const ok = legacyCopy(payload);
    setState(ok ? "copied" : "failed");
    if (ok) onCopied?.(payload);
    else onFailed?.(new Error("Legacy copy failed"));
  };

  const onPointerDown = (e) => {
    if (!stopPropagation) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onClick = (e) => {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    void doCopy();
  };

  const icon =
    state === "copied" ? (
      <Check className="h-4 w-4" />
    ) : state === "failed" ? (
      <X className="h-4 w-4" />
    ) : (
      <Copy className="h-4 w-4" />
    );

  const tip = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label;

  const content = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={size}
          onPointerDown={onPointerDown}
          onClick={onClick}
          disabled={!canCopy}
          className={cn(iconChromeClass({ dense }), className)}
          aria-label={label}
          title={label}
          {...rest}
        >
          {children ?? icon}
          <span className="sr-only" aria-live="polite">
            {tip}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );

  return provider ? <TooltipProvider>{content}</TooltipProvider> : content;
}
