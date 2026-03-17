import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { buildHcsLink } from "@/lib/hcs.js";
import CopyIconButton from "@/components/base/copy-icon-button";
import { cn } from "@/lib/utils";

export function HcsTxLabel({
  id,
  monoClassName = "",
  copyLabel = "Copy",
  copyVariant = "ghost",
  copySize = "icon",
  copyClassName = "",
  copyDisabled = false,
}) {
  const raw = String(id || "").trim();
  if (!raw) return <span className="text-muted-foreground">Not present</span>;

  const { label } = buildHcsLink(raw);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className={cn("font-mono text-xs break-all", monoClassName)}>
        {label || raw}
      </code>

      <CopyIconButton
        text={raw}
        label={copyLabel}
        size={copySize}
        variant={copyVariant}
        className={
          copyClassName ||
          "h-7 w-7 rounded-md p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
        }
        disabled={copyDisabled}
      />
    </div>
  );
}

export function HcsTxHashscanLink({
  id,
  className = "",
  icon = null,
  label = "HashScan",
  title,
}) {
  const raw = String(id || "").trim();
  if (!raw) return <span className="text-muted-foreground">Not present</span>;

  const { href } = buildHcsLink(raw);
  if (!href) return <span className="text-muted-foreground">Not present</span>;

  const actionMode = !!className || !!icon || label !== "HashScan";

  if (actionMode) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        className={className}
        title={title}
      >
        {label}
        {icon}
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
      title={title}
    >
      HashScan <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function HcsTxDetailsLink({ id }) {
  const raw = String(id || "").trim();
  if (!raw) return <span className="text-muted-foreground">Not present</span>;

  return (
    <Link
      className="text-xs underline text-muted-foreground"
      to={`/app/hcs/transactions/${encodeURIComponent(raw)}`}
    >
      HCS transaction details
    </Link>
  );
}