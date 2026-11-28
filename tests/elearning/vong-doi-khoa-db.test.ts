// @vitest-environment node
/**
 * [VDK-DB] Vòng đời phiên bản khoá (`vongDoiKhoa`) — Postgres thật, đi qua `runAction` với actor Đào tạo thật.
 *  · gửi duyệt/duyệt/xuất bản GHI AI + KHI NÀO (cột D5) và CHỤP nội dung phiên bản: đủ mọi bài còn sống, vân tay thật;
 *  · 🔴 hồi quy của lỗi có sẵn: bản nháp mở từ khoá ĐÃ XUẤT BẢN bắt đầu RỖNG — xuất bản nó không được làm số bài của khoá rơi về
 *    những bài mới thêm; cờ `required` kế thừa từ bản đã xuất bản;
 *  · so sánh bản: sửa nội dung bài giữa hai lần chụp ⇒ vân tay đổi; bản cũ (vân tay rỗng) KHÔNG bị coi là đã sửa;
 *  · trả lại không chụp; lưu trữ ghi `archivedAt`.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_VDK_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { runAction } from "../../lib/actions/factory";
import { resolveActorUncached } from "../../lib/auth/actor";
import { db } from "../../lib/db";
import { bamNoiDungBai } from "../../lib/elearning/ban-noi-dung";
import { cauHinhVongDoiKhoa, docDanBaiChoMan } from "../../lib/elearning/course-authoring";
import { scopedDb } from "../../lib/db-scope";
import { napDuyetKhoa } from "../../lib/elearning/soan-khoa-view";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 90_000;
const P = "CI_VDK_";
const HAU_TO = "@vdk.test";

async function cleanup() {
  await db.trnCourseVersionLesson.deleteMany({ where: { version: { course: { code: { startsWith: P } } } } });
  await db.trnCourseVersion.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnLesson.deleteMany({ where: { module: { course: { code: { startsWith: P } } } } });
  await db.trnModule.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
}

describe.skipIf(!RUN_DB_TESTS)("[VDK-DB] vòng đời phiên bản khoá (Postgres thật)", () => {
  let dt = ""; // Đào tạo
  let n = 0;

  async function dungKhoa(o: { daXuatBan?: boolean } = {}) {
    n += 1;
    const k = await db.trnCourse.create({
      data: { code: `${P}K${n}`, slug: `${P.toLowerCase()}k${n}`, title: `${P}Khoá ${n}`, status: o.daXuatBan ? "PUBLISHED" : "DRAFT", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL" },
      select: { id: true },
    });
    const m = await db.trnModule.create({ data: { courseId: k.id, title: `${P}Chương ${n}`, orderIndex: 0 }, select: { id: true } });
    const bai = async (i: number, ten: string) =>
      (await db.trnLesson.create({ data: { moduleId: m.id, title: `${P}${ten}`, kind: "READ", orderIndex: i, contentMd: `Nội dung ${ten}`, minReadSeconds: 10 }, select: { id: true } })).id;
    return { courseId: k.id, moduleId: m.id, bai };
  }

  const chay = async (courseId: string, hanhDong: "GUI_DUYET" | "TRA_LAI" | "DUYET" | "XUAT_BAN" | "LUU_TRU") =>
    runAction(cauHinhVongDoiKhoa, await resolveActorUncached(dt), { courseId, hanhDong }, { actorName: "vdk", reason: `Lý do ${hanhDong} đủ dài` });
  const dongBan = (versionId: string) => db.trnCourseVersionLesson.findMany({ where: { versionId }, orderBy: { lessonId: "asc" } });

  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    dt = (await seedUser({ email: `dt${HAU_TO}`, role: "TRAINING", name: `${P}DT` })).id;
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const r = await db.roleDef.findUniqueOrThrow({ where: { code: "TRAINING" }, select: { id: true } });
    await db.userOrgRole.deleteMany({ where: { userId: dt } });
    await db.userOrgRole.create({ data: { userId: dt, orgUnitId: cs1.id, roleId: r.id, grantedById: dt } });
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

  it("[VDK-DB-01] 🔴 gửi duyệt: ghi người + lúc gửi; CHỤP đủ mọi bài (kể cả bài chưa có dòng) với vân tay THẬT; bài xoá mềm bị gỡ khỏi bản", async () => {
    const k = await dungKhoa();
    const a = await k.bai(0, "A");
    const b = await k.bai(1, "B");
    const xoa = await k.bai(2, "Xoa");
    const v = await db.trnCourseVersion.create({ data: { courseId: k.courseId, major: 1, minor: 0, status: "DRAFT" }, select: { id: true } });
    // Bản nháp chỉ mới có dòng cho A (hash rỗng — như bản trước P5a) và một dòng cho bài sẽ bị xoá.
    await db.trnCourseVersionLesson.create({ data: { versionId: v.id, lessonId: a, orderIndex: 0, required: false, contentHash: "" } });
    await db.trnCourseVersionLesson.create({ data: { versionId: v.id, lessonId: xoa, orderIndex: 2, required: true, contentHash: "" } });
    await db.trnLesson.update({ where: { id: xoa }, data: { deletedAt: new Date() } });

    const r = await chay(k.courseId, "GUI_DUYET");
    expect(r.res.ok).toBe(true);
    const ver = await db.trnCourseVersion.findUniqueOrThrow({ where: { id: v.id } });
    expect(ver).toMatchObject({ status: "PENDING_REVIEW", submittedByUserId: dt });
    expect(ver.submittedAt).not.toBeNull();
    expect(ver.approvedAt).toBeNull();

    const dong = await dongBan(v.id);
    expect(dong.map((d) => d.lessonId).sort()).toEqual([a, b].sort()); // đủ A+B, KHÔNG còn bài xoá
    const bai = await db.trnLesson.findMany({ where: { id: { in: [a, b] } } });
    for (const d of dong) {
      const l = bai.find((x) => x.id === d.lessonId)!;
      expect(d.contentHash).toBe(bamNoiDungBai(l));
      expect(d.contentHash).not.toBe("");
    }
    expect(dong.find((d) => d.lessonId === a)!.required).toBe(false); // dòng có sẵn GIỮ cờ
    expect(dong.find((d) => d.lessonId === b)!.required).toBe(true); // bài mới: mặc định bắt buộc
  }, CASE_TIMEOUT);

  it("[VDK-DB-02] 🔴 duyệt ghi approvedAt; xuất bản CHỤP LẠI: bài sửa tại chỗ giữa hai bước ⇒ vân tay đổi; publishedAt/khoá PUBLISHED", async () => {
    const k = await dungKhoa();
    const a = await k.bai(0, "A");
    await db.trnCourseVersion.create({ data: { courseId: k.courseId, major: 1, minor: 0, status: "DRAFT" } });
    expect((await chay(k.courseId, "GUI_DUYET")).res.ok).toBe(true);
    const v = await db.trnCourseVersion.findFirstOrThrow({ where: { courseId: k.courseId } });
    const h1 = (await dongBan(v.id))[0]!.contentHash;
    const dd = await chay(k.courseId, "DUYET");
    // Hồi quy: đọc dàn bài ở bước duyệt KHÔNG được đẻ bản nháp rỗng (nó chặn xuất bản ngay sau đó).
    expect(await db.trnCourseVersion.count({ where: { courseId: k.courseId } })).toBe(1);
    expect(dd.res.ok).toBe(true);
    expect((await db.trnCourseVersion.findUniqueOrThrow({ where: { id: v.id } })).approvedAt).not.toBeNull();
    await db.trnLesson.update({ where: { id: a }, data: { contentMd: "Nội dung đã SỬA sau khi duyệt" } });
    const xb = await chay(k.courseId, "XUAT_BAN");
    expect(JSON.stringify(xb.res)).toContain("\"ok\":true");
    const h2 = (await dongBan(v.id))[0]!.contentHash;
    expect(h2).not.toBe(h1);
    const sau = await db.trnCourseVersion.findUniqueOrThrow({ where: { id: v.id } });
    expect(sau.status).toBe("PUBLISHED");
    expect(sau.publishedAt).not.toBeNull();
    expect((await db.trnCourse.findUniqueOrThrow({ where: { id: k.courseId } })).status).toBe("PUBLISHED");
  }, CASE_TIMEOUT);

  it("[VDK-DB-03] 🔴 HỒI QUY: bản nháp mới trên khoá ĐÃ XUẤT BẢN (bắt đầu rỗng) ⇒ xuất bản xong vẫn đủ mọi bài và kế thừa cờ bắt buộc từ bản trước", async () => {
    const k = await dungKhoa({ daXuatBan: true });
    const a = await k.bai(0, "A");
    const b = await k.bai(1, "B");
    const v1 = await db.trnCourseVersion.create({ data: { courseId: k.courseId, major: 1, minor: 0, status: "PUBLISHED", publishedAt: new Date() }, select: { id: true } });
    await db.trnCourseVersionLesson.create({ data: { versionId: v1.id, lessonId: a, orderIndex: 0, required: true, contentHash: "" } });
    await db.trnCourseVersionLesson.create({ data: { versionId: v1.id, lessonId: b, orderIndex: 1, required: false, contentHash: "" } }); // B KHÔNG bắt buộc
    // Người soạn mở bản nháp mới (rỗng) và chỉ thêm MỘT bài mới.
    const v2 = await db.trnCourseVersion.create({ data: { courseId: k.courseId, major: 1, minor: 1, status: "DRAFT" }, select: { id: true } });
    const c = await k.bai(2, "C");
    await db.trnCourseVersionLesson.create({ data: { versionId: v2.id, lessonId: c, orderIndex: 2, required: true, contentHash: "" } });
    expect((await dongBan(v2.id)).length).toBe(1); // điều kiện đầu: bản mới chỉ có C

    for (const h of ["GUI_DUYET", "DUYET", "XUAT_BAN"] as const) expect((await chay(k.courseId, h)).res.ok, h).toBe(true);
    const dong = await dongBan(v2.id);
    expect(dong.map((d) => d.lessonId).sort()).toEqual([a, b, c].sort());
    expect(dong.find((d) => d.lessonId === b)!.required).toBe(false); // kế thừa từ bản đã xuất bản
    expect(dong.find((d) => d.lessonId === a)!.required).toBe(true);
    // Số bài BẮT BUỘC của khoá (đúng cách `tinhTienDoBatBuoc` đếm: bản PUBLISHED mới nhất) = 2, không rơi về 1.
    const moiNhat = await db.trnCourseVersion.findFirstOrThrow({ where: { courseId: k.courseId, status: "PUBLISHED" }, orderBy: [{ major: "desc" }, { minor: "desc" }] });
    expect(await db.trnCourseVersionLesson.count({ where: { versionId: moiNhat.id, required: true } })).toBe(2);
  }, CASE_TIMEOUT);

  it("[VDK-DB-04] trả lại KHÔNG chụp (dòng giữ nguyên) và không ghi duyệt; lưu trữ ghi archivedAt", async () => {
    const k = await dungKhoa();
    await k.bai(0, "A");
    const v = await db.trnCourseVersion.create({ data: { courseId: k.courseId, major: 1, minor: 0, status: "DRAFT" }, select: { id: true } });
    expect((await chay(k.courseId, "GUI_DUYET")).res.ok).toBe(true);
    const truoc = await dongBan(v.id);
    const bB = await k.bai(1, "B-sau-khi-gui"); // thêm bài SAU khi gửi
    expect(bB).toBeTruthy();
    expect((await chay(k.courseId, "TRA_LAI")).res.ok).toBe(true);
    expect(await dongBan(v.id)).toEqual(truoc); // trả lại không đụng bản chụp
    expect((await db.trnCourseVersion.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("DRAFT");
    for (const h of ["GUI_DUYET", "DUYET", "XUAT_BAN"] as const) expect((await chay(k.courseId, h)).res.ok).toBe(true);
    expect((await dongBan(v.id)).length).toBe(2); // gửi lại ⇒ chụp bài mới
    const luu = await chay(k.courseId, "LUU_TRU");
    expect(luu.res.ok).toBe(true);
    const khoa = await db.trnCourse.findUniqueOrThrow({ where: { id: k.courseId } });
    expect(khoa.status).toBe("ARCHIVED");
    expect(khoa.archivedAt).not.toBeNull();
  }, CASE_TIMEOUT);

  const sdb = async () => scopedDb(await resolveActorUncached(dt));

  it("[VDK-DB-05] 🔴 HỒI QUY: MỞ TRÌNH SOẠN (đọc dàn bài) khi khoá đang CHỜ DUYỆT không được đẻ bản nháp; và dù có thêm một bản nháp (sửa tiếp lúc chờ duyệt) thì DUYỆT/XUẤT BẢN vẫn chọn đúng bản theo trạng thái nguồn", async () => {
    const k = await dungKhoa();
    await k.bai(0, "A");
    await db.trnCourseVersion.create({ data: { courseId: k.courseId, major: 1, minor: 0, status: "DRAFT" } });
    expect((await chay(k.courseId, "GUI_DUYET")).res.ok).toBe(true);
    await docDanBaiChoMan(await sdb(), k.courseId); // đúng lệnh mà trang trình soạn gọi
    expect(await db.trnCourseVersion.count({ where: { courseId: k.courseId } })).toBe(1);

    // Người soạn sửa tiếp trong lúc chờ duyệt ⇒ một bản nháp v1.1 (đường GHI hợp lệ); bản chờ duyệt vẫn là v1.0.
    await db.trnCourseVersion.create({ data: { courseId: k.courseId, major: 1, minor: 1, status: "DRAFT" } });
    const duyet = await chay(k.courseId, "DUYET");
    expect(duyet.res.ok, JSON.stringify(duyet.res)).toBe(true);
    const xb = await chay(k.courseId, "XUAT_BAN");
    expect(xb.res.ok, JSON.stringify(xb.res)).toBe(true);
    const ban = await db.trnCourseVersion.findMany({ where: { courseId: k.courseId }, orderBy: { minor: "asc" }, select: { minor: true, status: true } });
    expect(ban).toEqual([{ minor: 0, status: "PUBLISHED" }, { minor: 1, status: "DRAFT" }]);
  }, CASE_TIMEOUT);

  it("[VDK-DB-06] 🔴 MỘT quy tắc 'bắt buộc': trình soạn, bản chụp và màn duyệt cho CÙNG con số khi bản nháp chỉ có dòng của một bài", async () => {
    const k = await dungKhoa({ daXuatBan: true });
    const a = await k.bai(0, "A");
    const b = await k.bai(1, "B");
    const c = await k.bai(2, "C");
    const v1 = await db.trnCourseVersion.create({ data: { courseId: k.courseId, major: 1, minor: 0, status: "PUBLISHED", publishedAt: new Date() }, select: { id: true } });
    await db.trnCourseVersionLesson.create({ data: { versionId: v1.id, lessonId: a, orderIndex: 0, required: true, contentHash: "" } });
    await db.trnCourseVersionLesson.create({ data: { versionId: v1.id, lessonId: b, orderIndex: 1, required: false, contentHash: "" } });
    await db.trnCourseVersionLesson.create({ data: { versionId: v1.id, lessonId: c, orderIndex: 2, required: true, contentHash: "" } });
    const v2 = await db.trnCourseVersion.create({ data: { courseId: k.courseId, major: 1, minor: 1, status: "DRAFT" }, select: { id: true } });
    // Bản nháp chỉ có dòng của A (đặt TUỲ CHỌN) và C (bắt buộc — cổng đòi còn ít nhất một bài bắt buộc); B KHÔNG có dòng ⇒ phải kế thừa
    // 'tuỳ chọn' từ bản đã xuất bản, không rơi về 'bắt buộc'.
    await db.trnCourseVersionLesson.create({ data: { versionId: v2.id, lessonId: a, orderIndex: 0, required: false, contentHash: "" } });
    await db.trnCourseVersionLesson.create({ data: { versionId: v2.id, lessonId: c, orderIndex: 2, required: true, contentHash: "" } });

    const trinhSoan = (await docDanBaiChoMan(await sdb(), k.courseId)).chuong.flatMap((c) => c.lessons);
    expect(trinhSoan.find((l) => l.id === b)!.required).toBe(false);
    expect(trinhSoan.find((l) => l.id === a)!.required).toBe(false);

    expect((await chay(k.courseId, "GUI_DUYET")).res.ok).toBe(true);
    const dong = await dongBan(v2.id);
    expect(dong.find((d) => d.lessonId === b)!.required).toBe(false); // bản chụp CÙNG kết luận với trình soạn
    const duyet = await napDuyetKhoa(await sdb(), k.courseId);
    expect(duyet!.baiBatBuoc).toBe(1); // màn duyệt cũng vậy (chỉ C bắt buộc)
    expect(dong.filter((d) => d.required).length).toBe(duyet!.baiBatBuoc);
  }, CASE_TIMEOUT);
});
