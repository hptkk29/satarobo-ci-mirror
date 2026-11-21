/**
 * FL1-03 — Ngân hàng câu hỏi đủ trường + lọc theo khung CT + import template.
 * Phác AC theo BA #07 US-LMS-2. Postgres LOCAL (.env.test). KHÔNG chạy CI nhánh này.
 *
 * AC bao phủ:
 *  - AC1: Tạo câu hỏi gắn khung CT (curriculumId), điểm (points), thời gian
 *         (timeLimitSec), loại, độ khó, nội dung, đáp án + đánh dấu đúng,
 *         ảnh đề (imageUrl), ảnh đáp án (choice.imageUrl), giải thích.
 *  - AC2: Lọc theo khung CT — câu hỏi Sata 4 không lẫn câu Sata 3.
 *  - AC3: Import template chuẩn (courseSlug/curriculumVersion/points/timeLimitSec);
 *         validate theo loại; nút "Thêm bằng template" + link tải template.
 *  - AC4: CRUD đầy đủ theo quyền author/admin (TRAINING/SUPER_ADMIN); TEACHER chỉ xem.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { buildQuestionWhere } from "../../../lib/questions/filter";

async function seedTwoCurricula() {
  const course = await db.course.create({
    data: { name: "Lập trình Robot", slug: "ltr-fl103", code: "LTR", isActive: true },
  });
  const sata3 = await db.curriculum.create({
    data: { courseId: course.id, version: 3, name: "Sata 3", isActive: true },
  });
  const sata4 = await db.curriculum.create({
    data: { courseId: course.id, version: 4, name: "Sata 4", isActive: true },
  });
  return { course, sata3, sata4 };
}

test.describe("[FL1-03] Question bank", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[FL1-03-01] AC1 — tạo câu hỏi đủ trường mới (curriculum/points/time/ảnh)", async () => {
    const { course, sata4 } = await seedTwoCurricula();
    const q = await db.question.create({
      data: {
        type: "MULTIPLE_CHOICE",
        text: "Robot di chuyển hướng nào?",
        difficulty: "EASY",
        curriculumId: sata4.id,
        courseId: course.id,
        points: 1.5,
        timeLimitSec: 60,
        imageUrl: "https://r2/q.png",
        explanation: "Giải thích...",
        choices: {
          create: [
            { order: 1, text: "Tiến", isCorrect: true, imageUrl: "https://r2/a.png" },
            { order: 2, text: "Bay", isCorrect: false },
          ],
        },
      },
      include: { choices: true },
    });
    expect(q.curriculumId).toBe(sata4.id);
    expect(q.courseId).toBe(course.id);
    expect(q.points).toBe(1.5);
    expect(q.timeLimitSec).toBe(60);
    expect(q.imageUrl).toBe("https://r2/q.png");
    expect(q.choices.find((c) => c.order === 1)?.imageUrl).toBe("https://r2/a.png");
  });

  test("[FL1-03-02] AC2 — lọc theo khung CT chỉ trả câu của khung đó", async () => {
    const { sata3, sata4 } = await seedTwoCurricula();
    await db.question.create({
      data: { type: "ESSAY", text: "Q Sata3", difficulty: "EASY", curriculumId: sata3.id },
    });
    await db.question.create({
      data: { type: "ESSAY", text: "Q Sata4", difficulty: "EASY", curriculumId: sata4.id },
    });

    const onlySata4 = await db.question.findMany({
      where: buildQuestionWhere({ curriculumId: sata4.id }),
    });
    expect(onlySata4).toHaveLength(1);
    expect(onlySata4[0]?.text).toBe("Q Sata4");
  });

  // fixme: cần auth fixture (login TRAINING/SUPER_ADMIN) + webserver — chưa dựng.
  test.fixme("[FL1-03-03] AC3 — link tải template + nút 'Thêm bằng template'", async ({ page }) => {
    // Login as TRAINING/SUPER_ADMIN qua helper auth (tuỳ harness).
    await page.goto("/admin/questions");
    await expect(page.getByRole("link", { name: /Thêm bằng template/i })).toBeVisible();
    await page.goto("/admin/questions/import");
    await expect(page.getByRole("link", { name: /Tải Template/i })).toBeVisible();
  });

  // fixme: cần auth fixture (login TEACHER) + webserver — chưa dựng.
  test.fixme("[FL1-03-04] AC4 — TEACHER bị redirect khỏi /questions/new (chỉ xem)", async ({
    page,
  }) => {
    // Đăng nhập TEACHER rồi mở trang tạo → redirect mềm về dashboard.
    await page.goto("/admin/questions/new");
    await expect(page).not.toHaveURL(/\/questions\/new$/);
  });
});
