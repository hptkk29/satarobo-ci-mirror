"use client";

// components/admin/nguon-hoa-hong/chon-nguon-fields.tsx — BỘ Ô CHỌN NGUỒN dùng chung (06 §5.1, §5.6):
// SourcePicker → ReferrerPicker (chỉ khi nguồn cần người) → giải trình (chỉ khi nguồn bắt buộc).
//
// Dùng ở HAI chỗ: Sheet "Gán nguồn" và form nhập lead. Một bộ ô, một bộ luật (`lib/nguon/chon-nguon`) — hai form tự dựng lại là
// hai nơi lệch nhau về câu lỗi, về cách suy nhóm từ vai, về điều kiện hiện ô giải trình.
//
// Component CHỈ giữ giao diện; trạng thái do chỗ gọi giữ (`value`), để chỗ gọi kiểm + gửi đúng thứ nó đang hiển thị.
import { useId } from "react";
import {
  NHAN_VAI,
  groupIdSeGui,
  loaiNguoiCuaNhom,
  type NguoiDaChon,
  type NhomChon,
  type TruongLoiForm,
} from "@/lib/nguon/chon-nguon";
import { DO_DAI_GIAI_TRINH_TOI_THIEU } from "@/lib/nguon/kiem-nguon";
import { cn } from "@/lib/utils";
import { TEXTAREA } from "./classes";
import { ReferrerPicker, type HamTim } from "./referrer-picker";
import { SourcePicker } from "./source-picker";

export type TrangThaiChonNguon = {
  nhomId: string | null;
  nguoi: NguoiDaChon | null;
  giaiTrinh: string;
};

export const CHUA_CHON_NGUON: TrangThaiChonNguon = { nhomId: null, nguoi: null, giaiTrinh: "" };

/** Loại người đang cần ở nhóm này; đổi sang nhóm cần loại KHÁC thì người đã chọn phải bỏ (đối tác không thể là nhân sự). */
export function doiNhomChon(truoc: TrangThaiChonNguon, n: NhomChon): TrangThaiChonNguon {
  const loai = loaiNguoiCuaNhom(n.referrerRequirement);
  return {
    nhomId: n.id,
    nguoi: truoc.nguoi && loai === truoc.nguoi.loai ? truoc.nguoi : null,
    giaiTrinh: n.requiresNote ? truoc.giaiTrinh : "",
  };
}

export function ChonNguonFields({
  nhom,
  value,
  onChange,
  errors,
  disabled = false,
  tim,
  idPrefix,
}: {
  nhom: readonly NhomChon[];
  value: TrangThaiChonNguon;
  onChange: (v: TrangThaiChonNguon) => void;
  errors: Partial<Record<TruongLoiForm, string>>;
  disabled?: boolean;
  tim?: HamTim;
  idPrefix: string;
}) {
  const uid = useId();
  const chon = nhom.find((n) => n.id === value.nhomId) ?? null;
  const loaiNguoi = chon ? loaiNguoiCuaNhom(chon.referrerRequirement) : null;
  // Nhóm sẽ GHI = nhóm đang chọn (kể cả nhóm do admin tạo); vai của nhân sự chỉ ghi kèm làm ảnh chụp.
  const idGhi = groupIdSeGui(chon);
  const nhomGhi = nhom.find((n) => n.id === idGhi) ?? chon;

  const idGt = `${idPrefix}-${uid}-giai-trinh`;
  const idGtLoi = `${idGt}-loi`;
  const soKyTu = value.giaiTrinh.trim().length;

  return (
    <div className="space-y-4">
      <SourcePicker
        idPrefix={idPrefix}
        nhom={nhom}
        value={value.nhomId}
        onChange={(n) => onChange(doiNhomChon(value, n))}
        disabled={disabled}
        invalid={errors.nguon}
      />

      {loaiNguoi && (
        <div className="space-y-1.5">
          <ReferrerPicker
            idPrefix={idPrefix}
            loai={loaiNguoi}
            value={value.nguoi}
            onChange={(nguoi) => onChange({ ...value, nguoi })}
            tim={tim}
            disabled={disabled}
            invalid={errors.thamChieu}
          />
          {value.nguoi?.loai === "NHAN_SU" && (
            <p className="text-xs text-muted-foreground" data-testid="nhom-suy-ra">
              Vai của người được chọn: <b className="font-semibold text-foreground">{NHAN_VAI[value.nguoi.vai]}</b> — chỉ lưu kèm để tra cứu, nguồn vẫn là nguồn bạn vừa chọn.
            </p>
          )}
        </div>
      )}
      {/* Lỗi `thamChieu` của nhóm KHÔNG cần người (người lạc loại): không có ô nào để gắn lỗi ⇒ nói ngay dưới danh sách nguồn. */}
      {!loaiNguoi && errors.thamChieu && (
        <p role="alert" className="text-xs text-state-danger-ink">
          {errors.thamChieu}
        </p>
      )}

      {nhomGhi?.requiresNote && (
        <div>
          <label htmlFor={idGt} className="mb-1 flex items-baseline justify-between gap-2 text-sm font-medium text-foreground">
            <span>Giải trình nguồn</span>
            <span
              className={cn(
                "text-xs font-normal tabular-nums",
                soKyTu >= DO_DAI_GIAI_TRINH_TOI_THIEU ? "text-state-success-ink" : "text-muted-foreground",
              )}
            >
              {soKyTu}/{DO_DAI_GIAI_TRINH_TOI_THIEU} ký tự tối thiểu
            </span>
          </label>
          <textarea
            id={idGt}
            value={value.giaiTrinh}
            onChange={(e) => onChange({ ...value, giaiTrinh: e.target.value })}
            disabled={disabled}
            aria-invalid={errors.giaiTrinh ? true : undefined}
            aria-describedby={errors.giaiTrinh ? idGtLoi : undefined}
            placeholder="Khách biết đến Sata Robo từ đâu? Ghi rõ để kế toán và quản lý kiểm lại được."
            className={TEXTAREA}
          />
          {errors.giaiTrinh && (
            <p id={idGtLoi} role="alert" className="mt-1 text-xs text-state-danger-ink">
              {errors.giaiTrinh}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
