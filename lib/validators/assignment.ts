import { z } from "zod";
import { parseVnDateTimeLocal } from "@/lib/time/vn";

export const AssignmentStatusEnum = z.enum([
  "DRAFT",
  "PUBLISHED",
  "CLOSED",
  "ARCHIVED",
]);

export const SubmissionStatusEnum = z.enum([
  "NOT_SUBMITTED",
  "SUBMITTED",
  "LATE",
  "GRADED",
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
 * Mốc ngày-giờ từ `<input type="datetime-local">`.
 *
 * ⚠️ 06/09 — KHÔNG dùng `z.coerce.date()` cho ô này. `coerce.date` gọi `new Date(value)`,
 * mà chuỗi `"YYYY-MM-DDTHH:mm"` không có múi giờ thì được hiểu theo giờ TIẾN TRÌNH:
 * Vercel chạy UTC nên hạn nộp 23:59 ngày 12/09 bị ghi thành 06:59 ngày 13/09 giờ VN —
 * phụ huynh đọc sai ngày, và cửa nộp bài mở thêm 7 tiếng ngoài ý giáo viên.
 */
const nullableDate = z
  .union([z.null(), z.literal(""), z.string(), z.date()])
  .optional()
  .transform((v) => {
    if (v === "" || v === undefined || v === null) return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    return parseVnDateTimeLocal(v);
  });

export const assignmentSchema = z
  .object({
    title: z.string().trim().min(1, "Tiêu đề bắt buộc").max(200),
    description: z.string().trim().min(1, "Mô tả bắt buộc"),
    instructions: nullableStr,
    // P-new — loại bài: trên lớp / về nhà.
    kind: z.enum(["CLASSWORK", "HOMEWORK"]).default("CLASSWORK"),
    classId: z.string().trim().min(1, "Chọn lớp"),
    lessonId: nullableStr,
    totalPoints: z.coerce.number().min(0.1, "Tổng điểm > 0").default(10),
    dueAt: nullableDate,
    allowText: z.coerce.boolean().default(true),
    allowFile: z.coerce.boolean().default(true),
    status: AssignmentStatusEnum.default("DRAFT"),
  })
  .refine((d) => d.allowText || d.allowFile, {
    message: "Cần cho phép ít nhất 1 trong text/file",
    path: ["allowText"],
  });

export type AssignmentInput = z.infer<typeof assignmentSchema>;
