// lib/eval/schema.ts — R7-16: phần THUẦN (không import DB) — an toàn cho client bundle.
// Loại câu hỏi ĐÓNG, Zod schema dựng form, validate đáp án. forms.ts (DB) re-export lại.
import { z } from "zod";

// ─── Loại câu hỏi: ENUM ĐÓNG (AC1/AC2) ──────────────────────────────────────
// Khớp 1-1 với Prisma enum EvalQuestionType. z.enum trên const literal là "cổng"
// chặn mọi loại ngoài các giá trị này ở tầng validate (trước cả DB enum).
// FL4 (R5) thêm PHOTO — ô tải ảnh dự án/lớp (phiếu đánh giá buổi); urls lưu valueOptions.
export const QUESTION_TYPES = ["STAR_RATING", "RADIO", "CHECKBOX", "TEXTBOX", "PHOTO"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

// ─── Phạm vi form: ENUM ĐÓNG (khớp Prisma enum EvalScope) ────────────────────
// FL4-01 thêm SESSION_EVAL (phiếu đánh giá buổi — GV chấm HS theo từng buổi học,
// dùng cho cả lớp chính + lớp trải nghiệm). RADIO = "5 mức mô tả"; TEXTBOX = nhận
// xét tự luận. Nhóm tiêu chí giữ phẳng theo thứ tự câu hỏi (engine không nhóm cứng).
export const EVAL_SCOPES = ["TEACHER_EVAL", "CENTER_SURVEY", "SESSION_EVAL"] as const;
export type EvalScopeValue = (typeof EVAL_SCOPES)[number];

export const TEXTBOX_MAX = 2000;

// ─── Zod schema cho 1 câu hỏi khi DỰNG form ─────────────────────────────────
export const evalQuestionInputSchema = z
  .object({
    type: z.enum(QUESTION_TYPES),
    label: z.string().trim().min(1, "Nội dung câu hỏi không được trống").max(500),
    options: z.array(z.string().trim().min(1).max(2000)).optional(),
    required: z.boolean().default(false),
    // FL4 (R5) — nhóm tiêu chí (header gom câu hỏi như phiếu mẫu). "" → null. Optional (additive).
    groupLabel: z
      .string()
      .trim()
      .max(120)
      .transform((v) => (v.length > 0 ? v : null))
      .optional(),
    // FL4 (R6) — cho phép nhập tự do kèm lựa chọn (RADIO/CHECKBOX/STAR_RATING). Optional (additive).
    allowCustomText: z.boolean().optional(),
  })
  .superRefine((q, ctx) => {
    const needsOptions = q.type === "RADIO" || q.type === "CHECKBOX";
    const opts = (q.options ?? []).filter((o) => o.length > 0);
    if (needsOptions && opts.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "RADIO/CHECKBOX cần tối thiểu 2 lựa chọn",
        path: ["options"],
      });
    }
    if (!needsOptions && opts.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Loại câu hỏi này không có lựa chọn dựng sẵn",
        path: ["options"],
      });
    }
  });

export type EvalQuestionInput = z.infer<typeof evalQuestionInputSchema>;

/** Danh sách câu hỏi của form (dùng riêng khi replaceQuestions — không có scope). */
export const evalQuestionsSchema = z
  .array(evalQuestionInputSchema)
  .min(1, "Form cần ít nhất 1 câu hỏi");

export const evalFormInputSchema = z
  .object({
    title: z.string().trim().min(1, "Tiêu đề không được trống").max(200),
    scope: z.enum(EVAL_SCOPES),
    questions: evalQuestionsSchema,
  })
  .superRefine((f, ctx) => {
    // PHOTO chỉ dành cho SESSION_EVAL (GV tải ảnh dự án/lớp). Portal PH
    // (TEACHER_EVAL/CENTER_SURVEY) KHÔNG có input tải ảnh → câu PHOTO required
    // làm PH kẹt không nộp được (dead-end) — chặn ngay từ khi dựng form.
    if (f.scope !== "SESSION_EVAL" && f.questions.some((q) => q.type === "PHOTO")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Câu hỏi 'Tải ảnh' chỉ dùng cho phiếu Đánh giá buổi học (SESSION_EVAL)",
        path: ["questions"],
      });
    }
  });

export type EvalFormInput = z.infer<typeof evalFormInputSchema>;

