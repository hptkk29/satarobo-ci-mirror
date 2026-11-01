/**
 * A0-03 — Integration: resolveActor (DB thật) + can() v2 end-to-end. Postgres LOCAL.
 * Validates query lọc hiệu lực + visibleCenterIds + cross-center/isolation qua dữ liệu seed.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import {
  assignUserOrgRole,
  type RbacActor,
} from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { can } from "../../../lib/auth/can";
import { getModelVisibleCenterIds, passesScope } from "../../../lib/db-scope";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

async function roleId(code: string): Promise<string> {
  const r = await db.roleDef.findUnique({ where: { code }, select: { id: true } });
  if (!r) throw new Error(`role ${code}`);
  return r.id;
}
async function orgId(code: string): Promise<string> {
  const o = await db.orgUnit.findUnique({ where: { code }, select: { id: true } });
  if (!o) throw new Error(`org ${code}`);
  return o.id;
}
/** centerId của OrgUnit CENTER (đã link Center cũ). */
async function centerId(code: string): Promise<string> {
  const o = await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } });
  if (!o?.centerId) throw new Error(`center ${code}`);
  return o.centerId;
}

async function seedCenters() {
  await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-it", address: "a", city: "" } });
  await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-it", address: "b", city: "" } });
}

test.describe("[A0-03] can() v2 integration (DB thật)", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seedCenters();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  });

  test("[A0-03-IT-02] HO_ACCOUNTANT@HO → payments:manage cả CS1 & CS2 (cross-center)", async () => {
    const u = await seedUser({ email: testEmail("ho-acc"), role: "ACCOUNTANT" });
    await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId("HO"), roleId: await roleId("HO_ACCOUNTANT"), reason: "gán" });

    const actor = await resolveActorUncached(u.id);
    expect(can(actor, "payments:manage", { centerId: await centerId("CS1") })).toBe(true);
    expect(can(actor, "payments:manage", { centerId: await centerId("CS2") })).toBe(true);
    // HO_ACCOUNTANT không có students:edit → false (HO ≠ siêu quyền)
    expect(can(actor, "students:edit", { centerId: await centerId("CS1") })).toBe(false);
  });

  // Cách ly cơ sở của kế toán cơ sở KHÔNG còn nằm ở can() — nó nằm ở scopedDb.
  //
  // Lý do (09/07/2026, R1): `payments:manage` có 17 call-site gọi trần và 0 call-site
  // truyền target — gate chạy TRƯỚC khi fetch payment nên chưa biết centerId (xem
  // comment trong app/(admin)/admin/payments/_actions.ts:39). Giữ scopeType CENTER thì
  // `scopeMatches` trả false ở mọi gate ⇒ kế toán cơ sở mất sạch /payments. Nên seed
  // đổi sang GLOBAL, và cách ly được ép ở tầng dữ liệu (Payment ∈ SCOPED_MODELS).
  //
  // Test này vì vậy khẳng định lại bất biến CŨ ở ĐÚNG CHỖ nó sống bây giờ.
  test("[A0-03-IT-01] CENTER_ACCOUNTANT@CS1 → cách ly cơ sở ở tầng scopedDb", async () => {
    const u = await seedUser({ email: testEmail("cs1-acc"), role: "ACCOUNTANT" });
    await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId("CS1"), roleId: await roleId("CENTER_ACCOUNTANT"), reason: "gán" });

    const actor = await resolveActorUncached(u.id);
    const cs1 = await centerId("CS1");
    const cs2 = await centerId("CS2");
    expect(actor.visibleCenterIds).toEqual([cs1]);

    // can(): GLOBAL → true bất kể target. Đây là gate ACTION, không phải gate DỮ LIỆU.
    expect(can(actor, "payments:manage", { centerId: cs1 })).toBe(true);
    expect(can(actor, "payments:manage", { centerId: cs2 })).toBe(true);
    // …nhưng KHÔNG có action của cơ sở khác thì vẫn false (HO ≠ siêu quyền).
    expect(can(actor, "students:edit", { centerId: cs1 })).toBe(false);

    // Gate DỮ LIỆU: chỉ thấy payment CS1, và record CS2 bị chặn (chống IDOR).
    expect(getModelVisibleCenterIds("Payment", actor)).toEqual([cs1]);
    expect(passesScope("Payment", { centerId: cs1 }, actor)).toBe(true);
    expect(passesScope("Payment", { centerId: cs2 }, actor)).toBe(false);
  });

  test("[A0-03-T7-01] role hết hạn → resolveActor không tính quyền", async () => {
    const u = await seedUser({ email: testEmail("expired"), role: "ACCOUNTANT" });
    await assignUserOrgRole(SA, {
      userId: u.id, orgUnitId: await orgId("CS1"), roleId: await roleId("CENTER_ACCOUNTANT"),
      effectiveFrom: new Date("2000-01-01"), effectiveTo: new Date("2001-01-01"), reason: "gán",
    });
    const actor = await resolveActorUncached(u.id);
    expect(actor.orgRoles).toHaveLength(0);
    expect(can(actor, "payments:manage", { centerId: await centerId("CS1") })).toBe(false);
  });

  test("SUPER_ADMIN@HO → mọi action true (AC7)", async () => {
    const u = await seedUser({ email: testEmail("root-sa"), role: "SUPER_ADMIN" });
    await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId("HO"), roleId: await roleId("SUPER_ADMIN"), reason: "gán" });
    const actor = await resolveActorUncached(u.id);
    expect(actor.isSuperAdmin).toBe(true);
    expect(can(actor, "students:edit", { centerId: await centerId("CS2") })).toBe(true);
  });
});
