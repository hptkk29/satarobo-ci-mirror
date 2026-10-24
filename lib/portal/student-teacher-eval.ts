import "server-only";
import { db } from "@/lib/db";
import { isEvalV2Enabled } from "@/lib/flags";
import { isRoundOpen } from "@/lib/eval/rounds";
import { getEligibleTeacherEvals } from "@/lib/eval/eligibility";
import { parseOptions, type QuestionType } from "@/lib/eval/forms";
import type { PortalQuestion } from "@/app/(portal)/portal/danh-gia-gv/_fields";

// Portal v2 — Cổng học sinh "Đánh giá giáo viên": gom các đợt TEACHER_EVAL đang mở +
// cặp (enrollment×GV) đủ điều kiện & chưa gửi. Chạy trong lib (được phép dùng db trần).

export type TeacherEvalPair = {
  enrollmentId: string;
  teacherId: string;
  teacherName: string;
  className: string;
  role: string;
};
export type TeacherEvalBlock = {
  roundId: string;
  name: string;
  questions: PortalQuestion[];
  pairs: TeacherEvalPair[];
};

export async function getTeacherEvalBlocks(studentId: string): Promise<TeacherEvalBlock[]> {
  if (!isEvalV2Enabled()) return [];

  const rounds = await db.evaluationRound.findMany({
    where: { scope: "TEACHER_EVAL", status: "OPEN" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, status: true, opensAt: true, closesAt: true,
      centerId: true, courseId: true,
      form: { select: { questions: { orderBy: { order: "asc" } } } },
    },
  });

  const blocks: TeacherEvalBlock[] = [];
  for (const r of rounds) {
    if (!isRoundOpen(r)) continue;
    const eligible = await getEligibleTeacherEvals(studentId, { scope: "TEACHER_EVAL", centerId: r.centerId, courseId: r.courseId });
    if (eligible.length === 0) continue;
    const existing = await db.evalResponse.findMany({ where: { roundId: r.id, studentId }, select: { enrollmentId: true, teacherId: true } });
    const done = new Set(existing.map((e) => `${e.enrollmentId}|${e.teacherId}`));
    const pairs = eligible.filter((e) => !done.has(`${e.enrollmentId}|${e.teacherId}`));
    if (pairs.length === 0) continue;
    const questions: PortalQuestion[] = r.form.questions.map((q) => ({
      id: q.id, type: q.type as QuestionType, label: q.label, options: parseOptions(q.options), required: q.required,
    }));
    blocks.push({ roundId: r.id, name: r.name, questions, pairs });
  }
  return blocks;
}
