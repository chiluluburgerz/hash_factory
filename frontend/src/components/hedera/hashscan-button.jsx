import React, { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { HcsTxHashscanLink } from "@/components/hedera/hcs-tx-link.jsx";

function baseClass(size) {
  const common =
    "inline-flex items-center gap-1.5 border transition-all duration-200 " +
    "bg-gradient-to-b from-muted/20 to-transparent border-border/60 " +
    "hover:border-border/80 hover:bg-muted/15";

  if (size === "xs") return cn("h-7 px-2.5 rounded-lg text-[10px] font-medium", common);
  if (size === "md") return cn("h-9 px-3.5 rounded-xl text-xs font-medium", common);
  return cn("h-8 px-3 rounded-lg text-[11px] font-medium", common);
}

export default function HashscanButton({
  id,
  label = "HashScan",
  size = "sm",
  className = "",
  icon = null,
  title,
}) {
  const cls = useMemo(() => cn(baseClass(size), className), [size, className]);
  const Icon = icon ?? <ExternalLink className="h-3.5 w-3.5" />;

  return (
    <HcsTxHashscanLink
      id={id}
      className={cls}
      icon={Icon}
      label={label}
      title={title}
    />
  );
}