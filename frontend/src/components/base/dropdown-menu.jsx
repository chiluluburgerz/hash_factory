// ============================================================================
// File: src/components/base/dropdown-menu.jsx
// Version: 1.0-inline-anchor-opaque-menu-surface | 2026-03-09
// Purpose:
//   Lightweight dropdown menu compatible with the shadcn-style API used by the app.
//   Simplified to inline anchoring (no viewport math) for rock-solid behavior.
// Notes:
//   • No external dependencies.
//   • Supports: DropdownMenu, Trigger(asChild), Content(align), Item(asChild/disabled),
//               Separator, close on outside/Escape, basic keyboard navigation.
//   • Uses the same token system as the rest of the app (card + accent).
//   • Menu surfaces are intentionally opaque for legibility over dense content.
// ============================================================================

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

function mergeRefs(...refs) {
  return (node) => {
    for (const r of refs) {
      if (!r) continue;
      if (typeof r === "function") r(node);
      else r.current = node;
    }
  };
}

function composeHandlers(a, b) {
  return (e) => {
    a?.(e);
    if (!e.defaultPrevented) b?.(e);
  };
}

function useControllableState({ value, defaultValue, onChange }) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const isControlled = value !== undefined;
  const state = isControlled ? value : uncontrolled;

  const setState = useCallback(
    (next) => {
      const v = typeof next === "function" ? next(state) : next;
      if (!isControlled) setUncontrolled(v);
      onChange?.(v);
    },
    [isControlled, onChange, state]
  );

  return [state, setState];
}

function isElement(x) {
  return React.isValidElement(x);
}

function Slot({ children, ...props }) {
  if (!isElement(children)) return null;
  const childProps = children.props || {};
  return React.cloneElement(children, {
    ...props,
    ...childProps,
    className: cn(props.className, childProps.className),
    ref: mergeRefs(props.ref, children.ref),
    onClick: composeHandlers(props.onClick, childProps.onClick),
    onKeyDown: composeHandlers(props.onKeyDown, childProps.onKeyDown),
  });
}

const Ctx = createContext(null);

function useMenuCtx() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("DropdownMenu components must be used within <DropdownMenu>.");
  return ctx;
}

