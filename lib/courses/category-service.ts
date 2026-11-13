// lib/courses/category-service.ts — R6-B3: CourseCategory dạng MODEL (danh mục).
// 2-phase: enum CourseCategory + Course.category giữ; thêm danh mục = thêm row CourseCategoryDef.
import { db } from "@/lib/db";

export class CategoryError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CategoryError";
  }
}

/** Tạo danh mục mới (thêm danh mục không cần sửa code). (T1) */
export async function createCategory(params: {
  code: string;
  name: string;
  slug?: string;
  displayOrder?: number;
}): Promise<{ id: string }> {
  return db.courseCategoryDef.create({
    data: {
      code: params.code,
      name: params.name,
      slug: params.slug ?? null,
      displayOrder: params.displayOrder ?? 0,
    },
    select: { id: true },
  });
}

/** T7 — danh mục có khoá tham chiếu → KHÔNG xoá. */
export async function deleteCategory(id: string): Promise<{ ok: boolean; error?: string }> {
  const used = await db.course.count({ where: { categoryId: id } });
  if (used > 0) return { ok: false, error: "Danh mục đang có khoá học — không thể xoá" };
  await db.courseCategoryDef.delete({ where: { id } });
  return { ok: true };
}

/**
 * T12 — backfill: Course có enum `category` → set `categoryId` trỏ CourseCategoryDef cùng code.
 * Idempotent: chỉ set khi categoryId còn null. Trả số khoá đã gán.
 */
export async function backfillCourseCategories(): Promise<number> {
  const cats = await db.courseCategoryDef.findMany({ select: { id: true, code: true } });
  const byCode = new Map(cats.map((c) => [c.code, c.id]));
  const courses = await db.course.findMany({
    where: { category: { not: null }, categoryId: null },
    select: { id: true, category: true },
  });
  let n = 0;
  for (const c of courses) {
    const catId = c.category ? byCode.get(c.category) : undefined;
    if (catId) {
      await db.course.update({ where: { id: c.id }, data: { categoryId: catId } });
      n += 1;
    }
  }
  return n;
}
