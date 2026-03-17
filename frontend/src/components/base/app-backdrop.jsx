// ============================================================================
// File: src/components/base/app-backdrop.jsx
// Version: 1.0 | 2026-03-15
// Purpose: Shared premium animated background for "marketing-grade" pages.
// Notes:
//   • Respects prefers-reduced-motion.
//   • Uses token-aligned base layers (bg-background, ring color accents).
//   • Keep subtle; never fight content.
// ============================================================================

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export default function AppBackdrop({
  variant = "aurora",
  className = "",
  opacity = 0.35,
}) {
  const reduceMotion = useReducedMotion();
  const o = clamp01(opacity);

  const anim =
    variant === "aurora"
      ? [
          "radial-gradient(circle at 15% 85%, rgba(34, 211, 238, 0.28) 0%, transparent 55%)",
          "radial-gradient(circle at 85% 15%, rgba(168, 85, 247, 0.26) 0%, transparent 55%)",
          "radial-gradient(circle at 15% 85%, rgba(34, 211, 238, 0.28) 0%, transparent 55%)",
        ]
      : [
          "radial-gradient(circle at 20% 80%, rgba(168, 85, 247, 0.26) 0%, transparent 55%)",
          "radial-gradient(circle at 80% 20%, rgba(34, 211, 238, 0.26) 0%, transparent 55%)",
          "radial-gradient(circle at 20% 80%, rgba(168, 85, 247, 0.26) 0%, transparent 55%)",
        ];

  return (
    <div className={cn("fixed inset-0 -z-10", className)} aria-hidden="true">
      {/* Token base */}
      <div className="absolute inset-0 bg-background" />

      {/* Animated aurora layer */}
      {reduceMotion ? (
        <div className="absolute inset-0" style={{ background: anim[0], opacity: o }} />
      ) : (
        <motion.div
          animate={{ background: anim }}
          transition={{ duration: 26, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0"
          style={{ opacity: o }}
        />
      )}

      {/* Soft center lift + vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.06),transparent_60%)] opacity-60" />
      <div className="absolute inset-0 bg-black/20" />
    </div>
  );
}
