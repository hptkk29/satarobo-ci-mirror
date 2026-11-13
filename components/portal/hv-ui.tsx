import { cn } from "@/lib/utils";
import { Sticker, type TenSticker } from "@/components/portal/sticker";

// Khối dựng chung của các màn Cổng học sinh (artifact HV-*). Server-compatible (không state). Màu CHỈ qua token.

/** Đầu trang: dòng nhỏ cam + tiêu đề Bitter + mô tả. */
export function HvDauTrang({
  nhan,
  tieuDe,
  phu,
  phai,
  className,
}: {
  nhan?: string;
  tieuDe: string;
  phu?: string;
  phai?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {nhan && <div className="text-xs font-bold tracking-[0.08em] text-[var(--sr-orange-text)]">{nhan}</div>}
        <h1 className="m-0 font-display text-[26px] font-extrabold leading-[32px] min-[900px]:text-[32px] min-[900px]:leading-[38px]">
          {tieuDe}
        </h1>
        {phu && <div className="max-w-[720px] text-[15px] leading-[23px] text-muted-foreground">{phu}</div>}
      </div>
      {phai}
    </header>
  );
}

/** Thẻ trắng bo 22px. `vien` đổi viền: cam (việc chính) / tím / xanh. */
export function HvThe({
  children,
  vien,
  className,
  as: Tag = "section",
  ...rest
}: {
  children: React.ReactNode;
  vien?: "cam" | "tim" | "xanh";
  className?: string;
  as?: "section" | "div" | "article";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      {...rest}
      className={cn(
        "flex flex-col gap-3.5 rounded-[22px] bg-card p-[22px] text-card-foreground",
        vien === "cam" && "border-2 border-[var(--sr-orange)]",
        vien === "tim" && "border-2 border-[var(--sr-purple)]",
        vien === "xanh" && "border-2 border-[var(--sr-success)]",
        !vien && "border border-border",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Lưới tự co: mỗi ô tối thiểu `min` px. */
export function HvLuoi({ min = 340, children, className }: { min?: number; children: React.ReactNode; className?: string }) {
  return (
    <div
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))` }}
      className={cn("grid items-start gap-5", className)}
    >
      {children}
    </div>
  );
}

/** Khối «chưa có gì» của Cổng học sinh — kèm sticker robot (mặc định kính lúp) ở trên câu chữ. */
export function HvTrong({ children, sticker = "tim-kiem" }: { children: React.ReactNode; sticker?: TenSticker }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[22px] border border-dashed border-[var(--sr-dash)] bg-card p-8 text-center text-[15px] leading-6 text-muted-foreground">
      <Sticker ten={sticker} cao={88} />
      <div>{children}</div>
    </div>
  );
}

/** Nút cam chính (chữ mực tối — cam là màu SÁNG, chữ trắng trượt tương phản). */
export const NUT_CAM =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--sr-orange)] px-5 font-bold text-[var(--sr-on-orange)] no-underline transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";
export const NUT_VIEN =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 font-bold text-foreground no-underline hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60";
export const NUT_TAT =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--sr-tint-purple)] px-5 font-bold text-muted-foreground";
