// lib/finance/thong-diep-go-gan.ts — câu báo sau một lượt GỠ GẮN. THUẦN.
//
// ⚠️ Rà vòng 3 (30/09/2026, luật 12 — affordance phải nói thật): `goGanGiaoDichAction` in cứng
// "Giao dịch về hàng chờ." trong khi `goGanTheoCon` có thể đưa giao dịch THẺ đã hủy/hoàn sang
// IGNORED (Bỏ qua) và mở lại / đóng phiếu gộp. Kế toán đi tìm trong hàng chờ và không thấy. Câu
// nay dựng từ ĐÚNG kết quả trả về (`trangThaiGiaoDich`, `phieuGop`), không đoán. Ca `[TDG-*]`.
//
// Đặt ở tệp thuần (không trong `_gan-theo-con.ts`): tệp "use server" chỉ được export hàm async.

import { LY_DO_THE_HOAN_MOT_PHAN, LY_DO_THE_LUON_DONG } from "./phieu-gop-go-gan";

export type KetQuaGoGanDeBao = {
  tienDao: number;
  soDongDao: number;
  trangThaiGiaoDich: "UNMATCHED" | "IGNORED";
  /**
   * `lyDo` BẮT BUỘC (rà vòng 6, luật 7): câu ĐÓNG tuỳ LÝ DO — chỉ phiếu thẻ đóng (Q-M / hoàn một phần) mới
   * mời "phát mã mới"; đóng vì trạng thái (phiếu mở khác, đơn không nhận tiền, đợt huỷ) thì `taoPhieuGop`
   * chắc chắn từ chối, nên câu đó là lời hứa suông (luật 12).
   */
  phieuGop: readonly { ma: string | null; hanhDong: "MO_LAI" | "DONG" | "GIU"; conPhaiThu: number; lyDo: string }[];
};

/** Lý do ĐÓNG mà phát mã mới là việc làm tiếp HỢP LỆ — hai lý do của nguồn thẻ. */
const DONG_MOI_PHAT_MA = new Set<string>([LY_DO_THE_LUON_DONG, LY_DO_THE_HOAN_MOT_PHAN]);

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;

export function thongDiepGoGan(kq: KetQuaGoGanDeBao): string {
  const cau = [`Đã gỡ ${vnd(kq.tienDao)} (${kq.soDongDao} bút toán đảo).`];
  cau.push(
    kq.trangThaiGiaoDich === "IGNORED"
      ? "Giao dịch thẻ đã bị hủy/hoàn — chuyển sang Bỏ qua, KHÔNG về hàng chờ."
      : "Giao dịch về hàng chờ.",
  );
  for (const p of kq.phieuGop) {
    const ma = p.ma ?? "(không mã)";
    if (p.hanhDong === "MO_LAI") cau.push(`Phiếu gộp ${ma} mở lại — mã cũ thu lại ${vnd(p.conPhaiThu)}.`);
    else if (p.hanhDong === "DONG") {
      // Q-M (30/09/2026): gỡ gắn giao dịch THẺ luôn đóng phiếu — câu nói ĐÚNG việc phải làm tiếp. Rà vòng 6:
      // CHỈ cho hai lý do thẻ; phiếu 0đ khép để nhường chỗ không còn gì để thu; đóng vì trạng thái giữ câu cũ.
      if (DONG_MOI_PHAT_MA.has(p.lyDo)) cau.push(`Phiếu gộp: mã ${ma} đã ĐÓNG — phát mã mới nếu cần thu lại.`);
      else if (!(p.conPhaiThu > 0)) cau.push(`Phiếu gộp ${ma} đã khép (không còn phải thu).`);
      else cau.push(`Phiếu gộp ${ma} đã đóng — mã cũ không tự khớp nữa.`);
    }
  }
  return cau.join(" ");
}
