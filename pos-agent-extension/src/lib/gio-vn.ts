/**
 * Giờ Việt Nam (UTC+7, không có giờ mùa hè). Mọi hàm nhận MỐC (ms) tường minh — không đọc đồng
 * hồ (luật 19: test chốt được mọi mốc).
 */

const LECH_VN_MS = 7 * 60 * 60_000;
const NGAY_MS = 24 * 60 * 60_000;

function hai(n: number): string {
  return String(n).padStart(2, "0");
}

function phanVN(ms: number) {
  const d = new Date(Math.floor(ms / 1000) * 1000 + LECH_VN_MS);
  return {
    y: String(d.getUTCFullYear()).padStart(4, "0"),
    mo: hai(d.getUTCMonth() + 1),
    d: hai(d.getUTCDate()),
    h: hai(d.getUTCHours()),
    mi: hai(d.getUTCMinutes()),
    s: hai(d.getUTCSeconds()),
  };
}

/** "YYYY-MM-DD HH:mm:ss" giờ VN — đúng định dạng thân search của portal (roadmap §2.3). */
export function dinhDangGioVN(ms: number): string {
  const p = phanVN(ms);
  return `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}:${p.s}`;
}

/** ISO-8601 kèm "+07:00", không phần nghìn giây (hợp đồng §4: mọi mốc phải có offset). */
export function isoVN(ms: number): string {
  const p = phanVN(ms);
  return `${p.y}-${p.mo}-${p.d}T${p.h}:${p.mi}:${p.s}+07:00`;
}

/** "YYYYMMDD-HHmmss" giờ VN — dùng trong syncId. */
export function maThoiGianVN(ms: number): string {
  const p = phanVN(ms);
  return `${p.y}${p.mo}${p.d}-${p.h}${p.mi}${p.s}`;
}

/** "dd/MM/yyyy HH:mm" giờ VN — để người đọc trên trang Options. */
export function hienThiGioVN(ms: number): string {
  const p = phanVN(ms);
  return `${p.d}/${p.mo}/${p.y} ${p.h}:${p.mi}`;
}

/** Mốc 00:00 giờ VN của ngày VN chứa `ms`. */
export function batDauNgayVN(ms: number): number {
  return Math.floor((ms + LECH_VN_MS) / NGAY_MS) * NGAY_MS - LECH_VN_MS;
}

const ISO_CO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Đọc ISO-8601 CÓ offset; chuỗi khác (kể cả ISO không offset — mơ hồ múi giờ) ⇒ null. */
export function docIso(s: unknown): number | null {
  if (typeof s !== "string" || !ISO_CO_OFFSET.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}
