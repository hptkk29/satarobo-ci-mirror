import { vnEndOfDay, vnParts } from "@/lib/time/vn";

/**
 * E-LEARNING ONLINE — THỜI HẠN QUYỀN HỌC THEO THÁNG LỊCH (V7 §13).
 *
 * Hàm THUẦN, mọi tính toán theo GIỜ VIỆT NAM (`lib/time/vn.ts`), KHÔNG nhân 30 ngày.
 *
 * Quy ước đã chốt (ADR 0005 · D-29):
 * 1. **Hạn là hết NGÀY lịch VN** (`vnEndOfDay`) của ngày đích — mua 19/11/2026 + 12 tháng ⇒ dùng được tới hết 19/11/2027.
 * 2. **Cộng tháng kẹp cuối tháng:** 31/01 + 1 tháng = 28/02 (29/02 năm nhuận), KHÔNG tràn sang tháng sau.
 * 3. **Neo ngày (`anchorDay`) chống trôi:** gia hạn liên tiếp tính từ NGÀY NEO của lần cấp đầu, không từ ngày đã bị kẹp — 31/01 +1 → 28/02, +1 nữa → 31/03
 *    (không phải 28/03). Bản ghi quyền lưu `anchorDay`; thiếu thì lấy ngày của mốc gốc.
 * 4. **Gia hạn cộng từ hạn HIỆN TẠI** nếu quyền còn hạn; đã hết hạn/thu hồi rồi mua lại ⇒ tính từ MỐC MUA (không cộng bù khoảng thời gian đã hết).
 * 5. **Trọn đời = `null`** (không có ngày hết hạn), và `null` + bất kỳ gia hạn nào vẫn `null`.
 */

export const TOI_DA_THANG = 120;

const ngayTrongThang = (nam: number, thang1: number) => new Date(Date.UTC(nam, thang1, 0)).getUTCDate();

/** Cộng `soThang` tháng lịch vào NGÀY VN của `mocGoc`, kẹp cuối tháng theo `anchorDay`; trả về hết ngày VN của ngày đích. */
export function congThangLich(mocGoc: Date, soThang: number, anchorDay?: number): Date {
  if (!Number.isInteger(soThang) || soThang < 1 || soThang > TOI_DA_THANG) {
    throw new RangeError(`số tháng phải là số nguyên 1..${TOI_DA_THANG} (nhận ${soThang})`);
  }
  const p = vnParts(mocGoc);
  const ngayNeo = anchorDay ?? p.day;
  if (!Number.isInteger(ngayNeo) || ngayNeo < 1 || ngayNeo > 31) throw new RangeError(`anchorDay không hợp lệ: ${anchorDay}`);
  const chiSo = p.year * 12 + p.month + soThang; // p.month: 0-11
  const nam = Math.floor(chiSo / 12);
  const thang1 = (chiSo % 12) + 1; // 1..12
  const ngay = Math.min(ngayNeo, ngayTrongThang(nam, thang1));
  // Giữa ngày VN (12:00 +07 = 05:00Z) rồi lấy hết ngày — tránh lệch ngày do múi giờ.
  return vnEndOfDay(new Date(Date.UTC(nam, thang1 - 1, ngay, 5, 0, 0)));
}

export type KyHan = { loai: "TRON_DOI" } | { loai: "THANG"; soThang: number };

export function laKyHanHopLe(k: unknown): k is KyHan {
  if (!k || typeof k !== "object") return false;
  const o = k as { loai?: unknown; soThang?: unknown };
  if (o.loai === "TRON_DOI") return true;
  return o.loai === "THANG" && Number.isInteger(o.soThang) && (o.soThang as number) >= 1 && (o.soThang as number) <= TOI_DA_THANG;
}

/**
 * Hạn mới khi cấp/mua/gia hạn.
 * - `hanHienTai`: hạn của quyền đang có (`null` = trọn đời; `undefined` = chưa có quyền).
 * - quyền còn hạn (`hanHienTai > now`) ⇒ cộng từ `hanHienTai`; ngược lại cộng từ `now`.
 */
export function tinhHanMoi(input: { ky: KyHan; now: Date; hanHienTai?: Date | null; anchorDay?: number }): { hetHan: Date | null; anchorDay: number } {
  const anchorDay = input.anchorDay ?? vnParts(input.now).day;
  if (input.ky.loai === "TRON_DOI") return { hetHan: null, anchorDay };
  if (input.hanHienTai === null) return { hetHan: null, anchorDay }; // đang trọn đời: gia hạn là vô nghĩa, giữ nguyên
  const conHan = input.hanHienTai !== undefined && input.hanHienTai.getTime() > input.now.getTime();
  const goc = conHan ? (input.hanHienTai as Date) : input.now;
  // Khi cộng từ hạn hiện tại (hết ngày VN), ngày của nó chính là ngày đích lần trước: neo giữ cho khỏi trôi.
  return { hetHan: congThangLich(goc, input.ky.soThang, input.anchorDay ?? anchorDay), anchorDay };
}
