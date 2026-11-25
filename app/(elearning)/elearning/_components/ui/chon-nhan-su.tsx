"use client";

import { useId } from "react";
import { Combobox } from "@/components/ui/combobox";
import { TRAN_NHAN_SU_CHON } from "@/lib/elearning/nhan-su-chon";
import { GOI_Y_O, NHAN_O } from "./dieu-khien";

/**
 * Ô CHỌN NHÂN SỰ có tìm kiếm (bỏ dấu, không phân biệt hoa/thường) — thay ô nhập `userId` thô.
 *
 * Dùng `Combobox` có sẵn của repo (Base UI) — không thêm thư viện. Danh sách do máy chủ nạp qua `scopedDb`
 * (`lib/elearning/nhan-su-chon.ts`) nên đã giới hạn theo quyền + cơ sở; ô này chỉ VẼ.
 * Nhãn gắn bằng `htmlFor` để trình đọc màn hình đọc đúng tên ô.
 */
export function ChonNhanSu({
  nhan,
  nhanSu,
  value,
  onChange,
  goiY,
  daCat,
  bamBuoc = false,
}: {
  nhan: string;
  nhanSu: { userId: string; nhan: string }[];
  value: string;
  onChange: (userId: string) => void;
  goiY?: string;
  /** Danh sách bị cắt ở trần ⇒ nói ra để người dùng biết còn người không hiện. */
  daCat?: boolean;
  /** Dấu * bắt buộc. */
  bamBuoc?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={NHAN_O}>
        {nhan}
        {bamBuoc ? <span className="text-state-danger-ink"> *</span> : null}
      </label>
      <div className="mt-1">
        <Combobox
          id={id}
          options={nhanSu.map((n) => ({ value: n.userId, label: n.nhan }))}
          value={value || null}
          onValueChange={(v) => onChange(v ?? "")}
          placeholder="Gõ tên hoặc mã nhân viên để tìm…"
          emptyText={nhanSu.length === 0 ? "Chưa có nhân sự nào có tài khoản trong phạm vi của bạn" : "Không có ai khớp"}
          className="h-10 text-sm"
        />
      </div>
      {goiY ? <p className={GOI_Y_O}>{goiY}</p> : null}
      {daCat ? (
        <p className={GOI_Y_O}>
          Danh sách chỉ có {TRAN_NHAN_SU_CHON} người đầu theo tên; người ngoài danh sách chưa chọn được — báo bộ phận kỹ thuật nếu cần.
        </p>
      ) : null}
    </div>
  );
}
