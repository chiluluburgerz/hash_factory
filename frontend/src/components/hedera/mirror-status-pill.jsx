import React, { useMemo } from "react";
import { Check, X, Clock, Minus, Loader2 } from "lucide-react";
import { Pill } from "@/components/base/pill";

function normBool(x) {
  return x === true;
}

function normFail(x) {
  if (x === true) return true;
  const v = String(x ?? "").trim().toLowerCase();
  if (!v) return false;
  return v === "failed" || v === "error" || v === "rejected" || v === "invalid";
}

export default function MirrorStatusPill({
  hasAnchor,
  mirrorVerified,
  loading = false,
  failed = false,
  className = "",
  title,
  size = "md",
}) {
  const model = useMemo(() => {
    if (!hasAnchor) {
      return {
        tone: "default",
        label: "No Anchor",
        icon: Minus,
        iconClassName: "text-foreground/55",
        title: "No HCS anchor recorded",
      };
    }

    if (loading) {
      return {
        tone: "warn",
        label: "Mirror Checking",
        icon: Loader2,
        iconClassName: "animate-spin text-amber-200",
        title: "Checking mirror verification…",
      };
    }

    if (normBool(mirrorVerified)) {
      return {
        tone: "good",
        label: "Mirror Verified",
        icon: Check,
        iconClassName: "text-emerald-200",
        title: "Mirror verified",
      };
    }

    if (normFail(failed)) {
      return {
        tone: "danger",
        label: "Mirror Failed",
        icon: X,
        iconClassName: "text-rose-200",
        title: "Mirror verification failed",
      };
    }

    return {
      tone: "warn",
      label: "Mirror Pending",
      icon: Clock,
      iconClassName: "text-amber-200",
      title: "Mirror pending",
    };
  }, [hasAnchor, mirrorVerified, loading, failed]);

  const Icon = model.icon;

  return (
    <Pill tone={model.tone} size={size} dot={false} className={className} title={title || model.title}>
      <Icon className={["h-3.5 w-3.5 shrink-0", model.iconClassName].join(" ")} aria-hidden="true" />
      {model.label}
    </Pill>
  );
}