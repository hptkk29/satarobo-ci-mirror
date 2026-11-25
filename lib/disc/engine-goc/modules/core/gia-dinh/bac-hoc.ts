// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/core/gia-dinh/bac-hoc.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * BẬC CỦA MỘT ĐỨA TRẺ ĐỂ CHỌN LỜI KHUYÊN THEO TUỔI (29.0) — hàm thuần.
 *
 * Ba bậc, không phải mười hai lớp: lời khuyên "việc nhỏ mỗi ngày" khác hẳn giữa bé mầm non,
 * bé tiểu học và bé từ THCS, nhưng lớp 7 và lớp 8 thì không khác nhau đủ để viết hai bộ chữ.
 *
 *  · `nho`      — mầm non và lớp 1–2 (cùng ranh với bộ MN: bố mẹ trả lời hộ)
 *  · `tieu-hoc` — lớp 3–5
 *  · `lon`      — lớp 6 trở lên (kể cả cấp ba và "đã qua lớp 12")
 *
 * 🔴 KHÔNG ĐOÁN. Chưa có lớp, hoặc lớp không đọc được ⇒ `undefined`, và nơi gọi phải nhắc
 * người dùng thêm lớp. Đoán sai bậc là đưa một việc dành cho bé lớp 10 vào tay bé mầm non.
 *
 * Core không import được module `test` (semgrep canh), nên ranh giới "lớp 2 / lớp 3" lặp lại
 * ở đây bằng `LOP_CUOI_TIEU_HOC` và hằng số bên dưới; `tests/bac-hoc.test.ts` canh nó luôn
 * khớp `boDeQuanSatTheoLop`.
 */

import { LOP_MAM_NON, LOP_TREN_12, soLopCua } from "@/lib/disc/engine-goc/config/disc-nguong";

export type BacTre = "nho" | "tieu-hoc" | "lon";

/** Lớp cuối cùng còn dùng bản bố mẹ trả lời hộ — khớp `LOP_CAO_NHAT_DUNG_BAN_QUAN_SAT`. */
const LOP_CUOI_BAC_NHO = 2;
/** Lớp cuối cấp tiểu học — khớp `LOP_CUOI_TIEU_HOC`. */
const LOP_CUOI_BAC_TIEU_HOC = 5;

export function bacCuaTre(lop: string | undefined): BacTre | undefined {
  if (lop === LOP_MAM_NON) return "nho";
  if (lop === LOP_TREN_12) return "lon";
  const so = soLopCua(lop);
  if (so === undefined) return undefined;
  if (so <= LOP_CUOI_BAC_NHO) return "nho";
  return so <= LOP_CUOI_BAC_TIEU_HOC ? "tieu-hoc" : "lon";
}
