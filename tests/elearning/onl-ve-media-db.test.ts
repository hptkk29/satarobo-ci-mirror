// @vitest-environment node
/** [ONL-VM-*] Vé media ngắn hạn cho video trả phí (lớp QUYỀN, chưa phải kho video): cấp qua cổng · không chứa khoá media · hỏi lại cổng khi dùng · chống giả/hết hạn. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { capVeMedia, docVe, kiemVeMedia, kyVe, TTL_VE_TOI_DA } from "../../lib/elearning-online/ve-media";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "../../lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { capQuyenHoc, thuHoiQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

import { donBangOnl } from "./_onl-don";

// Khoá ký chỉ cho test (≥32 ký tự). CI luôn có NEXTAUTH_SECRET; máy dev có thể chưa đặt — không để test thuần đỏ vì lý do môi trường.
if (!process.env.NEXTAUTH_SECRET || process.env.NEXTAUTH_SECRET.length < 32) process.env.NEXTAUTH_SECRET = "onl-test-only-signing-secret-32-chars-min"; // `??=` KHÔNG đủ: .env.test có thể mang khoá NGẮN (<32) — đúng bẫy 17/09

const P = "CI_ONLM_";
const NOW = new Date(Date.UTC(2026, 10, 19, 5, 0, 0));
const s = (giay: number) => new Date(NOW.getTime() + giay * 1000);
let n = 0;
let key = 0;
const khoaKey = (t: string) => `${P}${t}-${++key}-${Math.random().toString(36).slice(2, 8)}`;
const MEDIA_BI_MAT = "online/video/ci/KHO-BI-MAT-xyz-123.mp4";

async function don() {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: "ci-onlm-" } } });
}

async function dung(o: { video?: boolean } = {}) {
  const t = await taoKhoa(db, { code: `CI-ONLM-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${P}Khoá ${n}`, listPrice: 1, salePrice: 1, validityMonths: 6, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const c = await themChuong(db, { versionId: t.draftVersionId, title: "C" });
  if (!c.ok) throw new Error("c");
  const video = await themBai(db, { versionId: t.draftVersionId, chapterId: c.chapterId, kind: "VIDEO", title: "V", contentJson: o.video === false ? {} : { mediaRef: MEDIA_BI_MAT } });
  const doc = await themBai(db, { versionId: t.draftVersionId, chapterId: c.chapterId, kind: "READ", title: "R", contentJson: { body: "x" } });
  if (!video.ok || !doc.ok) throw new Error("bai");
  await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET" } });
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error("xt");
  await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
  await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  const ph = await db.user.create({ data: { name: `${P}ph`, email: `ci-onlm-${Date.now()}-${++n}@example.test`, role: "PARENT" }, select: { id: true } });
  const hv = await db.student.create({ data: { name: `${P}hv-${n}`, parentUserId: ph.id }, select: { id: true } });
  const cap = await capQuyenHoc(db, { studentId: hv.id, courseId: t.courseId, loai: "MUA", now: NOW, idempotencyKey: khoaKey("m") });
  if (!cap.ok) throw new Error(cap.thongBao);
  return { courseId: t.courseId, ph: ph.id, hv: hv.id, video: video.stableId, doc: doc.stableId, entitlementId: cap.entitlementId };
}
const args = (k: Awaited<ReturnType<typeof dung>>, lessonStableId: string, now = NOW) => ({ parentUserId: k.ph, studentId: k.hv, courseId: k.courseId, lessonStableId, now });

describe("[ONL-VM] vé — logic thuần", () => {
  it("🔴 ký/đọc: chữ ký sai, payload bị sửa, rác, hết hạn đều bị từ chối; vé hợp lệ đọc được và KHÔNG chứa khoá media", () => {
    const x = Math.floor(NOW.getTime() / 1000) + 100;
    const ve = kyVe({ e: "ent1", s: "hv1", c: "kh1", l: "bai1", x });
    expect(docVe(ve, NOW)).toMatchObject({ ok: true, nd: { e: "ent1", s: "hv1", c: "kh1", l: "bai1" } });
    expect(Buffer.from(ve.split(".")[0]!, "base64url").toString()).not.toContain("media");
    const [p, sig] = ve.split(".") as [string, string];
    const sua = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), s: "hv-khac" })).toString("base64url");
    expect(docVe(`${sua}.${sig}`, NOW)).toEqual({ ok: false, ma: "VE_SAI_CHU_KY" });
    expect(docVe(`${p}.${"A".repeat(43)}`, NOW)).toEqual({ ok: false, ma: "VE_SAI_CHU_KY" });
    for (const rac of ["", "abc", "a.b", `${p}.`, `${"x".repeat(30)}.${"y".repeat(43)}`, "  "]) expect(docVe(rac, NOW).ok, rac).toBe(false);
    expect(docVe(ve, new Date((x + 1) * 1000))).toEqual({ ok: false, ma: "VE_HET_HAN" });
    expect(docVe(ve, new Date(x * 1000))).toEqual({ ok: false, ma: "VE_HET_HAN" }); // đúng giây hết hạn ⇒ hết
  });
});

describe.skipIf(!RUN_DB_TESTS)("[ONL-VM] vé — Postgres thật", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-VM-01] 🔴 cấp vé: chỉ cho bài VIDEO có nguồn; sai phụ huynh/không quyền/thu hồi bị từ chối bằng CÙNG cổng; TTL kẹp [10, 300] giây", async () => {
    const k = await dung();
    const r = await capVeMedia(db, args(k, k.video));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hetHanLuc.toISOString()).toBe(s(120).toISOString());
    expect(r.ve).not.toContain(MEDIA_BI_MAT);
    expect(JSON.stringify(r)).not.toContain("KHO-BI-MAT");
    expect((await capVeMedia(db, { ...args(k, k.video), ttlGiay: 99_999 }) as { hetHanLuc: Date }).hetHanLuc.toISOString()).toBe(s(TTL_VE_TOI_DA).toISOString());
    expect((await capVeMedia(db, { ...args(k, k.video), ttlGiay: 1 }) as { hetHanLuc: Date }).hetHanLuc.toISOString()).toBe(s(10).toISOString());
    expect(await capVeMedia(db, args(k, k.doc))).toEqual({ ok: false, ma: "BAI_KHONG_PHAI_VIDEO" });
    expect(await capVeMedia(db, args(k, "khong-co"))).toMatchObject({ ok: false, ma: "BAI_KHONG_TON_TAI" });
    const la = await db.user.create({ data: { name: `${P}la`, email: `ci-onlm-la-${Date.now()}@example.test`, role: "PARENT" }, select: { id: true } });
    expect(await capVeMedia(db, { ...args(k, k.video), parentUserId: la.id })).toEqual({ ok: false, ma: "SAI_PHU_HUYNH" });
    await thuHoiQuyenHoc(db, { studentId: k.hv, courseId: k.courseId, reason: "Hoàn tiền theo yêu cầu", idempotencyKey: khoaKey("th"), now: NOW });
    expect(await capVeMedia(db, args(k, k.video))).toMatchObject({ ok: false, ma: "DA_THU_HOI" });
    const chuaCo = await dung({ video: false });
    expect(await capVeMedia(db, args(chuaCo, chuaCo.video))).toEqual({ ok: false, ma: "CHUA_CO_VIDEO" });
  });

  it("[ONL-VM-05] 🔴 dòng cũ/ghi tay trỏ RA NGOÀI vùng online/video/ (video giáo trình, SCORM, bài nộp, phôi) ⇒ không cấp vé và khoá KHÔNG rời DB; dòng đúng vùng vẫn chạy", async () => {
    const k = await dung();
    const ve = await capVeMedia(db, args(k, k.video)); // vé cấp khi khoá còn đúng vùng
    if (!ve.ok) throw new Error("ve");
    const datRef = (ref: string) => db.$executeRawUnsafe(`UPDATE "OnlLesson" SET "contentJson" = jsonb_build_object('mediaRef', '${ref}') WHERE "stableId" = '${k.video}'`);
    for (const ngoai of ["sata3/video1.mp4", "scorm/pkg-1/res/video1.mp4", "online/sp/c1/hv2/sa-ban.mp4", "online/cn/c1/phoi.png"]) {
      await datRef(ngoai);
      expect(await capVeMedia(db, args(k, k.video)), ngoai).toEqual({ ok: false, ma: "MEDIA_NGOAI_VUNG" });
      const kq = await kiemVeMedia(db, ve.ve, s(30));
      expect(kq, ngoai).toEqual({ ok: false, ma: "MEDIA_NGOAI_VUNG" });
      expect(JSON.stringify(kq)).not.toContain(ngoai);
    }
    await datRef(MEDIA_BI_MAT);
    expect(await kiemVeMedia(db, ve.ve, s(30))).toMatchObject({ ok: true, mediaRef: MEDIA_BI_MAT }); // đối chứng dương
  });

  it("[ONL-VM-02] 🔴 dùng vé: đổi ra khoá media CHỈ khi cổng còn mở lúc dùng; vé hết hạn / quyền thu hồi SAU khi cấp / quyền hết hạn ⇒ từ chối; vé của người khác không dùng cho bài khác", async () => {
    const k = await dung();
    const ve = await capVeMedia(db, args(k, k.video));
    if (!ve.ok) throw new Error("ve");
    expect(await kiemVeMedia(db, ve.ve, s(60))).toEqual({ ok: true, mediaRef: MEDIA_BI_MAT, studentId: k.hv, courseId: k.courseId, lessonStableId: k.video });
    expect(await kiemVeMedia(db, ve.ve, s(121))).toEqual({ ok: false, ma: "VE_HET_HAN" });
    // thu hồi quyền SAU khi cấp vé ⇒ vé còn hạn nhưng vô hiệu
    await thuHoiQuyenHoc(db, { studentId: k.hv, courseId: k.courseId, reason: "Gian lận thanh toán", idempotencyKey: khoaKey("th2"), now: s(30) });
    expect(await kiemVeMedia(db, ve.ve, s(60))).toEqual({ ok: false, ma: "DA_THU_HOI" });
    // quyền hết hạn: vé cấp sát hạn, dùng sau hạn
    const k2 = await dung();
    const hetHan = (await db.onlEntitlement.findUniqueOrThrow({ where: { id: k2.entitlementId } })).expiresAt!;
    const sat = new Date(hetHan.getTime() - 5_000);
    const ve2 = await capVeMedia(db, args(k2, k2.video, sat));
    if (!ve2.ok) throw new Error("ve2");
    expect(await kiemVeMedia(db, ve2.ve, sat)).toMatchObject({ ok: true });
    expect(await kiemVeMedia(db, ve2.ve, new Date(hetHan.getTime() + 1000))).toMatchObject({ ok: false }); // hết hạn quyền (hoặc hết hạn vé — cả hai đều từ chối)
    // vé gắn quyền: đổi `e` để đoán — chữ ký sai; vé hợp lệ nhưng dòng quyền khác ⇒ không khớp
    const k3 = await dung();
    const x = Math.floor(NOW.getTime() / 1000) + 100;
    const veLech = kyVe({ e: "quyen-khac", s: k3.hv, c: k3.courseId, l: k3.video, x });
    expect(await kiemVeMedia(db, veLech, NOW)).toEqual({ ok: false, ma: "VE_KHONG_KHOP_QUYEN" });
    const veBaiKhac = kyVe({ e: k3.entitlementId, s: k3.hv, c: k3.courseId, l: k3.doc, x });
    expect(await kiemVeMedia(db, veBaiKhac, NOW)).toEqual({ ok: false, ma: "BAI_KHONG_PHAI_VIDEO" });
  });
});
