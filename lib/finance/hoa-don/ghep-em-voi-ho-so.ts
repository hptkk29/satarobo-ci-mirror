// lib/finance/hoa-don/ghep-em-voi-ho-so.ts — GHÉP một em trên form QR với hồ sơ học viên của gia đình. THUẦN (tách khỏi `dong-bo-hoc-vien-qr.ts` vốn chạm DB nên test được không cần Postgres).

/** Tên để ghép: NFC, thường hoá theo tiếng Việt, gộp khoảng trắng. */
export const khoaTen = (s: string): string => s.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
/** Tên không dấu (đ → d) — chỉ dùng khi tên có dấu không khớp mà phụ huynh gõ không dấu. */
export const khoaTenKhongDau = (s: string): string => khoaTen(s).normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d");

/** Chọn hồ sơ cho một em: khớp đúng tên trước; không có thì khớp không dấu NHƯNG phải là DUY NHẤT. `moHo` = nhiều hồ sơ cùng khớp (không đoán). */
export function ghepEmVoiHoSo<T extends { name: string }>(ten: string, hoSo: readonly T[]): { hoSo: T } | { hoSo: null; moHo: boolean } {
  const dung = hoSo.filter((h) => khoaTen(h.name) === khoaTen(ten));
  if (dung.length === 1) return { hoSo: dung[0]! };
  if (dung.length > 1) return { hoSo: null, moHo: true };
  const kd = hoSo.filter((h) => khoaTenKhongDau(h.name) === khoaTenKhongDau(ten));
  if (kd.length === 1) return { hoSo: kd[0]! };
  return { hoSo: null, moHo: kd.length > 1 };
}

