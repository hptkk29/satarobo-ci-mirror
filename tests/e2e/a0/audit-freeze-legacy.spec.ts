/**
 * #05 freeze-legacy — 5 bảng audit cũ đóng băng; helper ghi vào `AuditLog` hợp nhất.
 *
 * Vì sao cần e2e (không đủ với unit): `writeAudit` ghi DB thật, và điểm dễ sai nhất là
 * `orgUnitId`. `queryUnifiedAuditLogs` lọc `orgUnitId IN visibleOrgUnitIds` ⇒ nếu helper
 * quên nạp orgUnitId của thực thể, QL cơ sở sẽ KHÔNG thấy log nào — im lặng, không lỗi.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { queryUnifiedAuditLogs } from "../../../lib/audit/audit-log";
import { canReadLegacyAudit, queryLegacyAuditLogs } from "../../../lib/audit/legacy-log";
import { logLeadAudit, logStudentAudit, logUserAudit } from "../../../lib/audit/log";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };
const orgId = async (code: string) =>
  (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
const centerId = async (code: string) =>
  (await db.center.findUnique({ where: { code }, select: { id: true } }))!.id;

async function seedCenters() {
  for (const code of ["CS1", "CS2"]) {
    await db.center.upsert({
      where: { id: code },
      create: { id: code, name: code, code, slug: code.toLowerCase(), address: "test" },
      update: {},
    });
  }
}

async function actorWithRole(email: string, orgCode: string, roleCode: string) {
  const u = await seedUser({ email: testEmail(email), role: "CENTER_MANAGER" });
  const r = (await db.roleDef.findUnique({ where: { code: roleCode }, select: { id: true } }))!.id;
  await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId(orgCode), roleId: r, reason: "seed" });
  return resolveActorUncached(u.id);
}

/** Lead gắn cơ sở + orgUnit tương ứng (dual-write PR-B). */
async function seedLead(name: string, centerCode: string) {
  return db.lead.create({
    data: {
      parentName: name,
      phone: "0900000000",
      centerId: await centerId(centerCode),
      orgUnitId: await orgId(centerCode),
    },
    select: { id: true },
  });
}

const LEGACY_TABLES = ["userAuditLog", "permissionGrantAuditLog", "leadAuditLog", "classAuditLog", "studentAuditLog"] as const;

async function legacyRowCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of LEGACY_TABLES) {
    // @ts-expect-error — truy cập model động, chỉ dùng trong test.
    out[t] = await db[t].count();
  }
  return out;
}

test.describe("[#05] freeze-legacy — helper ghi vào AuditLog hợp nhất", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seedCenters();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  });

  test("[#05-F1] logLeadAudit KHÔNG ghi bảng cũ, ghi bảng hợp nhất kèm orgUnitId", async () => {
    const lead = await seedLead("PH A", "CS1");
    const before = await legacyRowCounts();

    await logLeadAudit({
      leadId: lead.id,
      action: "STATUS_CHANGE",
      actorId: null,
      actorName: "Sale CS1",
      oldValues: { status: "NEW" },
      newValues: { status: "CONTACTED" },
      reason: "gọi lần 1",
    });

    expect(await legacyRowCounts()).toEqual(before); // 5 bảng cũ đứng yên

    const row = await db.auditLog.findFirstOrThrow({ where: { entityId: lead.id } });
    expect(row.module).toBe("leads");
    expect(row.entityType).toBe("Lead");
    expect(row.action).toBe("lead.status_change");
    expect(row.reason).toBe("gọi lần 1");
    expect(row.orgUnitId).toBe(await orgId("CS1")); // ← nếu null, QL cơ sở sẽ không thấy gì
    expect(row.changedFields).toEqual(["status"]);
  });

  test("[#05-F2] logUserAudit + logStudentAudit cũng vào bảng hợp nhất", async () => {
    const u = await seedUser({ email: testEmail("target"), role: "TEACHER" });
    await logUserAudit({ userId: u.id, action: "DISABLE", actorId: null, actorName: "SA" });

    const st = await db.student.create({
      data: { name: "HV", centerId: await centerId("CS2"), orgUnitId: await orgId("CS2") },
      select: { id: true },
    });
    await logStudentAudit({ studentId: st.id, action: "UPDATE", actorId: null, actorName: "CM" });

    const rows = await db.auditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["user.disable", "student.update"]));
    expect(rows.find((r) => r.entityId === st.id)?.orgUnitId).toBe(await orgId("CS2"));
    expect(await db.userAuditLog.count()).toBe(0);
    expect(await db.studentAuditLog.count()).toBe(0);
  });

  test("[#05-F3] 2 vai trò: QL cơ sở CS1 thấy log CS1, KHÔNG thấy log CS2", async () => {
    const leadCs1 = await seedLead("PH CS1", "CS1");
    const leadCs2 = await seedLead("PH CS2", "CS2");
    for (const [lead, who] of [
      [leadCs1, "Sale CS1"],
      [leadCs2, "Sale CS2"],
    ] as const) {
      await logLeadAudit({ leadId: lead.id, action: "UPDATE", actorId: null, actorName: who });
    }

    const cm1 = await actorWithRole("cm1", "CS1", "CENTER_MANAGER");
    const seen1 = await queryUnifiedAuditLogs(cm1, {}, null);
    expect(seen1.items.map((i) => i.entityId)).toEqual([leadCs1.id]);

    const cm2 = await actorWithRole("cm2", "CS2", "CENTER_MANAGER");
    const seen2 = await queryUnifiedAuditLogs(cm2, {}, null);
    expect(seen2.items.map((i) => i.entityId)).toEqual([leadCs2.id]);

    const sa = await actorWithRole("sa", "HO", "SUPER_ADMIN");
    const seenAll = await queryUnifiedAuditLogs(sa, {}, null);
    expect(seenAll.items).toHaveLength(2);
  });

  test("[#05-F4] tab lịch sử cũ: chỉ SUPER_ADMIN/HO đọc được, dữ liệu cũ vẫn xem được", async () => {
    // Dòng cũ chỉ có thể tồn tại từ trước khi freeze → ghi thẳng vào bảng legacy.
    const u = await seedUser({ email: testEmail("old"), role: "TEACHER" });
    await db.userAuditLog.create({
      data: { userId: u.id, action: "UPDATE", changedByName: "Ai đó", changedFields: [] },
    });

    const sa = await actorWithRole("sa2", "HO", "SUPER_ADMIN");
    expect(canReadLegacyAudit(sa)).toBe(true);
    const rows = await queryLegacyAuditLogs(sa);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe("user");

    const cm = await actorWithRole("cm3", "CS1", "CENTER_MANAGER");
    expect(canReadLegacyAudit(cm)).toBe(false);
    // Không scope được theo cơ sở → thà trả rỗng còn hơn lộ log cơ sở khác.
    expect(await queryLegacyAuditLogs(cm)).toEqual([]);
  });
});
