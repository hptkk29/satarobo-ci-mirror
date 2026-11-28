import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as thuNhapGet } from "@/app/api/mobile/v1/parent/income/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [TNT] V8.20 — `GET /parent/income` (P-Thu-nhap) ở mức ROUTE-HANDLER + Postgres thật — CỔNG và ranh giới (trước đây chỉ có test service):
 *   [TNT-01] cờ THU_NHAP_THEM_ENABLED tắt ⇒ 404; không token ⇒ 401
 *   [TNT-02] cờ bật, tài khoản chưa có khách giới thiệu ⇒ 200 RỖNG (cùng hình dạng, không phân biệt «có/không có chương trình»); tham số quá dài ⇒ 400
 *   [TNT-03] chế độ học sinh ⇒ 403 (route không nằm trong allow-list)
 * ⚠️ CHƯA có ca dương (đối tác thật có khách): cần fixture Affiliate đủ bộ (đối tác · thành viên · lead giới thiệu) — còn thiếu ⇒ P-Thu-nhap KHÔNG được nâng lên HTTP_VERIFIED.
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "tnt-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.95.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.hocSinhCheDoNhatKy.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.hocSinhMaThoat.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[TNT] thu nhập thêm — cổng route", () => {
  let tok = "";
  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const u = await db.user.create({ data: { email: `${NS}A@seed.invalid`, name: "PH A", phone: "84966970001", password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
    await db.student.create({ data: { id: A("s1"), name: "Bé", parentUserId: u.id } as never });
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: "0966970001", matKhau: MK, thietBi: { maThietBi: "00000000-0000-4000-9d00-000000000001", nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    tok = ((await json(r)).data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(tok)));
  }, 120_000);
  afterAll(async () => {
    await don();
    delete process.env.THU_NHAP_THEM_ENABLED;
  }, 120_000);

  it("[TNT-01] cờ tắt ⇒ 404; không token ⇒ 401", async () => {
    delete process.env.THU_NHAP_THEM_ENABLED;
    const r = await thuNhapGet(req("GET", "/api/mobile/v1/parent/income", undefined, bearer(tok)));
    expect([r.status, (await json(r)).error?.code]).toEqual([404, "NOT_FOUND"]);
    expect((await thuNhapGet(req("GET", "/api/mobile/v1/parent/income"))).status).toBe(401);
  });

  it("[TNT-02] cờ bật, chưa có khách ⇒ 200 rỗng cùng hình dạng; tham số quá dài ⇒ 400", async () => {
    process.env.THU_NHAP_THEM_ENABLED = "true";
    const khong = await thuNhapGet(req("GET", "/api/mobile/v1/parent/income", undefined, bearer(tok)));
    expect(khong.status).toBe(200);
    // đối tác chưa có khách ⇒ rỗng; MỌI phụ huynh (có/không là đối tác) nhận CÙNG hình dạng ⇒ không phân biệt được «có chương trình hay không»
    expect(await json(khong)).toMatchObject({ ok: true, data: { tongKhach: 0, daChot: 0, khach: [] } });
    expect((await thuNhapGet(req("GET", `/api/mobile/v1/parent/income?q=${"x".repeat(61)}`, undefined, bearer(tok)))).status).toBe(400);
  });

  it("[TNT-03] chế độ học sinh ⇒ 403", async () => {
    expect((await codePost(req("POST", "/api/mobile/v1/student-mode/code", { ma: "4729", xacNhan: "4729" }, bearer(tok)))).status).toBe(200);
    expect((await enterPost(req("POST", "/api/mobile/v1/student-mode/enter", { studentId: A("s1") }, bearer(tok)))).status).toBe(200);
    expect((await thuNhapGet(req("GET", "/api/mobile/v1/parent/income", undefined, bearer(tok)))).status).toBe(403);
  });
});

function A(k: string) {
  return `${NS}${k}`;
}
