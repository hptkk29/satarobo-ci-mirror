// @vitest-environment node
/**
 * [B11-S] B-11 lát 2 — SAO CHÉP-KHI-GHI theo phiên bản — Postgres thật, đi qua ACTION/hàm server thật với actor Đào tạo thật.
 *
 * Câu chuyện chung: khoá đã xuất bản v1.0 (A, B, V=video, Q=bài kiểm tra), người học L1 + L2 ghim v1.0. Đào tạo SỬA khoá ⇒ mọi thứ phải đi vào BẢN NHÁP:
 *  · sửa bài đọc / thêm câu hỏi chèn video / gắn đề / đổi nguồn video ⇒ bài được TÁCH BẢN, bài gốc BẤT BIẾN;
 *  · thêm bài / sắp lại / đổi cờ bắt buộc ⇒ chỉ ghi dòng phiên bản của nháp;
 *  · người đang học (v1.0) không thấy gì đổi — tập bài, thứ tự, cờ bắt buộc, nội dung, đề — cho tới khi họ được GIAO LẠI;
 *  · hai người soạn cùng lúc ⇒ MỘT bản nháp, MỘT bản tách; cơ sở khác không sửa được; nháp chưa duyệt không tới người học.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_B11S_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { runAction } from "../../lib/actions/factory";
import { resolveActorUncached } from "../../lib/auth/actor";
import { db } from "../../lib/db";
import { scopedDb } from "../../lib/db-scope";
import { kiemBaiTrongBan } from "../../lib/elearning/ban-cua-luot";
import { chupBan } from "../../lib/elearning/ban-noi-dung";
import { capChungNhanChoLuot } from "../../lib/elearning/_handlers/issue-certificate";
import { cauHinhDatBatBuoc, cauHinhNhanBanKhoa, cauHinhSapThuTu, cauHinhTaoBai, cauHinhVongDoiKhoa, docDanBaiChoMan } from "../../lib/elearning/course-authoring";
import { napDanhSachKhoaCuaToi, napDeCuongKhoa } from "../../lib/elearning/course-view";
import { ghiXongBaiThi } from "../../lib/elearning/exam-taking";
import { langGieng, napCayBaiHoc } from "../../lib/elearning/lesson-tree";
import { napTongQuanHocTap } from "../../lib/elearning/dashboard-view";
import { napNguonTimKiem } from "../../lib/elearning/tim-kiem-view";
import { cauHinhGanDeVaoBai } from "../../lib/elearning/exam-authoring";
import { cauHinhGanKhungVaoBai } from "../../lib/elearning/rubric-authoring";
import { cauHinhThemCue, cauHinhXoaCue } from "../../lib/elearning/lesson-cue-authoring";
import { baiCuaBanNhap, ghiBaiDoc, layBaiDeGhi, moBanNhap } from "../../lib/elearning/sao-chep-khi-ghi";
import { napDuyetKhoa } from "../../lib/elearning/soan-khoa-view";
import { cauHinhLuuBaiVideoYoutube } from "../../lib/elearning/video-lesson";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 90_000;
const P = "CI_B11S_";
const HAU_TO = "@b11s.test";

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  // KHÔNG xoá `TrnLessonProgressRevision` trực tiếp (trigger bất biến); xoá bài kéo theo bản chụp (CASCADE).
  await db.trnCertificate.deleteMany({ where: { enrollment: { userId: { in: ids } } } });
  await db.trnLessonProgress.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLessonCue.deleteMany({ where: { lesson: { module: { course: { code: { startsWith: P } } } } } });
  await db.trnCourseVersionLesson.deleteMany({ where: { version: { course: { code: { startsWith: P } } } } });
  await db.trnCourseVersion.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnLesson.deleteMany({ where: { module: { course: { code: { startsWith: P } } } } });
  await db.trnModule.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  await db.trnExam.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnRubric.deleteMany({ where: { code: { startsWith: P } } });
  await db.trnProgram.deleteMany({ where: { code: "HR-2026-B11" } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

describe.skipIf(!RUN_DB_TESTS)("[B11-S] sao chép-khi-ghi theo phiên bản (Postgres thật)", () => {
  let dt = ""; // Đào tạo CS1
  let dt2 = ""; // Đào tạo CS1 thứ hai (soạn đồng thời)
  let dtCs2 = ""; // Đào tạo neo CS2
  let cs1 = { centerId: "", orgUnitId: "" };
  let cs2 = { centerId: "", orgUnitId: "" };
  let n = 0;
  let de1 = "";
  let de2 = "";
  let progId = "";
  let kh1 = "";
  let kh2 = "";

  const actor = async (id: string) => resolveActorUncached(id);
  const sdb = async (id: string) => scopedDb(await actor(id));

  type Khoa = Awaited<ReturnType<typeof dungKhoaDaPhat>>;

  /** Khoá ĐÃ XUẤT BẢN v1.0 (bản chụp thật): A, B (đọc) · V (video 600 giây) · Q (bài kiểm tra gắn đề 1). Hai người học ghim v1.0. */
  async function dungKhoaDaPhat(o: { co?: typeof cs1; task?: boolean; chuong2?: boolean } = {}) {
    n += 1;
    const co = o.co ?? cs1;
    const k = await db.trnCourse.create({
      data: { code: `${P}K${n}`, slug: `${P.toLowerCase()}k${n}`, title: `${P}Khoá ${n}`, programId: progId, status: "PUBLISHED", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL", ...co },
      select: { id: true },
    });
    const m = await db.trnModule.create({ data: { courseId: k.id, title: `${P}Chương ${n}`, orderIndex: 0 }, select: { id: true } });
    const bai = (i: number, ten: string, d: Record<string, unknown>) =>
      db.trnLesson.create({ data: { moduleId: m.id, title: `${P}${ten}`, orderIndex: i, ...d } as never, select: { id: true } }).then((x) => x.id);
    const A = await bai(0, "A", { kind: "READ", contentMd: "Nội dung A gốc", minReadSeconds: 10 });
    const B = await bai(1, "B", { kind: "READ", contentMd: "Nội dung B gốc", minReadSeconds: 10 });
    const V = await bai(2, "V", { kind: "VIDEO", durationSec: 600, videoKey: `elearning/master/${P}${n}/v.mp4` });
    const Q = await bai(3, "Q", { kind: "QUIZ", examId: de1 });
    const T = o.task ? await bai(4, "T", { kind: "TASK", rubricId: kh1 }) : "";
    let chuong2Id = "";
    if (o.chuong2) {
      const m2 = await db.trnModule.create({ data: { courseId: k.id, title: `${P}Chương hai ${n}`, orderIndex: 1 }, select: { id: true } });
      chuong2Id = m2.id;
      await db.trnLesson.create({ data: { moduleId: m2.id, title: `${P}X`, orderIndex: 0, kind: "READ", contentMd: "Nội dung X", minReadSeconds: 10 } });
    }
    const v10 = await db.trnCourseVersion.create({ data: { courseId: k.id, major: 1, minor: 0, status: "DRAFT" }, select: { id: true } });
    await chupBan(db as never, { versionId: v10.id, courseId: k.id, banTruocId: null });
    await db.trnCourseVersion.update({ where: { id: v10.id }, data: { status: "PUBLISHED", publishedAt: new Date("2026-11-01T00:00:00Z") } });
    await db.trnLessonCue.create({ data: { lessonId: V, atSec: 30, inlineJson: { id: "q", type: "single", question: "Gốc?", options: ["a", "b"], correctIndex: 0 }, blocking: false, orderIndex: 0 } });
    await db.trnLesson.update({ where: { id: V }, data: { cueCount: 1 } });
    const dungLuot = async (ten: string, courseVersionId: string | null) => {
      const u = await seedUser({ email: `${ten.toLowerCase()}${n}${HAU_TO}`, role: "TEACHER", name: `${P}${ten}` });
      const e = await db.trnEnrollment.create({
        data: { courseId: k.id, userId: u.id, courseVersionId, cycle: 1, status: "IN_PROGRESS", source: "ASSIGNMENT", ...co, snapJobTitle: "Nhân viên", dueAt: new Date("2027-01-01T00:00:00Z"), dueAtOriginal: new Date("2027-01-01T00:00:00Z") },
        select: { id: true, courseId: true, courseVersionId: true },
      });
      await db.trnLessonProgress.create({ data: { enrollmentId: e.id, userId: u.id, lessonId: A, status: "DONE" } });
      return { userId: u.id, ...e };
    };
    return { courseId: k.id, moduleId: m.id, chuong2Id, A, B, V, Q, T, v10: v10.id, dungLuot, co };
  }

  const tenBai = async (e: { id: string; userId: string }) => {
    const r = await napDeCuongKhoa(scopedDb(await actor(dt)) as never, { enrollmentId: e.id, userId: e.userId });
    return r!.chuong.flatMap((c) => c.lessons.map((b) => b.title.replace(P, "")));
  };
  const dsVersion = (courseId: string) => db.trnCourseVersion.findMany({ where: { courseId }, orderBy: [{ major: "asc" }, { minor: "asc" }], select: { id: true, status: true, major: true, minor: true, clonedFromVersionId: true } });
  const dongCua = (versionId: string) => db.trnCourseVersionLesson.findMany({ where: { versionId }, orderBy: { orderIndex: "asc" }, select: { lessonId: true, orderIndex: true, required: true } });

  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    const a = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    const b = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true, centerId: true } });
    cs1 = { centerId: a.centerId as string, orgUnitId: a.id };
    cs2 = { centerId: b.centerId as string, orgUnitId: b.id };
    const r = await db.roleDef.findUniqueOrThrow({ where: { code: "TRAINING" }, select: { id: true } });
    const dtu = async (ten: string, ou: string) => {
      const id = (await seedUser({ email: `${ten}${HAU_TO}`, role: "TRAINING", name: `${P}${ten}` })).id;
      await db.userOrgRole.deleteMany({ where: { userId: id } });
      await db.userOrgRole.create({ data: { userId: id, orgUnitId: ou, roleId: r.id, grantedById: id } });
      return id;
    };
    dt = await dtu("dt", a.id);
    dt2 = await dtu("dt2", a.id);
    dtCs2 = await dtu("dtcs2", b.id);
    const exam = (ten: string) => db.trnExam.create({ data: { title: `${P}${ten}`, durationMin: 10, passScore: 1, maxScore: 1, maxAttempts: 1, isActive: true }, select: { id: true } }).then((x) => x.id);
    // Khoá phải gắn chương trình (cổng phụ đề đọc `natureTag` của chương trình); OPTIONAL ⇒ không đòi phụ đề.
    progId = (
      await db.trnProgram.create({
        data: { code: "HR-2026-B11", year: 2026, seq: 7771, title: `${P}CT`, primaryFunctionTag: "HR", stageTag: "IN_SERVICE", durationTag: "S", natureTag: "OPTIONAL", formatTag: "ELEARNING", ownerUserId: dt, centerId: cs1.centerId },
        select: { id: true },
      })
    ).id;
    const khung = (ma: string) =>
      db.trnRubric.create({ data: { code: `${P}${ma}`, title: `${P}Khung ${ma}`, status: "ACTIVE", ownerUserId: dt, centerId: cs1.centerId, orgUnitId: cs1.orgUnitId }, select: { id: true } }).then((x) => x.id);
    kh1 = await khung("R1");
    kh2 = await khung("R2");
    de1 = await exam("Đề 1");
    de2 = await exam("Đề 2");
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
      await db.userOrgRole.deleteMany({ where: { userId: { in: [dt, dt2, dtCs2] } } });
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  it("[B11-S-01] 🔴 sửa bài ĐỌC của khoá đã xuất bản ⇒ TÁCH BẢN vào bản nháp; bài gốc + bản v1.0 BẤT BIẾN; người đang học thấy NGUYÊN VĂN cũ", async () => {
    const k = await dungKhoaDaPhat();
    const l1 = await k.dungLuot("l1", k.v10);
    const goc = await db.trnLesson.findUniqueOrThrow({ where: { id: k.A } });
    const g = await ghiBaiDoc(await sdb(dt), k.A, { title: `${P}A đã sửa`, contentMd: "Nội dung A MỚI", minReadSeconds: 12 });
    expect(g.daTachBan).toBe(true);
    expect(g.lessonId).not.toBe(k.A);

    expect(await db.trnLesson.findUniqueOrThrow({ where: { id: k.A } })).toEqual(goc); // bài gốc không đổi một byte
    const tach = await db.trnLesson.findUniqueOrThrow({ where: { id: g.lessonId } });
    expect(tach).toMatchObject({ title: `${P}A đã sửa`, contentMd: "Nội dung A MỚI", forkedFromLessonId: k.A, moduleId: k.moduleId });
    const ver = await dsVersion(k.courseId);
    expect(ver.map((v) => [v.status, `${v.major}.${v.minor}`])).toEqual([["PUBLISHED", "1.0"], ["DRAFT", "1.1"]]);
    expect(ver[1]!.clonedFromVersionId).toBe(k.v10);
    expect((await dongCua(k.v10)).map((d) => d.lessonId).sort()).toEqual([k.A, k.B, k.V, k.Q].sort()); // v1.0 còn đủ 4 bài gốc
    expect((await dongCua(ver[1]!.id)).map((d) => d.lessonId).sort()).toEqual([g.lessonId, k.B, k.V, k.Q].sort()); // nháp: A → bản tách
    expect(await tenBai(l1)).toEqual(["A", "B", "V", "Q"]); // người đang học: tên cũ, 4 bài
  }, CASE_TIMEOUT);

  it("[B11-S-02] 🔴 bản nháp CHƯA DUYỆT không tới người học; người MỚI được giao khi bản nháp còn chưa xuất bản vẫn ghim v1.0; xuất bản v1.1 ⇒ người MỚI thấy bản mới, người CŨ vẫn ở v1.0 với đủ tiến độ", async () => {
    const k = await dungKhoaDaPhat();
    const cu = await k.dungLuot("cu", k.v10);
    const g = await ghiBaiDoc(await sdb(dt), k.A, { title: `${P}A v1.1`, contentMd: "Nội dung A v1.1", minReadSeconds: 12 });
    // Bản nháp tồn tại nhưng chưa ai duyệt: người ghim v1.0 và người ghi danh MỚI (ghim bản đang phát hành) đều KHÔNG thấy bài của nháp.
    expect(await kiemBaiTrongBan(sdb as never && scopedDb(await actor(dt)), cu, g.lessonId)).toMatchObject({ code: "LESSON_NOT_IN_VERSION" });

    // Đi hết vòng đời: gửi duyệt → duyệt → xuất bản (đúng action thật).
    const chay = async (hanhDong: "GUI_DUYET" | "DUYET" | "XUAT_BAN") =>
      runAction(cauHinhVongDoiKhoa, await actor(dt), { courseId: k.courseId, hanhDong }, { actorName: "b11", reason: `Lý do ${hanhDong} đủ dài` });
    for (const h of ["GUI_DUYET", "DUYET", "XUAT_BAN"] as const) {
      const r = await chay(h);
      expect(r.res.ok, JSON.stringify(r.res)).toBe(true);
    }
    const ver = await dsVersion(k.courseId);
    expect(ver.map((v) => v.status)).toEqual(["PUBLISHED", "PUBLISHED"]);
    const v11 = ver[1]!.id;

    // Người mới ghi danh SAU khi v1.1 phát hành: ghim v1.1 (tay, theo đúng bộ ghim) ⇒ thấy tên mới; người cũ giữ v1.0.
    const { banDangPhatHanh } = await import("../../lib/elearning/ban-cua-luot");
    expect(await banDangPhatHanh(db as never, k.courseId)).toBe(v11);
    const moi = await k.dungLuot("moi", v11);
    expect(await tenBai(moi)).toEqual(["A v1.1", "B", "V", "Q"]);
    expect(await tenBai(cu)).toEqual(["A", "B", "V", "Q"]); // KHÔNG tự chuyển sang bản mới
    expect(await db.trnLessonProgress.count({ where: { enrollmentId: cu.id, lessonId: k.A, status: "DONE" } })).toBe(1); // tiến độ còn nguyên ở bài gốc
    expect(await db.trnEnrollment.findUniqueOrThrow({ where: { id: cu.id }, select: { courseVersionId: true } })).toEqual({ courseVersionId: k.v10 });
  }, CASE_TIMEOUT);

  it("[B11-S-03] 🔴 thêm bài · sắp lại · đổi cờ bắt buộc chỉ ghi DÒNG PHIÊN BẢN của nháp: người đang học giữ nguyên tập bài, thứ tự, số bài bắt buộc", async () => {
    const k = await dungKhoaDaPhat();
    const l = await k.dungLuot("l", k.v10);
    const truoc = await napDeCuongKhoa(scopedDb(await actor(dt)) as never, { enrollmentId: l.id, userId: l.userId });
    const a = await actor(dt);

    const them = await runAction(cauHinhTaoBai, a, { moduleId: k.moduleId, title: `${P}Mới thêm`, kind: "READ", required: true }, { actorName: "b11" });
    expect(them.res.ok, JSON.stringify(them.res)).toBe(true);
    const sap = await runAction(cauHinhSapThuTu, a, { loai: "BAI", parentId: k.moduleId, id: k.Q, viTriMoi: 0 }, { actorName: "b11" });
    expect(sap.res.ok, JSON.stringify(sap.res)).toBe(true);
    const co = await runAction(cauHinhDatBatBuoc, a, { courseId: k.courseId, lessonId: k.B, required: false }, { actorName: "b11" });
    expect(co.res.ok, JSON.stringify(co.res)).toBe(true);

    const sau = await napDeCuongKhoa(scopedDb(await actor(dt)) as never, { enrollmentId: l.id, userId: l.userId });
    expect(sau).toEqual(truoc); // đề cương của người đang học KHÔNG đổi một chữ
    const ver = await dsVersion(k.courseId);
    const nhap = await dongCua(ver[1]!.id);
    expect(nhap.length).toBe(5); // 4 bài + bài mới
    expect(nhap[0]!.lessonId).toBe(k.Q); // sắp lại ở bản nháp
    expect(nhap.find((d) => d.lessonId === k.B)!.required).toBe(false);
    expect((await dongCua(k.v10)).map((d) => [d.lessonId, d.orderIndex, d.required])).toEqual(
      [[k.A, 0, true], [k.B, 1, true], [k.V, 2, true], [k.Q, 3, true]], // v1.0 nguyên vẹn
    );
    // Cột `orderIndex` của BÀI không bị đụng (người học bản cũ không bị đổi thứ tự dưới chân).
    expect((await db.trnLesson.findUniqueOrThrow({ where: { id: k.Q } })).orderIndex).toBe(3);
  }, CASE_TIMEOUT);

  it("[B11-S-04] 🔴 gắn ĐỀ khác vào bài kiểm tra đã xuất bản ⇒ bài tách bản mang đề mới, bài gốc GIỮ đề cũ; bài kiểm tra cũ vẫn chấm theo đề của phiên bản đang học; không mở chéo bản", async () => {
    const k = await dungKhoaDaPhat();
    const cu = await k.dungLuot("cu", k.v10);
    const { res } = await runAction(cauHinhGanDeVaoBai, await actor(dt), { lessonId: k.Q, examId: de2 }, { actorName: "b11" });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.data.daTachBan).toBe(true);
    expect((await db.trnLesson.findUniqueOrThrow({ where: { id: k.Q } })).examId).toBe(de1); // bài đang học GIỮ đề cũ
    expect((await db.trnLesson.findUniqueOrThrow({ where: { id: res.data.lessonId } })).examId).toBe(de2);
    const s = scopedDb(await actor(dt));
    expect(await kiemBaiTrongBan(s as never, cu, k.Q)).toBeNull(); // người cũ mở bài cũ (đề cũ)
    expect(await kiemBaiTrongBan(s as never, cu, res.data.lessonId)).toMatchObject({ code: "LESSON_NOT_IN_VERSION" }); // không mở được bài (đề mới) của bản nháp
  }, CASE_TIMEOUT);

  it("[B11-S-05] 🔴 câu hỏi chèn video: thêm/xoá trên bài đã xuất bản tách bản, câu gốc của người đang học NGUYÊN VẸN; xoá bằng id câu cũ nhận lại theo mốc giây", async () => {
    const k = await dungKhoaDaPhat();
    const cauCu = await db.trnLessonCue.findFirstOrThrow({ where: { lessonId: k.V } });
    const CAU = { id: "q2", type: "single" as const, question: "Mới?", options: ["a", "b"], correctIndex: 1 };
    const them = await runAction(cauHinhThemCue, await actor(dt), { lessonId: k.V, atSec: 90, cauHoi: CAU, blocking: false }, { actorName: "b11" });
    expect(them.res.ok, JSON.stringify(them.res)).toBe(true);
    if (!them.res.ok) return;
    const tach = them.res.data.lessonId;
    expect(tach).not.toBe(k.V);
    expect((await db.trnLessonCue.findMany({ where: { lessonId: k.V }, select: { atSec: true } })).map((c) => c.atSec)).toEqual([30]); // gốc: còn đúng câu cũ
    expect((await db.trnLessonCue.findMany({ where: { lessonId: tach }, orderBy: { atSec: "asc" }, select: { atSec: true } })).map((c) => c.atSec)).toEqual([30, 90]); // bản tách: câu cũ + câu mới
    expect((await db.trnLesson.findUniqueOrThrow({ where: { id: k.V } })).cueCount).toBe(1);
    expect((await db.trnLesson.findUniqueOrThrow({ where: { id: tach } })).cueCount).toBe(2);

    // Xoá bằng id của câu GỐC (giao diện còn cầm id cũ) ⇒ xoá câu cùng mốc giây ở BẢN TÁCH; câu gốc còn nguyên.
    const xoa = await runAction(cauHinhXoaCue, await actor(dt), { lessonId: k.V, cueId: cauCu.id }, { actorName: "b11" });
    expect(xoa.res.ok, JSON.stringify(xoa.res)).toBe(true);
    expect((await db.trnLessonCue.findMany({ where: { lessonId: tach }, select: { atSec: true } })).map((c) => c.atSec)).toEqual([90]);
    expect(await db.trnLessonCue.count({ where: { id: cauCu.id } })).toBe(1);
    expect((await db.trnLesson.findUniqueOrThrow({ where: { id: tach } })).cueCount).toBe(1);
    expect(await db.trnCourseVersion.count({ where: { courseId: k.courseId } })).toBe(2); // vẫn MỘT bản nháp
  }, CASE_TIMEOUT);

  it("[B11-S-06] 🔴 đổi NGUỒN video của bài đã xuất bản: bản tách mang nguồn mới, bài gốc + tiến độ người học không đổi, không chụp/đặt lại tiến độ", async () => {
    const k = await dungKhoaDaPhat();
    const cu = await k.dungLuot("cu", k.v10);
    await db.trnLessonProgress.create({ data: { enrollmentId: cu.id, userId: cu.userId, lessonId: k.V, status: "IN_PROGRESS", coveredSec: 200, contentSec: 600, mediaRevision: 1 } });
    const { res } = await runAction(
      cauHinhLuuBaiVideoYoutube,
      await actor(dt),
      { lessonId: k.V, title: `${P}V YouTube`, url: "https://youtu.be/aBcDeFg_H-1", durationSec: 480, coPhuDe: false },
      { actorName: "b11", reason: "đổi nguồn thử B-11" },
    );
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.data.daTachBan).toBe(true);
    const goc = await db.trnLesson.findUniqueOrThrow({ where: { id: k.V } });
    expect(goc).toMatchObject({ youtubeId: null, mediaRevision: 1, durationSec: 600 });
    expect((await db.trnLesson.findUniqueOrThrow({ where: { id: res.data.lessonId } })).youtubeId).toBe("aBcDeFg_H-1");
    expect(await db.trnLessonProgress.findUniqueOrThrow({ where: { enrollmentId_lessonId: { enrollmentId: cu.id, lessonId: k.V } } })).toMatchObject({ coveredSec: 200, status: "IN_PROGRESS", mediaRevision: 1 });
    expect(await db.trnLessonProgressRevision.count({ where: { lessonId: k.V } })).toBe(0);
  }, CASE_TIMEOUT);

  it("[B11-S-07] 🔴 hai người soạn SỬA CÙNG LÚC cùng một bài đã xuất bản ⇒ đúng MỘT bản nháp + MỘT bản tách, không lỗi, cả hai lần ghi đều vào bản tách", async () => {
    const k = await dungKhoaDaPhat();
    const [s1, s2] = [await sdb(dt), await sdb(dt2)];
    const [r1, r2] = await Promise.all([
      ghiBaiDoc(s1, k.A, { title: `${P}A người 1`, contentMd: "Nội dung của người 1", minReadSeconds: 10 }),
      ghiBaiDoc(s2, k.A, { title: `${P}A người 2`, contentMd: "Nội dung của người 2", minReadSeconds: 10 }),
    ]);
    expect(r1.lessonId).toBe(r2.lessonId); // cùng MỘT bản tách
    expect([r1.daTachBan, r2.daTachBan].filter(Boolean)).toHaveLength(1); // đúng một lần tách
    expect(await db.trnLesson.count({ where: { forkedFromLessonId: k.A } })).toBe(1);
    expect((await dsVersion(k.courseId)).map((v) => v.status)).toEqual(["PUBLISHED", "DRAFT"]); // một nháp
    const tach = await db.trnLesson.findUniqueOrThrow({ where: { id: r1.lessonId } });
    expect(["Nội dung của người 1", "Nội dung của người 2"]).toContain(tach.contentMd); // người ghi sau thắng, không trạng thái lai
    expect((await db.trnLesson.findUniqueOrThrow({ where: { id: k.A } })).contentMd).toBe("Nội dung A gốc");
  }, CASE_TIMEOUT);

  it("[B11-S-08] 🔴 ghi bằng id của bài GỐC sau khi đã tách (giao diện/tab cũ) ⇒ vào bản tách của nháp, KHÔNG tách lần hai", async () => {
    const k = await dungKhoaDaPhat();
    const l1 = await ghiBaiDoc(await sdb(dt), k.A, { title: `${P}A lần 1`, contentMd: "Lần 1", minReadSeconds: 10 });
    const l2 = await ghiBaiDoc(await sdb(dt), k.A, { title: `${P}A lần 2`, contentMd: "Lần 2", minReadSeconds: 10 }); // vẫn cầm id gốc
    expect(l2.lessonId).toBe(l1.lessonId);
    expect(l2.daTachBan).toBe(false);
    expect(await db.trnLesson.count({ where: { forkedFromLessonId: k.A } })).toBe(1);
    expect((await db.trnLesson.findUniqueOrThrow({ where: { id: l1.lessonId } })).contentMd).toBe("Lần 2");
  }, CASE_TIMEOUT);

  it("[B11-S-09] 🔴 cơ sở KHÁC không sửa được: người neo CS2 ghi bài của khoá CS1 ⇒ NOT_FOUND, không tách bản, không tạo bản nháp; đối chứng: người CS1 sửa được", async () => {
    const k = await dungKhoaDaPhat();
    const sai = await ghiBaiDoc(await sdb(dtCs2), k.A, { title: `${P}X`, contentMd: "X", minReadSeconds: 10 }).then(
      () => null,
      (e: unknown) => e as { code?: string },
    );
    expect(sai?.code).toBe("NOT_FOUND");
    expect(await db.trnLesson.count({ where: { forkedFromLessonId: k.A } })).toBe(0);
    expect(await db.trnCourseVersion.count({ where: { courseId: k.courseId } })).toBe(1);
    const duoc = await ghiBaiDoc(await sdb(dt), k.A, { title: `${P}A ok`, contentMd: "OK", minReadSeconds: 10 });
    expect(duoc.daTachBan).toBe(true);
  }, CASE_TIMEOUT);

  it("[B11-S-10] 🔴 màn duyệt: bài SỬA ở bản nháp báo là 'đổi nội dung' (không phải 'bỏ bài cũ + thêm bài mới'); bài giữ nguyên không bị liệt kê; vân tay không lệch sau khi gửi", async () => {
    const k = await dungKhoaDaPhat();
    const g = await ghiBaiDoc(await sdb(dt), k.A, { title: `${P}A sửa`, contentMd: "A đã sửa", minReadSeconds: 10 });
    const r = await runAction(cauHinhVongDoiKhoa, await actor(dt), { courseId: k.courseId, hanhDong: "GUI_DUYET" }, { actorName: "b11", reason: "Gửi duyệt đủ dài" });
    expect(r.res.ok, JSON.stringify(r.res)).toBe(true);
    const d = await napDuyetKhoa(await sdb(dt), k.courseId);
    const s = d!.soSanh!;
    expect(s.doiNoiDung.map((x) => x.lessonId)).toEqual([g.lessonId]);
    expect(s.them).toEqual([]);
    expect(s.bot).toEqual([]);
    expect(d!.doiSauKhiGui).toBe(0);
    expect(d!.tongBai).toBe(4);
  }, CASE_TIMEOUT);

  it("[B11-S-11] 🔴 TRẢ LẠI bản chờ duyệt về nháp khi đã có MỘT nháp khác ⇒ CONFLICT (không đẻ hai bản nháp); không có nháp khác thì trả lại được", async () => {
    const k = await dungKhoaDaPhat();
    await ghiBaiDoc(await sdb(dt), k.A, { title: `${P}A 1`, contentMd: "A 1", minReadSeconds: 10 });
    const guiDuyet = await runAction(cauHinhVongDoiKhoa, await actor(dt), { courseId: k.courseId, hanhDong: "GUI_DUYET" }, { actorName: "b11", reason: "Gửi duyệt đủ dài" });
    expect(guiDuyet.res.ok).toBe(true);
    // Soạn tiếp ⇒ mở một nháp MỚI (v1.2) trong lúc v1.1 đang chờ duyệt.
    await ghiBaiDoc(await sdb(dt), k.B, { title: `${P}B 1`, contentMd: "B 1", minReadSeconds: 10 });
    expect((await dsVersion(k.courseId)).map((v) => v.status)).toEqual(["PUBLISHED", "PENDING_REVIEW", "DRAFT"]);
    const traLai = await runAction(cauHinhVongDoiKhoa, await actor(dt), { courseId: k.courseId, hanhDong: "TRA_LAI" }, { actorName: "b11", reason: "Trả lại đủ dài" });
    expect(traLai.res.ok).toBe(false);
    if (traLai.res.ok) return;
    expect(traLai.res.error.code).toBe("CONFLICT");
    expect((await dsVersion(k.courseId)).map((v) => v.status)).toEqual(["PUBLISHED", "PENDING_REVIEW", "DRAFT"]);
  }, CASE_TIMEOUT);

  it("[B11-S-12] bản đã xuất bản CHƯA CHỤP (dữ liệu cũ, vân tay rỗng, không dòng nào): lần sửa đầu tiên ĐÓNG BĂNG nó trước khi tách — người đang học không mất bài", async () => {
    n += 1;
    const k = await db.trnCourse.create({
      data: { code: `${P}K${n}`, slug: `${P.toLowerCase()}k${n}`, title: `${P}Khoá cũ ${n}`, status: "PUBLISHED", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL", ...cs1 },
      select: { id: true },
    });
    const m = await db.trnModule.create({ data: { courseId: k.id, title: `${P}Chương cũ`, orderIndex: 0 }, select: { id: true } });
    const a = (await db.trnLesson.create({ data: { moduleId: m.id, title: `${P}Cũ A`, orderIndex: 0, kind: "READ", contentMd: "ND cũ A", minReadSeconds: 10 }, select: { id: true } })).id;
    const b = (await db.trnLesson.create({ data: { moduleId: m.id, title: `${P}Cũ B`, orderIndex: 1, kind: "READ", contentMd: "ND cũ B", minReadSeconds: 10 }, select: { id: true } })).id;
    const v = await db.trnCourseVersion.create({ data: { courseId: k.id, major: 1, minor: 0, status: "PUBLISHED", publishedAt: new Date("2026-11-01T00:00:00Z") }, select: { id: true } });
    const u = await seedUser({ email: `cu-cu${n}${HAU_TO}`, role: "TEACHER", name: `${P}Học cũ` });
    const e = await db.trnEnrollment.create({
      data: { courseId: k.id, userId: u.id, courseVersionId: null, cycle: 1, status: "IN_PROGRESS", source: "ASSIGNMENT", ...cs1, snapJobTitle: "NV", dueAt: new Date("2027-01-01T00:00:00Z"), dueAtOriginal: new Date("2027-01-01T00:00:00Z") },
      select: { id: true },
    });
    expect(await tenBai({ id: e.id, userId: u.id })).toEqual(["Cũ A", "Cũ B"]); // trước khi sửa: đọc cây sống (bản chưa chụp)
    const g = await ghiBaiDoc(await sdb(dt), a, { title: `${P}Cũ A sửa`, contentMd: "ND mới", minReadSeconds: 10 });
    expect(g.daTachBan).toBe(true);
    // v1.0 được chụp ĐỦ (A, B) TRƯỚC khi tách ⇒ người học (chưa ghim, đọc bản phát hành) giữ cả hai bài với tên CŨ.
    expect((await dongCua(v.id)).map((d) => d.lessonId).sort()).toEqual([a, b].sort());
    expect(await tenBai({ id: e.id, userId: u.id })).toEqual(["Cũ A", "Cũ B"]);
    expect((await db.trnLesson.findUniqueOrThrow({ where: { id: a } })).contentMd).toBe("ND cũ A");
  }, CASE_TIMEOUT);

  it("[B11-S-13] nhân bản khoá chép đúng NỘI DUNG BẢN ĐANG LÀM VIỆC: bài tách bản thay bài gốc, không có bài đôi", async () => {
    const k = await dungKhoaDaPhat();
    const g = await ghiBaiDoc(await sdb(dt), k.A, { title: `${P}A bản sao`, contentMd: "A sao", minReadSeconds: 10 });
    const { cauHinhNhanBanKhoa } = await import("../../lib/elearning/course-authoring");
    const r = await runAction(cauHinhNhanBanKhoa, await actor(dt), { courseId: k.courseId }, { actorName: "b11" });
    expect(r.res.ok, JSON.stringify(r.res)).toBe(true);
    if (!r.res.ok) return;
    const bai = await db.trnLesson.findMany({ where: { module: { courseId: r.res.data.courseId } }, orderBy: { orderIndex: "asc" }, select: { title: true, contentMd: true } });
    expect(bai.map((x) => x.title.replace(P, ""))).toEqual(["A bản sao", "B", "V", "Q"]);
    expect(bai[0]!.contentMd).toBe("A sao");
    expect(g.lessonId).not.toBe(k.A);
    await db.trnLesson.deleteMany({ where: { module: { courseId: r.res.data.courseId } } });
    await db.trnModule.deleteMany({ where: { courseId: r.res.data.courseId } });
    await db.trnCourseVersion.deleteMany({ where: { courseId: r.res.data.courseId } });
    await db.trnCourse.deleteMany({ where: { id: r.res.data.courseId } });
  }, CASE_TIMEOUT);

  it("[B11-S-14] `layBaiDeGhi` bài CHƯA khoá (chỉ có ở bản nháp) ⇒ ghi thẳng, KHÔNG tách; bài lạ không thuộc khoá ⇒ NOT_FOUND", async () => {
    const k = await dungKhoaDaPhat();
    const them = await runAction(cauHinhTaoBai, await actor(dt), { moduleId: k.moduleId, title: `${P}Nháp`, kind: "READ", required: true }, { actorName: "b11" });
    expect(them.res.ok).toBe(true);
    if (!them.res.ok) return;
    const g = await db.$transaction((tx) => layBaiDeGhi(tx as never, them.res.ok ? them.res.data.lessonId : ""));
    expect(g).toMatchObject({ daTachBan: false, lessonId: them.res.data.lessonId });
    await expect(db.$transaction((tx) => layBaiDeGhi(tx as never, "bai-khong-ton-tai"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    // moBanNhap idempotent: gọi lại không đẻ bản nháp thứ hai.
    await db.$transaction((tx) => moBanNhap(tx as never, k.courseId));
    expect((await dsVersion(k.courseId)).filter((v) => v.status === "DRAFT")).toHaveLength(1);
  }, CASE_TIMEOUT);

  it("[B11-S-15] trang soạn dẫn tới BÀI CỦA BẢN NHÁP (chỉ đọc): id bài gốc ⇒ bản tách; bản tách và bài chưa sửa ⇒ null; mở trang không đẻ bản nháp", async () => {
    const k = await dungKhoaDaPhat();
    const s = await sdb(dt);
    expect(await baiCuaBanNhap(s, k.A)).toBeNull(); // chưa sửa gì
    expect(await dsVersion(k.courseId)).toHaveLength(1); // đọc KHÔNG đẻ bản nháp
    const g = await ghiBaiDoc(s, k.A, { title: `${P}A mới`, contentMd: "A mới", minReadSeconds: 10 });
    expect(await baiCuaBanNhap(s, k.A)).toBe(g.lessonId);
    expect(await baiCuaBanNhap(s, g.lessonId)).toBeNull();
    expect(await baiCuaBanNhap(s, k.B)).toBeNull();
  }, CASE_TIMEOUT);

  it("[B11-S-16] 🔴 gắn KHUNG CHẤM khác vào bài tập của khoá đã xuất bản ⇒ bản tách mang khung mới, bài gốc GIỮ khung cũ; đối chứng: gắn đúng khung đang có thì vẫn qua cổng", async () => {
    const k = await dungKhoaDaPhat({ task: true });
    const cu = await k.dungLuot("cu", k.v10);
    const { res } = await runAction(cauHinhGanKhungVaoBai, await actor(dt), { lessonId: k.T, rubricId: kh2 }, { actorName: "b11" });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.data.daTachBan).toBe(true);
    expect((await db.trnLesson.findUniqueOrThrow({ where: { id: k.T } })).rubricId).toBe(kh1); // bài người đang học: khung cũ
    expect((await db.trnLesson.findUniqueOrThrow({ where: { id: res.data.lessonId } })).rubricId).toBe(kh2);
    const s = scopedDb(await actor(dt));
    expect(await kiemBaiTrongBan(s as never, cu, k.T)).toBeNull();
    expect(await kiemBaiTrongBan(s as never, cu, res.data.lessonId)).toMatchObject({ code: "LESSON_NOT_IN_VERSION" });
    // Gắn lại ĐÚNG khung đang có trên bài của bản nháp: ghi vào cùng bản tách, không tách lần hai.
    const lai = await runAction(cauHinhGanKhungVaoBai, await actor(dt), { lessonId: res.data.lessonId, rubricId: kh1 }, { actorName: "b11" });
    expect(lai.res.ok, JSON.stringify(lai.res)).toBe(true);
    expect(await db.trnLesson.count({ where: { forkedFromLessonId: k.T } })).toBe(1);
  }, CASE_TIMEOUT);

  it("[B11-S-17] 🔴 màn của NGƯỜI HỌC liệt kê/đếm bài theo bản đã ghim: tìm kiếm, số bài ở 'Khoá của tôi', tiến độ bắt buộc ở tổng quan KHÔNG thấy bài sửa/bài mới của bản nháp", async () => {
    const k = await dungKhoaDaPhat();
    const cu = await k.dungLuot("cu", k.v10);
    await ghiBaiDoc(await sdb(dt), k.A, { title: `${P}A đã sửa ở nháp`, contentMd: "ND mới", minReadSeconds: 10 });
    const them = await runAction(cauHinhTaoBai, await actor(dt), { moduleId: k.moduleId, title: `${P}Bài mới ở nháp`, kind: "READ", required: true }, { actorName: "b11" });
    expect(them.res.ok).toBe(true);
    const s = scopedDb(await actor(dt));
    const luc = new Date("2026-11-18T03:00:00.000Z");

    const tim = (await napNguonTimKiem(s, cu.userId, luc)).filter((x) => x.loai === "bai").map((x) => x.tieuDe.replace(P, "")).sort();
    expect(tim).toEqual(["A", "B", "Q", "V"]);

    const ds = (await napDanhSachKhoaCuaToi(s, cu.userId)).find((x) => x.enrollmentId === cu.id);
    expect(ds?.soBai).toBe(4);
    expect(ds?.coKiemTra).toBe(true);

    const tq = await napTongQuanHocTap(s, cu.userId, luc);
    expect(tq.tienDoBai[cu.id]).toEqual({ xong: 1, tong: 4 }); // A đã xong ở v1.0; bài mới của nháp KHÔNG vào mẫu số

    // Xuất bản v1.1 (bài mới có nội dung để qua cổng): người ghim v1.0 VẪN thấy 4 bài cũ; người ghim v1.1 thấy 5 bài với tên mới.
    if (!them.res.ok) return;
    await ghiBaiDoc(await sdb(dt), them.res.data.lessonId, { title: `${P}Bài mới ở nháp`, contentMd: "Nội dung bài mới", minReadSeconds: 10 });
    for (const h of ["GUI_DUYET", "DUYET", "XUAT_BAN"] as const) {
      const r = await runAction(cauHinhVongDoiKhoa, await actor(dt), { courseId: k.courseId, hanhDong: h }, { actorName: "b11", reason: `Lý do ${h} đủ dài` });
      expect(r.res.ok, JSON.stringify(r.res)).toBe(true);
    }
    const ver = await dsVersion(k.courseId);
    const v11 = ver[ver.length - 1]!.id;
    const moi = await k.dungLuot("moi", v11);
    const tenTim = async (u: string) => (await napNguonTimKiem(scopedDb(await actor(dt)), u, luc)).filter((x) => x.loai === "bai").map((x) => x.tieuDe.replace(P, "")).sort();
    expect(await tenTim(cu.userId)).toEqual(["A", "B", "Q", "V"]);
    expect(await tenTim(moi.userId)).toEqual(["A đã sửa ở nháp", "B", "Bài mới ở nháp", "Q", "V"]);
  }, CASE_TIMEOUT);

  it("[B11-S-18] 🔴 kéo thả CHƯƠNG ghi thứ tự vào bản nháp: người đang học bản đã phát hành giữ thứ tự chương cũ, người học bản mới (sau khi xuất bản) thấy thứ tự mới; bảng chương không bị đụng", async () => {
    const k = await dungKhoaDaPhat({ chuong2: true });
    const cu = await k.dungLuot("cu", k.v10);
    const tenChuong = async (e: { id: string; userId: string }) => {
      const r = await napDeCuongKhoa(scopedDb(await actor(dt)) as never, { enrollmentId: e.id, userId: e.userId });
      return r!.chuong.map((c) => c.title.replace(P, "").replace(/ \d+$/, ""));
    };
    expect(await tenChuong(cu)).toEqual(["Chương", "Chương hai"]);
    const truoc = await db.trnModule.findMany({ where: { courseId: k.courseId }, orderBy: { orderIndex: "asc" }, select: { id: true, orderIndex: true } });

    const keo = await runAction(cauHinhSapThuTu, await actor(dt), { loai: "CHUONG", parentId: k.courseId, id: k.chuong2Id, viTriMoi: 0 }, { actorName: "b11" });
    expect(keo.res.ok, JSON.stringify(keo.res)).toBe(true);
    expect(await db.trnModule.findMany({ where: { courseId: k.courseId }, orderBy: { orderIndex: "asc" }, select: { id: true, orderIndex: true } })).toEqual(truoc); // bảng chương nguyên vẹn
    expect(await tenChuong(cu)).toEqual(["Chương", "Chương hai"]); // người đang học: không đổi

    for (const h of ["GUI_DUYET", "DUYET", "XUAT_BAN"] as const) {
      const r = await runAction(cauHinhVongDoiKhoa, await actor(dt), { courseId: k.courseId, hanhDong: h }, { actorName: "b11", reason: `Lý do ${h} đủ dài` });
      expect(r.res.ok, JSON.stringify(r.res)).toBe(true);
    }
    const ver = await dsVersion(k.courseId);
    const moi = await k.dungLuot("moi", ver[ver.length - 1]!.id);
    expect(await tenChuong(moi)).toEqual(["Chương hai", "Chương"]);
    expect(await tenChuong(cu)).toEqual(["Chương", "Chương hai"]); // vẫn không tự chuyển bản
  }, CASE_TIMEOUT);

  it("[B11-S-19] 🔴 chứng nhận chứng cho PHIÊN BẢN MÀ LƯỢT HỌC ĐÃ GHIM (v1.0), không phải bản phát hành sau đó (v1.1)", async () => {
    const k = await dungKhoaDaPhat();
    await ghiBaiDoc(await sdb(dt), k.A, { title: `${P}A v1.1`, contentMd: "ND v1.1", minReadSeconds: 10 });
    for (const h of ["GUI_DUYET", "DUYET", "XUAT_BAN"] as const) {
      const r = await runAction(cauHinhVongDoiKhoa, await actor(dt), { courseId: k.courseId, hanhDong: h }, { actorName: "b11", reason: `Lý do ${h} đủ dài` });
      expect(r.res.ok, JSON.stringify(r.res)).toBe(true);
    }
    const ver = await dsVersion(k.courseId);
    expect(ver.map((v) => v.status)).toEqual(["PUBLISHED", "PUBLISHED"]);
    const cu = await k.dungLuot("cc", k.v10);
    await db.trnEnrollment.update({ where: { id: cu.id }, data: { status: "COMPLETED", progressPercent: 100, completedAt: new Date("2026-11-20T00:00:00Z"), verifiedAt: new Date("2026-11-20T00:00:00Z") } });
    const r = await capChungNhanChoLuot(cu.id);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const c = await db.trnCertificate.findFirstOrThrow({ where: { enrollmentId: cu.id }, select: { courseVersionId: true } });
    expect(c.courseVersionId).toBe(k.v10);
    expect(c.courseVersionId).not.toBe(ver[1]!.id);
  }, CASE_TIMEOUT);

  // ── B-11c: chương RỖNG giữ vị trí ───────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Khoá có HAI chương có bài ("Chương", "Chương hai") + MỘT chương RỖNG ("Rỗng", orderIndex 2). */
  async function dungKhoaCoChuongRong() {
    const k = await dungKhoaDaPhat({ chuong2: true });
    const r = await db.trnModule.create({ data: { courseId: k.courseId, title: `${P}Rỗng`, orderIndex: 2 }, select: { id: true } });
    return { ...k, rongId: r.id };
  }
  const tenChuongSoan = async (courseId: string) =>
    (await docDanBaiChoMan(await sdb(dt), courseId)).chuong.map((c) => c.title.replace(P, "").replace(/ \d+$/, ""));
  const keoChuong = async (courseId: string, id: string, viTriMoi: number) => {
    const r = await runAction(cauHinhSapThuTu, await actor(dt), { loai: "CHUONG", parentId: courseId, id, viTriMoi }, { actorName: "b11" });
    expect(r.res.ok, JSON.stringify(r.res)).toBe(true);
  };

  it("[B11-S-20] 🔴 kéo chương RỖNG: vị trí được GIỮ sau khi tải lại (trước B-11c nó nhảy xuống cuối); kéo chương khác không đẩy nó đi; bản đã phát hành + người đang học không đổi", async () => {
    const k = await dungKhoaCoChuongRong();
    const cu = await k.dungLuot("cu", k.v10);
    expect(await tenChuongSoan(k.courseId)).toEqual(["Chương", "Chương hai", "Rỗng"]);

    await keoChuong(k.courseId, k.rongId, 0);
    expect(await tenChuongSoan(k.courseId)).toEqual(["Rỗng", "Chương", "Chương hai"]); // chương rỗng ở ĐẦU và dính ở đó

    await keoChuong(k.courseId, k.chuong2Id, 1); // kéo chương có bài: chương rỗng KHÔNG bị đẩy
    expect(await tenChuongSoan(k.courseId)).toEqual(["Rỗng", "Chương hai", "Chương"]);

    const ver = await dsVersion(k.courseId);
    const nhap = await db.trnCourseVersion.findUniqueOrThrow({ where: { id: ver[ver.length - 1]!.id }, select: { moduleOrderJson: true, status: true } });
    expect(nhap.status).toBe("DRAFT");
    expect(nhap.moduleOrderJson).toEqual({ [k.rongId]: 0, [k.chuong2Id]: 1, [k.moduleId]: 2 });
    // Bản đã phát hành v1.0 không bị đụng một byte; người đang học vẫn thấy thứ tự cũ (chỉ chương có bài).
    expect((await db.trnCourseVersion.findUniqueOrThrow({ where: { id: k.v10 }, select: { moduleOrderJson: true } })).moduleOrderJson).toBeNull();
    const r = await napDeCuongKhoa(scopedDb(await actor(dt)) as never, { enrollmentId: cu.id, userId: cu.userId });
    expect(r!.chuong.map((c) => c.title.replace(P, "").replace(/ \d+$/, ""))).toEqual(["Chương", "Chương hai"]);
  }, CASE_TIMEOUT);

  it("[B11-S-21] 🔴 thêm BÀI VÀO chương rỗng đã được kéo: chương vẫn ở vị trí đã chọn (không nhảy xuống cuối ở lần thêm bài đầu tiên); dòng phiên bản mang đúng số", async () => {
    const k = await dungKhoaCoChuongRong();
    await keoChuong(k.courseId, k.rongId, 0);
    const them = await runAction(cauHinhTaoBai, await actor(dt), { moduleId: k.rongId, title: `${P}Bài đầu của chương rỗng`, kind: "READ", required: true }, { actorName: "b11" });
    expect(them.res.ok, JSON.stringify(them.res)).toBe(true);
    expect(await tenChuongSoan(k.courseId)).toEqual(["Rỗng", "Chương", "Chương hai"]);
    const ver = await dsVersion(k.courseId);
    const dong = await db.trnCourseVersionLesson.findMany({ where: { versionId: ver[ver.length - 1]!.id, lesson: { moduleId: k.rongId } }, select: { moduleOrder: true } });
    expect(dong.map((d) => d.moduleOrder)).toEqual([0]);
  }, CASE_TIMEOUT);

  it("[B11-S-22] 🔴 thứ tự chương ĐẦY ĐỦ đi theo bản: nháp v1.1 đã kéo (có chương rỗng) bị KHOÁ (chờ duyệt) rồi sửa tiếp ⇒ nháp v1.2 sao chép từ nó thừa hưởng vị trí, cả chương rỗng", async () => {
    const k = await dungKhoaCoChuongRong();
    await keoChuong(k.courseId, k.rongId, 1); // Chương, Rỗng, Chương hai
    expect(await tenChuongSoan(k.courseId)).toEqual(["Chương", "Rỗng", "Chương hai"]);
    // Dàn bài có chương RỖNG không gửi duyệt được (luật có sẵn) — khoá bản bằng DB để thử đúng đường sao chép của `moBanNhap`.
    const v11 = (await dsVersion(k.courseId)).at(-1)!;
    await db.trnCourseVersion.update({ where: { id: v11.id }, data: { status: "PENDING_REVIEW", submittedAt: new Date("2026-11-18T00:00:00Z") } });
    await ghiBaiDoc(await sdb(dt), k.A, { title: `${P}A v1.2`, contentMd: "ND v1.2", minReadSeconds: 10 });
    const ver = await dsVersion(k.courseId);
    expect(ver.map((v) => v.status)).toEqual(["PUBLISHED", "PENDING_REVIEW", "DRAFT"]);
    expect(ver[2]!.clonedFromVersionId).toBe(v11.id);
    const nhap = await db.trnCourseVersion.findUniqueOrThrow({ where: { id: ver[2]!.id }, select: { moduleOrderJson: true } });
    expect(nhap.moduleOrderJson).toEqual({ [k.moduleId]: 0, [k.rongId]: 1, [k.chuong2Id]: 2 });
    expect(await tenChuongSoan(k.courseId)).toEqual(["Chương", "Rỗng", "Chương hai"]);
  }, CASE_TIMEOUT);

  it("[B11-S-23] 🔴 nhân bản khoá chép chương theo thứ tự của BẢN ĐANG LÀM VIỆC (kể cả chương rỗng), không theo cột của cây sống", async () => {
    const k = await dungKhoaCoChuongRong();
    await keoChuong(k.courseId, k.rongId, 0);
    await keoChuong(k.courseId, k.chuong2Id, 1); // Rỗng, Chương hai, Chương
    const nb = await runAction(cauHinhNhanBanKhoa, await actor(dt), { courseId: k.courseId }, { actorName: "b11" });
    expect(nb.res.ok, JSON.stringify(nb.res)).toBe(true);
    const moiId = (nb.res as { ok: true; data: { courseId: string } }).data.courseId;
    const chuong = await db.trnModule.findMany({ where: { courseId: moiId }, orderBy: { orderIndex: "asc" }, select: { title: true, orderIndex: true } });
    expect(chuong.map((c) => c.title.replace(P, "").replace(/ \d+$/, ""))).toEqual(["Rỗng", "Chương hai", "Chương"]);
    expect(chuong.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
    await db.trnCourseVersionLesson.deleteMany({ where: { version: { courseId: moiId } } });
  }, CASE_TIMEOUT);

  // ── B-11d: hai đường người học còn đọc CÂY SỐNG (phát hiện khi rà truy vấn) ────────────────────────────────────────────────────────────────
  it("[B11-S-24] 🔴 khung trình học (cây chương/bài + Bài trước/sau) của người ghim v1.0 KHÔNG thấy bài của bản nháp (bản tách, bài mới) và không điều hướng tới đó", async () => {
    const k = await dungKhoaDaPhat();
    const cu = await k.dungLuot("cay", k.v10);
    // Nháp: A bị tách bản (A'), thêm bài mới N.
    await ghiBaiDoc(await sdb(dt), k.A, { title: `${P}A nháp`, contentMd: "ND nháp", minReadSeconds: 10 });
    const them = await runAction(cauHinhTaoBai, await actor(dt), { moduleId: k.moduleId, title: `${P}N mới ở nháp`, kind: "READ", required: true }, { actorName: "b11" });
    expect(them.res.ok, JSON.stringify(them.res)).toBe(true);

    const cay = await napCayBaiHoc(await sdb(dt), { enrollmentId: cu.id, courseId: k.courseId, courseVersionId: k.v10 });
    expect(cay.phang.map((b) => b.title.replace(P, ""))).toEqual(["A", "B", "V", "Q"]); // đúng 4 bài của v1.0, không "A nháp", không "N mới ở nháp"
    expect(cay.soBai).toBe(4);
    // Bài trước/sau của B nằm TRONG bản (A và V), không phải bản tách hay bài mới.
    const lg = langGieng(cay.phang, k.B);
    expect([lg.truoc?.lessonId, lg.sau?.lessonId]).toEqual([k.A, k.V]);
  }, CASE_TIMEOUT);

  it("[B11-S-25] 🔴 đạt bài kiểm tra ⇒ 'xong' ghi vào bài của PHIÊN BẢN lượt học đã ghim, không vào bản tách cùng gắn đề (bản v1.1 chứa bài tách Q′; người ghim v1.1 phải xong Q′, người ghim v1.0 phải xong Q)", async () => {
    const k = await dungKhoaDaPhat();
    const cu = await k.dungLuot("cu", k.v10);
    // Tách bản bài kiểm tra Q (cùng đề), rồi đi hết vòng đời để v1.1 chứa Q′.
    const tach = await db.$transaction((tx) => layBaiDeGhi(tx as never, k.Q));
    expect(tach.daTachBan).toBe(true);
    for (const h of ["GUI_DUYET", "DUYET", "XUAT_BAN"] as const) {
      const r = await runAction(cauHinhVongDoiKhoa, await actor(dt), { courseId: k.courseId, hanhDong: h }, { actorName: "b11", reason: `Lý do ${h} đủ dài` });
      expect(r.res.ok, JSON.stringify(r.res)).toBe(true);
    }
    const ver = await dsVersion(k.courseId);
    const moi = await k.dungLuot("moi", ver[ver.length - 1]!.id);
    const xong = async (e: { id: string }) =>
      (await db.trnLessonProgress.findMany({ where: { enrollmentId: e.id, status: "DONE", lessonId: { in: [k.Q, tach.lessonId] } }, select: { lessonId: true } })).map((x) => x.lessonId);

    await ghiXongBaiThi(await sdb(dt), { enrollmentId: moi.id, userId: moi.userId, examId: de1, courseId: k.courseId, now: new Date("2026-11-19T00:00:00Z") });
    expect(await xong(moi)).toEqual([tach.lessonId]); // người ở v1.1 xong Q′
    await ghiXongBaiThi(await sdb(dt), { enrollmentId: cu.id, userId: cu.userId, examId: de1, courseId: k.courseId, now: new Date("2026-11-19T00:00:00Z") });
    expect(await xong(cu)).toEqual([k.Q]); // người ở v1.0 xong Q gốc
  }, CASE_TIMEOUT);
});
