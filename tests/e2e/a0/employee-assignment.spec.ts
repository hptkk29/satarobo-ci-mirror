/**
 * A0-08 — EmployeeOrgAssignment: CRUD/validation + CỐT LÕI "assignment KHÔNG sinh quyền".
 * Postgres LOCAL.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { can } from "../../../lib/auth/can";
import {
  createAssignment,
  getActiveAssignments,
  getStaffOfCenter,
  AssignmentError,
} from "../../../lib/org/assignment-service";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };
const HR = { id: "hr-user", name: "HR" };
const orgId = async (code: string) =>
  (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
const centerId = async (code: string) =>
  (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!.centerId!;

let empSeq = 0;
async function makeEmployee() {
  empSeq++;
  return db.employee.create({
    data: { employeeCode: `E${empSeq}-${Date.now() % 100000}`, fullName: `NV ${empSeq}`, jobTitle: "GV", department: "DAO_TAO" },
  });
}

async function expectErr(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    if (e instanceof AssignmentError) return expect(e.code).toBe(code);
    throw e;
  }
  throw new Error(`Mong đợi AssignmentError(${code})`);
}

test.describe("[A0-08] EmployeeOrgAssignment", () => {
  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-ea", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-ea", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  });

  test("[A0-08-T1-01] tạo đủ 5 assignmentType (AC1)", async () => {
    const cs1 = await orgId("CS1");
    for (const t of ["PRIMARY", "SECONDARY", "SUPPORT", "SUBSTITUTE", "SHARED"] as const) {
      const emp = await makeEmployee();
      const { assignment } = await createAssignment(HR, { employeeId: emp.id, orgUnitId: cs1, assignmentType: t });
      expect(assignment.assignmentType).toBe(t);
    }
  });

  test("[A0-08-T1-02] getStaffOfCenter(CS1) = NV active tại CS1 (AC8)", async () => {
    const cs1 = await orgId("CS1");
    const e1 = await makeEmployee();
    const e2 = await makeEmployee();
    await createAssignment(HR, { employeeId: e1.id, orgUnitId: cs1, assignmentType: "PRIMARY" });
    await createAssignment(HR, { employeeId: e2.id, orgUnitId: await orgId("CS2"), assignmentType: "PRIMARY" });
    const staff = await getStaffOfCenter(cs1);
    expect(staff).toEqual([e1.id]);
  });

  test("[A0-08-T2-01] effectiveTo < effectiveFrom → từ chối (AC5)", async () => {
    const emp = await makeEmployee();
    await expectErr(
      createAssignment(HR, {
        employeeId: emp.id, orgUnitId: await orgId("CS1"), assignmentType: "SUPPORT",
        effectiveFrom: new Date("2026-07-01"), effectiveTo: new Date("2026-06-01"),
      }),
      "EFFECTIVE_RANGE",
    );
  });

  test("[A0-08-T2-02] allocationPercent=101 → từ chối (AC6)", async () => {
    const emp = await makeEmployee();
    await expectErr(
      createAssignment(HR, { employeeId: emp.id, orgUnitId: await orgId("CS1"), assignmentType: "SHARED", allocationPercent: 101 }),
      "ALLOCATION_RANGE",
    );
  });

  test("[A0-08-T2-03] tổng allocation active > 100 → cảnh báo (AC6)", async () => {
    const cs1 = await orgId("CS1");
    const emp = await makeEmployee();
    await createAssignment(HR, { employeeId: emp.id, orgUnitId: cs1, assignmentType: "PRIMARY", allocationPercent: 70 });
    const { warning } = await createAssignment(HR, { employeeId: emp.id, orgUnitId: await orgId("CS2"), assignmentType: "SUPPORT", allocationPercent: 50 });
    expect(warning).toContain("120");
  });

  test("[A0-08-T2-04] PRIMARY thứ 2 active → từ chối (AC7)", async () => {
    const cs1 = await orgId("CS1");
    const emp = await makeEmployee();
    await createAssignment(HR, { employeeId: emp.id, orgUnitId: cs1, assignmentType: "PRIMARY" });
    await expectErr(
      createAssignment(HR, { employeeId: emp.id, orgUnitId: await orgId("CS2"), assignmentType: "PRIMARY" }),
      "PRIMARY_EXISTS",
    );
  });

  test("[A0-08-T2-05] orgUnit soft-deleted → từ chối", async () => {
    const cs1 = await orgId("CS1");
    await db.orgUnit.update({ where: { id: cs1 }, data: { deletedAt: new Date() } });
    const emp = await makeEmployee();
    await expectErr(
      createAssignment(HR, { employeeId: emp.id, orgUnitId: cs1, assignmentType: "SUPPORT" }),
      "ORG_INVALID",
    );
  });

  test("[A0-08-T7-01] assignment hết hạn → không còn active (AC4)", async () => {
    const emp = await makeEmployee();
    await createAssignment(HR, {
      employeeId: emp.id, orgUnitId: await orgId("CS1"), assignmentType: "SUBSTITUTE",
      effectiveFrom: new Date("2000-01-01"), effectiveTo: new Date("2001-01-01"),
    });
    expect(await getActiveAssignments(emp.id)).toHaveLength(0);
  });

  test("[A0-08-T9-01] tạo assignment → ghi AuditLog (AC9)", async () => {
    const emp = await makeEmployee();
    const { assignment } = await createAssignment(HR, { employeeId: emp.id, orgUnitId: await orgId("CS1"), assignmentType: "PRIMARY", reason: "phân công mới" });
    const log = await db.auditLog.findFirst({ where: { entityType: "EmployeeOrgAssignment", entityId: assignment.id } });
    expect(log?.module).toBe("employees");
    expect(log?.action).toBe("CREATE");
  });

  // ─── CỐT LÕI OI-4: assignment KHÔNG sinh quyền ───
  test("[A0-08-T4-01] NV chỉ có assignment (không UserOrgRole) → KHÔNG có quyền (AC2)", async () => {
    const cs1 = await orgId("CS1");
    const user = await seedUser({ email: testEmail("emp-only"), role: "TEACHER" });
    const emp = await db.employee.create({
      data: { employeeCode: `EO-${Date.now() % 100000}`, fullName: "Emp Only", jobTitle: "GV", department: "DAO_TAO" },
    });
    await db.user.update({ where: { id: user.id }, data: { employeeId: emp.id } });
    await createAssignment(HR, { employeeId: emp.id, orgUnitId: cs1, assignmentType: "PRIMARY" });

    const actor = await resolveActorUncached(user.id); // KHÔNG có UserOrgRole
    expect(actor.orgRoles).toHaveLength(0);
    expect(can(actor, "students:view-all", { centerId: await centerId("CS1") })).toBe(false);
  });

  test("[A0-08-T4-02] NV thêm UserOrgRole tương ứng → có quyền (AC3)", async () => {
    const cs1 = await orgId("CS1");
    const user = await seedUser({ email: testEmail("emp-role"), role: "TEACHER" });
    const roleId = (await db.roleDef.findUnique({ where: { code: "CENTER_MANAGER" }, select: { id: true } }))!.id;
    await assignUserOrgRole(SA, { userId: user.id, orgUnitId: cs1, roleId, reason: "cấp quyền" });

    const actor = await resolveActorUncached(user.id);
    expect(can(actor, "students:view-all", { centerId: await centerId("CS1") })).toBe(true);
  });
});
