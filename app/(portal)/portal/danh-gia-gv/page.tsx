import { requireActiveStudent } from "@/lib/portal/session";
import { portalDb } from "@/lib/portal/db";
import { isEvalV2Enabled } from "@/lib/flags";
import { isRoundOpen } from "@/lib/eval/rounds";
import { getEligibleTeacherEvals } from "@/lib/eval/eligibility";
import { parseOptions, type QuestionType } from "@/lib/eval/forms";
import type { PortalQuestion } from "./_fields";
import { TeacherEvalForm } from "./eval-form";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Đánh giá giáo viên | Sata Robo",
  robots: { index: false },
};

export default async function DanhGiaGvPage() {
  const { ctx, studentId } = await requireActiveStudent();
  const pdb = portalDb({
    parentUserId: ctx.parentUserId,
    childIds: ctx.children.map((c) => c.id),
  });

  if (!isEvalV2Enabled()) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-bold text-neutral-900">
          Đánh giá giáo viên
        </h1>
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
          Tính năng đang được chuẩn bị. Vui lòng quay lại sau nhé!
        </p>
      </div>
    );
  }

  const rounds = await pdb.evaluationRound.findMany({
    where: { scope: "TEACHER_EVAL", status: "OPEN" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      opensAt: true,
      closesAt: true,
      centerId: true,
      courseId: true,
      form: { select: { questions: { orderBy: { order: "asc" } } } },
    },
  });

  const blocks: {
    roundId: string;
    name: string;
    questions: PortalQuestion[];
    pairs: {
      enrollmentId: string;
      teacherId: string;
      teacherName: string;
      className: string;
      role: string;
    }[];
  }[] = [];

  for (const r of rounds) {
    if (!isRoundOpen(r)) continue;
    const eligible = await getEligibleTeacherEvals(studentId, {
      scope: "TEACHER_EVAL",
      centerId: r.centerId,
      courseId: r.courseId,
    });
    if (eligible.length === 0) continue;

    // Loại cặp (enrollment×GV) đã gửi.
    const existing = await pdb.evalResponse.findMany({
      where: { roundId: r.id, studentId },
      select: { enrollmentId: true, teacherId: true },
    });
    const done = new Set(
      existing.map((e) => `${e.enrollmentId}|${e.teacherId}`),
    );
    const pairs = eligible.filter(
      (e) => !done.has(`${e.enrollmentId}|${e.teacherId}`),
    );
    if (pairs.length === 0) continue;

    const questions: PortalQuestion[] = r.form.questions.map((q) => ({
      id: q.id,
      type: q.type as QuestionType,
      label: q.label,
      options: parseOptions(q.options),
      required: q.required,
    }));

    blocks.push({ roundId: r.id, name: r.name, questions, pairs });
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">
          Đánh giá giáo viên
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Em hãy chấm sao và góp ý cho thầy/cô đang dạy mình nhé!
        </p>
      </div>

      {blocks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
          Hiện không có đợt đánh giá nào cần làm. Cảm ơn em!
        </p>
      ) : (
        blocks.map((b) => (
          <section key={b.roundId} className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-500">
              {b.name}
            </h2>
            {b.pairs.map((p) => (
              <TeacherEvalForm
                key={`${p.enrollmentId}|${p.teacherId}`}
                roundId={b.roundId}
                enrollmentId={p.enrollmentId}
                teacherId={p.teacherId}
                teacherName={p.teacherName}
                className={p.className}
                role={p.role}
                questions={b.questions}
              />
            ))}
          </section>
        ))
      )}
    </div>
  );
}
