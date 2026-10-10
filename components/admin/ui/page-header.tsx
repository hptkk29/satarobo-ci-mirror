import { cn } from "@/lib/utils";

/**
 * Đầu trang admin. Port từ `nhhatvy/TeachUI` (`src/components/ui/page-header.tsx`).
 *
 * `min-w-0` trên khối tiêu đề + `shrink-0` trên khối nút: thiếu cặp này thì tiêu đề dài
 * (tiếng Việt có dấu hay đè) sẽ đẩy cụm nút tràn ra ngoài thay vì tự xuống hàng.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
      )}
    </div>
  );
}
