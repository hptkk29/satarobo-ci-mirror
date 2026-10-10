/**
 * R6-B3 (CourseCategoryDef) — R6-B2 gỡ ở L5 chấm công v3. Postgres LOCAL (.env.test).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import {
  createCategory,
  deleteCategory,
  backfillCourseCategories,
} from "../../../lib/courses/category-service";

// [R6-B2] WorkShift config — GỠ ở L5 chấm công v3 (06/09/2026): lib/attendance/shift-config.ts
// (WorkShiftConfig cũ) đã đóng băng; danh mục ca nay là ShiftTemplate (tests/cham-cong/*).

test.describe("[R6-B3] CourseCategory model", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R6-B3-T1-01] thêm danh mục → tạo course thuộc danh mục", async () => {
    const cat = await createCategory({ code: "STEM_NEW", name: "STEM mới" });
    const course = await db.course.create({ data: { name: "Khoá STEM", slug: "khoa-stem-b3", categoryId: cat.id } });
    const withCat = await db.course.findUnique({ where: { id: course.id }, include: { categoryDef: true } });
    expect(withCat!.categoryDef!.name).toBe("STEM mới");
  });

  test("[R6-B3-T7-01] danh mục có course → không xoá", async () => {
    const cat = await createCategory({ code: "HAS_COURSE", name: "Có khoá" });
    await db.course.create({ data: { name: "K1", slug: "k1-b3", categoryId: cat.id } });
    const res = await deleteCategory(cat.id);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("đang có khoá");
  });

  test("[R6-B3-T12-01] backfill enum → categoryId", async () => {
    await createCategory({ code: "LAP_TRINH_ROBOT", name: "Lập trình Robot" });
    const c = await db.course.create({ data: { name: "LTR", slug: "ltr-b3", category: "LAP_TRINH_ROBOT" } });
    const n = await backfillCourseCategories();
    expect(n).toBe(1);
    const after = await db.course.findUnique({ where: { id: c.id }, select: { categoryId: true } });
    expect(after!.categoryId).not.toBeNull();
    // chạy lại idempotent → 0.
    expect(await backfillCourseCategories()).toBe(0);
  });
});
