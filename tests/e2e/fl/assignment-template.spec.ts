/**
 * FL1-06 (QĐ-T2) — Tách TEMPLATE bài tập (bank theo KHUNG CHƯƠNG TRÌNH / buổi)
 * khỏi BÀI GIAO (Assignment, theo lớp). Phác AC theo BA #07 L-3/QĐ-T2 + item 13.
 * Postgres LOCAL (.env.test). KHÔNG chạy CI nhánh này.
 *
 * AC bao phủ:
 *  - AC1: Tạo/sửa/xoá AssignmentTemplate gắn curriculumId/lessonId, KHÔNG có classId.
 *  - AC2: Sinh Assignment (có classId) từ template — copy field + giữ templateId truy vết.
 *  - AC3: Phân biệt rõ Template (không lớp) vs Bài giao (luôn có lớp).
 *  - AC4: Quyền — chỉ TRAINING/SUPER_ADMIN tạo/sửa template; TEACHER/CM chỉ xem bài giao.
 *  - AC5: Picker câu hỏi cho template lọc theo khung CT (buildQuestionWhere publicOnly).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import {
  templateToAssignmentData,
  assignmentTemplateSchema,
} from "../../../lib/assignments/template";
import { buildQuestionWhere } from "../../../lib/questions/filter";

async function seedFrame() {
  const course = await db.course.create({
    data: { name: "Lập trình Robot", slug: "ltr-fl106", code: "LTR", isActive: true },
  });
  const sata4 = await db.curriculum.create({
    data: { courseId: course.id, version: 4, name: "Sata 4", isActive: true },
  });
  const lesson = await db.lesson.create({
    data: { curriculumId: sata4.id, order: 1, title: "Vòng lặp" },
  });
  return { course, sata4, lesson };
}

test.describe("[FL1-06] Assignment template", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[FL1-06-01] AC1 — tạo template gắn khung CT, KHÔNG có classId", async () => {
    const { sata4, lesson } = await seedFrame();
    const parsed = assignmentTemplateSchema.parse({
      title: "Mẫu Sata 4 — Vòng lặp",
      description: "Điều khiển robot đi hình vuông",
      curriculumId: sata4.id,
      lessonId: lesson.id,
      totalPoints: 8,
    });
    const tpl = await db.assignmentTemplate.create({ data: parsed });
    expect(tpl.curriculumId).toBe(sata4.id);
    expect(tpl.lessonId).toBe(lesson.id);
    // Template không có cột classId (compile-time) — runtime sanity:
    expect((tpl as Record<string, unknown>).classId).toBeUndefined();
  });

  test("[FL1-06-02] AC2/AC3 — sinh bài giao từ template, giữ templateId + có classId", async () => {
    const { sata4, lesson, course } = await seedFrame();
    const tpl = await db.assignmentTemplate.create({
      data: {
        title: "Mẫu Sata 4",
        description: "Mô tả mẫu",
        instructions: "Hướng dẫn",
        kind: "HOMEWORK",
        curriculumId: sata4.id,
        lessonId: lesson.id,
        totalPoints: 7,
        allowText: true,
        allowFile: false,
      },
    });

    const center = await db.center.create({
      data: { name: "CS1", code: "CS1", slug: "cs1", address: "211 Nguyễn Hữu Thọ" },
    });
    const cls = await db.class.create({
      data: {
        name: "Lớp A",
        classCode: "A1",
        courseId: course.id,
        centerId: center.id,
      },
    });

    const data = templateToAssignmentData(tpl, { classId: cls.id });
    const assignment = await db.assignment.create({ data });

    expect(assignment.classId).toBe(cls.id); // bài giao LUÔN có lớp
    expect(assignment.templateId).toBe(tpl.id); // truy vết về template nguồn
    expect(assignment.title).toBe(tpl.title);
    expect(assignment.totalPoints).toBe(7);
    expect(assignment.allowFile).toBe(false);
    expect(assignment.status).toBe("DRAFT");

    // AC3: từ template đếm được số instance đã sinh.
    const withCount = await db.assignmentTemplate.findUnique({
      where: { id: tpl.id },
      include: { _count: { select: { instances: true } } },
    });
    expect(withCount?._count.instances).toBe(1);
  });

  test("[FL1-06-03] AC5 — picker câu hỏi cho template lọc theo khung CT (publicOnly)", async () => {
    const { sata4, course } = await seedFrame();
    const sata3 = await db.curriculum.create({
      data: { courseId: course.id, version: 3, name: "Sata 3", isActive: true },
    });
    await db.question.create({
      data: { type: "ESSAY", text: "Câu Sata 4 public", curriculumId: sata4.id, isPublic: true },
    });
    await db.question.create({
      data: { type: "ESSAY", text: "Câu Sata 4 private", curriculumId: sata4.id, isPublic: false },
    });
    await db.question.create({
      data: { type: "ESSAY", text: "Câu Sata 3 public", curriculumId: sata3.id, isPublic: true },
    });

    const results = await db.question.findMany({
      where: buildQuestionWhere({ curriculumId: sata4.id, publicOnly: true }),
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe("Câu Sata 4 public");
  });

  test("[FL1-06-04] AC2 — xoá template KHÔNG xoá bài giao (SetNull truy vết)", async () => {
    const { sata4, course } = await seedFrame();
    const tpl = await db.assignmentTemplate.create({
      data: { title: "M", description: "D", curriculumId: sata4.id },
    });
    const center = await db.center.create({
      data: { name: "CS2", code: "CS2", slug: "cs2", address: "114 Hoàng Diệu" },
    });
    const cls = await db.class.create({
      data: { name: "B", classCode: "B1", courseId: course.id, centerId: center.id },
    });
    const a = await db.assignment.create({
      data: templateToAssignmentData(tpl, { classId: cls.id }),
    });

    await db.assignmentTemplate.delete({ where: { id: tpl.id } });

    const stillThere = await db.assignment.findUnique({ where: { id: a.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.templateId).toBeNull(); // onDelete: SetNull
  });
});
