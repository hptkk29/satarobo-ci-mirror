/**
 * Task #16 — attendance:edit + role CENTER_CLASS_MANAGER (Kiệt duyệt 07/07/2026,
 * Phương án A). Postgres LOCAL (.env.test).
 *
 * Kiểm 3 lớp mà markAttendance (app/(admin)/admin/attendance/_actions.ts) dựa vào —
 * server action gọi auth() nên KHÔNG test trực tiếp được trong runner này; ta test
 * các KHỐI THUẦN cấu thành hành vi (giống security-gate.spec.ts):
 *   1. decideAttendanceWrite  — phân nhánh mark/edit + cửa sổ hồi tố 7 ngày.
 *   2. can() v2 (actor)        — SALES_CSM / CENTER_CLASS_MANAGER có attendance:edit
 *      theo cơ sở; TEACHER giữ attendance:mark (không hạ chuẩn) + KHÔNG có edit.
 *   3. scopedDb(actor).findUnique — cách ly cơ sở: CSKH CS1 KHÔNG đọc buổi CS2 → null
 *      (gate markAttendance trả "Buổi học không tồn tại").
 *   4. notifyTeacherAttendanceEdited — GV đứng lớp nhận StaffNotification khi buổi bị sửa.
 *
 * ⚠️ SEED cần cho case UI đầy-đủ (CSKH sửa buổi trong 7 ngày → thấy audit + GV nhận
 * chuông) đã có đủ ở đây cho phần BE; nhánh UI (nhập lưới điểm danh) làm ở Playwright UI.
 */
