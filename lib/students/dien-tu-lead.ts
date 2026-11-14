// lib/students/dien-tu-lead.ts — ĐIỀN Ô TRỐNG của hồ sơ học viên từ lead nguồn (25/09/2026).
//
// Chủ dự án chốt "tách theo chủ dữ liệu": thông tin của CON và PHỤ HUYNH sửa trên hồ sơ
// học viên, thông tin PHỄU (nguồn, sale, AFF…) chỉ đọc từ lead. Nhưng lúc chốt lead,
// convert chỉ chép 8 ô sang Student — giới tính, trường, lớp, địa chỉ, link FB, ngày sinh
// PH… nằm lại ở Lead/LeadChild, và hồ sơ học viên mở ra TRỐNG dù dữ liệu đã có.
//
// Hàm này là MỘT luật điền dùng chung cho ba đường nối HV ↔ lead: convert (tự động),
// script nối học viên cũ, và nút "Gắn lead" trên màn học viên.
//
// LUẬT (đừng nới, cả ba đường dựa vào nó):
//   1. CHỈ điền ô đang TRỐNG trên Student. Không bao giờ ghi đè — hồ sơ học viên là bản
//      người dùng đã sửa, lead có thể cũ hơn.
//   2. KHÔNG điền tên/SĐT phụ huynh: hai ô bắt buộc (luôn có), và SĐT hai bảng khác
//      định dạng lưu — chép sang là sinh bản sao lệch.
//   3. Địa chỉ điền CẢ CỤM hoặc KHÔNG điền gì: chỉ khi Student chưa có ô địa chỉ nào
//      (kể cả `district` cũ). Điền lẻ từng ô là ghép tỉnh của nhà này với số nhà của nhà kia.
//   4. Chuỗi không dịch được (giới tính lạ, "Mầm non"/tuổi ở ô lớp) ⇒ bỏ qua, KHÔNG đoán.
//
// THUẦN — không đụng DB, test dựng tay được.

import { gioiTinhTuChuoi, type GioiTinh } from "./gioi-tinh";

/** Các ô của Student mà luật điền xét tới. */
export type StudentDeDien = {
  dateOfBirth: Date | null;
  gender: GioiTinh | null;
  school: string | null;
  currentGrade: number | null;
  parentEmail: string | null;
  parentGender: GioiTinh | null;
  parentDob: Date | null;
  parentFacebookUrl: string | null;
  city: string | null;
  ward: string | null;
  address: string | null;
  district: string | null;
};

export type LeadDeDien = {
  email: string | null;
  facebookUrl: string | null;
  parentGender: GioiTinh | null;
  parentDob: Date | null;
  city: string | null;
  ward: string | null;
  addressLine: string | null;
};

export type LeadChildDeDien = {
  dob: Date | null;
  gender: string | null;
  schoolName: string | null;
  gradeLevel: string | null;
};

export type PhanDien = Partial<{
  dateOfBirth: Date;
  gender: GioiTinh;
  school: string;
  currentGrade: number;
  parentEmail: string;
  parentGender: GioiTinh;
  parentDob: Date;
  parentFacebookUrl: string;
  city: string;
  ward: string;
  address: string;
}>;

function trong(v: string | null | undefined): boolean {
  return v == null || v.trim() === "";
}

function coChu(v: string | null | undefined): v is string {
  return v != null && v.trim() !== "";
}

/** Chuỗi nói về TUỔI hoặc MẦM NON — không phải lớp phổ thông (đã bỏ dấu, chữ thường). */
const NHAC_TUOI_HOAC_MAM_NON = /tuoi|mam non|mau giao|nha tre|\bmg\b|\bmn\b|\b\d{1,2}\s*t\b/;
/** Khuôn lớp ĐỨNG ĐẦU chuỗi: "lop 4", "khoi 5", "l4", "4", "4a1", "5/2", "lop 4 len 5". */
const KHUON_LOP = /^(?:lop|khoi|l)?\s*(\d{1,2})(.*)$/;

