// @vitest-environment node
/**
 * [GKT-DB] Giao khoá cho người ĐÃ có lượt ghi danh cùng khoá — Postgres thật, đi qua `runAction(cauHinhTaoLuotGiao)`.
 * Trước đây `createMany skipDuplicates` bỏ qua IM LẶNG: màn báo "đã giao cho N người" dù không có dòng nào mới. Nay:
 *  · lần giao đầu: soGhiDanh = số dòng THẬT tạo ra, daCoGhiDanh rỗng;
 *  · lần giao lại cùng khoá (cùng chu kỳ): soGhiDanh = 0, daCoGhiDanh nêu ĐÍCH DANH người đã có; DB KHÔNG có thêm dòng;
 *  · người chưa có lượt vẫn được giao (đối chứng: trùng của người này không làm hỏng người kia).
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_GKT_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { runAction } from "../../lib/actions/factory";
import { resolveActorUncached } from "../../lib/auth/actor";
import { db } from "../../lib/db";
import { cauHinhTaoLuotGiao } from "../../lib/elearning/assignment-create";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 90_000;
const P = "CI_GKT_";
const HAU_TO = "@gkt.test";

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnReminder.deleteMany({ where: { enrollment: { userId: { in: ids } } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnAssignment.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourseVersion.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  await db.user.updateMany({ where: { id: { in: ids } }, data: { employeeId: null } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: P } } });
}

describe.skipIf(!RUN_DB_TESTS)("[GKT-DB] giao khoá: báo trùng người (Postgres thật)", () => {
  let dt = "";
  let a = { userId: "", ten: `${P}An` };
  let b = { userId: "", ten: `${P}Binh` };
  let khoaId = "";

  async function taoNguoi(ten: string, ma: string, cs: { centerId: string; orgUnitId: string }) {
    const u = await seedUser({ email: `${ma.toLowerCase()}${HAU_TO}`, role: "TEACHER", name: ten });
    const nv = await db.employee.create({
      data: { employeeCode: ma, fullName: ten, jobTitle: "Nhân viên", department: "DAO_TAO", isActive: true, status: "ACTIVE", ...cs },
      select: { id: true },
    });
    await db.user.update({ where: { id: u.id }, data: { employeeId: nv.id } });
    return u.id;
  }

  const giao = async (userIds: string[], title: string) =>
    runAction(
      cauHinhTaoLuotGiao,
      await resolveActorUncached(dt),
      { contentType: "COURSE", contentId: khoaId, title: `${P}${title}`, luat: [], themTayUserId: userIds, soNguoiDaXemTruoc: userIds.length, dueRelativeDays: 30 },
      { actorName: "gkt" },
    );
  const demLuot = (userId: string) => db.trnEnrollment.count({ where: { userId, courseId: khoaId } });

  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    const cs = { centerId: cs1.centerId as string, orgUnitId: cs1.id };
    dt = (await seedUser({ email: `dt${HAU_TO}`, role: "TRAINING", name: `${P}DT` })).id;
    const r = await db.roleDef.findUniqueOrThrow({ where: { code: "TRAINING" }, select: { id: true } });
    await db.userOrgRole.deleteMany({ where: { userId: dt } });
    await db.userOrgRole.create({ data: { userId: dt, orgUnitId: cs1.id, roleId: r.id, grantedById: dt } });
    a = { userId: await taoNguoi(a.ten, `${P}A`, cs), ten: a.ten };
    b = { userId: await taoNguoi(b.ten, `${P}B`, cs), ten: b.ten };
    const k = await db.trnCourse.create({
      data: { code: `${P}K`, slug: `${P.toLowerCase()}k`, title: `${P}Khoá`, status: "PUBLISHED", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL", ...cs },
      select: { id: true },
    });
    khoaId = k.id;
    await db.trnCourseVersion.create({ data: { courseId: k.id, major: 1, minor: 0, status: "PUBLISHED" } });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
      await db.userOrgRole.deleteMany({ where: { userId: dt } });
      await db.user.deleteMany({ where: { email: { endsWith: HAU_TO } } });
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  it("[GKT-DB-01] 🔴 giao lần đầu: tạo đúng số dòng, không báo trùng; giao LẠI cùng khoá ⇒ 0 dòng mới, nêu đích danh người đã có, DB không thêm dòng", async () => {
    const r1 = await giao([a.userId], "lần 1");
    expect(r1.res.ok).toBe(true);
    if (!r1.res.ok) return;
    expect(r1.res.data).toMatchObject({ soGhiDanh: 1, daCoGhiDanh: [] });
    expect(await demLuot(a.userId)).toBe(1);

    // B-13 (20/11/2026): giao LẠI cho đúng những người đã có lượt ⇒ TỪ CHỐI (trước đây: ok + soGhiDanh 0 + một TrnAssignment RỖNG).
    const truoc = await db.trnAssignment.count({ where: { title: { startsWith: P } } });
    const r2 = await giao([a.userId], "lần 2");
    expect(r2.res.ok).toBe(false);
    if (r2.res.ok) return;
    expect(r2.res.error.code).toBe("KHONG_CO_AI_DE_GIAO");
    expect(r2.res.error.message).toContain(a.ten); // nêu ĐÍCH DANH người đã có
    expect(await demLuot(a.userId)).toBe(1); // không có dòng thứ hai
    expect(await db.trnAssignment.count({ where: { title: { startsWith: P } } })).toBe(truoc); // CUỘN LẠI: không có lượt giao rỗng
    expect(await db.trnAssignment.count({ where: { title: `${P}lần 2` } })).toBe(0);
  }, CASE_TIMEOUT);

  it("[GKT-DB-01b] 🔴 B-13: lượt giao ĐỘNG (luật) vẫn được phép rỗng — chỉ lượt TĨNH rỗng bị từ chối (đối chứng: không chặn quá tay)", async () => {
    const r = await runAction(
      cauHinhTaoLuotGiao,
      await resolveActorUncached(dt),
      { contentType: "COURSE", contentId: khoaId, title: `${P}động rỗng`, audienceMode: "DYNAMIC", luat: [{ truong: "department", toan: "IN", giaTri: ["KHONG_CO_PHONG_NAY"] }], themTayUserId: [], soNguoiDaXemTruoc: 0, dueRelativeDays: 30 },
      { actorName: "gkt" },
    );
    // Luật động có thể bị từ chối vì CÚ PHÁP luật (không phải vì rỗng) — chỉ khẳng định: KHÔNG bị chặn bởi mã KHONG_CO_AI_DE_GIAO.
    if (!r.res.ok) expect(r.res.error.code).not.toBe("KHONG_CO_AI_DE_GIAO");
    else expect(r.res.data.soGhiDanh).toBe(0);
  }, CASE_TIMEOUT);

  it("[GKT-DB-02] 🔴 trộn người đã có + người mới: chỉ người mới được tính vào soGhiDanh và có dòng; người đã có được nêu tên", async () => {
    const r = await giao([a.userId, b.userId], "lần 3");
    expect(r.res.ok).toBe(true);
    if (!r.res.ok) return;
    expect(r.res.data.soGhiDanh).toBe(1);
    expect(r.res.data.daCoGhiDanh.map((x) => x.employeeCode)).toEqual([`${P}A`]);
    expect(await demLuot(b.userId)).toBe(1);
    expect(await demLuot(a.userId)).toBe(1);
  }, CASE_TIMEOUT);
});
