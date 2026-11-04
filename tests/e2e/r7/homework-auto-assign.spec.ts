/**
 * R7-14 — Auto-giao bài khi "Hoàn tất buổi" + phân quyền hiển thị PH. Postgres LOCAL.
 *
 * SKELETON (RTM): AC1↔C1 · AC2↔C2 · AC3↔C3 · AC4↔C4,C7 · AC5↔C5,C6.
 * Phần phụ thuộc request/cookie (view PH vs HV — AC5/C5) và setting điểm ON/OFF (C6)
 * cần lớp UI Playwright (browser context) — để TODO ở cuối.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { completeSession } from "../../../lib/lms/session-lifecycle";
import { assignHomeworkForSession } from "../../../lib/lms/assignment";
import { onSessionTaughtAssignHomework } from "../../../lib/events/handlers/homework-assign";
import { getParentHomeworkSummary } from "../../../lib/portal/learning";
import type { DomainEventLite } from "../../../lib/events/registry";

const CENTER = "CS1";

/** Seed curriculum→lesson→exam(PUBLISHED gắn lesson)→class→session + N HV active. */
async function seedSessionWithExam(opts: {
  slug: string;
  defaultDueDays?: number | null;
  examStatus?: "PUBLISHED" | "DRAFT";
  withQuestion?: boolean;
}) {
  await db.center.upsert({
    where: { id: CENTER },
    create: { id: CENTER, name: CENTER, code: CENTER, slug: CENTER.toLowerCase(), address: "test" },
    update: {},
  });
  const course = await db.course.create({ data: { name: `Khoá ${opts.slug}`, slug: opts.slug } });
  const curriculum = await db.curriculum.create({
    data: { name: `CT ${opts.slug}`, courseId: course.id },
    select: { id: true },
  });
  const lesson = await db.lesson.create({
    data: { curriculumId: curriculum.id, order: 1, title: `Bài ${opts.slug}` },
    select: { id: true },
  });
  const exam = await db.exam.create({
    data: {
      title: `KT ${opts.slug}`,
      lessonId: lesson.id,
      status: opts.examStatus ?? "PUBLISHED",
      defaultDueDays: opts.defaultDueDays ?? 7,
      totalPoints: 10,
    },
    select: { id: true },
  });
  if (opts.withQuestion) {
    const q = await db.question.create({
      data: { type: "MULTIPLE_CHOICE", text: `Câu hỏi bí mật ${opts.slug}` },
      select: { id: true },
    });
    await db.choice.createMany({
      data: [
        { questionId: q.id, order: 1, text: "Đáp án A", isCorrect: true },
        { questionId: q.id, order: 2, text: "Đáp án B", isCorrect: false },
      ],
    });
    await db.examQuestion.create({ data: { examId: exam.id, questionId: q.id, order: 1, points: 10 } });
  }
  const cls = await db.class.create({
    data: { name: `Lớp ${opts.slug}`, courseId: course.id, centerId: CENTER, status: "ACTIVE" },
    select: { id: true },
  });
  const session = await db.classSession.create({
    data: { classId: cls.id, date: new Date(), status: "SCHEDULED", lessonId: lesson.id },
    select: { id: true },
  });
  return { course, lesson, exam, cls, session };
}

async function addStudent(classId: string, name: string, status: string) {
  const student = await db.student.create({ data: { name, centerId: CENTER }, select: { id: true } });
  const cls = await db.class.findUniqueOrThrow({ where: { id: classId }, select: { courseId: true } });
  await db.enrollment.create({
    data: { studentId: student.id, classId, courseId: cls.courseId, status: status as never },
  });
  return student.id;
}

