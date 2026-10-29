// lib/students/dong-bo-lead.ts — ĐỒNG BỘ HAI CHIỀU hồ sơ học viên ↔ phiếu lead nguồn (26/09/2026).
//
// Chủ dự án 26/09: "các thông tin từ trang lead thì cũng phải đồng bộ với học viên luôn,
// đổi 1 nơi thì các nơi khác phải đổi hết". ĐẢO chốt D2 ngày 25/09 ("tách theo chủ dữ liệu,
// nối lead chỉ điền ô TRỐNG, không đồng bộ ngược").
//
// File này là phần THUẦN: bảng ô chung, phép đổi định dạng giữa hai bên, và phép so "đã đổi
// chưa". Phần chạm DB ở `dong-bo-lead-db.ts`. Tách ra để luật nằm một chỗ và test không cần DB.
//
// ── Ô CHUNG ──────────────────────────────────────────────────────────────────────────────
//   Phụ huynh (Student ↔ Lead)          Con (Student ↔ LeadChild)
//     parentName        ↔ parentName       dateOfBirth  ↔ dob
//     parentPhone       ↔ phone            gender       ↔ gender   (enum ↔ "Nam"/"Nữ"/"Khác")
//     parentEmail       ↔ email            school       ↔ schoolName
//     parentFacebookUrl ↔ facebookUrl      currentGrade ↔ gradeLevel (7 ↔ "Lớp 7")
//     parentGender      ↔ parentGender
//     parentDob         ↔ parentDob
//     city / ward       ↔ city / ward
//     address           ↔ addressLine
//   TÊN CON (`Student.name` ↔ `LeadChild.fullName`) KHÔNG ở đây: nó đã có đường riêng từ
//   08/08 (`sync-name.ts`) vì còn kéo theo `Lead.childName` + `ParentFeedback.studentName`.
//
// ── LUẬT ─────────────────────────────────────────────────────────────────────────────────
//   1. Chỉ dội ô ĐÃ ĐỔI trong lượt ghi gốc (so trước/sau) — không bao giờ dội cả tờ. Dội cả
//      tờ là lấy giá trị cũ của bên này đè giá trị mới bên kia vừa sửa.
//   2. Chỉ ghi ô mà bên đích đang KHÁC (so theo nghĩa: SĐT so dạng chuẩn, ngày so theo ngày
//      lịch VN, chuỗi bỏ khoảng trắng hai đầu, rỗng = null). Ghi lại đúng giá trị đang có là
//      đẻ dòng nhật ký rỗng ruột.
//   3. Xoá trắng cũng là đổi — dội đi (trừ hai ô Lead BẮT BUỘC: tên + SĐT phụ huynh).
//   4. Giá trị không dịch được sang bên kia thì KHÔNG ghi (SĐT không hợp lệ không vào
//      `Lead.phone`; "Mầm non" không thành một số lớp) — không đoán.
//
// ⚠️ Tài khoản đăng nhập cổng phụ huynh (`User.phone`) KHÔNG nằm trong bảng này: đổi số đăng
// nhập phải qua luồng xác minh OTP, không được đổi hộ vì một lượt sửa hồ sơ.

import { canonicalPhone, nationalPhone } from "@/lib/phone";
import { vnYmd } from "@/lib/time/vn";
import { gioiTinhTuChuoi, NHAN_GIOI_TINH, type GioiTinh } from "./gioi-tinh";
import { lopTuChuoi } from "./dien-tu-lead";

// ─── Dạng dữ liệu của từng bên (chỉ các ô chung) ──────────────────────────────────────────

export type PhHocVien = {
  parentName: string | null;
  parentPhone: string | null;
  parentEmail: string | null;
  parentFacebookUrl: string | null;
  parentGender: GioiTinh | null;
  parentDob: Date | null;
  city: string | null;
  ward: string | null;
  address: string | null;
};

export type PhLead = {
  parentName: string;
  phone: string;
  email: string | null;
  facebookUrl: string | null;
  parentGender: GioiTinh | null;
  parentDob: Date | null;
  city: string | null;
  ward: string | null;
  addressLine: string | null;
};

export type ConHocVien = {
  dateOfBirth: Date | null;
  gender: GioiTinh | null;
  school: string | null;
  currentGrade: number | null;
};

export type ConLead = {
  dob: Date | null;
  gender: string | null;
  schoolName: string | null;
  gradeLevel: string | null;
};

