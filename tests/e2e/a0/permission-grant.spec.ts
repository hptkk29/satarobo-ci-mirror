/**
 * Nền Hệ thống P0 · US-02 — Integration: bảng PermissionGrant MỚI end-to-end.
 * Postgres LOCAL (.env.test). Chạy nhanh (không cần dựng Next):
 *   A0_SKIP_WEBSERVER=1 pnpm test:e2e:a0 -- permission-grant
 *
 * Đường kiểm: resolveActorUncached (nạp grant từ DB thật) → decidePermissionWithGrant
 * — lõi dùng chung của checkPermission/checkAnyPermission (lib/auth/check-permission.ts).
 * Không gọi checkPermission trực tiếp vì `@/lib/auth` bị stub trong bundle Playwright
 * (auth() luôn null); lõi này CHÍNH XÁC là phần chạy sau auth()+resolveActor.
 *
 * Ràng buộc thiết kế 09/08 được ghim ở đây:
 * - Grant khớp → grant là nguồn sự thật (DENY chặn dù RolePermission vẫn cho).
 * - Bảng grant RỖNG → parity tuyệt đối với đường cũ (evaluatePermission v1/v2/shadow/flag).
 * - Quyền bám theo LẦN resolve actor (cache theo request) — xoá grant thì lần resolve
 *   kế tiếp thấy lại quyền, không dính phiên (TS-02 phần "gỡ → request kế tiếp").
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
import { evaluatePermission } from "../../../lib/auth/permission-eval";
import { decidePermissionWithGrant } from "../../../lib/auth/permission-decision";
import { isRbacV2Enabled } from "../../../lib/flags";
import { syncPermissionRegistry } from "../../../prisma/seed-permission-registry";
import type { CanUser } from "../../../lib/auth/permissions";
import type { Target } from "../../../lib/auth/actor";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

/** Action có thật trong registry + seed-roles: CENTER_ACCOUNTANT giữ RolePermission,
 *  và v1 matrix cho ACCOUNTANT → cả hai đường cũ đều ALLOW (nền để đo DENY grant). */
const ACTION = "payments:manage";

/** sessionUser tối giản cho nhánh v1 của đường cũ (không cần session thật). */
const ACCOUNTANT_SESSION: CanUser = { role: "ACCOUNTANT", roles: ["ACCOUNTANT"] };

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
async function centerIdOf(code: string): Promise<string> {
  const o = await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } });
  if (!o?.centerId) throw new Error(`center ${code}`);
  return o.centerId;
}

async function seedCenters() {
  await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-pg", address: "a", city: "" } });
  await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-pg", address: "b", city: "" } });
}

/** Dựng user CENTER_ACCOUNTANT@CS1 — có RolePermission cho ACTION qua đường cũ. */
async function seedAccountant(): Promise<{ userId: string; roleDefId: string }> {
  const u = await seedUser({ email: testEmail("pg-acc"), role: "ACCOUNTANT" });
  const rid = await roleId("CENTER_ACCOUNTANT");
  await assignUserOrgRole(SA, {
    userId: u.id,
    orgUnitId: await orgId("CS1"),
    roleId: rid,
    reason: "gán test US-02",
  });
  return { userId: u.id, roleDefId: rid };
}

/** Grant DENY toàn phần (fieldMask rỗng, dataScope ALL) cho RoleDef. */
async function createDenyGrant(roleDefId: string): Promise<void> {
  await db.permissionGrant.create({
    data: {
      subjectType: "ROLE",
      subjectId: roleDefId,
      permissionKey: ACTION,
      effect: "DENY",
      dataScope: "ALL",
      fieldMask: [],
    },
  });
}

