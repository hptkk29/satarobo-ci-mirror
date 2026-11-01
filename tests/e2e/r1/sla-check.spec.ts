/**
 * R1-06 — runSlaCheck → StaffNotification (dedupeKey, C6.6). PG LOCAL.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../../e2e/_helpers/seed";
import { testEmail } from "../../e2e/_helpers/fixtures";
import { runSlaCheck } from "../../../lib/crm/sla";

test.describe("[R1-06] SLA cron", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R1-06-C6.6] lead vi phạm SLA-3 → StaffNotification dedupeKey; chạy 2 lần không trùng", async () => {
    const sale = await seedUser({ email: testEmail("sale"), role: "SALES_CSM" });
    // assignedAt 4h trước, chưa firstContact → SLA-3.
    const lead = await db.lead.create({
      data: {
        parentName: "KH", phone: "0900000001", assignedToId: sale.id,
        assignedAt: new Date(Date.now() - 4 * 3_600_000),
      },
    });

    const r1 = await runSlaCheck();
    expect(r1.notified).toBeGreaterThanOrEqual(1);
    const notif = await db.staffNotification.findFirst({
      where: { userId: sale.id, dedupeKey: `sla:SLA-3:${lead.id}` },
    });
    expect(notif).not.toBeNull();
    expect(notif?.category).toBe("SLA");

    await runSlaCheck(); // lần 2
    expect(await db.staffNotification.count({ where: { dedupeKey: `sla:SLA-3:${lead.id}` } })).toBe(1);
  });

  test("lead không có người nhận → bỏ qua, không crash", async () => {
    await db.lead.create({
      data: { parentName: "KH2", phone: "0900000002", assignedAt: new Date(Date.now() - 4 * 3_600_000) },
    });
    const r = await runSlaCheck();
    expect(r.notified).toBe(0); // không assignedToId/adminId
  });
});
