// @vitest-environment node
/**
 * [ONL-VHT-*] Vé VIDEO HỌC THỬ (Free Mode, D1) — không đăng nhập: chỉ bài VIDEO "học thử" đang công khai · không lộ khoá media · hỏi lại điều kiện khi dùng ·
 * vé học thử ≠ vé trả phí (hai miền ký) · đổi bản phát hành làm vé cũ vô hiệu. Mỗi ca ÂM có ĐỐI CHỨNG DƯƠNG trên cùng khoá.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { capVeHocThu, docVeHocThu, kiemVeHocThu, kyVeHocThu, TTL_VE_HOC_THU_TOI_DA } from "../../lib/elearning-online/ve-hoc-thu";
import { docVe, kyVe } from "../../lib/elearning-online/ve-media";
import { doiTrangThaiBan, luuTruKhoa, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { moBanNhap, themBai, themChuong } from "../../lib/elearning-online/noi-dung";
import { phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

if (!process.env.NEXTAUTH_SECRET || process.env.NEXTAUTH_SECRET.length < 32) process.env.NEXTAUTH_SECRET = "onl-test-only-signing-secret-32-chars-min";

const P = "CI_ONLVHT_";
const NOW = new Date(Date.UTC(2026, 10, 21, 5, 0, 0));
const s = (giay: number) => new Date(NOW.getTime() + giay * 1000);
const MEDIA_BI_MAT = "online/video/ci/VHT-BI-MAT-xyz-123.mp4";
let n = 0;

async function don() {
  await donBangOnl(db);
}

/** Khoá đã phát hành, ĐANG BÁN: video học thử · video trả phí · đọc học thử · video học thử nhưng media NGOÀI vùng · video học thử CHƯA có video. */
async function dung(ban: "ON_SALE" | "NOT_ON_SALE" = "ON_SALE") {
  const t = await taoKhoa(db, { code: `CI-VHT-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${P}Khoá ${n}`, listPrice: 1, salePrice: 1, validityMonths: 6, renewalEnabled: false }, null);
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
  // Lớp LƯU đã chặn media ngoài vùng; dòng cũ/ghi tay thì không — dựng thẳng vào DB để thử hàng rào ở đầu RA (lúc khoá rời DB).
  await db.onlLesson.update({ where: { versionId_stableId: { versionId: ph.versionId, stableId: ngoai.stableId } }, data: { contentJson: { mediaRef: "scorm/giao-trinh/sata3/video1.mp4" } } });
  if (ban === "ON_SALE") await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  const kh = await db.onlCourse.findUniqueOrThrow({ where: { id: t.courseId }, select: { slug: true } });
  return { courseId: t.courseId, slug: kh.slug, chapterId: c.chapterId, thu: thu.stableId, thuId: thu.lessonId, traPhi: traPhi.stableId, docThu: docThu.stableId, ngoai: ngoai.stableId, trong: trong.stableId };
}

describe("[ONL-VHT] vé học thử — logic thuần", () => {
  it("🔴 ký/đọc: sai chữ ký, payload sửa, rác, hết hạn bị từ chối; vé hợp lệ KHÔNG chứa khoá media; đối chứng: vé đúng đọc được", () => {
    const x = Math.floor(NOW.getTime() / 1000) + 50;
    const ve = kyVeHocThu({ c: "kh1", ver: "v1", l: "bai1", x });
    expect(docVeHocThu(ve, NOW)).toMatchObject({ ok: true, nd: { k: "free", c: "kh1", ver: "v1", l: "bai1" } });
    expect(Buffer.from(ve.split(".")[0]!, "base64url").toString()).not.toContain("media");
    const [p, sig] = ve.split(".") as [string, string];
    const sua = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), l: "bai-tra-phi" })).toString("base64url");
    expect(docVeHocThu(`${sua}.${sig}`, NOW)).toMatchObject({ ok: false, ma: "VE_SAI_CHU_KY" });
    expect(docVeHocThu("rac", NOW)).toMatchObject({ ok: false, ma: "VE_SAI_DINH_DANG" });
    expect(docVeHocThu(ve, new Date((x + 1) * 1000))).toMatchObject({ ok: false, ma: "VE_HET_HAN" });
  });
  it("🔴 HAI MIỀN KÝ: vé trả phí không đọc được như vé học thử và ngược lại (không 'nâng' vé công khai thành quyền học)", () => {
    const x = Math.floor(NOW.getTime() / 1000) + 50;
    const free = kyVeHocThu({ c: "kh1", ver: "v1", l: "b", x });
    const paid = kyVe({ e: "ent", s: "hv", c: "kh1", l: "b", x });
    expect(docVe(free, NOW)).toMatchObject({ ok: false, ma: "VE_SAI_CHU_KY" });
    expect(docVeHocThu(paid, NOW)).toMatchObject({ ok: false, ma: "VE_SAI_CHU_KY" });
    expect(docVeHocThu(free, NOW).ok).toBe(true); // đối chứng dương
  });
});

