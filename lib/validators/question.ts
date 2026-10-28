import { z } from "zod";

export const QuestionTypeEnum = z.enum([
  "MULTIPLE_CHOICE",
  "TRUE_FALSE",
  "SHORT_ANSWER",
  "ESSAY",
  "CODE",
  // Parity site GV 18/08 — 3 loại soạn ở kho GV / thư viện mẫu (payload đặc thù nằm
  // ở Question.meta; form ngân hàng admin không soạn mới nhưng SỬA hàng có sẵn
  // không được đổi/ khoá kiểu). Không có rule choices/correctAnswer riêng.
  "FILL_BLANK",
  "MATCHING",
  "ORDERING",
]);

export const QuestionDifficultyEnum = z.enum([
  "EASY",
  "MEDIUM",
  "HARD",
  "EXPERT",
]);

const nullableStr = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = v.trim();
    return s.length > 0 ? s : null;
  });

// FL1-03 — điểm/câu (>= 0) và thời gian/câu (giây, >= 1). Trống → null.
const nullableNonNegFloat = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === ""))
      return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Điểm phải là số" });
      return z.NEVER;
    }
    if (n < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Điểm không được âm" });
      return z.NEVER;
    }
    return n;
  });

const nullablePosInt = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === ""))
      return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Thời gian phải là số nguyên (giây)",
      });
      return z.NEVER;
    }
    if (n < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Thời gian phải >= 1 giây",
      });
      return z.NEVER;
    }
    return n;
  });

const tagsClean = z
  .array(z.string())
  .default([])
  .transform((arr) =>
    Array.from(
      new Set(
        arr
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),
    ),
  );

export const choiceSchema = z
  .object({
    order: z.coerce.number().int().min(1).max(6),
    // FL1-03 — cho phép lựa chọn chỉ có ảnh (text trống) miễn là có ảnh.
    text: z.string().trim().default(""),
    isCorrect: z.coerce.boolean().default(false),
    imageUrl: nullableStr,
  })
  .refine((c) => c.text.length > 0 || Boolean(c.imageUrl), {
    message: "Lựa chọn cần nội dung chữ hoặc ảnh",
    path: ["text"],
  });

export const questionSchema = z
  .object({
    questionCode: nullableStr,
    type: QuestionTypeEnum,
    text: z.string().trim().min(1, "Đề bài bắt buộc"),
    explanation: nullableStr,
    imageUrl: nullableStr, // ảnh đề bài
    difficulty: QuestionDifficultyEnum.default("MEDIUM"),
    tags: tagsClean,
    // FL1-03 — gắn khung chương trình (lọc câu hỏi theo Sata x). courseId được
    // suy từ curriculum ở tầng server; FE gửi kèm để giảm round-trip.
    curriculumId: nullableStr,
    courseId: nullableStr,
    points: nullableNonNegFloat,
    timeLimitSec: nullablePosInt,
    lessonId: nullableStr,
    correctAnswer: nullableStr,
    choices: z.array(choiceSchema).default([]),
    isPublic: z.coerce.boolean().default(true),
    notes: nullableStr,
  })
  .superRefine((d, ctx) => {
    if (d.type === "MULTIPLE_CHOICE") {
      if (d.choices.length < 2 || d.choices.length > 6) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["choices"],
          message: "Trắc nghiệm cần 2 đến 6 lựa chọn",
        });
      }
      if (!d.choices.some((c) => c.isCorrect)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["choices"],
          message: "Cần ít nhất 1 đáp án đúng",
        });
      }
    } else if (d.type === "TRUE_FALSE") {
      if (d.choices.length !== 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["choices"],
          message: "Đúng/Sai cần đúng 2 lựa chọn",
        });
      }
      const correctCount = d.choices.filter((c) => c.isCorrect).length;
      if (correctCount !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["choices"],
          message: "Đúng/Sai cần đúng 1 đáp án đúng",
        });
      }
    } else if (d.type === "SHORT_ANSWER") {
      if (!d.correctAnswer || !d.correctAnswer.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["correctAnswer"],
          message: "Trả lời ngắn cần đáp án mong đợi",
        });
      }
    }
    // ESSAY + CODE: correctAnswer optional
  });

export type QuestionInput = z.infer<typeof questionSchema>;
export type ChoiceInput = z.infer<typeof choiceSchema>;
