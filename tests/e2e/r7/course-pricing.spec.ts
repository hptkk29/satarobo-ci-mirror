/**
 * R7-03 — computeEnrollmentPrice + CourseDiscount CRUD (gate courses:edit).
 * Postgres LOCAL (.env.test).
 *
 * - computeEnrollmentPrice: thuần (pure) + tích hợp đọc CourseDiscount THẬT từ DB.
 * - CRUD CourseDiscount: model tồn tại (migration applied); quyền sửa giá khoá =
 *   courses:edit — 24/07 khoá chỉnh chương trình: CHỈ SUPER_ADMIN + TRAINING.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { computeEnrollmentPrice } from "../../../lib/finance/pricing";
import { can } from "../../../lib/auth/permissions";

test.describe("[R7-03] Pricing + CourseDiscount", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R7-03-01] computeEnrollmentPrice: không discount → finalPrice = listPrice", () => {
    const r = computeEnrollmentPrice({ listPrice: 5_000_000, discount: null });
    expect(r).toEqual({ listPrice: 5_000_000, discountType: null, discountAmount: 0, finalPrice: 5_000_000 });
  });

  test("[R7-03-02] AMOUNT: trừ thẳng VND; PERCENT/SCHOLARSHIP: trừ theo %", () => {
    expect(computeEnrollmentPrice({ listPrice: 5_000_000, discount: { type: "AMOUNT", value: 1_000_000 } }))
      .toMatchObject({ discountAmount: 1_000_000, finalPrice: 4_000_000 });
    expect(computeEnrollmentPrice({ listPrice: 5_000_000, discount: { type: "PERCENT", value: 20 } }))
      .toMatchObject({ discountAmount: 1_000_000, finalPrice: 4_000_000 });
    expect(computeEnrollmentPrice({ listPrice: 5_000_000, discount: { type: "SCHOLARSHIP", value: 50 } }))
      .toMatchObject({ discountAmount: 2_500_000, finalPrice: 2_500_000 });
  });

  test("[R7-03-03] discountAmount KHÔNG vượt listPrice (clamp) → finalPrice ≥ 0", () => {
    const r = computeEnrollmentPrice({ listPrice: 3_000_000, discount: { type: "AMOUNT", value: 9_999_999 } });
    expect(r.discountAmount).toBe(3_000_000);
    expect(r.finalPrice).toBe(0);
    const pct = computeEnrollmentPrice({ listPrice: 3_000_000, discount: { type: "PERCENT", value: 150 } });
    expect(pct.finalPrice).toBe(0); // % bị clamp về 100
  });

  test("[R7-03-04] tích hợp: đọc CourseDiscount THẬT từ DB → tính finalPrice", async () => {
    const course = await db.course.create({
      data: { name: "Sata 3", slug: "sata-3-r7", price: 6_000_000 },
    });
    const disc = await db.courseDiscount.create({
      data: { courseId: course.id, type: "PERCENT", value: 25, active: true, note: "Early bird" },
    });
    const fromDb = await db.courseDiscount.findUnique({ where: { id: disc.id }, select: { type: true, value: true } });
    const r = computeEnrollmentPrice({ listPrice: course.price ?? 0, discount: fromDb });
    expect(r.discountAmount).toBe(1_500_000);
    expect(r.finalPrice).toBe(4_500_000);
  });

  test("[R7-03-05] CourseDiscount CRUD: create / update / delete chạy được trên DB", async () => {
    const course = await db.course.create({ data: { name: "Sata 4", slug: "sata-4-r7", price: 7_000_000 } });
    const d = await db.courseDiscount.create({ data: { courseId: course.id, type: "AMOUNT", value: 500_000 } });
    expect(d.active).toBe(true); // default
    const upd = await db.courseDiscount.update({ where: { id: d.id }, data: { value: 800_000, active: false } });
    expect(upd.value).toBe(800_000);
    expect(upd.active).toBe(false);
    await db.courseDiscount.delete({ where: { id: d.id } });
    expect(await db.courseDiscount.findUnique({ where: { id: d.id } })).toBeNull();
  });

  test("[R7-03-06] quyền courses:edit: chỉ SUPER_ADMIN + TRAINING (Đào tạo) — 24/07 khoá chỉnh chương trình", () => {
    expect(can("SUPER_ADMIN", "courses:edit")).toBe(true);
    expect(can("TRAINING", "courses:edit")).toBe(true);
    // 24/07 (user chốt): gỡ chỉnh chương trình khỏi QL cơ sở + Marketing.
    expect(can("CENTER_MANAGER", "courses:edit")).toBe(false);
    expect(can("MARKETING", "courses:edit")).toBe(false);
    expect(can("SALES_CSM", "courses:edit")).toBe(false);
    expect(can("TEACHER", "courses:edit")).toBe(false);
  });
});
