// lib/cham-cong/tang-ca.ts — phút OT của một ngày từ KHUNG ĐÃ DUYỆT × GIỜ LÀM THẬT (đợt 4 đơn từ,
// chủ dự án chốt QĐ-2: trả = min(giờ duyệt, giờ thực tế)). THUẦN.
//
//   · khung duyệt  — trừ phần trùng giờ ca: OT là NGOÀI ca, phút trong ca đã là công thường.
//   · làm thật     — cặp vào–ra ĐÃ ĐÓNG ∩ khung duyệt, cũng trừ phần trùng giờ ca (không đếm hai lần).
//   · được trả     — min(duyệt, thật), làm tròn XUỐNG bội `lamTronPhut` (0 = không làm tròn).
//
// "Thật" luôn ≤ "duyệt" vì nó là phần giao với khung duyệt — giờ ngoài khung KHÔNG tính (BA 4.5).
// Không có lượt quét ⇒ 0, dù đơn đã duyệt: duyệt là cho phép, không phải đã làm.
import { giao, tong, tru, type Khoang } from "./khoang-gio";

export type KetQuaTangCa = { otApprovedMinutes: number; otActualMinutes: number; otPayableMinutes: number };

export const KHONG_TANG_CA: KetQuaTangCa = { otApprovedMinutes: 0, otActualMinutes: 0, otPayableMinutes: 0 };

export function tinhTangCa(opts: {
  khungDuyet: readonly Khoang[];
  /** Cặp vào–ra đã đóng (đã gộp). */
  capDaDong: readonly Khoang[];
  /** Các đoạn của ca kế hoạch. */
  gioCa: readonly Khoang[];
  lamTronPhut: number;
}): KetQuaTangCa {
  const ngoaiCa = tru(opts.khungDuyet, opts.gioCa);
  const otApprovedMinutes = tong(ngoaiCa);
  const otActualMinutes = tong(giao(opts.capDaDong, ngoaiCa));
  const tho = Math.min(otApprovedMinutes, otActualMinutes);
  const otPayableMinutes = opts.lamTronPhut > 0 ? Math.floor(tho / opts.lamTronPhut) * opts.lamTronPhut : tho;
  return { otApprovedMinutes, otActualMinutes, otPayableMinutes };
}
