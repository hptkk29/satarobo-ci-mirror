// lib/eval/forms.ts — R7-16: DB-backed form ops + edit-lock + clone.
// Phần THUẦN (schema/validate/QUESTION_TYPES) ở lib/eval/schema.ts (không import DB).
// Re-export để server-side tiện dùng 1 đầu mối; CLIENT phải import từ ./schema.
import type { EvalScope } from "@prisma/client";
import { db } from "@/lib/db";
import {
  evalQuestionsSchema,
  parseOptions,
  type EvalFormInput,
  type EvalQuestionInput,
} from "@/lib/eval/schema";

export {
  QUESTION_TYPES,
  TEXTBOX_MAX,
  evalQuestionInputSchema,
  evalQuestionsSchema,
  evalFormInputSchema,
  parseOptions,
  validateAnswers,
} from "@/lib/eval/schema";
export type {
  QuestionType,
  EvalQuestionInput,
  EvalFormInput,
  QuestionDef,
  SubmittedAnswer,
  NormalizedAnswer,
  ValidateResult,
} from "@/lib/eval/schema";

// ════════════════════════════════════════════════════════════════════════════
// DB-backed — gọi sau assertCan ở tầng action.
// ════════════════════════════════════════════════════════════════════════════

/** Form có response chưa? (qua rounds → responses). Quyết định edit-lock (AC2). */
export async function formHasResponses(formId: string): Promise<boolean> {
  const count = await db.evalResponse.count({ where: { round: { formId } } });
  return count > 0;
}

export async function listForms(scope?: EvalScope) {
  return db.evalForm.findMany({
    where: scope ? { scope } : {},
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { questions: true, rounds: true } },
    },
  });
}

export async function getFormWithQuestions(formId: string) {
  return db.evalForm.findUnique({
    where: { id: formId },
    include: { questions: { orderBy: { order: "asc" } } },
  });
}

export async function createForm(input: EvalFormInput, createdById: string | null) {
  return db.evalForm.create({
    data: {
      title: input.title,
      scope: input.scope,
      status: "DRAFT",
      createdById,
      questions: {
        create: input.questions.map((q, i) => ({
          type: q.type,
          label: q.label,
          options: q.type === "RADIO" || q.type === "CHECKBOX" ? (q.options ?? []) : undefined,
          required: q.required,
          order: i,
          groupLabel: q.groupLabel ?? null,
          allowCustomText: q.allowCustomText ?? false,
        })),
      },
    },
    include: { questions: true },
  });
}

/** Thay toàn bộ câu hỏi — CHẶN nếu form đã có response (AC2). */
export async function replaceQuestions(
  formId: string,
  questions: EvalQuestionInput[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await formHasResponses(formId)) {
    return { ok: false, error: "Form đã có phản hồi — không thể sửa câu hỏi. Hãy lưu trữ + nhân bản." };
  }
  // Validate lại ở server (phòng client gửi loại ngoài enum).
  const parsed = evalQuestionsSchema.safeParse(questions);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Câu hỏi không hợp lệ" };
  }
  // PHOTO chỉ cho SESSION_EVAL — portal PH (TEACHER_EVAL/CENTER_SURVEY) không có
  // input tải ảnh, câu PHOTO required làm PH không nộp được (khớp evalFormInputSchema).
  const form = await db.evalForm.findUnique({ where: { id: formId }, select: { scope: true } });
  if (!form) return { ok: false, error: "Form không tồn tại" };
  if (form.scope !== "SESSION_EVAL" && parsed.data.some((q) => q.type === "PHOTO")) {
    return { ok: false, error: "Câu hỏi 'Tải ảnh' chỉ dùng cho phiếu Đánh giá buổi học (SESSION_EVAL)" };
  }
  await db.$transaction([
    db.evalQuestion.deleteMany({ where: { formId } }),
    ...parsed.data.map((q, i) =>
      db.evalQuestion.create({
        data: {
          formId,
          type: q.type,
          label: q.label,
          options: q.type === "RADIO" || q.type === "CHECKBOX" ? (q.options ?? []) : undefined,
          required: q.required,
          order: i,
          groupLabel: q.groupLabel ?? null,
          allowCustomText: q.allowCustomText ?? false,
        },
      }),
    ),
  ]);
  return { ok: true };
}

export async function setFormStatus(formId: string, status: "DRAFT" | "ACTIVE" | "ARCHIVED") {
  return db.evalForm.update({ where: { id: formId }, data: { status } });
}

/** Nhân bản form (kèm câu hỏi) thành DRAFT mới — không kéo theo round/response (AC2). */
export async function cloneForm(formId: string, createdById: string | null) {
  const src = await getFormWithQuestions(formId);
  if (!src) return null;
  return db.evalForm.create({
    data: {
      title: `${src.title} (bản sao)`,
      scope: src.scope,
      status: "DRAFT",
      createdById,
      questions: {
        create: src.questions.map((q) => ({
          type: q.type,
          label: q.label,
          options: q.type === "RADIO" || q.type === "CHECKBOX" ? parseOptions(q.options) : undefined,
          required: q.required,
          order: q.order,
          groupLabel: q.groupLabel ?? null,
          allowCustomText: q.allowCustomText ?? false,
        })),
      },
    },
    include: { questions: true },
  });
}
