import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
const RL = vi.hoisted(() => ({ ok: true }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: RL.ok, remaining: 999, resetAt: Date.now() + 30_000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { GET as devKhoGet } from "@/app/api/dev-kho/[...khoa]/route";
import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as lienKetPost } from "@/app/api/mobile/v1/parent/library/ebooks/[so]/download-link/route";
import { GET as danhMucGet } from "@/app/api/mobile/v1/parent/library/route";
import { GET as sgkGet } from "@/app/api/mobile/v1/parent/library/textbooks/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { db } from "@/lib/db";
import { ghiKhoLocal } from "@/lib/mobile-api/kho-tep-rieng";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [TSM-DB] «Tủ sách cho ba mẹ» trên app — HTTP route handler + Postgres thật + kho LOCAL (thư mục tạm, không R2, không mạng):
 *   [TSM-DB-01] không token ⇒ 401 ở cả ba route; cờ TU_SACH_ENABLED tắt ⇒ 404 ở cả ba route (có token); bật ⇒ 200
 *   [TSM-DB-02] danh mục: chỉ 20 ebook đã xuất bản của web (+ SGK liên kết ngoài); không lộ khoá/URL tệp; `taiDuoc` theo hồ sơ (có phường/xã); tham số grade sai ⇒ 400
 *   [TSM-DB-03] phiên CHẾ ĐỘ HỌC SINH ⇒ 403 ở cả ba route (luật chung mặc định-từ-chối + dịch vụ)
 *   [TSM-DB-04] liên kết tải: URL ký hết hạn ≤ 300 s (≤ 15 phút); tải được bằng URL; sửa chữ ký / hạn / khoá ⇒ 403; quá hạn ⇒ 403; không chữ ký ⇒ 403; AuditLog không chứa URL
 *   [TSM-DB-05] hồ sơ chưa có phường/xã ⇒ 403 (không ký, không audit); mã lạ / ngoài danh mục ⇒ 400 / 404 dù tệp có trong kho; tệp chưa nhập ⇒ 404; thân lạ ⇒ 400
 *   [TSM-DB-06] KHÔNG có đường lùi công khai: không kho local + không bucket Tủ sách ⇒ 404 «đang cập nhật» (không URL nào); kho local tắt ⇒ /api/dev-kho 404
 *   [TSM-DB-07] chạm trần rate-limit ⇒ 429 + Retry-After
 * Cách chạy: `pnpm test:mobile-api tests/mobile-api/tu-sach.spec.ts` (DB local/test; tự SKIP nếu DATABASE_URL không phải DB cục bộ).
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "tsm-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.96.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
const A = (k: string) => `${NS}${k}`;
const PDF = (n: number) => new TextEncoder().encode(`%PDF-1.4 tu-sach-${n}`);

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.auditLog.deleteMany({ where: { actorId: { in: uids } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.lead.deleteMany({ where: { parentName: { startsWith: NS } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[TSM-DB] Tủ sách cho ba mẹ — HTTP + Postgres thật", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tsm-kho-"));
  const truoc = { dir: process.env.MOBILE_UPLOAD_LOCAL_DIR, bucket: process.env.R2_TU_SACH_BUCKET_NAME, cfg: process.env.TU_SACH_ENABLED, api: process.env.MOBILE_API_ENABLED, sec: process.env.NEXTAUTH_SECRET };
  const ids: Record<string, string> = {};
  let tA = "";
  let tB = "";
  let tHs = "";

  const dm = (tok?: string) => danhMucGet(req("GET", "/api/mobile/v1/parent/library", undefined, tok ? bearer(tok) : undefined));
  const sgk = (tok?: string, q = "") => sgkGet(req("GET", `/api/mobile/v1/parent/library/textbooks${q}`, undefined, tok ? bearer(tok) : undefined));
  const lk = (tok: string | undefined, so: string, than: unknown = {}) => lienKetPost(req("POST", `/api/mobile/v1/parent/library/ebooks/${so}/download-link`, than, tok ? bearer(tok) : undefined), { params: Promise.resolve({ so }) });
  const devKho = (url: string) => {
    const u = new URL(url);
    return devKhoGet(new Request(`http://localhost${u.pathname}${u.search}`), { params: Promise.resolve({ khoa: decodeURIComponent(u.pathname.replace(/^\/api\/dev-kho\//, "")).split("/") }) });
  };
  const dangNhap = async (sdt: string, n: number) => {
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9e10-${String(n).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    return ((await json(r)).data as { accessToken: string }).accessToken;
  };

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.TU_SACH_ENABLED = "true";
    process.env.MOBILE_UPLOAD_LOCAL_DIR = dir;
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, sdt: string) => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `U ${k}`, phone: sdt, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id);
    await mk("A", "84966980001"); // có phiếu lead đã có phường/xã ⇒ tải được
    await mk("B", "84966980002"); // có phiếu lead NHƯNG chưa có phường/xã ⇒ chưa tải được
    await db.center.create({ data: { id: A("cs"), name: "Cơ sở TSM", slug: A("cs"), address: "Địa chỉ" } });
    await db.student.create({ data: { id: A("sA"), name: "An", parentUserId: ids.A, centerId: A("cs"), currentGrade: 4 } as never });
    await db.lead.create({ data: { parentName: `${NS}A`, phone: "84966980001", source: "web", status: "MOI", ward: "Phường Hải Châu", city: "Thành phố Đà Nẵng" } as never });
    await db.lead.create({ data: { parentName: `${NS}B`, phone: "84966980002", source: "web", status: "MOI", ward: null } as never });
    tA = await dangNhap("0966980001", 1);
    tB = await dangNhap("0966980002", 2);
    for (const t of [tA, tB]) await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
    // phiên chế độ học sinh của CHÍNH tài khoản A (cùng cách bộ hoá đơn)
    tHs = await dangNhap("0966980001", 9);
    await quyDinhDongY(req("POST", "/x", {}, bearer(tHs)));
    expect((await codePost(req("POST", "/x", { ma: "4827", xacNhan: "4827" }, bearer(tHs)))).status).toBe(200);
    expect((await enterPost(req("POST", "/x", { studentId: A("sA") }, bearer(tHs)))).status).toBe(200);
    // kho local: ebook 3 + 4 có tệp; 25 (NGOÀI danh mục) cũng có tệp để chứng minh không ký được
    await ghiKhoLocal("tu-sach/ebook/3/sach.pdf", "application/pdf", PDF(3));
    await ghiKhoLocal("tu-sach/ebook/4/sach.pdf", "application/pdf", PDF(4));
    await ghiKhoLocal("tu-sach/ebook/25/sach.pdf", "application/pdf", PDF(25));
  }, 180_000);
  afterAll(async () => {
    await don();
    const kh = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
    kh("MOBILE_UPLOAD_LOCAL_DIR", truoc.dir);
    kh("R2_TU_SACH_BUCKET_NAME", truoc.bucket);
    kh("TU_SACH_ENABLED", truoc.cfg);
    kh("MOBILE_API_ENABLED", truoc.api);
    kh("NEXTAUTH_SECRET", truoc.sec);
    rmSync(dir, { recursive: true, force: true });
  }, 180_000);
  afterEach(() => {
    RL.ok = true;
    process.env.TU_SACH_ENABLED = "true";
    vi.useRealTimers();
  });

  it("[TSM-DB-01] không token ⇒ 401; cờ tắt ⇒ 404; bật ⇒ 200", async () => {
    expect(await ma(await dm())).toEqual([401, "UNAUTHENTICATED"]);
    expect(await ma(await sgk())).toEqual([401, "UNAUTHENTICATED"]);
    expect(await ma(await lk(undefined, "3"))).toEqual([401, "UNAUTHENTICATED"]);
    process.env.TU_SACH_ENABLED = "false";
    expect(await ma(await dm(tA))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await sgk(tA))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await lk(tA, "3"))).toEqual([404, "NOT_FOUND"]);
    process.env.TU_SACH_ENABLED = "true";
    expect((await dm(tA)).status).toBe(200);
    expect((await sgk(tA)).status).toBe(200);
  });

  it("[TSM-DB-02] danh mục: chỉ bản đã xuất bản; không lộ khoá/URL; điều kiện tải theo hồ sơ", async () => {
    const r = await dm(tA);
    expect(r.headers.get("cache-control")).toContain("no-store");
    const a = (await json(r)).data;
    expect(a.ebooks).toHaveLength(20);
    expect(a.ebooks.map((e: { so: number }) => e.so)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(a.taiDuoc).toBe(true);
    expect(a.khoSanSang).toBe(true);
    expect(a.conCoKhaiLop).toEqual([{ ten: "An", lop: 4 }]);
    expect(JSON.stringify(a)).not.toMatch(/sach\.pdf|tu-sach\/ebook|X-Amz|r2\.|dev-kho|tsm-sA/i);
    expect((await json(await dm(tB))).data.taiDuoc).toBe(false);
    const s4 = (await json(await sgk(tA, "?grade=4"))).data.sach as Array<{ lop: number; url: string }>;
    expect(s4.length).toBeGreaterThan(0);
    expect(s4.every((s) => s.lop === 4 && s.url.startsWith("https://taphuan.nxbgd.vn/"))).toBe(true);
    for (const g of ["0", "13", "x", "1.5"]) expect((await sgk(tA, `?grade=${g}`)).status, g).toBe(400);
  });

  it("[TSM-DB-03] chế độ học sinh ⇒ 403 ở cả ba route", async () => {
    expect(await ma(await dm(tHs))).toEqual([403, "FORBIDDEN"]);
    expect(await ma(await sgk(tHs))).toEqual([403, "FORBIDDEN"]);
    expect(await ma(await lk(tHs, "3"))).toEqual([403, "FORBIDDEN"]);
    // đối chứng dương: cùng tài khoản, phiên phụ huynh thường ⇒ 200
    expect((await dm(tA)).status).toBe(200);
    expect((await lk(tA, "3")).status).toBe(200);
  });

  it("[TSM-DB-04] URL ký: TTL ≤ 300 s, tải được, sửa/hết hạn ⇒ 403, audit không chứa URL", async () => {
    const t0 = Date.now();
    const r = await lk(tA, "3");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("no-store");
    const d = (await json(r)).data as { url: string; hetHanSauGiay: number; tenTep: string };
    expect(d.hetHanSauGiay).toBe(300);
    expect(d.tenTep).toMatch(/^Sata-Robo-Ebook-3-[A-Za-z0-9-]+\.pdf$/);
    const u = new URL(d.url);
    const e = Number(u.searchParams.get("e"));
    expect(e - t0).toBeLessThanOrEqual(300_000 + 5_000);
    expect(e - t0).toBeLessThanOrEqual(15 * 60_000);
    // tải được bằng chính URL ký
    const ok = await devKho(d.url);
    expect(ok.status).toBe(200);
    expect(Buffer.from(await ok.arrayBuffer()).toString()).toContain("%PDF-1.4 tu-sach-3");
    expect(ok.headers.get("cache-control")).toContain("no-store");
    // sửa chữ ký ⇒ 403
    const s = u.searchParams.get("s")!;
    const sai = new URL(d.url);
    sai.searchParams.set("s", s.slice(0, -1) + (s.endsWith("0") ? "1" : "0"));
    expect((await devKho(sai.toString())).status).toBe(403);
    // kéo dài hạn ⇒ 403
    const dai = new URL(d.url);
    dai.searchParams.set("e", String(e + 3_600_000));
    expect((await devKho(dai.toString())).status).toBe(403);
    // đổi sang tệp của cuốn khác với chữ ký này ⇒ 403
    const khac = new URL(d.url.replace("/ebook/3/", "/ebook/4/"));
    expect((await devKho(khac.toString())).status).toBe(403);
    // không chữ ký / sai hành động ⇒ 403
    expect((await devKho(`http://x/api/dev-kho/tu-sach/ebook/3/sach.pdf`)).status).toBe(403);
    const put = new URL(d.url);
    put.searchParams.set("act", "put");
    expect((await devKho(put.toString())).status).toBe(403);
    // quá hạn ⇒ 403
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(e + 1_000);
    expect((await devKho(d.url)).status).toBe(403);
    vi.useRealTimers();
    // sổ: đúng một dấu cho lượt này, không chứa URL / khoá tệp
    const au = await db.auditLog.findMany({ where: { entityType: "TuSachEbook", entityId: "3", action: "PH_TAI_EBOOK", actorId: ids.A } });
    expect(au.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(au)).not.toMatch(/sach\.pdf|dev-kho|https?:|X-Amz/);
  });

  it("[TSM-DB-05] chưa đủ điều kiện / ngoài danh mục / chưa có tệp / thân lạ", async () => {
    const truocAu = await db.auditLog.count({ where: { entityType: "TuSachEbook", actorId: ids.B } });
    expect(await ma(await lk(tB, "3"))).toEqual([403, "FORBIDDEN"]); // B: hồ sơ chưa có phường/xã
    expect(await db.auditLog.count({ where: { entityType: "TuSachEbook", actorId: ids.B } })).toBe(truocAu);
    // 25 có tệp trong kho nhưng KHÔNG nằm trong danh mục ⇒ không bao giờ ký
    for (const so of ["25", "0", "21", "999"]) expect(await ma(await lk(tA, so)), so).toEqual([404, "NOT_FOUND"]);
    for (const so of ["abc", "1.5", "-1", "1234", "..%2F1", "1e2"]) expect((await lk(tA, so)).status, so).toBe(400);
    // trong danh mục nhưng chưa nhập tệp (ebook 7)
    const e7 = await lk(tA, "7");
    expect([e7.status, (await json(e7)).error?.code]).toEqual([404, "NOT_FOUND"]);
    // thân lạ ⇒ 400 (strict)
    for (const than of [{ khoa: "tu-sach/ebook/3/sach.pdf" }, { so: 3 }, "x", []]) expect((await lk(tA, "3", than)).status, JSON.stringify(than)).toBe(400);
  });

  it("[TSM-DB-06] không đường lùi công khai", async () => {
    const dirTruoc = process.env.MOBILE_UPLOAD_LOCAL_DIR;
    delete process.env.MOBILE_UPLOAD_LOCAL_DIR;
    delete process.env.R2_TU_SACH_BUCKET_NAME;
    try {
      const r = await lk(tA, "3");
      expect(await ma(r)).toEqual([404, "NOT_FOUND"]); // kho chưa cấu hình ⇒ «đang cập nhật», KHÔNG có URL nào (kể cả URL công khai)
      expect(JSON.stringify(await json(await lk(tA, "3")))).not.toMatch(/https?:/);
      expect((await json(await dm(tA))).data.khoSanSang).toBe(false);
      // kho local tắt ⇒ tuyến thử nghiệm cũng không tồn tại
      expect((await devKho("http://x/api/dev-kho/tu-sach/ebook/3/sach.pdf?act=get&e=9999999999999&c=-&s=x")).status).toBe(404);
    } finally {
      process.env.MOBILE_UPLOAD_LOCAL_DIR = dirTruoc;
    }
  });

  it("[TSM-DB-07] chạm trần rate-limit ⇒ 429 + Retry-After", async () => {
    RL.ok = false;
    const r = await lk(tA, "3");
    expect(await ma(r)).toEqual([429, "RATE_LIMITED"]);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });
});
