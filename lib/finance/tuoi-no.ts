// lib/finance/tuoi-no.ts — NHÓM TUOI NỢ của các đợt thu (sổ cũ `OrderInstallment`), TRỪ thời gian bảo lưu. THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// A6 (vòng 2) → K19 (vòng 3, 12/10/2026)
//
// Vòng 2: tuổi nợ ĐÓNG BĂNG tại ngày bắt đầu bảo lưu (không đẩy về "chưa quá hạn"). Vòng 3 chốt thêm: SAU PHỤC HỌC phải đếm tiếp từ chỗ đã dừng — bản vòng 2 chỉ đúng
// trong lúc đang bảo lưu, còn khi phục học đợt sổ cũ nhảy thêm đúng số ngày đã nghỉ (hạn sổ cũ không dời, chỉ `PaymentRequest` được dời). Nay MỘT công thức cho cả ba
// giai đoạn (đang bảo lưu · sau phục học · đợt tới hạn giữa kỳ), ở `lib/bao-luu/qua-han-tru-bao-luu.ts`:
//
//     số ngày quá hạn = (hôm nay − hạn đợt) − số ngày nằm trong các khoảng bảo lưu đã có hiệu lực
//
// Quy chế SR.QD.236 Phụ lục 01 Mục 15: *"chỉ được tạm dừng tính quá hạn trong thời gian bảo lưu; khi phục học nghĩa vụ thanh toán tiếp tục."*
// Chỉ ĐỔI NHÓM HIỂN THỊ; tổng mọi nhóm không đổi. Danh sách ĐÒI NỢ (cron nhắc nợ) vẫn loại bé đang bảo lưu qua `locDonDangBaoLuu` — đừng nối hàm này vào đó.
// Một nơi duy nhất: màn `/cong-no` VÀ tệp xuất công nợ cùng gọi `gomTuoiNo`.
import {
  nhomTheoSoNgay,
  tinhSoNgayQuaHanTruBaoLuu,
  type KhoangTamDung,
  type NhomTuoiNo,
} from "@/lib/bao-luu/qua-han-tru-bao-luu";

export type { NhomTuoiNo };

export const NHOM_TUOI_NO: readonly NhomTuoiNo[] = ["none", "1-7", "8-30", ">30"];

export type DonCoDot = {
  id: string;
  installments: readonly { amount: number; dueDate: Date | null }[];
};

export type KetQuaTuoiNo = {
  /** Tổng tiền theo nhóm — gồm CẢ đợt của đơn đang bảo lưu. */
  tong: Record<NhomTuoiNo, number>;
  /** Trong `tong`, phần thuộc đơn ĐANG BẢO LƯU (tại `now`) — để gắn nhãn, không để trừ đi. */
  dangBaoLuu: Record<NhomTuoiNo, number>;
};

/** Nhóm tuổi nợ của MỘT đợt. `khoang` = khoảng bảo lưu của đơn (rỗng/undefined = chưa từng bảo lưu ⇒ tính thẳng theo `now`). */
export function nhomTuoiNo(dueDate: Date | null, now: Date, khoang?: readonly KhoangTamDung[]): NhomTuoiNo {
  if (!dueDate) return "none";
  return nhomTheoSoNgay(tinhSoNgayQuaHanTruBaoLuu(dueDate, now, khoang ?? []));
}

const rong = (): Record<NhomTuoiNo, number> => ({ none: 0, "1-7": 0, "8-30": 0, ">30": 0 });

/**
 * Gom tiền các đợt theo nhóm tuổi nợ. `khoangTheoDon`: `Order.id` → khoảng bảo lưu (`docKhoangTheoDon`); `dangBaoLuu`: các đơn mà MỌI bé đang bảo lưu tại `now`
 * (`locDonDangBaoLuu`) — chỉ để gắn nhãn.
 */
export function gomTuoiNo(
  don: readonly DonCoDot[],
  khoangTheoDon: ReadonlyMap<string, readonly KhoangTamDung[]>,
  dangBaoLuu: ReadonlySet<string>,
  now: Date,
): KetQuaTuoiNo {
  const tong = rong();
  const nhan = rong();
  for (const o of don) {
    const khoang = khoangTheoDon.get(o.id);
    const dang = dangBaoLuu.has(o.id);
    for (const dot of o.installments) {
      const nhom = nhomTuoiNo(dot.dueDate, now, khoang);
      tong[nhom] += dot.amount;
      if (dang) nhan[nhom] += dot.amount;
    }
  }
  return { tong, dangBaoLuu: nhan };
}
