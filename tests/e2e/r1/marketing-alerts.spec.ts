/**
 * R1-12 C12.2 (submit report) + R1-09 C9.5 / R1-12 C12.3 (alert trễ). PG LOCAL.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../../e2e/_helpers/seed";
import { testEmail } from "../../e2e/_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { submitReport, previousMonthKey } from "../../../lib/crm/marketing-report";
import { runMarketingAlerts } from "../../../lib/crm/marketing-alerts";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };
// KHÔNG hardcode mốc "now": getSuperAdminUserIds lọc effectiveFrom ≤ now, mà seed
// gán UserOrgRole với effectiveFrom = thời điểm CHẠY test → mốc cố định trong quá
// khứ ("2026-07-10") loại role vừa seed → 0 alert (bom hẹn giờ, nổ 11/07/2026).
// → Lấy ngày 10 / ngày 03 của THÁNG SAU thời điểm chạy: luôn ≥ effectiveFrom và
// vẫn đúng phía sau/trước deadline ngày 05.
const NOW = new Date();
const AFTER_DEADLINE = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 1, 10));
const BEFORE_DEADLINE = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 1, 3));
// Kỳ bị soi = tháng liền trước AFTER_DEADLINE (thay cho "2026-06" cứng).
const PREV_PERIOD = previousMonthKey(AFTER_DEADLINE);

async function seedSuperAdmin() {
  const u = await seedUser({ email: testEmail("sa-alert"), role: "SUPER_ADMIN" });
  const roleId = (await db.roleDef.findUnique({ where: { code: "SUPER_ADMIN" }, select: { id: true } }))!.id;
  const orgId = (await db.orgUnit.findUnique({ where: { code: "HO" }, select: { id: true } }))!.id;
  await assignUserOrgRole(SA, { userId: u.id, orgUnitId: orgId, roleId, reason: "seed" });
  return u;
}

test.describe("[R1-12/09] Marketing report + alerts", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  });

  test("[R1-12-C12.2] submitReport lưu snapshot, idempotent", async () => {
    const u = await seedUser({ email: testEmail(" qltt"), role: "MARKETING" });
    await submitReport({ submittedById: u.id, periodType: "MONTH", periodKey: "2026-06", snapshot: { l2: 50 } });
    await submitReport({ submittedById: u.id, periodType: "MONTH", periodKey: "2026-06", snapshot: { l2: 60 } });
    const reports = await db.marketingReport.findMany({ where: { submittedById: u.id, periodKey: "2026-06" } });
    expect(reports).toHaveLength(1); // idempotent
    expect((reports[0]?.snapshot as { l2: number }).l2).toBe(60); // đè
  });

  test("[R1-09-C9.5/R1-12-C12.3] sau ngày 05: chi phí chưa CONFIRMED + thiếu báo cáo → alert SUPER_ADMIN", async () => {
    const sa = await seedSuperAdmin();
    const r = await runMarketingAlerts(AFTER_DEADLINE);
    expect(r.alerts).toBe(2); // cost-unconfirmed + report-missing
    expect(await db.staffNotification.count({ where: { userId: sa.id, category: "MARKETING_ALERT" } })).toBe(2);

    // chạy lại → idempotent (dedupeKey)
    await runMarketingAlerts(AFTER_DEADLINE);
    expect(await db.staffNotification.count({ where: { userId: sa.id, category: "MARKETING_ALERT" } })).toBe(2);
  });

  test("[R1-09-C9.5] đã CONFIRMED + có báo cáo → không alert", async () => {
    const sa = await seedSuperAdmin();
    await db.marketingCostPeriod.create({ data: { period: PREV_PERIOD, totalQcCost: 1, status: "CONFIRMED" } });
    await submitReport({ submittedById: sa.id, periodType: "MONTH", periodKey: PREV_PERIOD, snapshot: {} });
    const r = await runMarketingAlerts(AFTER_DEADLINE);
    expect(r.alerts).toBe(0);
  });

  test("trước ngày 05 → không alert", async () => {
    await seedSuperAdmin();
    expect((await runMarketingAlerts(BEFORE_DEADLINE)).alerts).toBe(0);
  });
});
