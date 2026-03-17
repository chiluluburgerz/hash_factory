// ============================================================================
// File: src/components/base/table.jsx
// Version: 1.0-token-polish | 2026-03-15
// Purpose: Token-aligned table primitives with subtle enterprise polish.
// Notes:
//   • Adds header banding + consistent token borders.
//   • Softens row hover (muted/30) for a calmer enterprise feel.
//   • Keeps API identical to shadcn-style usage.
// ============================================================================

import * as React from "react";
import { cn } from "@/lib/utils";

const Table = React.forwardRef(function Table({ className, ...props }, ref) {
  return (
    <div className="relative w-full overflow-auto rounded-xl border border-border/60">
      <table
        ref={ref}
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
});
Table.displayName = "Table";

const TableHeader = React.forwardRef(function TableHeader({ className, ...props }, ref) {
  return (
    <thead
      ref={ref}
      className={cn(
        [
          "bg-muted/20",
          "[&_tr]:border-b [&_tr]:border-border/60",
        ].join(" "),
        className
      )}
      {...props}
    />
  );
});
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef(function TableBody({ className, ...props }, ref) {
  return (
    <tbody
      ref={ref}
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
});
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef(function TableFooter({ className, ...props }, ref) {
  return (
    <tfoot
      ref={ref}
      className={cn(
        [
          "border-t border-border/60",
          "bg-muted/20 font-medium",
          "[&>tr]:last:border-b-0",
        ].join(" "),
        className
      )}
      {...props}
    />
  );
});
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef(function TableRow({ className, ...props }, ref) {
  return (
    <tr
      ref={ref}
      className={cn(
        [
          "border-b border-border/60",
          "transition-colors",
          "hover:bg-muted/30",
          "data-[state=selected]:bg-muted/40",
        ].join(" "),
        className
      )}
      {...props}
    />
  );
});
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef(function TableHead({ className, ...props }, ref) {
  return (
    <th
      ref={ref}
      className={cn(
        [
          "h-11 px-3 text-left align-middle",
          "font-semibold text-foreground/80",
          "[&:has([role=checkbox])]:pr-0",
          "[&>[role=checkbox]]:translate-y-[2px]",
        ].join(" "),
        className
      )}
      {...props}
    />
  );
});
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef(function TableCell({ className, ...props }, ref) {
  return (
    <td
      ref={ref}
      className={cn(
        [
          "p-3 align-middle",
          "[&:has([role=checkbox])]:pr-0",
          "[&>[role=checkbox]]:translate-y-[2px]",
        ].join(" "),
        className
      )}
      {...props}
    />
  );
});
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef(function TableCaption({ className, ...props }, ref) {
  return (
    <caption
      ref={ref}
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
});
TableCaption.displayName = "TableCaption";

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
