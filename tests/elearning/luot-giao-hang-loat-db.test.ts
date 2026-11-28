// @vitest-environment node
/**
 * [LGH-DB] Gia hạn / thu hồi HÀNG LOẠT theo danh sách id chọn trong MỘT lượt giao — Postgres thật, qua `runAction` với actor Đào tạo cơ sở CS1.
 * Danh sách id đến từ client nên KHÔNG đáng tin: server chỉ thao tác trên dòng thuộc ĐÚNG lượt giao VÀ trong tầm nhìn `scopedDb`.
 *  · id của người CS2 / của lượt giao KHÁC / không tồn tại ⇒ không bị đụng tới (đối chứng dương: id hợp lệ được xử lý), được báo trong `khongThay`;
 *  · thu hồi một phần KHÔNG đóng cả lượt giao (chỉ phạm vi LUOT_GIAO mới đóng);
 *  · quá trần 500 id bị Zod chặn; thiếu lý do bị từ chối.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_LGH_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { runAction } from "../../lib/actions/factory";
import { resolveActorUncached } from "../../lib/auth/actor";
import { db } from "../../lib/db";
import { scopedDb } from "../../lib/db-scope";
import { cauHinhGiaHan, cauHinhThuHoi } from "../../lib/elearning/assignment-lifecycle";
import { napChiTietLuotGiao } from "../../lib/elearning/luot-giao-view";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 90_000;
const P = "CI_LGH_";
const HAU_TO = "@lgh.test";
const HAN = new Date("2026-12-01T03:00:00.000Z");

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnReminder.deleteMany({ where: { enrollment: { userId: { in: ids } } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnAssignment.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
}

describe.skipIf(!RUN_DB_TESTS)("[LGH-DB] thao tác hàng loạt trong một lượt giao (Postgres thật)", () => {
  let dt = "";
  let cs1 = { centerId: "", orgUnitId: "" };
  let cs2 = { centerId: "", orgUnitId: "" };
  let khoaId = "";
  let n = 0;

  type Ca = { luotId: string; luotKhacId: string; e1: string; e2: string; eCS2: string; eKhac: string };

  async function dung(): Promise<Ca> {
    n += 1;
    const lg = async (tieuDe: string, co: typeof cs1) =>
      (
        await db.trnAssignment.create({
          data: { title: `${P}${tieuDe}${n}`, contentType: "COURSE", contentId: khoaId, audienceMode: "STATIC", status: "ACTIVE", allowLate: true, completionRuleJson: { kieu: "MOI_BAI_BAT_BUOC" }, createdByUserId: dt, ...co },
          select: { id: true },
        })
      ).id;
    const luotId = await lg("A", cs1);
    const luotKhacId = await lg("B", cs1);
    let k = 0;
    const gd = async (assignmentId: string, co: typeof cs1) => {
      k += 1;
      const u = await seedUser({ email: `u${n}x${k}${HAU_TO}`, role: "TEACHER", name: `${P}Nguoi${n}x${k}` });
      return (
        await db.trnEnrollment.create({
          data: { courseId: khoaId, userId: u.id, cycle: 1, status: "IN_PROGRESS", source: "ASSIGNMENT", assignmentId, dueAt: HAN, dueAtOriginal: HAN, snapJobTitle: "NV", ...co },
          select: { id: true },
        })
      ).id;
    };
    return { luotId, luotKhacId, e1: await gd(luotId, cs1), e2: await gd(luotId, cs1), eCS2: await gd(luotId, cs2), eKhac: await gd(luotKhacId, cs1) };
  }

  const actor = async () => resolveActorUncached(dt);
  const giaHan = async (pham: unknown, reason: string | null = "Sự cố hạ tầng ngày 12/11") =>
    runAction(cauHinhGiaHan, await actor(), { pham, themNgay: 7 } as never, { actorName: "lgh", reason });
  const thuHoi = async (pham: unknown, reason: string | null = "Người học đã chuyển bộ phận") =>
    runAction(cauHinhThuHoi, await actor(), { pham } as never, { actorName: "lgh", reason });
  const han = async (id: string) => (await db.trnEnrollment.findUniqueOrThrow({ where: { id }, select: { dueAt: true } })).dueAt?.getTime();

  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    const a = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    const b = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true, centerId: true } });
    cs1 = { centerId: a.centerId as string, orgUnitId: a.id };
    cs2 = { centerId: b.centerId as string, orgUnitId: b.id };
    dt = (await seedUser({ email: `dt${HAU_TO}`, role: "TRAINING", name: `${P}DT` })).id;
    const r = await db.roleDef.findUniqueOrThrow({ where: { code: "TRAINING" }, select: { id: true } });
    await db.userOrgRole.deleteMany({ where: { userId: dt } });
    await db.userOrgRole.create({ data: { userId: dt, orgUnitId: a.id, roleId: r.id, grantedById: dt } });
    khoaId = (
      await db.trnCourse.create({
        data: { code: `${P}K`, slug: `${P.toLowerCase()}k`, title: `${P}Khoá`, status: "PUBLISHED", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL" },
        select: { id: true },
      })
    ).id;
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

  it("[LGH-DB-01] 🔴 gia hạn hàng loạt: chỉ id HỢP LỆ (đúng lượt giao + trong tầm nhìn) được gia hạn; id CS2 / lượt giao khác / không tồn tại không bị đụng và được báo", async () => {
    const c = await dung();
    const r = await giaHan({ kieu: "NHIEU_NGUOI", assignmentId: c.luotId, enrollmentIds: [c.e1, c.e2, c.eCS2, c.eKhac, "khong-ton-tai"] });
    expect(r.res.ok).toBe(true);
    if (!r.res.ok) return;
    expect(r.res.data.soGiaHan).toBe(2);
    expect([...r.res.data.khongThay].sort()).toEqual([c.eCS2, c.eKhac, "khong-ton-tai"].sort());
    // đối chứng dương: hai người hợp lệ ĐÃ được gia hạn (hạn sau mốc cũ)
    expect(await han(c.e1)).toBeGreaterThan(HAN.getTime());
    expect(await han(c.e2)).toBeGreaterThan(HAN.getTime());
    // ÂM: ba id còn lại KHÔNG đổi
    expect(await han(c.eCS2)).toBe(HAN.getTime());
    expect(await han(c.eKhac)).toBe(HAN.getTime());
  }, CASE_TIMEOUT);

  it("[LGH-DB-02] 🔴 thu hồi hàng loạt MỘT PHẦN: chỉ id chọn bị thu hồi; lượt giao KHÔNG bị đóng; người không chọn và người ngoài tầm nhìn còn nguyên", async () => {
    const c = await dung();
    const r = await thuHoi({ kieu: "NHIEU_NGUOI", assignmentId: c.luotId, enrollmentIds: [c.e1, c.eCS2] });
    expect(r.res.ok).toBe(true);
    if (!r.res.ok) return;
    expect(r.res.data.soThuHoi).toBe(1);
    expect(r.res.data.khongThay).toEqual([c.eCS2]);
    const st = async (id: string) => (await db.trnEnrollment.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
    expect(await st(c.e1)).toBe("REVOKED");
    expect(await st(c.e2)).toBe("IN_PROGRESS");
    expect(await st(c.eCS2)).toBe("IN_PROGRESS");
    expect((await db.trnAssignment.findUniqueOrThrow({ where: { id: c.luotId }, select: { status: true } })).status).toBe("ACTIVE");
  }, CASE_TIMEOUT);

  it("[LGH-DB-03] quá 500 id bị chặn; thiếu lý do bị từ chối và KHÔNG đổi gì", async () => {
    const c = await dung();
    const nhieu = Array.from({ length: 501 }, (_, i) => `id-${i}`);
    expect((await giaHan({ kieu: "NHIEU_NGUOI", assignmentId: c.luotId, enrollmentIds: nhieu })).res.ok).toBe(false);
    const thieuLyDo = await giaHan({ kieu: "NHIEU_NGUOI", assignmentId: c.luotId, enrollmentIds: [c.e1] }, null);
    expect(thieuLyDo.res.ok).toBe(false);
    expect(await han(c.e1)).toBe(HAN.getTime());
  }, CASE_TIMEOUT);

  it("[LGH-DB-04] 🔴 màn chi tiết lượt giao: người CS1 thấy ĐÚNG hai người CS1 (không thấy người CS2 của cùng lượt giao); lượt giao không tồn tại ⇒ null", async () => {
    const c = await dung();
    const d = await napChiTietLuotGiao(scopedDb(await actor()), c.luotId);
    expect(d).not.toBeNull();
    expect(d!.dong.map((x) => x.id).sort()).toEqual([c.e1, c.e2].sort());
    expect(d!.dong.every((x) => x.hoTen.startsWith(P))).toBe(true);
    expect(await napChiTietLuotGiao(scopedDb(await actor()), "khong-ton-tai")).toBeNull();
  }, CASE_TIMEOUT);
});
