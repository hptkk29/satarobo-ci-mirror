import { requireActiveStudent } from "@/lib/portal/session";
import { portalDb } from "@/lib/portal/db";
import { isEvalV2Enabled, isPortalV2Enabled } from "@/lib/flags";
import { getEligibleCenterRounds } from "@/lib/eval/center-survey";
import { getCenterSurveys } from "@/lib/portal/surveys";
import { KhaoSatPageV2 } from "@/components/portal/khao-sat-page";
import { SurveyForm } from "./survey-form";
import { CenterSurveyForm } from "./center-survey";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Khảo sát | Sata Robo",
  robots: { index: false },
};

export default async function KhaoSatPage() {
  const { ctx, studentId } = await requireActiveStudent();
  const pdb = portalDb({
    parentUserId: ctx.parentUserId,
    childIds: ctx.children.map((c) => c.id),
  });

  // Portal v2 — trang Khảo sát trung tâm giống SataUI (thẻ danh mục).
  // Vẫn nạp đợt CENTER_SURVEY (FL4-03 — luồng chính) để PH không mất form khi bật v2.
  if (isPortalV2Enabled()) {
    const [{ cards, todoCount }, centerRounds] = await Promise.all([
      getCenterSurveys(studentId),
      isEvalV2Enabled()
        ? getEligibleCenterRounds(ctx.parentUserId)
        : Promise.resolve([]),
    ]);
    return (
      <KhaoSatPageV2
        kids={ctx.children.map((c) => ({ id: c.id, name: c.name }))}
        activeId={ctx.activeStudent?.id ?? null}
        // Survey ĐÃ làm: form không bao giờ render → rỗng hoá questions để text câu
        // hỏi không bị serialize thừa vào RSC payload (KhaoSatPageV2 là client component).
        cards={cards.map((c) => (c.done ? { ...c, questions: [] } : c))}
        todoCount={todoCount}
        centerRounds={centerRounds}
      />
    );
  }

  // FL4-03 — Khảo sát cơ sở CENTER_SURVEY (engine EvalForm, 4 loại câu hỏi) là luồng
  // chính. Survey/NPS dưới đây giữ song song (2-phase, sẽ deprecate — KHÔNG xoá).
  const centerRounds = isEvalV2Enabled()
    ? await getEligibleCenterRounds(ctx.parentUserId)
    : [];

  const student = await pdb.student.findUnique({
    where: { id: studentId },
    select: { centerId: true, preferredCenterId: true },
  });
  const centerIds = [student?.centerId, student?.preferredCenterId].filter(
    (x): x is string => !!x,
  );

  // @deprecated Survey/NPS cũ — thay dần bằng CENTER_SURVEY ở trên. Vẫn đọc để PH
  // trả nốt khảo sát đang chạy; không tạo mới qua admin (xem _actions.ts createSurvey).
  const surveys = await pdb.survey.findMany({
    where: {
      isActive: true,
      OR: [
        { centerId: null },
        ...(centerIds.length ? [{ centerId: { in: centerIds } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, title: true },
  });

  // Loại survey đã trả lời cho con này.
  const answered = new Set(
    (
      await pdb.surveyResponse.findMany({
        where: { studentId, surveyId: { in: surveys.map((s) => s.id) } },
        select: { surveyId: true },
      })
    ).map((r) => r.surveyId),
  );
  const pending = surveys.filter((s) => !answered.has(s.id));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-neutral-900">Khảo sát</h1>

      {centerRounds.length > 0 && (
        <div className="space-y-3">
          {centerRounds.map((r) => (
            <CenterSurveyForm
              key={r.roundId}
              roundId={r.roundId}
              title={r.title}
              questions={r.questions}
            />
          ))}
        </div>
      )}

      {pending.length === 0 && centerRounds.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
          Hiện không có khảo sát nào cần trả lời. Cảm ơn quý phụ huynh!
        </p>
      ) : (
        <div className="space-y-3">
          {pending.map((s) => (
            <SurveyForm key={s.id} surveyId={s.id} title={s.title} />
          ))}
        </div>
      )}
    </div>
  );
}
