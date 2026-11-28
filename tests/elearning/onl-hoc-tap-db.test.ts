// @vitest-environment node
/**
 * [ONL-HT-*] E-learning ONLINE — học tập (Postgres thật): cổng truy cập đủ (thứ tự mở bài · bài ẩn · không xem lại) · ghi tiến độ · mục lục
 * · quyền sở hữu phụ huynh. Dọn bằng `donBangOnl`; User/Student thử dọn theo tiền tố.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { docKhoaOnlineCuaHocVien, docMucLucKhoaCuaHocVien, ghiTienDoBai, kiemTraTruyCapChoPhuHuynh } from "../../lib/elearning-online/hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "../../lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { capQuyenHoc, kiemTraTruyCapNoiDungDb, thuHoiQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

const P = "CI_ONLH_";
const NOW = new Date(Date.UTC(2026, 10, 19, 5, 0, 0));
let n = 0;
let key = 0;
const khoaKey = (t: string) => `${P}${t}-${++key}-${Math.random().toString(36).slice(2, 8)}`;

async function don() {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: "ci-onlh-" } } });
}

async function phuHuynh(ten: string) {
  return db.user.create({ data: { name: `${P}${ten}`, email: `ci-onlh-${ten}-${Date.now()}-${++n}@example.test`, role: "PARENT" }, select: { id: true } });
}
async function hocVien(parentUserId: string | null, ten: string) {
  return db.student.create({ data: { name: `${P}${ten}-${++n}`, parentUserId }, select: { id: true } });
}

type Khoa = { courseId: string; v: string; v1: string; v2: string; q: string; r: string; thi: string; c1: string; c2: string };

/**
 * Khoá: Chương 1 = {v1 video bắt buộc, v2 video bắt buộc, q kiểm tra bắt buộc}; Chương 2 = {r đọc bắt buộc}; thi cuối khoá (nếu `coThi`).
 * Đã PHÁT HÀNH + mở bán.
 */
async function dungKhoa(o: { moBai: "MO_HET" | "KHI_BAI_TRUOC_XONG" | "THEO_CHUONG"; khongXemLai?: boolean; coThi?: boolean }) {
  const t = await taoKhoa(db, { code: `CI-ONLH-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${P}Khoá ${n}`, listPrice: 500_000, salePrice: 500_000, validityMonths: 6, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const ch1 = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
  const ch2 = await themChuong(db, { versionId: t.draftVersionId, title: "C2" });
  if (!ch1.ok || !ch2.ok) throw new Error("chuong");
  const bai = async (c: string, kind: "VIDEO" | "READ" | "QUIZ" | "FINAL_EXAM", title: string, nd: object) => {
    const r = await themBai(db, { versionId: t.draftVersionId, chapterId: c, kind, title, contentJson: nd });
    if (!r.ok) throw new Error(r.thongBao);
    return r.stableId;
  };
  const v1 = await bai(ch1.chapterId, "VIDEO", "V1", { mediaRef: "online/video/ci/m1.mp4" });
  const v2 = await bai(ch1.chapterId, "VIDEO", "V2", { mediaRef: "online/video/ci/m2.mp4" });
  const q = await bai(ch1.chapterId, "QUIZ", "Q", { assessmentId: "a1" });
  const r = await bai(ch2.chapterId, "READ", "R", { body: "nội dung" });
  const thi = o.coThi ? await bai(ch2.chapterId, "FINAL_EXAM", "Thi", { assessmentId: "a2" }) : "";
  const cd = { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: o.moBai, khongChoXemLaiBaiDaQua: o.khongXemLai ?? false, thiCuoiKhoa: { bat: !!o.coThi, diemDat: 70, soLanThi: 2, phut: 30 } };
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: cd });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  return { courseId: t.courseId, v: t.draftVersionId, v1, v2, q, r, thi, c1: ch1.stableId, c2: ch2.stableId } as Khoa;
}
async function capChoCon(studentId: string, courseId: string) {
  const c = await capQuyenHoc(db, { studentId, courseId, loai: "MUA", now: NOW, idempotencyKey: khoaKey("mua") });
  if (!c.ok) throw new Error(c.thongBao);
  return c.entitlementId;
}
const xong = (entitlementId: string, lessonStableId: string) =>
  db.onlLessonProgress.create({ data: { entitlementId, lessonStableId, status: "COMPLETED", percent: 100, completedAt: NOW, completedVersionNumber: 1 } });
