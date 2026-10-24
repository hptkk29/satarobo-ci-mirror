/**
 * R7-17 — Notification handlers (DomainEvent → Notification / StaffNotification).
 *
 * SERVICE-LEVEL spec (Postgres LOCAL, .env.test). Gọi handler fn TRỰC TIẾP với
 * event tổng hợp { id, type, payload } sau khi seed các bản ghi handler đọc —
 * cô lập logic handler khỏi dispatcher/outbox.
 *
 * Mỗi assertion bám sát code handler + tên field schema THẬT (không đoán). Kiểm tra
 * idempotent bằng cách gọi handler 2 lần (replay) → vẫn đúng số dòng (dedupeKey).
 *
 * Handlers under test:
 *   - lib/_handlers/trial-notif.ts     → onTrialAssigned        (StaffNotification, audience nhân viên)
 *   - lib/_handlers/makeup-notif.ts    → onMakeupRequested/Confirmed (Notification audience STUDENT)
 *   - lib/_handlers/eval-notif.ts      → onEvalOpened (CENTER_SURVEY → Notification audience CENTER)
 *   - lib/_handlers/homework-notif.ts  → onSessionTaughtHomeworkNotif ("Bài tập mới" / HW assignment)
 *
 * Chạy:  R7_SKIP_WEBSERVER=1 pnpm test:e2e:r7 notifications.spec.ts
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import type { DomainEventLite } from "../../../lib/events/registry";
import { onTrialAssigned } from "../../../lib/_handlers/trial-notif";
import { onMakeupRequested, onMakeupConfirmed } from "../../../lib/_handlers/makeup-notif";
import { onEvalOpened } from "../../../lib/_handlers/eval-notif";
import { onSessionTaughtHomeworkNotif } from "../../../lib/_handlers/homework-notif";

// ─── helpers ──────────────────────────────────────────────────────────────────
let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;

/** Sự kiện DomainEvent tổng hợp (giống outbox row đã decode). */
function event(type: string, payload: Record<string, unknown>): DomainEventLite {
  return { id: uniq("evt"), type, payload };
}

/** Tạo 1 Center thật (Student.centerId / Class.centerId là FK → cần Center). */
async function makeCenter(label: string) {
  return db.center.create({
    data: { code: uniq(`C-${label}`), name: label, slug: uniq(`c-${label}`), address: "a", city: "" },
    select: { id: true },
  });
}

test.beforeEach(async () => {
  await resetDb();
});

// ─── 1) trial.assigned → StaffNotification cho Sale phụ trách lead ──────────────
test("[R7-17] onTrialAssigned → StaffNotification cho assignedTo + idempotent replay", async () => {
  const center = await makeCenter("trial");
  const sale = await seedUser({ email: testEmail("sale-trial"), role: "SALES_CSM" });

  // Lead có assignedToId = sale → handler ưu tiên gửi cho người này (fallback adminId).
  const lead = await db.lead.create({
    data: { parentName: "PH Trial", phone: "0900000010", assignedToId: sale.id, centerId: center.id },
    select: { id: true },
  });
  const child = await db.leadChild.create({
    data: { leadId: lead.id, fullName: "Bé An" },
    select: { id: true },
  });
  // TrialEnrollment thật (handler chỉ đọc id qua payload, nhưng seed đầy đủ chuỗi R7-02).
  const trialClass = await db.trialClassV2.create({
    data: {
      code: uniq("TC"),
      name: "Lớp trải nghiệm",
      centerId: center.id,
      startDate: new Date(),
      startTime: "18:00",
      endTime: "19:30",
      capacity: 10,
      sessionCount: 3,
    },
    select: { id: true },
  });
  const trialEnrollment = await db.trialEnrollment.create({
    data: { trialClassId: trialClass.id, leadChildId: child.id },
    select: { id: true },
  });

  const evt = event("trial.assigned", {
    trialEnrollmentId: trialEnrollment.id,
    leadChildId: child.id,
  });

  await onTrialAssigned(evt);

  const dedupeKey = `trial.assigned:${trialEnrollment.id}`;
  const rows = await db.staffNotification.findMany({ where: { dedupeKey } });
  expect(rows).toHaveLength(1);
  const n = rows[0];
  expect(n.userId).toBe(sale.id);
  expect(n.category).toBe("LEAD");
  expect(n.title).toBe("Đã xếp lớp trải nghiệm");
  expect(n.body).toBe("Đã xếp lớp trải nghiệm cho Bé An.");
  expect(n.href).toBe(`/leads/${lead.id}`);

  // Replay (idempotent qua @@unique([userId, dedupeKey])) → vẫn đúng 1 dòng.
  await onTrialAssigned(evt);
  expect(await db.staffNotification.count({ where: { dedupeKey } })).toBe(1);
});

