// @vitest-environment node
/**
 * [VP-*] PHÁT VIDEO TRẢ PHÍ / HỌC THỬ (V8.44) trên Postgres THẬT + lớp HTTP thật + máy khách R2 GIẢ.
 *
 * KHÔNG dùng `donBangOnl` (TRUNCATE mọi bảng `Onl*` — sẽ xoá dữ liệu của phiên khác trên DB thử dùng chung). Mọi dữ liệu mang tiền tố `CI_OVID_`/`CI-OVID-`
 * và chỉ dọn theo tiền tố. Quyền học được tạo THẲNG bằng `onlEntitlement.create` (không qua `capQuyenHoc`) vì sổ sự kiện quyền là BẤT BIẾN (trigger chặn DELETE) —
 * nên không dọn theo tiền tố được; trạng thái thu hồi/hết hạn đặt thẳng lên dòng quyền, ĐÚNG những cột mà `thuHoiQuyenHoc` ghi (status/revokedAt).
 * Máy khách R2 là đối tượng giả: KHÔNG có lệnh nào tới R2 thật — mức xác minh tối đa của spec này là DB_SCRATCH_VERIFIED, không phải "đã phát từ R2".
 */
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ success: true, remaining: 99, resetAt: Date.now() + 1000 })) }));

import { db } from "../../lib/db";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { moBanNhap, themBai, themChuong } from "../../lib/elearning-online/noi-dung";
import { laKhoaVideoOnlineHopLe } from "../../lib/elearning-online/video-khoa";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { capVePhatHocThu, capVePhatHocVien, kiemVePhat } from "../../lib/elearning-online/video-phat";
import { xuLyCapVeHocThu, xuLyPhat } from "../../lib/elearning-online/video-phat-http";
import { capVeMedia, docVe, kyVe } from "../../lib/elearning-online/ve-media";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
/** Vùng khoá của Core E (`online/video/`) — KHÔNG trùng đường phát `/api/public/elearning-online/video/phat` (trước dấu `online` có dấu `-`). */
const KHOA_VUNG_E = /(^|[^-])online\/video\//;

if (!process.env.NEXTAUTH_SECRET || process.env.NEXTAUTH_SECRET.length < 32) process.env.NEXTAUTH_SECRET = "onl-test-only-signing-secret-32-chars-min";

const P = "CI_OVID_";
const NOW = new Date(Date.UTC(2026, 10, 25, 5, 0, 0));
const s = (giay: number) => new Date(NOW.getTime() + giay * 1000);
const KHOA_VIDEO = "online/video/ovid/bai-1.mp4";
const BUCKET = "bucket-da-co-test";
let n = 0;

async function don() {
  const ds = await db.student.findMany({ where: { name: { startsWith: P } }, select: { id: true } });
  await db.onlEntitlement.deleteMany({ where: { studentId: { in: ds.map((x) => x.id) } } });
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: "ci-ovid-" } } });
  await db.onlCourse.deleteMany({ where: { code: { startsWith: "CI-OVID-" } } });
}

