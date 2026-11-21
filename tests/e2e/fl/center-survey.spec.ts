/**
 * FL4-03 — Khảo sát TRUNG TÂM (CENTER_SURVEY): hợp nhất về engine EvalForm (4 loại
 * câu hỏi), PH trả lời ở /portal/khao-sat; Survey/NPS cũ giữ song song (2-phase).
 * Postgres LOCAL (.env.test). SKELETON — KHÔNG chạy trong CI (chờ chốt seed Eval* FL).
 *
 * Bao phủ:
 *  C1 — PH thuộc cơ sở thấy đợt CENTER_SURVEY đang mở; câu hỏi đủ 4 loại
 *  C2 — submit → lưu EvalResponse + EvalAnswer (4 loại), không nhân đôi
 *  C3 — CHỐNG TRÙNG: UNIQUE (roundId, parentUserId) — submit lần 2 bị chặn
 *  C4 — CÁCH LY CƠ SỞ: PH cơ sở khác KHÔNG đủ điều kiện đợt của cơ sở này
 *  C5 — 2-PHASE: Survey/NPS cũ vẫn đọc song song (không bị xoá)
 */
import { test, expect } from "@playwright/test";
import { Prisma } from "@prisma/client";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { getEligibleCenterRounds } from "../../../lib/eval/center-survey";
import { isParentEligibleForCenterDb } from "../../../lib/eval/eligibility";
import { validateAnswers, parseOptions, type QuestionDef, type QuestionType } from "../../../lib/eval/schema";

async function seedCenter(id: string) {
  await db.center.upsert({
    where: { id },
    create: { id, name: id, code: id, slug: id.toLowerCase(), address: "test" },
    update: {},
  });
}

/** PH (User) + 1 con đang học 1 lớp thuộc centerId. */
async function seedParentWithChild(centerId: string, status: Prisma.EnrollmentCreateInput["status"] = "STUDYING") {
  const parent = await db.user.create({
    data: { name: "PH Test", email: `ph-${Date.now()}-${Math.random()}@t.vn`, roles: ["PARENT"] },
    select: { id: true },
  });
  const student = await db.student.create({
    data: { name: "Con A", centerId, parentUserId: parent.id },
    select: { id: true },
  });
  const course = await db.course.create({ data: { name: "Sata 3", slug: `s3-${Date.now()}-${Math.random()}` } });
  const cls = await db.class.create({
    data: { name: "Lớp A", courseId: course.id, centerId, status: "ACTIVE" },
    select: { id: true, courseId: true },
  });
  await db.enrollment.create({
    data: { studentId: student.id, classId: cls.id, courseId: cls.courseId, status },
  });
  return { parentId: parent.id, studentId: student.id };
}

async function seedCenterSurveyRound(centerId: string | null) {
  const form = await db.evalForm.create({
    data: {
      title: "Khảo sát cơ sở",
      scope: "CENTER_SURVEY",
      status: "ACTIVE",
      questions: {
        create: [
          { type: "STAR_RATING", label: "Mức hài lòng?", required: true, order: 0 },
          { type: "RADIO", label: "Giới thiệu?", options: ["Có", "Không"], required: true, order: 1 },
          { type: "CHECKBOX", label: "Điểm tốt?", options: ["GV", "CSVC"], required: false, order: 2 },
          { type: "TEXTBOX", label: "Góp ý", required: false, order: 3 },
        ],
      },
    },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  const round = await db.evaluationRound.create({
    data: { formId: form.id, name: "Đợt khảo sát CS", scope: "CENTER_SURVEY", status: "OPEN", centerId },
  });
  return { form, round };
}

test.describe("[FL4-03] CENTER_SURVEY", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[FL4-03-C1] PH thuộc cơ sở thấy đợt; đủ 4 loại câu hỏi", async () => {
    await seedCenter("CS1");
    const { parentId } = await seedParentWithChild("CS1");
    await seedCenterSurveyRound("CS1");

    const rounds = await getEligibleCenterRounds(parentId);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.questions.map((q) => q.type).sort()).toEqual([
      "CHECKBOX",
      "RADIO",
      "STAR_RATING",
      "TEXTBOX",
    ]);
  });

  test("[FL4-03-C2/C3] submit lưu EvalResponse+EvalAnswer; UNIQUE chặn trùng", async () => {
    await seedCenter("CS1");
    const { parentId, studentId } = await seedParentWithChild("CS1");
    const { form, round } = await seedCenterSurveyRound("CS1");

    const qs: QuestionDef[] = form.questions.map((q) => ({
      id: q.id,
      type: q.type as QuestionType,
      label: q.label,
      options: parseOptions(q.options),
      required: q.required,
    }));
    const v = validateAnswers(qs, [
      { questionId: qs[0]!.id, valueNumber: 5 },
      { questionId: qs[1]!.id, valueOptions: ["Có"] },
      { questionId: qs[2]!.id, valueOptions: ["GV", "CSVC"] },
      { questionId: qs[3]!.id, valueText: "Rất tốt" },
    ]);
    expect(v.ok).toBe(true);
    if (!v.ok) return;

    const create = () =>
      db.evalResponse.create({
        data: {
          roundId: round.id,
          parentUserId: parentId,
          studentId,
          answers: { create: v.normalized.map((a) => ({ questionId: a.questionId, valueNumber: a.valueNumber, valueOptions: a.valueOptions ?? undefined, valueText: a.valueText })) },
        },
      });

    await create();
    const saved = await db.evalResponse.findMany({ where: { roundId: round.id, parentUserId: parentId }, include: { answers: true } });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.answers).toHaveLength(4);

    // C3 — submit lần 2 vi phạm UNIQUE (roundId, parentUserId).
    await expect(create()).rejects.toMatchObject({ code: "P2002" });
  });

  test("[FL4-03-C4] cách ly cơ sở — PH cơ sở khác KHÔNG đủ điều kiện", async () => {
    await seedCenter("CS1");
    await seedCenter("CS2");
    const { parentId } = await seedParentWithChild("CS2"); // con học CS2
    await seedCenterSurveyRound("CS1"); // đợt của CS1

    expect(await isParentEligibleForCenterDb(parentId, "CS1")).toBe(false);
    const rounds = await getEligibleCenterRounds(parentId);
    expect(rounds.find((r) => r.title === "Đợt khảo sát CS")).toBeUndefined();
  });

  test("[FL4-03-C5] 2-phase — Survey/NPS cũ vẫn đọc song song", async () => {
    await seedCenter("CS1");
    const { studentId } = await seedParentWithChild("CS1");
    const survey = await db.survey.create({
      data: { title: "NPS cuối khoá", milestone: "END_COURSE", questions: { create: { text: "Giới thiệu?", type: "NPS", order: 0 } } },
      select: { id: true },
    });
    await db.surveyResponse.create({ data: { surveyId: survey.id, studentId, npsScore: 9 } });
    const responses = await db.surveyResponse.findMany({ where: { surveyId: survey.id } });
    expect(responses).toHaveLength(1); // Survey model còn nguyên (2-phase)
  });
});
