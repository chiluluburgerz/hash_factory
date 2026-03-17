import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md",
    "text-sm font-semibold transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-0",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/85",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background/40 backdrop-blur-sm " +
          "hover:bg-accent/35 hover:text-accent-foreground",
        ghost: "hover:bg-accent/35 hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",

        brand:
          "bg-primary text-primary-foreground hover:bg-primary/92 " +
          "shadow-[0_10px_30px_rgba(0,0,0,0.40)] " +
          "border border-primary/25 " +
          "backdrop-blur-sm",

        brandOutline:
          "border border-primary/65 bg-primary/28 text-foreground " +
          "hover:bg-primary/34 hover:border-primary/75 " +
          "shadow-[0_8px_22px_rgba(0,0,0,0.32)] " +
          "backdrop-blur-sm",

        success:
          "border border-emerald-400/55 bg-emerald-500/22 text-foreground " +
          "hover:bg-emerald-500/28 hover:border-emerald-400/65 " +
          "shadow-[0_8px_22px_rgba(0,0,0,0.28)] " +
          "backdrop-blur-sm",
        info:
          "border border-cyan-400/55 bg-cyan-500/22 text-foreground " +
          "hover:bg-cyan-500/28 hover:border-cyan-400/65 " +
          "shadow-[0_8px_22px_rgba(0,0,0,0.28)] " +
          "backdrop-blur-sm",
        warn:
          "border border-amber-400/55 bg-amber-500/22 text-foreground " +
          "hover:bg-amber-500/28 hover:border-amber-400/65 " +
          "shadow-[0_8px_22px_rgba(0,0,0,0.28)] " +
          "backdrop-blur-sm",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);
