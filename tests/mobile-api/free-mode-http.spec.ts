import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});
// R2 GIẢ: không lệnh nào tới R2 thật. `getR2Client` là điểm duy nhất route phát dùng để chạm R2.
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
import { GET as freeModeGet } from "@/app/api/mobile/v1/parent/free-mode/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as dsGet } from "@/app/api/mobile/v1/online/preview/courses/route";
import { GET as mucLucGet } from "@/app/api/mobile/v1/online/preview/courses/[slug]/route";
import { GET as baiGet } from "@/app/api/mobile/v1/online/preview/courses/[slug]/lessons/[lessonId]/route";
import { POST as veRoute } from "@/app/api/mobile/v1/online/preview/courses/[slug]/lessons/[lessonId]/video-ticket/route";
import { GET as phatGet, HEAD as phatHead } from "@/app/api/mobile/v1/online/preview/video/play/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { GET as hsDsGet } from "@/app/api/mobile/v1/students/[studentId]/online/preview/courses/route";
import { GET as hsMucLucGet } from "@/app/api/mobile/v1/students/[studentId]/online/preview/courses/[slug]/route";
import { POST as hsClaimPost } from "@/app/api/mobile/v1/students/[studentId]/online/preview/courses/[slug]/free-claim/route";
import { POST as hsOpenPost } from "@/app/api/mobile/v1/students/[studentId]/online/preview/courses/[slug]/lessons/[lessonId]/open/route";
import { POST as hsProgressPost } from "@/app/api/mobile/v1/students/[studentId]/online/preview/courses/[slug]/lessons/[lessonId]/progress/route";
import { POST as hsVeRoute } from "@/app/api/mobile/v1/students/[studentId]/online/preview/courses/[slug]/lessons/[lessonId]/video-ticket/route";
import { db } from "@/lib/db";
import { caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "@/lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "@/lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import { capQuyenHoc, thuHoiQuyenHoc } from "@/lib/elearning-online/quyen-hoc-db";
import { docVeHocThu, kyVeHocThu } from "@/lib/elearning-online/ve-hoc-thu";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { clearSettingsCache } from "@/lib/settings/service";
import { donBangOnl } from "../elearning/_onl-don";

/**
 * [FMH] FREE MODE (OD06=A, F1–F4) qua HTTP route-handler + Postgres thật + lõi E THẬT (R2 giả) — mức DB_SCRATCH_VERIFIED (chưa phải HTTP thật qua máy chủ).
 *   NHÓM 1 đọc:   [FMH-01] trạng thái · [FMH-02] danh mục/mục lục · [FMH-03] đọc bài (không ghi gì) · [FMH-04] vé + phát video gắn tài khoản
 *   NHÓM 2 ghi:   [FMH-05] mở bài + tiến độ (chỉ học viên, đơn điệu) · [FMH-06] giới hạn F3 · [FMH-07] có/mất quyền học · [FMH-08] tài khoản chưa có con / IDOR
 *   [FMH-11] C11 (E, #1289): CHUA_XAC_MINH_SDT / VUOT_SO_KHOA_MIEN_PHI ⇒ 403 (+ nhả chỗ khi hết hạn)
 *   NHÓM 3 nhận:  [FMH-09] tự nhận FREE_GRANT (chính sách Admin + khoá công bố + điều kiện + idempotent + không gia hạn vô hạn)
 * Dọn bằng `donBangOnl` (TRUNCATE Onl*) + tiền tố — CHỈ chạy trong khoá DB tuần tự (DB thử dùng chung với phiên khác).
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "fmh-";
const MK = "Mat-khau-test-2026";
const KHOA_R2 = "online/video/fmh/video-1.mp4";
const BI_MAT = "BI-MAT-TRA-PHI-XYZ";
let dem = 0;
let n = 0;
const ip = () => `10.98.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...headers, ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string; maChiTiet?: string; chiTiet?: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
const NOW = new Date();
const NGAY = 86_400_000;

type KhoaOpt = { hocThu?: { dangKyMienPhi: boolean; gioiHanSoBai: number | null; hanNgay: number | null; toiDaKhoaMienPhi?: number | null }; lop?: [number, number]; ban?: "ON_SALE" | "NOT_ON_SALE" | "HEN_GIO_TUONG_LAI"; gia?: number; thang?: number; freeVideo?: boolean };

/** Khoá: v1 VIDEO · r1 READ · v2 VIDEO (đều học thử) · p1 VIDEO + pr READ (trả phí) · q QUIZ bị gắn cờ học thử NHẦM. */
async function dung(o: KhoaOpt = {}) {
  const t = await taoKhoa(db, { code: `CI-FMH-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${NS}Khoá ${n}`, listPrice: o.gia ?? 1000, salePrice: o.gia ?? 1000, validityMonths: o.thang ?? 6, renewalEnabled: false, ...(o.lop ? { gradeFrom: o.lop[0], gradeTo: o.lop[1] } : {}) }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const c = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
  if (!c.ok) throw new Error("chuong");
  const b = async (kind: "VIDEO" | "READ", title: string, contentJson: object, extra: object = {}) => {
    const r = await themBai(db, { versionId: t.draftVersionId, chapterId: c.chapterId, kind, title, contentJson, ...extra });
    if (!r.ok) throw new Error(r.thongBao);
    return r.stableId;
  };
  const free = { freePreview: true };
  const v1 = await b("VIDEO", "Video học thử 1", { mediaRef: KHOA_R2 }, free);
  const r1 = await b("READ", "Bài đọc học thử", { body: "Nội dung đọc thử công khai" }, free);
  const v2 = await b("VIDEO", "Video học thử 2", { mediaRef: "online/video/fmh/video-2.mp4" }, free);
  const p1 = await b("VIDEO", `Video ${BI_MAT}`, { mediaRef: "online/video/fmh/tra-phi.mp4" });
  const pr = await b("READ", `Đọc ${BI_MAT}`, { body: `${BI_MAT}-NOI-DUNG` });
  const q = await b("READ", "Sẽ thành QUIZ", { body: "x" }, free);
  const cd = { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET" as const, ...(o.hocThu ? { hocThu: o.hocThu } : {}) };
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: cd });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
  if (!ph.ok) throw new Error(ph.thongBao);
  await db.onlLesson.updateMany({ where: { stableId: q, version: { courseId: t.courseId } }, data: { kind: "QUIZ" } });
  const ban = o.ban ?? "ON_SALE";
  if (ban === "ON_SALE") await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  if (ban === "HEN_GIO_TUONG_LAI") await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "SCHEDULED", saleOpensAt: new Date(Date.now() + 30 * NGAY) });
  const kh = await db.onlCourse.findUniqueOrThrow({ where: { id: t.courseId }, select: { slug: true } });
  return { courseId: t.courseId, slug: kh.slug, v1, r1, v2, p1, pr, q };
}

async function don() {
  await donBangOnl(db);
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.auditLog.deleteMany({ where: { actorId: { in: uids }, action: "FREE_MODE_SELF_CLAIM" } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { OR: [{ id: { startsWith: NS } }, { parentUserId: { in: uids } }] } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "freemode." } } });
  clearSettingsCache();
}