describe.skipIf(!RUN_DB_TESTS)("[ONL-VHT] vé học thử (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-VHT-01] 🔴 cấp vé CHỈ cho bài VIDEO học thử đang công khai; bài trả phí / bài đọc / slug lạ ⇒ CÙNG mã KHONG_TIM_THAY; đối chứng dương", async () => {
    const k = await dung();
    const ok = await capVeHocThu(db, { slug: k.slug, lessonStableId: k.thu, now: NOW });
    expect(ok).toMatchObject({ ok: true });
    if (!ok.ok) throw new Error();
    expect(ok.hetHanLuc.getTime()).toBe(NOW.getTime() + 60_000);
    expect(ok.ve).not.toContain("VHT-BI-MAT");
    for (const [slug, bai] of [[k.slug, k.traPhi], [k.slug, k.docThu], [k.slug, "khong-co"], ["khong-co-khoa", k.thu]] as const) {
      expect(await capVeHocThu(db, { slug, lessonStableId: bai, now: NOW }), `${slug}/${bai}`).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    }
    expect(await capVeHocThu(db, { slug: k.slug, lessonStableId: k.thu, now: NOW, ttlGiay: 99_999 })).toMatchObject({ ok: true, hetHanLuc: s(TTL_VE_HOC_THU_TOI_DA) });
  });

  it("[ONL-VHT-02] 🔴 khoá RỜI DB chỉ khi vé đúng; media ngoài vùng `online/video/` KHÔNG BAO GIỜ rời DB; chưa gắn video ⇒ CHUA_CO_VIDEO", async () => {
    const k = await dung();
    const c = await capVeHocThu(db, { slug: k.slug, lessonStableId: k.thu, now: NOW });
    if (!c.ok) throw new Error();
    expect(await kiemVeHocThu(db, c.ve, s(10))).toEqual({ ok: true, mediaRef: MEDIA_BI_MAT, courseId: k.courseId, lessonStableId: k.thu });
    expect(await capVeHocThu(db, { slug: k.slug, lessonStableId: k.ngoai, now: NOW })).toEqual({ ok: false, ma: "MEDIA_NGOAI_VUNG" });
    expect(await capVeHocThu(db, { slug: k.slug, lessonStableId: k.trong, now: NOW })).toEqual({ ok: false, ma: "CHUA_CO_VIDEO" });
    // vé giả mạo trỏ vào bài ngoài vùng (ký đúng khoá, tức kẻ có khoá ký) vẫn không lấy được media ngoài vùng
    const ver = (await db.onlCourse.findUniqueOrThrow({ where: { id: k.courseId }, select: { publishedVersionId: true } })).publishedVersionId!;
    const gia = kyVeHocThu({ c: k.courseId, ver, l: k.ngoai, x: Math.floor(NOW.getTime() / 1000) + 30 });
    expect(await kiemVeHocThu(db, gia, NOW)).toEqual({ ok: false, ma: "MEDIA_NGOAI_VUNG" });
    expect(await kiemVeHocThu(db, c.ve, s(61))).toMatchObject({ ok: false, ma: "VE_HET_HAN" });
  });

  it("[ONL-VHT-03] 🔴 HỎI LẠI khi dùng: bỏ cờ học thử / ẩn bài / ẩn chương / tạm ngừng bán / lưu trữ SAU khi cấp vé ⇒ vé vô hiệu NGAY (KHONG_TIM_THAY)", async () => {
    // ẩn bài
    const a = await dung();
    const va = await capVeHocThu(db, { slug: a.slug, lessonStableId: a.thu, now: NOW });
    if (!va.ok) throw new Error();
    expect((await kiemVeHocThu(db, va.ve, NOW)).ok).toBe(true);
    await db.onlLesson.update({ where: { id: a.thuId }, data: { hidden: true } });
    expect(await kiemVeHocThu(db, va.ve, NOW)).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    // bỏ cờ học thử
    const b = await dung();
    const vb = await capVeHocThu(db, { slug: b.slug, lessonStableId: b.thu, now: NOW });
    if (!vb.ok) throw new Error();
    await db.onlLesson.update({ where: { id: b.thuId }, data: { freePreview: false } });
    expect(await kiemVeHocThu(db, vb.ve, NOW)).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    // ẩn chương
    const c = await dung();
    const vc = await capVeHocThu(db, { slug: c.slug, lessonStableId: c.thu, now: NOW });
    if (!vc.ok) throw new Error();
    // chương của BẢN ĐANG PHÁT HÀNH (khác chương của bản nháp đã nhân bản)
    const verC = (await db.onlCourse.findUniqueOrThrow({ where: { id: c.courseId }, select: { publishedVersionId: true } })).publishedVersionId!;
    await db.onlChapter.updateMany({ where: { versionId: verC }, data: { hidden: true } });
    expect(await kiemVeHocThu(db, vc.ve, NOW)).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    // tạm ngừng bán
    const d = await dung();
    const vd = await capVeHocThu(db, { slug: d.slug, lessonStableId: d.thu, now: NOW });
    if (!vd.ok) throw new Error();
    await db.onlCourse.update({ where: { id: d.courseId }, data: { saleStatus: "PAUSED" } });
    expect(await kiemVeHocThu(db, vd.ve, NOW)).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    // lưu trữ
    const e = await dung();
    const ve = await capVeHocThu(db, { slug: e.slug, lessonStableId: e.thu, now: NOW });
    if (!ve.ok) throw new Error();
    expect(await luuTruKhoa(db, e.courseId, NOW)).toEqual({ ok: true });
    expect(await kiemVeHocThu(db, ve.ve, NOW)).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
  });

  it("[ONL-VHT-04] khoá CHƯA bán (đã phát hành) ⇒ không cấp vé dù bài đánh dấu học thử; đối chứng: cùng cấu trúc, đang bán ⇒ cấp được", async () => {
    const chua = await dung("NOT_ON_SALE");
    expect(await capVeHocThu(db, { slug: chua.slug, lessonStableId: chua.thu, now: NOW })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    const co = await dung("ON_SALE");
    expect((await capVeHocThu(db, { slug: co.slug, lessonStableId: co.thu, now: NOW })).ok).toBe(true);
  });

  it("[ONL-VHT-04b] 🔴 hẹn giờ mở bán: CHƯA tới giờ ⇒ không cấp vé, vé đã cấp trước đó vô hiệu; ĐÃ tới giờ ⇒ cấp được; khoá đã lưu trữ dù còn ON_SALE (dữ liệu hỏng) ⇒ không cấp", async () => {
    const k = await dung();
    const truoc = await capVeHocThu(db, { slug: k.slug, lessonStableId: k.thu, now: NOW });
    if (!truoc.ok) throw new Error();
    await db.onlCourse.update({ where: { id: k.courseId }, data: { saleStatus: "SCHEDULED", saleOpensAt: s(3600) } });
    expect(await capVeHocThu(db, { slug: k.slug, lessonStableId: k.thu, now: NOW })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    expect(await kiemVeHocThu(db, truoc.ve, NOW)).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    expect((await capVeHocThu(db, { slug: k.slug, lessonStableId: k.thu, now: s(3600) })).ok).toBe(true); // đối chứng: tới giờ mở bán
    await db.onlCourse.update({ where: { id: k.courseId }, data: { saleStatus: "ON_SALE", saleOpensAt: null } });
    expect((await capVeHocThu(db, { slug: k.slug, lessonStableId: k.thu, now: NOW })).ok).toBe(true);
    await db.onlCourse.update({ where: { id: k.courseId }, data: { deletedAt: NOW } });
    expect(await capVeHocThu(db, { slug: k.slug, lessonStableId: k.thu, now: NOW })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
  });

  it("[ONL-VHT-05] 🔴 phát hành BẢN MỚI ⇒ vé cấp từ bản cũ vô hiệu (VE_KHONG_KHOP_BAN) — không phát video của bản đã gỡ; vé cấp lại ở bản mới dùng được", async () => {
    const k = await dung();
    const cu = await capVeHocThu(db, { slug: k.slug, lessonStableId: k.thu, now: NOW });
    if (!cu.ok) throw new Error();
    // bản nháp mới → sửa nội dung → phát hành lại
    const kh = await db.onlCourse.findUniqueOrThrow({ where: { id: k.courseId }, select: { id: true } });
    const nhap = await moBanNhap(db, kh.id, null);
    if (!nhap.ok) throw new Error(nhap.thongBao);
    const chinhSach = { loai: "KEEP_PROGRESS" as const };
    const xt = await xemTruocPhatHanh(db, k.courseId, chinhSach);
    if (!xt.ok) throw new Error(xt.thongBao);
    const ph = await phatHanh(db, { courseId: k.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH", chinhSach }, null, s(5));
    if (!ph.ok) throw new Error(ph.thongBao);
    expect(await kiemVeHocThu(db, cu.ve, s(6))).toEqual({ ok: false, ma: "VE_KHONG_KHOP_BAN" });
    const moi = await capVeHocThu(db, { slug: k.slug, lessonStableId: k.thu, now: s(6) });
    expect(moi.ok).toBe(true);
    if (moi.ok) expect((await kiemVeHocThu(db, moi.ve, s(7))).ok).toBe(true);
  });
});
