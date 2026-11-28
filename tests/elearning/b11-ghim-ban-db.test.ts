// @vitest-environment node
/**
 * [B11-DB] B-11 lát 1 — GHIM PHIÊN BẢN vào lượt học + đọc qua phiên bản — Postgres thật.
 *  · giao khoá ghim `courseVersionId` = bản PUBLISHED mới nhất (có hai bản PUBLISHED thì lấy bản cao hơn); khoá chưa phát hành ⇒ null;
 *  · 🔴 người đang học bản cũ KHÔNG thấy bài thêm ở bản mới, và KHÔNG thấy bài chỉ có ở cây sống (bản nháp đang sửa) — đối chứng dương: người học bản mới thấy;
 *  · 🔴 cờ "bắt buộc" lấy theo bản đã ghim: cùng một bài, hai lượt ghim hai bản ⇒ hai số bài bắt buộc khác nhau;
 *  · 🔴 cổng bài: mở bài ngoài bản của mình bị từ chối; bài trong bản được mở; bản CHƯA CHỤP (vân tay rỗng — dữ liệu cũ) KHÔNG thu hẹp.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_B11_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { runAction } from "../../lib/actions/factory";
import type { ScopedDb } from "../../lib/actions/factory";
import { resolveActorUncached } from "../../lib/auth/actor";
import { db } from "../../lib/db";
import { cauHinhTaoLuotGiao } from "../../lib/elearning/assignment-create";
import { banCuaLuot, kiemBaiTrongBan } from "../../lib/elearning/ban-cua-luot";
import { bamNoiDungBai } from "../../lib/elearning/ban-noi-dung";
import { napDeCuongKhoa } from "../../lib/elearning/course-view";
import { cuonKhoaSauKhiXongBai } from "../../lib/elearning/rollup";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 90_000;
const P = "CI_B11_";
const HAU_TO = "@b11.test";
const sdb = db as unknown as ScopedDb;

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnReminder.deleteMany({ where: { enrollment: { userId: { in: ids } } } });
  await db.trnLessonProgress.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnAssignment.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourseVersionLesson.deleteMany({ where: { version: { course: { code: { startsWith: P } } } } });
  await db.trnCourseVersion.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnLesson.deleteMany({ where: { module: { course: { code: { startsWith: P } } } } });
  await db.trnModule.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  await db.user.updateMany({ where: { id: { in: ids } }, data: { employeeId: null } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: P } } });
  if (ids.length > 0) await db.user.deleteMany({ where: { id: { in: ids } } });
}

describe.skipIf(!RUN_DB_TESTS)("[B11-DB] ghim phiên bản + đọc qua phiên bản (Postgres thật)", () => {
  let dt = "";
  let cs = { centerId: "", orgUnitId: "" };
  let n = 0;

  /** Khoá có hai bản PUBLISHED đã chụp: v1.0 = {A(bắt buộc), B(tuỳ chọn)}, v1.1 = {A, B(bắt buộc), C}; thêm D chỉ có ở cây sống. */
  async function dungKhoa(o: { chupDu?: boolean } = {}) {
    n += 1;
    const chup = o.chupDu !== false;
    const k = await db.trnCourse.create({
      data: { code: `${P}K${n}`, slug: `${P.toLowerCase()}k${n}`, title: `${P}Khoá ${n}`, status: "PUBLISHED", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL", ...cs },
      select: { id: true },
    });
    const m = await db.trnModule.create({ data: { courseId: k.id, title: `${P}Chương ${n}`, orderIndex: 0 }, select: { id: true } });
    const bai = async (i: number, ten: string) =>
      db.trnLesson.create({ data: { moduleId: m.id, title: `${P}${ten}`, kind: "READ", orderIndex: i, contentMd: `Nội dung ${ten}`, minReadSeconds: 10 } });
    const [a, b, c, d] = [await bai(0, "A"), await bai(1, "B"), await bai(2, "C"), await bai(3, "D")];
    const hash = (l: typeof a) => (chup ? bamNoiDungBai(l) : "");
    const v10 = await db.trnCourseVersion.create({ data: { courseId: k.id, major: 1, minor: 0, status: "PUBLISHED", publishedAt: new Date("2026-11-01T00:00:00Z") }, select: { id: true } });
    const v11 = await db.trnCourseVersion.create({ data: { courseId: k.id, major: 1, minor: 1, status: "PUBLISHED", publishedAt: new Date("2026-11-10T00:00:00Z") }, select: { id: true } });
    const dong = (versionId: string, l: typeof a, orderIndex: number, required: boolean) =>
      db.trnCourseVersionLesson.create({ data: { versionId, lessonId: l.id, orderIndex, required, contentHash: hash(l) } });
    await dong(v10.id, a, 0, true);
    await dong(v10.id, b, 1, false);
    await dong(v11.id, a, 0, true);
    await dong(v11.id, b, 1, true);
    await dong(v11.id, c, 2, true);
    return { courseId: k.id, v10: v10.id, v11: v11.id, a: a.id, b: b.id, c: c.id, d: d.id };
  }

  async function dungLuot(courseId: string, tenNguoi: string, courseVersionId: string | null) {
    const u = await seedUser({ email: `${tenNguoi}${HAU_TO}`, role: "TEACHER", name: `${P}${tenNguoi}` });
    const e = await db.trnEnrollment.create({
      data: { courseId, userId: u.id, courseVersionId, cycle: 1, status: "IN_PROGRESS", source: "ASSIGNMENT", centerId: cs.centerId, orgUnitId: cs.orgUnitId, snapJobTitle: "Nhân viên", dueAt: new Date("2027-01-01T00:00:00Z"), dueAtOriginal: new Date("2027-01-01T00:00:00Z") },
      select: { id: true, courseId: true, courseVersionId: true },
    });
    return { userId: u.id, ...e };
  }

  const tenBai = async (e: { id: string; userId: string }) => {
    const r = await napDeCuongKhoa(sdb, { enrollmentId: e.id, userId: e.userId });
    return r!.chuong.flatMap((c) => c.lessons.map((b) => b.title.replace(P, ""))).sort();
  };

  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    cs = { centerId: cs1.centerId as string, orgUnitId: cs1.id };
    dt = (await seedUser({ email: `dt${HAU_TO}`, role: "TRAINING", name: `${P}DT` })).id;
    const r = await db.roleDef.findUniqueOrThrow({ where: { code: "TRAINING" }, select: { id: true } });
    await db.userOrgRole.deleteMany({ where: { userId: dt } });
    await db.userOrgRole.create({ data: { userId: dt, orgUnitId: cs1.id, roleId: r.id, grantedById: dt } });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
      await db.userOrgRole.deleteMany({ where: { userId: dt } });
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  it("[B11-DB-01] 🔴 giao khoá ghim bản PUBLISHED MỚI NHẤT (hai bản PUBLISHED ⇒ bản cao hơn); khoá chưa phát hành ⇒ courseVersionId null", async () => {
    const k = await dungKhoa();
    const chua = await db.trnCourse.create({
      data: { code: `${P}CHUA`, slug: `${P.toLowerCase()}chua`, title: `${P}Chưa phát hành`, status: "DRAFT", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL", ...cs },
      select: { id: true },
    });
    const nguoi = await seedUser({ email: `nguoi-gk${HAU_TO}`, role: "TEACHER", name: `${P}Người` });
    const nv = await db.employee.create({
      data: { employeeCode: `${P}E1`, fullName: `${P}Người`, jobTitle: "Nhân viên", department: "DAO_TAO", isActive: true, status: "ACTIVE", ...cs },
      select: { id: true },
    });
    await db.user.update({ where: { id: nguoi.id }, data: { employeeId: nv.id } });
    const giao = async (contentId: string, title: string) =>
      runAction(cauHinhTaoLuotGiao, await resolveActorUncached(dt), { contentType: "COURSE", contentId, title: `${P}${title}`, luat: [], themTayUserId: [nguoi.id], soNguoiDaXemTruoc: 1, dueRelativeDays: 30 }, { actorName: "b11" });
    expect((await giao(k.courseId, "GK1")).res.ok).toBe(true);
    expect((await giao(chua.id, "GK2")).res.ok).toBe(true);
    const luotK = await db.trnEnrollment.findFirstOrThrow({ where: { userId: nguoi.id, courseId: k.courseId }, select: { courseVersionId: true } });
    const luotChua = await db.trnEnrollment.findFirstOrThrow({ where: { userId: nguoi.id, courseId: chua.id }, select: { courseVersionId: true } });
    expect(luotK.courseVersionId).toBe(k.v11);
    expect(luotChua.courseVersionId).toBeNull();
  }, CASE_TIMEOUT);

  it("[B11-DB-02] 🔴 người học bản CŨ không thấy bài thêm ở bản mới và không thấy bài chỉ có ở cây sống; người học bản MỚI thấy C (đối chứng dương)", async () => {
    const k = await dungKhoa();
    const cu = await dungLuot(k.courseId, "cu", k.v10);
    const moi = await dungLuot(k.courseId, "moi", k.v11);
    expect(await tenBai(cu)).toEqual(["A", "B"]);
    expect(await tenBai(moi)).toEqual(["A", "B", "C"]); // đối chứng: C có thật và hiện ở bản mới
    expect(await tenBai(cu)).not.toContain("D"); // D chỉ nằm ở cây sống (bản nháp đang sửa)
    expect(await tenBai(moi)).not.toContain("D");
  }, CASE_TIMEOUT);

  it("[B11-DB-03] 🔴 cờ bắt buộc theo bản đã ghim: bản cũ có B tuỳ chọn ⇒ 1 bài bắt buộc, bản mới B bắt buộc ⇒ 3", async () => {
    const k = await dungKhoa();
    const cu = await dungLuot(k.courseId, "cu3", k.v10);
    const moi = await dungLuot(k.courseId, "moi3", k.v11);
    expect((await napDeCuongKhoa(sdb, { enrollmentId: cu.id, userId: cu.userId }))!.soBaiBatBuoc).toBe(1);
    expect((await napDeCuongKhoa(sdb, { enrollmentId: moi.id, userId: moi.userId }))!.soBaiBatBuoc).toBe(3);
  }, CASE_TIMEOUT);

  it("[B11-DB-04] 🔴 cổng bài: bài ngoài bản bị từ chối, bài trong bản được mở; lượt chưa ghim (null) đọc theo bản đang phát hành gần nhất", async () => {
    const k = await dungKhoa();
    const cu = await dungLuot(k.courseId, "cu4", k.v10);
    const chuaGhim = await dungLuot(k.courseId, "null4", null);
    expect(await kiemBaiTrongBan(sdb, cu, k.a)).toBeNull(); // đối chứng dương
    expect(await kiemBaiTrongBan(sdb, cu, k.c)).toMatchObject({ code: "LESSON_NOT_IN_VERSION" }); // C chỉ có ở v1.1
    expect(await kiemBaiTrongBan(sdb, cu, k.d)).toMatchObject({ code: "LESSON_NOT_IN_VERSION" }); // D không nằm ở bản nào
    expect(await kiemBaiTrongBan(sdb, chuaGhim, k.c)).toBeNull(); // null ⇒ bản mới nhất (v1.1) có C
    expect(await kiemBaiTrongBan(sdb, chuaGhim, k.d)).toMatchObject({ code: "LESSON_NOT_IN_VERSION" });
  }, CASE_TIMEOUT);

  it("[B11-DB-05] bản CHƯA CHỤP (vân tay rỗng — dữ liệu cũ) KHÔNG thu hẹp: đọc cây sống, mở được mọi bài của khoá", async () => {
    const k = await dungKhoa({ chupDu: false });
    const cu = await dungLuot(k.courseId, "cu5", k.v10);
    expect((await banCuaLuot(sdb, cu)).daKhoa).toBe(false);
    expect(await tenBai(cu)).toEqual(["A", "B", "C", "D"]);
    expect(await kiemBaiTrongBan(sdb, cu, k.d)).toBeNull();
  }, CASE_TIMEOUT);

  it("[B11-DB-06] 🔴 cuộn tiến độ khoá đếm bài bắt buộc theo bản đã ghim: xong A (+B nếu cần) — bản cũ HOÀN THÀNH, bản mới (3 bài bắt buộc) thì chưa", async () => {
    const k = await dungKhoa();
    const cu = await dungLuot(k.courseId, "cu6", k.v10);
    const moi = await dungLuot(k.courseId, "moi6", k.v11);
    for (const e of [cu, moi]) {
      await db.trnLessonProgress.create({ data: { enrollmentId: e.id, userId: e.userId, lessonId: k.a, status: "DONE" } });
      const r = await cuonKhoaSauKhiXongBai(e.id, new Date("2026-12-01T00:00:00Z"));
      expect(r).not.toBeNull();
    }
    expect((await db.trnEnrollment.findUniqueOrThrow({ where: { id: cu.id }, select: { status: true } })).status).toBe("COMPLETED");
    expect((await db.trnEnrollment.findUniqueOrThrow({ where: { id: moi.id }, select: { status: true } })).status).not.toBe("COMPLETED");
  }, CASE_TIMEOUT);
});
