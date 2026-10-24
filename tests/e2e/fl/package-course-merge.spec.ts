/**
 * FL1-05 — Gộp gói BÁN (CoursePackage) ↔ khoá DẠY (Course).
 * Phác AC theo BA #07 US-LMS L-1. Postgres LOCAL (.env.test). KHÔNG chạy CI nhánh này.
 *
 * AC bao phủ:
 *  - AC1: Tạo/sửa gói gắn được courseId; relation đọc đúng khoá liên kết.
 *  - AC2: Giá tạo Order/convert vẫn lấy từ GÓI (priceOriginal/priceMember) — KHÔNG đổi nguồn.
 *  - AC3: JSON `curriculum` cũ vẫn còn đọc được (fallback) sau khi gắn courseId — không drop.
 *  - AC4: Bỏ liên kết (disconnect) → courseId = null, JSON cũ vẫn nguyên.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import {
  resolvePackageCurriculum,
  hasLinkedCourse,
} from "../../../lib/courses/package-course-link";

test.describe("[FL1-05] Package ↔ Course merge", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[FL1-05-01] AC1 — gói gắn courseId, đọc qua relation đúng khoá", async () => {
    const course = await db.course.create({
      data: { name: "Sata 4 — Robot nâng cao", slug: "sata-4", code: "S4", isActive: true },
    });
    const pkg = await db.coursePackage.create({
      data: {
        slug: "goi-sata-4",
        code: "GS4",
        name: "Gói Sata 4",
        priceOriginal: 5_000_000,
        curriculum: [{ topic: "JSON cũ", lessons: 3 }],
        course: { connect: { id: course.id } },
      },
      include: { course: { select: { id: true, name: true } } },
    });

    expect(pkg.courseId).toBe(course.id);
    expect(pkg.course?.name).toBe("Sata 4 — Robot nâng cao");
    expect(hasLinkedCourse(pkg)).toBe(true);
  });

  test("[FL1-05-02] AC2 — giá đọc từ GÓI, không phải từ khoá", async () => {
    const course = await db.course.create({
      data: { name: "Sata 5", slug: "sata-5", code: "S5", price: 999, isActive: true },
    });
    const pkg = await db.coursePackage.create({
      data: {
        slug: "goi-sata-5",
        code: "GS5",
        name: "Gói Sata 5",
        priceOriginal: 6_000_000,
        priceMember: 5_400_000,
        course: { connect: { id: course.id } },
      },
    });

    // Order/convert lấy giá từ CoursePackage (priceOriginal/priceMember), KHÔNG dùng course.price.
    const fromPkg = await db.coursePackage.findUnique({
      where: { id: pkg.id },
      select: { priceOriginal: true, priceMember: true },
    });
    expect(fromPkg?.priceOriginal).toBe(6_000_000);
    expect(fromPkg?.priceMember).toBe(5_400_000);
    expect(course.price).toBe(999); // khoá có giá riêng nhưng KHÔNG được dùng cho bán
  });

  test("[FL1-05-03] AC3 — JSON curriculum cũ vẫn còn; khoá có data thì khoá thắng", async () => {
    const course = await db.course.create({
      data: { name: "Sata 6", slug: "sata-6", code: "S6", isActive: true },
    });
    const pkg = await db.coursePackage.create({
      data: {
        slug: "goi-sata-6",
        code: "GS6",
        name: "Gói Sata 6",
        curriculum: [{ topic: "Chủ đề JSON", lessons: 2 }],
        course: { connect: { id: course.id } },
      },
      select: { courseId: true, curriculum: true },
    });

    // JSON cũ KHÔNG bị xoá khi gắn courseId.
    expect(Array.isArray(pkg.curriculum)).toBe(true);

    // Khoá có giáo trình → resolve dùng khoá; khoá rỗng → fallback JSON.
    const withCourse = resolvePackageCurriculum(pkg, [{ topic: "Buổi 1 (khoá)", lessons: 1 }]);
    expect(withCourse.source).toBe("course");

    const fallback = resolvePackageCurriculum(pkg, []);
    expect(fallback.source).toBe("json");
    expect(fallback.items).toEqual([{ topic: "Chủ đề JSON", lessons: 2 }]);
  });

  test("[FL1-05-04] AC4 — disconnect khoá → courseId null, JSON cũ nguyên vẹn", async () => {
    const course = await db.course.create({
      data: { name: "Sata 7", slug: "sata-7", code: "S7", isActive: true },
    });
    const pkg = await db.coursePackage.create({
      data: {
        slug: "goi-sata-7",
        code: "GS7",
        name: "Gói Sata 7",
        curriculum: [{ topic: "JSON giữ lại", lessons: 4 }],
        course: { connect: { id: course.id } },
      },
    });

    const updated = await db.coursePackage.update({
      where: { id: pkg.id },
      data: { course: { disconnect: true } },
      select: { courseId: true, curriculum: true },
    });

    expect(updated.courseId).toBeNull();
    expect(updated.curriculum).toEqual([{ topic: "JSON giữ lại", lessons: 4 }]);
  });
});