type Dung = Awaited<ReturnType<typeof dung>>;
async function dung(o: { mediaRef?: string | null; khongXemLai?: boolean; hocThu?: boolean; banStatus?: "ON_SALE" | "NOT_ON_SALE" } = {}) {
  const t = await taoKhoa(db, { code: `CI-OVID-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${P}Khoá ${n}`, listPrice: 1, salePrice: 1, validityMonths: 6, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const c = await themChuong(db, { versionId: t.draftVersionId, title: "C" });
  if (!c.ok) throw new Error("c");
  const mediaRef = o.mediaRef === undefined ? KHOA_VIDEO : o.mediaRef;
  const video = await themBai(db, { versionId: t.draftVersionId, chapterId: c.chapterId, kind: "VIDEO", title: "Video", freePreview: o.hocThu ?? false, contentJson: mediaRef === null ? {} : { mediaRef: laKhoaVideoOnlineHopLe(mediaRef) ? mediaRef : "online/video/ovid/cho-ghi-de.mp4" } });
  const traPhi = await themBai(db, { versionId: t.draftVersionId, chapterId: c.chapterId, kind: "VIDEO", title: "Video trả phí", freePreview: false, contentJson: { mediaRef: "online/video/ovid/tra-phi.mp4" } });
  const doc = await themBai(db, { versionId: t.draftVersionId, chapterId: c.chapterId, kind: "READ", title: "R", freePreview: true, contentJson: { body: "x" } });
  if (!video.ok || !traPhi.ok || !doc.ok) throw new Error(`bai: ${JSON.stringify([video, traPhi, doc].filter((x) => !x.ok))}`);
  await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET", khongChoXemLaiBaiDaQua: o.khongXemLai ?? false } });
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error("xt");
  const ph0 = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
  if (!ph0.ok) throw new Error("phat hanh");
  await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: o.banStatus ?? "ON_SALE" });
  const khoa = await db.onlCourse.findUniqueOrThrow({ where: { id: t.courseId }, select: { slug: true, publishedVersionId: true } });
  // Core E CHẶN khoá ngoài vùng ngay lúc LƯU (`MEDIA_NGOAI_VUNG`); ca âm của lớp phát cần dữ liệu xấu "ghi tay" ⇒ ghi thẳng vào bản đã phát hành (đúng thứ lớp phát phải chống).
  if (typeof mediaRef === "string" && !laKhoaVideoOnlineHopLe(mediaRef)) {
    await db.onlLesson.updateMany({ where: { versionId: khoa.publishedVersionId!, stableId: video.stableId }, data: { contentJson: { mediaRef } } });
  }
  const ph = await db.user.create({ data: { name: `${P}ph`, email: `ci-ovid-${Date.now()}-${++n}@example.test`, role: "PARENT" }, select: { id: true } });
  const hv = await db.student.create({ data: { name: `${P}hv-${n}`, parentUserId: ph.id }, select: { id: true } });
  const q = await db.onlEntitlement.create({ data: { studentId: hv.id, courseId: t.courseId, status: "ACTIVE", source: "FREE_GRANT", startsAt: NOW, expiresAt: new Date(Date.UTC(2027, 4, 25)), anchorDay: 25, validityMonthsSnapshot: 6 }, select: { id: true } });
  return { courseId: t.courseId, slug: khoa.slug, versionId: khoa.publishedVersionId!, ph: ph.id, hv: hv.id, ent: q.id, video: video.stableId, traPhi: traPhi.stableId, doc: doc.stableId };
}
const cap = (k: Dung, lessonStableId: string, now = NOW, ttlGiay?: number) => capVePhatHocVien(db, { parentUserId: k.ph, studentId: k.hv, courseId: k.courseId, lessonStableId, now, ...(ttlGiay ? { ttlGiay } : {}) });
const veHV = async (k: Dung, lessonStableId = k.video) => {
  const r = await cap(k, lessonStableId);
  if (!r.ok) throw new Error(`cap: ${r.ma}`);
  return r.ve;
};
const thuHoi = (k: Dung) => db.onlEntitlement.update({ where: { id: k.ent }, data: { status: "REVOKED", revokedAt: s(30), revokedReason: "Hoàn tiền theo yêu cầu" } });

// ───── R2 giả ─────
const NOI_DUNG = Buffer.from("0123456789");
function s3Gia() {
  const lenh: Array<{ loai: string; input: Record<string, unknown> }> = [];
  return {
    lenh,
    send: vi.fn(async (c: unknown) => {
      if (c instanceof HeadObjectCommand) {
        lenh.push({ loai: "HEAD", input: c.input as unknown as Record<string, unknown> });
        return { ContentLength: NOI_DUNG.length };
      }
      if (c instanceof GetObjectCommand) {
        lenh.push({ loai: "GET", input: c.input as unknown as Record<string, unknown> });
        const r = /^bytes=(\d+)-(\d+)$/.exec(String(c.input.Range ?? ""));
        const phan = r ? NOI_DUNG.subarray(Number(r[1]), Number(r[2]) + 1) : NOI_DUNG;
        return { Body: { transformToWebStream: () => new ReadableStream({ start(k) { k.enqueue(new Uint8Array(phan)); k.close(); } }) } };
      }
      throw new Error("lệnh lạ");
    }),
  };
}
const GET = (ve: string, range?: string) => new Request(`http://localhost/api/public/elearning-online/video/phat?ve=${ve}`, { headers: range ? { range } : {} });

