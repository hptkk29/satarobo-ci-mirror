// lib/students/gioi-tinh.ts — nhãn giới tính dùng chung cho hồ sơ học viên (25/09/2026).
//
// Vì sao có file này: repo có BA bản chép tay bảng MALE/FEMALE/OTHER → Nam/Nữ/Khác
// (lead-form, student-form, employee-form) và một bảng CHUỖI TRẦN (`LeadChild.gender`
// lưu thẳng "Nam"/"Nữ"/"Khác"). Hồ sơ học viên phải đọc được CẢ HAI kiểu — enum của
// `Student.gender`/`Lead.parentGender` và chuỗi tự do của `LeadChild.gender` — nên phép
// dịch nằm ở một chỗ. THUẦN, không import Prisma client (client component dùng được).

export type GioiTinh = "MALE" | "FEMALE" | "OTHER";

export const NHAN_GIOI_TINH: Record<GioiTinh, string> = {
  MALE: "Nam",
  FEMALE: "Nữ",
  OTHER: "Khác",
};

export const GIOI_TINH_OPTIONS: readonly { value: GioiTinh; label: string }[] = [
  { value: "MALE", label: "Nam" },
  { value: "FEMALE", label: "Nữ" },
  { value: "OTHER", label: "Khác" },
];

/** Nhãn của một giá trị enum; `null`/lạ → `null` (chỗ hiển thị tự in "—"). */
export function nhanGioiTinh(v: string | null | undefined): string | null {
  if (!v) return null;
  // hasOwnProperty, KHÔNG `in`: `in` khớp cả khoá của prototype ("toString",
  // "constructor"…) và trả về một HÀM thay vì chuỗi — ca [GT-01] ghim. Không dùng
  // `Object.hasOwn` vì file này chạy cả ở client (Safari iOS < 15.4 chưa có).
  return Object.prototype.hasOwnProperty.call(NHAN_GIOI_TINH, v)
    ? NHAN_GIOI_TINH[v as GioiTinh]
    : null;
}

/**
 * Dịch chuỗi tự do (`LeadChild.gender`, ô Excel) sang enum. Chịu được chữ HOA/thường,
 * có/không dấu và dạng Unicode tổ hợp (NFD — gõ từ macOS/iOS hay ra dạng này, và
 * "Nữ" NFD KHÔNG bằng "Nữ" NFC khi so chuỗi). Không nhận ra ⇒ `null`, KHÔNG đoán.
 */
export function gioiTinhTuChuoi(raw: string | null | undefined): GioiTinh | null {
  if (!raw) return null;
  const t = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .trim()
    .toLowerCase();
  if (t === "nam" || t === "male" || t === "m") return "MALE";
  if (t === "nu" || t === "female" || t === "f") return "FEMALE";
  if (t === "khac" || t === "other") return "OTHER";
  return null;
}
