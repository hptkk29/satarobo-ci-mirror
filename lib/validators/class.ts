import { z } from "zod";

export const ClassStatusEnum = z.enum([
  "PLANNED",
  "RECRUITING",
  "PENDING_APPROVAL", // set TỰ ĐỘNG khi sale "Gửi duyệt" — không chọn tay ở form
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
]);

const nullableStr = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = v.trim();
    return s.length > 0 ? s : null;
  });

/**
 * T3.1 — id BẮT BUỘC (phòng học / GV chính). Khác `nullableStr` ở chỗ chuỗi rỗng
 * (option "— Chọn … —" của <select>) bị coi là THIẾU và báo lỗi theo field.
 */
const requiredRefStr = (message: string) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v, ctx) => {
      const s = typeof v === "string" ? v.trim() : "";
      if (!s) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
      return s;
    });

const nullableDate = z
  .union([z.null(), z.literal(""), z.coerce.date()])
  .optional()
  .transform((v) => (v === "" || v === undefined || v === null ? null : v));

const timeField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined) return null;
    const s = v.trim();
    if (!s) return null;
    if (!/^\d{2}:\d{2}$/.test(s)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Định dạng giờ HH:mm",
      });
      return z.NEVER;
    }
    return s;
  });

export const classCreateSchema = z
  .object({
    name: z.string().trim().min(1, "Tên lớp bắt buộc").max(200),
    classCode: nullableStr,
    description: nullableStr,

    courseId: z.string().trim().min(1, "Chọn khoá học"),
    // PR-C: orgUnitId là nguồn chính (đơn vị); centerId suy ra từ org (HO→null) để dual-write.
    centerId: nullableStr,
    // Chủ dự án chốt 04/08: lớp BẮT BUỘC thuộc một cơ sở dạy học. Bỏ trống trước đây
    // ra "lớp không thuộc đâu cả" — biến mất khỏi mọi màn lọc theo cơ sở, im lặng.
    orgUnitId: requiredRefStr("Chọn cơ sở mở lớp"),
    classGroupId: nullableStr,
    // T3.1 — Phòng học + GV chính là TRƯỜNG BẮT BUỘC khi tạo/sửa lớp (không còn
    // "— Chưa phân —"). Trợ giảng vẫn tuỳ chọn.
    roomId: requiredRefStr("Chọn phòng học cho lớp"),
    teacherId: requiredRefStr("Chọn giáo viên chính cho lớp"),
    assistantId: nullableStr,

    startDate: nullableDate,
    endDate: nullableDate,
    scheduleDays: z
      .array(z.coerce.number().int().min(0).max(6))
      .default([])
      .transform((arr) => Array.from(new Set(arr)).sort((a, b) => a - b)),
    startTime: timeField,
    endTime: timeField,

    maxStudents: z.coerce.number().int().min(1, "Tối thiểu 1").default(20),
    minStudents: z.coerce.number().int().min(1, "Tối thiểu 1").default(5),

    status: ClassStatusEnum.default("PLANNED"),
    notes: nullableStr,
    // Legacy free-text schedule kept for back-compat; not edited by form.
    schedule: nullableStr,
  })
  .refine(
    (d) => !d.assistantId || !d.teacherId || d.assistantId !== d.teacherId,
    { message: "GV phụ không được trùng GV chính", path: ["assistantId"] },
  )
  .refine(
    (d) => !d.endDate || !d.startDate || d.endDate >= d.startDate,
    { message: "Ngày kết thúc phải >= ngày khai giảng", path: ["endDate"] },
  )
  .refine((d) => d.minStudents <= d.maxStudents, {
    message: "Số HS tối thiểu phải <= tối đa",
    path: ["minStudents"],
  });

export type ClassCreateInput = z.infer<typeof classCreateSchema>;
