import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Thẻ số liệu — port từ TeachUI.
 *
 * `brand` = cam thương hiệu. Các tone còn lại là NGỮ NGHĨA, không phải thương
 * hiệu: green = tốt/xong, amber = đang chờ, red = lỗi, blue = thông tin.
 * Mỗi tone có biến thể dark sáng hơn để số liệu không bị chìm trên nền tối.
 */
export type StatTone = "brand" | "green" | "amber" | "red" | "blue";

const tones: Record<StatTone, string> = {
  brand: "text-primary-ink",
  green: "text-state-success-ink",
  amber: "text-state-warning-ink",
  red: "text-state-danger-ink",
  blue: "text-state-info-ink",
};

const tints: Record<StatTone, string> = {
  brand: "bg-primary-soft",
  green: "bg-state-success-soft",
  amber: "bg-state-warning-soft",
  red: "bg-state-danger-soft",
  blue: "bg-state-info-soft",
};

export function StatCard({
  icon: Icon,
  value,
  label,
  tone = "brand",
  hint,
}: {
  icon: LucideIcon;
  value: string | number;
  label: string;
  tone?: StatTone;
  hint?: string;
}) {
  return (
    <div className="t-card t-card-hover flex items-center gap-3 p-3.5">
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          tints[tone],
        )}
      >
        <Icon
          className={cn("h-[18px] w-[18px]", tones[tone])}
          strokeWidth={2}
          aria-hidden
        />
      </span>
      <div className="min-w-0">
        <p className={cn("text-xl leading-tight font-bold", tones[tone])}>
          {value}
        </p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        {hint && (
          <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
        )}
      </div>
    </div>
  );
}