/**
 * "Lớp 4" / "lớp 10" / "Khối 5" / "4" / "4A1" → số lớp 1–12. "Lớp 4 lên 5" ⇒ 4 (đang học lớp 4).
 *
 * CHỈ nhận chuỗi BẮT ĐẦU bằng khuôn lớp. Ô "Lớp/Khối" của lead là chữ TỰ DO (form MISA, form
 * quà tặng, import) và người ta hay gõ TUỔI vào đó: bản cũ lấy "số đầu tiên ở bất kỳ đâu" nên
 * "Mầm non 5 tuổi" / "MG 5t" / "10 tuổi" thành Lớp 5 / Lớp 10 — và vì luật điền chỉ ghi ô
 * trống, số sai đó ĐỨNG LUÔN trên hồ sơ (lượt rà đối kháng 25/09). Vì vậy:
 *   · nhắc tuổi / mầm non / mẫu giáo / nhà trẻ / "5t" ⇒ `null`;
 *   · khoảng lớp ("Lớp 1-2", "3~4") ⇒ `null` — không biết em học lớp nào;
 *   · số ngoài 1–12, không có số, hay số không đứng đầu ("Học lớp 4") ⇒ `null`.
 * Không đoán: trả `null` chỉ làm ô trống ở lại trống, người dùng tự điền.
 */
export function lopTuChuoi(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .trim()
    .toLowerCase();
  if (!t || NHAC_TUOI_HOAC_MAM_NON.test(t)) return null;
  const m = t.match(KHUON_LOP);
  if (!m) return null;
  if (/^\s*[-–~]\s*\d/.test(m[2] ?? "")) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

export function dienTuLead(
  student: StudentDeDien,
  lead: LeadDeDien | null,
  child: LeadChildDeDien | null,
): PhanDien {
  const out: PhanDien = {};

  if (child) {
    if (student.dateOfBirth == null && child.dob) out.dateOfBirth = child.dob;
    if (student.gender == null) {
      const g = gioiTinhTuChuoi(child.gender);
      if (g) out.gender = g;
    }
    if (trong(student.school) && coChu(child.schoolName)) out.school = child.schoolName.trim();
    if (student.currentGrade == null) {
      const lop = lopTuChuoi(child.gradeLevel);
      if (lop != null) out.currentGrade = lop;
    }
  }

  if (lead) {
    if (trong(student.parentEmail) && coChu(lead.email)) out.parentEmail = lead.email.trim();
    if (student.parentGender == null && lead.parentGender) out.parentGender = lead.parentGender;
    if (student.parentDob == null && lead.parentDob) out.parentDob = lead.parentDob;
    if (trong(student.parentFacebookUrl) && coChu(lead.facebookUrl)) {
      out.parentFacebookUrl = lead.facebookUrl.trim();
    }

    const hvChuaCoDiaChi =
      trong(student.city) && trong(student.ward) && trong(student.address) && trong(student.district);
    const leadCoDiaChi = coChu(lead.city) || coChu(lead.ward) || coChu(lead.addressLine);
    if (hvChuaCoDiaChi && leadCoDiaChi) {
      if (coChu(lead.city)) out.city = lead.city.trim();
      if (coChu(lead.ward)) out.ward = lead.ward.trim();
      if (coChu(lead.addressLine)) out.address = lead.addressLine.trim();
    }
  }

  return out;
}

/** Nhãn "người nhập lead" theo khuôn chủ dự án yêu cầu: `MÃ_Tên` (25/09/2026). */
export function nhanNguoiNhapLead(
  maNhanVien: string | null | undefined,
  ten: string | null | undefined,
): string | null {
  const ma = maNhanVien?.trim() || null;
  const t = ten?.trim() || null;
  if (ma && t) return `${ma}_${t}`;
  return ma ?? t;
}
