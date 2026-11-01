// lib/eval/center-survey.ts — FL4-03: khảo sát TRUNG TÂM (CENTER_SURVEY) phía portal PH.
//
// Hợp nhất khảo sát trung tâm về engine EvalForm (4 loại câu hỏi), thay dần
// Survey/NPS cũ (deprecate 2-phase — KHÔNG drop model). File MỚI của lane EVAL-C;
// KHÔNG đụng session-eval.ts / schema.ts / rounds.ts của EVAL-A.
//
// Tách khỏi portal/khao-sat/page.tsx để: (a) TEST được phần thuần (pickEligibleCenterRounds),
// (b) tái dùng. Phần thuần không import DB; phần DB-backed gọi sau requireActiveStudent.
import { db } from "@/lib/db";
import { isRoundOpen } from "@/lib/eval/rounds";
import { CURRENTLY_STUDYING_STATUSES } from "@/lib/eval/eligibility";
import { parseOptions, type QuestionType } from "@/lib/eval/schema";
import type { EvaluationRoundStatus } from "@prisma/client";

/** Câu hỏi 1 đợt khảo sát cơ sở (khớp shape PortalQuestion — render qua QuestionField). */
export type CenterSurveyQuestion = {
  id: string;
  type: QuestionType;
  label: string;
  options: string[];
  required: boolean;
};

export type CenterSurveyRoundView = {
  roundId: string;
  title: string;
  questions: CenterSurveyQuestion[];
};

/** Đợt CENTER_SURVEY (đã nạp câu hỏi) cần lọc — shape tối thiểu để test được. */
export type CenterRoundForFilter = {
  id: string;
  name: string;
  status: EvaluationRoundStatus;
  opensAt: Date | null;
  closesAt: Date | null;
  centerId: string | null;
  form: { questions: { id: string; type: string; label: string; options: unknown; required: boolean }[] };
};

/**
 * PURE — lọc đợt CENTER_SURVEY hiển thị cho PH:
 *  - đợt đang MỞ thực sự (status OPEN + trong khoảng opens/closes), và
 *  - cách ly cơ sở: đợt toàn hệ thống (centerId=null) HOẶC thuộc cơ sở PH đang có con học, và
 *  - PH chưa trả lời đợt đó.
 * Tách thuần để unit-test không cần DB.
 */
export function pickEligibleCenterRounds(
  rounds: CenterRoundForFilter[],
  myCenterIds: ReadonlySet<string>,
  answeredRoundIds: ReadonlySet<string>,
  now: Date = new Date(),
  // Đồng bộ với isParentEligibleForCenter(roundCenterId=null): đợt toàn hệ thống chỉ
  // hiện khi PH có ≥1 con ĐANG học — tránh PH điền form xong bị từ chối lúc submit.
  // (Con học lớp chưa gắn centerId không vào myCenterIds nhưng vẫn tính là "đang học".)
  hasStudyingChild: boolean = myCenterIds.size > 0,
): CenterSurveyRoundView[] {
  const out: CenterSurveyRoundView[] = [];
  for (const r of rounds) {
    if (!isRoundOpen(r, now)) continue;
    // Cách ly cơ sở: null = dùng chung (cần có con đang học); ngược lại cơ sở phải
    // nằm trong tầm của PH.
    if (r.centerId === null) {
      if (!hasStudyingChild) continue;
    } else if (!myCenterIds.has(r.centerId)) continue;
    if (answeredRoundIds.has(r.id)) continue;
    out.push({
      roundId: r.id,
      title: r.name,
      // Form legacy có thể chứa câu PHOTO (trước khi chặn PHOTO ngoài SESSION_EVAL):
      // portal PH không có input tải ảnh → loại khỏi form, tránh câu required
      // làm PH kẹt không nộp được (submitCenterSurvey lọc cùng quy tắc).
      questions: r.form.questions
        .filter((q) => q.type !== "PHOTO")
        .map((q) => ({
          id: q.id,
          type: q.type as QuestionType,
          label: q.label,
          options: parseOptions(q.options),
          required: q.required,
        })),
    });
  }
  return out;
}

/**
 * DB-backed — đợt CENTER_SURVEY đang MỞ mà PH đủ điều kiện (≥1 con đang học cơ sở
 * của đợt) + chưa làm. Cách ly cơ sở theo enrollment "đang học" của PH.
 */
export async function getEligibleCenterRounds(parentUserId: string): Promise<CenterSurveyRoundView[]> {
  // Cơ sở mà PH đang có con theo học (chỉ trạng thái "đang học").
  const enr = await db.enrollment.findMany({
    where: { student: { parentUserId, deletedAt: null }, status: { in: CURRENTLY_STUDYING_STATUSES } },
    select: { class: { select: { centerId: true } } },
  });
  const myCenters = new Set(enr.map((e) => e.class.centerId).filter((x): x is string => !!x));
  // PH không có con đang học → không đủ điều kiện đợt nào (kể cả centerId=null),
  // khớp isParentEligibleForCenterDb lúc submit (_eval-actions.ts).

  const rounds = await db.evaluationRound.findMany({
    where: {
      scope: "CENTER_SURVEY",
      status: "OPEN",
      OR: [{ centerId: null }, ...(myCenters.size ? [{ centerId: { in: [...myCenters] } }] : [])],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      opensAt: true,
      closesAt: true,
      centerId: true,
      form: { select: { questions: { orderBy: { order: "asc" } } } },
    },
  });
  if (rounds.length === 0) return [];

  // Đợt PH đã trả lời (gom 1 lượt thay vì findFirst từng đợt).
  const answered = await db.evalResponse.findMany({
    where: { roundId: { in: rounds.map((r) => r.id) }, parentUserId },
    select: { roundId: true },
  });
  const answeredIds = new Set(answered.map((a) => a.roundId));

  return pickEligibleCenterRounds(rounds, myCenters, answeredIds, new Date(), enr.length > 0);
}
