/**
 * Nền Hệ thống P0 · US-03 — Integration TS-02: grant GROUP end-to-end (DB thật).
 * Postgres LOCAL (.env.test). Chạy nhanh (không cần dựng Next):
 *   A0_SKIP_WEBSERVER=1 pnpm test:e2e:a0 -- user-group-ts02
 *
 * VIẾT TRƯỚC hiện thực (luật #5) — file này ĐỎ cho tới khi đủ CẢ HAI:
 *   (a) migration UserGroup + UserGroupMember tồn tại (hiện `db.userGroup` là undefined
 *       trên Prisma Client → TypeError ngay setup — đó là màu đỏ ĐÚNG LOẠI);
 *   (b) resolveActorUncached nạp groupIds (membership của nhóm CHƯA soft-delete)
 *       + query PermissionGrant subjectType GROUP.
 *
 * Thiết kế duyệt 09/08 được ghim ở đây:
 * - UserGroup SOFT DELETE (deletedAt) — nhóm đã xoá thì grant của nó VÔ HIỆU ở lần
 *   resolve kế, không cần xoá grant.
 * - UserGroupMember HARD DELETE (gỡ member là mất ngay, audit ở RbacAuditLog).
 * - TS-02: DENY cấp trường của nhóm KHÔNG chặn action (ALLOW đến từ đường cũ qua
 *   RolePermission) — chỉ che trường qua getFieldMask; gỡ khỏi nhóm → request kế
 *   tiếp (= lần resolve actor mới) hết mask, không dính phiên.
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
import { can, getFieldMask } from "../../../lib/permissions/can";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

/** Action nền cho TS-02: CENTER_MANAGER giữ qua RolePermission (GLOBAL, seed-roles) →
 *  đường cũ ALLOW; grant nhóm chỉ can thiệp DENY. */
const ACTION = "students:view-all";

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

async function seedCenters() {
  await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-ug", address: "a", city: "" } });
  await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-ug", address: "b", city: "" } });
}

/** QL-CS1 của kịch bản TS-02: CENTER_MANAGER@CS1 (ALLOW ACTION qua đường cũ). */
async function seedManagerCs1(): Promise<string> {
  const u = await seedUser({ email: testEmail("ug-ql-cs1"), role: "CENTER_MANAGER" });
  await assignUserOrgRole(SA, {
    userId: u.id,
    orgUnitId: await orgId("CS1"),
    roleId: await roleId("CENTER_MANAGER"),
    reason: "gán test US-03",
  });
  return u.id;
}

/** Nhóm + member + 1 grant GROUP cho ACTION. Trả groupId để test thao tác tiếp. */
async function seedGroupWithGrant(input: {
  userId: string;
  effect: "ALLOW" | "DENY";
  fieldMask: string[];
}): Promise<string> {
  const group = await db.userGroup.create({
    data: { name: `Nhóm TS-02 ${input.effect}${input.fieldMask.length > 0 ? " mask" : ""}` },
    select: { id: true },
  });
  await db.userGroupMember.create({
    data: { userId: input.userId, groupId: group.id },
  });
  await db.permissionGrant.create({
    data: {
      subjectType: "GROUP",
      subjectId: group.id,
      permissionKey: ACTION,
      effect: input.effect,
      dataScope: "ALL",
      fieldMask: input.fieldMask,
      reason: "TS-02 integration",
    },
  });
  return group.id;
}

test.describe("[US-03] UserGroup + grant GROUP — TS-02 (DB thật)", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seedCenters();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    // FK PermissionGrant.permissionKey → PermissionDescriptor.key: chỉ cần đúng 1 key.
    await db.permissionDescriptor.create({
      data: { key: ACTION, module: "students", action: "view-all" },
    });
  });

  test("[US-03-IT-01 · TS-02 vế 1] DENY fieldMask ['parentPhone'] của nhóm: action vẫn ALLOW (đường cũ), trường bị che", async () => {
    const userId = await seedManagerCs1();
    const groupId = await seedGroupWithGrant({ userId, effect: "DENY", fieldMask: ["parentPhone"] });

    const actor = await resolveActorUncached(userId);
    // resolveActor phải nạp membership → groupIds (nếu đỏ ở đây là (b) chưa nối dây).
    expect(actor.groupIds ?? []).toContain(groupId);

    // ALLOW đến từ đường cũ (RolePermission GLOBAL của CENTER_MANAGER) — DENY cấp
    // trường KHÔNG được chặn action.
    expect(can(actor, ACTION)).toBe(true);
    // …nhưng trường trong mask phải bị che.
    expect(getFieldMask(actor, ACTION)).toContain("parentPhone");
  });

  test("[US-03-IT-02 · TS-02 vế 2/AC3] gỡ khỏi nhóm → lần resolve MỚI hết mask (không dính phiên)", async () => {
    const userId = await seedManagerCs1();
    const groupId = await seedGroupWithGrant({ userId, effect: "DENY", fieldMask: ["parentPhone"] });

    const truoc = await resolveActorUncached(userId);
    expect(getFieldMask(truoc, ACTION)).toContain("parentPhone");

    // HARD DELETE membership (thiết kế duyệt 09/08 — audit nằm ở RbacAuditLog).
    await db.userGroupMember.delete({
      where: { userId_groupId: { userId, groupId } },
    });

    // "Request kế tiếp" = resolve actor mới → mask rỗng ngay, thấy lại phone.
    const sau = await resolveActorUncached(userId);
    expect(getFieldMask(sau, ACTION)).toEqual([]);
    expect(can(sau, ACTION)).toBe(true);

    // Actor CŨ giữ nguyên quyết định của lần resolve cũ (cache theo request, không
    // có cache phiên nào phải xả — cùng bất biến với [US-02-IT-03]).
    expect(getFieldMask(truoc, ACTION)).toContain("parentPhone");
  });

  test("[US-03-IT-03 · AC2] DENY toàn-action của nhóm thắng ALLOW từ vai; gỡ nhóm → quyền trở lại", async () => {
    const userId = await seedManagerCs1();
    const groupId = await seedGroupWithGrant({ userId, effect: "DENY", fieldMask: [] });

    const biChan = await resolveActorUncached(userId);
    expect(can(biChan, ACTION)).toBe(false);

    await db.userGroupMember.delete({
      where: { userId_groupId: { userId, groupId } },
    });

    const trolai = await resolveActorUncached(userId);
    expect(can(trolai, ACTION)).toBe(true);
  });

  test("[US-03-IT-04] soft delete nhóm (deletedAt) → grant của nhóm VÔ HIỆU ở lần resolve kế", async () => {
    const userId = await seedManagerCs1();
    const groupId = await seedGroupWithGrant({ userId, effect: "DENY", fieldMask: [] });

    const biChan = await resolveActorUncached(userId);
    expect(can(biChan, ACTION)).toBe(false);

    // SOFT DELETE nhóm — member + grant còn nguyên trong DB nhưng không được tính nữa.
    await db.userGroup.update({
      where: { id: groupId },
      data: { deletedAt: new Date() },
    });

    const sau = await resolveActorUncached(userId);
    expect(sau.groupIds ?? []).not.toContain(groupId);
    expect(can(sau, ACTION)).toBe(true);
    expect(getFieldMask(sau, ACTION)).toEqual([]);
  });
});
