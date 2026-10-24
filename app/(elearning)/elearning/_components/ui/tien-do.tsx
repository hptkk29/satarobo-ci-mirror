import { cn } from "@/lib/utils";

/**
 * Thanh tiến độ — CSS thuần (Recharts bị ESLint chặn ở khu này). Là `role="progressbar"` thật với nhãn đọc được,
 * chứ không phải một `div` tô màu: trình đọc màn hình không có cách nào biết "40%" nếu chỉ có độ rộng.
 */
export function TienDo({
  phanTram,
  nhan,
  className,
}: {
  phanTram: number;
  /** Nhãn đọc cho trình đọc màn hình, vd tên khoá. */
  nhan: string;
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, Math.round(phanTram)));
  return (
    <div
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Tiến độ ${nhan}`}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${v}%` }} />
    </div>
  );
}
