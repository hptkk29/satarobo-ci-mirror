// Pháp nhân "đang thao tác" của từng cơ sở cho THANH PHẠM VI (S5b). THUẦN, chỉ layout (server) gọi — tách khỏi
// `pham-vi-hoa-don.ts` (phần client: gợi ý cơ sở) để bundle trình duyệt không kéo theo `cau-hinh-co-so.ts` + `ky-hieu`
// (client chỉ `import type` từ đây ⇒ bị xoá lúc biên dịch). Luật: pháp nhân suy bằng CHÍNH `phapNhanPhatHanhChoCoSo` mà đường
// phát hành MISA dùng, nên thanh phạm vi không bao giờ nói một pháp nhân khác với thứ sẽ in lên tờ hoá đơn. Thiếu / mơ hồ ⇒
// nói THIẾU kèm lý do của luật (không rơi về pháp nhân mặc định, không đoán).

import type { CauHinhCoSo } from "@/lib/finance/hoa-don/cau-hinh-co-so";
import { phapNhanPhatHanhChoCoSo } from "@/lib/finance/hoa-don/cau-hinh-co-so";
import type { PhapNhan } from "@/lib/finance/hoa-don/phap-nhan";

export type PhapNhanHienThi =
  | { loai: "CO"; ten: string; maSoThue: string; kyHieu: string }
  | { loai: "THIEU"; lyDo: string };

const LECH_VN_MS = 7 * 3600_000;

/** Ngày lịch Việt Nam ("yyyy-mm-dd") của một mốc giờ — `now` do người gọi truyền (không đọc đồng hồ máy). */
export function ngayVN(now: Date): string {
  return new Date(now.getTime() + LECH_VN_MS).toISOString().slice(0, 10);
}

/** Pháp nhân phát hành HÔM NAY của từng cơ sở. Mỗi cơ sở trong `cacCoSo` có đúng một mục. */
export function tomTatPhapNhanTheoCoSo(input: {
  cacCoSo: readonly { id: string }[];
  cauHinh: readonly CauHinhCoSo[];
  /** yyyy-mm-dd lịch VN — xem `ngayVN`. */
  ngay: string;
  danhSachPhapNhan: readonly PhapNhan[];
}): Record<string, PhapNhanHienThi> {
  const kq: Record<string, PhapNhanHienThi> = {};
  for (const c of input.cacCoSo) {
    const r = phapNhanPhatHanhChoCoSo({
      cauHinh: input.cauHinh,
      centerId: c.id,
      ngay: input.ngay,
      danhSachPhapNhan: input.danhSachPhapNhan,
    });
    kq[c.id] = r.ok
      ? { loai: "CO", ten: r.phapNhan.ten, maSoThue: r.phapNhan.maSoThue, kyHieu: r.kyHieu }
      : { loai: "THIEU", lyDo: r.error };
  }
  return kq;
}
