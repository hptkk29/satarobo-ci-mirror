/**
 * R7-06 — Snapshot giáo trình vào lớp (ghim version + sinh ClassSessionPlan) +
 * huỷ buổi (CANCELLED, không xoá) sinh buổi bù nối cuối lịch. Postgres LOCAL.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { createSessionPlansForClass, resolveEffectiveCurriculumVersion } from "../../../lib/classes/snapshot";
import { cancelSession, buildMakeupDate } from "../../../lib/classes/adjust";

async function seedCourseWithCurriculum(slug: string, lessonCount: number) {
  const course = await db.course.create({ data: { name: `Khoá ${slug}`, slug } });
  const curriculum = await db.curriculum.create({
    data: {
      courseId: course.id,
      version: 1,
      name: "Giáo trình v1",
      isActive: true,
      status: "ACTIVE",
      lessons: {
        create: Array.from({ length: lessonCount }, (_, i) => ({
          order: i,
          title: `Bài ${i + 1}`,
        })),
      },
    },
    select: { id: true, version: true },
  });
  return { course, curriculum };
}

test.describe("[R7-06] Class snapshot + cancel session", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R7-06-01] tạo lớp ghim curriculum version + sinh ClassSessionPlan (1 plan/lesson)", async () => {
    const { course, curriculum } = await seedCourseWithCurriculum("snap-1", 5);
    const cls = await db.class.create({
      data: {
        name: "Lớp A1",
        courseId: course.id,
        curriculumId: curriculum.id,
        curriculumVersion: curriculum.version,
      },
      select: { id: true, curriculumId: true, curriculumVersion: true },
    });
    // Lớp đã ghim version (snapshot).
    expect(cls.curriculumId).toBe(curriculum.id);
    expect(cls.curriculumVersion).toBe(1);

    const created = await createSessionPlansForClass({
      classId: cls.id,
      curriculumId: curriculum.id,
      version: curriculum.version,
    });
    expect(created).toBe(5);

    const plans = await db.classSessionPlan.findMany({
      where: { classId: cls.id },
      orderBy: { order: "asc" },
      select: { seq: true, customTitle: true, lessonId: true },
    });
    expect(plans.map((p) => p.seq)).toEqual([1, 2, 3, 4, 5]);

    // 08/09 — ĐỔI KỲ VỌNG (trước: `customTitle === "Bài 1"`). `customTitle` là ô dành cho
    // thứ NGƯỜI gõ; đổ tên bài của máy vào đó tạo bản sao ĐÔNG CỨNG không tự đồng bộ khi
    // giáo trình đổi tên — gốc của sự cố "lệch tên bài" (docs/dieu-tra-lech-bai-hoc.md).
    // Tên bài nay đọc thẳng từ `Lesson` mỗi lần dựng nhãn.
    for (const p of plans) expect(p.customTitle).toBeNull();
    // Nhưng vẫn phải NỐI đủ bài — đó mới là việc của hàm này.
    expect(plans.every((p) => p.lessonId !== null)).toBe(true);
  });

  test("[R7-06-02] createSessionPlansForClass idempotent — gọi lại không nhân đôi", async () => {
    const { course, curriculum } = await seedCourseWithCurriculum("snap-2", 4);
    const cls = await db.class.create({
      data: { name: "Lớp A2", courseId: course.id, curriculumId: curriculum.id, curriculumVersion: 1 },
      select: { id: true },
    });
    expect(await createSessionPlansForClass({ classId: cls.id, curriculumId: curriculum.id, version: 1 })).toBe(4);
    expect(await createSessionPlansForClass({ classId: cls.id, curriculumId: curriculum.id, version: 1 })).toBe(4);
    expect(await db.classSessionPlan.count({ where: { classId: cls.id } })).toBe(4);
  });

  test("[R7-06-03] resolveEffectiveCurriculumVersion: lớp đã ghim → version ghim; chưa ghim → fallback", () => {
    expect(resolveEffectiveCurriculumVersion({ curriculumId: "c1", curriculumVersion: 2 }, 9)).toBe(2);
    expect(resolveEffectiveCurriculumVersion({ curriculumId: null, curriculumVersion: null }, 9)).toBe(9);
  });

  test("[R7-06-04] cancelSession → buổi CANCELLED (không xoá) + buổi bù nối cuối lịch", async () => {
    const { course, curriculum } = await seedCourseWithCurriculum("snap-3", 3);
    const cls = await db.class.create({
      data: { name: "Lớp A3", courseId: course.id, curriculumId: curriculum.id, curriculumVersion: 1 },
      select: { id: true },
    });
    const d0 = new Date("2026-07-01T09:00:00Z");
    const sessions = await Promise.all(
      [0, 7, 14].map((offset, i) =>
        db.classSession.create({
          data: {
            classId: cls.id,
            date: new Date(d0.getTime() + offset * 86_400_000),
            topic: `Buổi ${i + 1}`,
            status: "SCHEDULED",
          },
          select: { id: true, date: true },
        }),
      ),
    );

    const r = await cancelSession({
      sessionId: sessions[1]!.id,
      reason: "Giáo viên nghỉ ốm",
      actorId: "tester",
      actorName: "Tester",
    });
    expect(r.ok).toBe(true);
    expect(r.makeupSessionId).toBeTruthy();

    // Buổi gốc bị CANCELLED, KHÔNG bị xoá.
    const original = await db.classSession.findUnique({ where: { id: sessions[1]!.id }, select: { status: true } });
    expect(original!.status).toBe("CANCELLED");

    // Buổi bù mới: SCHEDULED, nối SAU buổi muộn nhất (14 ngày) → +7 ngày = ngày 21.
    const makeup = await db.classSession.findUnique({
      where: { id: r.makeupSessionId! },
      select: { status: true, date: true },
    });
    expect(makeup!.status).toBe("SCHEDULED");
    const latest = new Date(d0.getTime() + 14 * 86_400_000);
    expect(makeup!.date.getTime()).toBe(latest.getTime() + 7 * 86_400_000);

    // Tổng buổi non-cancelled vẫn = 3 (giữ tổng số buổi): 2 cũ + 1 bù.
    expect(await db.classSession.count({ where: { classId: cls.id, status: { not: "CANCELLED" } } })).toBe(3);
  });

  test("[R7-06-05] cancelSession chặn: buổi COMPLETED + thiếu reason", async () => {
    const course = await db.course.create({ data: { name: "Khoá snap-4", slug: "snap-4" } });
    const cls = await db.class.create({ data: { name: "Lớp A4", courseId: course.id }, select: { id: true } });
    const done = await db.classSession.create({
      data: { classId: cls.id, date: new Date("2026-07-01"), status: "COMPLETED" },
      select: { id: true },
    });
    const sched = await db.classSession.create({
      data: { classId: cls.id, date: new Date("2026-07-08"), status: "SCHEDULED" },
      select: { id: true },
    });
    expect((await cancelSession({ sessionId: done.id, reason: "x", actorId: null, actorName: "T" })).ok).toBe(false);
    expect((await cancelSession({ sessionId: sched.id, reason: "  ", actorId: null, actorName: "T" })).ok).toBe(false);
  });

  test("[R7-06-06] buildMakeupDate (pure): nối +7 ngày sau buổi muộn nhất", () => {
    const base = new Date("2026-07-01T00:00:00Z");
    const d = buildMakeupDate([new Date("2026-07-08T00:00:00Z"), new Date("2026-07-15T00:00:00Z")], base);
    expect(d.getTime()).toBe(new Date("2026-07-22T00:00:00Z").getTime());
  });
});
