"use client";

// Giữ form hồ sơ khi người dùng ĐANG SỬA dở (25/09/2026).
//
// Form hồ sơ dựng lại theo "dấu vân tay" giá trị (`khoa`): sau "Gắn lead" hay nút vòng đời,
// server đổi giá trị và trang nạp lại — không dựng lại thì ô vẫn hiện giá trị cũ. Nhưng DỰNG
// LẠI thì mất sạch chữ đang gõ dở mà không một lời báo (lượt rà đối kháng 25/09).
//
// Luật ở đây:
//   · chưa chạm vào form ⇒ nhận bản mới NGAY (dựng lại) — như trước;
//   · đang sửa dở ⇒ GIỮ form, hiện dải báo có bản mới + nút "Bỏ thay đổi & nạp lại".
// Lưu trong lúc giữ vẫn an toàn: form ở chế độ sửa chỉ gửi ô ĐÃ ĐỔI (`gui-o-da-doi.ts`), nên
// các ô không chạm không ghi ngược giá trị cũ lên bản mới.
//
// "Đang sửa" đo bằng sự kiện nhập/đổi nổi bọt lên khung này — không cần form tự báo.
// Chọn tỉnh/phường (combobox) cũng đi qua bàn phím/chuột nên tính cả keydown/pointerdown
// TRONG vùng form: thà coi là đang sửa (hiện dải báo) còn hơn dựng lại làm mất chữ.

import { useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { NUT_VIEN } from "./o-nhap";

export function GiuFormKhiDangSua({ khoa, children }: { khoa: string; children: ReactNode }) {
  const [khoaDangDung, setKhoaDangDung] = useState(khoa);
  const [dangSua, setDangSua] = useState(false);

  const coBanMoi = khoa !== khoaDangDung;
  // Chưa chạm ⇒ nhận bản mới ngay trong lượt vẽ này (mẫu "trạng thái suy ra từ prop").
  if (coBanMoi && !dangSua) setKhoaDangDung(khoa);

  const danhDauDangSua = () => {
    if (!dangSua) setDangSua(true);
  };

  return (
    <div className="space-y-3">
      {coBanMoi && dangSua && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-state-info-soft bg-state-info-soft px-4 py-3 text-sm text-state-info-ink"
        >
          <p className="min-w-0 flex-1">
            Hồ sơ vừa được cập nhật ở chỗ khác (gắn lead / đổi trạng thái). Các ô bạn đang sửa vẫn
            giữ nguyên — bấm “Lưu thay đổi” chỉ lưu những ô bạn đã sửa.
          </p>
          <button
            type="button"
            onClick={() => {
              setDangSua(false);
              setKhoaDangDung(khoa);
            }}
            className={cn(NUT_VIEN, "shrink-0")}
          >
            <RefreshCw className="size-4" aria-hidden />
            Bỏ thay đổi &amp; nạp lại
          </button>
        </div>
      )}
      <div
        key={khoaDangDung}
        onInput={danhDauDangSua}
        onChange={danhDauDangSua}
        onKeyDown={danhDauDangSua}
        onPointerDown={danhDauDangSua}
      >
        {children}
      </div>
    </div>
  );
}
