/**
 * R1-05 — handover HO→CS + tiếp nhận + phân Sale + cách ly CS (C5.4). PG LOCAL.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../../e2e/_helpers/seed";
import { testEmail } from "../../e2e/_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { scopedDb } from "../../../lib/db-scope";
import { handoverLead, confirmReceived, assignSale, recordFirstContact } from "../../../lib/crm/handover";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };
const AUD = { id: "ho-sale", name: "HO Sale" };
const orgId = async (c: string) => (await db.orgUnit.findUnique({ where: { code: c }, select: { id: true } }))!.id;
const centerId = async (c: string) => (await db.orgUnit.findUnique({ where: { code: c }, select: { centerId: true } }))!.centerId!;

test.describe("[R1-05] Handover", () => {
  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-ho", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-ho", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  });

  test("[R1-05-C5.1/2/3] handover → confirm → assign → firstContact set đúng mốc", async () => {
    const lead = await db.lead.create({ data: { parentName: "KH", phone: "0900000001", qualifiedAt: new Date() } });
    const c1 = await centerId("CS1");
    const sale = await seedUser({ email: testEmail("sale1"), role: "SALES_CSM" });

    let l = await handoverLead({ actor: AUD, leadId: lead.id, toCenterId: c1, reason: "bàn giao CS1" });
    expect(l.handedAt).not.toBeNull();
    expect(l.centerId).toBe(c1);

    l = await confirmReceived({ actor: AUD, leadId: lead.id });
    expect(l.receivedConfirmedAt).not.toBeNull();

    l = await assignSale({ actor: AUD, leadId: lead.id, saleUserId: sale.id });
    expect(l.assignedAt).not.toBeNull();
    expect(l.assignedToId).toBe(sale.id);

    l = await recordFirstContact({ actor: AUD, leadId: lead.id });
    expect(l.firstContactAt).not.toBeNull();

    // audit ghi (STATUS_CHANGE/ASSIGN)
    expect(await db.auditLog.count({ where: { entityType: "Lead", entityId: lead.id } })).toBeGreaterThanOrEqual(3);
  });

  test("[R1-05-C5.4] CM@CS2 KHÔNG thấy lead bàn giao cho CS1", async () => {
    const lead = await db.lead.create({ data: { parentName: "KH-CS1", phone: "0900000002" } });
    await handoverLead({ actor: AUD, leadId: lead.id, toCenterId: await centerId("CS1") });

    const u = await seedUser({ email: testEmail("cm-cs2"), role: "CENTER_MANAGER" });
    const roleId = (await db.roleDef.findUnique({ where: { code: "CENTER_MANAGER" }, select: { id: true } }))!.id;
    await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId("CS2"), roleId, reason: "seed" });
    const actor = await resolveActorUncached(u.id);

    const visible = await scopedDb(actor).lead.findMany();
    expect(visible.find((x) => x.id === lead.id)).toBeUndefined(); // không lọt sang CS2
  });
});