// ─── 2) makeup.requested + makeup.confirmed → Notification audience STUDENT ─────
test("[R7-17] onMakeupRequested/Confirmed → Notification STUDENT + idempotent", async () => {
  const center = await makeCenter("makeup");
  const student = await db.student.create({
    data: { name: "HV Bù", centerId: center.id },
    select: { id: true },
  });
  const makeupNeedId = uniq("need");

  // — makeup.requested —
  const reqEvt = event("makeup.requested", { makeupNeedId, studentId: student.id });
  await onMakeupRequested(reqEvt);

  const reqKey = `makeup.requested:${makeupNeedId}`;
  const reqRows = await db.notification.findMany({ where: { dedupeKey: reqKey } });
  expect(reqRows).toHaveLength(1);
  const reqN = reqRows[0];
  expect(reqN.audience).toBe("STUDENT");
  expect(reqN.studentId).toBe(student.id);
  expect(reqN.centerId).toBe(center.id); // resolve từ student.centerId (payload không có centerId)
  expect(reqN.title).toBe("Yêu cầu học bù đã được ghi nhận");
  expect(reqN.createdByName).toBe("Hệ thống");

  await onMakeupRequested(reqEvt); // replay
  expect(await db.notification.count({ where: { dedupeKey: reqKey } })).toBe(1);

  // — makeup.confirmed —
  const confEvt = event("makeup.confirmed", { makeupNeedId, studentId: student.id });
  await onMakeupConfirmed(confEvt);

  const confKey = `makeup.confirmed:${makeupNeedId}`;
  const confRows = await db.notification.findMany({ where: { dedupeKey: confKey } });
  expect(confRows).toHaveLength(1);
  const confN = confRows[0];
  expect(confN.audience).toBe("STUDENT");
  expect(confN.studentId).toBe(student.id);
  expect(confN.centerId).toBe(center.id);
  expect(confN.title).toBe("Lịch học bù đã được xác nhận");

  await onMakeupConfirmed(confEvt); // replay
  expect(await db.notification.count({ where: { dedupeKey: confKey } })).toBe(1);

  // requested & confirmed là 2 dòng RIÊNG (dedupeKey khác nhau).
  expect(await db.notification.count({ where: { studentId: student.id } })).toBe(2);
});

// ─── 3) eval.opened (CENTER_SURVEY) → 1 Notification audience CENTER ────────────
test("[R7-17] onEvalOpened CENTER_SURVEY → 1 Notification audience CENTER + idempotent", async () => {
  const evalCenterId = uniq("cs"); // EvaluationRound.centerId là String? (không FK)
  const form = await db.evalForm.create({
    data: { title: "Form khảo sát", scope: "CENTER_SURVEY", status: "ACTIVE" },
    select: { id: true },
  });
  const round = await db.evaluationRound.create({
    data: {
      formId: form.id,
      name: "Khảo sát Quý 2",
      scope: "CENTER_SURVEY",
      centerId: evalCenterId,
      status: "OPEN",
    },
    select: { id: true, name: true },
  });

  const evt = event("eval.opened", {
    roundId: round.id,
    scope: "CENTER_SURVEY",
    centerId: evalCenterId,
  });
  await onEvalOpened(evt);

  const dedupeKey = `eval.opened:${round.id}`;
  const rows = await db.notification.findMany({ where: { dedupeKey } });
  expect(rows).toHaveLength(1);
  const n = rows[0];
  expect(n.audience).toBe("CENTER");
  expect(n.centerId).toBe(evalCenterId);
  expect(n.studentId).toBeNull();
  expect(n.title).toBe("Khảo sát trung tâm đang mở");
  expect(n.body).toContain(`Khảo sát "${round.name}"`);

  await onEvalOpened(evt); // replay
  expect(await db.notification.count({ where: { dedupeKey } })).toBe(1);
});

// ─── 4) session.taught (homework) → Notification "Bài tập mới" mỗi assignment ───
test("[R7-17] onSessionTaughtHomeworkNotif → Notification mỗi HomeworkAssignment + idempotent", async () => {
  const center = await makeCenter("hw");
  const course = await db.course.create({
    data: { name: "Robot HW", slug: uniq("robot-hw") },
    select: { id: true },
  });
  const cls = await db.class.create({
    data: { name: "Lớp Robot 1", courseId: course.id, centerId: center.id, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  const session = await db.classSession.create({
    data: { classId: cls.id, date: new Date(), status: "SCHEDULED" },
    select: { id: true },
  });
  const exam = await db.exam.create({
    data: { title: "Bài tập về nhà 1", status: "PUBLISHED" },
    select: { id: true, title: true },
  });

  // 2 HV → 2 assignment cùng buổi/cùng exam (studentId là cột phẳng, không FK).
  const stuA = uniq("stuA");
  const stuB = uniq("stuB");
  const aA = await db.homeworkAssignment.create({
    data: { classSessionId: session.id, examId: exam.id, studentId: stuA },
    select: { id: true },
  });
  const aB = await db.homeworkAssignment.create({
    data: { classSessionId: session.id, examId: exam.id, studentId: stuB },
    select: { id: true },
  });

  const evt = event("session.taught", { sessionId: session.id });
  await onSessionTaughtHomeworkNotif(evt);

  // 1 Notification / assignment, dedupeKey = homework.new:<assignmentId>.
  for (const [assignmentId, studentId] of [
    [aA.id, stuA],
    [aB.id, stuB],
  ] as const) {
    const rows = await db.notification.findMany({ where: { dedupeKey: `homework.new:${assignmentId}` } });
    expect(rows).toHaveLength(1);
    const n = rows[0];
    expect(n.audience).toBe("STUDENT");
    expect(n.studentId).toBe(studentId);
    expect(n.classId).toBe(cls.id);
    expect(n.centerId).toBe(center.id);
    expect(n.title).toBe(`Bài tập mới: ${exam.title}`);
    expect(n.body).toBe(`Lớp ${cls.name} có bài tập mới: ${exam.title}.`);
  }

  expect(await db.notification.count()).toBe(2);

  // Replay → vẫn đúng 2 (idempotent qua dedupeKey unique).
  await onSessionTaughtHomeworkNotif(evt);
  expect(await db.notification.count()).toBe(2);
});
