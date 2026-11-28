// @vitest-environment node
/**
 * [ONL-FMD-*] FREE MODE ĐĂNG NHẬP (Owner OD06=A) — dùng ĐĂNG NHẬP HIỆN TẠI: bài Đào tạo chọn (freePreview) của khoá đang bán; chỉ VIDEO/READ; vé video gắn TÀI KHOẢN;
 * bài trả phí / bài thi bị cờ nhầm không lộ; không lộ khoá media. Mỗi ca ÂM có ĐỐI CHỨNG DƯƠNG trên cùng khoá.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "../../lib/db";
import { capVeHocThu, capVeHocThuDangNhap, docVeHocThu, kiemTraTruyCapBaiMienPhi, kiemVeHocThu, kiemVeHocThuDangNhap } from "../../lib/elearning-online/ve-hoc-thu";
import { doiTrangThaiBan, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "../../lib/elearning-online/noi-dung";
import { phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

if (!process.env.NEXTAUTH_SECRET || process.env.NEXTAUTH_SECRET.length < 32) process.env.NEXTAUTH_SECRET = "onl-test-only-signing-secret-32-chars-min";

const P = "CI_ONLFMD_";
const NOW = new Date(Date.UTC(2026, 10, 21, 5, 0, 0));
const MEDIA_BI_MAT = "online/video/ci/FMD-BI-MAT-xyz-123.mp4";
const A = "tai-khoan-A";
const B = "tai-khoan-B";
let n = 0;

async function don() {
  await donBangOnl(db);
}

/** Khoá đã phát hành: video học thử · video trả phí · đọc học thử · video học thử media NGOÀI vùng · video học thử chưa gắn video. */
async function dung(ban: "ON_SALE" | "NOT_ON_SALE" = "ON_SALE") {
  const t = await taoKhoa(db, { code: `CI-FMD-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${P}Khoá ${n}`, listPrice: 1, salePrice: 1, validityMonths: 6, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const c = await themChuong(db, { versionId: t.draftVersionId, title: "C" });
  if (!c.ok) throw new Error("c");
  const b = async (kind: "VIDEO" | "READ", title: string, contentJson: object, extra: object = {}) => {
    const r = await themBai(db, { versionId: t.draftVersionId, chapterId: c.chapterId, kind, title, contentJson, ...extra });
    if (!r.ok) throw new Error(r.thongBao);
    return r;
  };
  const thu = await b("VIDEO", "Video học thử", { mediaRef: MEDIA_BI_MAT }, { freePreview: true });
  const traPhi = await b("VIDEO", "Video trả phí", { mediaRef: "online/video/ci/TRA-PHI-1.mp4" });
  const docThu = await b("READ", "Đọc học thử", { body: "x" }, { freePreview: true });
  const ngoai = await b("VIDEO", "Video ngoài vùng", { mediaRef: "online/video/ci/NGOAI-1.mp4" }, { freePreview: true });
  const trong = await b("VIDEO", "Video chưa gắn", {}, { freePreview: true });
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error("xt");
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
  if (!ph.ok) throw new Error(ph.thongBao);
  await db.onlLesson.update({ where: { versionId_stableId: { versionId: ph.versionId, stableId: ngoai.stableId } }, data: { contentJson: { mediaRef: "scorm/giao-trinh/sata3/video1.mp4" } } });
  if (ban === "ON_SALE") await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  const kh = await db.onlCourse.findUniqueOrThrow({ where: { id: t.courseId }, select: { slug: true } });
  return { courseId: t.courseId, slug: kh.slug, thu: thu.stableId, traPhi: traPhi.stableId, docThu: docThu.stableId, ngoai: ngoai.stableId, trong: trong.stableId };
}

describe.skipIf(!RUN_DB_TESTS)("[ONL-FMD] Free Mode đăng nhập (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-FMD-01] 🔴 CHƯA đăng nhập (taiKhoanId rỗng) ⇒ CHUA_DANG_NHAP cho cả xem bài lẫn cấp/đổi vé; đối chứng: có tài khoản ⇒ được", async () => {
    const k = await dung();
    expect(await kiemTraTruyCapBaiMienPhi(db, { taiKhoanId: "", courseId: k.courseId, lessonStableId: k.docThu, now: NOW })).toEqual({ ok: false, ma: "CHUA_DANG_NHAP" });
    expect(await capVeHocThuDangNhap(db, { taiKhoanId: "", slug: k.slug, lessonStableId: k.thu, now: NOW })).toEqual({ ok: false, ma: "CHUA_DANG_NHAP" });
    const ve = await capVeHocThuDangNhap(db, { taiKhoanId: A, slug: k.slug, lessonStableId: k.thu, now: NOW });
    expect(ve.ok).toBe(true);
    expect(await kiemVeHocThuDangNhap(db, ve.ok ? ve.ve : "", "", NOW)).toEqual({ ok: false, ma: "CHUA_DANG_NHAP" });
    expect((await kiemTraTruyCapBaiMienPhi(db, { taiKhoanId: A, courseId: k.courseId, lessonStableId: k.docThu, now: NOW })).ok).toBe(true);
  });

  it("[ONL-FMD-02] 🔴 chỉ bài Đào tạo chọn: bài trả phí và slug lạ ⇒ CÙNG mã KHONG_TIM_THAY (không lộ bài nào tồn tại); READ trả nội dung; VIDEO KHÔNG bao giờ trả khoá media", async () => {
    const k = await dung();
    expect(await kiemTraTruyCapBaiMienPhi(db, { taiKhoanId: A, courseId: k.courseId, lessonStableId: k.traPhi, now: NOW })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    expect(await kiemTraTruyCapBaiMienPhi(db, { taiKhoanId: A, slug: "khong-co-khoa-nay", lessonStableId: k.thu, now: NOW })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    const doc = await kiemTraTruyCapBaiMienPhi(db, { taiKhoanId: A, slug: k.slug, lessonStableId: k.docThu, now: NOW });
    expect(doc).toMatchObject({ ok: true, bai: { kind: "READ", noiDung: { body: "x" } } });
    const vd = await kiemTraTruyCapBaiMienPhi(db, { taiKhoanId: A, slug: k.slug, lessonStableId: k.thu, now: NOW });
    expect(vd).toMatchObject({ ok: true, bai: { kind: "VIDEO", noiDung: null } });
    expect(JSON.stringify(vd)).not.toContain("online/video/");
  });

  it("[ONL-FMD-03] 🔴 bài thi/bài tập/thi cuối bị gắn cờ học thử NHẦM vẫn KHÔNG phục vụ qua Free Mode (lượt làm bài cần quyền học); đối chứng: cùng bài lúc còn là READ thì xem được", async () => {
    const k = await dung();
    expect((await kiemTraTruyCapBaiMienPhi(db, { taiKhoanId: A, courseId: k.courseId, lessonStableId: k.docThu, now: NOW })).ok).toBe(true);
    for (const kind of ["QUIZ", "ASSIGNMENT", "FINAL_EXAM"] as const) {
      await db.onlLesson.updateMany({ where: { stableId: k.docThu, version: { courseId: k.courseId } }, data: { kind } });
      expect(await kiemTraTruyCapBaiMienPhi(db, { taiKhoanId: A, courseId: k.courseId, lessonStableId: k.docThu, now: NOW }), kind).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    }
  });

  it("[ONL-FMD-04] 🔴 vé gắn TÀI KHOẢN: đúng người đổi được khoá; người khác dùng lại ⇒ VE_KHONG_DUNG_TAI_KHOAN; vé công khai cũ (không u) ⇒ VE_THIEU_TAI_KHOAN; vé có u ở đường công khai ⇒ VE_CAN_TAI_KHOAN", async () => {
    const k = await dung();
    const ve = await capVeHocThuDangNhap(db, { taiKhoanId: A, slug: k.slug, lessonStableId: k.thu, now: NOW });
    if (!ve.ok) throw new Error(ve.ma);
    expect(docVeHocThu(ve.ve, NOW)).toMatchObject({ ok: true, nd: { u: A } });
    expect(await kiemVeHocThuDangNhap(db, ve.ve, A, NOW)).toMatchObject({ ok: true, mediaRef: MEDIA_BI_MAT });
    expect(await kiemVeHocThuDangNhap(db, ve.ve, B, NOW)).toEqual({ ok: false, ma: "VE_KHONG_DUNG_TAI_KHOAN" });
    expect(await kiemVeHocThu(db, ve.ve, NOW)).toEqual({ ok: false, ma: "VE_CAN_TAI_KHOAN" });
    const cu = await capVeHocThu(db, { slug: k.slug, lessonStableId: k.thu, now: NOW });
    if (!cu.ok) throw new Error(cu.ma);
    expect(await kiemVeHocThuDangNhap(db, cu.ve, A, NOW)).toEqual({ ok: false, ma: "VE_THIEU_TAI_KHOAN" });
    expect(await kiemVeHocThu(db, cu.ve, NOW)).toMatchObject({ ok: true }); // đối chứng: vé công khai cũ vẫn chạy ở đường cũ
  });

  it("[ONL-FMD-05] 🔴 sửa vé (đổi u sang người khác) bị chữ ký chặn; vé hết hạn ⇒ VE_HET_HAN; media ngoài vùng / chưa gắn / bài trả phí không cấp vé", async () => {
    const k = await dung();
    const ve = await capVeHocThuDangNhap(db, { taiKhoanId: A, slug: k.slug, lessonStableId: k.thu, now: NOW, ttlGiay: 30 });
    if (!ve.ok) throw new Error(ve.ma);
    const [p, sig] = ve.ve.split(".") as [string, string];
    const sua = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), u: B })).toString("base64url");
    expect(await kiemVeHocThuDangNhap(db, `${sua}.${sig}`, B, NOW)).toEqual({ ok: false, ma: "VE_SAI_CHU_KY" });
    expect(await kiemVeHocThuDangNhap(db, ve.ve, A, new Date(NOW.getTime() + 31_000))).toEqual({ ok: false, ma: "VE_HET_HAN" });
    expect(await capVeHocThuDangNhap(db, { taiKhoanId: A, slug: k.slug, lessonStableId: k.ngoai, now: NOW })).toEqual({ ok: false, ma: "MEDIA_NGOAI_VUNG" });
    expect(await capVeHocThuDangNhap(db, { taiKhoanId: A, slug: k.slug, lessonStableId: k.trong, now: NOW })).toEqual({ ok: false, ma: "CHUA_CO_VIDEO" });
    expect(await capVeHocThuDangNhap(db, { taiKhoanId: A, slug: k.slug, lessonStableId: k.traPhi, now: NOW })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
  });

  it("[ONL-FMD-06] 🔴 hỏi LẠI khi dùng: Đào tạo bỏ cờ học thử SAU khi cấp vé ⇒ vé vô hiệu; khoá chưa bán ⇒ không xem; đối chiếu: trước khi bỏ cờ thì được", async () => {
    const k = await dung();
    const ve = await capVeHocThuDangNhap(db, { taiKhoanId: A, slug: k.slug, lessonStableId: k.thu, now: NOW });
    if (!ve.ok) throw new Error(ve.ma);
    expect((await kiemVeHocThuDangNhap(db, ve.ve, A, NOW)).ok).toBe(true);
    await db.onlLesson.updateMany({ where: { stableId: k.thu, version: { courseId: k.courseId } }, data: { freePreview: false } });
    expect(await kiemVeHocThuDangNhap(db, ve.ve, A, NOW)).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    expect(await kiemTraTruyCapBaiMienPhi(db, { taiKhoanId: A, courseId: k.courseId, lessonStableId: k.thu, now: NOW })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    const k2 = await dung("NOT_ON_SALE");
    expect(await kiemTraTruyCapBaiMienPhi(db, { taiKhoanId: A, courseId: k2.courseId, lessonStableId: k2.docThu, now: NOW })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
  });

  it("[ONL-FMD-07] Free Mode KHÔNG phụ thuộc quyền học: mã các hàm Free Mode không truy vấn bảng quyền/lượt (nâng cấp lên khoá có phí không đổi quyền xem bài miễn phí)", () => {
    const src = readFileSync("lib/elearning-online/ve-hoc-thu.ts", "utf8");
    const phan = src.slice(src.indexOf("FREE MODE ĐĂNG NHẬP"));
    expect(phan.length).toBeGreaterThan(500);
    expect(phan).not.toMatch(/onlEntitlement/);
    expect(phan).not.toMatch(/onlAttempt/);
  });
});