const datChinhSach = async (bat: boolean, toiDa = 0) => {
  for (const [key, valueJson] of [["freemode.selfClaim.enabled", bat], ["freemode.selfClaim.maxFreeCoursesPerStudent", toiDa]] as const) {
    await db.systemSetting.upsert({ where: { key }, create: { key, valueJson }, update: { valueJson } });
  }
  clearSettingsCache();
};
const demDong = async (sid: string) => ({
  quyen: await db.onlEntitlement.count({ where: { studentId: sid } }),
  tienDoMienPhi: await db.onlFreeLessonProgress.count({ where: { studentId: sid } }),
  tienDoCoPhi: await db.onlLessonProgress.count({ where: { entitlement: { studentId: sid } } }),
  luot: await db.onlAttempt.count({ where: { entitlement: { studentId: sid } } }),
});

// Làm ấm đủ 5 kết nối của pool TRƯỚC mỗi đợt bắn: pool nguội ⇒ lượt đầu commit xong trước khi các lượt sau mở được kết nối ⇒ «song song» thực ra là nối tiếp và ca không bắt được tranh chấp.
const amPool = () => Promise.all(Array.from({ length: 5 }, () => db.$queryRaw`SELECT pg_sleep(0.05)::text AS x`));

describe.skipIf(!RUN)("[FMH] Free Mode qua HTTP route-handler + Postgres thật + lõi E thật", () => {
  const ids: Record<string, string> = {};
  const tok: Record<string, string> = {};
  let devN = 0;
  const P = (k: string) => ids[k]!;
  const pc = (slug: string, ...rest: string[]) => ({ params: Promise.resolve({ slug, lessonId: rest[0] }) as never });
  const cs = (studentId: string, slug: string, lessonId?: string) => ({ params: Promise.resolve({ studentId, slug, lessonId }) as never });
  const U = "/api/mobile/v1/online/preview";
  const SU = (s: string) => `/api/mobile/v1/students/${s}/online/preview`;

  // ── helper gọi route ──
  const freeMode = (t: string | null) => freeModeGet(req("GET", "/api/mobile/v1/parent/free-mode", undefined, t ? bearer(t) : undefined));
  const ds = (t: string | null) => dsGet(req("GET", `${U}/courses`, undefined, t ? bearer(t) : undefined));
  const mucLuc = (t: string | null, slug: string) => mucLucGet(req("GET", `${U}/courses/${slug}`, undefined, t ? bearer(t) : undefined), pc(slug));
  const bai = (t: string | null, slug: string, l: string) => baiGet(req("GET", `${U}/courses/${slug}/lessons/${l}`, undefined, t ? bearer(t) : undefined), pc(slug, l));
  const ve = (t: string | null, slug: string, l: string) => veRoute(req("POST", `${U}/courses/${slug}/lessons/${l}/video-ticket`, undefined, t ? bearer(t) : undefined), pc(slug, l));
  const duongVe = (r: Tra) => new URL(r.data.duongPhat as string, "http://localhost");
  const phat = (t: string | null, u: URL, range?: string, method: "GET" | "HEAD" = "GET") =>
    (method === "GET" ? phatGet : phatHead)(new Request(u, { method, headers: { ...(range ? { range } : {}), ...(t ? { authorization: bearer(t) } : {}), "x-forwarded-for": ip() } }));
  const hsDs = (t: string, s: string) => hsDsGet(req("GET", `${SU(s)}/courses`, undefined, bearer(t)), { params: Promise.resolve({ studentId: s }) as never });
  const hsMucLuc = (t: string, s: string, slug: string) => hsMucLucGet(req("GET", `${SU(s)}/courses/${slug}`, undefined, bearer(t)), cs(s, slug));
  const mo = (t: string, s: string, slug: string, l: string, than: unknown = {}) => hsOpenPost(req("POST", `${SU(s)}/courses/${slug}/lessons/${l}/open`, than, bearer(t)), cs(s, slug, l));
  const td = (t: string, s: string, slug: string, l: string, than: unknown) => hsProgressPost(req("POST", `${SU(s)}/courses/${slug}/lessons/${l}/progress`, than, bearer(t)), cs(s, slug, l));
  const hsVe = (t: string, s: string, slug: string, l: string) => hsVeRoute(req("POST", `${SU(s)}/courses/${slug}/lessons/${l}/video-ticket`, undefined, bearer(t)), cs(s, slug, l));
  const claim = (t: string, s: string, slug: string, than: unknown = {}) => hsClaimPost(req("POST", `${SU(s)}/courses/${slug}/free-claim`, than, bearer(t)), cs(s, slug));

  const dang = async (sdt: string) => {
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9c00-${String(++devN).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const jr = await json(r);
    if (!jr.data) throw new Error(`đăng nhập thất bại: ${JSON.stringify(jr.error)}`);
    const t = (jr.data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
    return t;
  };
  /** Phiên MỚI ở chế độ học sinh của `s` (phụ huynh `ph`). */
  const phienHocSinh = async (sdt: string, ph: string, s: string) => {
    await db.mobileSession.deleteMany({ where: { userId: ph, hocSinhId: { not: null } } });
    const t = await dang(sdt);
    await codePost(req("POST", "/x", { ma: "4827", xacNhan: "4827" }, bearer(t)));
    expect((await enterPost(req("POST", "/x", { studentId: s }, bearer(t)))).status).toBe(200);
    return t;
  };

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    process.env.R2_ONLINE_VIDEO_BUCKET_NAME = "bucket-da-co-test";
    process.env.R2_ACCOUNT_ID = "acc-test";
    process.env.R2_ACCESS_KEY_ID = "key-test";
    process.env.R2_SECRET_ACCESS_KEY = "secret-test";
    delete process.env.R2_BUCKET_NAME;
    process.env.LOGIN_RATELIMIT_DISABLED = "1";
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, sdt: string) => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: sdt, phoneVerifiedAt: new Date(), password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id); // C11 (E, #1289): tự nhận đòi SĐT phụ huynh ĐÃ XÁC MINH ⇒ fixture mặc định đã xác minh
    await mk("A", "84966960001"); // 2 con
    await mk("B", "84966960002"); // 1 con (nhà khác)
    await mk("Z", "84966960003"); // 0 con
    for (const [k, ph, lop] of [["c1", "A", 4], ["c2", "A", 4], ["b1", "B", 4]] as const) {
      ids[`s${k}`] = (await db.student.create({ data: { id: `${NS}s${k}`, name: `Bé ${k}`, parentUserId: ids[ph], currentGrade: lop } as never, select: { id: true } })).id;
    }
    tok.A = await dang("0966960001");
    tok.B = await dang("0966960002");
    tok.Z = await dang("0966960003");
  }, 240_000);
  afterAll(async () => {
    await don();
    for (const k of ["ELEARNING_ONLINE_ENABLED", "R2_ONLINE_VIDEO_BUCKET_NAME", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "LOGIN_RATELIMIT_DISABLED"]) delete process.env[k];
  }, 240_000);

  // mỗi ca tự dựng khoá riêng ⇒ dọn bảng Onl* trước từng ca (trong khoá DB tuần tự) để số đếm toàn cục là của chính ca đó
  beforeEach(async () => {
    await donBangOnl(db);
    await db.auditLog.deleteMany({ where: { action: "FREE_MODE_SELF_CLAIM", actorId: { in: [P("A"), P("B"), P("Z")] } } });
    await db.systemSetting.deleteMany({ where: { key: { startsWith: "freemode." } } });
    clearSettingsCache();
  }, 120_000);

  // ════════════════════ NHÓM 1 — ĐỌC ════════════════════

  it("[FMH-01] 🔴 GET /parent/free-mode: 401 không token · 404 cờ tắt · 403 chế độ học sinh · 0 con ⇒ FREE + không ghi tiến độ · 2 con ⇒ FULL; tự nhận mặc định TẮT (fail-closed)", async () => {
    expect(await ma(await freeMode(null))).toEqual([401, "UNAUTHENTICATED"]);
    process.env.ELEARNING_ONLINE_ENABLED = "false";
    try {
      expect(await ma(await freeMode(tok.Z!))).toEqual([404, "NOT_FOUND"]);
    } finally {
      process.env.ELEARNING_ONLINE_ENABLED = "true";
    }
    const z = await freeMode(tok.Z!);
    expect(z.status).toBe(200);
    expect(z.headers.get("cache-control")).toBe("no-store");
    const bz = (await json(z)).data;
    expect(bz).toMatchObject({
      taiKhoan: { soHocVien: 0, phuHuynhThuan: true },
      goiYCheDo: "FREE",
      tinhNang: { hocThuOnline: { bat: true }, ghiTienDoHocThu: { bat: false, lyDo: "CHUA_CO_HOC_VIEN" }, tuNhanMienPhi: { bat: false, lyDo: "CHINH_SACH_TAT" }, datLichHocThuTaiCoSo: { bat: false, lyDo: "CHO_QUYET_DINH" } },
      hocVien: [],
      goiYNangCap: [],
    });
    const a = (await json(await freeMode(tok.A!))).data;
    expect(a).toMatchObject({ taiKhoan: { soHocVien: 2 }, goiYCheDo: "FULL", tinhNang: { ghiTienDoHocThu: { bat: true, ai: "HOC_VIEN_CHE_DO_HOC_SINH" } } });
    expect(a.hocVien.map((h: { id: string }) => h.id).sort()).toEqual([P("sc1"), P("sc2")].sort()); // chỉ con CỦA MÌNH
    expect(JSON.stringify(a)).not.toContain(P("sb1"));
    // chế độ học sinh ⇒ 403
    const hs = await phienHocSinh("0966960001", P("A"), P("sc1"));
    expect(await ma(await freeMode(hs))).toEqual([403, "FORBIDDEN"]);
  });

  it("[FMH-02] 🔴 danh mục + mục lục: chỉ khoá ĐANG BÁN có bài VIDEO/READ học thử; mọi bài liệt kê đều mở được; bài trả phí/QUIZ gắn cờ nhầm ≡ bài lạ (cùng 404, không lộ tên)", async () => {
    const k = await dung();
    const henGio = await dung({ ban: "HEN_GIO_TUONG_LAI" });
    const chuaBan = await dung({ ban: "NOT_ON_SALE" });
    const r = await ds(tok.Z!);
    expect(r.status).toBe(200);
    const d = await json(r);
    const slugs = d.data.muc.map((m: { slug: string }) => m.slug);
    expect(slugs).toContain(k.slug); // đối chứng dương
    expect(slugs).not.toContain(henGio.slug); // hẹn giờ chưa tới giờ
    expect(slugs).not.toContain(chuaBan.slug);
    const m = d.data.muc.find((x: { slug: string }) => x.slug === k.slug);
    expect(m).toMatchObject({ soBaiHocThu: 3, choTuNhan: false });
    expect(JSON.stringify(d)).not.toContain(BI_MAT);

    const ml = await json(await mucLuc(tok.Z!, k.slug));
    expect(ml.data.bai.map((b: { lessonId: string }) => b.lessonId).sort()).toEqual([k.v1, k.r1, k.v2].sort()); // KHÔNG có QUIZ gắn cờ nhầm
    expect(ml.data.soBaiKhac).toBe(3); // p1 + pr + q: chỉ là MỘT CON SỐ
    expect(JSON.stringify(ml)).not.toMatch(new RegExp(`${BI_MAT}|Sẽ thành QUIZ|contentJson|online/video|mediaRef`));
    expect(ml.data.chinhSach).toEqual({ gioiHanSoBai: null, hanNgay: null, choTuNhan: false });
    // mọi bài liệt kê đều mở được (property)
    for (const b of ml.data.bai) expect((await bai(tok.Z!, k.slug, b.lessonId)).status, b.lessonId).toBe(200);
    // bài không liệt kê ⇒ cùng một câu trả lời với bài không tồn tại
    const lac = await json(await bai(tok.Z!, k.slug, "bai-khong-co"));
    for (const id of [k.p1, k.pr, k.q]) {
      const rr = await bai(tok.Z!, k.slug, id);
      expect([rr.status, await rr.json()]).toEqual([404, expect.objectContaining({ error: expect.objectContaining({ code: "KHONG_TIM_THAY", message: lac.error!.message }) })]);
    }
    expect(await ma(await mucLuc(tok.Z!, henGio.slug))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await mucLuc(tok.Z!, chuaBan.slug))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await mucLuc(tok.Z!, "KHÔNG-hợp-lệ"))).toEqual([404, "NOT_FOUND"]);
    expect((await ds(null)).status).toBe(401);
    expect((await dsGet(req("GET", `${U}/courses?x=1`, undefined, bearer(tok.Z!)))).status).toBe(400);
  });

  it("[FMH-03] 🔴 phụ huynh ĐỌC bài học thử (cả tài khoản 0 con): READ có thân bài, VIDEO chỉ metadata (không khoá media); KHÔNG tạo quyền/tiến độ/lượt; chế độ học sinh ⇒ 403", async () => {
    const k = await dung();
    const truoc = await Promise.all([P("sc1"), P("sc2")].map(demDong));
    for (const t of [tok.Z!, tok.A!]) {
      const doc = await json(await bai(t, k.slug, k.r1));
      expect(doc.data.bai).toMatchObject({ lessonId: k.r1, loai: "READ", noiDung: { body: "Nội dung đọc thử công khai" } });
      const vd = await json(await bai(t, k.slug, k.v1));
      expect(vd.data.bai).toEqual({ lessonId: k.v1, tieuDe: "Video học thử 1", loai: "VIDEO", coVideo: true });
      expect(JSON.stringify(vd)).not.toMatch(/online\/video|mediaRef/);
    }
    expect(await Promise.all([P("sc1"), P("sc2")].map(demDong))).toEqual(truoc);
    expect(await db.onlEntitlement.count()).toBe(0);
    const hs = await phienHocSinh("0966960001", P("A"), P("sc1"));
    expect(await ma(await bai(hs, k.slug, k.r1))).toEqual([403, "FORBIDDEN"]); // học sinh đọc qua `open`, không qua GET của phụ huynh
  });

  it("[FMH-04] 🔴 vé video GẮN TÀI KHOẢN + phát có Bearer: 206 đúng byte · replay trong hạn · không Bearer 401 · tài khoản khác 403 · vé hết hạn 410 · thiếu u 403 · sai chữ ký 403 · rác 400 · bỏ cờ học thử ⇒ cắt ngay, R2 không bị chạm", async () => {
    const k = await dung();
    expect(await ma(await ve(null, k.slug, k.v1))).toEqual([401, "UNAUTHENTICATED"]);
    const r = await ve(tok.Z!, k.slug, k.v1);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const b = await json(r);
    expect(Object.keys(b.data).sort()).toEqual(["canBearer", "duongPhat", "hetHanLuc", "hoTroRange", "lamMoiTruocLuc", "loai", "loaiTep", "ttlGiay"]);
    expect(b.data).toMatchObject({ loai: "HOC_THU", ttlGiay: 60, loaiTep: "video/mp4", hoTroRange: true, canBearer: true });
    expect(b.data.duongPhat).toMatch(/^\/api\/mobile\/v1\/online\/preview\/video\/play\?ve=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(b)).not.toMatch(/(?<!-)online\/video\/|bucket-da-co-test|mediaRef/);
    const u = duongVe(b);
    R2.lenh.length = 0;
    const r1 = await phat(tok.Z!, u, "bytes=3-6");
    if (process.env.FM_GHI_MAU) {
      // chỉ khi được yêu cầu: ghi MẪU JSON của vé (200) + đầu phản hồi phát — từ route-handler có R2 giả (3223 không có R2). KHÔNG token; vé thay bằng <ve>.
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync("docs/mobile-integration/samples-v845-free-mode", { recursive: true });
      const sach = JSON.parse(JSON.stringify(b, (_k, v) => (typeof v === "string" ? v.replace(/(\?ve=)[A-Za-z0-9_.-]+/g, "$1<ve>") : v)));
      writeFileSync("docs/mobile-integration/samples-v845-free-mode/n1-08-video-ticket-200-tu-route-handler-r2-gia.json", `${JSON.stringify({ vai: "phụ huynh 0 con — MẪU TỪ route-handler (R2 giả); 3223 không có R2 nên HTTP thật trả 503", yeuCau: { method: "POST", duongDan: `${U}/courses/<slug>/lessons/<lessonId>/video-ticket` }, trangThaiHttp: 200, phanHoi: sach, luotPhatKemTheo: { yeuCau: "GET duongPhat  (Authorization: Bearer, Range: bytes=3-6)", trangThaiHttp: r1.status, dau: { "content-range": r1.headers.get("content-range"), "content-type": r1.headers.get("content-type"), "cache-control": r1.headers.get("cache-control") } } }, null, 2)}
`);
    }
    expect([r1.status, r1.headers.get("content-range"), r1.headers.get("content-type"), r1.headers.get("cache-control")]).toEqual([206, "bytes 3-6/10", "video/mp4", "no-store"]);
    expect(await r1.text()).toBe("3456");
    expect(R2.lenh.every((l) => l.input.Key === KHOA_R2 && l.input.Bucket === "bucket-da-co-test")).toBe(true);
    expect((await phat(tok.Z!, u, "bytes=0-1")).status).toBe(206); // replay trong hạn (Range tiếp theo)
    const h = await phat(tok.Z!, u, undefined, "HEAD");
    expect([h.status, h.headers.get("content-length")]).toEqual([200, "10"]);
    // không Bearer / tài khoản khác
    const dem0 = R2.lenh.length;
    expect(await ma(await phat(null, u))).toEqual([401, "UNAUTHENTICATED"]);
    expect(await ma(await phat(tok.B!, u))).toEqual([403, "VE_KHONG_DUNG_TAI_KHOAN"]);
    expect(await ma(await phat(tok.A!, u))).toEqual([403, "VE_KHONG_DUNG_TAI_KHOAN"]);
    // vé giả mạo/hết hạn/thiếu u
    const doc = docVeHocThu(u.searchParams.get("ve")!, new Date());
    if (!doc.ok) throw new Error(doc.ma);
    const nd = doc.nd;
    expect(nd.u).toBe(P("Z"));
    const veMoi = (x: Record<string, unknown>) => { const w = new URL(u); w.searchParams.set("ve", kyVeHocThu({ c: nd.c, ver: nd.ver, l: nd.l, x: Math.floor(Date.now() / 1000) + 60, ...x } as never)); return w; };
    expect(await ma(await phat(tok.Z!, veMoi({ u: P("Z"), x: Math.floor(Date.now() / 1000) - 5 })))).toEqual([410, "VE_HET_HAN"]);
    expect(await ma(await phat(tok.Z!, veMoi({ u: undefined })))).toEqual([403, "VE_THIEU_TAI_KHOAN"]);
    const hong = new URL(u);
    // đổi KÝ TỰ ĐẦU của chữ ký (6 bit đầu ⇒ luôn đổi byte). KHÔNG đổi ký tự cuối: 43 ký tự base64url chỉ mang 256 bit nên 2 bit cuối của ký tự cuối bị bỏ ⇒ đổi nó có ~6% khả năng KHÔNG đổi chữ ký (ca từng chập chờn).
    const [ndVe, kyVe] = hong.searchParams.get("ve")!.split(".") as [string, string];
    hong.searchParams.set("ve", `${ndVe}.${kyVe[0] === "A" ? "B" : "A"}${kyVe.slice(1)}`);
    expect(await ma(await phat(tok.Z!, hong))).toEqual([403, "VE_SAI_CHU_KY"]);
    const rac = new URL(u);
    rac.searchParams.set("ve", "rac");
    expect(await ma(await phat(tok.Z!, rac))).toEqual([400, "VE_SAI_DINH_DANG"]);
    expect(await ma(await phatGet(req("GET", `${U}/video/play`, undefined, bearer(tok.Z!))))).toEqual([400, "VALIDATION"]);
    expect(R2.lenh.length).toBe(dem0); // vé sai ⇒ R2 không bị chạm
    // bài không phải video / bài trả phí / bài lạ ⇒ không có vé, cùng 404
    for (const id of [k.r1, k.p1, k.q, "bai-lac"]) expect(await ma(await ve(tok.Z!, k.slug, id))).toEqual([404, "KHONG_TIM_THAY"]);
    // Đào tạo BỎ cờ học thử sau khi cấp vé ⇒ vé vô hiệu NGAY
    await db.onlLesson.updateMany({ where: { stableId: k.v1, version: { courseId: k.courseId } }, data: { freePreview: false } });
    expect(await ma(await phat(tok.Z!, u, "bytes=0-1"))).toEqual([404, "KHONG_TIM_THAY"]);
    expect(R2.lenh.length).toBe(dem0);
    await db.onlLesson.updateMany({ where: { stableId: k.v1, version: { courseId: k.courseId } }, data: { freePreview: true } });
    expect((await phat(tok.Z!, u, "bytes=0-1")).status).toBe(206); // đối chứng dương: bật lại là phát được
    // kho video chưa cấu hình ⇒ 503, không có vé
    delete process.env.R2_ONLINE_VIDEO_BUCKET_NAME;
    try {
      expect(await ma(await ve(tok.Z!, k.slug, k.v1))).toEqual([503, "KHO_VIDEO_CHUA_CAU_HINH"]);
    } finally {
      process.env.R2_ONLINE_VIDEO_BUCKET_NAME = "bucket-da-co-test";
    }
  });

  // ════════════════════ NHÓM 2 — GHI TIẾN ĐỘ (chỉ học viên) ════════════════════

  it("[FMH-05] 🔴 mở bài + tiến độ: CHỈ học viên chính em; phụ huynh 403 và KHÔNG đổi gì; % chỉ tăng, COMPLETED không lùi; đúng loại bài; tách theo từng con; KHÔNG tạo quyền/lượt giả", async () => {
    const k = await dung();
    const hs1 = await phienHocSinh("0966960001", P("A"), P("sc1"));
    // phụ huynh (phiên thường) ⇒ 403 + không dòng nào
    const truoc = await demDong(P("sc1"));
    for (const [nhan, r] of [
      ["open", await mo(tok.A!, P("sc1"), k.slug, k.v1)],
      ["progress", await td(tok.A!, P("sc1"), k.slug, k.v1, { percent: 50 })],
    ] as const) {
      expect([r.status, (await json(r.clone())).error?.code], nhan).toEqual([403, "FORBIDDEN"]);
      expect((await json(r)).error).toMatchObject({ chiTiet: { yeuCau: "CHE_DO_HOC_SINH" } });
    }
    expect(await demDong(P("sc1"))).toEqual(truoc);
    // chưa mở bài ⇒ CHUA_MO_BAI
    expect(await ma(await td(hs1, P("sc1"), k.slug, k.v1, { percent: 10 }))).toEqual([409, "CHUA_MO_BAI"]);
    // mở bài
    const o1 = await mo(hs1, P("sc1"), k.slug, k.v1);
    expect(o1.status).toBe(200);
    const bo1 = (await json(o1)).data;
    expect(bo1).toMatchObject({ bai: { lessonId: k.v1, loai: "VIDEO", coVideo: true }, tienDo: { lessonId: k.v1, trangThai: "IN_PROGRESS", phanTram: 0, hoanThanhLuc: null } });
    const bo2 = (await json(await mo(hs1, P("sc1"), k.slug, k.v1))).data;
    expect(bo2.tienDo.moLanDauLuc).toBe(bo1.tienDo.moLanDauLuc); // idempotent
    expect(await db.onlFreeLessonProgress.count({ where: { studentId: P("sc1") } })).toBe(1);
    // % chỉ tăng; COMPLETED không lùi
    const pc40 = (await json(await td(hs1, P("sc1"), k.slug, k.v1, { percent: 40 }))).data.tienDo;
    expect(pc40).toMatchObject({ phanTram: 40, trangThai: "IN_PROGRESS" });
    expect((await json(await td(hs1, P("sc1"), k.slug, k.v1, { percent: 20 }))).data.tienDo.phanTram).toBe(40);
    const xong = (await json(await td(hs1, P("sc1"), k.slug, k.v1, { percent: 95 }))).data.tienDo;
    expect(xong).toMatchObject({ phanTram: 95, trangThai: "COMPLETED" });
    expect(xong.hoanThanhLuc).toBeTruthy();
    expect((await json(await td(hs1, P("sc1"), k.slug, k.v1, { percent: 5 }))).data.tienDo).toMatchObject({ phanTram: 95, trangThai: "COMPLETED", hoanThanhLuc: xong.hoanThanhLuc });
    // đúng loại bài: VIDEO không tự đánh dấu xong bằng daDoc; READ cần daDoc
    expect(await ma(await td(hs1, P("sc1"), k.slug, k.v2, { percent: 30 }))).toEqual([409, "CHUA_MO_BAI"]); // (chưa mở v2)
    await mo(hs1, P("sc1"), k.slug, k.v2);
    expect(await ma(await td(hs1, P("sc1"), k.slug, k.v2, { daDoc: true }))).toEqual([422, "LOAI_BAI_KHONG_GHI_TRUC_TIEP"]);
    expect((await json(await td(hs1, P("sc1"), k.slug, k.v2, { percent: 30 }))).data.tienDo.trangThai).toBe("IN_PROGRESS"); // client không tự "xong" video
    await mo(hs1, P("sc1"), k.slug, k.r1);
    expect(await ma(await td(hs1, P("sc1"), k.slug, k.r1, { percent: 50 }))).toEqual([422, "LOAI_BAI_KHONG_GHI_TRUC_TIEP"]);
    expect((await json(await td(hs1, P("sc1"), k.slug, k.r1, { daDoc: true }))).data.tienDo).toMatchObject({ trangThai: "COMPLETED", phanTram: 100 });
    // thân sai
    expect(await ma(await td(hs1, P("sc1"), k.slug, k.v2, {}))).toEqual([400, "VALIDATION"]);
    expect(await ma(await td(hs1, P("sc1"), k.slug, k.v2, { percent: 101 }))).toEqual([400, "VALIDATION"]);
    expect(await ma(await td(hs1, P("sc1"), k.slug, k.v2, { percent: 50, daThanhToan: true }))).toEqual([400, "VALIDATION"]);
    expect(await ma(await mo(hs1, P("sc1"), k.slug, k.v2, { cheDo: "FULL" }))).toEqual([400, "VALIDATION"]);
    // bài trả phí / QUIZ gắn cờ nhầm / bài lạ ⇒ KHÔNG mở được, không dòng tiến độ
    for (const id of [k.p1, k.pr, k.q, "bai-lac"]) {
      expect(await ma(await mo(hs1, P("sc1"), k.slug, id)), id).toEqual([404, "KHONG_TIM_THAY"]);
      expect(await ma(await td(hs1, P("sc1"), k.slug, id, { percent: 50 })), id).toEqual([404, "KHONG_TIM_THAY"]);
    }
    expect(await db.onlFreeLessonProgress.count({ where: { studentId: P("sc1") } })).toBe(3);
    // KHÔNG quyền học giả / tiến độ có phí / lượt thi
    expect(await demDong(P("sc1"))).toEqual({ quyen: 0, tienDoMienPhi: 3, tienDoCoPhi: 0, luot: 0 });
    // tách theo con: con thứ hai không dính gì
    expect(await demDong(P("sc2"))).toEqual({ quyen: 0, tienDoMienPhi: 0, tienDoCoPhi: 0, luot: 0 });
    // mục lục học viên: tiến độ đúng của TỪNG em
    const m1 = (await json(await hsMucLuc(hs1, P("sc1"), k.slug))).data;
    expect(Object.fromEntries(m1.bai.map((b: { lessonId: string; tienDo: { trangThai: string } | null }) => [b.lessonId, b.tienDo?.trangThai ?? null]))).toEqual({ [k.v1]: "COMPLETED", [k.v2]: "IN_PROGRESS", [k.r1]: "COMPLETED" });
    expect(m1.hocVien).toMatchObject({ id: P("sc1"), daCoQuyenHoc: false, soBaiDaMo: 3 });
    const mp = (await json(await hsMucLuc(tok.A!, P("sc2"), k.slug))).data; // phụ huynh XEM con thứ hai
    expect(mp.bai.every((b: { tienDo: unknown }) => b.tienDo === null)).toBe(true);
    expect(mp.hocVien).toMatchObject({ soBaiDaMo: 0 });
    // danh sách có tiến độ của học viên
    const dsH = (await json(await hsDs(hs1, P("sc1")))).data.muc.find((x: { slug: string }) => x.slug === k.slug);
    expect(dsH).toMatchObject({ tienDo: { soBaiDaMo: 3, soBaiXong: 2 }, daCoQuyenHoc: false });
    // học sinh em này KHÔNG chạm em khác (cùng nhà) / nhà khác
    expect(await ma(await mo(hs1, P("sc2"), k.slug, k.v1))).toEqual([403, "FORBIDDEN"]);
    expect(await ma(await td(hs1, P("sc2"), k.slug, k.v1, { percent: 50 }))).toEqual([403, "FORBIDDEN"]);
    expect(await ma(await mo(tok.B!, P("sc1"), k.slug, k.v1))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await hsMucLuc(tok.B!, P("sc1"), k.slug))).toEqual([404, "NOT_FOUND"]);
    expect(await demDong(P("sc2"))).toEqual({ quyen: 0, tienDoMienPhi: 0, tienDoCoPhi: 0, luot: 0 });
    expect(await demDong(P("sb1"))).toEqual({ quyen: 0, tienDoMienPhi: 0, tienDoCoPhi: 0, luot: 0 });
  });

  it("[FMH-06] 🔴 giới hạn F3 do CÀI ĐẶT khoá quyết (không hard-code): vượt số bài ⇒ 403 cả ở mở bài lẫn vé (học viên); hết hạn ngày ⇒ 403; phụ huynh xem/xin vé KHÔNG bị giới hạn (quyết định tường minh)", async () => {
    const k = await dung({ hocThu: { dangKyMienPhi: false, gioiHanSoBai: 2, hanNgay: 7 } });
    const hs1 = await phienHocSinh("0966960001", P("A"), P("sc1"));
    const ml = (await json(await mucLuc(tok.Z!, k.slug))).data;
    expect(ml.chinhSach).toEqual({ gioiHanSoBai: 2, hanNgay: 7, choTuNhan: false });
    expect((await mo(hs1, P("sc1"), k.slug, k.v1)).status).toBe(200);
    expect((await mo(hs1, P("sc1"), k.slug, k.r1)).status).toBe(200);
    expect(await ma(await mo(hs1, P("sc1"), k.slug, k.v2))).toEqual([403, "VUOT_GIOI_HAN_BAI"]);
    expect(await ma(await hsVe(hs1, P("sc1"), k.slug, k.v2))).toEqual([403, "VUOT_GIOI_HAN_BAI"]); // lách bằng vé cũng không được
    expect(await db.onlFreeLessonProgress.count({ where: { studentId: P("sc1") } })).toBe(2); // không dòng mới
    expect((await mo(hs1, P("sc1"), k.slug, k.v1)).status).toBe(200); // bài đã mở vẫn mở lại được
    expect((await hsVe(hs1, P("sc1"), k.slug, k.v1)).status).toBe(200); // vé bài đã mở: được
    // phụ huynh / tài khoản 0 con: KHÔNG qua giới hạn (không tạo tiến độ nào)
    expect((await bai(tok.A!, k.slug, k.v2)).status).toBe(200);
    expect((await ve(tok.Z!, k.slug, k.v2)).status).toBe(200);
    expect((await hsVe(tok.A!, P("sc1"), k.slug, k.v2)).status).toBe(200);
    expect(await db.onlFreeLessonProgress.count({ where: { studentId: P("sc1") } })).toBe(2);
    // hết hạn ngày: dời mốc lần mở đầu về 10 ngày trước
    await db.onlFreeLessonProgress.updateMany({ where: { studentId: P("sc1"), courseId: k.courseId }, data: { firstAccessAt: new Date(Date.now() - 10 * NGAY) } });
    expect(await ma(await mo(hs1, P("sc1"), k.slug, k.r1))).toEqual([403, "HET_HAN_HOC_THU"]);
    expect(await ma(await td(hs1, P("sc1"), k.slug, k.v1, { percent: 50 }))).toEqual([403, "HET_HAN_HOC_THU"]);
    // đối chứng: khoá KHÔNG khai chính sách ⇒ không giới hạn
    const tuDo = await dung();
    for (const id of [tuDo.v1, tuDo.r1, tuDo.v2]) expect((await mo(hs1, P("sc1"), tuDo.slug, id)).status).toBe(200);
  });

  it("[FMH-07] 🔴 có quyền học thật ⇒ học ở khu có phí (409 DA_CO_QUYEN_HOC, không ghi trùng); quyền bị thu hồi ⇒ Free vẫn mở được; Free không phụ thuộc quyền", async () => {
    const k = await dung();
    const hs1 = await phienHocSinh("0966960001", P("A"), P("sc1"));
    const c = await capQuyenHoc(db, { studentId: P("sc1"), courseId: k.courseId, loai: "CAP_MIEN_PHI", idempotencyKey: `${NS}cap-${Date.now()}`, now: new Date() });
    if (!c.ok) throw new Error(c.thongBao);
    const r = await mo(hs1, P("sc1"), k.slug, k.v1);
    expect(await ma(r.clone())).toEqual([409, "DA_CO_QUYEN_HOC"]);
    expect((await json(r)).error!.chiTiet).toEqual({ duongHoc: `/api/mobile/v1/students/${P("sc1")}/online/courses/${k.courseId}` });
    expect(await ma(await td(hs1, P("sc1"), k.slug, k.v1, { percent: 50 }))).toEqual([409, "DA_CO_QUYEN_HOC"]);
    expect(await db.onlFreeLessonProgress.count({ where: { studentId: P("sc1") } })).toBe(0);
    expect((await bai(tok.A!, k.slug, k.r1)).status).toBe(200); // phụ huynh vẫn đọc được bài học thử
    const dsH = (await json(await hsDs(hs1, P("sc1")))).data.muc.find((x: { slug: string }) => x.slug === k.slug);
    expect(dsH.daCoQuyenHoc).toBe(true);
    const th = await thuHoiQuyenHoc(db, { studentId: P("sc1"), courseId: k.courseId, reason: "Thu hồi để kiểm thử Free Mode", idempotencyKey: `${NS}thu-${Date.now()}`, now: new Date() });
    expect(th.ok).toBe(true);
    expect((await mo(hs1, P("sc1"), k.slug, k.v1)).status).toBe(200); // thu hồi ⇒ Free vẫn mở được
  });

  it("[FMH-08] 🔴 tài khoản CHƯA có con: đọc + vé được, KHÔNG ghi tiến độ (không có học viên để gắn); IDOR: học viên nhà khác / không tồn tại ⇒ 404; token nhà khác không đọc được tiến độ", async () => {
    const k = await dung();
    expect((await bai(tok.Z!, k.slug, k.r1)).status).toBe(200);
    expect((await ve(tok.Z!, k.slug, k.v1)).status).toBe(200);
    for (const s of ["khong-co", P("sb1"), P("sc1")]) {
      expect(await ma(await td(tok.Z!, s, k.slug, k.v1, { percent: 10 })), s).toEqual([404, "NOT_FOUND"]);
      expect(await ma(await mo(tok.Z!, s, k.slug, k.v1)), s).toEqual([404, "NOT_FOUND"]);
      expect(await ma(await claim(tok.Z!, s, k.slug)), s).toEqual([404, "NOT_FOUND"]);
      expect(await ma(await hsDs(tok.Z!, s)), s).toEqual([404, "NOT_FOUND"]);
    }
    expect(await db.onlFreeLessonProgress.count()).toBe(0);
    expect(await db.onlEntitlement.count()).toBe(0);
  });

  // ════════════════════ NHÓM 3 — TỰ NHẬN FREE_GRANT ════════════════════

  it("[FMH-09] 🔴 tự nhận: mặc định TẮT · khoá không công bố (kể cả giá 0) ⇒ 403 · điều kiện lớp/số khoá · học sinh/nhà khác bị chặn · idempotent, KHÔNG gia hạn vô hạn, gọi lặp song song = MỘT quyền · hết hạn/thu hồi KHÔNG báo thành công · có audit", async () => {
    const mien = { dangKyMienPhi: true, gioiHanSoBai: null, hanNgay: null };
    const k = await dung({ hocThu: mien, gia: 0, lop: [3, 5], thang: 3 });
    const giaZeroKhongCongBo = await dung({ hocThu: { dangKyMienPhi: false, gioiHanSoBai: null, hanNgay: null }, gia: 0 });
    const khongKhai = await dung({ gia: 0 });
    const lopKhac = await dung({ hocThu: mien, lop: [8, 10] });
    const dem = async () => ({ quyen: await db.onlEntitlement.count(), su_kien: await db.onlEntitlementEvent.count() });

    // 1) chính sách Admin TẮT (mặc định) ⇒ 403 dù khoá công bố, và không ghi gì
    expect(await ma(await claim(tok.A!, P("sc1"), k.slug))).toEqual([403, "CHINH_SACH_TAT"]);
    expect(await dem()).toEqual({ quyen: 0, su_kien: 0 });
    await datChinhSach(true);
    // 2) khoá giá 0 nhưng KHÔNG công bố đăng ký miễn phí ⇒ không tự nhận được
    expect(await ma(await claim(tok.A!, P("sc1"), giaZeroKhongCongBo.slug))).toEqual([403, "KHONG_DANG_KY_MIEN_PHI"]);
    expect(await ma(await claim(tok.A!, P("sc1"), khongKhai.slug))).toEqual([403, "KHONG_DANG_KY_MIEN_PHI"]);
    // 3) khối lớp ngoài khoảng của khoá
    const lk = await claim(tok.A!, P("sc1"), lopKhac.slug);
    expect([lk.status, (await json(lk.clone())).error?.code, (await json(lk)).error?.maChiTiet]).toEqual([403, "KHONG_DU_DIEU_KIEN", "KHOI_LOP_KHONG_PHU_HOP"]);
    expect(await dem()).toEqual({ quyen: 0, su_kien: 0 });
    // 4) học sinh (Student Mode) không tự nhận được; nhà khác / không phải con ⇒ 404
    const hs1 = await phienHocSinh("0966960001", P("A"), P("sc1"));
    expect(await ma(await claim(hs1, P("sc1"), k.slug))).toEqual([403, "FORBIDDEN"]);
    expect(await ma(await claim(tok.B!, P("sc1"), k.slug))).toEqual([404, "NOT_FOUND"]);
    expect(await dem()).toEqual({ quyen: 0, su_kien: 0 });
    // 5) thân có trường lạ (client thử nhét khoá idempotency / cờ) ⇒ 400
    expect(await ma(await claim(tok.A!, P("sc1"), k.slug, { idempotencyKey: "khong-hop-le" }))).toEqual([400, "VALIDATION"]);
    expect(await ma(await claim(tok.A!, P("sc1"), k.slug, { duDieuKien: true }))).toEqual([400, "VALIDATION"]);
    // có tiến độ học thử TRƯỚC khi nhận (để kiểm F4 trên đường tự nhận)
    await mo(hs1, P("sc1"), k.slug, k.v1);
    await td(hs1, P("sc1"), k.slug, k.v1, { percent: 95 });
    await mo(hs1, P("sc1"), k.slug, k.r1);

    // 6) hợp lệ + hai lời gọi SONG SONG ⇒ đúng MỘT quyền, MỘT sự kiện
    const [r1, r2] = await Promise.all([claim(tok.A!, P("sc1"), k.slug), claim(tok.A!, P("sc1"), k.slug)]);
    const codes = [r1.status, r2.status].sort();
    expect(codes).toEqual([200, 200]);
    const [b1, b2] = [(await json(r1)).data, (await json(r2)).data];
    expect([b1.daNhanTruocDo, b2.daNhanTruocDo].sort()).toEqual([false, true]);
    expect(await dem()).toEqual({ quyen: 1, su_kien: 1 });
    const q = await db.onlEntitlement.findFirstOrThrow({ where: { studentId: P("sc1"), courseId: k.courseId } });
    expect(q).toMatchObject({ source: "FREE_GRANT", status: "ACTIVE" });
    expect(b1.quyen).toMatchObject({ nguon: "FREE_GRANT", trangThai: "CON_HAN", slug: k.slug });
    // F4 trên đường tự nhận: 2 bài đã học thử ⇒ 2 dòng tiến độ có phí; KHÔNG lượt thi/điểm
    expect(b1.soBaiHocThuDaGiu === 2 || b2.soBaiHocThuDaGiu === 2).toBe(true);
    expect(await demDong(P("sc1"))).toEqual({ quyen: 1, tienDoMienPhi: 2, tienDoCoPhi: 2, luot: 0 });
    expect(await db.onlFreeLessonProgress.count({ where: { studentId: P("sc1"), transferredEntitlementId: q.id } })).toBe(2);
    // 7) gọi lại nhiều lần SAU ĐÓ: không đổi kỳ hạn, không thêm sự kiện
    const han = q.expiresAt!.getTime();
    for (let i = 0; i < 3; i++) {
      const lai = await json(await claim(tok.A!, P("sc1"), k.slug));
      expect(lai.data.daNhanTruocDo).toBe(true);
    }
    const q2 = await db.onlEntitlement.findFirstOrThrow({ where: { id: q.id } });
    expect(q2.expiresAt!.getTime()).toBe(han);
    expect(await dem()).toEqual({ quyen: 1, su_kien: 1 });
    // 8) audit đúng một dòng, có người làm
    const au = await db.auditLog.findMany({ where: { action: "FREE_MODE_SELF_CLAIM", entityId: q.id }, select: { actorId: true, newValues: true } });
    expect(au).toHaveLength(1);
    expect(au[0]!.actorId).toBe(P("A"));
    // 9) đã có quyền: HS mở bài ⇒ chỉ sang khu có phí; trạng thái trong danh mục
    expect(await ma(await mo(hs1, P("sc1"), k.slug, k.v2))).toEqual([409, "DA_CO_QUYEN_HOC"]);
    // 10) thu hồi rồi gọi lại ⇒ KHÔNG báo thành công; hết hạn rồi gọi lại ⇒ KHÔNG báo thành công và KHÔNG gia hạn
    const th = await thuHoiQuyenHoc(db, { studentId: P("sc1"), courseId: k.courseId, reason: "Thu hồi để kiểm thử Free Mode", idempotencyKey: `${NS}thu2-${Date.now()}`, now: new Date() });
    expect(th.ok).toBe(true);
    const sau = await claim(tok.A!, P("sc1"), k.slug);
    expect([sau.status, (await json(sau.clone())).error?.code, (await json(sau)).error?.maChiTiet]).toEqual([409, "DA_TUNG_CO_QUYEN", "DA_THU_HOI"]);
    await db.onlEntitlement.update({ where: { id: q.id }, data: { status: "ACTIVE", revokedAt: null, revokedReason: null, expiresAt: new Date(Date.now() - NGAY) } });
    const hetHan = await claim(tok.A!, P("sc1"), k.slug);
    expect([hetHan.status, (await json(hetHan.clone())).error?.code, (await json(hetHan)).error?.maChiTiet]).toEqual([409, "DA_TUNG_CO_QUYEN", "HET_HAN"]);
    expect((await db.onlEntitlement.findFirstOrThrow({ where: { id: q.id } })).expiresAt!.getTime()).toBeLessThan(Date.now());
    expect(await dem()).toEqual({ quyen: 1, su_kien: 2 }); // 1 GRANTED + 1 REVOKED (không thêm sự kiện nào do tự nhận)
    // 11) con thứ hai (cùng khoá, lớp 4 đúng khoảng): nhận được độc lập; học viên đã từng có quyền từ đường KHÁC (mua/quản trị) ⇒ DA_TUNG_CO_QUYEN
    expect((await claim(tok.A!, P("sc2"), k.slug)).status).toBe(200);
    expect(await db.onlEntitlement.count({ where: { studentId: P("sc2") } })).toBe(1);
  });

  it("[FMH-10] 🔴 giới hạn số khoá miễn phí (cấu hình) + thiếu khối lớp khi khoá có khai + khoá đã có quyền mua/quản trị ⇒ không tự nhận", async () => {
    const mien = { dangKyMienPhi: true, gioiHanSoBai: null, hanNgay: null };
    const a = await dung({ hocThu: mien });
    const b = await dung({ hocThu: mien });
    const coLop = await dung({ hocThu: mien, lop: [1, 12] });
    await datChinhSach(true, 1);
    expect((await claim(tok.A!, P("sc1"), a.slug)).status).toBe(200);
    const vuot = await claim(tok.A!, P("sc1"), b.slug);
    expect([vuot.status, (await json(vuot.clone())).error?.code, (await json(vuot)).error?.maChiTiet]).toEqual([403, "KHONG_DU_DIEU_KIEN", "VUOT_SO_KHOA_MIEN_PHI"]);
    expect((await claim(tok.A!, P("sc1"), a.slug)).status).toBe(200); // gọi lại khoá đã nhận không bị tính là «khoá thứ hai»
    await datChinhSach(true, 0); // 0 = không giới hạn
    expect((await claim(tok.A!, P("sc1"), b.slug)).status).toBe(200);
    // học viên chưa khai khối lớp mà khoá có khai ⇒ không đủ điều kiện (đóng, không đoán)
    await db.student.update({ where: { id: P("sc2") }, data: { currentGrade: null } });
    const thieu = await claim(tok.A!, P("sc2"), coLop.slug);
    expect([thieu.status, (await json(thieu.clone())).error?.code, (await json(thieu)).error?.maChiTiet]).toEqual([403, "KHONG_DU_DIEU_KIEN", "THIEU_KHOI_LOP"]);
    // quyền do đường khác (mua/quản trị) ⇒ học viên không tự nhận được chồng lên
    const c = await capQuyenHoc(db, { studentId: P("sb1"), courseId: a.courseId, loai: "MUA", idempotencyKey: `${NS}mua-${Date.now()}`, now: new Date(), orderId: "don-gia", daKiemCongBanLucDatDon: new Date() });
    expect(c.ok).toBe(true);
    const sauMua = await claim(tok.B!, P("sb1"), a.slug);
    expect([sauMua.status, (await json(sauMua)).error?.code]).toEqual([409, "DA_CO_QUYEN_HOC"]);
    expect((await db.onlEntitlement.findFirstOrThrow({ where: { studentId: P("sb1"), courseId: a.courseId } })).source).toBe("PURCHASE");
    // mục lục báo đúng trạng thái tự nhận theo học viên (đọc, không ghi)
    const ml = (await json(await hsMucLuc(tok.A!, P("sc1"), a.slug))).data;
    expect(ml.hocVien.tuNhan).toEqual({ duoc: false, lyDo: "DA_CO_QUYEN_HOC", maChiTiet: null });
    expect(ml.chinhSach.choTuNhan).toBe(true);
  });

  it("[FMH-11] 🔴 C11 (E, #1289): SĐT phụ huynh CHƯA xác minh ⇒ 403 CHUA_XAC_MINH_SDT (không còn 500); vượt số khoá miễn phí ĐANG HOẠT ĐỘNG của cùng phụ huynh (hocThu.toiDaKhoaMienPhi) ⇒ 403 VUOT_SO_KHOA_MIEN_PHI; hết chỗ thì nhả/ xác minh xong nhận được", async () => {
    await datChinhSach(true, 0);
    const mien = { dangKyMienPhi: true, gioiHanSoBai: null, hanNgay: null, toiDaKhoaMienPhi: 1 };
    const a = await dung({ hocThu: mien });
    const b = await dung({ hocThu: mien });
    // (1) chưa xác minh SĐT
    await db.user.update({ where: { id: ids.B! }, data: { phoneVerifiedAt: null } });
    const chua = await claim(tok.B!, P("sb1"), a.slug);
    const cb = await json(chua);
    expect([chua.status, cb.error?.code, cb.error?.message]).toEqual([403, "CHUA_XAC_MINH_SDT", "Cần xác minh số điện thoại của phụ huynh trước khi nhận khoá miễn phí."]);
    expect(await db.onlEntitlement.count({ where: { studentId: P("sb1"), courseId: a.courseId } })).toBe(0); // không cấp gì
    await db.user.update({ where: { id: ids.B! }, data: { phoneVerifiedAt: new Date() } });
    // (2) đã xác minh: khoá đầu OK; khoá thứ hai của CÙNG phụ huynh (toiDa = 1) ⇒ VUOT_SO_KHOA_MIEN_PHI
    expect((await claim(tok.B!, P("sb1"), a.slug)).status).toBe(200);
    const vuot = await claim(tok.B!, P("sb1"), b.slug);
    const vb = await json(vuot);
    expect([vuot.status, vb.error?.code]).toEqual([403, "VUOT_SO_KHOA_MIEN_PHI"]);
    expect(vb.error?.message).toContain("Đã đạt số khoá miễn phí tối đa");
    expect(await db.onlEntitlement.count({ where: { studentId: P("sb1"), courseId: b.courseId } })).toBe(0);
    // (3) khoá MIỄN PHÍ hết hạn nhả chỗ ⇒ nhận được khoá thứ hai
    await db.onlEntitlement.updateMany({ where: { studentId: P("sb1"), courseId: a.courseId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    expect((await claim(tok.B!, P("sb1"), b.slug)).status).toBe(200);
  }, 60_000);

  it("[CGT-10] tự nhận khoá miễn phí × 6 y hệt song song ⇒ MỘT quyền, MỘT sự kiện, MỘT dòng audit", async () => {
    await datChinhSach(true, 0);
    const k = await dung({ hocThu: { dangKyMienPhi: true, gioiHanSoBai: null, hanNgay: null } });
    await amPool();
    const kq = await Promise.all((await Promise.all(Array.from({ length: 6 }, () => claim(tok.B!, P("sb1"), k.slug)))).map(async (r) => ({ s: r.status, j: await json(r) })));
    console.info(`[CGT-10] phản hồi: ${kq.map((x) => `${x.s}${x.j.error?.code ? `:${x.j.error.code}` : ""}${x.j.data?.daNhanTruocDo ? ":lặp" : ""}`).sort().join(" ")}`);
    expect(kq.map((x) => x.s)).toEqual(Array(6).fill(200));
    expect(kq.filter((x) => x.j.data.daNhanTruocDo === false)).toHaveLength(1);
    const q = await db.onlEntitlement.findMany({ where: { studentId: P("sb1"), courseId: k.courseId }, select: { id: true } });
    expect(q).toHaveLength(1);
    expect(await db.onlEntitlementEvent.count({ where: { entitlementId: q[0]!.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "FREE_MODE_SELF_CLAIM", entityId: q[0]!.id } })).toBe(1);
  }, 60_000);
});
