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

/** Tối đa số lỗ vẽ — quá nhiều bài thì thanh "dầm" thành một dải vụn; rơi về `TienDo` thường. */
export const TOI_DA_LO_DAM = 24;

/**
 * Thanh tiến độ kiểu "dầm" của thiết kế (`.beam`): mỗi bài là một LỖ — lỗ đầy (đã xong), lỗ viền (bài đang học), lỗ rỗng
 * (chưa học). Cùng `role="progressbar"` như `TienDo`: giá trị là SỐ BÀI xong chứ không phải %, và nhãn nói rõ "3 trên 8 bài".
 * Thuần CSS (token `--el-*` của elearning.css), không SVG, không Recharts.
 */
export function TienDoDam({
  tong,
  xong,
  dangHoc,
  nhan,
  lon = false,
  className,
}: {
  tong: number;
  xong: number;
  /** Chỉ số (0-based) của bài đang học, nếu có — vẽ lỗ viền. */
  dangHoc?: number;
  nhan: string;
  lon?: boolean;
  className?: string;
}) {
  const t = Math.max(0, Math.floor(tong));
  const x = Math.max(0, Math.min(t, Math.floor(xong)));
  if (t === 0) return null;
  if (t > TOI_DA_LO_DAM) return <TienDo phanTram={(x / t) * 100} nhan={nhan} className={className} />;
  return (
    <div
      role="progressbar"
      aria-valuenow={x}
      aria-valuemin={0}
      aria-valuemax={t}
      aria-valuetext={`${x} trên ${t} bài`}
      aria-label={`Tiến độ ${nhan}`}
      className={cn(
        "inline-flex max-w-full items-center overflow-hidden rounded-lg bg-[var(--el-beam)]",
        lon ? "gap-[7px] px-2.5 py-[7px]" : "gap-[5px] px-2 py-[5px]",
        className,
      )}
    >
      {Array.from({ length: t }, (_, i) => {
        const dayDu = i < x;
        const hienTai = !dayDu && dangHoc === i;
        return (
          <i
            key={i}
            aria-hidden
            data-lo={dayDu ? "day" : hienTai ? "hien-tai" : "rong"}
            className={cn(
              "block shrink-0 rounded-full",
              lon ? "size-2.5" : "size-2",
              dayDu && "bg-[var(--el-fill)]",
              hienTai && "bg-card shadow-[inset_0_0_0_2px_var(--el-fill)]",
              !dayDu && !hienTai && "bg-[var(--el-hole)] shadow-[inset_0_1px_1px_rgba(0,0,0,0.28)]",
            )}
          />
        );
      })}
    </div>
  );
}