/** Khoá của HV ↔ khoá của Lead. Thứ tự = thứ tự in ra nhật ký. */
export const O_PH: readonly (readonly [keyof PhHocVien, keyof PhLead])[] = [
  ["parentName", "parentName"],
  ["parentPhone", "phone"],
  ["parentEmail", "email"],
  ["parentFacebookUrl", "facebookUrl"],
  ["parentGender", "parentGender"],
  ["parentDob", "parentDob"],
  ["city", "city"],
  ["ward", "ward"],
  ["address", "addressLine"],
];

export const O_CON: readonly (readonly [keyof ConHocVien, keyof ConLead])[] = [
  ["dateOfBirth", "dob"],
  ["gender", "gender"],
  ["school", "schoolName"],
  ["currentGrade", "gradeLevel"],
];

/** `select` Prisma cho từng bên — dùng ở mọi chỗ đọc để không sót ô nào. */
export const CHON_PH_HOC_VIEN = Object.fromEntries(O_PH.map(([hv]) => [hv, true])) as {
  [K in keyof PhHocVien]: true;
};
export const CHON_PH_LEAD = Object.fromEntries(O_PH.map(([, l]) => [l, true])) as {
  [K in keyof PhLead]: true;
};
export const CHON_CON_HOC_VIEN = Object.fromEntries(O_CON.map(([hv]) => [hv, true])) as {
  [K in keyof ConHocVien]: true;
};
export const CHON_CON_LEAD = Object.fromEntries(O_CON.map(([, l]) => [l, true])) as {
  [K in keyof ConLead]: true;
};

/** Hai ô Lead bắt buộc (NOT NULL): xoá trắng ở hồ sơ HV không được dội sang. */
const LEAD_BAT_BUOC: ReadonlySet<keyof PhLead> = new Set(["parentName", "phone"]);

// ─── So sánh theo NGHĨA ───────────────────────────────────────────────────────────────────

type GiaTri = string | number | Date | null | undefined;

function chuoiHoa(v: GiaTri): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : vnYmd(v);
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Hai giá trị có cùng NGHĨA không. SĐT so dạng chuẩn `84…` (hồ sơ HV lưu nguyên chữ gõ
 * "0905…", lead lưu "84905…" — so thô là mỗi lượt lưu lại "đổi" SĐT một lần).
 */
export function bangNhau(khoa: string, a: GiaTri, b: GiaTri): boolean {
  if (khoa === "parentPhone" || khoa === "phone") {
    const ca = canonicalPhone(a);
    const cb = canonicalPhone(b);
    if (ca && cb) return ca === cb;
  }
  return chuoiHoa(a) === chuoiHoa(b);
}

/** Các ô có mặt trong `sau` mà KHÁC `truoc` (theo nghĩa). Ô vắng mặt trong `sau` = không đụng. */
export function oDaDoi<T extends Record<string, GiaTri>>(truoc: T, sau: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(sau) as (keyof T & string)[]) {
    const v = sau[k];
    if (v === undefined) continue;
    if (!bangNhau(k, truoc[k], v)) out[k] = v;
  }
  return out;
}

/** Bỏ khỏi `patch` những ô mà bên đích đang mang ĐÚNG nghĩa đó rồi (luật 2). */
export function chiOKhacDich<T extends Record<string, GiaTri>>(
  dich: T,
  patch: Partial<T>,
): Partial<T> {
  return oDaDoi(dich, patch);
}

// ─── Đổi định dạng giữa hai bên ──────────────────────────────────────────────────────────

