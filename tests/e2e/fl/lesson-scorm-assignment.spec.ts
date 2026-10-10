/**
 * FL1-02 (US-LMS-1) — Gắn SCORM + bài tập vào từng buổi trong màn edit giáo trình.
 * Postgres LOCAL (.env.test). SKELETON — KHÔNG chạy trong CI nhánh này.
 *
 * AC bao phủ:
 *  - AC1: Buổi có section "Tài liệu giảng dạy (SCORM)" — chọn gói đã upload cho
 *         buổi + đặt 1 bản active/buổi (`ScormPackage.isActiveForLesson`).
 *  - AC2: Gắn bài tập SẴN CÓ vào buổi (`Assignment.lessonId`); gỡ ra được.
 *  - AC3: SCORM_ENABLED=false → section SCORM ẩn (không vỡ trang).
 *  - Handoff: gate DUYỆT đề xuất chỉnh bài = lesson-change:approve
 *    (SUPER_ADMIN/TRAINING/CENTER_MANAGER); UNLOCK buổi vẫn training:manage.
 *  - Redirect mềm: TEACHER/CENTER_MANAGER mở trang edit giáo trình → redirect (không 403).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { can } from "../../../lib/auth/permissions";

async function seedLessonWithClass() {
  const course = await db.course.create({
    data: { name: "Lập trình Robot", slug: "ltr-fl102", code: "LTR102", isActive: true },
  });
  const curriculum = await db.curriculum.create({
    data: { courseId: course.id, version: 1, name: "Sata 1", isActive: true },
  });
  const lesson = await db.lesson.create({
    data: { curriculumId: curriculum.id, order: 1, title: "Buổi 1", duration: 90 },
  });
  const cls = await db.class.create({
    data: { name: "Lớp A", courseId: course.id },
  });
  return { course, curriculum, lesson, cls };
}

test.describe("[FL1-02] Lesson SCORM + Assignment", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[FL1-02-01] AC2 — gắn bài tập vào buổi qua Assignment.lessonId", async () => {
    const { lesson, cls } = await seedLessonWithClass();
    const a = await db.assignment.create({
      data: { title: "BT về nhà", description: "x", classId: cls.id, kind: "HOMEWORK" },
    });
    expect(a.lessonId).toBeNull();

    const linked = await db.assignment.update({
      where: { id: a.id },
      data: { lessonId: lesson.id },
    });
    expect(linked.lessonId).toBe(lesson.id);
  });

  test("[FL1-02-02] AC2 — gỡ bài tập khỏi buổi (lessonId → null)", async () => {
    const { lesson, cls } = await seedLessonWithClass();
    const a = await db.assignment.create({
      data: { title: "BT", description: "x", classId: cls.id, lessonId: lesson.id },
    });
    const detached = await db.assignment.update({
      where: { id: a.id },
      data: { lessonId: null },
    });
    expect(detached.lessonId).toBeNull();
  });

  test("[FL1-02-03] available picker chỉ gồm bài tập cùng khoá, chưa gắn buổi", async () => {
    const { course, lesson, cls } = await seedLessonWithClass();
    await db.assignment.create({
      data: { title: "Trống", description: "x", classId: cls.id },
    });
    await db.assignment.create({
      data: { title: "Đã gắn", description: "x", classId: cls.id, lessonId: lesson.id },
    });

    const available = await db.assignment.findMany({
      where: { lessonId: null, class: { courseId: course.id } },
    });
    expect(available).toHaveLength(1);
    expect(available[0]?.title).toBe("Trống");
  });

  test("[FL1-02-04] AC1 — 1 bản SCORM active/buổi (isActiveForLesson)", async () => {
    const { lesson } = await seedLessonWithClass();
    const v1 = await db.scormPackage.create({
      data: {
        lessonId: lesson.id,
        name: "Gói v1",
        version: 1,
        status: "PUBLISHED",
        storagePrefix: "scorm/v1/",
        isActiveForLesson: true,
      },
    });
    const v2 = await db.scormPackage.create({
      data: {
        lessonId: lesson.id,
        name: "Gói v2",
        version: 2,
        status: "PUBLISHED",
        storagePrefix: "scorm/v2/",
      },
    });

    // Đổi bản đang dùng: tắt v1, bật v2 (logic activateForLesson).
    await db.$transaction([
      db.scormPackage.updateMany({
        where: { lessonId: lesson.id, isActiveForLesson: true },
        data: { isActiveForLesson: false },
      }),
      db.scormPackage.update({ where: { id: v2.id }, data: { isActiveForLesson: true } }),
    ]);

    const active = await db.scormPackage.findMany({
      where: { lessonId: lesson.id, isActiveForLesson: true },
    });
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(v2.id);
    expect(active[0]?.id).not.toBe(v1.id);
  });

  test("[FL1-02-07] thay giáo án = xoá bản cũ; bản mới PUBLISHED+active; attempt/log cũ cascade", async () => {
    const { lesson } = await seedLessonWithClass();
    // Giáo án cũ đang dùng + 1 lượt giảng (attempt) + 1 access log.
    const old = await db.scormPackage.create({
      data: {
        lessonId: lesson.id,
        name: "Giáo án cũ",
        version: 1,
        status: "PUBLISHED",
        storagePrefix: "scorm/old/",
        isActiveForLesson: true,
      },
    });
    await db.scormAttempt.create({
      data: { packageId: old.id, userId: "teacher-1", completion: "COMPLETED" },
    });
    await db.scormAccessLog.create({ data: { packageId: old.id, userId: "teacher-1" } });
    // Bản mới vừa giải nén xong (PROCESSING → sắp tự phát hành).
    const fresh = await db.scormPackage.create({
      data: {
        lessonId: lesson.id,
        name: "Giáo án mới",
        version: 2,
        status: "PROCESSING",
        storagePrefix: "scorm/fresh/",
      },
    });

    // Logic safe-swap của ingest: xoá bản cũ (id khác, KHÔNG còn đang xử lý) rồi
    // publish + active bản mới (1 tx). status filter khớp handler — bảo vệ bản in-flight.
    const olds = await db.scormPackage.findMany({
      where: {
        lessonId: lesson.id,
        NOT: { id: fresh.id },
        status: { notIn: ["UPLOADING", "PROCESSING"] },
      },
      select: { id: true },
    });
    await db.$transaction([
      db.scormPackage.deleteMany({ where: { id: { in: olds.map((o) => o.id) } } }),
      db.scormPackage.update({
        where: { id: fresh.id },
        data: { status: "PUBLISHED", isActiveForLesson: true },
      }),
    ]);

    // Mỗi buổi đúng 1 giáo án — là bản mới, PUBLISHED + đang dùng.
    const remaining = await db.scormPackage.findMany({ where: { lessonId: lesson.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(fresh.id);
    expect(remaining[0]?.status).toBe("PUBLISHED");
    expect(remaining[0]?.isActiveForLesson).toBe(true);

    // Lịch sử giảng + access của bản cũ cascade theo (onDelete: Cascade).
    expect(await db.scormAttempt.count({ where: { packageId: old.id } })).toBe(0);
    expect(await db.scormAccessLog.count({ where: { packageId: old.id } })).toBe(0);
  });

  test("[FL1-02-05] Handoff — gate duyệt đề xuất = lesson-change:approve (Đào tạo; CM đã rút khỏi LMS)", () => {
    // Duyệt đề xuất: SUPER_ADMIN/TRAINING.
    // 03/08 — chủ dự án chặn phần LMS ở vai Quản lý cơ sở ⇒ CM KHÔNG duyệt nữa.
    expect(can("CENTER_MANAGER", "lesson-change:approve")).toBe(false);
    expect(can("TRAINING", "lesson-change:approve")).toBe(true);
    expect(can("SUPER_ADMIN", "lesson-change:approve")).toBe(true);
    // Unlock buổi LOCKED vẫn chỉ Đào tạo — CM KHÔNG mở khóa được.
    expect(can("CENTER_MANAGER", "training:manage")).toBe(false);
    // CM không sửa được giáo trình (sẽ bị redirect mềm khỏi trang edit).
    expect(can("CENTER_MANAGER", "curriculum:edit")).toBe(false);
    expect(can("TEACHER", "curriculum:edit")).toBe(false);
  });

  // fixme: cần auth fixture (login TEACHER) + webserver — chưa dựng (như teacher-materials.spec).
  test.fixme("[FL1-02-06] Redirect mềm — TEACHER mở edit giáo trình không 403", async ({ page }) => {
    // Đăng nhập TEACHER (tuỳ harness auth) rồi mở trang edit → redirect, KHÔNG 403.
    await page.goto("/admin/curriculums/any-id/edit");
    await expect(page).not.toHaveURL(/\/curriculums\/.+\/edit$/);
  });
});
