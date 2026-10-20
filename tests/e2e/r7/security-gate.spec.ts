/**
 * R7-00-C4 — Cổng an toàn (scope / IDOR). Postgres LOCAL (.env.test).
 *
 * Mục tiêu: CM@CS1 KHÔNG được thao tác (updateLeadStatus / order action) trên
 * bản ghi thuộc CS2. Test ở 2 tầng mà các action R7 thật sự dựa vào:
 *   1. passesScope(model, record, actor)  — chốt chặn IDOR trong action.
 *   2. scopedDb(actor).findUnique          — IDOR ở tầng truy vấn (trả null).
 * Actor resolve THẬT từ DB (OrgUnit + RoleDef + UserOrgRole) như A0-04.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { passesScope, scopedDb } from "../../../lib/db-scope";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

async function orgId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function centerId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!.centerId!;
}
async function makeUser(slug: string, orgCode: string, roleCode: string) {
  const u = await seedUser({ email: testEmail(slug), role: "ACCOUNTANT" });
  const r = (await db.roleDef.findUnique({ where: { code: roleCode }, select: { id: true } }))!.id;
  await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId(orgCode), roleId: r, reason: "seed" });
  return resolveActorUncached(u.id);
}

test.describe("[R7-00-C4] Security gate — scope/IDOR", () => {
  let c1 = "", c2 = "";
  let cs1LeadId = "", cs2LeadId = "", cs2OrderId = "";

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-r7", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-r7", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    c1 = await centerId("CS1");
    c2 = await centerId("CS2");

    cs1LeadId = (await db.lead.create({ data: { parentName: "PH-CS1", phone: "0900000001", centerId: c1 } })).id;
    cs2LeadId = (await db.lead.create({ data: { parentName: "PH-CS2", phone: "0900000002", centerId: c2 } })).id;
    cs2OrderId = (
      await db.order.create({
        data: {
          code: "ORD-R7-CS2",
          type: "COURSE",
          customerName: "PH-CS2",
          customerPhone: "0900000002",
          totalAmount: 1_000_000,
          status: "PENDING_PAYMENT",
          centerId: c2,
        },
      })
    ).id;
  });

  test("[R7-00-C4-01] CM@CS1: passesScope('Lead', record CS2) → false (updateLeadStatus chặn)", async () => {
    const cm = await makeUser("cm1", "CS1", "CENTER_MANAGER");
    const cs2Lead = await db.lead.findUnique({ where: { id: cs2LeadId }, select: { centerId: true } });
    expect(passesScope("Lead", cs2Lead, cm)).toBe(false);
  });

  test("[R7-00-C4-02] CM@CS1: passesScope('Lead', record CS1) → true (đối chứng)", async () => {
    const cm = await makeUser("cm1b", "CS1", "CENTER_MANAGER");
    const cs1Lead = await db.lead.findUnique({ where: { id: cs1LeadId }, select: { centerId: true } });
    expect(passesScope("Lead", cs1Lead, cm)).toBe(true);
  });

  test("[R7-00-C4-03] CM@CS1: passesScope('Order', order CS2) → false (order action chặn)", async () => {
    const cm = await makeUser("cm1c", "CS1", "CENTER_MANAGER");
    const cs2Order = await db.order.findUnique({ where: { id: cs2OrderId }, select: { centerId: true } });
    expect(passesScope("Order", cs2Order, cm)).toBe(false);
  });

  test("[R7-00-C4-04] CM@CS1: scopedDb.findUnique lead CS2 → null (IDOR tầng truy vấn)", async () => {
    const cm = await makeUser("cm1d", "CS1", "CENTER_MANAGER");
    expect(await scopedDb(cm).lead.findUnique({ where: { id: cs2LeadId } })).toBeNull();
    expect(await scopedDb(cm).order.findUnique({ where: { id: cs2OrderId } })).toBeNull();
    // đối chứng: record cùng cơ sở vẫn đọc được.
    expect(await scopedDb(cm).lead.findUnique({ where: { id: cs1LeadId } })).not.toBeNull();
  });

  test("[R7-00-C4-05] HO_ACCOUNTANT@HO bypass scope → đọc được lead CS2 (cross-center theo chức năng)", async () => {
    const ho = await makeUser("hoacc", "HO", "HO_ACCOUNTANT");
    expect(passesScope("Lead", { centerId: c2 }, ho)).toBe(true);
    expect(await scopedDb(ho).lead.findUnique({ where: { id: cs2LeadId } })).not.toBeNull();
  });
});
