// @vitest-environment node
/**
 * TS-11 — WORKSCOPE MỞ/ĐÓNG TRUY CẬP CƠ SỞ (US-10) trên Postgres thật.
 *
 * ⚠️ "GV-HO" ở TS-11 LÀ NGƯỜI BIÊN CHẾ **PHÒNG BAN** CỦA HỘI SỞ (phòng Đào tạo), KHÔNG
 * phải người neo vai tại chính node HO. Vai neo tại HO/ROOT là cross-center theo thiết kế
 * (`isHoLevel` → thấy mọi cơ sở), nên với người đó điều động không có gì để nới; và sửa
 * điều đó chính là lỗ rò quyền đã phải gỡ ở US-05 (CLAUDE.md, mục V7 — "ĐỪNG nới V7 cho
 * HO mang centerId"). Phòng Đào tạo là DEPARTMENT dưới HO, dưới nó không có cơ sở nào ⇒
 * tự nhiên không thấy dữ liệu cơ sở nào cho tới khi có điều động. Đó đúng là ca nghiệp vụ
 * US-10 mô tả: "giáo viên biên chế HO được điều đến cơ sở dạy mà không đổi biên chế".
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE. `assertTestDb()` chặn chạy ngoài
 * Postgres local; dọn theo tiền tố `CI_WS_` ở beforeAll VÀ afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { resolveActorUncached } from "../../lib/auth/actor";
import { can } from "../../lib/auth/can";
import { scopedDb } from "../../lib/db-scope";
import { childPath } from "../../lib/org/path";

import { RUN_DB_TESTS as RUN_DB_TESTS_CHUNG } from "../_helpers/db-gate";
// CỔNG CHẠY dùng chung — xem `tests/_helpers/db-gate.ts`. Từ 04/09/2026 cổng này
// ĐÒI THÊM `ALLOW_DB_RESET=1`: `pnpm test:unit` trần gọi tới đây sẽ SKIP thay vì
// TRUNCATE sạch DB đang làm việc. Chạy thật bằng `pnpm test:chat-db` / `test:nen-db`.
const RUN = RUN_DB_TESTS_CHUNG;

const CASE_TIMEOUT = 60_000;
const HOOK_TIMEOUT = 180_000;
const P = "CI_WS_";

if (!RUN) {
  console.warn("[work-scope] SKIP: DATABASE_URL không trỏ Postgres local.");
}

let W: {
  gv: string;
  assignmentId: string;
  phongDaoTaoId: string;
  cs1OrgUnitId: string;
  cs1CenterId: string;
  cs2CenterId: string;
  lopCuaMinh: string;
  lopNguoiKhac: string;
};

async function cleanup() {
  const users = await db.user.findMany({
    where: { email: { startsWith: P } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  const positions = await db.position.findMany({
    where: { title: { startsWith: P } },
    select: { id: true },
  });
  const pIds = positions.map((p) => p.id);

  await db.class.deleteMany({ where: { name: { startsWith: P } } });
  if (pIds.length > 0) {
    const asg = await db.positionAssignment.findMany({
      where: { positionId: { in: pIds } },
      select: { id: true },
    });
    await db.workScope.deleteMany({ where: { assignmentId: { in: asg.map((a) => a.id) } } });
    await db.positionAssignment.deleteMany({ where: { positionId: { in: pIds } } });
    await db.positionRole.deleteMany({ where: { positionId: { in: pIds } } });
    await db.position.deleteMany({ where: { id: { in: pIds } } });
  }
  if (ids.length > 0) {
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  await db.orgUnit.deleteMany({ where: { code: `${P}DAOTAO` } });
  await db.course.deleteMany({ where: { name: { startsWith: P } } });
}

describe.skipIf(!RUN)("TS-11 · WorkScope mở/đóng truy cập cơ sở (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();

    const ho = await db.orgUnit.findUniqueOrThrow({
      where: { code: "HO" },
      select: { id: true, path: true, depth: true },
    });
    const cs1 = await db.orgUnit.findUniqueOrThrow({
      where: { code: "CS1" },
      select: { id: true, centerId: true },
    });
    const cs2 = await db.orgUnit.findUniqueOrThrow({
      where: { code: "CS2" },
      select: { id: true, centerId: true },
    });

    // Phòng Đào tạo: DEPARTMENT dưới HO — biên chế của giáo viên, KHÔNG có cơ sở nào bên dưới.
    const phongDaoTao = await db.orgUnit.create({
      data: {
        code: `${P}DAOTAO`,
        name: `${P}Phòng Đào tạo`,
        type: "DEPARTMENT",
        parentId: ho.id,
        path: childPath(ho.path, `${P}DAOTAO`),
        depth: (ho.depth ?? 0) + 1,
      },
      select: { id: true },
    });

    const role = await db.roleDef.findUniqueOrThrow({
      where: { code: "TEACHER" },
      select: { id: true },
    });
    const gv = await seedUser({ email: `${P}gv@ci.test`, name: `${P}GV`, role: "TEACHER" });
    const gvKhac = await seedUser({
      email: `${P}gv2@ci.test`,
      name: `${P}GV2`,
      role: "TEACHER",
    });

    const position = await db.position.create({
      data: {
        title: `${P}Giáo viên Đào tạo`,
        orgUnitId: phongDaoTao.id,
        roles: { create: [{ roleId: role.id }] },
      },
      select: { id: true },
    });
    const assignment = await db.positionAssignment.create({
      data: { positionId: position.id, userId: gv.id, kind: "PRIMARY" },
      select: { id: true },
    });

    const course = await db.course.upsert({
      where: { slug: `${P.toLowerCase()}khoa` },
      update: {},
      create: { name: `${P}Khoá`, slug: `${P.toLowerCase()}khoa`, totalSessions: 8 },
      select: { id: true },
    });

    // Hai lớp CÙNG ở CS1: một lớp GV này dạy, một lớp giáo viên khác dạy.
    const lopCuaMinh = await db.class.create({
      data: {
        name: `${P}Lop cua minh`,
        courseId: course.id,
        centerId: cs1.centerId as string,
        teacherId: gv.id,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    const lopNguoiKhac = await db.class.create({
      data: {
        name: `${P}Lop nguoi khac`,
        courseId: course.id,
        centerId: cs1.centerId as string,
        teacherId: gvKhac.id,
        status: "ACTIVE",
      },
      select: { id: true },
    });

    W = {
      gv: gv.id,
      assignmentId: assignment.id,
      phongDaoTaoId: phongDaoTao.id,
      cs1OrgUnitId: cs1.id,
      cs1CenterId: cs1.centerId as string,
      cs2CenterId: cs2.centerId as string,
      lopCuaMinh: lopCuaMinh.id,
      lopNguoiKhac: lopNguoiKhac.id,
    };
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDb();
    }
  }, HOOK_TIMEOUT);

  it(
    "[AC2 · đối chứng âm] chưa điều động ⇒ KHÔNG thấy cơ sở nào, dù vai TEACHER đã có",
    async () => {
      const actor = await resolveActorUncached(W.gv);
      // Vai đã vào (đường US-08 chạy) — nên cái thiếu ở đây đúng là PHẠM VI, không phải quyền.
      expect(actor.permissions.some((p) => p.roleCode === "TEACHER")).toBe(true);
      expect(actor.visibleCenterIds).toEqual([]);

      // ⚠️ ĐO BẰNG `scopedDb`, KHÔNG đo bằng `can(...,{centerId})`: với TEACHER gần như
      // mọi action seed GLOBAL, nên cách ly cơ sở của vai này đến từ scopedDb chứ không
      // từ scopeType (CLAUDE.md, ghi chú đầu prisma/seed-roles.ts). Gác test bằng can()
      // ở đây sẽ xanh/đỏ vì lý do chẳng liên quan gì tới điều động.
      const lop = await scopedDb(actor).class.findMany({
        where: { centerId: W.cs1CenterId },
        select: { id: true },
      });
      expect(lop).toEqual([]);
    },
    CASE_TIMEOUT,
  );

  it(
    "[AC1+AC2] điều động CS1 (TEACHING) ⇒ vào được CS1, và CHỈ lớp mình được phân công",
    async () => {
      await db.workScope.create({
        data: {
          assignmentId: W.assignmentId,
          orgUnitId: W.cs1OrgUnitId,
          reason: "TEACHING",
          note: "QĐ điều động CI",
        },
      });

      const actor = await resolveActorUncached(W.gv);
      expect(actor.visibleCenterIds).toEqual([W.cs1CenterId]);
      // KHÔNG kèm CS2: điều động mở đúng một cơ sở, không mở cả khối.
      expect(actor.visibleCenterIds).not.toContain(W.cs2CenterId);

      // Cửa dữ liệu CS1 đã mở…
      const lop = await scopedDb(actor).class.findMany({
        where: { name: { startsWith: P } },
        select: { id: true },
      });
      expect(lop.map((c) => c.id).sort()).toEqual([W.lopCuaMinh, W.lopNguoiKhac].sort());

      // …nhưng THAO TÁC theo lớp vẫn chặn ở lớp người khác: `attendance:mark` của GV
      // seed scope CLASS, khớp theo lớp ĐƯỢC PHÂN CÔNG. Điều động mở CƠ SỞ, không phát
      // thêm lớp — đúng câu "thấy đúng lớp mình được phân công" của TS-11.
      expect(can(actor, "attendance:mark", { classId: W.lopCuaMinh })).toBe(true);
      expect(can(actor, "attendance:mark", { classId: W.lopNguoiKhac })).toBe(false);
    },
    CASE_TIMEOUT,
  );

  it(
    "[AC3] điều động hết hạn ⇒ MẤT truy cập cơ sở NGAY, biên chế + vai KHÔNG đổi",
    async () => {
      const homQua = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await db.workScope.updateMany({
        where: { assignmentId: W.assignmentId },
        data: { effectiveTo: homQua },
      });

      const actor = await resolveActorUncached(W.gv);
      expect(actor.visibleCenterIds).toEqual([]);
      expect(
        await scopedDb(actor).class.findMany({
          where: { centerId: W.cs1CenterId },
          select: { id: true },
        }),
      ).toEqual([]);

      // "quyền HO của GV-HO không đổi": vẫn giữ nguyên vai tại phòng Đào tạo, không bị
      // hạ vai, không thành HO-level, và bản ghi điều động vẫn còn để tra soát.
      expect(actor.orgRoles).toEqual([
        { orgUnitId: W.phongDaoTaoId, roleCode: "TEACHER" },
      ]);
      expect(actor.isHoLevel).toBe(false);
      expect(await db.workScope.count({ where: { assignmentId: W.assignmentId } })).toBe(1);
    },
    CASE_TIMEOUT,
  );

  it(
    "[AC3] điều động CHƯA tới ngày hiệu lực ⇒ chưa mở cửa (không chỉ kiểm ngày hết)",
    async () => {
      const tuanSau = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.workScope.updateMany({
        where: { assignmentId: W.assignmentId },
        data: { effectiveFrom: tuanSau, effectiveTo: null },
      });
      const actor = await resolveActorUncached(W.gv);
      expect(actor.visibleCenterIds).toEqual([]);
    },
    CASE_TIMEOUT,
  );

  it(
    "phân công hết hiệu lực ⇒ điều động cũng tắt theo, dù WorkScope còn hạn",
    async () => {
      // Điều động sống lại...
      await db.workScope.updateMany({
        where: { assignmentId: W.assignmentId },
        data: { effectiveFrom: new Date(Date.now() - 60_000), effectiveTo: null },
      });
      expect((await resolveActorUncached(W.gv)).visibleCenterIds).toEqual([W.cs1CenterId]);

      // ...nhưng đóng PHÂN CÔNG thì cả vai lẫn phạm vi rụng: điều động treo trên phân
      // công, không đứng một mình được.
      await db.positionAssignment.update({
        where: { id: W.assignmentId },
        data: { effectiveTo: new Date(Date.now() - 60_000) },
      });
      const actor = await resolveActorUncached(W.gv);
      expect(actor.permissions.some((p) => p.roleCode === "TEACHER")).toBe(false);
      expect(actor.visibleCenterIds).toEqual([]);
    },
    CASE_TIMEOUT,
  );
});
