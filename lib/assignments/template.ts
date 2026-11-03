import { z } from "zod";

/**
 * FL1-06 (QĐ-T2) — TEMPLATE bài tập (nguồn/bank theo KHUNG CHƯƠNG TRÌNH / buổi),
 * TÁCH khỏi Assignment (bài GIAO cho lớp).
 *
 * Khác biệt then chốt:
 *  - AssignmentTemplate: KHÔNG có `classId`, có `curriculumId`/`lessonId` (khung CT).
 *  - Assignment:         LUÔN có `classId`, có thể truy vết về `templateId`.
 *
 * File này giữ:
 *  - `assignmentTemplateSchema`: zod source-of-truth cho form template.
 *  - `templateToAssignmentData`: hàm THUẦN copy field template → data tạo Assignment
 *    (giữ `templateId` để truy vết). Tách thuần để test logic sinh-bài độc lập DB.
 */

const nullableStr = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = v.trim();
    return s.length > 0 ? s : null;
  });

export const assignmentTemplateSchema = z
  .object({
    title: z.string().trim().min(1, "Tiêu đề bắt buộc").max(200),
    description: z.string().trim().min(1, "Mô tả bắt buộc"),
    instructions: nullableStr,
    kind: z.enum(["CLASSWORK", "HOMEWORK"]).default("HOMEWORK"),
    // Khung chương trình — KHÔNG gắn lớp (đó là điểm khác Assignment).
    curriculumId: nullableStr,
    lessonId: nullableStr,
    totalPoints: z.coerce.number().min(0.1, "Tổng điểm > 0").default(10),
    allowText: z.coerce.boolean().default(true),
    allowFile: z.coerce.boolean().default(true),
  })
  .refine((d) => d.allowText || d.allowFile, {
    message: "Cần cho phép ít nhất 1 trong text/file",
    path: ["allowText"],
  });

export type AssignmentTemplateInput = z.infer<typeof assignmentTemplateSchema>;

/** Các field cần để copy 1 template thành bài giao cho lớp. */
export interface TemplateCopyFields {
  id: string;
  title: string;
  description: string;
  instructions: string | null;
  kind: "CLASSWORK" | "HOMEWORK";
  lessonId: string | null;
  totalPoints: number;
  allowText: boolean;
  allowFile: boolean;
}

export interface GenerateAssignmentOptions {
  classId: string;
  createdById?: string | null;
  dueAt?: Date | null;
}

/**
 * Hàm THUẦN: dựng data tạo `Assignment` (bài giao cho lớp) từ 1 template.
 *
 * - Copy title/description/instructions/kind/lessonId/totalPoints/allowText/allowFile.
 * - Gắn `classId` (Assignment LUÔN có lớp).
 * - Giữ `templateId = template.id` để TRUY VẾT bài giao về template nguồn.
 * - Bài mới luôn ở trạng thái DRAFT (chưa publish — tránh tự tạo bản nộp).
 *
 * KHÔNG đụng DB — server action chỉ việc `db.assignment.create({ data })`.
 */
export function templateToAssignmentData(
  template: TemplateCopyFields,
  opts: GenerateAssignmentOptions,
) {
  return {
    title: template.title,
    description: template.description,
    instructions: template.instructions ?? null,
    kind: template.kind,
    classId: opts.classId,
    lessonId: template.lessonId ?? null,
    templateId: template.id,
    totalPoints: template.totalPoints,
    allowText: template.allowText,
    allowFile: template.allowFile,
    dueAt: opts.dueAt ?? null,
    status: "DRAFT" as const,
    createdById: opts.createdById ?? null,
  };
}