const vao = (studentId: string, k: Khoa, lessonStableId: string, now = NOW) => kiemTraTruyCapNoiDungDb(db, { studentId, courseId: k.courseId, lessonStableId, now });

describe.skipIf(!RUN_DB_TESTS)("[ONL-HT] cổng truy cập đầy đủ (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-HT-01] 🔴 KHI_BAI_TRUOC_XONG: bài đầu mở; bài sau KHÓA tới khi bài bắt buộc đứng trước xong (kiểm ở SERVER, không chỉ nút)", async () => {
    const k = await dungKhoa({ moBai: "KHI_BAI_TRUOC_XONG" });
    const hv = await hocVien(null, "a");
    const e = await capChoCon(hv.id, k.courseId);
    expect(await vao(hv.id, k, k.v1)).toEqual({ ok: true });
    expect(await vao(hv.id, k, k.v2)).toMatchObject({ ok: false, ma: "BAI_CHUA_MO", lyDoMo: "BAI_TRUOC_CHUA_XONG" });
    expect(await vao(hv.id, k, k.r)).toMatchObject({ ok: false, ma: "BAI_CHUA_MO" });
    await xong(e, k.v1);
    expect(await vao(hv.id, k, k.v2)).toEqual({ ok: true }); // đối chứng dương
    expect(await vao(hv.id, k, k.q)).toMatchObject({ ok: false, ma: "BAI_CHUA_MO" });
  });

  it("[ONL-HT-02] THEO_CHUONG: trong chương không bắt thứ tự; sang chương 2 phải xong mọi bài bắt buộc chương 1; MO_HET mở tất", async () => {
    const k = await dungKhoa({ moBai: "THEO_CHUONG" });
    const hv = await hocVien(null, "b");
    const e = await capChoCon(hv.id, k.courseId);
    expect(await vao(hv.id, k, k.q)).toEqual({ ok: true });
    expect(await vao(hv.id, k, k.r)).toMatchObject({ ok: false, ma: "BAI_CHUA_MO", lyDoMo: "CHUONG_TRUOC_CHUA_XONG" });
    await xong(e, k.v1);
    await xong(e, k.v2);
    expect(await vao(hv.id, k, k.r)).toMatchObject({ ok: false, ma: "BAI_CHUA_MO" }); // còn kiểm tra chương q
    await xong(e, k.q);
    expect(await vao(hv.id, k, k.r)).toEqual({ ok: true });
    const m = await dungKhoa({ moBai: "MO_HET" });
    const hv2 = await hocVien(null, "b2");
    await capChoCon(hv2.id, m.courseId);
    expect(await vao(hv2.id, m, m.r)).toEqual({ ok: true });
  });

  it("[ONL-HT-03] 🔴 không xem lại: bài đã XONG đóng nội dung, bài chưa xong và bài của khoá không bật chính sách vẫn mở; thu hồi / hết hạn chặn mọi bài", async () => {
    const k = await dungKhoa({ moBai: "MO_HET", khongXemLai: true });
    const hv = await hocVien(null, "c");
    const e = await capChoCon(hv.id, k.courseId);
    await xong(e, k.v1);
    expect(await vao(hv.id, k, k.v1)).toMatchObject({ ok: false, ma: "DA_HOAN_THANH_KHONG_XEM_LAI" });
    expect(await vao(hv.id, k, k.v2)).toEqual({ ok: true });
    const m = await dungKhoa({ moBai: "MO_HET", khongXemLai: false });
    const hv2 = await hocVien(null, "c2");
    const e2 = await capChoCon(hv2.id, m.courseId);
    await xong(e2, m.v1);
    expect(await vao(hv2.id, m, m.v1)).toEqual({ ok: true }); // đối chứng: tắt chính sách ⇒ xem lại được
    // hết hạn (6 tháng từ 19/11/2026 ⇒ 19/05/2027): sau đó đóng
    expect(await vao(hv2.id, m, m.v2, new Date(Date.UTC(2027, 4, 20)))).toMatchObject({ ok: false, ma: "HET_HAN" });
    // thu hồi
    expect((await thuHoiQuyenHoc(db, { studentId: hv2.id, courseId: m.courseId, reason: "Hoàn tiền theo yêu cầu", idempotencyKey: khoaKey("th"), now: NOW })).ok).toBe(true);
    expect(await vao(hv2.id, m, m.v2)).toMatchObject({ ok: false, ma: "DA_THU_HOI" });
  });

  it("[ONL-HT-04] bài ẨN ở bản mới: người CHƯA học không thấy nó tồn tại; người ĐÃ bắt đầu vẫn vào được; bài không có trong khoá ⇒ BAI_KHONG_TON_TAI", async () => {
    const k = await dungKhoa({ moBai: "MO_HET" });
    const hvMoi = await hocVien(null, "d1");
    const hvCu = await hocVien(null, "d2");
    const eCu = await capChoCon(hvCu.id, k.courseId);
    await capChoCon(hvMoi.id, k.courseId);
    await db.onlLessonProgress.create({ data: { entitlementId: eCu, lessonStableId: k.v1, status: "IN_PROGRESS", percent: 30 } });
    await db.onlLesson.updateMany({ where: { versionId: k.v, stableId: k.v1 }, data: { hidden: true } }); // ẩn thẳng trên bản chạy để dựng tình huống
    expect(await vao(hvMoi.id, k, k.v1)).toMatchObject({ ok: false, ma: "BAI_DA_AN" });
    expect(await vao(hvCu.id, k, k.v1)).toEqual({ ok: true });
    expect(await vao(hvMoi.id, k, "khong-co")).toMatchObject({ ok: false, ma: "BAI_KHONG_TON_TAI" });
  });
});

