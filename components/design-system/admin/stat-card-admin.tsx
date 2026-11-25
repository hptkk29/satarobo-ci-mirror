import type { ReactNode } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { tokens } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string | number;
  trend?: { direction: "up" | "down"; value: string };
  icon?: ReactNode;
  iconColor?: "orange" | "purple" | "neutral";
  className?: string;
}

/**
 * Thẻ số liệu admin. KHÔNG animation — chỉ đổi bóng khi hover (DESIGN.md §4).
 *
 * ĐÃ SỬA 11/08 — ba lỗi đo được trên /dashboard, không phải góp ý thẩm mỹ:
 *
 *  1. TRÀN SỐ. `955.563.000đ` ở `text-3xl` chiếm ~200px trong khi vùng nội dung của thẻ
 *     chỉ ~162px, nên số **tràn ra ngoài viền thẻ**. Tiền 9 chữ số là chuyện thường ở
 *     đây. Sửa bằng ba thứ CÙNG LÚC, thiếu một là vẫn tràn: hạ về `text-xl` (~132px),
 *     cho khối nội dung `min-w-0` (không có nó thì flex/grid con không bao giờ co lại),
 *     và `truncate` làm lưới an toàn cho số còn dài hơn nữa.
 *
 *  2. THẺ CAO THẤP KHÁC NHAU. Nhãn "Doanh thu / mục tiêu (tháng)" xuống 2 dòng còn
 *     "Tổng leads" 1 dòng, nên cả hàng thẻ so le. Nhãn nay `truncate` — một dòng, luôn.
 *
 *  3. MÀU HARDCODE. `bg-primary-soft text-primary` / `text-primary` là hex rời không
 *     đi qua token (DESIGN.md §1). Nay bám `.admin-scope`.
 *
 * `title={String(value)}` để số bị cắt vẫn đọc được đầy đủ khi rê chuột — cắt tiền mà
 * không có đường xem lại là giấu mất dữ liệu.
 */
export function StatCardAdmin({
  label,
  value,
  trend,
  icon,
  iconColor = "orange",
  className,
}: Props) {
  const iconColors = {
    orange: "bg-[color:var(--accent-soft)] text-[color:var(--accent)]",
    purple: "bg-[color:var(--primary-soft)] text-[color:var(--primary)]",
    neutral: "bg-muted text-muted-foreground",
  };

  const display =
    typeof value === "number" ? value.toLocaleString("vi-VN") : value;

  return (
    <div
      className={cn(
        "flex items-start gap-3 bg-card p-4",
        tokens.radius.card,
        tokens.borders.subtle,
        tokens.shadows.subtle,
        "transition-shadow duration-200 hover:shadow-md",
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            iconColors[iconColor],
          )}
          aria-hidden
        >
          {icon}
        </div>
      )}
      {/* min-w-0 là thứ cho phép `truncate` bên dưới hoạt động. Bỏ nó ra là số tràn lại. */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-muted-foreground">
          {label}
        </p>
        <div
          className="mt-0.5 truncate text-xl font-bold tabular-nums text-foreground"
          title={String(display)}
        >
          {display}
        </div>
        {trend && (
          <div
            className={cn(
              "mt-0.5 flex items-center gap-1 text-xs font-medium",
              // Bậc MỰC, không phải màu tô đặc: #EF4444 làm chữ trên nền trắng chỉ
              // đo được 3,76:1 — trượt AA. `-ink` là bậc đã cân cho chữ.
              trend.direction === "up"
                ? "text-[color:var(--state-success-ink)]"
                : "text-[color:var(--state-danger-ink)]",
            )}
          >
            {trend.direction === "up" ? (
              <TrendingUp className="h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <TrendingDown className="h-3 w-3 shrink-0" aria-hidden />
            )}
            <span className="truncate">{trend.value}</span>
          </div>
        )}
      </div>
    </div>
  );
}
