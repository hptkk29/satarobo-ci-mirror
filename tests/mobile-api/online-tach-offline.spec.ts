import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as danhSachGet } from "@/app/api/mobile/v1/students/[studentId]/online/courses/route";
import { GET as chiTietGet } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/route";
import { GET as mucLucGet } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/outline/route";
import { GET as quyenGet } from "@/app/api/mobile/v1/students/[studentId]/online/entitlements/route";
import { GET as lichGet } from "@/app/api/mobile/v1/students/[studentId]/schedule/route";
import { db } from "@/lib/db";
import { caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "@/lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "@/lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import { capQuyenHoc } from "@/lib/elearning-online/quyen-hoc-db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { donBangOnl } from "../elearning/_onl-don";

/**
 * [ONL-TACH] V8.19 — Online và Offline CÙNG TỒN TẠI nhưng KHÔNG mở lẫn nhau (route-handler + Postgres thật):
 *   [ONL-TACH-01] con có ghi danh Offline ACTIVE (lớp/khoá offline) ⇒ KHÔNG mở được khoá Online (danh sách rỗng, chi tiết 404, mục lục 403, quyền rỗng)
 *   [ONL-TACH-02] cấp quyền Online ⇒ KHÔNG sinh ghi danh/lớp Offline, lịch Offline không đổi; quyền Online của con A không mở cho anh/chị/em B cùng nhà
 *   [ONL-TACH-03] thu hồi quyền Online ⇒ ghi danh Offline còn nguyên (lịch vẫn đọc được)
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "onltach-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.98.0.${(++dem % 250) + 1}`;
const req = (auth: string) => new Request("http://localhost/x", { method: "GET", headers: { "content-type": "application/json", "x-forwarded-for": ip(), authorization: auth } });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const MOC = new Date();
let n = 0;

async function dungKhoaOnline() {
  const t = await taoKhoa(db, { code: `ONLT-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${NS}Khoá ${n}`, listPrice: 1, salePrice: 1, validityMonths: 6, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const ch = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
  if (!ch.ok) throw new Error("chuong");
  const b = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "READ", title: "B1", contentJson: { body: "nội dung" } });
  if (!b.ok) throw new Error("bai");
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: caiDatKhoiDauChoBanNhap() });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, MOC);
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  return t.courseId;
}

async function don() {
  await donBangOnl(db);
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.student.deleteMany({ where: { OR: [{ id: { startsWith: NS } }, { parentUserId: { in: uids } }] } });
  await db.class.deleteMany({ where: { id: { startsWith: NS } } });
  await db.course.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[ONL-TACH] Online ≠ Offline", () => {
  let tA = "";
  const bearer = (t: string) => `Bearer ${t}`;
  const sA = `${NS}sa`; // có ghi danh Offline
  const sB = `${NS}sb`; // anh/chị/em, không ghi danh
  const sCtx = (s: string, c?: string) => ({ params: Promise.resolve({ studentId: s, courseId: c }) as never });

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const u = await db.user.create({ data: { email: `${NS}A@seed.invalid`, name: "PH A", phone: "84966950001", password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
    await db.center.create({ data: { id: `${NS}cs`, name: "CS tách", slug: `${NS}cs`, address: "Đ" } });
    await db.course.create({ data: { id: `${NS}kh`, name: "Khoá Offline", slug: `${NS}kh`, totalSessions: 12 } });
    await db.class.create({ data: { id: `${NS}l1`, name: "Lớp Offline", classCode: `${NS}l1`, courseId: `${NS}kh`, centerId: `${NS}cs`, status: "ACTIVE", isActive: true, startTime: "18:00" } as never });
    await db.student.create({ data: { id: sA, name: "Bé A", parentUserId: u.id, centerId: `${NS}cs` } as never });
    await db.student.create({ data: { id: sB, name: "Bé B", parentUserId: u.id, centerId: `${NS}cs` } as never });
    await db.enrollment.create({ data: { id: `${NS}dk`, studentId: sA, classId: `${NS}l1`, courseId: `${NS}kh`, status: "ACTIVE", centerId: `${NS}cs` } as never });
    const r = await dangNhapRoute(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ dinhDanh: "0966950001", matKhau: MK, thietBi: { maThietBi: "00000000-0000-4000-9b00-000000000001", nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }) }));
    tA = ((await json(r)).data as { accessToken: string }).accessToken;
    await quyDinhDongY(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip(), authorization: bearer(tA) }, body: "{}" }));
  }, 180_000);
  afterAll(async () => {
    await don();
    delete process.env.ELEARNING_ONLINE_ENABLED;
  }, 180_000);

  it("[ONL-TACH-01] có ghi danh Offline ACTIVE ⇒ KHÔNG mở được khoá Online", async () => {
    const k = await dungKhoaOnline();
    expect(await db.enrollment.count({ where: { studentId: sA, status: "ACTIVE" } })).toBe(1);
    const ds = await json(await danhSachGet(req(bearer(tA)), sCtx(sA)));
    expect(ds.data?.muc ?? ds.data?.khoa ?? ds.data?.items ?? []).toEqual([]);
    expect(JSON.stringify(ds.data)).not.toContain(k);
    expect((await chiTietGet(req(bearer(tA)), sCtx(sA, k))).status).toBe(404);
    expect((await mucLucGet(req(bearer(tA)), sCtx(sA, k))).status).toBe(403);
    expect(JSON.stringify((await json(await quyenGet(req(bearer(tA)), sCtx(sA)))).data)).not.toContain(k);
  });

  it("[ONL-TACH-02] cấp quyền Online ⇒ không sinh ghi danh/lớp Offline; không mở cho anh/chị/em; lịch Offline không đổi", async () => {
    const k = await dungKhoaOnline();
    const lichTruoc = JSON.stringify((await json(await lichGet(req(bearer(tA)), sCtx(sA)))).data);
    const dkTruoc = await db.enrollment.count({ where: { studentId: { in: [sA, sB] } } });
    const r = await capQuyenHoc(db, { studentId: sA, courseId: k, loai: "CAP_MIEN_PHI", now: MOC, idempotencyKey: `${NS}cap-${Date.now()}` });
    expect(r.ok).toBe(true);
    expect((await chiTietGet(req(bearer(tA)), sCtx(sA, k))).status).toBe(200); // đối chứng dương: con A mở được
    expect((await chiTietGet(req(bearer(tA)), sCtx(sB, k))).status).toBe(404); // anh/chị/em cùng nhà KHÔNG
    expect(JSON.stringify((await json(await danhSachGet(req(bearer(tA)), sCtx(sB)))).data)).not.toContain(k);
    expect(await db.enrollment.count({ where: { studentId: { in: [sA, sB] } } })).toBe(dkTruoc); // không đẻ ghi danh
    expect(JSON.stringify((await json(await lichGet(req(bearer(tA)), sCtx(sA)))).data)).toBe(lichTruoc); // lịch Offline nguyên
  });

  it("[ONL-TACH-03] thu hồi quyền Online ⇒ ghi danh Offline còn nguyên", async () => {
    const k = await dungKhoaOnline();
    await capQuyenHoc(db, { studentId: sA, courseId: k, loai: "CAP_MIEN_PHI", now: MOC, idempotencyKey: `${NS}cap3-${Date.now()}` });
    const { thuHoiQuyenHoc } = await import("@/lib/elearning-online/quyen-hoc-db");
    const th = await thuHoiQuyenHoc(db, { studentId: sA, courseId: k, reason: "kiểm tách Online/Offline", idempotencyKey: `${NS}thu-${Date.now()}`, now: new Date() });
    expect(th.ok).toBe(true);
    expect((await chiTietGet(req(bearer(tA)), sCtx(sA, k))).status).toBe(404);
    expect(await db.enrollment.count({ where: { id: `${NS}dk`, status: "ACTIVE" } })).toBe(1);
    expect((await lichGet(req(bearer(tA)), sCtx(sA))).status).toBe(200);
  });
});
