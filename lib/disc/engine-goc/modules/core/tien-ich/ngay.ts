// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/core/tien-ich/ngay.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * NGÀY THÁNG — lưu ISO 8601, HIỂN THỊ dd/mm/yyyy.
 *
 * 🔴 Cạm bẫy đã trả giá: `new Date("01/08/2026")` trả về **8 tháng 1** theo lối Mỹ, và
 * KHÔNG báo lỗi gì. Một cái sai im lặng như thế trong phần "hai bài cách nhau bao nhiêu
 * ngày" sẽ làm vùng lệch ghép sai cặp mà vẫn ra một con số đầy thuyết phục.
 * ⇒ Mọi chuỗi ngày phải qua `laChuoiIso()` trước khi đưa cho `new Date()`.
 *
 * Hàm thuần, thuộc TẦNG LÕI: không React, không DOM.
 */

/** Chuỗi có bắt đầu bằng yyyy-mm-dd không. Không kiểm thì đừng dựng Date. */
export function laChuoiIso(chuoi: unknown): chuoi is string {
  return typeof chuoi === "string" && /^\d{4}-\d{2}-\d{2}/u.test(chuoi);
}

/** Dựng Date từ chuỗi ISO. Chuỗi không phải ISO ⇒ `null`, KHÔNG đoán bừa. */
export function ngayTuIso(chuoi: unknown): Date | null {
  if (!laChuoiIso(chuoi)) return null;
  const d = new Date(chuoi);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Hiển thị dd/mm/yyyy. Chuỗi hỏng ⇒ trả về `khiHong` thay vì "Invalid Date". */
export function hienNgay(chuoi: unknown, khiHong = "—"): string {
  const d = ngayTuIso(chuoi);
  if (!d) return khiHong;
  const hai = (n: number) => String(n).padStart(2, "0");
  return `${hai(d.getDate())}/${hai(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Hiển thị dd/mm/yyyy HH:mm. */
export function hienNgayGio(chuoi: unknown, khiHong = "—"): string {
  const d = ngayTuIso(chuoi);
  if (!d) return khiHong;
  const hai = (n: number) => String(n).padStart(2, "0");
  return `${hienNgay(chuoi)} ${hai(d.getHours())}:${hai(d.getMinutes())}`;
}

/**
 * Số ngày giữa hai mốc, làm tròn xuống, luôn không âm.
 * Một trong hai chuỗi hỏng ⇒ `null` — nơi gọi phải tự quyết, không nhận bừa số 0.
 */
export function soNgayGiua(a: unknown, b: unknown): number | null {
  const da = ngayTuIso(a);
  const db = ngayTuIso(b);
  if (!da || !db) return null;
  return Math.floor(Math.abs(db.getTime() - da.getTime()) / 86_400_000);
}
