// Khung dùng chung cho hai form mở lớp trải nghiệm (một ngày · cả kỳ) — 23/09/2026.
//
// Bố cục "bảng khai": mỗi MỤC là một hàng — tên mục + một dòng giải thích ở cột trái,
// ô nhập ở cột phải. Mục hẹp hơn 36rem thì hai cột xếp chồng. Các mục nằm trong MỘT bề mặt, ngăn
// bằng đường kẻ — không lồng thẻ trong thẻ.
//
// Chia hai cột theo BỀ RỘNG CỦA CHÍNH MỤC (container query), không theo màn hình: ở
// 768px có sidebar, vùng nội dung chỉ ~460px — chia theo viewport là cắt cụt ô nhập.
//
// Không mang "use client": chỉ là JSX thuần, được hai form client import.
import type { JSX, ReactNode } from "react";

export function MucForm({
  tieuDe,
  moTa,
  children,
}: {
  tieuDe: string;
  moTa?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="@container p-4 sm:p-5">
      <div className="grid gap-x-8 gap-y-3 @xl:grid-cols-[11rem_minmax(0,1fr)] @3xl:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">{tieuDe}</h3>
          {moTa ? <p className="text-xs leading-relaxed text-muted-foreground">{moTa}</p> : null}
        </div>
        <div className="min-w-0 space-y-3">{children}</div>
      </div>
    </section>
  );
}

/**
 * Nút bật/tắt dạng chip (thứ, cơ sở, khung giờ). `aria-pressed` nói trạng thái cho trình
 * đọc màn hình; trên màn cảm ứng vùng chạm cao 44px.
 */
export function NutChon({
  chon,
  onClick,
  disabled,
  title,
  ariaLabel,
  xuongDong = false,
  children,
}: {
  chon: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  /** Nhãn dài (tên cơ sở) được xuống dòng thay vì tràn khỏi khung ở màn hẹp. */
  xuongDong?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={chon}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex min-w-[3rem] items-center justify-center rounded-lg border px-3 text-sm ${
        xuongDong ? "min-h-9 max-w-full py-1.5 text-left pointer-coarse:min-h-11" : "h-9 whitespace-nowrap pointer-coarse:h-11"
      } transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed ${
        chon
          ? "border-primary bg-primary font-medium text-white hover:bg-primary-dark"
          : "border-border bg-card text-foreground hover:bg-muted disabled:bg-muted disabled:text-muted-foreground disabled:opacity-60"
      }`}
    >
      {children}
    </button>
  );
}

/** "2026-09-23" → "23/09/2026" (hoặc "23/09" khi `ngan`). */
export function ngayVn(ymd: string, ngan = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  return ngan ? `${m[3]}/${m[2]}` : `${m[3]}/${m[2]}/${m[1]}`;
}

export const O_NHAP =
  "h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground pointer-coarse:h-11 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-50";

/**
 * Ô KHUNG GIỜ tự do: "Từ … Đến …" + các khung đã cấu hình làm LỐI TẮT một chạm.
 *
 * Chủ dự án 23/09/2026: "khung giờ làm tuỳ chọn linh hoạt chứ không cứng ngắt như này" —
 * bản trước là một ô chọn chỉ có đúng các khung cấu hình, muốn mở 18:00–20:00 là không có
 * đường. Nay gõ giờ nào cũng được; cổng vẫn ở server (lớp phải nằm TRỌN trong giờ mở của
 * thứ đó — QĐ-A4, 22/09), và `loi` nói ra NGAY khi gõ lệch, không đợi bấm lưu.
 */
export function OKhungGio({
  startTime,
  endTime,
  goiY,
  onDoi,
  disabled,
  loi,
  nhan,
}: {
  startTime: string;
  endTime: string;
  /** Các khung đã cấu hình của (các) thứ đang chọn — bày thành nút chọn nhanh. */
  goiY: readonly { startTime: string; endTime: string }[];
  onDoi: (gio: { startTime: string; endTime: string }) => void;
  disabled?: boolean;
  /** Câu báo khi giờ đang gõ không mở được lớp. `null` = hợp lệ. */
  loi: string | null;
  /** Tiền tố nhãn trợ năng, vd "tuỳ chọn 2". */
  nhan: string;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Từ
          <input
            type="time"
            value={startTime}
            onChange={(e) => onDoi({ startTime: e.target.value, endTime })}
            disabled={disabled}
            required
            aria-label={`Giờ bắt đầu ${nhan}`}
            className={`${O_NHAP} w-[8.75rem] tabular-nums`}
          />
        </label>
        <span aria-hidden className="pb-2 text-muted-foreground">
          –
        </span>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Đến
          <input
            type="time"
            value={endTime}
            onChange={(e) => onDoi({ startTime, endTime: e.target.value })}
            disabled={disabled}
            required
            aria-label={`Giờ kết thúc ${nhan}`}
            className={`${O_NHAP} w-[8.75rem] tabular-nums`}
          />
        </label>
      </div>
      {goiY.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Khung gợi ý ${nhan}`}>
          <span className="text-xs text-muted-foreground">Chọn nhanh</span>
          {goiY.map((k) => (
            <NutChon
              key={`${k.startTime}-${k.endTime}`}
              chon={k.startTime === startTime && k.endTime === endTime}
              onClick={() => onDoi({ startTime: k.startTime, endTime: k.endTime })}
              disabled={disabled}
            >
              <span className="tabular-nums">
                {k.startTime}–{k.endTime}
              </span>
            </NutChon>
          ))}
        </div>
      )}
      {loi && (
        <p role="alert" className="text-xs text-state-warning-ink">
          {loi}
        </p>
      )}
    </div>
  );
}
