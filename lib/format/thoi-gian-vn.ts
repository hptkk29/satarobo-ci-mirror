// lib/format/thoi-gian-vn.ts — ngày/giờ lịch Việt Nam. THUẦN.
// "Thời gian theo ISO 8601 có +07:00, ngày dạng YYYY-MM-DD".
//
// 02/10/2026 — dời từ `lib/agents/gateway/thoi-gian.ts` khi gỡ Cổng dữ liệu agent: Chính sách
// khuyến mãi, tạo đơn và Tra cứu dùng chung các hàm này nên chúng phải sống ngoài cổng.
//
// Việt Nam không có giờ mùa hè, nên +07:00 là hằng số — không cần bảng múi giờ.

const LECH_MS = 7 * 60 * 60 * 1000;

function hai(n: number): string {
  return String(n).padStart(2, "0");
}

/** 2026-09-25T02:00:00Z → "2026-09-25T09:00:00+07:00". Bỏ phần mili giây. */
export function gioVN(d: Date): string {
  const v = new Date(d.getTime() + LECH_MS);
  return (
    `${v.getUTCFullYear()}-${hai(v.getUTCMonth() + 1)}-${hai(v.getUTCDate())}` +
    `T${hai(v.getUTCHours())}:${hai(v.getUTCMinutes())}:${hai(v.getUTCSeconds())}+07:00`
  );
}

/** Ngày lịch ở Việt Nam, "YYYY-MM-DD". 23:30Z ngày 24 là ngày 25 ở VN. */
export function ngayVN(d: Date): string {
  return gioVN(d).slice(0, 10);
}

/**
 * Cột `@db.Date` → "YYYY-MM-DD". Prisma trả cột Date ở NỬA ĐÊM UTC, nên đọc thẳng phần UTC —
 * KHÔNG cộng 7 giờ như `ngayVN` (cột Date không mang giờ; cộng thì vẫn ra đúng ngày, nhưng chỉ
 * là may, và sai ngay khi ai đó đổi `ngayVN` sang tính theo múi giờ khác).
 */
export function ngayCuaCotDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" có thật trên lịch (chặn 2026-02-30, 2026-13-01). */
export function laNgayHopLe(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 00:00 giờ VN của ngày "YYYY-MM-DD" — mốc DƯỚI (gồm) khi lọc cột Timestamptz theo ngày VN. */
export function dauNgayTuChuoi(s: string): Date {
  return new Date(`${s}T00:00:00+07:00`);
}

/** "YYYY-MM-DD" cộng `n` ngày lịch (n âm = lùi). Làm trên UTC nên không lệch vì múi giờ. */
export function congNgay(s: string, n: number): string {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Số ngày từ `tu` tới `den` (cùng ngày = 0; `den` trước `tu` ⇒ âm). */
export function soNgayGiua(tu: string, den: string): number {
  return Math.round((Date.parse(`${den}T00:00:00Z`) - Date.parse(`${tu}T00:00:00Z`)) / 86_400_000);
}
