import { z } from "zod";
// Hàm THUẦN (chỉ import kiểu) — an toàn cho cả client lẫn server. Cùng một phép chuẩn
// hoá với ô "Link Facebook" của lead: gõ "minh.nguyen.549" ở hai màn phải ra CÙNG một
// giá trị, và nó chặn `javascript:`/`data:` (giá trị render thành `<a href>`).
import { normalizeFacebookUrl } from "@/lib/lead/intake/normalize";

export const StudentStatusEnum = z.enum([
  "ACTIVE",
  "PAUSED",
  "GRADUATED",
  "INACTIVE",
]);

export const BloodTypeEnum = z.enum([
  "A_POS",
  "A_NEG",
  "B_POS",
  "B_NEG",
  "O_POS",
  "O_NEG",
  "AB_POS",
  "AB_NEG",
  "UNKNOWN",
]);

export const GenderEnum = z.enum(["MALE", "FEMALE", "OTHER"]);

// NỢ-2 (US-03 write-path, 09/08): chuỗi MASK không bao giờ là SĐT hợp lệ.
// Actor bị DENY cấp trường thấy form prefill dạng che ("090xxxx678" từ maskPhone,
// hoặc "09••••••78") — nếu chuỗi đó lọt tới DB là số thật bị ghi đè mất. Chặn cứng
// ở validator cho MỌI actor (phòng thủ độc lập với fieldMask ở action).
export const PHONE_MASK_RE = /[•*]|x{2,}/i;
export const PHONE_MASK_MSG =
  "SĐT đang ở dạng che (mask) — không phải số thật, không thể lưu";

// Helper transforms — turn empty strings into null so optional Prisma columns
// don't receive '' values.
const nullableStr = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = v.trim();
    return s.length > 0 ? s : null;
  });

// SĐT nullable + chặn chuỗi mask (NỢ-2). Dùng cho phone HV / parent2Phone.
const nullablePhoneStr = nullableStr.refine(
  (v) => v === null || !PHONE_MASK_RE.test(v),
  PHONE_MASK_MSG,
);

const nullableEmail = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const s = v.trim();
    if (s === "") return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Email không hợp lệ" });
      return z.NEVER;
    }
    return s;
  });

const nullableDate = z
  .union([z.null(), z.literal(""), z.coerce.date()])
  .optional()
  .transform((v) => (v === "" || v === undefined || v === null ? null : v));

// 25/09/2026 — ngày sinh PHỤ HUYNH: cùng luật với `Lead.parentDob`
// (app/(admin)/admin/leads/actions.ts): chặn tương lai, và `.refine` (không phải
// `.max(new Date())`) để mốc "bây giờ" tính lúc PHÂN TÍCH chứ không phải lúc nạp module.
const nullablePastDate = nullableDate.refine(
  (v) => v === null || v <= new Date(),
  "Ngày sinh phụ huynh không được ở tương lai",
);

// 25/09/2026 — link Facebook phụ huynh. Rỗng ⇒ null (xoá). Có chữ ⇒ phải chuẩn hoá được
// thành URL http(s); KHÔNG chuẩn hoá được thì BÁO LỖI chứ không nuốt im (ô lead giữ chữ
// lạ lại trong ghi chú, còn hồ sơ học viên không có chỗ nào như thế để giữ).
const nullableFacebookUrl = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined) return null;
    const s = v.trim();
    if (s === "") return null;
    const r = normalizeFacebookUrl(s);
    if (!r.url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Link Facebook không hợp lệ" });
      return z.NEVER;
    }
    return r.url;
  });

const nullableGender = z
  .union([GenderEnum, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v === "" || v === undefined || v === null ? null : v));

const nullableGrade = z
  .union([z.null(), z.literal(""), z.coerce.number().int().min(1).max(12)])
  .optional()
  .transform((v) => (v === "" || v === undefined || v === null ? null : v));

export const studentCreateSchema = z.object({
  name: z.string().trim().min(1, "Họ tên học viên bắt buộc").max(120),
  studentCode: nullableStr,
  dateOfBirth: nullableDate,
  gender: nullableGender,
  phone: nullablePhoneStr,
  email: nullableEmail,
  avatarUrl: nullableStr,

  currentGrade: nullableGrade,
  school: nullableStr,

  // Parent — required at write time even though DB column is nullable
  // (legacy rows from before D1 may have NULL parentName / parentPhone).
  parentName: z.string().trim().min(1, "Họ tên phụ huynh bắt buộc"),
  parentPhone: z
    .string()
    .trim()
    .min(1, "SĐT phụ huynh bắt buộc")
    // NỢ-2: chuỗi mask không phải SĐT — chặn ghi đè số thật trong DB.
    .refine((v) => !PHONE_MASK_RE.test(v), PHONE_MASK_MSG),
  parentEmail: nullableEmail,
  parentRelation: nullableStr,
  // 25/09/2026 — thuộc tính NGƯỜI LỚN trên hồ sơ học viên (cùng nghĩa Lead.parentGender /
  // parentDob / facebookUrl). `parentDob` + `parentFacebookUrl` là PII (luồng xoá NĐ13).
  parentGender: nullableGender,
  parentDob: nullablePastDate,
  parentFacebookUrl: nullableFacebookUrl,
  // #15 (câu 32) — CCCD phụ huynh (CHỈ phụ huynh, KHÔNG lưu CCCD học viên). PII nhạy
  // cảm: hiển thị mask + break-glass ở màn thanh toán. Nhập tại form học viên.
  parentNationalId: nullableStr,
  parent2Name: nullableStr,
  parent2Phone: nullablePhoneStr,
  parent2Relation: nullableStr,

  address: nullableStr,
  ward: nullableStr,
  district: nullableStr,
  city: nullableStr,

  bloodType: z
    .union([BloodTypeEnum, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" || v === undefined || v === null ? null : v)),
  allergies: z.array(z.string().trim().min(1)).default([]),
  healthNotes: nullableStr,

  enrollmentDate: nullableDate,
  preferredCenterId: nullableStr,
  // PR-C: OrgUnit là nguồn chính cho picker; centerId/preferredCenterId suy ra (dual-write).
  preferredOrgUnitId: nullableStr,
  notes: nullableStr,
  status: StudentStatusEnum.default("ACTIVE"),

  // Existing legacy fields — keep for compat (kept in schema, can still be edited)
  centerId: nullableStr,
  // Chủ dự án chốt 04/08: học viên BẮT BUỘC thuộc một cơ sở dạy học. Bỏ trống trước
  // đây ra HV "không cơ sở" — biến mất khỏi mọi màn lọc theo cơ sở mà không báo lỗi.
  orgUnitId: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v, ctx) => {
      const s = typeof v === "string" ? v.trim() : "";
      if (!s) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Chọn cơ sở của học viên" });
        return z.NEVER;
      }
      return s;
    }),
});

export type StudentCreateInput = z.infer<typeof studentCreateSchema>;

export const studentUpdateSchema = studentCreateSchema.partial();
export type StudentUpdateInput = z.infer<typeof studentUpdateSchema>;