// ─── VALIDATE câu trả lời (AC8 — required / checkbox-min / textbox max) ──────
// PURE — dùng chung portal HV + PH. Trả normalized cho ghi DB hoặc error field.
export type QuestionDef = {
  id: string;
  type: QuestionType;
  label: string;
  options: string[] | null;
  required: boolean;
  /** FL4 (R5) — nhóm tiêu chí (header gom câu hỏi). null = không nhóm. */
  groupLabel?: string | null;
  /** FL4 (R6) — cho phép nhập tự do kèm lựa chọn (lưu valueText song song valueOptions). */
  allowCustomText?: boolean;
};

export type SubmittedAnswer = {
  questionId: string;
  valueNumber?: number | null;
  valueOptions?: string[] | null;
  valueText?: string | null;
};

export type NormalizedAnswer = {
  questionId: string;
  valueNumber: number | null;
  valueOptions: string[] | null;
  valueText: string | null;
};

export type ValidateResult =
  | { ok: true; normalized: NormalizedAnswer[] }
  | { ok: false; error: string; questionId?: string };

/** Đọc options của câu hỏi (Json?) thành string[] an toàn. */
export function parseOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options.filter((o): o is string => typeof o === "string");
}

export function validateAnswers(
  questions: QuestionDef[],
  answers: SubmittedAnswer[],
): ValidateResult {
  const byQ = new Map(answers.map((a) => [a.questionId, a]));
  const normalized: NormalizedAnswer[] = [];

  for (const q of questions) {
    const a = byQ.get(q.id);
    const out: NormalizedAnswer = {
      questionId: q.id,
      valueNumber: null,
      valueOptions: null,
      valueText: null,
    };

    if (q.type === "STAR_RATING") {
      const v = a?.valueNumber;
      if (v == null) {
        if (q.required) return fail(`Vui lòng chọn số sao cho "${q.label}"`, q.id);
      } else {
        if (!Number.isInteger(v) || v < 1 || v > 5) {
          return fail(`Số sao của "${q.label}" phải từ 1–5`, q.id);
        }
        out.valueNumber = v;
      }
    } else if (q.type === "RADIO") {
      const opts = a?.valueOptions ?? [];
      const allowed = q.options ?? [];
      if (opts.length === 0) {
        if (q.required) return fail(`Vui lòng chọn 1 đáp án cho "${q.label}"`, q.id);
      } else {
        if (opts.length !== 1) return fail(`"${q.label}" chỉ chọn 1 đáp án`, q.id);
        if (!allowed.includes(opts[0]!)) return fail(`Đáp án không hợp lệ cho "${q.label}"`, q.id);
        out.valueOptions = [opts[0]!];
      }
    } else if (q.type === "CHECKBOX") {
      const raw = a?.valueOptions ?? [];
      const allowed = q.options ?? [];
      const picked = [...new Set(raw)];
      // checkbox 0 lựa chọn nhưng required → reject (edge AC8).
      if (picked.length === 0) {
        if (q.required) return fail(`Vui lòng chọn ít nhất 1 ý cho "${q.label}"`, q.id);
      } else {
        for (const o of picked) {
          if (!allowed.includes(o)) return fail(`Lựa chọn không hợp lệ cho "${q.label}"`, q.id);
        }
        out.valueOptions = picked;
      }
    } else if (q.type === "PHOTO") {
      // FL4 (R5) — ô tải ảnh: valueOptions = mảng URL ảnh (string). required → ≥1 ảnh.
      const urls = (a?.valueOptions ?? []).filter((u): u is string => typeof u === "string" && u.length > 0);
      if (urls.length === 0) {
        if (q.required) return fail(`Vui lòng tải ảnh cho "${q.label}"`, q.id);
      } else {
        out.valueOptions = urls;
      }
    } else {
      // TEXTBOX
      const text = (a?.valueText ?? "").trim();
      if (text.length === 0) {
        if (q.required) return fail(`Vui lòng nhập nội dung cho "${q.label}"`, q.id);
      } else {
        if (text.length > TEXTBOX_MAX) {
          return fail(`"${q.label}" tối đa ${TEXTBOX_MAX} ký tự`, q.id);
        }
        out.valueText = text;
      }
    }

    // FL4 (R6) — free-text kèm lựa chọn (STAR/RADIO/CHECKBOX). Lưu valueText song song.
    if (q.allowCustomText && q.type !== "TEXTBOX" && q.type !== "PHOTO") {
      const ct = (a?.valueText ?? "").trim();
      if (ct.length > TEXTBOX_MAX) {
        return fail(`Ghi chú của "${q.label}" tối đa ${TEXTBOX_MAX} ký tự`, q.id);
      }
      if (ct.length > 0) out.valueText = ct;
    }

    normalized.push(out);
  }

  return { ok: true, normalized };
}

function fail(error: string, questionId?: string): ValidateResult {
  return { ok: false, error, questionId };
}
