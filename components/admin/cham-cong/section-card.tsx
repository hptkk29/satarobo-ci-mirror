// components/admin/cham-cong/section-card.tsx — khối nội dung có tiêu đề trong một màn.
//
// Vì sao file này tồn tại: các màn dài (kỳ công, đối soát, import) trước đây xếp bảng nối bảng không
// phân đoạn, nên "việc còn dang dở" trông ngang hàng với "bảng công của cả kỳ". Thẻ này cho một
// đoạn có tên, và `tone` để đoạn CẢNH BÁO khác đoạn thường bằng viền — không phải bằng nền màu
// (nền màu lồng trong thẻ trắng đọc thành hai tầng thẻ).
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TONE = {
  default: "border-border",
  warning: "border-state-warning-soft",
  success: "border-state-success-soft",
} as const;

export function SectionCard({
  title,
  icon: Icon,
  actions,
  tone = "default",
  className,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  tone?: "default" | "warning" | "success";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border bg-card p-5", TONE[tone], className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          {Icon && <Icon aria-hidden className="h-4 w-4 text-primary" />}
          {title}
        </h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
