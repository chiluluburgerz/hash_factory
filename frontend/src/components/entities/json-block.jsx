import React from "react";

export default function JsonBlock({ value, emptyLabel = "No data" }) {
  const pretty = React.useMemo(() => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }, [value]);

  if (!pretty) {
    return <div className="text-sm text-muted-foreground">{emptyLabel}</div>;
  }

  return (
    <pre className="overflow-x-auto rounded-xl border border-border/60 bg-background/40 p-3 text-xs text-foreground/85">
      {pretty}
    </pre>
  );
}