// Đầu NỘI DUNG của một trang trong khu Hoá đơn (S5b). <h1> thuộc về layout ("Hoá đơn điện tử"); trang chỉ có mô tả
// ngắn (+ tiêu đề mục <h2> khi trang không tự nói được mình là gì) và lối sang trang phụ. Server-safe, không state.
// `[&_a]:…` ở vùng hành động: liên kết phụ thấp 18–20px (WCAG 2.5.8 đòi ≥ 24px; 44px khi cảm ứng) — đặt ở khung chứa để mọi lối
// 05/11/2026 — `huongDan`: biểu tượng «?» đứng NGAY cạnh tiêu đề mục (cùng `HelpHint` của các form), để người dùng hỏi «mục này là gì, ai sửa, sai thì sao» đúng chỗ họ đang nhìn,
// thay vì một đoạn văn xám dài bên dưới tiêu đề mà ai cũng lướt qua. Tuỳ chọn: mọi trang đang dùng thành phần này không đổi một pixel.
import type { ReactNode } from "react";
import { HelpHint } from "@/components/admin/ui/help-hint";

export function TieuDeMuc({
  tieuDe,
  moTa,
  hanhDong,
  huongDan,
  nhanHuongDan,
}: {
  tieuDe?: string;
  moTa: ReactNode;
  hanhDong?: ReactNode;
  /** Chữ hướng dẫn (từ `huongDan("…")`) hiện khi bấm / rê vào «?» cạnh tiêu đề. Chỉ có tác dụng khi có `tieuDe`. */
  huongDan?: string;
  /** Tên đọc cho trình đọc màn hình của nút «?» — nên nêu mục (vd. «Xem hướng dẫn Bước 2»). */
  nhanHuongDan?: string;
}) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {tieuDe ? (
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
            {tieuDe}
            {huongDan ? <HelpHint label={nhanHuongDan ?? `Xem hướng dẫn: ${tieuDe}`}>{huongDan}</HelpHint> : null}
          </h2>
        ) : null}
        <p className="text-sm text-muted-foreground">{moTa}</p>
      </div>
      {hanhDong ? <div className="flex flex-wrap items-center gap-3 sm:shrink-0 [&_a]:inline-flex [&_a]:min-h-6 [&_a]:items-center [&_a]:pointer-coarse:min-h-11">{hanhDong}</div> : null}
    </div>
  );
}
