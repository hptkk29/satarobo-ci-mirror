import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Trạng thái rỗng — port từ TeachUI. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  tone = "slate",
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  tone?: "slate" | "green";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl px-6 py-10 text-center",
        tone === "green"
          ? "bg-state-success-soft text-state-success-ink dark:bg-state-success-soft dark:text-state-success-ink"
          : "bg-muted/50 text-muted-foreground",
        className,
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            "mb-3 h-8 w-8",
            tone === "green"
              ? "text-state-success-ink"
              : "text-muted-foreground",
          )}
          aria-hidden
        />
      )}
      <p className="text-sm font-semibold">{title}</p>
      {description && <p className="mt-1 text-sm opacity-80">{description}</p>}
    </div>
  );
}

/** Banner "đã sạch việc" trên trang chủ GV. */
export function SuccessBanner({
  icon: Icon,
  children,
}: {
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-state-success-soft px-4 py-3.5 text-sm font-medium text-state-success-ink">
      {Icon && (
        <Icon className="h-5 w-5 shrink-0 text-state-success-ink" aria-hidden />
      )}
      <span>{children}</span>
    </div>
  );
}
