// lib/students/quan-he.ts — "Quan hệ với học sinh" là Ô CHỌN, không còn ô gõ tự do (26/09/2026).
//
// Chủ dự án 26/09: "Quan hệ với học sinh thì dropdown ra các quan hệ với học viên luôn". Trước
// đó là ô chữ có gợi ý (`<datalist>`), nên dữ liệu có đủ kiểu "me", "Mẹ ", "mẹ bé", "Ba"…
// THUẦN — client component dùng được.

export const QUAN_HE = [
  "Mẹ",
  "Bố",
  "Ông",
  "Bà",
  "Anh",
  "Chị",
  "Cô",
  "Dì",
  "Chú",
  "Bác",
  "Người giám hộ",
  "Khác",
] as const;

export type QuanHe = (typeof QUAN_HE)[number];

function boDau(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Giá trị đang lưu → một mục của danh sách, hoặc null khi không nhận ra CHẮC CHẮN.
 *   1. Khớp đúng chữ (không phân biệt hoa thường, bỏ khoảng trắng thừa, dạng Unicode tổ hợp).
 *   2. Khớp bỏ dấu — NHƯNG chỉ khi không có mục nào khác cùng dạng bỏ dấu: "ba" vừa là "Bà"
 *      (bà nội/ngoại) vừa là "Ba" (bố, tiếng miền Nam) nên KHÔNG đoán.
 * null ⇒ ô chọn giữ nguyên giá trị cũ thành một mục riêng, để lượt lưu không đổi nó lặng lẽ.
 */
export function quanHeTuChuoi(raw: string | null | undefined): QuanHe | null {
  const s = (raw ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const thuong = s.toLowerCase();
  const dung = QUAN_HE.find((q) => q.toLowerCase() === thuong);
  if (dung) return dung;
  const k = boDau(s);
  if (MO_HO_KHI_BO_DAU.has(k)) return null;
  const khop = QUAN_HE.filter((q) => boDau(q) === k);
  return khop.length === 1 ? khop[0]! : null;
}

/**
 * Dạng bỏ dấu mà người dùng gõ có thể là HAI quan hệ khác nhau dù danh sách chỉ có một mục
 * khớp: "Ba" (bố — tiếng miền Nam, KHÔNG có trong danh sách) ≠ "Bà".
 */
const MO_HO_KHI_BO_DAU: ReadonlySet<string> = new Set(["ba"]);