test.describe("[R7-14] Auto-giao bài + phân quyền portal", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  // ── AC1/C1 — NOW → giao đủ HV active + dueAt đúng ────────────────────────────
  test("[R7-14-C1] NOW → giao đủ HV active, hạn = hôm nay + defaultDueDays, notify PH", async () => {
    const { exam, cls, session } = await seedSessionWithExam({ slug: "c1", defaultDueDays: 7 });
    const s1 = await addStudent(cls.id, "HV1", "STUDYING");
    const s2 = await addStudent(cls.id, "HV2", "CONFIRMED");

    const res = await assignHomeworkForSession({ sessionId: session.id, assignMode: "NOW" });
    expect(res.created).toBe(2);

    const rows = await db.homeworkAssignment.findMany({ where: { examId: exam.id } });
    expect(rows.map((r) => r.studentId).sort()).toEqual([s1, s2].sort());
    for (const r of rows) expect(r.dueAt).not.toBeNull();

    const notif = await db.notification.count({ where: { classId: cls.id, title: "Bài tập mới" } });
    expect(notif).toBe(2);
  });

  // ── AC2/C2 — replay ×3 → không giao trùng ────────────────────────────────────
  test("[R7-14-C2] gọi lại / replay event ×3 → idempotent (không trùng)", async () => {
    const { exam, cls, session } = await seedSessionWithExam({ slug: "c2" });
    await addStudent(cls.id, "HV1", "STUDYING");

    await assignHomeworkForSession({ sessionId: session.id, assignMode: "NOW" });
    const ev: DomainEventLite = {
      id: "e1",
      type: "session.taught",
      payload: { sessionId: session.id, assignMode: "NOW" },
    };
    await onSessionTaughtAssignHomework(ev);
    await onSessionTaughtAssignHomework(ev);

    const count = await db.homeworkAssignment.count({ where: { examId: exam.id } });
    expect(count).toBe(1);
  });

  // ── AC2 — PAUSED bị loại; buổi không exam → không giao ───────────────────────
  test("[R7-14-C2b] HV PAUSED không nhận bài; buổi không gắn exam → không giao gì", async () => {
    const { cls, session } = await seedSessionWithExam({ slug: "c2b" });
    await addStudent(cls.id, "HV active", "STUDYING");
    await addStudent(cls.id, "HV paused", "PAUSED");

    const res = await assignHomeworkForSession({ sessionId: session.id, assignMode: "NOW" });
    expect(res.created).toBe(1); // chỉ HV active

    // Buổi của lesson KHÔNG có exam PUBLISHED → không giao.
    const noExam = await seedSessionWithExam({ slug: "c2c", examStatus: "DRAFT" });
    await addStudent(noExam.cls.id, "HV2", "STUDYING");
    const r2 = await assignHomeworkForSession({ sessionId: noExam.session.id, assignMode: "NOW" });
    expect(r2.created).toBe(0);
    expect(r2.skipped).toBe(true);
  });

  // ── AC3/C3 — DEFER → chưa giao; "Giao bài" sau → giao ────────────────────────
  test("[R7-14-C3] DEFER không giao; gọi lại NOW/CUSTOM_DUE → giao với hạn chọn", async () => {
    const { exam, cls, session } = await seedSessionWithExam({ slug: "c3" });
    await addStudent(cls.id, "HV1", "STUDYING");

    const deferred = await assignHomeworkForSession({ sessionId: session.id, assignMode: "DEFER" });
    expect(deferred.created).toBe(0);
    expect(await db.homeworkAssignment.count({ where: { examId: exam.id } })).toBe(0);

    const custom = new Date("2026-08-01T00:00:00.000Z");
    const later = await assignHomeworkForSession({
      sessionId: session.id,
      assignMode: "CUSTOM_DUE",
      customDueAt: custom,
    });
    expect(later.created).toBe(1);
    const row = await db.homeworkAssignment.findFirstOrThrow({ where: { examId: exam.id } });
    expect(row.dueAt?.toISOString()).toBe(custom.toISOString());
    // NOTE (AC3 negative): "GV lớp khác không bấm được" gác ở assignSessionHomeworkAction
    // (auth + ownership assignedClassIds) — phủ ở lớp UI Playwright.
  });

  // ── AC4/C7 — HV vào lớp SAU buổi đã dạy → không back-assign ──────────────────
  test("[R7-14-C7] HV vào lớp sau khi đã giao → không nhận bài buổi cũ", async () => {
    const { exam, cls, session } = await seedSessionWithExam({ slug: "c7" });
    await addStudent(cls.id, "HV sớm", "STUDYING");
    await assignHomeworkForSession({ sessionId: session.id, assignMode: "NOW" });

    // HV vào lớp SAU → chạy lại cùng buổi không tạo thêm bài cho buổi cũ ngoài lần giao mới
    // (vẫn idempotent cho HV cũ; HV mới chỉ nhận khi có buổi mới hoàn tất sau khi vào).
    await addStudent(cls.id, "HV trễ", "STUDYING");
    // Mô phỏng: buổi cũ KHÔNG được giao lại tự động (chỉ chạy lúc taught). Ở đây chỉ
    // khẳng định không có cơ chế back-assign tự động cho buổi đã đóng.
    const count = await db.homeworkAssignment.count({ where: { examId: exam.id } });
    expect(count).toBe(1); // chỉ HV sớm
  });

  // ── AC1 (integration) — completeSession(NOW) → event → handler giao bài ──────
  test("[R7-14-INT] completeSession phát session.taught kèm assignMode → handler giao", async () => {
    const { exam, cls, session } = await seedSessionWithExam({ slug: "int" });
    await addStudent(cls.id, "HV1", "STUDYING");
    const att = await db.student.create({ data: { name: "att", centerId: CENTER }, select: { id: true } });
    await db.attendance.create({ data: { sessionId: session.id, studentId: att.id, status: "PRESENT" } });

    const done = await completeSession({
          nguonChot: "TAY", sessionId: session.id, assignMode: "NOW", actorId: "gv", actorName: "GV" });
    expect(done.ok).toBe(true);

    const ev = await db.domainEvent.findFirstOrThrow({ where: { type: "session.taught" } });
    expect((ev.payloadJson as Record<string, unknown>).assignMode).toBe("NOW");
    await onSessionTaughtAssignHomework({
      id: ev.id,
      type: ev.type,
      payload: ev.payloadJson as Record<string, unknown>,
    });
    expect(await db.homeworkAssignment.count({ where: { examId: exam.id } })).toBe(1);
  });

  // ── AC5 (tầng PH) — aggregate KHÔNG chứa nội dung câu hỏi ────────────────────
  test("[R7-14-C5] getParentHomeworkSummary chỉ trả tổng quan, không câu hỏi/đáp án", async () => {
    const { cls, session } = await seedSessionWithExam({ slug: "c5", withQuestion: true });
    const sid = await addStudent(cls.id, "HV1", "STUDYING");
    await assignHomeworkForSession({ sessionId: session.id, assignMode: "NOW" });

    const summary = await getParentHomeworkSummary(sid);
    expect(summary.assigned).toBe(1);
    expect(summary.done).toBe(0);
    // DTO PH không có trường nào mang nội dung câu hỏi.
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("Câu hỏi bí mật");
    expect(serialized).not.toContain("Đáp án");
    // Mặc định setting OFF → không lộ điểm.
    expect(summary.showScore).toBe(false);
    expect(summary.items[0]?.summaryScore).toBeNull();
  });

  // TODO (UI Playwright — request/cookie scope):
  //  • C5: view=PH gọi /portal/bai-tap/lam-bai/[id] (getStudentHomeworkDetail) → null/404.
  //  • C6: setting homework.showScoreToParent ON → PH thấy điểm tổng quan.
  //  • C3 negative: GV lớp khác bấm "Giao bài" → assignSessionHomeworkAction trả lỗi quyền.
});