export function DropdownMenu({ open, defaultOpen = false, onOpenChange, children }) {
  const [isOpen, setIsOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });

  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const contentRef = useRef(null);
  const menuId = useId();

  const close = useCallback(() => setIsOpen(false), [setIsOpen]);
  const toggle = useCallback(() => setIsOpen((v) => !v), [setIsOpen]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (e) => {
      const root = rootRef.current;
      if (!root) return;
      const t = e.target;
      if (!t) return;
      if (root.contains(t)) return;
      close();
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [isOpen, close]);

  // Return focus to trigger on close (best-effort)
  useEffect(() => {
    if (isOpen) return;
    const t = triggerRef.current;
    if (!t) return;
    try {
      t.focus?.();
    } catch {
      // ignore
    }
  }, [isOpen]);

  const ctx = useMemo(
    () => ({
      isOpen,
      setIsOpen,
      toggle,
      close,
      triggerRef,
      contentRef,
      menuId,
    }),
    [isOpen, setIsOpen, toggle, close, menuId]
  );

  return (
    <Ctx.Provider value={ctx}>
      {/* Inline anchor wrapper so the menu is always positioned under the trigger */}
      <div ref={rootRef} className="relative inline-flex w-full">
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function DropdownMenuTrigger({ asChild = false, children, ...props }) {
  const { isOpen, toggle, triggerRef, menuId } = useMenuCtx();

  const triggerProps = {
    "aria-haspopup": "menu",
    "aria-expanded": isOpen ? "true" : "false",
    "aria-controls": menuId,
    type: props.type || "button",
    ...props,
    onClick: composeHandlers(props.onClick, (e) => {
      // Don’t prevent default; just stop bubbling so row-click handlers don’t fire.
      e.stopPropagation();
      toggle();
    }),
    ref: mergeRefs(props.ref, triggerRef),
  };

  if (asChild) return <Slot {...triggerProps}>{children}</Slot>;
  return <button {...triggerProps}>{children}</button>;
}

function getFocusableItems(root) {
  if (!root) return [];
  const nodes = root.querySelectorAll(
    [
      "[data-dropdown-item='true']:not([data-disabled='true'])",
      "button:not([disabled])",
      "a[href]",
      "[role='menuitem']:not([aria-disabled='true'])",
    ].join(",")
  );
  return Array.from(nodes).filter((n) => n && typeof n.focus === "function");
}

export function DropdownMenuContent({
  align = "start",
  className = "",
  style,
  children,
  ...props
}) {
  const { isOpen, close, contentRef, menuId } = useMenuCtx();

  const onKeyDown = useCallback(
    (e) => {
      const cont = contentRef.current;
      if (!cont) return;

      const items = getFocusableItems(cont);
      if (!items.length) return;

      const idx = items.indexOf(document.activeElement);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = idx >= 0 ? (idx + 1) % items.length : 0;
        items[next].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = idx >= 0 ? (idx - 1 + items.length) % items.length : items.length - 1;
        items[prev].focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        items[0].focus();
      } else if (e.key === "End") {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (e.key === "Tab") {
        close();
      }
    },
    [close, contentRef]
  );

  if (!isOpen) return null;

  const defaultCls = cn(
    "absolute z-50 mt-1 rounded-2xl border border-border/80",
    "bg-background text-foreground",
    "shadow-[0_20px_60px_rgba(0,0,0,0.65)]",
    "ring-1 ring-black/15",
    "isolate",
    "p-1 max-h-[320px] overflow-auto",
    "text-sm",
    "outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
    align === "end" ? "right-0" : "left-0"
  );

  return (
    <div
      id={menuId}
      role="menu"
      aria-orientation="vertical"
      {...props}
      ref={mergeRefs(props.ref, contentRef)}
      onKeyDown={composeHandlers(props.onKeyDown, onKeyDown)}
      className={cn(defaultCls, className)}
      style={{
        minWidth: "100%",
        backgroundColor: "hsl(var(--background))",
        opacity: 1,
        backdropFilter: "none",
        WebkitBackdropFilter: "none",
        ...(style || {}),
      }}
    >
      {children}
    </div>
  );
}

export function DropdownMenuItem({
  asChild = false,
  disabled = false,
  onSelect,
  className = "",
  children,
  ...props
}) {
  const { close } = useMenuCtx();

  const handleSelect = useCallback(
    (e) => {
      if (disabled) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      onSelect?.(e);
      if (!e.defaultPrevented) close();
    },
    [disabled, onSelect, close]
  );

  const baseCls = cn(
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm",
    "cursor-pointer select-none",
    "text-[13px]",
    "hover:bg-accent hover:text-accent-foreground",
    "active:bg-accent",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
    "data-[disabled='true']:opacity-50 data-[disabled='true']:pointer-events-none"
  );

  const itemProps = {
    role: "menuitem",
    tabIndex: disabled ? -1 : 0,
    "aria-disabled": disabled ? "true" : "false",
    "data-dropdown-item": "true",
    "data-disabled": disabled ? "true" : "false",
    ...props,
    className: cn(baseCls, className),
    onClick: composeHandlers(props.onClick, handleSelect),
    onKeyDown: composeHandlers(props.onKeyDown, (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleSelect(e);
      }
    }),
  };

  if (asChild) return <Slot {...itemProps}>{children}</Slot>;

  return (
    <button
      type="button"
      disabled={disabled}
      {...itemProps}
      style={{
        backgroundColor: "transparent",
        color: "hsl(var(--card-foreground))",
      }}
    >
      {children}
    </button>
  );
}

export function DropdownMenuSeparator({ className = "", ...props }) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      className={cn("my-1 h-px w-full bg-border/70", className)}
      {...props}
    />
  );
}