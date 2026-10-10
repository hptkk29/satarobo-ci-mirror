// app/(admin)/admin/students/_components/ho-so/o-nhap.tsx — từ vựng ô nhập + nút của màn
// "Hồ sơ học viên" (25/09/2026). Một chỗ khai lớp CSS để mọi ô cùng một chiều cao, một
// kiểu viền, một vòng focus — "nút Lưu trông khác nhau ở hai chỗ thì một chỗ sai".
//
// Chiều cao `h-10` trên điện thoại (vùng chạm ≥40px — người dùng sửa hồ sơ ngay tại quầy
// bằng máy tính bảng/điện thoại), `sm:h-9` từ 640px trở lên cho mật độ admin.

import type { ReactNode } from "react";
import { FieldLabel } from "@/components/admin/ui/help-hint";
import { cn } from "@/lib/utils";

// ⚠️ Nền xám "chỉ đọc" gắn vào THUỘC TÍNH `data-chi-doc`, KHÔNG vào biến thể `read-only:`.
// Trong CSS, `<select>` LUÔN khớp `:read-only` (chỉ input chữ/textarea mới là `:read-write`),
// nên bản cũ tô xám MỌI ô chọn — trông y hệt ô bị khoá, người dùng tưởng không sửa được.
// Ô nào thật sự chỉ đọc (SĐT đang che theo quyền) thì tự khai `data-chi-doc`.
export const O_NHAP =
  "h-10 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm text-foreground " +
  "placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none " +
  "focus:ring-2 focus:ring-primary-soft data-[chi-doc]:bg-muted data-[chi-doc]:text-muted-foreground " +
  "disabled:cursor-not-allowed disabled:opacity-60 sm:h-9";

export const O_VAN_BAN =
  "min-h-20 w-full min-w-0 resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm " +
  "text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary " +
  "focus:outline-none focus:ring-2 focus:ring-primary-soft";

const NUT =
  "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 " +
  "text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none " +
  "disabled:opacity-50 sm:h-9";

export const NUT_CHINH = cn(NUT, "bg-primary text-primary-foreground shadow-sm hover:bg-primary-dark");
export const NUT_VIEN = cn(NUT, "border border-border bg-card text-foreground hover:bg-muted");
export const NUT_NGUY_HIEM = cn(
  NUT,
  "border border-state-danger-soft bg-card text-state-danger-ink hover:bg-state-danger-soft",
);
/** Nút chữ nhỏ trong thẻ (gỡ, đổi…) — vẫn cao 32px để bấm được bằng ngón tay. */
export const NUT_CHU =
  "inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-semibold " +
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:pointer-events-none disabled:opacity-50";

/**
 * Nhãn + ô. Nhãn là `<label htmlFor>` bọc ĐÚNG phần chữ, đặt trong `FieldLabel`: nếu bọc cả
 * `FieldLabel` thì nút "?" của HelpHint (cũng là phần tử "labelable") thành thứ được gắn
 * nhãn thay cho ô nhập, và tên đọc cho trình đọc màn hình dính thêm "Xem hướng dẫn".
 */
export function Truong({
  id,
  nhan,
  batBuoc,
  goiY,
  phu,
  keBenNhan,
  className,
  children,
}: {
  id: string;
  nhan: string;
  batBuoc?: boolean;
  /** Hướng dẫn ngắn — hiện qua icon "?" cạnh nhãn (không chiếm chỗ dưới ô). */
  goiY?: ReactNode;
  /** Dòng phụ LUÔN hiện dưới ô — chỉ dùng cho điều người dùng phải biết trước khi gõ. */
  phu?: ReactNode;
  /** Thứ đứng cuối hàng nhãn (vd link "Mở"). */
  keBenNhan?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <FieldLabel
          label={<label htmlFor={id}>{nhan}</label>}
          required={batBuoc}
          hint={goiY}
          hintLabel={`Hướng dẫn ô ${nhan}`}
        />
        {keBenNhan}
      </div>
      {children}
      {phu && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{phu}</p>}
    </div>
  );
}

/** Tiêu đề một nhóm ô trong tờ hồ sơ. */
export function TieuDeNhom({
  id,
  children,
  moTa,
}: {
  id: string;
  children: ReactNode;
  moTa?: ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <h2 id={id} className="text-sm font-semibold text-foreground">
        {children}
      </h2>
      {moTa && <p className="text-xs leading-relaxed text-muted-foreground">{moTa}</p>}
    </div>
  );
}