test.describe("[US-02] PermissionGrant integration (DB thật)", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seedCenters();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    // FK PermissionGrant.permissionKey → PermissionDescriptor.key: nạp registry trước.
    await syncPermissionRegistry(db);
  });

  test("[US-02-IT-01] resolveActor nạp grant: roleIds đúng + permissionGrants đủ row", async () => {
    const { userId, roleDefId } = await seedAccountant();
    await createDenyGrant(roleDefId);

    const actor = await resolveActorUncached(userId);
    expect(actor.roleIds ?? []).toContain(roleDefId);

    const rows = (actor.permissionGrants ?? []).filter((g) => g.permissionKey === ACTION);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subjectType: "ROLE",
      subjectId: roleDefId,
      effect: "DENY",
      dataScope: "ALL",
      fieldMask: [],
    });
  });

  test("[US-02-IT-02] DENY ROLE-grant chặn end-to-end dù RolePermission vẫn cho phép", async () => {
    const { userId, roleDefId } = await seedAccountant();

    // Nền: CHƯA có grant → đường cũ cho phép (sanity, nếu đỏ thì phép đo vô nghĩa).
    const before = await resolveActorUncached(userId);
    expect(
      decidePermissionWithGrant({ sessionUser: ACCOUNTANT_SESSION, actor: before, action: ACTION }),
    ).toBe(true);

    await createDenyGrant(roleDefId);
    const actor = await resolveActorUncached(userId);

    // Đường cũ (evaluatePermission) trên CÙNG actor vẫn true — chứng minh cú chặn
    // đến từ engine grant mới, không phải đường cũ đổi hành vi.
    expect(
      evaluatePermission({
        sessionUser: ACCOUNTANT_SESSION,
        actor,
        action: ACTION,
        flagOn: isRbacV2Enabled(),
      }),
    ).toBe(true);
    expect(
      decidePermissionWithGrant({ sessionUser: ACCOUNTANT_SESSION, actor, action: ACTION }),
    ).toBe(false);
  });

  test("[US-02-IT-03] xoá grant → lần resolve MỚI thấy lại quyền (không cache phiên)", async () => {
    const { userId, roleDefId } = await seedAccountant();
    await createDenyGrant(roleDefId);

    const denied = await resolveActorUncached(userId);
    expect(
      decidePermissionWithGrant({ sessionUser: ACCOUNTANT_SESSION, actor: denied, action: ACTION }),
    ).toBe(false);

    await db.permissionGrant.deleteMany({ where: { subjectId: roleDefId } });

    // "Request" kế tiếp = resolve actor mới → quyền trở lại ngay.
    const restored = await resolveActorUncached(userId);
    expect(
      decidePermissionWithGrant({ sessionUser: ACCOUNTANT_SESSION, actor: restored, action: ACTION }),
    ).toBe(true);

    // Actor CŨ (resolve khi grant còn) vẫn giữ quyết định cũ — quyền bám theo lần
    // resolve (cache theo request), không có cache xuyên phiên nào để phải xả.
    expect(
      decidePermissionWithGrant({ sessionUser: ACCOUNTANT_SESSION, actor: denied, action: ACTION }),
    ).toBe(false);
  });

  test("[US-02-IT-04] bảng PermissionGrant RỖNG → parity tuyệt đối với đường cũ", async () => {
    const { userId } = await seedAccountant();
    const bare = await seedUser({ email: testEmail("pg-bare"), role: "TEACHER" });

    expect(await db.permissionGrant.count()).toBe(0);

    const cs1 = await centerIdOf("CS1");
    const flagOn = isRbacV2Enabled();
    const combos: Array<{ sessionUser: CanUser; actorUserId: string }> = [
      { sessionUser: ACCOUNTANT_SESSION, actorUserId: userId },
      { sessionUser: { role: "TEACHER", roles: ["TEACHER"] }, actorUserId: bare.id },
    ];
    const actions = [ACTION, "students:edit", "leads:view-all"];
    const targets: Array<Target | undefined> = [undefined, { centerId: cs1 }];

    for (const combo of combos) {
      const actor = await resolveActorUncached(combo.actorUserId);
      for (const action of actions) {
        for (const target of targets) {
          const viaEngine = decidePermissionWithGrant({
            sessionUser: combo.sessionUser,
            actor,
            action,
            target,
          });
          const viaLegacy = evaluatePermission({
            sessionUser: combo.sessionUser,
            actor,
            action,
            target,
            flagOn,
          });
          expect(
            viaEngine,
            `parity vỡ: action=${action} target=${JSON.stringify(target ?? null)} user=${combo.actorUserId}`,
          ).toBe(viaLegacy);
        }
      }
    }
  });
});
