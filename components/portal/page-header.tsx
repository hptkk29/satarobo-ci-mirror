import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Portal v2 (merge SataUI) — hero header gradient + pill số liệu.
//
// Chữ dùng `--accent-foreground` (mực tương phản với accent) thay vì trắng cứng:
// phụ huynh đổi được màu nhấn sang màu SÁNG, khi đó chữ trắng sẽ không đọc nổi.
// Với accent mặc định (tím/cam) biến này = #fff nên hiển thị y như trước.

export function PageHero({
  icon: Icon,
  overline,
  title,
  subtitle,
  metric,
}: {
  icon?: LucideIcon;
  overline?: string;
  title: string;
  subtitle?: string;
  metric?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-accent to-accent/80 p-5 text-[color:var(--accent-foreground)] sm:p-6",
      )}
    >
      {Icon && (
        <Icon className="pointer-events-none absolute -right-4 -top-4 size-28 rotate-12 opacity-10" />
      )}
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          {Icon && (
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/15 ring-4 ring-white/10 sm:size-14">
              <Icon className="size-6 sm:size-7" />
            </span>
          )}
          <div className="min-w-0">
            {overline && (
              <p className="text-xs font-bold uppercase tracking-wider opacity-70">
                {overline}
              </p>
            )}
            <h1 className="text-balance text-xl font-bold tracking-tight sm:text-2xl">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-0.5 line-clamp-2 text-xs font-medium opacity-80 sm:text-sm">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {metric && <div className="shrink-0">{metric}</div>}
      </div>
    </div>
  );
}

export function HeroMetric({
  label,
  value,
}: {
  label: React.ReactNode;
  value: string;
}) {
  return (
    <div className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white/15 px-4 py-2.5 backdrop-blur-sm sm:w-auto sm:justify-start">
      <p className="text-xs font-bold opacity-80">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
