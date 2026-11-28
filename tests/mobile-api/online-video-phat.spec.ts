import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});
// R2 GIẢ: không có lệnh nào tới R2 thật. `getR2Client` là điểm duy nhất route phát dùng để chạm R2.
const R2 = vi.hoisted(() => {
  const lenh: Array<{ loai: string; input: Record<string, unknown> }> = [];
  const noiDung = Buffer.from("0123456789");
  return {
    lenh,
    send: async (c: { constructor: { name: string }; input: Record<string, unknown> }) => {
      if (c.constructor.name === "HeadObjectCommand") {
        lenh.push({ loai: "HEAD", input: c.input });
        return { ContentLength: noiDung.length };
      }
      lenh.push({ loai: "GET", input: c.input });
      const r = /^bytes=(\d+)-(\d+)$/.exec(String(c.input.Range ?? ""));
      const phan = r ? noiDung.subarray(Number(r[1]), Number(r[2]) + 1) : noiDung;
      return { Body: { transformToWebStream: () => new ReadableStream({ start(k) { k.enqueue(new Uint8Array(phan)); k.close(); } }) } };
    },
  };
});
vi.mock("@/lib/storage/r2-client", async (goc) => ({ ...(await goc<typeof import("@/lib/storage/r2-client")>()), getR2Client: () => R2 }));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { POST as veRoute } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/video-ticket/route";
import { GET as phatGet, HEAD as phatHead } from "@/app/api/public/elearning-online/video/phat/route";
import { POST as veHocThuRoute } from "@/app/api/public/elearning-online/khoa/[slug]/hoc-thu/[bai]/video-ticket/route";
import { db } from "@/lib/db";
import { caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "@/lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "@/lib/elearning-online/noi-dung";
import { laKhoaVideoOnlineHopLe } from "@/lib/elearning-online/video-khoa";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
/** Vùng khoá của Core E (`online/video/`) — KHÔNG trùng đường phát `/api/public/elearning-online/video/phat` (trước dấu `online` có dấu `-`). */
const KHOA_VUNG_E = /(^|[^-])online\/video\//;

/**
 * [VPM] V8.44 — CẤP VÉ + PHÁT video qua HTTP route-handler + Postgres thật + R2 GIẢ (mức DB_SCRATCH_VERIFIED, chưa phải HTTP thật qua máy chủ):
 *   [VPM-01] cấp vé: chưa đăng nhập 401 · cờ tắt 404 · con nhà khác 404 · có quyền 200 (DTO, no-store, không khoá media)
 *   [VPM-02] mã lỗi: không quyền 403 · thu hồi 403 · hết hạn 403 · không phải video 422 · chưa gắn video 409 · kho chưa cấu hình 503
 *   [VPM-03] vé → GET /video/phat: 206 Range đúng byte; HEAD; thu hồi GIỮA CHỪNG ⇒ 403 và R2 không bị chạm; vé hết hạn 401; khoá lấy từ DB
 *   [VPM-04] chế độ học sinh: đúng con ⇒ 200; anh/chị/em ⇒ 403
 *   [VPM-05] học thử không đăng nhập: cấp vé 200 → phát 206; bài trả phí ≡ bài lạ ⇒ 404
 * Dọn CHỈ theo tiền tố (`ovidm-`/`CI-OVIDM-`) — không `donBangOnl` (TRUNCATE) vì DB thử dùng chung với phiên khác.
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "ovidm-";
const MK = "Mat-khau-test-2026";
const KHOA_R2 = "online/video/ovidm/video-1.mp4";
let dem = 0;
let n = 0;
const ip = () => `10.97.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
const NOW = new Date();

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  const hs = await db.student.findMany({ where: { OR: [{ id: { startsWith: NS } }, { parentUserId: { in: uids } }] }, select: { id: true } });
  await db.onlEntitlement.deleteMany({ where: { studentId: { in: hs.map((h) => h.id) } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { id: { in: hs.map((h) => h.id) } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.onlCourse.deleteMany({ where: { code: { startsWith: "CI-OVIDM-" } } });
}

async function dungKhoa(o: { mediaRef?: string | null; hocThu?: boolean } = {}) {
  const t = await taoKhoa(db, { code: `CI-OVIDM-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${NS}Khoá ${n}`, listPrice: 1, salePrice: 1, validityMonths: 6, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const ch = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
  if (!ch.ok) throw new Error("chuong");
  const mediaRef = o.mediaRef === undefined ? KHOA_R2 : o.mediaRef;
  const v = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "VIDEO", title: "V1", freePreview: o.hocThu ?? false, contentJson: mediaRef === null ? {} : { mediaRef: laKhoaVideoOnlineHopLe(mediaRef) ? mediaRef : "online/video/ovidm/cho-ghi-de.mp4" } });
  const tp = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "VIDEO", title: "V2 trả phí", contentJson: { mediaRef: "online/video/ovidm/tra-phi.mp4" } });
  const doc = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "READ", title: "R", contentJson: { body: "x" } });
  if (!v.ok || !tp.ok || !doc.ok) throw new Error(`bai: ${JSON.stringify([v, tp, doc].filter((x) => !x.ok))}`);
  await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET" } });
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  const kh = await db.onlCourse.findUniqueOrThrow({ where: { id: t.courseId }, select: { slug: true, publishedVersionId: true } });
  // Core E CHẶN khoá ngoài vùng ngay lúc LƯU; ca âm của lớp phát cần dữ liệu xấu "ghi tay" ⇒ ghi thẳng vào bản đã phát hành.
  if (typeof mediaRef === "string" && !laKhoaVideoOnlineHopLe(mediaRef)) {
    await db.onlLesson.updateMany({ where: { versionId: kh.publishedVersionId!, stableId: v.stableId }, data: { contentJson: { mediaRef } } });
  }
  return { courseId: t.courseId, slug: kh.slug, video: v.stableId, traPhi: tp.stableId, doc: doc.stableId };
}
const cap = (studentId: string, courseId: string, hetHan: Date = new Date(NOW.getTime() + 180 * 86_400_000)) =>
  db.onlEntitlement.create({ data: { studentId, courseId, status: "ACTIVE", source: "FREE_GRANT", startsAt: NOW, expiresAt: hetHan, anchorDay: 1, validityMonthsSnapshot: 6 }, select: { id: true } });

describe.skipIf(!RUN)("[VPM] video-ticket + phát qua HTTP route-handler + Postgres thật (R2 giả)", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  let tB = "";
  const P = (k: string) => ids[k]!;
  const ctx = (studentId: string, courseId: string, lessonId: string) => ({ params: Promise.resolve({ studentId, courseId, lessonId }) as never });
  const ve = (tok: string | null, sv: string, c: string, l: string) => veRoute(req("POST", `/api/mobile/v1/students/${sv}/online/courses/${c}/lessons/${l}/video-ticket`, undefined, tok ? bearer(tok) : undefined), ctx(sv, c, l));
  const duongVe = (r: Tra) => new URL(r.data.duongPhat as string, "http://localhost");
  const phat = (u: URL, range?: string, method: "GET" | "HEAD" = "GET") => (method === "GET" ? phatGet : phatHead)(new Request(u, { method, headers: range ? { range } : {} }));

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    process.env.R2_ONLINE_VIDEO_BUCKET_NAME = "bucket-da-co-test";
    process.env.R2_ACCOUNT_ID = "acc-test";
    process.env.R2_ACCESS_KEY_ID = "key-test";
    process.env.R2_SECRET_ACCESS_KEY = "secret-test";
    delete process.env.R2_BUCKET_NAME;
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, sdt: string) => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: sdt, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id);
    await mk("A", "84966920001");
    await mk("B", "84966920002");
    for (const [k, ph] of [["ON", "A"], ["ANH", "A"], ["KHONG", "A"], ["B1", "B"]] as const) {
      ids[`s${k}`] = (await db.student.create({ data: { id: `${NS}s${k}`, name: `Bé ${k}`, parentUserId: ids[ph] } as never, select: { id: true } })).id;
    }
    const dn = async (sdt: string, nn: number) => {
      const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9f44-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
      return ((await json(r)).data as { accessToken: string }).accessToken;
    };
    tA = await dn("0966920001", 1);
    tB = await dn("0966920002", 2);
    for (const t of [tA, tB]) await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
  }, 180_000);
  afterAll(async () => {
    await don();
    for (const k of ["ELEARNING_ONLINE_ENABLED", "R2_ONLINE_VIDEO_BUCKET_NAME", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) delete process.env[k];
  }, 180_000);

  it("[VPM-01] cấp vé: chưa đăng nhập 401 · cờ tắt 404 · con nhà khác 404 · có quyền 200 (DTO, no-store, KHÔNG khoá media/bucket)", async () => {
    const k = await dungKhoa();
    await cap(P("sON"), k.courseId);
    expect(await ma(await ve(null, P("sON"), k.courseId, k.video))).toEqual([401, "UNAUTHENTICATED"]);
    expect(await ma(await ve(tB, P("sON"), k.courseId, k.video))).toEqual([404, "NOT_FOUND"]); // phụ huynh khác không cầm được học viên của nhà này
    process.env.ELEARNING_ONLINE_ENABLED = "false";
    try {
      expect(await ma(await ve(tA, P("sON"), k.courseId, k.video))).toEqual([404, "NOT_FOUND"]);
    } finally {
      process.env.ELEARNING_ONLINE_ENABLED = "true";
    }
    const r = await ve(tA, P("sON"), k.courseId, k.video);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const b = await json(r);
    expect(Object.keys(b.data).sort()).toEqual(["duongPhat", "hetHanLuc", "hoTroRange", "lamMoiTruocLuc", "loai", "loaiTep", "ttlGiay"]);
    expect(b.data).toMatchObject({ loai: "TRA_PHI", ttlGiay: 120, loaiTep: "video/mp4", hoTroRange: true });
    expect(b.data.duongPhat).toMatch(/^\/api\/public\/elearning-online\/video\/phat\?ve=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(new Date(b.data.lamMoiTruocLuc).getTime()).toBeLessThan(new Date(b.data.hetHanLuc).getTime());
    expect(JSON.stringify(b)).not.toMatch(/(?<!-)online\/video\/|bucket-da-co-test|\.mp4\b.*kho|mediaRef/);
  });

  it("[VPM-02] mã lỗi đúng bảng: không quyền 403 · thu hồi 403 · hết hạn 403 · không phải video 422 · chưa gắn video 409 · bài lạ 404 · kho chưa cấu hình 503", async () => {
    const k = await dungKhoa();
    expect(await ma(await ve(tA, P("sKHONG"), k.courseId, k.video))).toEqual([403, "KHONG_CO_QUYEN"]);
    const q = await cap(P("sKHONG"), k.courseId);
    expect((await ve(tA, P("sKHONG"), k.courseId, k.video)).status).toBe(200); // đối chứng dương
    expect(await ma(await ve(tA, P("sKHONG"), k.courseId, k.doc))).toEqual([422, "BAI_KHONG_PHAI_VIDEO"]);
    expect(await ma(await ve(tA, P("sKHONG"), k.courseId, "bai-khong-co"))).toEqual([404, "BAI_KHONG_TON_TAI"]);
    delete process.env.R2_ONLINE_VIDEO_BUCKET_NAME;
    expect(await ma(await ve(tA, P("sKHONG"), k.courseId, k.video))).toEqual([503, "KHO_VIDEO_CHUA_CAU_HINH"]);
    process.env.R2_ONLINE_VIDEO_BUCKET_NAME = "bucket-da-co-test";
    await db.onlEntitlement.update({ where: { id: q.id }, data: { status: "REVOKED", revokedAt: NOW, revokedReason: "Hoàn tiền theo yêu cầu" } });
    expect(await ma(await ve(tA, P("sKHONG"), k.courseId, k.video))).toEqual([403, "DA_THU_HOI"]);
    await db.onlEntitlement.update({ where: { id: q.id }, data: { status: "ACTIVE", revokedAt: null, revokedReason: null, expiresAt: new Date(NOW.getTime() - 86_400_000) } });
    expect(await ma(await ve(tA, P("sKHONG"), k.courseId, k.video))).toEqual([403, "HET_HAN"]);
    const chua = await dungKhoa({ mediaRef: null });
    await cap(P("sANH"), chua.courseId);
    expect(await ma(await ve(tA, P("sANH"), chua.courseId, chua.video))).toEqual([409, "CHUA_CO_VIDEO"]);
    const xau = await dungKhoa({ mediaRef: "scorm/abc/index.mp4" });
    await cap(P("sANH"), xau.courseId);
    expect(await ma(await ve(tA, P("sANH"), xau.courseId, xau.video))).toEqual([409, "KHOA_VIDEO_KHONG_HOP_LE"]);
  });

  it("[VPM-03] 🔴 vé → phát: 206 Range đúng byte · HEAD · khoá R2 lấy từ DB · THU HỒI giữa chừng ⇒ 403 và R2 không bị chạm · vé hết hạn ⇒ 401 · vé rác ⇒ 4xx", async () => {
    const k = await dungKhoa();
    const q = await cap(P("sON"), k.courseId);
    const u = duongVe(await json(await ve(tA, P("sON"), k.courseId, k.video)));
    R2.lenh.length = 0;
    const r1 = await phat(u, "bytes=3-6");
    expect(r1.status).toBe(206);
    expect(r1.headers.get("content-range")).toBe("bytes 3-6/10");
    expect(r1.headers.get("content-type")).toBe("video/mp4");
    expect(r1.headers.get("cache-control")).toBe("no-store");
    expect(await r1.text()).toBe("3456");
    expect(R2.lenh.every((l) => l.input.Key === KHOA_R2 && l.input.Bucket === "bucket-da-co-test")).toBe(true);
    const h = await phat(u, undefined, "HEAD");
    expect([h.status, h.headers.get("content-length"), await h.text()]).toEqual([200, "10", ""]);
    expect((await phat(u, "bytes=99-")).status).toBe(416);
    await db.onlEntitlement.update({ where: { id: q.id }, data: { status: "REVOKED", revokedAt: NOW, revokedReason: "Hoàn tiền theo yêu cầu" } });
    const dem = R2.lenh.length;
    const r2 = await phat(u, "bytes=0-1");
    expect(await ma(r2)).toEqual([403, "DA_THU_HOI"]);
    expect(R2.lenh.length).toBe(dem);
    // vé rác / sai chữ ký / thiếu vé
    const x = new URL(u);
    x.searchParams.set("ve", "rac");
    expect((await phat(x)).status).toBe(400);
    x.searchParams.set("ve", `${"A".repeat(40)}.${"B".repeat(43)}`);
    expect((await phat(x)).status).toBe(401);
    x.searchParams.delete("ve");
    expect((await phat(x)).status).toBe(400);
    expect(R2.lenh.length).toBe(dem);
  });

  it("[VPM-04] chế độ học sinh: đúng con ⇒ 200; anh/chị/em ⇒ 403 FORBIDDEN", async () => {
    const k = await dungKhoa();
    await cap(P("sON"), k.courseId);
    await cap(P("sANH"), k.courseId);
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: "0966920001", matKhau: MK, thietBi: { maThietBi: "00000000-0000-4000-9f44-0000000000a9", nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const hs = ((await json(r)).data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(hs)));
    expect((await codePost(req("POST", "/x", { ma: "4827", xacNhan: "4827" }, bearer(hs)))).status).toBe(200);
    expect((await enterPost(req("POST", "/x", { studentId: P("sON") }, bearer(hs)))).status).toBe(200);
    expect((await ve(hs, P("sON"), k.courseId, k.video)).status).toBe(200);
    expect(await ma(await ve(hs, P("sANH"), k.courseId, k.video))).toEqual([403, "FORBIDDEN"]);
  });

  it("[VPM-05] học thử không đăng nhập: cấp vé 200 → phát 206; bài trả phí ≡ bài lạ ⇒ cùng 404 KHONG_TIM_THAY; no-store", async () => {
    const k = await dungKhoa({ hocThu: true });
    const post = (bai: string) => veHocThuRoute(req("POST", `/x`), { params: Promise.resolve({ slug: k.slug, bai }) as never });
    const ok = await post(k.video);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const b = await json(ok);
    expect(b.data).toMatchObject({ loai: "HOC_THU", ttlGiay: 120, loaiTep: "video/mp4", hoTroRange: true });
    expect(JSON.stringify(b)).not.toMatch(KHOA_VUNG_E);
    const r = await phat(duongVe(b), "bytes=0-3");
    expect([r.status, await r.text()]).toEqual([206, "0123"]);
    const tp = await post(k.traPhi);
    const lac = await post("khong-co-bai");
    expect([tp.status, lac.status]).toEqual([404, 404]);
    expect(tp.headers.get("cache-control")).toBe("no-store");
    expect(((await json(tp)).error as { code: string; message: string }).message).toBe(((await json(lac)).error as { code: string; message: string }).message);
    // Đào tạo bỏ học thử ⇒ vé đã cấp bị cắt ngay
    await db.onlLesson.updateMany({ where: { version: { courseId: k.courseId, status: "PUBLISHED" }, stableId: k.video }, data: { freePreview: false } });
    expect((await phat(duongVe(b), "bytes=0-3")).status).toBe(404);
  });
});
