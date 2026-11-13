/**
 * R7-16 — Form builder Eval* + Đánh giá GV (HV) + Khảo sát cơ sở (PH).
 * Postgres LOCAL (.env.test). SKELETON — chưa chạy trong CI (chờ seed helper Eval*).
 *
 * Bao phủ RTM:
 *  C2 — enum 4 loại đóng (schema reject loại thứ 5)
 *  C3 — edit-lock: form có response → formHasResponses true → chặn replaceQuestions
 *  C5 — dedupe: UNIQUE (roundId, enrollmentId, teacherId) + (roundId, parentUserId)
 *  C6 — aggregate ẩn danh dùng lại cho báo cáo R7-17
 *  C8 — validate required / checkbox-min / textbox max (đã có ở lib/eval/eval-logic.test.ts)
 *
 * C1/C4/C7 (UI portal/admin) → Playwright UI, đánh dấu fixme đến khi seed Eval* sẵn sàng.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { evalQuestionInputSchema } from "../../../lib/eval/forms";
import { formHasResponses, replaceQuestions } from "../../../lib/eval/forms";
import { aggregateRound, getRoundDetail } from "../../../lib/eval/aggregate";
import { getEligibleTeacherEvals, isParentEligibleForCenterDb } from "../../../lib/eval/eligibility";
import { can } from "../../../lib/auth/permissions";

async function seedCenter(id: string) {
  await db.center.upsert({
    where: { id },
    create: { id, name: id, code: id, slug: id.toLowerCase(), address: "test" },
    update: {},
  });
}

async function seedTeacher(email: string, name: string) {
  return db.user.create({ data: { email, name, role: "TEACHER" }, select: { id: true, name: true } });
}

test.describe("[R7-16] Evaluation & Survey", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R7-16-C2] enum 4 loại đóng — reject loại thứ 5", () => {
    expect(evalQuestionInputSchema.safeParse({ type: "DROPDOWN", label: "x", required: false }).success).toBe(false);
    expect(evalQuestionInputSchema.safeParse({ type: "STAR_RATING", label: "x", required: true }).success).toBe(true);
  });

  test("[R7-16-C3] edit-lock — form có response thì chặn sửa câu hỏi", async () => {
    const form = await db.evalForm.create({
      data: {
        title: "F1",
        scope: "TEACHER_EVAL",
        status: "ACTIVE",
        questions: { create: [{ type: "STAR_RATING", label: "Sao", required: true, order: 0 }] },
      },
      include: { questions: true },
    });
    const round = await db.evaluationRound.create({
      data: { formId: form.id, name: "Đợt 1", scope: "TEACHER_EVAL", status: "OPEN" },
    });
    expect(await formHasResponses(form.id)).toBe(false);

    await db.evalResponse.create({
      data: {
        roundId: round.id,
        enrollmentId: "enr-1",
        teacherId: "tch-1",
        answers: { create: [{ questionId: form.questions[0]!.id, valueNumber: 5 }] },
      },
    });
    expect(await formHasResponses(form.id)).toBe(true);

    const res = await replaceQuestions(form.id, [{ type: "TEXTBOX", label: "Mới", required: false }]);
    expect(res.ok).toBe(false); // bị chặn (AC2)
  });

  test("[R7-16-C5] dedupe — gửi lần 2 cùng (đợt×enrollment×GV) bị UNIQUE chặn", async () => {
    const form = await db.evalForm.create({
      data: { title: "F", scope: "TEACHER_EVAL", status: "ACTIVE" },
    });
    const round = await db.evaluationRound.create({
      data: { formId: form.id, name: "R", scope: "TEACHER_EVAL", status: "OPEN" },
    });
    await db.evalResponse.create({ data: { roundId: round.id, enrollmentId: "e1", teacherId: "t1" } });
    await expect(
      db.evalResponse.create({ data: { roundId: round.id, enrollmentId: "e1", teacherId: "t1" } }),
    ).rejects.toThrow();
  });

  test("[R7-16-C5b] dedupe CENTER_SURVEY — cùng (đợt×PH) bị chặn", async () => {
    const form = await db.evalForm.create({ data: { title: "S", scope: "CENTER_SURVEY", status: "ACTIVE" } });
    const round = await db.evaluationRound.create({
      data: { formId: form.id, name: "R", scope: "CENTER_SURVEY", centerId: "cs1", status: "OPEN" },
    });
    await db.evalResponse.create({ data: { roundId: round.id, parentUserId: "p1" } });
    await expect(
      db.evalResponse.create({ data: { roundId: round.id, parentUserId: "p1" } }),
    ).rejects.toThrow();
  });

  test("[R7-16-C6] aggregateRound — tổng hợp ẩn danh (avg sao) cho báo cáo R7-17", async () => {
    const form = await db.evalForm.create({
      data: {
        title: "F",
        scope: "TEACHER_EVAL",
        status: "ACTIVE",
        questions: { create: [{ type: "STAR_RATING", label: "Sao", required: true, order: 0 }] },
      },
      include: { questions: true },
    });
    const round = await db.evaluationRound.create({
      data: { formId: form.id, name: "R", scope: "TEACHER_EVAL", status: "OPEN" },
    });
    const qid = form.questions[0]!.id;
    await db.evalResponse.create({
      data: { roundId: round.id, enrollmentId: "e1", teacherId: "t1", answers: { create: [{ questionId: qid, valueNumber: 5 }] } },
    });
    await db.evalResponse.create({
      data: { roundId: round.id, enrollmentId: "e2", teacherId: "t1", answers: { create: [{ questionId: qid, valueNumber: 3 }] } },
    });

    const agg = await aggregateRound(round.id, { teacherId: "t1" });
    expect(agg.responseCount).toBe(2);
    const star = agg.questions[0];
    expect(star?.type).toBe("STAR_RATING");
    if (star?.type === "STAR_RATING") expect(star.avg).toBe(4);
  });

  // ── AC3/C4 — HV chỉ đánh giá GV đã/đang dạy mình (getEligibleTeacherEvals) ────
  test("[R7-16-C4] profile HV chỉ thấy GV đã/đang dạy; GV lạ không có", async () => {
    await seedCenter("CS1");
    const teacherA = await seedTeacher("gv-a-c4@test.local", "Cô A"); // dạy HV này
    const teacherB = await seedTeacher("gv-b-c4@test.local", "Thầy B"); // GV lạ
    const course = await db.course.create({ data: { name: "Khoá c4", slug: "c4" } });
    const clsA = await db.class.create({
      data: { name: "Lớp A", courseId: course.id, centerId: "CS1", status: "ACTIVE", teacherId: teacherA.id },
      select: { id: true },
    });
    // Lớp B do thầy B dạy — HV này KHÔNG học → không được đánh giá thầy B.
    await db.class.create({
      data: { name: "Lớp B", courseId: course.id, centerId: "CS1", status: "ACTIVE", teacherId: teacherB.id },
      select: { id: true },
    });
    const student = await db.student.create({ data: { name: "HV c4", centerId: "CS1" }, select: { id: true } });
    await db.enrollment.create({
      data: { studentId: student.id, classId: clsA.id, courseId: course.id, status: "STUDYING" },
    });

    const eligible = await getEligibleTeacherEvals(student.id, {
      scope: "TEACHER_EVAL",
      centerId: null,
      courseId: null,
    });
    const ids = eligible.map((e) => e.teacherId);
    expect(ids).toContain(teacherA.id); // GV đang dạy → có
    expect(ids).not.toContain(teacherB.id); // GV lạ → không
  });

  // ── AC4/AC6/C6 — quyền: GV xem tổng hợp ẩn danh; chỉ QL xem chi tiết danh tính ─
  test("[R7-16-C6-ui] GV không quyền không thấy; GV aggregate ẩn danh; QL chi tiết", async () => {
    // Ma trận quyền (PERMISSIONS): GV xem tổng hợp nhưng KHÔNG chi tiết; role ngoài → không thấy.
    expect(can("TEACHER", "evaluations:view-aggregate")).toBe(true);
    expect(can("TEACHER", "evaluations:view-detail")).toBe(false);
    expect(can("CENTER_MANAGER", "evaluations:view-detail")).toBe(true);
    expect(can("SALES_CSM", "evaluations:view-aggregate")).toBe(false);

    await seedCenter("CS1");
    const form = await db.evalForm.create({
      data: {
        title: "F6",
        scope: "TEACHER_EVAL",
        status: "ACTIVE",
        questions: { create: [{ type: "STAR_RATING", label: "Sao", required: true, order: 0 }] },
      },
      include: { questions: true },
    });
    const round = await db.evaluationRound.create({
      data: { formId: form.id, name: "R6", scope: "TEACHER_EVAL", status: "OPEN" },
    });
    const qid = form.questions[0]!.id;
    await db.evalResponse.create({
      data: {
        roundId: round.id,
        enrollmentId: "enr-c6",
        teacherId: "t-c6",
        studentId: "stu-c6",
        answers: { create: [{ questionId: qid, valueNumber: 4 }] },
      },
    });

    // aggregateRound (GV xem) — ẩn danh: chỉ số liệu, KHÔNG lộ danh tính.
    const agg = await aggregateRound(round.id, { teacherId: "t-c6" });
    expect(agg.responseCount).toBe(1);
    const serialized = JSON.stringify(agg);
    expect(serialized).not.toContain("enr-c6"); // không lộ enrollmentId
    expect(serialized).not.toContain("stu-c6"); // không lộ studentId

    // getRoundDetail (QL xem) — kèm danh tính người trả lời.
    const detail = await getRoundDetail(round.id);
    expect(detail).toHaveLength(1);
    expect(detail[0]?.enrollmentId).toBe("enr-c6");
    expect(detail[0]?.teacherId).toBe("t-c6");
    expect(detail[0]?.studentId).toBe("stu-c6");
  });

  // ── AC5/C7 — PH chỉ đủ điều kiện khảo sát cơ sở mà con ĐANG học ───────────────
  test("[R7-16-C7] PH cơ sở khác mở khảo sát round CS1 → không thấy", async () => {
    await seedCenter("CS1");
    await seedCenter("CS2");
    const course = await db.course.create({ data: { name: "Khoá c7", slug: "c7" } });
    const clsCS1 = await db.class.create({
      data: { name: "Lớp CS1", courseId: course.id, centerId: "CS1", status: "ACTIVE" },
      select: { id: true },
    });
    const clsCS2 = await db.class.create({
      data: { name: "Lớp CS2", courseId: course.id, centerId: "CS2", status: "ACTIVE" },
      select: { id: true },
    });

    const parentCS1 = await db.user.create({
      data: { email: "ph-cs1-c7@test.local", name: "PH CS1", role: "PARENT" },
      select: { id: true },
    });
    const parentCS2 = await db.user.create({
      data: { email: "ph-cs2-c7@test.local", name: "PH CS2", role: "PARENT" },
      select: { id: true },
    });
    const childCS1 = await db.student.create({
      data: { name: "Con CS1", centerId: "CS1", parentUserId: parentCS1.id },
      select: { id: true },
    });
    const childCS2 = await db.student.create({
      data: { name: "Con CS2", centerId: "CS2", parentUserId: parentCS2.id },
      select: { id: true },
    });
    await db.enrollment.create({
      data: { studentId: childCS1.id, classId: clsCS1.id, courseId: course.id, status: "STUDYING" },
    });
    await db.enrollment.create({
      data: { studentId: childCS2.id, classId: clsCS2.id, courseId: course.id, status: "STUDYING" },
    });

    // Round khảo sát CS1: PH có con học CS1 đủ điều kiện; PH con học CS2 → KHÔNG thấy.
    expect(await isParentEligibleForCenterDb(parentCS1.id, "CS1")).toBe(true);
    expect(await isParentEligibleForCenterDb(parentCS2.id, "CS1")).toBe(false);
  });

  // UI flow còn lại — bật khi có lớp Playwright browser (render portal).
  // C1: render 4 loại câu hỏi (sao = emoji cho HV) là rendering React phía portal,
  // không kiểm được ở tầng service (config R7_SKIP_WEBSERVER) → giữ fixme.
  test.fixme("[R7-16-C1] dựng form 4 loại → render đúng portal (sao=emoji cho HV)", async () => {});
});
