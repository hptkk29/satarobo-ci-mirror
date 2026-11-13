/**
 * A0-04 — scopedDb cách ly cơ sở (CỔNG AN TOÀN, T5 6 góc ×2 chiều). Postgres LOCAL.
 * Dùng model Lead (có centerId). Actor resolve thật từ DB (A0-03).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { ROLE_SEED } from "../../../prisma/seed-roles";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { scopedDb, logScopeBypass } from "../../../lib/db-scope";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

async function orgId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function centerId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!.centerId!;
}
async function makeUser(email: string, orgCode: string, roleCode: string) {
  const u = await seedUser({ email: testEmail(email), role: "ACCOUNTANT" });
  const r = (await db.roleDef.findUnique({ where: { code: roleCode }, select: { id: true } }))!.id;
  await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId(orgCode), roleId: r, reason: "seed" });
  return resolveActorUncached(u.id);
}
async function createLead(name: string, center: string | null) {
  return db.lead.create({ data: { parentName: name, phone: "0900000000", centerId: center } });
}

test.describe("[A0-04] scopedDb cách ly cơ sở", () => {
  let c1 = "", c2 = "", cs2LeadId = "";

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-sc", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-sc", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    c1 = await centerId("CS1");
    c2 = await centerId("CS2");
    await createLead("CS1-ONLY-a", c1);
    await createLead("CS1-ONLY-b", c1);
    const l2 = await createLead("CS2-ONLY-x", c2);
    cs2LeadId = l2.id;
    await createLead("HQ-NULL", null);
  });

  test("[A0-04-T5-01] CM@CS1 list → chỉ CS1, không CS2 (AC1)", async () => {
    const actor = await makeUser("cm1", "CS1", "CENTER_MANAGER");
    const leads = await scopedDb(actor).lead.findMany();
    expect(leads.map((l) => l.parentName).sort()).toEqual(["CS1-ONLY-a", "CS1-ONLY-b"]);
  });

  test("[A0-04-T5-02] CM@CS2 list → chỉ CS2, không CS1 (AC2 chiều ngược)", async () => {
    const actor = await makeUser("cm2", "CS2", "CENTER_MANAGER");
    const leads = await scopedDb(actor).lead.findMany();
    expect(leads.map((l) => l.parentName)).toEqual(["CS2-ONLY-x"]);
  });

  test("[A0-04-T5-03][A0-04-T10-01] CM@CS1 get-by-id record CS2 → null (IDOR, AC3)", async () => {
    const actor = await makeUser("cm1b", "CS1", "CENTER_MANAGER");
    expect(await scopedDb(actor).lead.findUnique({ where: { id: cs2LeadId } })).toBeNull();
  });

  test("[A0-04-T5-05] CM@CS1 count → chỉ CS1 (AC4)", async () => {
    const actor = await makeUser("cm1c", "CS1", "CENTER_MANAGER");
    expect(await scopedDb(actor).lead.count()).toBe(2);
  });

  test("[A0-04-T5-04] CM@CS1 search khớp record CS2 → 0 kết quả", async () => {
    const actor = await makeUser("cm1d", "CS1", "CENTER_MANAGER");
    const r = await scopedDb(actor).lead.findMany({ where: { parentName: { contains: "CS2" } } });
    expect(r).toHaveLength(0);
  });

  test("[A0-04-T4-01][A0-04-T8-03] HO_ACCOUNTANT@HO → thấy cả CS1+CS2 + record null (AC5)", async () => {
    const actor = await makeUser("hoacc", "HO", "HO_ACCOUNTANT");
    const names = (await scopedDb(actor).lead.findMany()).map((l) => l.parentName).sort();
    expect(names).toEqual(["CS1-ONLY-a", "CS1-ONLY-b", "CS2-ONLY-x", "HQ-NULL"]);
  });

  test("[A0-04-T4-02] SUPER_ADMIN → thấy tất cả (AC6)", async () => {
    const actor = await makeUser("sa", "HO", "SUPER_ADMIN");
    expect(await scopedDb(actor).lead.count()).toBe(4);
  });

  test("[A0-04-T8-01] user không center → list rỗng, không crash", async () => {
    const u = await seedUser({ email: testEmail("nocenter"), role: "ACCOUNTANT" });
    const actor = await resolveActorUncached(u.id);
    expect(await scopedDb(actor).lead.findMany()).toHaveLength(0);
  });

  test("[A0-04-T8-02] CM@CS1 KHÔNG thấy record centerId=null", async () => {
    const actor = await makeUser("cm1e", "CS1", "CENTER_MANAGER");
    const names = (await scopedDb(actor).lead.findMany()).map((l) => l.parentName);
    expect(names).not.toContain("HQ-NULL");
  });

  test("[A0-04-T1-01] model không centerId (RoleDef) → không bị scope (AC9)", async () => {
    const actor = await makeUser("cm1f", "CS1", "CENTER_MANAGER");
    // Bài này chứng minh "model không có centerId thì không bị lọc" — điều đó không
    // phụ thuộc vào việc có bao nhiêu vai, nên bám `ROLE_SEED.length` thay vì số đèm cứng
    // (14 → 15 khi EL-02 thêm AUDITOR đã làm bài này đỏ mà chẳng liên quan gì tới scope).
    expect(await scopedDb(actor).roleDef.count()).toBe(ROLE_SEED.length);
  });

  test("[A0-04-T1-02] bypass → thấy tất cả + ghi AuditLog SCOPE_BYPASS (AC10)", async () => {
    const actor = await makeUser("cm1g", "CS1", "CENTER_MANAGER");
    expect(await scopedDb(actor, { bypass: true }).lead.count()).toBe(4);
    await logScopeBypass(actor, "job hạ tầng test");
    const log = await db.rbacAuditLog.findFirst({
      where: { entityId: actor.userId, reason: { contains: "SCOPE_BYPASS" } },
    });
    expect(log).not.toBeNull();
  });
});
