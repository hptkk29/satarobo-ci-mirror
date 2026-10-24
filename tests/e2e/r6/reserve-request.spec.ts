/**
 * R6-E3 — Bảo lưu: duyệt ParentRequest RESERVE → enrollment PAUSED atomic, ≤ setting.
 * Postgres LOCAL (.env.test).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached, type Actor } from "../../../lib/auth/actor";
import { clearSettingsCache } from "../../../lib/settings/service";
import { getActiveReserve } from "../../../lib/students/lifecycle";
import {
  approveReserveRequest,
  validateReserveDuration,
  monthsBetween,
} from "../../../lib/students/reserve-service";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

async function orgId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function superActor(): Promise<Actor> {
  const u = await seedUser({ email: testEmail("e3-sa"), role: "SUPER_ADMIN" });
  const r = (await db.roleDef.findUnique({ where: { code: "SUPER_ADMIN" }, select: { id: true } }))!.id;
  await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId("HO"), roleId: r, reason: "seed" });
  return resolveActorUncached(u.id);
}

async function seedStudentWithEnrollment() {
  const course = await db.course.create({ data: { name: "Sata 1", slug: "sata1-e3" } });
  const klass = await db.class.create({ data: { name: "Lớp A", courseId: course.id } });
  const student = await db.student.create({ data: { name: "Bé An", status: "ACTIVE" } });
  const enr = await db.enrollment.create({
    data: { studentId: student.id, classId: klass.id, courseId: course.id, status: "STUDYING" },
  });
  return { student, enr };
}

test.describe("[R6-E3] Bảo lưu enrollment", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seedOrg(["HO"]);
    await seedRoles();
    clearSettingsCache();
  });

  test("[R6-E3-T1-01] duyệt RESERVE → enrollment + student PAUSED, request APPROVED (atomic)", async () => {
    const sa = await superActor();
    const { student, enr } = await seedStudentWithEnrollment();
    const req = await db.parentRequest.create({
      data: { studentId: student.id, type: "RESERVE", content: "Gia đình đi xa 2 tháng" },
    });

    const started = new Date("2026-06-01");
    const res = await approveReserveRequest(sa, {
      requestId: req.id,
      startedAt: started,
      expectedEndAt: new Date("2026-08-01"), // 2 tháng
      actorName: "SA",
    });
    expect(res.ok).toBe(true);

    expect((await db.enrollment.findUnique({ where: { id: enr.id } }))!.status).toBe("PAUSED");
    expect((await db.student.findUnique({ where: { id: student.id } }))!.status).toBe("PAUSED");
    expect((await db.parentRequest.findUnique({ where: { id: req.id } }))!.status).toBe("APPROVED");
  });

  test("[R6-E3-T3-01] thời hạn > 6 tháng (setting) → từ chối RESERVE_TOO_LONG", async () => {
    const sa = await superActor();
    const { student } = await seedStudentWithEnrollment();
    const req = await db.parentRequest.create({
      data: { studentId: student.id, type: "RESERVE", content: "nghỉ dài" },
    });

    const res = await approveReserveRequest(sa, {
      requestId: req.id,
      startedAt: new Date("2026-06-01"),
      expectedEndAt: new Date("2027-02-01"), // 8 tháng
      actorName: "SA",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("RESERVE_TOO_LONG");
    // không đổi trạng thái khi từ chối.
    expect((await db.parentRequest.findUnique({ where: { id: req.id } }))!.status).toBe("PENDING");
  });

  test("[R6-E3-T3-02] validateReserveDuration thuần: biên 6 tháng", () => {
    const from = new Date("2026-01-01");
    expect(validateReserveDuration(from, new Date("2026-06-01"), 6).ok).toBe(true); // ~5 tháng
    expect(validateReserveDuration(from, new Date("2026-09-01"), 6).ok).toBe(false); // 8 tháng
    expect(validateReserveDuration(from, null, 6).ok).toBe(false); // thiếu ngày
    expect(monthsBetween(from, new Date("2026-04-01"))).toBeGreaterThan(2.9);
  });

  test("[R6-E3-T8-01] portal hiển thị: getActiveReserve trả lượt bảo lưu đang hiệu lực", async () => {
    const sa = await superActor();
    const { student } = await seedStudentWithEnrollment();
    const req = await db.parentRequest.create({
      data: { studentId: student.id, type: "RESERVE", content: "ốm" },
    });
    await approveReserveRequest(sa, {
      requestId: req.id,
      startedAt: new Date("2026-06-01"),
      expectedEndAt: new Date("2026-09-01"),
      actorName: "SA",
    });
    const active = await getActiveReserve(student.id);
    expect(active).not.toBeNull();
    expect(active!.isActive).toBe(true);
  });

  test("[R6-E3-T9-01] duyệt RESERVE ghi AuditLog StudentReserve CREATE", async () => {
    const sa = await superActor();
    const { student } = await seedStudentWithEnrollment();
    const req = await db.parentRequest.create({
      data: { studentId: student.id, type: "RESERVE", content: "lý do bảo lưu X" },
    });
    const res = await approveReserveRequest(sa, {
      requestId: req.id,
      startedAt: new Date("2026-06-01"),
      expectedEndAt: new Date("2026-08-01"),
      actorName: "SA",
    });
    expect(res.ok).toBe(true);
    const log = await db.auditLog.findFirst({
      where: { module: "students", entityType: "StudentReserve", action: "CREATE" },
    });
    expect(log).not.toBeNull();
    expect(log!.reason).toBe("lý do bảo lưu X");
  });

  test("[R6-E3-T1-02] yêu cầu đã xử lý → không duyệt lại (CONFLICT)", async () => {
    const sa = await superActor();
    const { student } = await seedStudentWithEnrollment();
    const req = await db.parentRequest.create({
      data: { studentId: student.id, type: "RESERVE", content: "x", status: "APPROVED" },
    });
    const res = await approveReserveRequest(sa, {
      requestId: req.id,
      expectedEndAt: new Date("2026-08-01"),
      actorName: "SA",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("CONFLICT");
  });
});
