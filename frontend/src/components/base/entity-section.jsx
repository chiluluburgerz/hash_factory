// ============================================================================
// File: src/components/base/entity-section.jsx
// Version: 1.0 oken-card-standard | 2026-03-15
// Purpose: Consistent section card for entity pages.
// Notes:
//   • Uses token-driven Card defaults (no white/black overrides).
//   • Optional tone for deeper emphasis when needed.
//   • Optional header/footer borders are token-aligned.
// ============================================================================

import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/base/card";

export default function EntitySection({
  title,
  description,
  children,
  className = "",

  headerClassName = "",
  contentClassName = "",
  footer,
  footerClassName = "",

  noHeader = false,
  showHeaderBorder = true,
  showFooterBorder = true,

  tone = "default", // default | subtle | deep
}) {
  const toneCls =
    tone === "deep"
      ? "bg-card/65"
      : tone === "subtle"
      ? "bg-card/45"
      : "";

  return (
    <Card className={cn(toneCls, className)}>
      {!noHeader ? (
        <CardHeader
          className={cn(
            showHeaderBorder ? "border-b border-border/60" : "",
            headerClassName
          )}
        >
          {title ? <CardTitle>{title}</CardTitle> : null}
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
      ) : null}

      <CardContent className={cn("text-sm", contentClassName)}>{children}</CardContent>

      {footer ? (
        <CardFooter
          className={cn(
            showFooterBorder ? "border-t border-border/60" : "",
            footerClassName
          )}
        >
          {footer}
        </CardFooter>
      ) : null}
    </Card>
  );
}