function chuoiHoacNull(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

/** Ô PH đã đổi của HV → patch cho Lead. */
export function phHvSangLead(doi: Partial<PhHocVien>): Partial<PhLead> {
  const out: Partial<PhLead> = {};
  for (const [hv, l] of O_PH) {
    if (!(hv in doi)) continue;
    const v = doi[hv];
    if (l === "phone") {
      // Lead lưu dạng chuẩn `84…`. Số không chuẩn hoá được thì không ghi (luật 4).
      const c = canonicalPhone(v);
      if (c) out.phone = c;
      continue;
    }
    if (l === "parentName") {
      const s = chuoiHoacNull(v as string | null);
      if (s) out.parentName = s;
      continue;
    }
    (out as Record<string, unknown>)[l] = typeof v === "string" ? chuoiHoacNull(v) : v;
  }
  for (const k of LEAD_BAT_BUOC) {
    if (k in out && (out[k] === null || out[k] === undefined)) delete out[k];
  }
  return out;
}

/** Ô PH đã đổi của Lead → patch cho HV. */
export function phLeadSangHv(doi: Partial<PhLead>): Partial<PhHocVien> {
  const out: Partial<PhHocVien> = {};
  for (const [hv, l] of O_PH) {
    if (!(l in doi)) continue;
    const v = doi[l];
    if (hv === "parentPhone") {
      // Hồ sơ HV hiển thị dạng nội địa "0905…" — ghi dạng đó, không ghi "84…".
      const n = nationalPhone(v);
      if (n) out.parentPhone = n;
      continue;
    }
    if (hv === "parentName") {
      const s = chuoiHoacNull(v as string | null);
      if (s) out.parentName = s;
      continue;
    }
    (out as Record<string, unknown>)[hv] = typeof v === "string" ? chuoiHoacNull(v) : v;
  }
  return out;
}

/** Ô CON đã đổi của HV → patch cho LeadChild ("Nam"/"Nữ"/"Khác", "Lớp N" — đúng chữ màn lead ghi). */
export function conHvSangLead(doi: Partial<ConHocVien>): Partial<ConLead> {
  const out: Partial<ConLead> = {};
  if ("dateOfBirth" in doi) out.dob = doi.dateOfBirth ?? null;
  if ("gender" in doi) out.gender = doi.gender ? NHAN_GIOI_TINH[doi.gender] : null;
  if ("school" in doi) out.schoolName = chuoiHoacNull(doi.school);
  if ("currentGrade" in doi) {
    const n = doi.currentGrade;
    out.gradeLevel = n === null || n === undefined ? null : `Lớp ${n}`;
  }
  return out;
}

/** Ô CON đã đổi của LeadChild → patch cho HV. Không dịch được ⇒ không ghi ô đó (luật 4). */
export function conLeadSangHv(doi: Partial<ConLead>): Partial<ConHocVien> {
  const out: Partial<ConHocVien> = {};
  if ("dob" in doi) out.dateOfBirth = doi.dob ?? null;
  if ("gender" in doi) {
    const raw = chuoiHoacNull(doi.gender);
    if (raw === null) out.gender = null;
    else {
      const g = gioiTinhTuChuoi(raw);
      if (g) out.gender = g;
    }
  }
  if ("schoolName" in doi) out.school = chuoiHoacNull(doi.schoolName);
  if ("gradeLevel" in doi) {
    const raw = chuoiHoacNull(doi.gradeLevel);
    if (raw === null) out.currentGrade = null;
    else {
      const n = lopTuChuoi(raw);
      if (n !== null) out.currentGrade = n;
    }
  }
  return out;
}

/** Tách phần PH / phần CON ra khỏi một bản ghi HV bất kỳ có đủ các ô chung. */
export function phCuaHocVien(s: PhHocVien): PhHocVien {
  return Object.fromEntries(O_PH.map(([hv]) => [hv, s[hv]])) as PhHocVien;
}
export function conCuaHocVien(s: ConHocVien): ConHocVien {
  return Object.fromEntries(O_CON.map(([hv]) => [hv, s[hv]])) as ConHocVien;
}
export function phCuaLead(l: PhLead): PhLead {
  return Object.fromEntries(O_PH.map(([, k]) => [k, l[k]])) as PhLead;
}
export function conCuaLead(c: ConLead): ConLead {
  return Object.fromEntries(O_CON.map(([, k]) => [k, c[k]])) as ConLead;
}

/**
 * Lọc một patch ghi Lead / LeadChild bất kỳ (vd `updateData` của `updateLeadFields`) về đúng các
 * ô chung CÓ MẶT trong nó. Ô vắng mặt vẫn vắng — "không gửi" khác "xoá trắng".
 */
export function chiOPhLead(patch: Record<string, unknown>): Partial<PhLead> {
  return Object.fromEntries(
    O_PH.map(([, k]) => k).filter((k) => k in patch && patch[k] !== undefined).map((k) => [k, patch[k]]),
  ) as Partial<PhLead>;
}
export function chiOConLead(patch: Record<string, unknown>): Partial<ConLead> {
  return Object.fromEntries(
    O_CON.map(([, k]) => k).filter((k) => k in patch && patch[k] !== undefined).map((k) => [k, patch[k]]),
  ) as Partial<ConLead>;
}

/** Có ô nào không. */
export function coO(p: object): boolean {
  return Object.keys(p).length > 0;
}
