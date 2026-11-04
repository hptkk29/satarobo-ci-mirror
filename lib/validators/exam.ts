import { z } from "zod";

export const ExamStatusEnum = z.enum([
  "DRAFT",
  "PUBLISHED",
  "CLOSED",
  "ARCHIVED",
]);

export const AttemptStatusEnum = z.enum([
  "IN_PROGRESS",
  "SUBMITTED",
  "GRADED",
  "REVIEWED",
]);

const nullableStr = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = v.trim();
    return s.length > 0 ? s : null;
  });

const nullableDate = z
  .union([z.null(), z.literal(""), z.coerce.date()])
  .optional()
  .transform((v) => (v === "" || v === undefined || v === null ? null : v));

export const examSchema = z
  .object({
    examCode: nullableStr,
    title: z.string().trim().min(1, "Tiêu đề bắt buộc").max(200),
    description: nullableStr,
    classId: nullableStr,
    lessonId: nullableStr,
    durationMinutes: z.coerce.number().int().min(5, "Tối thiểu 5 phút").default(60),
    totalPoints: z.coerce.number().min(0.1, "Tổng điểm > 0").default(10),
    passingScore: z.coerce.number().min(0).default(5),
    shuffleQuestions: z.coerce.boolean().default(false),
    shuffleChoices: z.coerce.boolean().default(false),
    openAt: nullableDate,
    closeAt: nullableDate,
    status: ExamStatusEnum.default("DRAFT"),
  })
  .refine(
    (d) => d.passingScore <= d.totalPoints,
    {
      message: "Điểm đạt phải <= tổng điểm",
      path: ["passingScore"],
    },
  )
  .refine(
    (d) => !d.closeAt || !d.openAt || d.closeAt >= d.openAt,
    {
      message: "Thời gian đóng phải >= thời gian mở",
      path: ["closeAt"],
    },
  );

export type ExamInput = z.infer<typeof examSchema>;
