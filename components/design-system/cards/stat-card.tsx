import type { ReactNode } from "react";
import { tokens } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface StatCardProps {
  value: string | number;
  label: string;
  description?: string;
  icon?: ReactNode;
  accent?: "orange" | "purple" | "neutral";
  className?: string;
}

// Compact inline stat. Use trong feature grid hoặc value-prop sections.
// KHÔNG có animation (lightweight). Cho heavy animation dùng <SectionStats>.
export function StatCard({
  value,
  label,
  description,
  icon,
  accent = "orange",
  className,
}: StatCardProps) {
  const accentClasses = {
    orange: "bg-orange-50 text-orange-600",
    purple: "bg-purple-50 text-purple-700",
    neutral: "bg-neutral-100 text-neutral-700",
  };

  return (
    <div
      className={cn(
        "bg-white p-6",
        tokens.radius.card,
        "border border-neutral-200",
        tokens.shadows.subtle,
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            "inline-flex items-center justify-center w-10 h-10 rounded-lg mb-3",
            accentClasses[accent],
          )}
        >
          {icon}
        </div>
      )}
      <div className="text-3xl md:text-4xl font-bold text-neutral-900 mb-1">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="text-sm font-semibold text-neutral-700 mb-1">{label}</div>
      {description && <p className="text-xs text-neutral-500 leading-relaxed">{description}</p>}
    </div>
  );
}
