/**
 * R5-01 C1.2 — chấm công (EmployeeCheckin) cách ly theo cơ sở qua scopedDb. PG LOCAL.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../../e2e/_helpers/seed";
import { testEmail } from "../../e2e/_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { scopedDb } from "../../../lib/db-scope";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };
const orgId = async (c: string) => (await db.orgUnit.findUnique({ where: { code: c }, select: { id: true } }))!.id;
const centerId = async (c: string) => (await db.orgUnit.findUnique({ where: { code: c }, select: { centerId: true } }))!.centerId!;

test.describe("[R5-01] Checkin scope", () => {
  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-hr", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-hr", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  });

  test("[R5-01-C1.2] CM@CS1 chỉ thấy chấm công CS1, không lọt CS2", async () => {
    const c1 = await centerId("CS1");
    const c2 = await centerId("CS2");
    await db.employeeCheckin.create({ data: { userId: "u-cs1", type: "CHECK_IN", centerId: c1 } });
    await db.employeeCheckin.create({ data: { userId: "u-cs2", type: "CHECK_IN", centerId: c2 } });

    const u = await seedUser({ email: testEmail("cm-hr"), role: "CENTER_MANAGER" });
    const roleId = (await db.roleDef.findUnique({ where: { code: "CENTER_MANAGER" }, select: { id: true } }))!.id;
    await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId("CS1"), roleId, reason: "seed" });
    const actor = await resolveActorUncached(u.id);

    const rows = await scopedDb(actor).employeeCheckin.findMany();
    expect(rows.map((r) => r.centerId)).toEqual([c1]); // chỉ CS1
  });
});