describe.skipIf(!RUN_DB_TESTS)("[VP] phát video Online — Postgres thật + R2 giả", () => {
  beforeAll(async () => {
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    await don();
  }, 120_000);
  afterAll(async () => {
    await don();
    delete process.env.ELEARNING_ONLINE_ENABLED;
  }, 120_000);
  beforeEach(() => {
    process.env.R2_ONLINE_VIDEO_BUCKET_NAME = BUCKET;
    process.env.R2_ACCOUNT_ID = "acc-test";
    process.env.R2_ACCESS_KEY_ID = "key-test";
    process.env.R2_SECRET_ACCESS_KEY = "secret-test";
    delete process.env.R2_BUCKET_NAME;
    delete process.env.R2_CHAT_BUCKET_NAME;
  });

  it("[VP-01] cấp vé: DTO đủ trường, vé KHÔNG chứa khoá media, gắn người xem/khoá/bài/phiên bản/quyền; TTL kẹp [10, 300]", async () => {
    const k = await dung();
    const r = await cap(k, k.video);
    expect(r).toMatchObject({ ok: true, ttlGiay: 120, loai: "TRA_PHI", loaiTep: "video/mp4" });
    if (!r.ok) return;
    expect(r.hetHanLuc.toISOString()).toBe(s(120).toISOString());
    const payload = JSON.parse(Buffer.from(r.ve.split(".")[0]!, "base64url").toString());
    expect(payload).toMatchObject({ m: "HV", p: k.ph, s: k.hv, c: k.courseId, l: k.video, b: k.versionId, e: k.ent });
    expect(r.ve).not.toMatch(KHOA_VUNG_E);
    expect(JSON.stringify(payload)).not.toMatch(KHOA_VUNG_E);
    expect(JSON.stringify(payload)).not.toContain(".mp4");
    const lon = await cap(k, k.video, NOW, 99_999);
    const be = await cap(k, k.video, NOW, 1);
    expect(lon).toMatchObject({ ok: true, ttlGiay: 300 });
    expect(be).toMatchObject({ ok: true, ttlGiay: 10 });
  });

  it("[VP-02] 🔴 cổng khi CẤP: sai phụ huynh · không quyền · thu hồi · hết hạn · không phải video · chưa gắn video · khoá sai chính sách · bài lạ · kho chưa cấu hình", async () => {
    const k = await dung();
    const la = await db.user.create({ data: { name: `${P}la`, email: `ci-ovid-la-${Date.now()}@example.test`, role: "PARENT" }, select: { id: true } });
    expect(await capVePhatHocVien(db, { parentUserId: la.id, studentId: k.hv, courseId: k.courseId, lessonStableId: k.video, now: NOW })).toEqual({ ok: false, ma: "SAI_PHU_HUYNH" });
    const hvKhac = await db.student.create({ data: { name: `${P}hv-khac`, parentUserId: k.ph }, select: { id: true } });
    expect(await capVePhatHocVien(db, { parentUserId: k.ph, studentId: hvKhac.id, courseId: k.courseId, lessonStableId: k.video, now: NOW })).toEqual({ ok: false, ma: "KHONG_CO_QUYEN" });
    expect(await cap(k, k.doc)).toEqual({ ok: false, ma: "BAI_KHONG_PHAI_VIDEO" });
    expect(await cap(k, "khong-co")).toMatchObject({ ok: false, ma: "BAI_KHONG_TON_TAI" });
    delete process.env.R2_ONLINE_VIDEO_BUCKET_NAME;
    expect(await cap(k, k.video)).toEqual({ ok: false, ma: "KHO_VIDEO_CHUA_CAU_HINH" });
    process.env.R2_ONLINE_VIDEO_BUCKET_NAME = BUCKET;
    expect(await cap(k, k.video, new Date(Date.UTC(2027, 5, 1)))).toMatchObject({ ok: false, ma: "HET_HAN" });
    await thuHoi(k);
    expect(await cap(k, k.video)).toMatchObject({ ok: false, ma: "DA_THU_HOI" });

    const chua = await dung({ mediaRef: null });
    expect(await cap(chua, chua.video)).toEqual({ ok: false, ma: "CHUA_CO_VIDEO" });
    for (const xau of ["scorm/abc/index.mp4", "online/video/../scorm/a.mp4", "online/video/a.html", "online/video/a.mp4?x=1"]) {
      const kx = await dung({ mediaRef: xau });
      expect(await cap(kx, kx.video), xau).toEqual({ ok: false, ma: "KHOA_VIDEO_KHONG_HOP_LE" });
    }
  });

  it("[VP-03] 🔴 dùng vé: trả khoá + loại tệp CHỈ khi cổng còn mở; hết hạn đúng giây; THU HỒI / HẾT HẠN QUYỀN sau khi cấp ⇒ cắt ngay (không chờ vé hết hạn)", async () => {
    const k = await dung();
    const ve = await veHV(k);
    expect(await kiemVePhat(db, ve, s(60))).toEqual({ ok: true, khoa: KHOA_VIDEO, contentType: "video/mp4", loai: "TRA_PHI" });
    expect(await kiemVePhat(db, ve, s(119))).toMatchObject({ ok: true });
    expect(await kiemVePhat(db, ve, s(120))).toEqual({ ok: false, ma: "VE_HET_HAN" }); // đúng giây hết hạn ⇒ hết
    expect(await kiemVePhat(db, ve, s(500))).toEqual({ ok: false, ma: "VE_HET_HAN" });
    await thuHoi(k);
    expect(await kiemVePhat(db, ve, s(60))).toEqual({ ok: false, ma: "DA_THU_HOI" });
    // hết hạn quyền: vé cấp sát hạn, dùng sau hạn quyền (vé còn hạn nhưng quyền thì không)
    const k2 = await dung();
    const hetHan = (await db.onlEntitlement.findUniqueOrThrow({ where: { id: k2.ent } })).expiresAt!;
    const sat = new Date(hetHan.getTime() - 5_000);
    const r2 = await cap(k2, k2.video, sat);
    if (!r2.ok) throw new Error("r2");
    expect(await kiemVePhat(db, r2.ve, sat)).toMatchObject({ ok: true });
    expect(await kiemVePhat(db, r2.ve, new Date(hetHan.getTime() + 1000))).toMatchObject({ ok: false }); // hết hạn vé hoặc quyền — cả hai đều cắt
    await db.onlEntitlement.update({ where: { id: k2.ent }, data: { expiresAt: new Date(sat.getTime() + 1000) } });
    expect(await kiemVePhat(db, r2.ve, new Date(sat.getTime() + 2000))).toEqual({ ok: false, ma: "HET_HAN" }); // quyền rút ngắn ⇒ cắt dù vé còn hạn
  });

  it("[VP-04] 🔴 phiên bản: khoá phát hành bản mới ⇒ vé cũ VE_PHIEN_BAN_CU; vé mới phát đúng khoá media CỦA BẢN MỚI", async () => {
    const k = await dung();
    const cu = await veHV(k);
    expect(await kiemVePhat(db, cu, s(10))).toMatchObject({ ok: true, khoa: KHOA_VIDEO });
    const nhap = await moBanNhap(db, k.courseId, null);
    if (!nhap.ok) throw new Error("nhap");
    await db.onlLesson.updateMany({ where: { versionId: nhap.versionId, stableId: k.video }, data: { contentJson: { mediaRef: "online/video/ovid/bai-1-v2.mp4" } } });
    const cs = { loai: "KEEP_PROGRESS" as const };
    const xt = await xemTruocPhatHanh(db, k.courseId, cs);
    if (!xt.ok) throw new Error("xt");
    const ph = await phatHanh(db, { courseId: k.courseId, chinhSach: cs, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, s(20));
    if (!ph.ok) throw new Error(`ph2: ${ph.ma}`);
    expect(await kiemVePhat(db, cu, s(30))).toEqual({ ok: false, ma: "VE_PHIEN_BAN_CU" });
    const moi = await cap(k, k.video, s(30));
    if (!moi.ok) throw new Error("moi");
    expect(await kiemVePhat(db, moi.ve, s(40))).toMatchObject({ ok: true, khoa: "online/video/ovid/bai-1-v2.mp4" });
  });

  it("[VP-05] 🔴 chéo khoá/bài/người/loại: sửa một trường ⇒ chữ ký sai; ký lại hợp lệ nhưng lệch quyền/phụ huynh ⇒ từ chối; vé đời cũ KHÔNG phát được", async () => {
    const a = await dung();
    const b = await dung();
    const ve = await veHV(a);
    const [p, sig] = ve.split(".") as [string, string];
    const nd = JSON.parse(Buffer.from(p, "base64url").toString()) as Record<string, unknown>;
    const sua = (patch: Record<string, unknown>) => `${Buffer.from(JSON.stringify({ ...nd, ...patch })).toString("base64url")}.${sig}`;
    for (const [ten, patch] of [["bài khác", { l: a.traPhi }], ["khoá khác", { c: b.courseId }], ["học viên khác", { s: b.hv }], ["phụ huynh khác", { p: b.ph }], ["đổi loại sang công khai", { m: "CK" }], ["quyền khác", { e: b.ent }], ["kéo dài hạn", { x: (nd.x as number) + 99_999 }]] as const) {
      expect(await kiemVePhat(db, sua(patch), s(10)), ten).toEqual({ ok: false, ma: "VE_SAI_CHU_KY" });
    }
    // Ký lại HỢP LỆ (kẻ có khoá ký) nhưng mô tả một tổ hợp không có thật ⇒ cổng DB vẫn từ chối.
    const x = Math.floor(s(100).getTime() / 1000);
    const ky = (o: Partial<Parameters<typeof kyVe>[0]>) => kyVe({ e: a.ent, s: a.hv, c: a.courseId, l: a.video, x, p: a.ph, b: a.versionId, m: "HV", ...o });
    expect(await kiemVePhat(db, ky({ e: b.ent }), s(10))).toEqual({ ok: false, ma: "VE_KHONG_KHOP_QUYEN" });
    expect(await kiemVePhat(db, ky({ p: b.ph }), s(10))).toEqual({ ok: false, ma: "VE_KHONG_KHOP_QUYEN" }); // phụ huynh khác không sở hữu học viên
    expect(await kiemVePhat(db, ky({ s: b.hv }), s(10))).toEqual({ ok: false, ma: "VE_KHONG_KHOP_QUYEN" });
    expect(await kiemVePhat(db, ky({ c: b.courseId }), s(10))).toEqual({ ok: false, ma: "VE_KHONG_KHOP_QUYEN" });
    expect(await kiemVePhat(db, ky({ l: "bai-khong-co" }), s(10))).toMatchObject({ ok: false, ma: "BAI_KHONG_TON_TAI" });
    expect(await kiemVePhat(db, ky({ l: a.doc }), s(10))).toEqual({ ok: false, ma: "BAI_KHONG_PHAI_VIDEO" });
    expect(await kiemVePhat(db, ky({ b: b.versionId }), s(10))).toEqual({ ok: false, ma: "VE_PHIEN_BAN_CU" });
    expect(await kiemVePhat(db, ky({ p: undefined as never }), s(10))).toEqual({ ok: false, ma: "VE_SAI_DINH_DANG" });
    expect(await kiemVePhat(db, ky({ b: undefined as never }), s(10))).toEqual({ ok: false, ma: "VE_SAI_DINH_DANG" });
    expect(await kiemVePhat(db, ky({ m: undefined as never }), s(10))).toEqual({ ok: false, ma: "VE_SAI_DINH_DANG" });
    // vé đời cũ (`capVeMedia`: dùng để đổi khoá media) không có `m` ⇒ KHÔNG phát được
    const cu = await capVeMedia(db, { parentUserId: a.ph, studentId: a.hv, courseId: a.courseId, lessonStableId: a.video, now: NOW });
    if (!cu.ok) throw new Error("cu");
    expect(await kiemVePhat(db, cu.ve, s(10))).toEqual({ ok: false, ma: "VE_SAI_DINH_DANG" });
    // rác
    for (const rac of ["", "abc", "a.b", `${p}.`, `${"x".repeat(30)}.${"y".repeat(43)}`, "  ", `${p}.${"A".repeat(43)}`]) expect((await kiemVePhat(db, rac, s(10))).ok, rac).toBe(false);
    expect(docVe(ve, s(10))).toMatchObject({ ok: true });
  });

  it("[VP-06] 🔴 'không cho xem lại': CHẶN lúc cấp vé (cổng đầy đủ); KHÔNG cắt vé đang phát (bài vừa chạm ngưỡng hoàn thành giữa lúc phát)", async () => {
    const k = await dung({ khongXemLai: true });
    const ve = await veHV(k);
    await db.onlLessonProgress.create({ data: { entitlementId: k.ent, lessonStableId: k.video, status: "COMPLETED", percent: 100, completedAt: s(50), completedVersionNumber: 1 } });
    expect(await kiemVePhat(db, ve, s(60))).toMatchObject({ ok: true, khoa: KHOA_VIDEO }); // đang phát dở thì tua/đọc tiếp được
    expect(await cap(k, k.video, s(60))).toEqual({ ok: false, ma: "DA_HOAN_THANH_KHONG_XEM_LAI" }); // mở LẠI thì không
    await thuHoi(k);
    expect(await kiemVePhat(db, ve, s(70))).toEqual({ ok: false, ma: "DA_THU_HOI" }); // ngoại lệ KHÔNG che được thu hồi
  });

  it("[VP-07] học thử (Free Mode): chỉ bài VIDEO được đánh dấu học thử của khoá công khai; bài trả phí / bài ẩn / khoá không công khai / bài lạ ⇒ CÙNG KHONG_TIM_THAY", async () => {
    const k = await dung({ hocThu: true });
    const r = await capVePhatHocThu(db, { slug: k.slug, lessonStableId: k.video, now: NOW });
    expect(r).toMatchObject({ ok: true, loai: "HOC_THU", ttlGiay: 120, loaiTep: "video/mp4" });
    if (!r.ok) return;
    const payload = JSON.parse(Buffer.from(r.ve.split(".")[0]!, "base64url").toString());
    expect(payload).toMatchObject({ m: "CK", c: k.courseId, l: k.video, b: k.versionId, e: "", s: "" });
    expect(payload.p).toBeUndefined();
    expect(r.ve).not.toMatch(KHOA_VUNG_E);
    expect(await kiemVePhat(db, r.ve, s(30))).toEqual({ ok: true, khoa: KHOA_VIDEO, contentType: "video/mp4", loai: "HOC_THU" });
    // bài trả phí cùng khoá, bài lạ, khoá lạ ⇒ cùng một câu trả lời
    expect(await capVePhatHocThu(db, { slug: k.slug, lessonStableId: k.traPhi, now: NOW })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    expect(await capVePhatHocThu(db, { slug: k.slug, lessonStableId: "khong-co", now: NOW })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    expect(await capVePhatHocThu(db, { slug: "khoa-khong-co", lessonStableId: k.video, now: NOW })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    // bài ĐỌC học thử không phải video
    expect(await capVePhatHocThu(db, { slug: k.slug, lessonStableId: k.doc, now: NOW })).toEqual({ ok: false, ma: "BAI_KHONG_PHAI_VIDEO" });
    // vé công khai KHÔNG mở bài trả phí: ký lại hợp lệ nhưng bài không phải học thử ⇒ vị từ công khai từ chối
    const x = Math.floor(s(100).getTime() / 1000);
    expect(await kiemVePhat(db, kyVe({ e: "", s: "", c: k.courseId, l: k.traPhi, x, b: k.versionId, m: "CK" }), s(10))).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    // Đào tạo BỎ đánh dấu học thử SAU khi cấp vé ⇒ cắt ngay
    await db.onlLesson.updateMany({ where: { versionId: k.versionId, stableId: k.video }, data: { freePreview: false } });
    expect(await kiemVePhat(db, r.ve, s(30))).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    expect(await capVePhatHocThu(db, { slug: k.slug, lessonStableId: k.video, now: NOW })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    // bật lại + ẩn bài ⇒ không công khai
    await db.onlLesson.updateMany({ where: { versionId: k.versionId, stableId: k.video }, data: { freePreview: true, hidden: true } });
    expect(await capVePhatHocThu(db, { slug: k.slug, lessonStableId: k.video, now: NOW })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    // khoá ngừng bán (không còn công khai) ⇒ cắt vé đã cấp
    await db.onlLesson.updateMany({ where: { versionId: k.versionId, stableId: k.video }, data: { hidden: false } });
    expect(await capVePhatHocThu(db, { slug: k.slug, lessonStableId: k.video, now: NOW })).toMatchObject({ ok: true });
    await doiTrangThaiBan(db, { courseId: k.courseId, saleStatus: "PAUSED" });
    expect(await kiemVePhat(db, r.ve, s(30))).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    const chuaBan = await dung({ hocThu: true, banStatus: "NOT_ON_SALE" });
    expect(await capVePhatHocThu(db, { slug: chuaBan.slug, lessonStableId: chuaBan.video, now: NOW })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
  });

  it("[VP-07b] 🔴 vé học thử gắn PHIÊN BẢN: khoá phát hành bản mới ⇒ vé cũ VE_PHIEN_BAN_CU, vé mới phát được", async () => {
    const k = await dung({ hocThu: true });
    const cu = await capVePhatHocThu(db, { slug: k.slug, lessonStableId: k.video, now: NOW });
    if (!cu.ok) throw new Error("cu");
    expect(await kiemVePhat(db, cu.ve, s(10))).toMatchObject({ ok: true });
    const nhap = await moBanNhap(db, k.courseId, null);
    if (!nhap.ok) throw new Error("nhap");
    const cs = { loai: "KEEP_PROGRESS" as const };
    const xt = await xemTruocPhatHanh(db, k.courseId, cs);
    if (!xt.ok) throw new Error("xt");
    const ph = await phatHanh(db, { courseId: k.courseId, chinhSach: cs, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, s(20));
    if (!ph.ok) throw new Error(`ph2: ${ph.ma}`);
    expect(await kiemVePhat(db, cu.ve, s(30))).toEqual({ ok: false, ma: "VE_PHIEN_BAN_CU" });
    const moi = await capVePhatHocThu(db, { slug: k.slug, lessonStableId: k.video, now: s(30) });
    if (!moi.ok) throw new Error("moi");
    expect(await kiemVePhat(db, moi.ve, s(40))).toMatchObject({ ok: true, loai: "HOC_THU" });
  });

  it("[VP-08] 🔴 đầu-cuối qua HTTP thật (R2 giả): vé trả phí phát Range, THU HỒI giữa chừng ⇒ lượt Range kế tiếp 403 và R2 không bị chạm; khoá R2 = khoá TRONG DB", async () => {
    const k = await dung();
    const ve = await veHV(k);
    const s3 = s3Gia();
    const r1 = await xuLyPhat(GET(ve, "bytes=2-5"), { s3, db, now: s(10) });
    expect(r1.status).toBe(206);
    expect(r1.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await r1.text()).toBe("2345");
    expect(s3.lenh.every((l) => l.input.Key === KHOA_VIDEO && l.input.Bucket === BUCKET)).toBe(true);
    const r2 = await xuLyPhat(GET(ve), { s3, db, now: s(20) });
    expect(r2.status).toBe(200);
    expect(await r2.text()).toBe("0123456789");
    await thuHoi(k);
    const dem = s3.lenh.length;
    const r3 = await xuLyPhat(GET(ve, "bytes=6-9"), { s3, db, now: s(40) });
    expect(r3.status).toBe(403);
    expect(((await r3.json()) as { error: { code: string } }).error.code).toBe("DA_THU_HOI");
    expect(s3.lenh.length).toBe(dem);
    // vé hết hạn ⇒ 401, R2 không bị chạm
    const k2 = await dung();
    const ve2 = await veHV(k2);
    const r4 = await xuLyPhat(GET(ve2), { s3, db, now: s(200) });
    expect(r4.status).toBe(401);
    expect(s3.lenh.length).toBe(dem);
  });

  it("[VP-09] 🔴 khoá media trong DB bị đặt sai (đi lên thư mục / ngoài kho / đuôi lạ) ⇒ route phát từ chối 409 và R2 KHÔNG bị chạm; chưa gắn video ⇒ 409", async () => {
    const k = await dung();
    const ve = await veHV(k);
    const s3 = s3Gia();
    for (const xau of ["online/video/../scorm/abc/index.mp4", "scorm/abc/index.mp4", "online/video/a.html", "online/video/%2e%2e/a.mp4"]) {
      await db.onlLesson.updateMany({ where: { versionId: k.versionId, stableId: k.video }, data: { contentJson: { mediaRef: xau } } });
      const r = await xuLyPhat(GET(ve), { s3, db, now: s(10) });
      expect(r.status, xau).toBe(409);
      expect(((await r.json()) as { error: { code: string } }).error.code, xau).toBe("KHOA_VIDEO_KHONG_HOP_LE");
    }
    await db.onlLesson.updateMany({ where: { versionId: k.versionId, stableId: k.video }, data: { contentJson: {} } });
    expect((await xuLyPhat(GET(ve), { s3, db, now: s(10) })).status).toBe(409);
    expect(s3.lenh).toHaveLength(0);
  });

  it("[VP-10] học thử đầu-cuối qua HTTP (không đăng nhập): cấp vé → phát 200/206 → bỏ học thử ⇒ 404 và R2 không bị chạm; bài trả phí 404 cùng thân", async () => {
    const k = await dung({ hocThu: true });
    const post = () => new Request(`http://localhost/api/public/elearning-online/khoa/${k.slug}/hoc-thu/${k.video}/video-ticket`, { method: "POST" });
    const cap1 = await xuLyCapVeHocThu(post(), k.slug, k.video, { db, now: NOW });
    expect(cap1.status).toBe(200);
    expect(cap1.headers.get("cache-control")).toBe("no-store");
    const d = (await cap1.json()) as { data: { duongPhat: string; loai: string; ttlGiay: number } };
    expect(d.data.loai).toBe("HOC_THU");
    expect(JSON.stringify(d)).not.toMatch(KHOA_VUNG_E);
    const ve = new URL(d.data.duongPhat, "http://localhost").searchParams.get("ve")!;
    const s3 = s3Gia();
    const ok = await xuLyPhat(GET(ve, "bytes=0-3"), { s3, db, now: s(10) });
    expect(ok.status).toBe(206);
    expect(await ok.text()).toBe("0123");
    const traPhi = await xuLyCapVeHocThu(post(), k.slug, k.traPhi, { db, now: NOW });
    const lac = await xuLyCapVeHocThu(post(), k.slug, "khong-co-bai-nay", { db, now: NOW });
    expect(traPhi.status).toBe(404);
    expect(lac.status).toBe(404);
    const [a, b] = [(await traPhi.json()) as { error: { code: string; message: string } }, (await lac.json()) as { error: { code: string; message: string } }];
    expect(a.error).toMatchObject({ code: "KHONG_TIM_THAY", message: b.error.message }); // bài trả phí ≡ bài không tồn tại: không lộ
    await db.onlLesson.updateMany({ where: { versionId: k.versionId, stableId: k.video }, data: { freePreview: false } });
    const dem = s3.lenh.length;
    expect((await xuLyPhat(GET(ve), { s3, db, now: s(20) })).status).toBe(404);
    expect(s3.lenh.length).toBe(dem);
  });
});
