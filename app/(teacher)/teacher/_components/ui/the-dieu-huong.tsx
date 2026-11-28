import Link from "next/link";
import { ArrowLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Thẻ điều hướng — một lối sang MÀN KHÁC, trông ra lối bấm: biểu tượng · tên màn · một dòng nói màn đó có gì · mũi tên.
 *
 * Sinh ra từ nghiệm thu 20/10/2026: "Công tháng của tôi" là một liên kết chữ lẫn trong đoạn văn, người dùng không nhận ra bấm
 * được. Cả thẻ là vùng bấm (cao ≥ 64px — vừa ngón tay ở 375px), có hover và vòng focus bàn phím.
 * `quayLai` = lối quay về màn trước (mũi tên trái đứng đầu thay cho mũi tên phải ở cuối).
 */
export function TheDieuHuong({
  href,
  icon: Icon,
  title,
  description,
  quayLai = false,
  className,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  quayLai?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "t-card group flex min-h-16 items-center gap-3 p-3.5 transition-colors hover:border-primary hover:bg-primary-soft/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      {quayLai && <ArrowLeft className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary-ink" aria-hidden />}
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
        <Icon className="h-5 w-5 text-primary-ink" strokeWidth={2} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-foreground group-hover:text-primary-ink">{title}</span>
        {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
      </span>
      {!quayLai && <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary-ink" aria-hidden />}
    </Link>
  );
}
