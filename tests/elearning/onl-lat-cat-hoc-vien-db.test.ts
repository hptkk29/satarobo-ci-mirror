// @vitest-environment node
/**
 * [ONL-LAT-*] LÁT CẮT ĐẦU–CUỐI cho Workstream A/B (Postgres thật), CHỈ dùng hàm của E-learning Online:
 *   phụ huynh (phiên) → học viên (con) → quyền học THEO studentId → danh sách khoá → chi tiết/mục lục → bài → nội dung có kiểm quyền.
 *
 * Chứng minh (mỗi ý một ca, kèm đối chứng dương):
 *  · PH xem ĐÚNG con của mình; con 1 không thấy quyền của con 2; phụ huynh khác bị chặn
 *  · MỘT khoá cấp RIÊNG cho hai con — hạn/quyền độc lập (gia hạn/thu hồi một con không đụng con kia)
 *  · hết hạn ⇒ không mở được nội dung; thu hồi ⇒ không mở được và khoá biến khỏi danh sách
 *  · không xem lại bài đã hoàn thành khi cấu hình bật
 *  · không trộn LMS Offline / E-learning Nội bộ: cấp quyền Online không tạo ghi danh offline, không đụng bảng `Trn*`; học viên chỉ có hồ sơ offline không có quyền Online
 *
 * ⚠️ Đây là test HÀM (cùng tiến trình), KHÔNG phải test HTTP: E-learning KHÔNG dựng route học viên (B bọc HTTP). Chưa có endpoint học viên nào.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { docKhoaOnlineCuaHocVien, docMucLucKhoaCuaHocVien, ghiTienDoBai, kiemTraTruyCapChoPhuHuynh } from "../../lib/elearning-online/hoc-tap";
import { docNoiDungBaiChoHocVien } from "../../lib/elearning-online/noi-dung-hoc-vien";
import { doiTrangThaiBan, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { moBanNhap, themBai, themChuong } from "../../lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { capQuyenHoc, thuHoiQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

const P = "CI_LAT_";
const T0 = new Date(Date.UTC(2026, 10, 20, 5, 0, 0));
const sau = (ngay: number, base = T0) => new Date(base.getTime() + ngay * 86_400_000);
let n = 0;
const key = (t: string) => `ci-lat-${t}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

async function don() {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: "ci-lat-" } } });
}
const phuHuynh = (t: string) => db.user.create({ data: { name: `${P}${t}`, email: `ci-lat-${t}-${Date.now()}-${++n}@example.test`, role: "PARENT" }, select: { id: true } });
const con = (parentUserId: string | null, t: string) => db.student.create({ data: { name: `${P}${t}-${++n}`, parentUserId }, select: { id: true } });

async function dungKhoa(o: { khongXemLai?: boolean; thang?: number | null } = {}) {
  const t = await taoKhoa(db, { code: `CI-LAT-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${P}Khoá ${n}`, listPrice: 400_000, salePrice: 400_000, validityMonths: o.thang === undefined ? 6 : o.thang, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const ch = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
  if (!ch.ok) throw new Error("chuong");
  const b1 = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "READ", title: "B1", contentJson: { body: "nội dung bài 1" } });
  const b2 = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "READ", title: "B2", contentJson: { body: "nội dung bài 2" } });
  if (!b1.ok || !b2.ok) throw new Error("bai");
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET", khongChoXemLaiBaiDaQua: o.khongXemLai ?? false } });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, T0);
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  return { courseId: t.courseId, b1: b1.stableId, b2: b2.stableId };
}
const cap = async (studentId: string, courseId: string, now = T0) => {
  const r = await capQuyenHoc(db, { studentId, courseId, loai: "CAP_MIEN_PHI", now, idempotencyKey: key("cap") });
  if (!r.ok) throw new Error(r.thongBao);
  return r;
};

describe.skipIf(!RUN_DB_TESTS)("[ONL-LAT] lát cắt đầu–cuối: PH → con → quyền theo studentId → khoá → mục lục → bài", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-LAT-01] 🔴 danh sách khoá theo TỪNG con: con 1 không thấy quyền của con 2; phụ huynh khác không thấy cả hai (đối chứng dương cho chính chủ)", async () => {
    const chu = await phuHuynh("chu");
    const ke = await phuHuynh("ke");
    const [c1, c2] = [await con(chu.id, "c1"), await con(chu.id, "c2")];
    const [k1, k2] = [await dungKhoa(), await dungKhoa()];
    await cap(c1.id, k1.courseId);
    await cap(c2.id, k2.courseId);
    const ds = async (parent: string, sv: string) => (await docKhoaOnlineCuaHocVien(db, { parentUserId: parent, studentId: sv, now: T0 }))?.map((d) => d.courseId) ?? null;
    expect(await ds(chu.id, c1.id)).toEqual([k1.courseId]); // dương
    expect(await ds(chu.id, c2.id)).toEqual([k2.courseId]); // dương — con 1 KHÔNG có k2, con 2 KHÔNG có k1
    expect(await ds(ke.id, c1.id)).toBeNull();
    expect(await ds(ke.id, c2.id)).toBeNull();
  });

  it("[ONL-LAT-02] 🔴 MỘT khoá cấp RIÊNG cho hai con: hai dòng quyền độc lập; thu hồi con 1 không đụng con 2; mở bài của con 1 bị chặn trong khi con 2 vẫn mở", async () => {
    const chu = await phuHuynh("hai");
    const [c1, c2] = [await con(chu.id, "c1"), await con(chu.id, "c2")];
    const k = await dungKhoa();
    const q1 = await cap(c1.id, k.courseId);
    const q2 = await cap(c2.id, k.courseId, sau(10)); // cấp lệch ngày ⇒ hạn khác nhau
    expect(q1.entitlementId).not.toBe(q2.entitlementId);
    expect(await db.onlEntitlement.count({ where: { courseId: k.courseId } })).toBe(2);
    expect(q1.hetHan!.getTime()).not.toBe(q2.hetHan!.getTime());
    const mo = (sv: string) => kiemTraTruyCapChoPhuHuynh(db, { parentUserId: chu.id, studentId: sv, courseId: k.courseId, lessonStableId: k.b1, now: sau(20) });
    expect((await mo(c1.id)).ok).toBe(true);
    expect((await mo(c2.id)).ok).toBe(true);
    const th = await thuHoiQuyenHoc(db, { studentId: c1.id, courseId: k.courseId, reason: "thu hồi thử nghiệm lát cắt", idempotencyKey: key("thu"), now: sau(20) });
    expect(th.ok).toBe(true);
    expect(await mo(c1.id)).toMatchObject({ ok: false, ma: "DA_THU_HOI" });
    expect((await mo(c2.id)).ok).toBe(true); // không bị kéo theo
    expect((await docKhoaOnlineCuaHocVien(db, { parentUserId: chu.id, studentId: c1.id, now: sau(20) }))?.length).toBe(0); // thu hồi ⇒ khoá biến
    expect((await docKhoaOnlineCuaHocVien(db, { parentUserId: chu.id, studentId: c2.id, now: sau(20) }))?.length).toBe(1);
  });

  it("[ONL-LAT-03] 🔴 hết hạn ⇒ KHÔNG mở được nội dung (cổng chặn; mục lục chỉ xem tiến độ — D23), vẫn còn dòng quyền; đối chứng: trước hạn mở được", async () => {
    const chu = await phuHuynh("het");
    const c = await con(chu.id, "c");
    const k = await dungKhoa({ thang: 1 });
    const q = await cap(c.id, k.courseId);
    const vao = (now: Date) => kiemTraTruyCapChoPhuHuynh(db, { parentUserId: chu.id, studentId: c.id, courseId: k.courseId, lessonStableId: k.b1, now });
    expect((await vao(sau(5))).ok).toBe(true);
    const saHan = new Date(q.hetHan!.getTime() + 1000);
    expect(await vao(saHan)).toMatchObject({ ok: false, ma: "HET_HAN" });
    // D23 (Owner 25/11/2026): mục lục khi hết hạn = chỉ XEM tiến độ (hetHan:true, không bài nào mở); nội dung vẫn bị cổng chặn ở dòng trên.
    expect(await docMucLucKhoaCuaHocVien(db, { parentUserId: chu.id, studentId: c.id, courseId: k.courseId, now: saHan })).toMatchObject({ ok: true, hetHan: true });
    expect(await db.onlEntitlement.count({ where: { studentId: c.id, courseId: k.courseId, status: "ACTIVE" } })).toBe(1); // hết hạn KHÔNG được ghi — suy từ expiresAt
  });

  it("[ONL-LAT-04] 🔴 không xem lại bài đã hoàn thành khi cấu hình bật (và đối chứng: cấu hình tắt ⇒ xem lại được); điểm/tiến độ vẫn được lưu", async () => {
    const chu = await phuHuynh("xl");
    const c = await con(chu.id, "c");
    const khoaBat = await dungKhoa({ khongXemLai: true });
    const khoaTat = await dungKhoa({ khongXemLai: false });
    for (const k of [khoaBat, khoaTat]) {
      await cap(c.id, k.courseId);
      const g = await ghiTienDoBai(db, { parentUserId: chu.id, studentId: c.id, courseId: k.courseId, lessonStableId: k.b1, now: T0, daDoc: true } as never);
      expect(g.ok).toBe(true);
    }
    const vao = (k: { courseId: string; b1: string }) => kiemTraTruyCapChoPhuHuynh(db, { parentUserId: chu.id, studentId: c.id, courseId: k.courseId, lessonStableId: k.b1, now: sau(1) });
    expect(await vao(khoaBat)).toMatchObject({ ok: false, ma: "DA_HOAN_THANH_KHONG_XEM_LAI" });
    expect((await vao(khoaTat)).ok).toBe(true);
    expect(await db.onlLessonProgress.count({ where: { entitlement: { studentId: c.id }, status: "COMPLETED" } })).toBe(2); // vẫn lưu
  });

  it("[ONL-LAT-05] 🔴 chi tiết/mục lục theo TỪNG con: tiến độ của con 1 không lẫn sang con 2 (cùng khoá); phụ huynh khác bị chặn", async () => {
    const chu = await phuHuynh("td");
    const ke = await phuHuynh("td2");
    const [c1, c2] = [await con(chu.id, "c1"), await con(chu.id, "c2")];
    const k = await dungKhoa();
    await cap(c1.id, k.courseId);
    await cap(c2.id, k.courseId);
    expect((await ghiTienDoBai(db, { parentUserId: chu.id, studentId: c1.id, courseId: k.courseId, lessonStableId: k.b1, now: T0, daDoc: true } as never)).ok).toBe(true);
    const mucLuc = async (sv: string) => docMucLucKhoaCuaHocVien(db, { parentUserId: chu.id, studentId: sv, courseId: k.courseId, now: sau(1) });
    const a = await mucLuc(c1.id);
    const b = await mucLuc(c2.id);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.bai.find((x) => x.stableId === k.b1)?.trangThai).toBe("COMPLETED");
    expect(b.bai.find((x) => x.stableId === k.b1)?.trangThai).toBe("NOT_STARTED"); // con 2 chưa học
    expect(await docMucLucKhoaCuaHocVien(db, { parentUserId: ke.id, studentId: c1.id, courseId: k.courseId, now: sau(1) })).toMatchObject({ ok: false, ma: "SAI_PHU_HUYNH" });
  });

  it("[ONL-LAT-06] 🔴 KHÔNG trộn Offline / Nội bộ: cấp quyền Online không tạo ghi danh offline hay dòng `Trn*`; học viên chỉ có hồ sơ offline (không quyền Online) bị chặn KHONG_CO_QUYEN", async () => {
    const chu = await phuHuynh("tron");
    const [conOnline, conChiOffline] = [await con(chu.id, "online"), await con(chu.id, "offline")];
    const k = await dungKhoa();
    const truoc = { enr: await db.enrollment.count(), trn: await db.trnEnrollment.count() };
    await cap(conOnline.id, k.courseId);
    expect({ enr: await db.enrollment.count(), trn: await db.trnEnrollment.count() }).toEqual(truoc);
    expect(await db.enrollment.count({ where: { studentId: conOnline.id } })).toBe(0);
    const vao = (sv: string) => kiemTraTruyCapChoPhuHuynh(db, { parentUserId: chu.id, studentId: sv, courseId: k.courseId, lessonStableId: k.b1, now: sau(1) });
    expect((await vao(conOnline.id)).ok).toBe(true);
    expect(await vao(conChiOffline.id)).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" }); // có hồ sơ HV, thuộc đúng PH, nhưng KHÔNG có quyền Online
    // con mồ côi (không phụ huynh) cũng bị chặn ở cổng sở hữu
    const moCoi = await con(null, "mocoi");
    expect(await vao(moCoi.id)).toMatchObject({ ok: false, ma: "SAI_PHU_HUYNH" });
  });

  // ───────────── Nội dung bài (đầu ra nội dung đầu tiên đi qua cổng) ─────────────
  const BI_MAT_MEDIA = "online/video/ci/video-tra-phi-bi-mat-001.mp4";
  const BI_MAT_DE = "assessment-bi-mat-001";
  async function dungKhoaNoiDung(o: { moBai: "MO_HET" | "KHI_BAI_TRUOC_XONG"; khongXemLai?: boolean }) {
    const t = await taoKhoa(db, { code: `CI-LAT-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${P}Khoá ND ${n}`, listPrice: 400_000, salePrice: 400_000, validityMonths: 6, renewalEnabled: false }, null);
    if (!t.ok) throw new Error(t.thongBao);
    const ch = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
    if (!ch.ok) throw new Error("chuong");
    const them = async (kind: "READ" | "VIDEO" | "QUIZ", title: string, contentJson: object) => {
      const r = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind, title, contentJson });
      if (!r.ok) throw new Error(r.thongBao);
      return r.stableId;
    };
    const doc = await them("READ", "Đọc", { body: "THÂN-BÀI-ĐỌC-CÓ-THẬT" });
    const video = await them("VIDEO", "Video", { mediaRef: BI_MAT_MEDIA });
    const quiz = await them("QUIZ", "Quiz", { assessmentId: BI_MAT_DE });
    const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: o.moBai, khongChoXemLaiBaiDaQua: o.khongXemLai ?? false } });
    if (!l.ok) throw new Error(l.thongBao);
    const xt = await xemTruocPhatHanh(db, t.courseId, null);
    if (!xt.ok) throw new Error(xt.thongBao);
    const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, T0);
    if (!ph.ok) throw new Error(ph.thongBao);
    await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
    return { courseId: t.courseId, doc, video, quiz };
  }

  it("[ONL-ND-01] 🔴 chủ sở hữu có quyền: READ ⇒ thân bài; VIDEO/QUIZ ⇒ KHÔNG rò khoá media / id đề (kiểm cả chuỗi JSON của kết quả)", async () => {
    const chu = await phuHuynh("nd1");
    const c = await con(chu.id, "c");
    const k = await dungKhoaNoiDung({ moBai: "MO_HET" });
    await cap(c.id, k.courseId);
    const lay = (b: string) => docNoiDungBaiChoHocVien(db, { parentUserId: chu.id, studentId: c.id, courseId: k.courseId, lessonStableId: b, now: sau(1) });
    const r = await lay(k.doc);
    expect(r).toMatchObject({ ok: true, bai: { kind: "READ", body: "THÂN-BÀI-ĐỌC-CÓ-THẬT" } });
    const v = await lay(k.video);
    expect(v).toMatchObject({ ok: true, bai: { kind: "VIDEO", coVideo: true } });
    const q = await lay(k.quiz);
    expect(q).toMatchObject({ ok: true, bai: { kind: "QUIZ", coDe: true } });
    const dump = JSON.stringify([r, v, q]);
    expect(dump).not.toContain(BI_MAT_MEDIA);
    expect(dump).not.toContain(BI_MAT_DE);
    expect(dump).not.toMatch(/mediaRef|assessmentId|contentJson/);
  });

  it("[ONL-ND-02] 🔴 KHÔNG có nội dung cho: phụ huynh khác · con mồ côi · chưa có quyền · hết hạn · thu hồi — kết quả không chứa thân bài", async () => {
    const chu = await phuHuynh("nd2");
    const ke = await phuHuynh("nd2k");
    const [co, chuaQuyen, hetHan, thuHoi] = [await con(chu.id, "co"), await con(chu.id, "chua"), await con(chu.id, "het"), await con(chu.id, "thu")];
    const moCoi = await con(null, "moc");
    const k = await dungKhoaNoiDung({ moBai: "MO_HET" });
    await cap(co.id, k.courseId);
    const qHet = await cap(hetHan.id, k.courseId);
    await cap(thuHoi.id, k.courseId);
    await thuHoiQuyenHoc(db, { studentId: thuHoi.id, courseId: k.courseId, reason: "thu hồi thử nghiệm nội dung", idempotencyKey: key("th"), now: sau(1) });
    const lay = (parent: string, sv: string, now = sau(1)) => docNoiDungBaiChoHocVien(db, { parentUserId: parent, studentId: sv, courseId: k.courseId, lessonStableId: k.doc, now });
    expect((await lay(chu.id, co.id)).ok).toBe(true); // đối chứng dương
    const cacCa = [
      [await lay(ke.id, co.id), "SAI_PHU_HUYNH"],
      [await lay(chu.id, moCoi.id), "SAI_PHU_HUYNH"],
      [await lay(chu.id, chuaQuyen.id), "KHONG_CO_QUYEN"],
      [await lay(chu.id, hetHan.id, new Date(qHet.hetHan!.getTime() + 1000)), "HET_HAN"],
      [await lay(chu.id, thuHoi.id), "DA_THU_HOI"],
    ] as const;
    for (const [kq, ma] of cacCa) {
      expect(kq).toEqual({ ok: false, ma });
      expect(JSON.stringify(kq)).not.toContain("THÂN-BÀI-ĐỌC-CÓ-THẬT");
    }
  });

  it("[ONL-ND-03] 🔴 thứ tự mở bài + bài ẨN + không xem lại đều áp cho NỘI DUNG (không chỉ cho cổng): khoá kế tiếp ⇒ BAI_CHUA_MO tới khi xong bài trước; ẩn ⇒ BAI_DA_AN; xem lại ⇒ DA_HOAN_THANH_KHONG_XEM_LAI", async () => {
    const chu = await phuHuynh("nd3");
    const c = await con(chu.id, "c");
    const k = await dungKhoaNoiDung({ moBai: "KHI_BAI_TRUOC_XONG", khongXemLai: true });
    await cap(c.id, k.courseId);
    const lay = (b: string) => docNoiDungBaiChoHocVien(db, { parentUserId: chu.id, studentId: c.id, courseId: k.courseId, lessonStableId: b, now: sau(1) });
    expect((await lay(k.doc)).ok).toBe(true);
    expect(await lay(k.video)).toEqual({ ok: false, ma: "BAI_CHUA_MO" }); // bài 2 bị khoá khi bài 1 chưa xong
    expect((await ghiTienDoBai(db, { parentUserId: chu.id, studentId: c.id, courseId: k.courseId, lessonStableId: k.doc, now: sau(1), daDoc: true } as never)).ok).toBe(true);
    expect((await lay(k.video)).ok).toBe(true); // đối chứng dương: xong bài 1 ⇒ mở bài 2
    expect(await lay(k.doc)).toEqual({ ok: false, ma: "DA_HOAN_THANH_KHONG_XEM_LAI" });
    await db.onlLesson.updateMany({ where: { stableId: k.quiz, version: { courseId: k.courseId } }, data: { hidden: true } });
    expect(await lay(k.quiz)).toEqual({ ok: false, ma: "BAI_DA_AN" });
  });

  it("[ONL-ND-04] 🔴 đọc từ BẢN ĐANG CHẠY: sửa thân bài ở bản nháp KHÔNG lộ ra cho học viên; bài không tồn tại ⇒ BAI_KHONG_TON_TAI", async () => {
    const chu = await phuHuynh("nd4");
    const c = await con(chu.id, "c");
    const k = await dungKhoaNoiDung({ moBai: "MO_HET" });
    await cap(c.id, k.courseId);
    const hienTai = await db.onlLesson.findFirstOrThrow({ where: { stableId: k.doc, version: { courseId: k.courseId } }, select: { id: true, versionId: true } });
    // Sửa trực tiếp bản nháp thứ hai (sao chép) — bản đang chạy giữ nguyên
    const nhap = await moBanNhap(db, k.courseId, null);
    expect(nhap.ok).toBe(true);
    if (nhap.ok) {
      const lessonNhap = await db.onlLesson.findFirstOrThrow({ where: { versionId: nhap.versionId, stableId: k.doc }, select: { id: true } });
      await db.onlLesson.update({ where: { id: lessonNhap.id }, data: { contentJson: { body: "BẢN-NHÁP-CHƯA-PHÁT-HÀNH" } } });
    }
    expect(hienTai.versionId).toBeTruthy();
    const r = await docNoiDungBaiChoHocVien(db, { parentUserId: chu.id, studentId: c.id, courseId: k.courseId, lessonStableId: k.doc, now: sau(1) });
    expect(r).toMatchObject({ ok: true, bai: { body: "THÂN-BÀI-ĐỌC-CÓ-THẬT" } });
    expect(JSON.stringify(r)).not.toContain("BẢN-NHÁP");
    expect(await docNoiDungBaiChoHocVien(db, { parentUserId: chu.id, studentId: c.id, courseId: k.courseId, lessonStableId: "khong-co-bai-nay", now: sau(1) })).toEqual({ ok: false, ma: "BAI_KHONG_TON_TAI" });
  });

});
