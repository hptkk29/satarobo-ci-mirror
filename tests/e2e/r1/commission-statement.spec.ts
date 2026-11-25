/**
 * R1-10 persistence — bảng hoa hồng DRAFT→APPROVED→REOPENED + "của tôi" (C10.6/C10.7). PG LOCAL.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { assertTestDb } from "../../e2e/_helpers/seed";
import { computeCommission } from "../../../lib/crm/commission";
import {
  setStatementLines,
  approveStatement,
  reopenStatement,
  getMyCommissionLines,
  CommissionStmtError,
} from "../../../lib/crm/commission-statement";

const ACC = { id: "acc", name: "Kế toán" };
const SA = { id: "sa", name: "Super Admin", isSuperAdmin: true };
const NON_SA = { id: "x", name: "Khác", isSuperAdmin: false };

async function expectErr(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) { if (e instanceof CommissionStmtError) return expect(e.code).toBe(code); throw e; }
  throw new Error(`Mong đợi CommissionStmtError(${code})`);
}

const lines = computeCommission({
  revenue: 10_000_000, isRenewal: false,
  recipients: { QC: "qc", SALE_ADMIN: "adm", SALE: "sale-A", QL_TT: "tt" },
});

test.describe("[R1-10] Commission statement", () => {
  test.beforeEach(async () => {
    assertTestDb();
    await db.commissionLine.deleteMany({});
    await db.commissionStatement.deleteMany({});
  });

  test("[R1-10-C10.6] DRAFT→APPROVED khóa; mở lại cần SUPER_ADMIN + audit", async () => {
    await setStatementLines(ACC, { period: "2026-06", lines });
    expect(await db.commissionLine.count()).toBe(4);

    await approveStatement(ACC, "2026-06", "chốt kỳ");
    await expectErr(setStatementLines(ACC, { period: "2026-06", lines }), "STATEMENT_LOCKED");

    await expectErr(reopenStatement(NON_SA, "2026-06"), "FORBIDDEN");
    const r = await reopenStatement(SA, "2026-06", "điều chỉnh");
    expect(r.status).toBe("REOPENED");
    await setStatementLines(ACC, { period: "2026-06", lines }); // sửa lại được sau REOPEN

    // audit ghi APPROVE + REOPEN
    expect(await db.auditLog.count({ where: { module: "commission", action: "STATUS_CHANGE" } })).toBeGreaterThanOrEqual(2);
  });

  test("[R1-10-C10.7] 'hoa hồng của tôi' — chỉ thấy dòng của mình", async () => {
    await setStatementLines(ACC, { period: "2026-06", lines });
    const mine = await getMyCommissionLines("sale-A", "2026-06");
    expect(mine).toHaveLength(1);
    expect(mine[0]?.tier).toBe("SALE");
    expect(mine[0]?.amount).toBe(400_000);
    expect(await getMyCommissionLines("nguoi-khac")).toHaveLength(0);
  });
});
