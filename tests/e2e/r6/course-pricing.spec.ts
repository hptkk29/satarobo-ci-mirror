/**
 * R6-B4 — Giá khóa/gói đọc từ DB + audit đổi giá. Postgres LOCAL (.env.test).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import {
  resolveCoursePrice,
  diffPriceFields,
  auditPackagePriceChange,
  getPackagePrice,
} from "../../../lib/courses/pricing";

test.describe("[R6-B4] Course pricing từ DB", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R6-B4-T1-01] resolveCoursePrice: DB có giá → thắng hardcode", () => {
    const r = resolveCoursePrice(
      { priceOriginal: 5_000_000, priceEarlyBird: 4_000_000 },
      { listPrice: 9_999_999, earlyBirdPrice: 8_888_888 },
    );
    expect(r.listPrice).toBe(5_000_000);
    expect(r.earlyBirdPrice).toBe(4_000_000);
  });

  test("[R6-B4-T1-02] resolveCoursePrice: DB null → fallback hardcode", () => {
    const r = resolveCoursePrice(null, { listPrice: 9_999_999, earlyBirdPrice: 8_888_888 });
    expect(r.listPrice).toBe(9_999_999);
    expect(r.earlyBirdPrice).toBe(8_888_888);
  });

  test("[R6-B4-T1-03] public đọc giá DB: getPackagePrice trả giá đã lưu", async () => {
    const pkg = await db.coursePackage.create({
      data: { slug: "sata-1-b4", code: "SATA1", name: "Sata 1", priceOriginal: 6_000_000, priceEarlyBird: 5_400_000 },
    });
    const price = await getPackagePrice(pkg.id);
    expect(price!.priceOriginal).toBe(6_000_000);
    expect(price!.priceEarlyBird).toBe(5_400_000);
  });

  test("[R6-B4-T9-01] auditPackagePriceChange: đổi giá → ghi AuditLog PRICE_CHANGE", async () => {
    const pkg = await db.coursePackage.create({
      data: { slug: "sata-2-b4", code: "SATA2", name: "Sata 2", priceOriginal: 6_000_000 },
    });
    const wrote = await auditPackagePriceChange(
      { id: "admin-1", name: "Admin" },
      {
        packageId: pkg.id,
        oldPrice: { priceOriginal: 6_000_000, priceEarlyBird: null, priceMember: null },
        newPrice: { priceOriginal: 5_500_000, priceEarlyBird: null, priceMember: null },
        reason: "khuyến mãi hè",
      },
    );
    expect(wrote).toBe(true);
    const log = await db.auditLog.findFirst({
      where: { module: "course-package", entityType: "CoursePackage", entityId: pkg.id },
    });
    expect(log).not.toBeNull();
    expect(log!.action).toBe("PRICE_CHANGE");
    expect((log!.newValues as { priceOriginal?: number }).priceOriginal).toBe(5_500_000);
    expect(log!.reason).toBe("khuyến mãi hè");
  });

  test("[R6-B4-T9-02] giá KHÔNG đổi → không ghi audit", async () => {
    const same = { priceOriginal: 6_000_000, priceEarlyBird: null, priceMember: null };
    expect(diffPriceFields(same, same)).toHaveLength(0);
    const wrote = await auditPackagePriceChange(
      { id: "admin-1", name: "Admin" },
      { packageId: "px", oldPrice: same, newPrice: same },
    );
    expect(wrote).toBe(false);
  });
});