describe.skipIf(!RUN_DB_TESTS)("[ONL-HT] ghi tiến độ + mục lục + quyền sở hữu (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-HT-05] 🔴 video: % chỉ TĂNG; hoàn thành đúng ngưỡng 90; đã COMPLETED không hạ; bài đánh giá không hoàn thành qua đường này", async () => {
    const k = await dungKhoa({ moBai: "MO_HET" });
    const ph = await phuHuynh("p1");
    const hv = await hocVien(ph.id, "e");
    await capChoCon(hv.id, k.courseId);
    const ghi = (lessonStableId: string, o: { percent?: number; daDoc?: boolean }) => ghiTienDoBai(db, { parentUserId: ph.id, studentId: hv.id, courseId: k.courseId, lessonStableId, now: NOW, ...o });
    expect(await ghi(k.v1, { percent: 40 })).toMatchObject({ ok: true, trangThai: "IN_PROGRESS", percent: 40, vuaHoanThanhBai: false });
    expect(await ghi(k.v1, { percent: 20 })).toMatchObject({ ok: true, trangThai: "IN_PROGRESS", percent: 40 }); // tua lùi không mất tiến độ
    expect(await ghi(k.v1, { percent: 89 })).toMatchObject({ trangThai: "IN_PROGRESS", percent: 89 });
    expect(await ghi(k.v1, { percent: 90 })).toMatchObject({ ok: true, trangThai: "COMPLETED", vuaHoanThanhBai: true });
    expect(await ghi(k.v1, { percent: 10 })).toMatchObject({ ok: true, trangThai: "COMPLETED", vuaHoanThanhBai: false }); // không hạ
    expect(await ghi(k.q, { percent: 100 })).toMatchObject({ ok: false, ma: "LOAI_BAI_KHONG_GHI_TRUC_TIEP" }); // bài kiểm tra chỉ qua chấm điểm
    expect(await ghi(k.v2, {})).toMatchObject({ ok: false, ma: "THIEU_DU_LIEU" });
    expect(await ghi(k.r, { daDoc: true })).toMatchObject({ ok: true, trangThai: "COMPLETED", percent: 100 });
  });

  it("[ONL-HT-06] 🔴 ghi tiến độ cũng đi qua cổng: bài chưa mở, hết hạn, thu hồi đều KHÔNG ghi được (đọc lại DB: không có dòng nào)", async () => {
    const k = await dungKhoa({ moBai: "KHI_BAI_TRUOC_XONG" });
    const ph = await phuHuynh("p2");
    const hv = await hocVien(ph.id, "f");
    const e = await capChoCon(hv.id, k.courseId);
    const ghi = (lessonStableId: string, now = NOW) => ghiTienDoBai(db, { parentUserId: ph.id, studentId: hv.id, courseId: k.courseId, lessonStableId, percent: 100, now });
    expect(await ghi(k.v2)).toMatchObject({ ok: false, ma: "BAI_CHUA_MO" });
    expect(await db.onlLessonProgress.count({ where: { entitlementId: e } })).toBe(0);
    expect(await ghi(k.v1, new Date(Date.UTC(2027, 5, 1)))).toMatchObject({ ok: false, ma: "HET_HAN" });
    expect(await db.onlLessonProgress.count({ where: { entitlementId: e } })).toBe(0);
    await thuHoiQuyenHoc(db, { studentId: hv.id, courseId: k.courseId, reason: "Gian lận thanh toán", idempotencyKey: khoaKey("th"), now: NOW });
    expect(await ghi(k.v1)).toMatchObject({ ok: false, ma: "DA_THU_HOI" });
    expect(await db.onlLessonProgress.count({ where: { entitlementId: e } })).toBe(0);
  });

  it("[ONL-HT-07] 🔴 QUYỀN SỞ HỮU: phụ huynh khác không ghi/đọc/xem được con người ta (kể cả khi biết studentId); mọi đường nói chung một mã", async () => {
    const k = await dungKhoa({ moBai: "MO_HET" });
    const chu = await phuHuynh("chu");
    const la = await phuHuynh("la");
    const hv = await hocVien(chu.id, "g");
    await capChoCon(hv.id, k.courseId);
    const cua = { studentId: hv.id, courseId: k.courseId, now: NOW };
    // chủ: dương
    expect(await kiemTraTruyCapChoPhuHuynh(db, { ...cua, parentUserId: chu.id, lessonStableId: k.v1 })).toEqual({ ok: true });
    expect(await docKhoaOnlineCuaHocVien(db, { parentUserId: chu.id, studentId: hv.id, now: NOW })).toHaveLength(1);
    // người lạ: âm
    expect(await kiemTraTruyCapChoPhuHuynh(db, { ...cua, parentUserId: la.id, lessonStableId: k.v1 })).toEqual({ ok: false, ma: "SAI_PHU_HUYNH" });
    expect(await ghiTienDoBai(db, { ...cua, parentUserId: la.id, lessonStableId: k.v1, percent: 100 })).toEqual({ ok: false, ma: "SAI_PHU_HUYNH" });
    expect(await docKhoaOnlineCuaHocVien(db, { parentUserId: la.id, studentId: hv.id, now: NOW })).toBeNull();
    expect(await docMucLucKhoaCuaHocVien(db, { ...cua, parentUserId: la.id })).toEqual({ ok: false, ma: "SAI_PHU_HUYNH" });
    expect(await db.onlLessonProgress.count({ where: { entitlement: { studentId: hv.id } } })).toBe(0); // người lạ không ghi được gì
    // học viên không gắn phụ huynh nào + parentUserId rỗng
    const mo = await hocVien(null, "mo");
    expect(await kiemTraTruyCapChoPhuHuynh(db, { ...cua, studentId: mo.id, parentUserId: chu.id, lessonStableId: k.v1 })).toEqual({ ok: false, ma: "SAI_PHU_HUYNH" });
    expect(await kiemTraTruyCapChoPhuHuynh(db, { ...cua, parentUserId: "", lessonStableId: k.v1 })).toEqual({ ok: false, ma: "SAI_PHU_HUYNH" });
  });

  it("[ONL-HT-08] khoá BIẾN khỏi danh sách khi thu hồi; hết hạn vẫn còn (nhãn HET_HAN) nhưng không mở được; mục lục báo đúng bài mở/khóa + % khoá", async () => {
    const k = await dungKhoa({ moBai: "KHI_BAI_TRUOC_XONG" });
    const ph = await phuHuynh("p3");
    const hv = await hocVien(ph.id, "h");
    const e = await capChoCon(hv.id, k.courseId);
    await xong(e, k.v1);
    const ml = await docMucLucKhoaCuaHocVien(db, { parentUserId: ph.id, studentId: hv.id, courseId: k.courseId, now: NOW });
    expect(ml.ok).toBe(true);
    if (!ml.ok) return;
    expect(ml.tienDo).toMatchObject({ tongBaiBatBuoc: 4, daXongBatBuoc: 1, phanTram: 25 });
    expect(ml.bai.map((b) => [b.title, b.trangThai, b.mo.mo])).toEqual([["V1", "COMPLETED", true], ["V2", "NOT_STARTED", true], ["Q", "NOT_STARTED", false], ["R", "NOT_STARTED", false]]);
    const sau = new Date(Date.UTC(2027, 5, 1));
    const ds = await docKhoaOnlineCuaHocVien(db, { parentUserId: ph.id, studentId: hv.id, now: sau });
    expect(ds?.[0]).toMatchObject({ trangThai: "HET_HAN", conLaiNgay: 0 });
    // D23 (Owner 25/11/2026): hết hạn vẫn XEM được mục lục (chỉ tiến độ, hetHan:true, KHÔNG bài nào mở) — trước đây trả HET_HAN. Chi tiết + đối chứng: onl-het-han-lich-su-db.test.ts [ONL-HH-01].
    const mlHet = await docMucLucKhoaCuaHocVien(db, { parentUserId: ph.id, studentId: hv.id, courseId: k.courseId, now: sau });
    expect(mlHet).toMatchObject({ ok: true, hetHan: true });
    if (mlHet.ok) expect(mlHet.bai.every((b) => b.mo.mo === false)).toBe(true);
    await thuHoiQuyenHoc(db, { studentId: hv.id, courseId: k.courseId, reason: "Vi phạm điều khoản", idempotencyKey: khoaKey("th"), now: NOW });
    expect(await docKhoaOnlineCuaHocVien(db, { parentUserId: ph.id, studentId: hv.id, now: NOW })).toEqual([]); // thu hồi ⇒ khoá biến mất
  });

  it("[ONL-HT-09] hoàn thành KHOÁ: xong mọi bài bắt buộc (+ thi cuối nếu bật) mới `vuaHoanThanhKhoa`; có thi cuối thì chưa đủ chỉ với bài thường", async () => {
    const k = await dungKhoa({ moBai: "MO_HET", coThi: true });
    const ph = await phuHuynh("p4");
    const hv = await hocVien(ph.id, "i");
    const e = await capChoCon(hv.id, k.courseId);
    await xong(e, k.v2);
    await xong(e, k.q);
    await xong(e, k.v1);
    const r = await ghiTienDoBai(db, { parentUserId: ph.id, studentId: hv.id, courseId: k.courseId, lessonStableId: k.r, daDoc: true, now: NOW });
    expect(r).toMatchObject({ ok: true, vuaHoanThanhBai: true, vuaHoanThanhKhoa: false, tienDo: { duBaiBatBuoc: true, coThiCuoi: true, thiCuoiDat: false, hoanThanh: false } });
    await xong(e, k.thi);
    const sau = await docMucLucKhoaCuaHocVien(db, { parentUserId: ph.id, studentId: hv.id, courseId: k.courseId, now: NOW });
    expect(sau.ok && sau.tienDo.hoanThanh).toBe(true);
  });
});
