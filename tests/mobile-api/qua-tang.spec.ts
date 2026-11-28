import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as quaTangGet } from "@/app/api/mobile/v1/parent/gifts/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [QT] Hộp «Quà tặng» (P-Qua-tang) — GET /parent/gifts. Postgres scratch, route handler thật.
 *   [QT-01] cấp PHỤ HUYNH: tài khoản CHƯA có học viên vẫn đọc được (lối vào DISC/Sức khoẻ/Tủ sách) · [QT-02] cờ quyết định quà (thứ tự theo danh mục web; tắt hết ⇒ qua:[] 200)
 *   [QT-03] Student Mode ⇒ 403 · [QT-04] không token ⇒ 401 · [QT-05] không lộ dữ liệu cá nhân/đường dẫn web; không nhận tham số
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "qtang-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.130.${Math.floor(++dem / 250)}.${(dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Ket = { ok: boolean; data?: { qua: Array<{ ma: string; manHinh: string }>; soKhuyenMai: number; coThuNhap: boolean }; error?: { code: string } };
const json = async (r: Response) => (await r.clone().json()) as Ket;
const CO = ["DISC_ENABLED", "SUC_KHOE_ENABLED", "TU_SACH_ENABLED", "THU_NHAP_THEM_ENABLED"];

async function dangNhap(phone: string, n: number) {
  const r = await dangNhapRoute(req("/api/mobile/v1/auth/login", { dinhDanh: phone, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-a600-${String(n + 900).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
  if (r.status !== 200) throw new Error(`đăng nhập ${r.status}`);
  return ((await json(r)).data as unknown as { accessToken: string }).accessToken;
}
async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const ids = us.map((u) => u.id);
  await db.hocSinhCheDoNhatKy.deleteMany({ where: { parentUserId: { in: ids } } });
  await db.hocSinhMaThoat.deleteMany({ where: { parentUserId: { in: ids } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: ids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: ids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.authAttemptCounter.deleteMany({});
}

describe.skipIf(!RUN)("[QT] Hộp Quà tặng — GET /parent/gifts", () => {
  let tokKhongBe = ""; let tokCoBe = "";
  const goi = async (tok?: string, url = "/api/mobile/v1/parent/gifts") => { const r = await quaTangGet(req(url, undefined, tok)); return { s: r.status, b: await json(r), raw: await r.clone().text() }; };
  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const a = await db.user.create({ data: { email: `${NS}a@seed.invalid`, name: `${NS}a`, phone: "84966900201", password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
    const b = await db.user.create({ data: { email: `${NS}b@seed.invalid`, name: `${NS}b`, phone: "84966900202", password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
    await db.student.create({ data: { id: `${NS}be`, name: "Bé Quà", parentUserId: b.id } as never });
    expect(a.id).toBeTruthy();
    tokKhongBe = await dangNhap("0966900201", 1); tokCoBe = await dangNhap("0966900202", 2);
    for (const t of [tokKhongBe, tokCoBe]) await quyDinhDongY(req("/x", {}, t));
  }, 60_000);
  afterAll(async () => { await don(); for (const k of CO) delete process.env[k]; });

  it("[QT-01] tài khoản CHƯA có học viên vẫn đọc được hộp quà (cấp phụ huynh) — lối vào DISC/Sức khoẻ/Tủ sách", async () => {
    for (const k of CO) process.env[k] = "true";
    const r = await goi(tokKhongBe);
    expect(r.s, r.raw).toBe(200);
    expect(r.b.data!.qua.map((q) => q.ma)).toEqual(["disc", "suc-khoe", "tu-sach"]);
    expect(r.b.data!.qua.map((q) => q.manHinh)).toEqual(["P-Disc", "P-Suc-khoe", "P-Tu-sach"]);
    expect(r.b.data).toMatchObject({ coThuNhap: true });
    expect(typeof r.b.data!.soKhuyenMai).toBe("number");
    expect((await goi(tokCoBe)).s).toBe(200); // có bé cũng dùng được
  });

  it("[QT-02] CỜ quyết định quà: từng cờ tắt ⇒ quà đó biến mất; tắt hết ⇒ qua:[] (200, app tự ẩn ô); coThuNhap theo cờ riêng", async () => {
    for (const k of CO) process.env[k] = "true";
    process.env.SUC_KHOE_ENABLED = "false";
    expect((await goi(tokKhongBe)).b.data!.qua.map((q) => q.ma)).toEqual(["disc", "tu-sach"]);
    process.env.DISC_ENABLED = "false"; process.env.TU_SACH_ENABLED = "false"; process.env.THU_NHAP_THEM_ENABLED = "false";
    const r = await goi(tokKhongBe);
    expect([r.s, r.b.data!.qua, r.b.data!.coThuNhap]).toEqual([200, [], false]);
    for (const k of CO) process.env[k] = "true";
  });

  it("[QT-03] Student Mode ⇒ 403 (mặc định từ chối), không lộ danh mục", async () => {
    for (const k of CO) process.env[k] = "true";
    expect((await codePost(req("/api/mobile/v1/student-mode/code", { ma: "4729", xacNhan: "4729" }, tokCoBe))).status).toBe(200);
    expect((await enterPost(req("/api/mobile/v1/student-mode/enter", { studentId: `${NS}be` }, tokCoBe))).status).toBe(200);
    const r = await goi(tokCoBe);
    expect([r.s, r.b.error?.code]).toEqual([403, "FORBIDDEN"]);
    expect(r.raw).not.toMatch(/Khám phá|disc/i);
  });

  it("[QT-04] không token / token rác ⇒ 401", async () => {
    expect((await goi(undefined)).s).toBe(401);
    expect((await goi("token-rac")).s).toBe(401);
  });

  it("[QT-05] chỉ metadata quà: không tên người/SĐT/đường dẫn web (/portal) / mã học viên; tham số truy vấn bị bỏ qua", async () => {
    for (const k of CO) process.env[k] = "true";
    const r = await goi(tokKhongBe, "/api/mobile/v1/parent/gifts?studentId=x&userId=y&ma=disc");
    expect(r.s).toBe(200);
    expect(r.raw).not.toMatch(/\/portal|qtang-|84966900|href|nen|chu"/);
    expect(Object.keys(r.b.data!).sort()).toEqual(["coThuNhap", "qua", "soKhuyenMai"]);
  });
});
