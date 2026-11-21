/**
 * BĂM NGÂN HÀNG MỞ RỘNG — cùng lý do với `engine-goc/modules/core/bo-de/bam.ts`: sửa một
 * câu là đổi ý nghĩa của điểm, nên "sửa nguyên liệu thì tăng `PHIEN_BAN_KHUNG`" phải là thứ
 * MÁY bắt được, không phải kỷ luật của người.
 *
 * Nhận hàm băm từ ngoài để tầng lõi không phụ thuộc `node:crypto`.
 */

import type { CauNganHang } from "./sinh";

export function chuoiChuanTacNganHang(ds: readonly CauNganHang[]): string {
  return [...ds]
    .sort((a, b) => (a.ma < b.ma ? -1 : a.ma > b.ma ? 1 : 0))
    .map((c) => `${c.ma}|${c.boDe}|${c.oKhung}|${c.truc}|${c.dao ? "dao" : "thuan"}|${c.noiDung}`)
    .join("\n")
    .normalize("NFC");
}

export function bamNganHangMoRong(ds: readonly CauNganHang[], bam: (s: string) => string): string {
  return bam(chuoiChuanTacNganHang(ds));
}
