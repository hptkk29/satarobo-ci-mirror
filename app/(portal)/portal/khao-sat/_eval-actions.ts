"use server";

// R7-16 — Khảo sát cơ sở (CENTER_SURVEY) round-based. TÁCH KHỎI _actions.ts (NPS cũ).
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireActiveStudent } from "@/lib/portal/session";
import { portalDb } from "@/lib/portal/db";
import { isEvalV2Enabled } from "@/lib/flags";
import { isRoundOpen } from "@/lib/eval/rounds";
import { isParentEligibleForCenterDb } from "@/lib/eval/eligibility";
import {
  validateAnswers,
  parseOptions,
  type QuestionDef,
  type QuestionType,
} from "@/lib/eval/forms";

const submitSchema = z.object({
  roundId: z.string().min(1),
  answers: z.array(
    z.object({
      questionId: z.string().min(1),
      valueNumber: z.number().int().nullable().optional(),
      valueOptions: z.array(z.string()).nullable().optional(),
      valueText: z.string().nullable().optional(),
    }),
  ),
});

type Res = { ok: true } | { ok: false; error: string };

export async function submitCenterSurvey(input: unknown): Promise<Res> {
  if (!isEvalV2Enabled()) return { ok: false, error: "Tính năng chưa được mở" };

  const { ctx, studentId } = await requireActiveStudent();
  const pdb = portalDb({
    parentUserId: ctx.parentUserId,
    childIds: ctx.children.map((c) => c.id),
  });
  const parentUserId = ctx.parentUserId;

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const d = parsed.data;

  const round = await pdb.evaluationRound.findUnique({
    where: { id: d.roundId },
    select: {
      scope: true,
      status: true,
      opensAt: true,
      closesAt: true,
      centerId: true,
      form: { select: { questions: { orderBy: { order: "asc" } } } },
    },
  });
  if (!round || round.scope !== "CENTER_SURVEY")
    return { ok: false, error: "Khảo sát không hợp lệ" };
  if (!isRoundOpen(round))
    return { ok: false, error: "Khảo sát đã đóng hoặc chưa mở" };

  // Eligibility tại thời điểm submit (AC5) — PH phải có ≥1 con đang học cơ sở này.
  const eligible = await isParentEligibleForCenterDb(
    parentUserId,
    round.centerId,
  );
  if (!eligible)
    return { ok: false, error: "Bạn không thuộc diện khảo sát của cơ sở này" };

  // Loại câu PHOTO (form legacy) — khớp getEligibleCenterRounds: portal PH không
  // render input ảnh, giữ lại sẽ làm câu required chặn nộp (dead-end).
  const questions: QuestionDef[] = round.form.questions
    .filter((q) => q.type !== "PHOTO")
    .map((q) => ({
      id: q.id,
      type: q.type as QuestionType,
      label: q.label,
      options: parseOptions(q.options),
      required: q.required,
    }));
  const v = validateAnswers(questions, d.answers);
  if (!v.ok) return { ok: false, error: v.error };

  // Chống trùng qua UNIQUE (roundId, parentUserId).
  try {
    await pdb.evalResponse.create({
      data: {
        roundId: d.roundId,
        parentUserId,
        studentId,
        answers: {
          create: v.normalized.map((a) => ({
            questionId: a.questionId,
            valueNumber: a.valueNumber,
            valueOptions: a.valueOptions ?? undefined,
            valueText: a.valueText,
          })),
        },
      },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return { ok: false, error: "Bạn đã hoàn thành khảo sát này rồi" };
    }
    throw e;
  }

  revalidatePath("/portal/khao-sat");
  return { ok: true };
}
