/**
 * R3-04 — điểm danh source-of-truth: ABSENT → MakeupNeed + audit. PG LOCAL.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../../e2e/_helpers/seed";
import { recordAttendance } from "../../../lib/lms/attendance-record";

const GV = { id: "gv1", name: "Cô Mai" };

async function setup() {
  const course = await db.course.create({ data: { name: "Sata 1", slug: "sata-1-att" } });
  const klass = await db.class.create({ data: { name: "Lớp Att", courseId: course.id } });
  const student = await db.student.create({ data: { name: "Bé Y" } });
  return { klass, student };
}
async function mkSession(classId: string) {
  return db.classSession.create({ data: { classId, date: new Date() } });
}

test.describe("[R3-04] Attendance → makeup", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R3-04-C4.3] ABSENT → tạo MakeupNeed + makeupStatus NEEDS_MAKEUP", async () => {
    const { klass, student } = await setup();
    const sess = await mkSession(klass.id);
    await recordAttendance(GV, { sessionId: sess.id, studentId: student.id, classId: klass.id, status: "ABSENT" });
    expect(await db.makeupNeed.count({ where: { studentId: student.id, missedSessionId: sess.id } })).toBe(1);
    const att = await db.attendance.findFirst({ where: { sessionId: sess.id, studentId: student.id } });
    expect(att?.makeupStatus).toBe("NEEDS_MAKEUP");
  });

  test("[R3-04-C4.3] EXCUSED/PRESENT → KHÔNG tạo MakeupNeed", async () => {
    const { klass, student } = await setup();
    const sess = await mkSession(klass.id);
    await recordAttendance(GV, { sessionId: sess.id, studentId: student.id, classId: klass.id, status: "EXCUSED" });
    expect(await db.makeupNeed.count({ where: { studentId: student.id } })).toBe(0);
  });

  test("[R3-04-C4.4] điểm danh + sửa → ghi AuditLog", async () => {
    const { klass, student } = await setup();
    const sess = await mkSession(klass.id);
    await recordAttendance(GV, { sessionId: sess.id, studentId: student.id, classId: klass.id, status: "PRESENT" });
    await recordAttendance(GV, { sessionId: sess.id, studentId: student.id, classId: klass.id, status: "LATE", reason: "đi muộn" });
    expect(await db.auditLog.count({ where: { module: "attendance", entityType: "Attendance" } })).toBeGreaterThanOrEqual(2);
  });

  test("[R3-04] idempotent: ABSENT 2 lần cùng buổi → 1 MakeupNeed", async () => {
    const { klass, student } = await setup();
    const sess = await mkSession(klass.id);
    await recordAttendance(GV, { sessionId: sess.id, studentId: student.id, classId: klass.id, status: "ABSENT" });
    await recordAttendance(GV, { sessionId: sess.id, studentId: student.id, classId: klass.id, status: "ABSENT" });
    expect(await db.makeupNeed.count({ where: { studentId: student.id, missedSessionId: sess.id } })).toBe(1);
  });
});
