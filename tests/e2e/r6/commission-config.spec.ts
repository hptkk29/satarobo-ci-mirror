/**
 * R6-B1 — Tỉ lệ hoa hồng theo kỳ trong DB (effective theo thời điểm + trần + recalc).
 * Postgres LOCAL (.env.test). Test service trực tiếp.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached, type Actor } from "../../../lib/auth/actor";
import {
  getEffectiveRates,
  setCommissionRate,
  recomputeStatementLines,
  pickEffectiveRates,
} from "../../../lib/crm/commission-config";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

async function orgId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function makeActor(emailKey: string, orgCode: string, roleCode: string): Promise<Actor> {
  const u = await seedUser({ email: testEmail(emailKey), role: "ACCOUNTANT" });
  const r = (await db.roleDef.findUnique({ where: { code: roleCode }, select: { id: true } }))!.id;
  await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId(orgCode), roleId: r, reason: "seed" });
  return resolveActorUncached(u.id);
}

test.describe("[R6-B1] CommissionRateConfig", () => {
  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-cm", address: "a", city: "" } });
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
  });

  test("[R6-B1-T1-01] DB trống → getEffectiveRates trả default (8% tổng)", async () => {
    const rates = await getEffectiveRates();
    expect(rates.SALE).toBeCloseTo(0.04);
    const total = rates.QC + rates.SALE_ADMIN + rates.SALE + rates.QL_TT;
    expect(total).toBeCloseTo(0.08);
  });

  test("[R6-B1-T1-02] rate hiệu lực theo kỳ: đơn trước/sau ngày đổi nhận rate khác nhau", async () => {
    const sa = await makeActor("cm-sa", "HO", "SUPER_ADMIN");
    const change = new Date("2026-06-01T00:00:00Z");
    const res = await setCommissionRate(sa, {
      tier: "SALE",
      rate: 0.03,
      effectiveFrom: change,
      reason: "giảm theo chính sách",
      actorName: "SA",
    });
    expect(res.ok).toBe(true);

    // trước 1/6 → default 4%; từ 1/6 → 3%.
    expect((await getEffectiveRates({ at: new Date("2026-05-20") })).SALE).toBeCloseTo(0.04);
    expect((await getEffectiveRates({ at: new Date("2026-06-10") })).SALE).toBeCloseTo(0.03);
  });

  test("[R6-B1-T2-01] đặt rate làm tổng vượt trần 8% → từ chối", async () => {
    const sa = await makeActor("cm-sa2", "HO", "SUPER_ADMIN");
    // SALE 4%→7% ⇒ tổng = 1+1+7+2 = 11% > 8%.
    const res = await setCommissionRate(sa, {
      tier: "SALE",
      rate: 0.07,
      effectiveFrom: new Date("2026-06-01"),
      reason: "x",
      actorName: "SA",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("RATE_EXCEEDS_CAP");
  });

  test("[R6-B1-T2-02] CENTER_MANAGER không được sửa rate (FORBIDDEN)", async () => {
    const cm = await makeActor("cm-cm", "CS1", "CENTER_MANAGER");
    const res = await setCommissionRate(cm, {
      tier: "SALE",
      rate: 0.03,
      effectiveFrom: new Date("2026-06-01"),
      reason: "x",
      actorName: "CM",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });

  test("[R6-B1-T6-01] recalc DRAFT dùng rate mới; APPROVED bất biến → throw", async () => {
    const sources = [
      { revenue: 10_000_000, isRenewal: false, recipients: { SALE: "u1" } },
    ];
    const newRates = pickEffectiveRates(
      [{ tier: "SALE", rate: 0.03, effectiveFrom: new Date("2026-01-01"), effectiveTo: null }],
      new Date("2026-06-10"),
    );
    // DRAFT → tính lại theo 3% = 300k.
    const draftLines = recomputeStatementLines("DRAFT", sources, newRates);
    expect(draftLines[0].amount).toBe(300_000);

    // APPROVED → ném lỗi (bất biến).
    expect(() => recomputeStatementLines("APPROVED", sources, newRates)).toThrow();
  });

  test("[R6-B1-T9-01] setCommissionRate ghi AuditLog (reason bắt buộc)", async () => {
    const sa = await makeActor("cm-sa3", "HO", "SUPER_ADMIN");
    await setCommissionRate(sa, {
      tier: "QL_TT",
      rate: 0.015,
      effectiveFrom: new Date("2026-06-01"),
      reason: "điều chỉnh QL TT",
      actorName: "SA",
    });
    const log = await db.auditLog.findFirst({
      where: { module: "commission", entityType: "CommissionRateConfig", entityId: "QL_TT" },
    });
    expect(log).not.toBeNull();
    expect(log!.reason).toBe("điều chỉnh QL TT");
  });
});
