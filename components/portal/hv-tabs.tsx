"use client";

import { cn } from "@/lib/utils";

/** Thanh tab dạng viên thuốc của artifact (HV-Bai-tap / HV-Lich / HV-San-pham): nền tím nhạt, tab đang chọn nổi trắng. */
export function HvTabs<T extends string>({
  nhan,
  muc,
  gia,
  doi,
  cao = 42,
  className,
}: {
  nhan: string;
  muc: { id: T; ten: string }[];
  gia: T;
  doi: (id: T) => void;
  cao?: number;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={nhan}
      className={cn("flex gap-1.5 rounded-[14px] bg-[var(--sr-tint-purple)] p-1", className)}
    >
      {muc.map((m) => {
        const on = m.id === gia;
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => doi(m.id)}
            style={{ height: cao }}
            className={cn(
              "min-w-0 flex-1 rounded-[10px] px-2 text-sm",
              on ? "bg-card font-bold text-foreground shadow-[0_1px_2px_var(--sr-shadow)]" : "bg-transparent font-semibold text-muted-foreground",
            )}
          >
            {m.ten}
          </button>
        );
      })}
    </div>
  );
}
