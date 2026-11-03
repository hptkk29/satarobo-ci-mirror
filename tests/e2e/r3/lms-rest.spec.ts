/**
 * R3 (phần còn lại) — curriculum version isolation (C1.1) + makeup lifecycle (C7.1) +
 * assignment submit LATE (C8.3). PG LOCAL.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../../e2e/_helpers/seed";
import { requestMakeup, scheduleMakeup, completeMakeup, MakeupError } from "../../../lib/lms/makeup-service";
import { submitAssignment } from "../../../lib/lms/assignment";

test.describe("[R3] còn lại", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R3-01-C1.1] đổi giáo trình (version mới) KHÔNG ảnh hưởng lớp đang học", async () => {
    const course = await db.course.create({ data: { name: "Sata 1", slug: "sata-1-cur" } });
    const v1 = await db.curriculum.create({ data: { courseId: course.id, version: 1, name: "GT v1" } });
    const l1 = await db.lesson.create({ data: { curriculumId: v1.id, order: 1, title: "Bài 1 v1" } });
    const klass = await db.class.create({ data: { name: "Lớp cũ", courseId: course.id } });
    const sess = await db.classSession.create({ data: { classId: klass.id, date: new Date(), lessonId: l1.id } });

    // Ra giáo trình version 2 (lesson mới) — lớp cũ vẫn trỏ lesson v1.
    const v2 = await db.curriculum.create({ data: { courseId: course.id, version: 2, name: "GT v2" } });
    await db.lesson.create({ data: { curriculumId: v2.id, order: 1, title: "Bài 1 v2" } });

    const after = await db.classSession.findUnique({ where: { id: sess.id }, select: { lessonId: true } });
    expect(after?.lessonId).toBe(l1.id); // vẫn lesson v1
    const lesson = await db.lesson.findUnique({ where: { id: l1.id }, select: { curriculumId: true } });
    expect(lesson?.curriculumId).toBe(v1.id); // không bị đổi sang v2
  });

  test("[R3-07-C7.1] makeup lifecycle PENDING→SCHEDULED→COMPLETED; nhảy cóc → chặn", async () => {
    const course = await db.course.create({ data: { name: "Sata 1", slug: "sata-1-mk" } });
    const klass = await db.class.create({ data: { name: "Lớp MK", courseId: course.id } });
    const student = await db.student.create({ data: { name: "Bé Z" } });
    const sess = await db.classSession.create({ data: { classId: klass.id, date: new Date() } });
    const mkSess = await db.classSession.create({ data: { classId: klass.id, date: new Date() } });

    const need = await requestMakeup({ studentId: student.id, classId: klass.id, missedSessionId: sess.id });
    expect(need.status).toBe("PENDING");
    // nhảy cóc PENDING→COMPLETED bị chặn
    await expect(completeMakeup(need.id)).rejects.toThrow(MakeupError);
    const scheduled = await scheduleMakeup(need.id, mkSess.id, "staff1");
    expect(scheduled.status).toBe("SCHEDULED");
    const done = await completeMakeup(need.id);
    expect(done.status).toBe("COMPLETED");
    expect(done.completedAt).not.toBeNull();
  });

  test("[R3-08-C8.3] nộp bài quá hạn → LATE; đúng hạn → SUBMITTED", async () => {
    const course = await db.course.create({ data: { name: "Sata 1", slug: "sata-1-as" } });
    const klass = await db.class.create({ data: { name: "Lớp AS", courseId: course.id } });
    const student = await db.student.create({ data: { name: "Bé W" } });
    const late = await db.assignment.create({ data: { title: "BT1", description: "x", classId: klass.id, dueAt: new Date("2020-01-01") } });
    const ontime = await db.assignment.create({ data: { title: "BT2", description: "x", classId: klass.id, dueAt: new Date("2099-01-01") } });

    const s1 = await submitAssignment({ assignmentId: late.id, studentId: student.id, textAnswer: "nộp muộn" });
    expect(s1.status).toBe("LATE");
    const s2 = await submitAssignment({ assignmentId: ontime.id, studentId: student.id, textAnswer: "đúng hạn" });
    expect(s2.status).toBe("SUBMITTED");
  });
});
