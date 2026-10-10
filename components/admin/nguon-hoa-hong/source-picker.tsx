"use client";

// components/admin/nguon-hoa-hong/source-picker.tsx — SourcePicker: chọn MỘT nguồn trong danh mục (06 §5.1).
//
// Vì sao danh sách radio chứ không dropdown: các nguồn (8 mặc định + nguồn admin thêm) cần THẤY CÙNG LÚC để chọn đúng — hai nguồn "giới thiệu" cạnh nhau
// khác nghĩa hoàn toàn về tiền, và một dropdown giấu cái này sau cái kia. Gom thành hai cụm theo THUỘC TÍNH
// (`referrerRequirement`): "có người giới thiệu" (chọn xong sẽ hỏi người) và "không có người giới thiệu".
//
// UNKNOWN không có mặt (hệ thống gán, không phải lựa chọn của người nhập) — lọc ở `locNhomChon`, không ở đây.
// Danh mục MỞ: render theo dữ liệu, chịu được 15–20 mục (06 §6).
//
// Radio dựng bằng `<input type="radio">` gốc có style (repo không có `radio-group`; PRODUCT.md: không thêm dependency).
import { useId } from "react";
import { gomTheoNguoi, loaiNguoiCuaNhom, type NhomChon } from "@/lib/nguon/chon-nguon";
import { cn } from "@/lib/utils";

/**
 * Dòng phụ dưới tên nguồn: nói điều người chọn sẽ phải làm TIẾP. Sự kiện không nói gì: chưa có danh mục sự kiện để chọn
 * (chưa có module), nên không hứa một ô chọn không tồn tại.
 */
function ghiChuNhom(n: NhomChon): string | null {
  const loai = loaiNguoiCuaNhom(n.referrerRequirement);
  const phan: string[] = [];
  if (loai) phan.push(`Chọn ${NHAN_NGUOI_NGAN[loai]}`);
  if (n.requiresNote) phan.push("Phải giải trình");
  return phan.length > 0 ? phan.join(" · ") : null;
}

/** Chữ NGẮN của việc phải làm tiếp — nằm cùng dòng với tên nguồn để cả danh sách vừa trong một màn hình. */
const NHAN_NGUOI_NGAN: Record<NonNullable<ReturnType<typeof loaiNguoiCuaNhom>>, string> = {
  NHAN_SU: "nhân sự",
  PHU_HUYNH: "phụ huynh",
  DOI_TAC: "đối tác",
};

export function SourcePicker({
  nhom,
  value,
  onChange,
  disabled = false,
  invalid,
  idPrefix,
}: {
  nhom: readonly NhomChon[];
  /** `id` của nhóm đang chọn; null = chưa chọn. */
  value: string | null;
  onChange: (nhom: NhomChon) => void;
  disabled?: boolean;
  /** Câu lỗi đặt CẠNH nhóm radio (lỗi server map về field `nguon`). */
  invalid?: string;
  idPrefix: string;
}) {
  const uid = useId();
  const ten = `${idPrefix}-${uid}-nguon`;
  const idLoi = `${ten}-loi`;
  const { coNguoi, khongNguoi } = gomTheoNguoi(nhom);

  const cum = (tieuDe: string, ds: readonly NhomChon[]) =>
    ds.length === 0 ? null : (
      <div>
        <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{tieuDe}</p>
        <div className="space-y-1.5">
          {ds.map((n) => {
            const dangChon = n.id === value;
            const phu = ghiChuNhom(n);
            return (
              <label
                key={n.id}
                className={cn(
                  "flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                  "focus-within:ring-2 focus-within:ring-ring",
                  dangChon ? "border-primary bg-primary-soft" : "border-border bg-card hover:bg-muted",
                  disabled && "cursor-not-allowed opacity-60 hover:bg-card",
                )}
              >
                <input
                  type="radio"
                  name={ten}
                  value={n.id}
                  checked={dangChon}
                  disabled={disabled}
                  onChange={() => onChange(n)}
                  aria-describedby={invalid ? idLoi : undefined}
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                {/* Tên và việc-phải-làm-tiếp CÙNG MỘT dòng khi đủ chỗ, tự xuống dòng khi hẹp (điện thoại). */}
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-sm font-medium text-foreground">{n.name}</span>
                  {phu && <span className="text-xs text-muted-foreground">{phu}</span>}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    );

  return (
    <fieldset className="min-w-0 space-y-3" disabled={disabled} aria-invalid={invalid ? true : undefined}>
      <legend className="mb-1.5 text-sm font-medium text-foreground">Nguồn</legend>
      {cum("Có người giới thiệu", coNguoi)}
      {cum("Không có người giới thiệu", khongNguoi)}
      {nhom.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          Chưa có nguồn nào được bật để chọn. Liên hệ quản trị viên hệ thống.
        </p>
      )}
      {invalid && (
        <p id={idLoi} role="alert" className="text-xs text-state-danger-ink">
          {invalid}
        </p>
      )}
    </fieldset>
  );
}
