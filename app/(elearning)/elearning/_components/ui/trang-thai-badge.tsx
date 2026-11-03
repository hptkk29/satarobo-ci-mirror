import { cn } from "@/lib/utils";
import type { SacThai } from "@/lib/elearning/dashboard-pure";

// Nhãn trạng thái. CHỮ dùng bậc `-ink` (đạt AA); nền là tint nhạt. Màu KHÔNG BAO GIỜ đứng một mình: luôn có chữ.
// `whitespace-nowrap` để "Đang học" không vỡ hai dòng trong pill (lỗi đã chụp ở DESIGN.md §3).
const LOP: Record<SacThai, string> = {
  success: "bg-state-success-soft text-state-success-ink",
  warning: "bg-state-warning-soft text-state-warning-ink",
  danger: "bg-state-danger-soft text-state-danger-ink",
  info: "bg-state-info-soft text-state-info-ink",
  muted: "bg-muted text-muted-foreground",
};

export function TrangThaiBadge({
  sac,
  children,
  className,
}: {
  sac: SacThai;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
        LOP[sac],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Màu chữ cho dòng phụ (hạn…) — cùng thang, cùng bậc mực. */
export const MUC_CHU: Record<SacThai, string> = {
  success: "text-state-success-ink",
  warning: "text-state-warning-ink",
  danger: "text-state-danger-ink",
  info: "text-state-info-ink",
  muted: "text-muted-foreground",
};
