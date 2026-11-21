// components/admin/nguon-hoa-hong/chi-tiet-nguon/khung-muc.tsx — VỎ CHUNG của bảy mục ở trang chi tiết nguồn (Server Component, không state).
//
// Hình: một thẻ duy nhất do trang vẽ; mỗi mục là <section> chia bằng tiêu đề + đường kẻ — KHÔNG thẻ lồng thẻ (DESIGN.md, craft-floor). Mục nào đọc hỏng / thiếu quyền thì chỉ MỤC ĐÓ nói
// (một dòng chữ, không hộp bo góc trong thẻ): bảy mục độc lập, một mục hỏng không che sáu mục còn lại.
import type { ReactNode } from "react";
import { Lock, TriangleAlert } from "lucide-react";

/** Hàng «nhãn — giá trị»: cột nhãn cố định 12,5rem (đủ cho «Tham gia hoa hồng theo nguồn» trên một dòng) ở màn rộng, xếp dọc ở màn hẹp (375px không đủ chỗ cho hai cột). */
export function Hang({ nhan, children }: { nhan: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 py-2 text-sm sm:grid-cols-[12.5rem_1fr]">
      <dt className="text-muted-foreground">{nhan}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

export function MucChiTiet({ id, tieuDe, ghiChu, children }: { id: string; tieuDe: string; ghiChu?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`muc-${id}`} data-muc={id} className="py-6 first:pt-0 last:pb-0">
      <h2 id={`muc-${id}`} className="text-base font-semibold text-foreground">
        {tieuDe}
      </h2>
      {ghiChu && <p className="mt-1 text-xs text-muted-foreground">{ghiChu}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Mục không đọc được: lỗi (có đường thử lại) hoặc thiếu quyền (nêu khoá thật). Một dòng chữ, không hộp. */
export function MucKhongDoc({ loai, khoa = "sources:view" }: { loai: "QUYEN" | "LOI"; khoa?: string }) {
  if (loai === "QUYEN") {
    return (
      <p role="note" data-trang-thai="khong-quyen" className="flex items-start gap-2 text-sm text-state-warning-ink">
        <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Bạn không có quyền xem mục này. Quyền cần xin: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{khoa}</code>.
        </span>
      </p>
    );
  }
  return (
    <p role="alert" data-trang-thai="loi" className="flex items-start gap-2 text-sm text-state-danger-ink">
      <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <span>Không đọc được mục này. Tải lại trang; nếu vẫn lỗi, báo bộ phận kỹ thuật — các mục khác vẫn xem được.</span>
    </p>
  );
}

/** Mục có dữ liệu nhưng rỗng: nói VÌ SAO rỗng và (nếu có) làm gì tiếp. */
export function MucRong({ children }: { children: ReactNode }) {
  return (
    <p data-trang-thai="rong" className="text-sm text-muted-foreground">
      {children}
    </p>
  );
}
