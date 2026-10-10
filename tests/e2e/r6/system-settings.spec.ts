/**
 * R6-A — Cấu hình 2 tầng: resolve Center→Global→default, RBAC, isolation, audit.
 * Postgres LOCAL (.env.test). Test service trực tiếp (DB) — pattern như a0/scoped-db.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import {
  getSetting,
  setGlobalSetting,
  setCenterSetting,
  clearSettingsCache,
} from "../../../lib/settings/service";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

async function orgId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}

async function makeActor(emailKey: string, orgCode: string, roleCode: string) {
  const u = await seedUser({ email: testEmail(emailKey), role: "ACCOUNTANT" });
  const r = (await db.roleDef.findUnique({ where: { code: roleCode }, select: { id: true } }))!.id;
  await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId(orgCode), roleId: r, reason: "seed" });
  return resolveActorUncached(u.id);
}

test.describe("[R6-A] Cấu hình hệ thống 2 tầng", () => {
  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-set", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-set", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    clearSettingsCache();
  });

  test("[R6-A-T1-06] DB trống → getSetting trả default trong code (AC2 US-R6A-2)", async () => {
    expect(await getSetting("class.maxStudents.default")).toBe(20);
    expect(await getSetting("student.nearEndThreshold")).toBe(5);
  });

  test("[R6-A-T9-01] SUPER_ADMIN sửa GLOBAL → ok + ghi AuditLog (AC3)", async () => {
    const sa = await makeActor("set-sa", "HO", "SUPER_ADMIN");
    const res = await setGlobalSetting(sa, {
      key: "student.nearEndThreshold",
      value: 3,
      reason: "đổi ngưỡng theo mùa",
      actorName: "SA",
    });
    expect(res.ok).toBe(true);
    expect(await getSetting("student.nearEndThreshold")).toBe(3);

    const log = await db.auditLog.findFirst({
      where: { module: "settings", entityType: "SystemSetting", entityId: "student.nearEndThreshold" },
    });
    expect(log).not.toBeNull();
    expect(log!.reason).toBe("đổi ngưỡng theo mùa");
  });

  test("[R6-A-T2-01] SUPER sửa GLOBAL thiếu reason → từ chối (AC3 reason bắt buộc)", async () => {
    const sa = await makeActor("set-sa2", "HO", "SUPER_ADMIN");
    const res = await setGlobalSetting(sa, { key: "student.nearEndThreshold", value: 3, reason: "  ", actorName: "SA" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe("reason");
  });

  test("[R6-A-T2-02] SUPER sửa GLOBAL giá trị vượt khoảng → từ chối (AC4)", async () => {
    const sa = await makeActor("set-sa3", "HO", "SUPER_ADMIN");
    const res = await setGlobalSetting(sa, { key: "class.maxStudents.default", value: 999, reason: "x", actorName: "SA" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION");
  });

  test("[R6-A-T4-01] CENTER_MANAGER KHÔNG sửa được GLOBAL (AC1)", async () => {
    const cm = await makeActor("set-cm1", "CS1", "CENTER_MANAGER");
    const res = await setGlobalSetting(cm, { key: "class.maxStudents.default", value: 18, reason: "x", actorName: "CM" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });

  test("[R6-A-T5-01] CM@CS1 override CS1 → CS1 nhận giá trị mới, CS2 vẫn GLOBAL/default (AC2)", async () => {
    const cm = await makeActor("set-cm2", "CS1", "CENTER_MANAGER");
    const cs1 = await orgId("CS1");
    const cs2 = await orgId("CS2");

    const res = await setCenterSetting(cm, {
      orgUnitId: cs1,
      key: "class.maxStudents.default",
      value: 12,
      reason: "phòng CS1 nhỏ",
      actorName: "CM",
    });
    expect(res.ok).toBe(true);

    expect(await getSetting("class.maxStudents.default", { orgUnitId: cs1 })).toBe(12);
    expect(await getSetting("class.maxStudents.default", { orgUnitId: cs2 })).toBe(20); // không lộ override CS1
    expect(await getSetting("class.maxStudents.default")).toBe(20); // global vẫn default
  });

  test("[R6-A-T5-02] CM@CS1 KHÔNG override được CS2 (isolation, AC2)", async () => {
    const cm = await makeActor("set-cm3", "CS1", "CENTER_MANAGER");
    const cs2 = await orgId("CS2");
    const res = await setCenterSetting(cm, {
      orgUnitId: cs2,
      key: "class.maxStudents.default",
      value: 9,
      reason: "x",
      actorName: "CM",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });

  test("[R6-A-T2-03] override key KHÔNG centerOverridable → từ chối (AC4)", async () => {
    const cm = await makeActor("set-cm4", "CS1", "CENTER_MANAGER");
    const cs1 = await orgId("CS1");
    const res = await setCenterSetting(cm, {
      orgUnitId: cs1,
      key: "enrollment.suspendMaxMonths",
      value: 3,
      reason: "x",
      actorName: "CM",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION");
  });

  test("[R6-A-T1-07] GLOBAL set → cả 2 cơ sở thấy global khi chưa override", async () => {
    const sa = await makeActor("set-sa4", "HO", "SUPER_ADMIN");
    await setGlobalSetting(sa, { key: "class.maxStudents.default", value: 16, reason: "chuẩn mới", actorName: "SA" });
    const cs1 = await orgId("CS1");
    const cs2 = await orgId("CS2");
    expect(await getSetting("class.maxStudents.default", { orgUnitId: cs1 })).toBe(16);
    expect(await getSetting("class.maxStudents.default", { orgUnitId: cs2 })).toBe(16);
  });
});
