// @vitest-environment node
/**
 * TS-08 — QUYỀN THEO VỊ TRÍ, KHÔNG THEO NGƯỜI (US-08 AC2/AC3) trên Postgres thật.
 *
 * Đây là AC không thể chứng minh bằng test thuần: nó nói về chuỗi
 * `PositionAssignment → PositionRole → RoleDef → RolePermission → can()`, tức mấy phép
 * JOIN và bộ lọc hiệu lực trong `loadPositionRoleRows`. Bản mock chỉ chứng minh được hình
 * dạng dữ liệu.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE. `assertTestDb()` chặn chạy ngoài
 * Postgres local; dọn theo tiền tố `CI_POS_` ở beforeAll VÀ afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { resolveActorUncached } from "../../lib/auth/actor";
import {
  PrimaryAssignmentConflictError,
  assertSinglePrimary,
} from "../../lib/org/positions";
import { can } from "../../lib/auth/can";

import { RUN_DB_TESTS as RUN_DB_TESTS_CHUNG } from "../_helpers/db-gate";
// CỔNG CHẠY dùng chung — xem `tests/_helpers/db-gate.ts`. Từ 04/09/2026 cổng này
// ĐÒI THÊM `ALLOW_DB_RESET=1`: `pnpm test:unit` trần gọi tới đây sẽ SKIP thay vì
// TRUNCATE sạch DB đang làm việc. Chạy thật bằng `pnpm test:chat-db` / `test:nen-db`.
const RUN = RUN_DB_TESTS_CHUNG;

const CASE_TIMEOUT = 60_000;
const HOOK_TIMEOUT = 180_000;
const P = "CI_POS_";

if (!RUN) {
  console.warn("[position-permission] SKIP: DATABASE_URL không trỏ Postgres local.");
}

let W: { orgUnitId: string; roleId: string; positionId: string; u1: string; u2: string };

async function cleanup() {
  const users = await db.user.findMany({
    where: { email: { startsWith: P } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await db.positionAssignment.deleteMany({ where: { userId: { in: ids } } });
  }
  const positions = await db.position.findMany({
    where: { title: { startsWith: P } },
    select: { id: true },
  });
  const pIds = positions.map((p) => p.id);
  if (pIds.length > 0) {
    await db.positionAssignment.deleteMany({ where: { positionId: { in: pIds } } });
    await db.positionRole.deleteMany({ where: { positionId: { in: pIds } } });
    await db.position.deleteMany({ where: { id: { in: pIds } } });
  }
  if (ids.length > 0) {
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

describe.skipIf(!RUN)("TS-08 · quyền theo Position (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();

    const org = await db.orgUnit.findUniqueOrThrow({
      where: { code: "CS1" },
      select: { id: true },
    });
    // Vai có sẵn trong seed, quyền của nó là thứ ta đi kiểm ở đầu kia.
    const role = await db.roleDef.findUniqueOrThrow({
      where: { code: "CENTER_MANAGER" },
      select: { id: true },
    });
    const u1 = await seedUser({ email: `${P}u1@ci.test`, name: `${P}U1`, role: "TEACHER" });
    const u2 = await seedUser({ email: `${P}u2@ci.test`, name: `${P}U2`, role: "TEACHER" });

    const position = await db.position.create({
      data: {
        title: `${P}Quản lý CS1`,
        orgUnitId: org.id,
        isManagerial: true,
        roles: { create: [{ roleId: role.id }] },
      },
      select: { id: true },
    });

    W = { orgUnitId: org.id, roleId: role.id, positionId: position.id, u1: u1.id, u2: u2.id };
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDb();
    }
  }, HOOK_TIMEOUT);

  it(
    "chưa có phân công ⇒ KHÔNG có quyền nào của vị trí (đối chứng âm)",
    async () => {
      const actor = await resolveActorUncached(W.u1);
      expect(actor.permissions.some((p) => p.roleCode === "CENTER_MANAGER")).toBe(false);
      expect(can(actor, "classes:edit", { centerId: "bat-ky" })).toBe(false);
    },
    CASE_TIMEOUT,
  );

  it(
    "[AC2] nhận phân công vào vị trí ⇒ hưởng ĐỦ bộ quyền của vị trí, không cấu hình thêm",
    async () => {
      await db.positionAssignment.create({
        data: { positionId: W.positionId, userId: W.u1, kind: "PRIMARY" },
      });
      const actor = await resolveActorUncached(W.u1);
      expect(actor.permissions.some((p) => p.roleCode === "CENTER_MANAGER")).toBe(true);
      // Và scope đi theo ĐƠN VỊ CỦA VỊ TRÍ — bằng chứng vai vào đúng đường `buildActor`,
      // không phải một đường quyền thứ hai.
      expect(actor.visibleCenterIds.length).toBeGreaterThan(0);
      expect(actor.orgRoles.some((r) => r.orgUnitId === W.orgUnitId)).toBe(true);
    },
    CASE_TIMEOUT,
  );

  it(
    "[AC3] gỡ phân công ⇒ MẤT quyền ngay ở request kế tiếp",
    async () => {
      await db.positionAssignment.deleteMany({ where: { userId: W.u1 } });
      const actor = await resolveActorUncached(W.u1);
      expect(actor.permissions.some((p) => p.roleCode === "CENTER_MANAGER")).toBe(false);
    },
    CASE_TIMEOUT,
  );

  it(
    "[AC3] người KẾ NHIỆM nhận cùng vị trí ⇒ có đúng bộ quyền đó, vị trí không phải cấu hình lại",
    async () => {
      await db.positionAssignment.create({
        data: { positionId: W.positionId, userId: W.u2, kind: "PRIMARY" },
      });
      const actor = await resolveActorUncached(W.u2);
      expect(actor.permissions.some((p) => p.roleCode === "CENTER_MANAGER")).toBe(true);
    },
    CASE_TIMEOUT,
  );

  it(
    "[US-09 AC2 · nền] phân công HẾT HẠN ⇒ resolver tự bỏ, KHÔNG cần cron dọn",
    async () => {
      const homQua = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await db.positionAssignment.updateMany({
        where: { userId: W.u2 },
        data: { effectiveTo: homQua },
      });
      const actor = await resolveActorUncached(W.u2);
      expect(actor.permissions.some((p) => p.roleCode === "CENTER_MANAGER")).toBe(false);
      // Lịch sử KHÔNG bị xoá — chỉ đóng hiệu lực (US-09 AC3).
      expect(await db.positionAssignment.count({ where: { userId: W.u2 } })).toBe(1);
    },
    CASE_TIMEOUT,
  );

  it(
    "vị trí bị tắt / xoá mềm ⇒ quyền rụng theo, dù phân công còn hiệu lực",
    async () => {
      await db.positionAssignment.updateMany({
        where: { userId: W.u2 },
        data: { effectiveTo: null },
      });
      await db.position.update({ where: { id: W.positionId }, data: { isActive: false } });
      const actor = await resolveActorUncached(W.u2);
      expect(actor.permissions.some((p) => p.roleCode === "CENTER_MANAGER")).toBe(false);
      await db.position.update({ where: { id: W.positionId }, data: { isActive: true } });
    },
    CASE_TIMEOUT,
  );

  it(
    "[US-09 AC1] đã có PRIMARY còn hiệu lực ⇒ PRIMARY thứ hai bị chặn; CONCURRENT thì không",
    async () => {
      // u2 đang giữ một PRIMARY mở (không thời hạn) từ ca trước.
      const dangGiu = await db.positionAssignment.findFirstOrThrow({
        where: { userId: W.u2, kind: "PRIMARY" },
        select: { id: true },
      });

      await expect(
        assertSinglePrimary({
          userId: W.u2,
          kind: "PRIMARY",
          effectiveFrom: new Date(),
          effectiveTo: null,
        }),
      ).rejects.toBeInstanceOf(PrimaryAssignmentConflictError);

      // Cùng dữ liệu đó nhưng kiểu KIÊM NHIỆM ⇒ cho qua (AC1: không giới hạn).
      await expect(
        assertSinglePrimary({
          userId: W.u2,
          kind: "CONCURRENT",
          effectiveFrom: new Date(),
          effectiveTo: null,
        }),
      ).resolves.toBeUndefined();

      // Sửa CHÍNH bản ghi đang giữ ⇒ không tự va vào mình.
      await expect(
        assertSinglePrimary({
          userId: W.u2,
          kind: "PRIMARY",
          effectiveFrom: new Date(),
          effectiveTo: null,
          ignoreAssignmentId: dangGiu.id,
        }),
      ).resolves.toBeUndefined();
    },
    CASE_TIMEOUT,
  );

  it(
    "[TS-10] CONCURRENT hết hạn hôm qua ⇒ can() KHÔNG tính, lịch sử vẫn đọc được",
    async () => {
      const homQua = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const hetHan = await db.positionAssignment.create({
        data: {
          positionId: W.positionId,
          userId: W.u1,
          kind: "CONCURRENT",
          effectiveFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          effectiveTo: homQua,
        },
        select: { id: true },
      });

      const actor = await resolveActorUncached(W.u1);
      expect(actor.permissions.some((p) => p.roleCode === "CENTER_MANAGER")).toBe(false);
      expect(can(actor, "classes:edit", { centerId: W.orgUnitId })).toBe(false);

      // Không job nào dọn: bản ghi còn nguyên, status vẫn ACTIVE — hết hạn là thuộc tính
      // của resolver (luật cứng #8).
      const con = await db.positionAssignment.findUniqueOrThrow({
        where: { id: hetHan.id },
        select: { status: true, effectiveTo: true },
      });
      expect(con.status).toBe("ACTIVE");
      expect(con.effectiveTo).not.toBeNull();

      // Còn hiệu lực trở lại ⇒ quyền quay về ngay, không cần thao tác nào khác.
      await db.positionAssignment.update({
        where: { id: hetHan.id },
        data: { effectiveTo: null },
      });
      const actor2 = await resolveActorUncached(W.u1);
      expect(actor2.permissions.some((p) => p.roleCode === "CENTER_MANAGER")).toBe(true);
    },
    CASE_TIMEOUT,
  );
});
