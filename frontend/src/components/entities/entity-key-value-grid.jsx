import React from "react";

function ValueRow({ label, value, mono = false }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[140px,1fr] sm:gap-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={mono ? "break-all font-mono text-xs text-foreground/90" : "text-sm text-foreground/90"}>
        {value || "—"}
      </div>
    </div>
  );
}

export default function EntityKeyValueGrid({ title, items = [] }) {
  return (
    <div className="space-y-3">
      {title ? (
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
      ) : null}

      {items.map((item) => (
        <ValueRow
          key={item.key || `${item.label}-${String(item.value ?? "")}`}
          label={item.label}
          value={item.value}
          mono={Boolean(item.mono)}
        />
      ))}
    </div>
  );
}