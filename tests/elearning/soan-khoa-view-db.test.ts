// @vitest-environment node
/**
 * [SKV-DB] Dữ liệu màn Soạn khoá (danh sách có tab) và màn DUYỆT (so bản + cổng) — Postgres thật, qua `scopedDb` của actor Đào tạo.
 *  · danh sách: trạng thái các phiên bản tới đúng khoá (tab "Chờ duyệt" tồn tại được dù `TrnCourse.status` còn DRAFT);
 *  · duyệt: so SỐNG với bản đã xuất bản (thêm/bớt/đổi nội dung/đổi bắt buộc), "đã đổi kể từ lúc gửi", tên người gửi, cổng dàn bài;
 *  · 🔴 cách ly cơ sở: khoá của cơ sở KHÁC không có trong danh sách và màn duyệt trả null (đối chứng dương: khoá cơ sở mình có).
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_SKV_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { resolveActorUncached } from "../../lib/auth/actor";
import { db } from "../../lib/db";
import { scopedDb } from "../../lib/db-scope";
import { chupBan } from "../../lib/elearning/ban-noi-dung";
import { moBanNhap } from "../../lib/elearning/sao-chep-khi-ghi";
import { napDanhSachSoanKhoa, napDuyetKhoa } from "../../lib/elearning/soan-khoa-view";
import { napTongQuanDaoTao } from "../../lib/elearning/dao-tao-overview";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_SKV_";
const HAU_TO = "@skv.test";

async function cleanup() {
  await db.trnCourseVersionLesson.deleteMany({ where: { version: { course: { code: { startsWith: P } } } } });
  await db.trnCourseVersion.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnLesson.deleteMany({ where: { module: { course: { code: { startsWith: P } } } } });
  await db.trnModule.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
}

describe.skipIf(!RUN_DB_TESTS)("[SKV-DB] danh sách + màn duyệt Soạn khoá (Postgres thật)", () => {
  let dt = "";
  let gui = "";
  let cs1 = { centerId: "", orgUnitId: "" };
  let cs2 = { centerId: "", orgUnitId: "" };
  let n = 0;

  async function dungKhoa(o: { status?: "DRAFT" | "PUBLISHED"; co?: typeof cs1 } = {}) {
    n += 1;
    const k = await db.trnCourse.create({
      data: {
        code: `${P}K${n}`, slug: `${P.toLowerCase()}k${n}`, title: `${P}Khoá ${n}`, status: o.status ?? "DRAFT", visibility: "ASSIGNED_ONLY",
        selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL", ...(o.co ?? cs1),
      },
      select: { id: true },
    });
    const m = await db.trnModule.create({ data: { courseId: k.id, title: `${P}Chương ${n}`, orderIndex: 0 }, select: { id: true } });
    let i = 0;
    const bai = async (ten: string) => {
      i += 1;
      return (await db.trnLesson.create({ data: { moduleId: m.id, title: `${P}${ten}`, kind: "READ", orderIndex: i, contentMd: `ND ${ten}`, minReadSeconds: 10 }, select: { id: true } })).id;
    };
    return { id: k.id, bai };
  }
  const actor = async () => scopedDb(await resolveActorUncached(dt));

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
    gui = (await seedUser({ email: `gui${HAU_TO}`, role: "TRAINING", name: `${P}Nguoi Gui` })).id;
    const r = await db.roleDef.findUniqueOrThrow({ where: { code: "TRAINING" }, select: { id: true } });
    await db.userOrgRole.deleteMany({ where: { userId: dt } });
    await db.userOrgRole.create({ data: { userId: dt, orgUnitId: a.id, roleId: r.id, grantedById: dt } });
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

  it("[SKV-DB-01] 🔴 danh sách: trạng thái phiên bản tới đúng khoá (khoá DRAFT vẫn có bản PENDING_REVIEW); khoá cơ sở KHÁC không hiện, khoá cơ sở mình hiện", async () => {
    const a = await dungKhoa();
    await db.trnCourseVersion.create({ data: { courseId: a.id, major: 1, minor: 0, status: "PENDING_REVIEW" } });
    const b = await dungKhoa({ status: "PUBLISHED" });
    await db.trnCourseVersion.createMany({ data: [{ courseId: b.id, major: 1, minor: 0, status: "PUBLISHED" }, { courseId: b.id, major: 1, minor: 1, status: "DRAFT" }] });
    const khac = await dungKhoa({ co: cs2 });
    const ds = await napDanhSachSoanKhoa(await actor());
    const lay = (id: string) => ds.find((k) => k.id === id);
    expect(lay(a.id)).toMatchObject({ status: "DRAFT", banTrangThai: ["PENDING_REVIEW"] });
    expect(lay(b.id)?.banTrangThai.sort()).toEqual(["DRAFT", "PUBLISHED"]);
    expect(lay(khac.id)).toBeUndefined();
  }, CASE_TIMEOUT);

  it("[SKV-DB-02] 🔴 duyệt: so với bản đã xuất bản — thêm/bớt/đổi nội dung/đổi bắt buộc; kèm người gửi; cổng dàn bài hợp lệ", async () => {
    const k = await dungKhoa({ status: "PUBLISHED" });
    const giu = await k.bai("Giu");
    const sua = await k.bai("Sua");
    const bo = await k.bai("Bo");
    const batBuoc = await k.bai("BatBuoc");
    const v1 = await db.trnCourseVersion.create({ data: { courseId: k.id, major: 1, minor: 0, status: "PUBLISHED", publishedAt: new Date("2026-11-01T03:00:00.000Z") }, select: { id: true } });
    await chupBan(db as never, { versionId: v1.id, courseId: k.id, banTruocId: null }); // bản đã xuất bản có vân tay thật
    // Sau đó: sửa chữ, xoá mềm một bài, thêm một bài, đổi một bài sang tuỳ chọn trong bản mới.
    await db.trnLesson.update({ where: { id: sua }, data: { contentMd: "ND đã SỬA" } });
    await db.trnLesson.update({ where: { id: bo }, data: { deletedAt: new Date() } });
    const moi = await k.bai("Moi");
    // Bản nháp kiểu cũ (sinh trước B-11: không `clonedFromVersionId`), đang ở DRAFT đúng lúc bước GỬI DUYỆT chụp — rồi mới sang PENDING_REVIEW như vòng đời thật.
    const v2 = await db.trnCourseVersion.create({ data: { courseId: k.id, major: 1, minor: 1, status: "DRAFT" }, select: { id: true } });
    await db.trnCourseVersionLesson.create({ data: { versionId: v2.id, lessonId: batBuoc, orderIndex: 4, required: false, contentHash: "" } });
    await chupBan(db as never, { versionId: v2.id, courseId: k.id, banTruocId: v1.id }); // như bước GỬI DUYỆT
    await db.trnCourseVersion.update({ where: { id: v2.id }, data: { status: "PENDING_REVIEW", submittedByUserId: gui, submittedAt: new Date("2026-11-17T03:00:00.000Z") } });

    const d = await napDuyetKhoa(await actor(), k.id);
    expect(d).not.toBeNull();
    expect(d!.ban).toMatchObject({ nhan: "v1.1", status: "PENDING_REVIEW", nguoiGui: `${P}Nguoi Gui` });
    expect(d!.banDaPhat?.nhan).toBe("v1.0");
    expect(d!.kiem.ok).toBe(true);
    const s = d!.soSanh!;
    expect(s.them.map((b) => b.lessonId)).toEqual([moi]);
    expect(s.bot.map((b) => b.lessonId)).toEqual([bo]);
    expect(s.doiNoiDung.map((b) => b.lessonId)).toEqual([sua]);
    expect(s.doiBatBuoc.map((b) => b.lessonId)).toEqual([batBuoc]);
    expect(s.doiBatBuoc[0]).toMatchObject({ tu: true, den: false });
    expect([...s.them, ...s.bot].map((b) => b.lessonId).concat(s.doiNoiDung.map((b) => b.lessonId))).not.toContain(giu); // bài giữ nguyên KHÔNG bị liệt kê
    expect(d!.doiSauKhiGui).toBe(0); // vừa chụp lúc gửi ⇒ chưa đổi gì kể từ đó
    expect(d!.tongBai).toBe(4); // giu, sua, batBuoc, moi (bo đã xoá)
    expect(d!.baiBatBuoc).toBe(3);

    // Sửa tại chỗ SAU khi gửi duyệt ⇒ người duyệt được báo.
    await db.trnLesson.update({ where: { id: giu }, data: { contentMd: "ND sửa sau khi gửi" } });
    expect((await napDuyetKhoa(await actor(), k.id))!.doiSauKhiGui).toBe(1);
  }, CASE_TIMEOUT);

  it("[SKV-DB-03] 🔴 dàn bài lỗi ⇒ kiem.ok=false kèm lý do; khoá chưa từng xuất bản ⇒ soSanh=null; không có bản đang làm việc ⇒ null", async () => {
    const k = await dungKhoa(); // chương RỖNG
    await db.trnCourseVersion.create({ data: { courseId: k.id, major: 1, minor: 0, status: "PENDING_REVIEW" } });
    const d = await napDuyetKhoa(await actor(), k.id);
    expect(d!.kiem.ok).toBe(false);
    expect(d!.kiem.loi.some((l) => l.code === "CHUONG_RONG")).toBe(true);
    expect(d!.soSanh).toBeNull();
    const chiDaPhat = await dungKhoa({ status: "PUBLISHED" });
    await db.trnCourseVersion.create({ data: { courseId: chiDaPhat.id, major: 1, minor: 0, status: "PUBLISHED" } });
    expect(await napDuyetKhoa(await actor(), chiDaPhat.id)).toBeNull();
  }, CASE_TIMEOUT);

  it("[SKV-DB-04] 🔴 cách ly cơ sở: màn duyệt của khoá cơ sở KHÁC ⇒ null (đối chứng dương: khoá cơ sở mình có dữ liệu)", async () => {
    const khac = await dungKhoa({ co: cs2 });
    await khac.bai("A");
    await db.trnCourseVersion.create({ data: { courseId: khac.id, major: 1, minor: 0, status: "PENDING_REVIEW" } });
    expect(await napDuyetKhoa(await actor(), khac.id)).toBeNull();
    const minh = await dungKhoa();
    await minh.bai("A");
    await db.trnCourseVersion.create({ data: { courseId: minh.id, major: 1, minor: 0, status: "PENDING_REVIEW" } });
    expect(await napDuyetKhoa(await actor(), minh.id)).not.toBeNull();
  }, CASE_TIMEOUT);

  it("[SKV-DB-05] 🔴 màn duyệt chọn bản CHỜ DUYỆT dù có thêm bản NHÁP mới hơn (không nói 'còn là nháp')", async () => {
    const k = await dungKhoa();
    await k.bai("A");
    await db.trnCourseVersion.create({ data: { courseId: k.id, major: 1, minor: 0, status: "PENDING_REVIEW" } });
    await db.trnCourseVersion.create({ data: { courseId: k.id, major: 1, minor: 1, status: "DRAFT" } });
    const d = await napDuyetKhoa(await actor(), k.id);
    expect(d!.ban).toMatchObject({ nhan: "v1.0", status: "PENDING_REVIEW" });
  }, CASE_TIMEOUT);

  it("[SKV-DB-06] 🔴 'đổi thứ tự' đúng (B-11: thứ tự là của DÒNG phiên bản): sắp lại ở bản nháp TRƯỚC khi xuất bản ⇒ bản đã xuất bản ghi thứ tự MỚI nên không báo oan ở lần so sau; sắp lại ở bản kế tiếp ⇒ báo đúng hai bài, không phải đổi nội dung", async () => {
    const k = await dungKhoa({ status: "PUBLISHED" });
    const a = await k.bai("A");
    const b = await k.bai("B");
    const hoanDoi = async (versionId: string) => {
      const [ra, rb] = await Promise.all([
        db.trnCourseVersionLesson.findFirstOrThrow({ where: { versionId, lessonId: a } }),
        db.trnCourseVersionLesson.findFirstOrThrow({ where: { versionId, lessonId: b } }),
      ]);
      await db.trnCourseVersionLesson.update({ where: { id: ra.id }, data: { orderIndex: rb.orderIndex } });
      await db.trnCourseVersionLesson.update({ where: { id: rb.id }, data: { orderIndex: ra.orderIndex } });
    };
    const v1 = await db.trnCourseVersion.create({ data: { courseId: k.id, major: 1, minor: 0, status: "DRAFT" }, select: { id: true } });
    await chupBan(db as never, { versionId: v1.id, courseId: k.id, banTruocId: null }); // bước GỬI DUYỆT
    await hoanDoi(v1.id); // người soạn sắp lại ở bản nháp, trước khi xuất bản
    await chupBan(db as never, { versionId: v1.id, courseId: k.id, banTruocId: null }); // bước XUẤT BẢN chụp lại: KHÔNG ghi đè thứ tự từ bài
    await db.trnCourseVersion.update({ where: { id: v1.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });

    // Bản kế tiếp = bản nháp do cổng ghi mở (sao chép dòng của bản đã xuất bản), rồi gửi duyệt.
    const v2 = await db.$transaction((tx) => moBanNhap(tx as never, k.id));
    await db.trnCourseVersion.update({ where: { id: v2.id }, data: { status: "PENDING_REVIEW", submittedByUserId: gui, submittedAt: new Date() } });
    expect((await napDuyetKhoa(await actor(), k.id))!.soSanh!.doiThuTu).toEqual([]); // không đổi gì kể từ bản đã xuất bản ⇒ KHÔNG báo

    await hoanDoi(v2.id); // sắp lại ở bản kế tiếp
    const r = (await napDuyetKhoa(await actor(), k.id))!.soSanh!;
    expect(r.doiThuTu.map((x) => x.lessonId).sort()).toEqual([a, b].sort());
    expect(r.doiNoiDung).toEqual([]);
  }, CASE_TIMEOUT);

  it("[SKV-DB-07] 🔴 tổng quan Đào tạo: số 'khoá chờ duyệt / đã duyệt' tăng khi khoá CƠ SỞ MÌNH có bản đó, và KHÔNG tăng vì khoá của cơ sở KHÁC", async () => {
    const quyen = { cham: false, giao: false, soan: true, baoCao: false };
    const doc = async () => (await napTongQuanDaoTao(await actor(), quyen, new Date("2026-11-18T03:00:00.000Z"))).soan!;
    const truoc = await doc();
    const minh = await dungKhoa();
    await db.trnCourseVersion.create({ data: { courseId: minh.id, major: 1, minor: 0, status: "PENDING_REVIEW" } });
    const minh2 = await dungKhoa();
    await db.trnCourseVersion.create({ data: { courseId: minh2.id, major: 1, minor: 0, status: "APPROVED" } });
    const khac = await dungKhoa({ co: cs2 });
    await db.trnCourseVersion.create({ data: { courseId: khac.id, major: 1, minor: 0, status: "PENDING_REVIEW" } });
    const sau = await doc();
    expect(sau.khoaChoDuyet - truoc.khoaChoDuyet).toBe(1); // chỉ khoá của mình; khoá CS2 không được cộng
    expect(sau.khoaDaDuyet - truoc.khoaDaDuyet).toBe(1);
  }, CASE_TIMEOUT);
});
