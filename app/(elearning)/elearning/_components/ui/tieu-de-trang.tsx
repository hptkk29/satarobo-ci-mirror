import { cn } from "@/lib/utils";

/**
 * Đầu trang của khu học tập theo thiết kế (`.ph`): tiêu đề 28/34 (23/30 ≤ 720px), dòng mô tả màu phụ đậm rộng tối đa 68 ký tự, cụm hành động bên phải
 * (xuống dưới, kéo giãn ở ≤ 720px). Cùng chữ ký với `PageHeader` của admin để thay thế tại chỗ — nhưng KHÔNG dùng chung kiểu: admin giữ cỡ chữ riêng.
 */
export function TieuDeTrang({
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
    <header className={cn("flex flex-wrap items-end justify-between gap-4 max-[720px]:items-start", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.01em] text-foreground max-[720px]:text-[23px] max-[720px]:leading-[30px]">
          {title}
        </h1>
        {subtitle ? <p className="max-w-[68ch] text-[color:var(--el-text2)]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2 max-[720px]:w-full max-[720px]:[&>*]:flex-auto">{actions}</div> : null}
    </header>
  );
}