import { test, expect } from "@playwright/test";
import type { Role } from "@prisma/client";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { can } from "../../../lib/auth/can";
import { scopedDb } from "../../../lib/db-scope";
import {
  decideAttendanceWrite,
  ATTENDANCE_RETRO_WINDOW_DAYS,
} from "../../../lib/lms/attendance-edit-policy";
import { notifyTeacherAttendanceEdited } from "../../../lib/notify/attendance";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };
const DAY = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// 1) THUẦN — decideAttendanceWrite (không cần DB).
// ─────────────────────────────────────────────────────────────────────────────
test.describe("[#16-U] decideAttendanceWrite — mark vs edit + cửa sổ 7 ngày", () => {
  const now = new Date("2026-07-07T10:00:00Z");
  const twoDaysAgo = new Date(now.getTime() - 2 * DAY);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY);

  test("[#16-U1] GV/CM/SA + buổi chưa có bản ghi → mode=mark", () => {
    const d = decideAttendanceWrite({
      canManage: true, hasEditPermission: true, hasExistingAttendance: false, sessionDate: twoDaysAgo, now,
    });
    expect(d).toEqual({ ok: true, mode: "mark" });
  });

  test("[#16-U2] GV/CM/SA + buổi đã có bản ghi → mode=edit", () => {
    const d = decideAttendanceWrite({
      canManage: true, hasEditPermission: true, hasExistingAttendance: true, sessionDate: twoDaysAgo, now,
    });
    expect(d).toEqual({ ok: true, mode: "edit" });
  });

  test("[#16-U3] CSKH có attendance:edit, buổi trong 7 ngày → mode=edit (OK)", () => {
    const d = decideAttendanceWrite({
      canManage: false, hasEditPermission: true, hasExistingAttendance: true, sessionDate: twoDaysAgo, now,
    });
    expect(d).toEqual({ ok: true, mode: "edit" });
  });

  test("[#16-U4] CSKH sửa buổi > 7 ngày → chặn WINDOW_EXPIRED", () => {
    const d = decideAttendanceWrite({
      canManage: false, hasEditPermission: true, hasExistingAttendance: true, sessionDate: thirtyDaysAgo, now,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.code).toBe("WINDOW_EXPIRED");
      expect(d.message).toContain(`${ATTENDANCE_RETRO_WINDOW_DAYS} ngày`);
    }
  });

  test("[#16-U5] CENTER_MANAGER (canManage) sửa buổi > 30 ngày → OK, KHÔNG bị window", () => {
    const d = decideAttendanceWrite({
      canManage: true, hasEditPermission: true, hasExistingAttendance: true, sessionDate: thirtyDaysAgo, now,
    });
    expect(d).toEqual({ ok: true, mode: "edit" });
  });

  test("[#16-U6] Không có quyền nào → FORBIDDEN", () => {
    const d = decideAttendanceWrite({
      canManage: false, hasEditPermission: false, hasExistingAttendance: true, sessionDate: twoDaysAgo, now,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("FORBIDDEN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) DB-backed — quyền v2 theo cơ sở + cách ly + notify. Actor resolve THẬT từ DB.
// ─────────────────────────────────────────────────────────────────────────────
async function orgId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function centerIdOf(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!.centerId!;
}
async function roleIdOf(code: string) {
  return (await db.roleDef.findUnique({ where: { code }, select: { id: true } }))!.id;
}
/** Tạo User + gán UserOrgRole(roleCode @ orgCode). primaryRole chỉ để đủ field User.role. */
async function makeUser(slug: string, orgCode: string, roleCode: string, primaryRole: Role) {
  const u = await seedUser({ email: testEmail(slug), role: primaryRole });
  await assignUserOrgRole(SA, {
    userId: u.id,
    orgUnitId: await orgId(orgCode),
    roleId: await roleIdOf(roleCode),
    reason: "seed #16",
  });
  return u;
}
/** Lớp + buổi ở 1 cơ sở (centerId set trên cả Class lẫn ClassSession → scopedDb cách ly). */
async function seedSession(opts: { center: string; teacherId?: string | null; daysAgo?: number }) {
  const c = await centerIdOf(opts.center);
  const rand = Math.random().toString(36).slice(2, 8);
  const course = await db.course.create({ data: { name: `Khoá16 ${rand}`, slug: `c16-${rand}` }, select: { id: true } });
  const cls = await db.class.create({
    data: { name: `Lớp16 ${rand}`, courseId: course.id, centerId: c, teacherId: opts.teacherId ?? null, status: "ACTIVE" },
    select: { id: true },
  });
  const date = new Date(Date.now() - (opts.daysAgo ?? 0) * DAY);
  const sess = await db.classSession.create({
    data: { classId: cls.id, date, centerId: c, status: "SCHEDULED" },
    select: { id: true, date: true },
  });
  return { centerId: c, classId: cls.id, sessionId: sess.id, date: sess.date };
}

test.describe("[#16-DB] attendance:edit theo cơ sở + cách ly + notify GV", () => {
  let c1 = "", c2 = "";

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-16", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-16", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    c1 = await centerIdOf("CS1");
    c2 = await centerIdOf("CS2");
  });

  test("[#16-DB1] CSKH (CENTER_SALES_CSM)@CS1: attendance:edit CS1=OK, CS2=chặn (cách ly)", async () => {
    const u = await makeUser("csm1", "CS1", "CENTER_SALES_CSM", "SALES_CSM");
    const actor = await resolveActorUncached(u.id);
    expect(can(actor, "attendance:edit", { centerId: c1 })).toBe(true);
    expect(can(actor, "attendance:edit", { centerId: c2 })).toBe(false);
  });

  test("[#16-DB2] CENTER_CLASS_MANAGER@CS1: attendance:edit + attendance:view CS1=OK, CS2=chặn", async () => {
    const u = await makeUser("ccm1", "CS1", "CENTER_CLASS_MANAGER", "SALES_CSM");
    const actor = await resolveActorUncached(u.id);
    expect(can(actor, "attendance:edit", { centerId: c1 })).toBe(true);
    expect(can(actor, "attendance:view", { centerId: c1 })).toBe(true);
    expect(can(actor, "attendance:edit", { centerId: c2 })).toBe(false);
  });

  test("[#16-DB3] cách ly: CSKH CS1 — scopedDb.findUnique buổi CS2 → null (buổi CS1 vẫn đọc được)", async () => {
    const u = await makeUser("csm2", "CS1", "CENTER_SALES_CSM", "SALES_CSM");
    const actor = await resolveActorUncached(u.id);
    const s1 = await seedSession({ center: "CS1", daysAgo: 2 });
    const s2 = await seedSession({ center: "CS2", daysAgo: 2 });

    const sdb = scopedDb(actor);
    expect(await sdb.classSession.findUnique({ where: { id: s1.sessionId } })).not.toBeNull();
    // Buổi CS2 ngoài tầm nhìn → null → markAttendance trả "Buổi học không tồn tại".
    expect(await sdb.classSession.findUnique({ where: { id: s2.sessionId } })).toBeNull();
  });

  test("[#16-DB4] TEACHER giữ attendance:mark (lớp mình) nhưng KHÔNG có attendance:edit", async () => {
    const teacher = await seedUser({ email: testEmail("gv1"), role: "TEACHER" });
    await assignUserOrgRole(SA, {
      userId: teacher.id, orgUnitId: await orgId("CS1"), roleId: await roleIdOf("TEACHER"), reason: "seed #16",
    });
    // Lớp có teacherId = GV → resolveActor nạp classId vào assignedClassIds.
    const s = await seedSession({ center: "CS1", teacherId: teacher.id, daysAgo: 0 });
    const actor = await resolveActorUncached(teacher.id);

    expect(can(actor, "attendance:mark", { classId: s.classId })).toBe(true);
    // Không hạ chuẩn nhưng cũng KHÔNG được nâng: GV không có quyền sửa/hồi tố.
    expect(can(actor, "attendance:edit", { centerId: c1 })).toBe(false);
  });

  test("[#16-DB5] notify GV: buổi bị sửa → GV đứng lớp nhận StaffNotification; sửa bởi chính GV → không tự báo", async () => {
    const teacher = await seedUser({ email: testEmail("gv2"), role: "TEACHER" });
    const csm = await makeUser("csm3", "CS1", "CENTER_SALES_CSM", "SALES_CSM");

    // (a) CSKH sửa → GV nhận thông báo.
    const s1 = await seedSession({ center: "CS1", teacherId: teacher.id, daysAgo: 2 });
    await notifyTeacherAttendanceEdited({ sessionId: s1.sessionId, editedByUserId: csm.id, editedByName: "CSKH A" });
    const notifs = await db.staffNotification.findMany({ where: { userId: teacher.id } });
    expect(notifs.length).toBe(1);
    expect(notifs[0].category).toBe("CLASS");
    expect(notifs[0].dedupeKey).toBe(`attendance.edited:${s1.sessionId}`);

    // (b) GV tự sửa buổi của mình → KHÔNG tạo thông báo (không tự báo mình).
    const s2 = await seedSession({ center: "CS1", teacherId: teacher.id, daysAgo: 1 });
    await notifyTeacherAttendanceEdited({ sessionId: s2.sessionId, editedByUserId: teacher.id, editedByName: "GV" });
    const forS2 = await db.staffNotification.count({
      where: { userId: teacher.id, dedupeKey: `attendance.edited:${s2.sessionId}` },
    });
    expect(forS2).toBe(0);
  });
});
