import type { ReactNode } from "react";
import { tokens } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

type Variant = "success" | "warning" | "error" | "info" | "neutral";

interface Props {
  variant: Variant;
  children: ReactNode;
  className?: string;
}

// Status badge cho admin lists. Consistent colors across admin pages.
export function StatusBadge({ variant, children, className }: Props) {
  const variants: Record<Variant, string> = {
    success: "bg-state-success-soft text-state-success-ink",
    warning: "bg-state-warning-soft text-state-warning-ink",
    error: "bg-state-danger-soft text-state-danger-ink",
    info: "bg-state-info-soft text-state-info-ink",
    neutral: "bg-muted text-foreground",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 text-xs font-medium",
        tokens.radius.badge,
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
