import { cn } from "@/lib/utils";

/**
 * Nhãn trạng thái cho admin. Port hình thức từ `nhhatvy/TeachUI`
 * (`src/components/ui/status-pill.tsx`), màu theo DESIGN.md §1.
 *
 * VÌ SAO `inline-flex whitespace-nowrap`: badge cũ để chữ tự xuống dòng, nên "Đang học"
 * vỡ làm HAI DÒNG trong pill ở bảng /students (chụp được 11/08) và kéo chiều cao dòng
 * bảng nhảy từ 61 lên 71px không đều nhau. Nhãn trạng thái không bao giờ được xuống dòng.
 *
 * VÌ SAO DÙNG THANG NGỮ NGHĨA, KHÔNG DÙNG MÀU THƯƠNG HIỆU: trước đây "Đang học / Đã duyệt"
 * mượn tone brand, làm cam vừa có nghĩa "thương hiệu" vừa có nghĩa "ổn" — người dùng hết
 * đọc được trạng thái qua màu. Xem DESIGN.md §1.
 */
export type PillTone = "success" | "warning" | "danger" | "info" | "brand" | "muted";

const toneClass: Record<PillTone, string> = {
  success: "bg-[color:var(--state-success-soft)] text-[color:var(--state-success)]",
  warning: "bg-[color:var(--state-warning-soft)] text-[color:var(--state-warning)]",
  danger: "bg-[color:var(--state-danger-soft)] text-[color:var(--state-danger)]",
  info: "bg-[color:var(--state-info-soft)] text-[color:var(--state-info)]",
  brand: "bg-[color:var(--primary-soft)] text-[color:var(--primary)]",
  muted: "bg-muted text-muted-foreground",
};

export function StatusPill({
  children,
  tone = "muted",
  className,
}: {
  children: React.ReactNode;
  tone?: PillTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5",
        "text-xs font-semibold",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
