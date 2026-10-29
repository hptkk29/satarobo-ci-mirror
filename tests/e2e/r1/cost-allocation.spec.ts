/**
 * R1-09 — kỳ chi phí DRAFT→CONFIRMED→REOPENED (C9.3/C9.4). PG LOCAL.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { assertTestDb } from "../../e2e/_helpers/seed";
import {
  upsertDraftCost,
  confirmCostPeriod,
  reopenCostPeriod,
  CostError,
} from "../../../lib/crm/cost-allocation";

const HO_ACC = { id: "ho-acc", name: "Kế toán HO", isSuperAdmin: false, orgRoles: [{ roleCode: "HO_ACCOUNTANT" }] };
const CM = { id: "cm", name: "QL CS", isSuperAdmin: false, orgRoles: [{ roleCode: "CENTER_MANAGER" }] };

async function expectErr(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) { if (e instanceof CostError) return expect(e.code).toBe(code); throw e; }
  throw new Error(`Mong đợi CostError(${code})`);
}

test.describe("[R1-09] Cost period", () => {
  test.beforeEach(async () => {
    assertTestDb();
    await db.marketingCostPeriod.deleteMany({});
  });

  test("[R1-09-C9.3] Kế toán HO nhập đè totalQcCost khi DRAFT", async () => {
    await upsertDraftCost(HO_ACC, { period: "2026-06", totalQcCost: 10_000_000 });
    const row = await upsertDraftCost(HO_ACC, { period: "2026-06", totalQcCost: 12_000_000 });
    expect(row.totalQcCost).toBe(12_000_000);
    expect(row.status).toBe("DRAFT");
  });

  test("[R1-09-C9.4] CONFIRMED → khóa sửa", async () => {
    await upsertDraftCost(HO_ACC, { period: "2026-06", totalQcCost: 10_000_000 });
    await confirmCostPeriod(HO_ACC, "2026-06");
    await expectErr(upsertDraftCost(HO_ACC, { period: "2026-06", totalQcCost: 99 }), "PERIOD_LOCKED");
  });

  test("[R1-09-C9.4] REOPEN chỉ SUPER_ADMIN/HO_ACCOUNTANT", async () => {
    await upsertDraftCost(HO_ACC, { period: "2026-06", totalQcCost: 10_000_000 });
    await confirmCostPeriod(HO_ACC, "2026-06");
    // CM không được reopen
    await expectErr(reopenCostPeriod(CM, "2026-06"), "FORBIDDEN");
    // HO_ACCOUNTANT reopen được → có thể sửa lại
    const r = await reopenCostPeriod(HO_ACC, "2026-06");
    expect(r.status).toBe("REOPENED");
    const edited = await upsertDraftCost(HO_ACC, { period: "2026-06", totalQcCost: 15_000_000 });
    expect(edited.totalQcCost).toBe(15_000_000);
  });
});
