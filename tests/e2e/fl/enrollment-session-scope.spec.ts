/**
 * FL3-02 — scopedDb cách ly cơ sở cho Enrollment + ClassSession (flip EXEMPT→SCOPED).
 * Postgres LOCAL (KHÔNG Supabase). Mẫu theo tests/e2e/a0/scoped-db.spec.ts.
 *
 * ⚠️ SPEC CHƯA CHẠY trong CI cho tới khi:
 *   1) Migration W5f (centerId trên Enrollment/ClassSession) deploy lên DB test, VÀ
 *   2) Backfill Enrollment.centerId + ClassSession.centerId = 100% (centerId null → auto-scope
 *      `centerId IN [...]` sẽ ẨN NHẦM record). Spec này cố tình set centerId tường minh.
 *
 * Mục tiêu (cách ly 2 chiều CS1≠CS2 + IDOR + HO/SA cross-center):
 *  - CM@CS1 chỉ thấy Enrollment/ClassSession của CS1, KHÔNG thấy CS2 (và ngược lại).
 *  - get-by-id record cơ sở khác → null (IDOR).
 *  - HO_* / SUPER_ADMIN thấy cả 2 cơ sở.
 *  - Luồng học bù (withMakeupException) VẪN đọc chéo ClassSession (exception model).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { scopedDb, withMakeupException } from "../../../lib/db-scope";

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

test.describe("[FL3-02] scopedDb cách ly Enrollment + ClassSession", () => {
  let c1 = "", c2 = "";
  let cs2EnrollmentId = "", cs2SessionId = "";

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-sc", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-sc", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    c1 = await centerId("CS1");
    c2 = await centerId("CS2");

    const course = await db.course.create({ data: { name: "Sata 1", slug: "sata-1-fl" } });

    // 1 lớp + 1 HS + 1 enrollment + 1 session MỖI cơ sở; centerId set tường minh.
    for (const [tag, ctr] of [["c1", c1], ["c2", c2]] as const) {
      const cls = await db.class.create({
        data: { name: `Lop-${tag}`, courseId: course.id, centerId: ctr },
      });
      const student = await db.student.create({ data: { name: `HS-${tag}`, centerId: ctr } });
      const enr = await db.enrollment.create({
        data: { studentId: student.id, classId: cls.id, courseId: course.id, centerId: ctr },
      });
      const ses = await db.classSession.create({
        data: { classId: cls.id, date: new Date("2026-07-01"), centerId: ctr },
      });
      if (tag === "c2") {
        cs2EnrollmentId = enr.id;
        cs2SessionId = ses.id;
      }
    }
  });

  test("[FL3-02-T1] CM@CS1 list Enrollment → chỉ CS1, không CS2", async () => {
    const actor = await makeUser("cm1-enr", "CS1", "CENTER_MANAGER");
    const rows = await scopedDb(actor).enrollment.findMany({ select: { centerId: true } });
    expect(rows.map((r) => r.centerId)).toEqual([c1]);
  });

  test("[FL3-02-T2] CM@CS2 list Enrollment → chỉ CS2 (chiều ngược)", async () => {
    const actor = await makeUser("cm2-enr", "CS2", "CENTER_MANAGER");
    const rows = await scopedDb(actor).enrollment.findMany({ select: { centerId: true } });
    expect(rows.map((r) => r.centerId)).toEqual([c2]);
  });

  test("[FL3-02-T3] CM@CS1 list ClassSession → chỉ CS1, không CS2", async () => {
    const actor = await makeUser("cm1-ses", "CS1", "CENTER_MANAGER");
    const rows = await scopedDb(actor).classSession.findMany({ select: { centerId: true } });
    expect(rows.map((r) => r.centerId)).toEqual([c1]);
  });

  test("[FL3-02-T4] CM@CS1 get-by-id Enrollment CS2 → null (IDOR)", async () => {
    const actor = await makeUser("cm1-idor-e", "CS1", "CENTER_MANAGER");
    expect(await scopedDb(actor).enrollment.findUnique({ where: { id: cs2EnrollmentId } })).toBeNull();
  });

  test("[FL3-02-T5] CM@CS1 get-by-id ClassSession CS2 → null (IDOR)", async () => {
    const actor = await makeUser("cm1-idor-s", "CS1", "CENTER_MANAGER");
    expect(await scopedDb(actor).classSession.findUnique({ where: { id: cs2SessionId } })).toBeNull();
  });

  test("[FL3-02-T6] CM@CS1 count Enrollment → 1 (chỉ CS1)", async () => {
    const actor = await makeUser("cm1-cnt", "CS1", "CENTER_MANAGER");
    expect(await scopedDb(actor).enrollment.count()).toBe(1);
  });

  test("[FL3-02-T7] HO_ACCOUNTANT@HO → thấy cả CS1+CS2 (cross-center)", async () => {
    const actor = await makeUser("ho-enr", "HO", "HO_ACCOUNTANT");
    expect(await scopedDb(actor).enrollment.count()).toBe(2);
    expect(await scopedDb(actor).classSession.count()).toBe(2);
  });

  test("[FL3-02-T8] SUPER_ADMIN → thấy tất cả (bypass)", async () => {
    const actor = await makeUser("sa-enr", "HO", "SUPER_ADMIN");
    expect(await scopedDb(actor).enrollment.count()).toBe(2);
    expect(await scopedDb(actor).classSession.count()).toBe(2);
  });

  test("[FL3-02-T9] makeup exception VẪN cho CM@CS1 đọc CHÉO ClassSession CS2", async () => {
    // ClassSession ∈ MAKEUP_EXCEPTION_MODELS → withMakeupException bỏ qua scope (xếp bù chéo).
    const actor = await makeUser("cm1-mk", "CS1", "CENTER_MANAGER");
    expect(await withMakeupException(actor).classSession.count()).toBe(2);
    // NHƯNG Enrollment KHÔNG là exception → vẫn cách ly trong cùng luồng.
    expect(await withMakeupException(actor).enrollment.count()).toBe(1);
  });
});
