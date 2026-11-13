// Khối thông báo trạng thái của liên kết (hết hiệu lực / tạm khoá / thao tác quá nhanh / hệ thống bận / đã nhận). Không trạng thái, không hook ⇒ dùng được cả ở Server Component
// (trang) lẫn Client Component (biểu mẫu khi liên kết hết hạn giữa chừng) — cùng MỘT khối nên hai đường ra cùng một câu chữ.
import * as React from "react";

type Props = { tieuDe: string; noiDung: string; /** `true` ⇒ thông báo thành công (nhấn màu xanh), mặc định là thông báo bình thường. */ thanhCong?: boolean; tieuDeRef?: React.Ref<HTMLHeadingElement> };

export function ThongBaoLienKet({ tieuDe, noiDung, thanhCong = false, tieuDeRef }: Props) {
  return (
    <section aria-live="polite" className="rounded-xl border border-border bg-card p-6 text-card-foreground">
      <h1 ref={tieuDeRef} tabIndex={-1} className={`text-xl font-semibold outline-none ${thanhCong ? "text-emerald-800" : ""}`}>
        {tieuDe}
      </h1>
      <p className="mt-2 text-base leading-relaxed text-muted-foreground">{noiDung}</p>
    </section>
  );
}
