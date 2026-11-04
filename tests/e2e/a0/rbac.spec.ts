/**
 * A0-02 — RBAC động (RoleDef/RolePermission/UserOrgRole + service). Postgres LOCAL.
 * Enforce ở tầng service (không chỉ UI) → test gọi thẳng service với actor khác nhau.
 * Tag [A0-02-T..] đối chiếu RTM.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { ROLE_SEED } from "../../../prisma/seed-roles";
import {
  RbacError,
  createRole,
  updateRole,
  deleteRole,
  setRolePermissions,
  assignUserOrgRole,
  revokeUserOrgRole,
  listUserOrgRoles,
  type RbacActor,
} from "../../../lib/auth/rbac-service";

const SA: RbacActor = { id: "actor-sa", name: "Super Admin", role: "SUPER_ADMIN" };
const HR: RbacActor = { id: "actor-hr", name: "HR User", role: "HO_HR" }; // non-SA

async function expectRbac(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RbacError) {
      expect(e.code).toBe(code);
      return;
    }
    throw e;
  }
  throw new Error(`Mong đợi RbacError(${code}) nhưng không có lỗi`);
}

async function roleId(code: string): Promise<string> {
  const r = await db.roleDef.findUnique({ where: { code }, select: { id: true } });
  if (!r) throw new Error(`role ${code} không tồn tại`);
  return r.id;
}
async function orgId(code: string): Promise<string> {
  const o = await db.orgUnit.findUnique({ where: { code }, select: { id: true } });
  if (!o) throw new Error(`org ${code} không tồn tại`);
  return o.id;
}

test.describe("[A0-02] RBAC động", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[A0-02-T1-02] seedRoles → đúng 16 role, KHÔNG có HO_MANAGER (AC8)", async () => {
    await seedRoles();
    // Hai assert khác nhau, giữ cả hai:
    //  • Số đếm bằng `ROLE_SEED.length` — chứng minh seed GHI ĐỦ mọi dòng của file
    //    nguồn. Tự điều chỉnh khi thêm vai, không cần sửa tay.
    //  • Số ĐÈM cứng — danh mục vai là bề mặt an ninh, thêm một vai phải là việc có
    //    người bấm sửa con số này, không được trôi qua im lặng. 14 → 15: EL-02 thêm AUDITOR
    //    (13 role nền + CENTER_CLASS_MANAGER (#16) + AUDITOR).
    //    15 → 16: GIAM_DOC (25/09/2026 — sinh cùng Cổng dữ liệu agent, GIỮ khi gỡ cổng 02/10/2026
    //    vì Chính sách khuyến mãi gán `promotions:*` cho nó). Ba vai khác của cổng đã gỡ.
    expect(await db.roleDef.count()).toBe(ROLE_SEED.length);
    expect(await db.roleDef.count()).toBe(16);
    expect(await db.roleDef.findUnique({ where: { code: "HO_MANAGER" } })).toBeNull();
    const sa = await db.roleDef.findUnique({ where: { code: "SUPER_ADMIN" } });
    expect(sa?.isSystem).toBe(true);
  });

  test("[A0-02-T1-01] SUPER_ADMIN tạo role + gán permission (AC1)", async () => {
    const role = await createRole(SA, { code: "CS_LEADER", name: "Tổ trưởng", reason: "tạo mới" });
    await setRolePermissions(SA, role.id, {
      permissions: [{ action: "students:view-all", scopeType: "CENTER" }],
      reason: "cấp quyền ban đầu",
    });
    const perms = await db.rolePermission.findMany({ where: { roleId: role.id } });
    expect(perms).toHaveLength(1);
    expect(perms[0]?.action).toBe("students:view-all");
  });

  test("[A0-02-T10-01][A0-02-T4-02] non-SUPER_ADMIN tạo role → FORBIDDEN (AC2)", async () => {
    await expectRbac(
      createRole(HR, { code: "HACK", name: "x", reason: "thử" }),
      "FORBIDDEN",
    );
  });

  test("[A0-02-T2-01] tạo role không reason → bị chặn (AC3)", async () => {
    await expect(
      createRole(SA, { code: "NOREASON", name: "x" }),
    ).rejects.toThrow();
  });

  test("[A0-02-T2-02] gán action ngoài registry → từ chối (AC5)", async () => {
    const role = await createRole(SA, { code: "RTEST", name: "x", reason: "tạo" });
    await expectRbac(
      setRolePermissions(SA, role.id, {
        permissions: [{ action: "evil:hack", scopeType: "GLOBAL" }],
        reason: "thử inject",
      }),
      "ACTION_INVALID",
    );
  });

  test("[A0-02-T2-03] code role trùng → CONFLICT", async () => {
    await createRole(SA, { code: "DUP", name: "x", reason: "tạo" });
    await expectRbac(
      createRole(SA, { code: "DUP", name: "y", reason: "tạo lại" }),
      "ROLE_CODE_CONFLICT",
    );
  });

  test("[A0-02-T1-03] gán 3 UserOrgRole cho 1 user → đọc lại đủ 3 (AC6)", async () => {
    await seedRoles();
    await seedOrg(["HO", "CS1", "CS2"]);
    const user = await seedUser({ email: testEmail("multi-org"), role: "TEACHER" });
    await assignUserOrgRole(SA, { userId: user.id, orgUnitId: await orgId("HO"), roleId: await roleId("HO_MARKETING"), reason: "gán HO" });
    await assignUserOrgRole(SA, { userId: user.id, orgUnitId: await orgId("CS1"), roleId: await roleId("CENTER_SALES_CSM"), reason: "gán CS1" });
    await assignUserOrgRole(SA, { userId: user.id, orgUnitId: await orgId("CS2"), roleId: await roleId("TEACHER"), reason: "gán CS2" });
    expect(await listUserOrgRoles(user.id)).toHaveLength(3);
  });

  test("[A0-02-T7-01] assign lưu đúng effectiveFrom/To/status (AC7)", async () => {
    await seedRoles();
    await seedOrg(["CS1"]);
    const user = await seedUser({ email: testEmail("eff"), role: "TEACHER" });
    const from = new Date("2026-07-01");
    const to = new Date("2026-12-31");
    const a = await assignUserOrgRole(SA, {
      userId: user.id, orgUnitId: await orgId("CS1"), roleId: await roleId("TEACHER"),
      effectiveFrom: from, effectiveTo: to, reason: "có thời hạn",
    });
    expect(a.status).toBe("ACTIVE");
    expect(a.effectiveFrom.getTime()).toBe(from.getTime());
    expect(a.effectiveTo?.getTime()).toBe(to.getTime());
  });

  test("[A0-02-T7-05] gán trùng (user,org,role) → idempotent", async () => {
    await seedRoles();
    await seedOrg(["CS1"]);
    const user = await seedUser({ email: testEmail("idem"), role: "TEACHER" });
    const args = { userId: user.id, orgUnitId: await orgId("CS1"), roleId: await roleId("TEACHER"), reason: "gán" };
    await assignUserOrgRole(SA, args);
    await assignUserOrgRole(SA, args);
    expect(await listUserOrgRoles(user.id)).toHaveLength(1);
  });

  test("[A0-02-T2-06] gán role cho orgUnit soft-deleted → từ chối", async () => {
    await seedRoles();
    await seedOrg(["CS1"]);
    const user = await seedUser({ email: testEmail("softorg"), role: "TEACHER" });
    const cs1 = await orgId("CS1");
    await db.orgUnit.update({ where: { id: cs1 }, data: { deletedAt: new Date() } });
    await expectRbac(
      assignUserOrgRole(SA, { userId: user.id, orgUnitId: cs1, roleId: await roleId("TEACHER"), reason: "gán" }),
      "ORG_INVALID",
    );
  });

  test("[A0-02-T1-05] revoke UserOrgRole → status EXPIRED", async () => {
    await seedRoles();
    await seedOrg(["CS1"]);
    const user = await seedUser({ email: testEmail("rev"), role: "TEACHER" });
    const orgUnitId = await orgId("CS1");
    const rId = await roleId("TEACHER");
    await assignUserOrgRole(SA, { userId: user.id, orgUnitId, roleId: rId, reason: "gán" });
    const revoked = await revokeUserOrgRole(SA, { userId: user.id, orgUnitId, roleId: rId, reason: "thu hồi" });
    expect(revoked.status).toBe("EXPIRED");
    expect(revoked.effectiveTo).not.toBeNull();
  });

  test("[A0-02-T7-02/03] role isSystem: không đổi code / không xóa (AC9)", async () => {
    await seedRoles();
    const sa = await roleId("SUPER_ADMIN");
    await expectRbac(
      updateRole(SA, sa, { code: "SA_RENAMED", reason: "thử đổi" }),
      "ROLE_SYSTEM_IMMUTABLE",
    );
    await expectRbac(deleteRole(SA, sa, "thử xóa"), "ROLE_SYSTEM_IMMUTABLE");
  });

  test("[A0-02-T7-04] xóa role đang gán cho user → chặn (ROLE_IN_USE)", async () => {
    await seedRoles();
    await seedOrg(["CS1"]);
    const role = await createRole(SA, { code: "TEMP_ROLE", name: "Tạm", reason: "tạo" });
    const user = await seedUser({ email: testEmail("inuse"), role: "TEACHER" });
    await assignUserOrgRole(SA, { userId: user.id, orgUnitId: await orgId("CS1"), roleId: role.id, reason: "gán" });
    await expectRbac(deleteRole(SA, role.id, "muốn xóa"), "ROLE_IN_USE");
  });

  test("[A0-02-T9-01] sau create role → RbacAuditLog ghi actor + reason (AC4)", async () => {
    const role = await createRole(SA, { code: "AUD", name: "x", reason: "lý do tạo" });
    const log = await db.rbacAuditLog.findFirst({
      where: { entity: "ROLE", entityId: role.id, action: "CREATE" },
    });
    expect(log?.changedByName).toBe("Super Admin");
    expect(log?.reason).toBe("lý do tạo");
  });
});
