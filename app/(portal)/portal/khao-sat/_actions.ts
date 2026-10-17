"use server";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireActiveStudent } from "@/lib/portal/session";
import { auth } from "@/lib/auth";
import { portalDb } from "@/lib/portal/db";

// B3 — phụ huynh trả lời khảo sát/NPS cho con đang chọn.
//
// @deprecated FL4-03 — luồng khảo sát trung tâm mới đi qua CENTER_SURVEY (EvalForm)
// ở _eval-actions.ts (submitCenterSurvey). Giữ action này song song (2-phase) để PH
// trả nốt các khảo sát NPS đang chạy; KHÔNG xoá Survey model/route.

const schema = z.object({
  surveyId: z.string().min(1),
  // Optional: survey CÓ SurveyQuestion gửi answers thay vì npsScore hardcode.
  npsScore: z.number().int().min(0).max(10).optional(),
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
  // Đáp án theo câu hỏi thật (NPS/RATING = number, TEXT = string) — validate
  // tiếp theo SurveyQuestion trong DB bên dưới (không tin type từ client).
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        value: z.union([
          z.number().int().min(0).max(10),
          z.string().trim().max(2000),
        ]),
      }),
    )
    .max(200)
    .optional(),
});

export async function submitSurveyResponse(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const { ctx, studentId } = await requireActiveStudent();
  const pdb = portalDb({
    parentUserId: ctx.parentUserId,
    childIds: ctx.children.map((c) => c.id),
  });

  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  const d = parsed.data;

  // KHÔNG tin surveyId từ client: survey phải tồn tại, đang mở (isActive) và trong
  // phạm vi cơ sở của con (centerId null = toàn hệ thống) — chống ghi bẩn KPI CSKH.
  const student = await pdb.student.findUnique({
    where: { id: studentId },
    select: { centerId: true, preferredCenterId: true },
  });
  const centerIds = [student?.centerId, student?.preferredCenterId].filter(
    (x): x is string => !!x,
  );
  const survey = await pdb.survey.findFirst({
    where: {
      id: d.surveyId,
      isActive: true,
      OR: [
        { centerId: null },
        ...(centerIds.length ? [{ centerId: { in: centerIds } }] : []),
      ],
    },
    select: {
      id: true,
      questions: {
        orderBy: { order: "asc" },
        select: { id: true, text: true, type: true },
      },
    },
  });
  if (!survey)
    return { ok: false, error: "Khảo sát không tồn tại hoặc đã đóng." };

  // Survey CÓ câu hỏi → validate đáp án theo ĐÚNG SurveyQuestion (form render đủ
  // câu hỏi, không còn 1 câu NPS hardcode); ghi vào SurveyResponse.answers Json
  // {questionId: value}. Survey KHÔNG câu hỏi (NPS thuần cũ) → giữ npsScore bắt buộc.
  let npsScore: number | null = d.npsScore ?? null;
  let answersJson: Record<string, number | string> | undefined;
  if (survey.questions.length > 0) {
    const byId = new Map(survey.questions.map((q) => [q.id, q]));
    answersJson = {};
    for (const a of d.answers ?? []) {
      const q = byId.get(a.questionId);
      if (!q)
        return { ok: false, error: "Câu trả lời không thuộc khảo sát này." };
      if (q.type === "TEXT") {
        if (typeof a.value !== "string") {
          return { ok: false, error: `Đáp án không hợp lệ cho "${q.text}".` };
        }
        if (a.value.length > 0) answersJson[q.id] = a.value;
      } else {
        const min = q.type === "NPS" ? 0 : 1;
        const max = q.type === "NPS" ? 10 : 5;
        if (typeof a.value !== "number" || a.value < min || a.value > max) {
          return { ok: false, error: `Đáp án không hợp lệ cho "${q.text}".` };
        }
        answersJson[q.id] = a.value;
      }
    }
    for (const q of survey.questions) {
      if (q.type !== "TEXT" && answersJson[q.id] === undefined) {
        return { ok: false, error: `Vui lòng trả lời: ${q.text}` };
      }
    }
    // KPI NPS: lấy từ câu NPS đầu tiên (nếu survey có) — không bịa từ câu hardcode.
    const firstNps = survey.questions.find((q) => q.type === "NPS");
    const npsAnswer = firstNps ? answersJson[firstNps.id] : undefined;
    npsScore = typeof npsAnswer === "number" ? npsAnswer : null;
  } else if (npsScore == null) {
    return { ok: false, error: "Vui lòng chọn điểm 0–10" };
  }

  // Chống trả lời trùng cùng survey cho 1 con.
  const dup = await pdb.surveyResponse.findFirst({
    where: { surveyId: d.surveyId, studentId },
    select: { id: true },
  });
  if (dup) return { ok: false, error: "Bạn đã trả lời khảo sát này rồi." };

  // Gắn center/class/teacher/csm để làm cơ sở KPI.
  const enr = await pdb.enrollment.findFirst({
    where: {
      studentId,
      status: { in: ["CONFIRMED", "STUDYING", "ACTIVE"] },
      deletedAt: null,
    }, // FIX-C3
    orderBy: { createdAt: "desc" },
    select: {
      class: { select: { id: true, centerId: true, teacherId: true } },
    },
  });
  // CSM phụ trách: lấy từ care task gần nhất (nếu có).
  const care = await pdb.studentCareTask.findFirst({
    where: { studentId, assignedToId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { assignedToId: true },
  });

  // Chốt chống trùng bằng UNIQUE (surveyId, studentId) — findFirst ở trên chỉ là
  // pre-check thân thiện, double-submit (2 tab / TOCTOU) sẽ chạm P2002 tại đây.
  try {
    await pdb.surveyResponse.create({
      data: {
        surveyId: d.surveyId,
        studentId,
        parentUserId: session.user.id,
        centerId: enr?.class.centerId ?? null,
        classId: enr?.class.id ?? null,
        teacherId: enr?.class.teacherId ?? null,
        csmId: care?.assignedToId ?? null,
        npsScore,
        comment: d.comment || null,
        answers: answersJson,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002")
        return { ok: false, error: "Bạn đã trả lời khảo sát này rồi." };
      return { ok: false, error: "Không gửi được khảo sát, vui lòng thử lại." };
    }
    throw e;
  }

  revalidatePath("/portal/khao-sat");
  return { ok: true };
}
