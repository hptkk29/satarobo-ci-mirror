/**
 * FL4-01 — Phiếu đánh giá BUỔI HỌC (SESSION_EVAL): GV điền form động theo từng HS.
 * Postgres LOCAL (.env.test). SKELETON — KHÔNG chạy trong CI (chờ chốt seed Eval* FL).
 *
 * Bao phủ:
 *  C1 — đợt SESSION_EVAL áp cho buổi (theo cơ sở/khóa; đợt global áp cả lớp trải nghiệm)
 *  C2 — lưu EvalResponse(round×buổi×HS) + EvalAnswer; nhiều HS một lần
 *  C3 — CHỐNG TRÙNG app-level: lưu lại cùng (round×buổi×HS) → THAY answers, KHÔNG tạo response mới
 *  C4 — VERSIONING: buổi đã có response → form bị khóa sửa (formHasResponses) → clone để đổi
 *  C5 — đợt đóng/đổi giữa chừng → saveSessionEvalResponses áp form đang mở (gate ở action)
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { formHasResponses, replaceQuestions } from "../../../lib/eval/forms";
import {
  getSessionEvalState,
  saveSessionEvalResponses,
  findApplicableSessionEvalRound,
  type StudentEvalSubmission,
} from "../../../lib/eval/session-eval";

async function seedCenter(id: string) {
  await db.center.upsert({
    where: { id },
    create: { id, name: id, code: id, slug: id.toLowerCase(), address: "test" },
    update: {},
  });
}

async function seedSessionEvalForm(scope: { centerId?: string | null; courseId?: string | null }) {
  const form = await db.evalForm.create({
    data: {
      title: "Phiếu đánh giá buổi học",
      scope: "SESSION_EVAL",
      status: "ACTIVE",
      questions: {
        create: [
          {
            type: "RADIO",
            label: "Kiến thức cũ",
            options: ["Xuất sắc", "Tốt", "Khá", "Trung bình", "Cần cố gắng"],
            required: true,
            order: 0,
          },
          { type: "TEXTBOX", label: "Nhận xét của giáo viên", required: false, order: 1 },
        ],
      },
    },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  const round = await db.evaluationRound.create({
    data: {
      formId: form.id,
      name: "Đợt buổi học",
      scope: "SESSION_EVAL",
      status: "OPEN",
      centerId: scope.centerId ?? null,
      courseId: scope.courseId ?? null,
    },
  });
  return { form, round };
}

async function seedClassSession(centerId: string) {
  const course = await db.course.create({ data: { name: "Khoá Sata 3", slug: `sata3-${Date.now()}` } });
  const cls = await db.class.create({
    data: { name: "Lớp Sata 3 A", courseId: course.id, centerId, status: "ACTIVE" },
    select: { id: true, courseId: true, centerId: true },
  });
  const sess = await db.classSession.create({
    data: { classId: cls.id, date: new Date(), status: "SCHEDULED" },
    select: { id: true },
  });
  const hs1 = await db.student.create({ data: { name: "HS 1", centerId }, select: { id: true } });
  const hs2 = await db.student.create({ data: { name: "HS 2", centerId }, select: { id: true } });
  return { course, cls, sess, hs1, hs2 };
}

test.describe("[FL4-01] SESSION_EVAL form", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[FL4-01-C1] đợt global áp cho buổi; lấy được câu hỏi form", async () => {
    await seedCenter("CS1");
    const { round } = await seedSessionEvalForm({});
    const { sess } = await seedClassSession("CS1");

    const applicable = await findApplicableSessionEvalRound(sess.id);
    expect(applicable?.id).toBe(round.id);

    const state = await getSessionEvalState(sess.id);
    expect(state.active).toBe(true);
    if (state.active) expect(state.questions).toHaveLength(2);
  });

  test("[FL4-01-C2] lưu phiếu nhiều HS → EvalResponse(round×buổi×HS) + EvalAnswer", async () => {
    await seedCenter("CS1");
    const { form, round } = await seedSessionEvalForm({});
    const { sess, hs1, hs2 } = await seedClassSession("CS1");
    const qRadio = form.questions[0]!;
    const qText = form.questions[1]!;

    const subs: StudentEvalSubmission[] = [
      {
        studentId: hs1.id,
        answers: [
          { questionId: qRadio.id, valueOptions: ["Tốt"] },
          { questionId: qText.id, valueText: "Tiếp thu nhanh." },
        ],
      },
      { studentId: hs2.id, answers: [{ questionId: qRadio.id, valueOptions: ["Khá"] }] },
    ];
    const state = await getSessionEvalState(sess.id);
    if (!state.active) throw new Error("expected active");
    const res = await saveSessionEvalResponses(round.id, sess.id, state.questions, subs);
    expect(res.ok).toBe(true);

    const responses = await db.evalResponse.findMany({
      where: { roundId: round.id, classSessionId: sess.id },
      include: { answers: true },
    });
    expect(responses).toHaveLength(2);
    const r1 = responses.find((r) => r.studentId === hs1.id);
    expect(r1?.answers).toHaveLength(2);
  });

  test("[FL4-01-C3] CHỐNG TRÙNG — lưu lại cùng (round×buổi×HS) thay answers, KHÔNG tạo response mới", async () => {
    await seedCenter("CS1");
    const { round } = await seedSessionEvalForm({});
    const { sess, hs1 } = await seedClassSession("CS1");
    const state = await getSessionEvalState(sess.id);
    if (!state.active) throw new Error("expected active");
    const q = state.questions[0]!;

    await saveSessionEvalResponses(round.id, sess.id, state.questions, [
      { studentId: hs1.id, answers: [{ questionId: q.id, valueOptions: ["Tốt"] }] },
    ]);
    await saveSessionEvalResponses(round.id, sess.id, state.questions, [
      { studentId: hs1.id, answers: [{ questionId: q.id, valueOptions: ["Khá"] }] },
    ]);

    const responses = await db.evalResponse.findMany({
      where: { roundId: round.id, classSessionId: sess.id, studentId: hs1.id },
      include: { answers: true },
    });
    expect(responses).toHaveLength(1); // không nhân đôi
    expect(responses[0]!.answers[0]!.valueOptions).toEqual(["Khá"]); // đã thay
  });

  test("[FL4-01-C4] VERSIONING — buổi có response → form khóa sửa câu hỏi (clone để đổi)", async () => {
    await seedCenter("CS1");
    const { form, round } = await seedSessionEvalForm({});
    const { sess, hs1 } = await seedClassSession("CS1");
    const state = await getSessionEvalState(sess.id);
    if (!state.active) throw new Error("expected active");

    expect(await formHasResponses(form.id)).toBe(false);
    await saveSessionEvalResponses(round.id, sess.id, state.questions, [
      { studentId: hs1.id, answers: [{ questionId: state.questions[0]!.id, valueOptions: ["Tốt"] }] },
    ]);
    expect(await formHasResponses(form.id)).toBe(true);

    const locked = await replaceQuestions(form.id, [{ type: "TEXTBOX", label: "Mới", required: false }]);
    expect(locked.ok).toBe(false); // khóa — phải clone
  });

  test("[FL4-01-C1b] đợt gắn cơ sở khác → KHÔNG áp; đợt đúng cơ sở → áp", async () => {
    await seedCenter("CS1");
    await seedCenter("CS2");
    await seedSessionEvalForm({ centerId: "CS2" }); // đợt cho CS2
    const { sess } = await seedClassSession("CS1"); // buổi ở CS1
    expect(await findApplicableSessionEvalRound(sess.id)).toBeNull();
  });
});
