"use server";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { portalDb } from "@/lib/portal/db";
import { requireActiveStudent } from "@/lib/portal/session";
import { isEvalV2Enabled } from "@/lib/flags";
import { isRoundOpen } from "@/lib/eval/rounds";
import { getEligibleTeacherEvals } from "@/lib/eval/eligibility";
import {
  validateAnswers,
  parseOptions,
  type QuestionDef,
  type QuestionType,
} from "@/lib/eval/forms";

const submitSchema = z.object({
  roundId: z.string().min(1),
  enrollmentId: z.string().min(1),
  teacherId: z.string().min(1),
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

export async function submitTeacherEval(input: unknown): Promise<Res> {
  if (!isEvalV2Enabled()) return { ok: false, error: "Tính năng chưa được mở" };

  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const { ctx, studentId } = await requireActiveStudent();
  const pdb = portalDb({
    parentUserId: ctx.parentUserId,
    childIds: ctx.children.map((c) => c.id),
  });

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const d = parsed.data;

  // Đợt phải MỞ (round đóng giữa lúc điền → fail lịch sự).
  const round = await pdb.evaluationRound.findUnique({
    where: { id: d.roundId },
    select: {
      scope: true,
      status: true,
      opensAt: true,
      closesAt: true,
      centerId: true,
      courseId: true,
      form: { select: { questions: { orderBy: { order: "asc" } } } },
    },
  });
  if (!round || round.scope !== "TEACHER_EVAL")
    return { ok: false, error: "Đợt không hợp lệ" };
  if (!isRoundOpen(round))
    return { ok: false, error: "Đợt đánh giá đã đóng hoặc chưa mở" };

  // Eligibility tính tại thời điểm submit (AC3) — phải thuộc danh sách GV đủ điều kiện.
  const eligible = await getEligibleTeacherEvals(studentId, {
    scope: "TEACHER_EVAL",
    centerId: round.centerId,
    courseId: round.courseId,
  });
  const ok = eligible.some(
    (e) => e.enrollmentId === d.enrollmentId && e.teacherId === d.teacherId,
  );
  if (!ok)
    return {
      ok: false,
      error: "Em không thể đánh giá giáo viên này trong đợt này",
    };

  // Validate đáp án (required / sao 1–5 / checkbox-min / text ≤ 2000).
  const questions: QuestionDef[] = round.form.questions.map((q) => ({
    id: q.id,
    type: q.type as QuestionType,
    label: q.label,
    options: parseOptions(q.options),
    required: q.required,
  }));
  const v = validateAnswers(questions, d.answers);
  if (!v.ok) return { ok: false, error: v.error };

  // Tạo response + answers; chống trùng qua UNIQUE (roundId, enrollmentId, teacherId).
  try {
    await pdb.evalResponse.create({
      data: {
        roundId: d.roundId,
        enrollmentId: d.enrollmentId,
        teacherId: d.teacherId,
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
      return {
        ok: false,
        error: "Em đã đánh giá giáo viên này trong đợt này rồi",
      };
    }
    throw e;
  }

  revalidatePath("/portal/danh-gia-gv");
  return { ok: true };
}
