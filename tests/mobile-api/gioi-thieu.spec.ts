import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as gioiThieuGet } from "@/app/api/mobile/v1/parent/referral/route";
import { POST as taoLinkPost } from "@/app/api/mobile/v1/parent/referral/links/route";
import { POST as qrPost } from "@/app/api/mobile/v1/parent/referral/links/[linkId]/qr/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { clearSettingsCache } from "@/lib/settings/service";
import { CO_NGUON_DAY_DU, datCoNguon } from "../lead-intake/_nguon-fixture";
import { donAffiliateFx, dungChuoi } from "../hoa-hong/_affiliate-so-fx";

/**
 * [GT-DB] V8.6 — «Giới thiệu bạn bè» phía phụ huynh (bọc domain Affiliate của web), Postgres thật:
 *   [GT-DB-01] cờ Affiliate tắt / cờ nguồn tắt / không phải đối tác ⇒ cùng 404; bật cả hai ⇒ 200 (đối chứng dương)
 *   [GT-DB-02] cách ly: A chỉ thấy link của A; JSON không chứa token/tên đối tác B; không PII; không khoá phone/email
 *   [GT-DB-03] số tiền hoa hồng ẨN khi chương trình không cho hiện (`partnerCanViewAmount`) ⇒ `hoaHong: null`
 *   [GT-DB-04] QR: link của chính mình ⇒ 200 SVG data-URI; link của B / không tồn tại / id dài ⇒ cùng 404; link đã thu hồi ⇒ 409
 *   [GT-DB-05] tạo link: đúng (trang đích hợp lệ) ⇒ 200 + dòng DB của ĐÚNG đối tác; trường lạ ⇒ 400 (strict); không phải đối tác ⇒ 404; không đăng nhập ⇒ 401
 *   [GT-DB-06] chế độ học sinh ⇒ 403 ở cả ba route
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "gtx-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.94.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.auditLog.deleteMany({ where: { actorId: { in: uids } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.authAttemptCounter.deleteMany({});
  await donAffiliateFx();
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

async function batCo(bat: boolean, nguon = true): Promise<void> {
  await db.systemSetting.deleteMany({ where: { key: "affiliate.enabled" } });
  await datCoNguon({ ...CO_NGUON_DAY_DU, enabled: nguon }, { "affiliate.enabled": bat });
}

describe.skipIf(!RUN)("[GT-DB] giới thiệu bạn bè — Postgres thật", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  let tB = "";
  let tC = ""; // không phải đối tác
  let x: Awaited<ReturnType<typeof dungChuoi>>;
  let y: Awaited<ReturnType<typeof dungChuoi>>;
  const goi = (tok: string | undefined) => gioiThieuGet(req("GET", "/api/mobile/v1/parent/referral", undefined, tok ? bearer(tok) : undefined));
  const qr = (tok: string, id: string) => qrPost(req("POST", `/api/mobile/v1/parent/referral/links/${id}/qr`, undefined, bearer(tok)), { params: Promise.resolve({ linkId: id }) });
  const tao = (tok: string | undefined, than: unknown) => taoLinkPost(req("POST", "/api/mobile/v1/parent/referral/links", than, tok ? bearer(tok) : undefined));

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    process.env.AFFILIATE_PUBLIC_ORIGIN = "https://test.satarobo.vn";
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, sdt: string) => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: sdt, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id);
    await mk("A", "84966990001");
    await mk("B", "84966990002");
    await mk("C", "84966990003");
    await db.center.create({ data: { id: `${NS}cs`, name: "Cơ sở GTX", slug: `${NS}cs`, address: "Địa chỉ" } });
    for (const k of ["A", "B", "C"]) await db.student.create({ data: { id: `${NS}s${k}`, name: `Bé ${k}`, parentUserId: ids[k], centerId: `${NS}cs` } as never });
    x = await dungChuoi({ tenCampaign: "Chiến dịch GTX Một", userId: ids.A!, tenDoiTac: "Đối tác GTX Một" });
    y = await dungChuoi({ tenCampaign: "Chiến dịch GTX Hai", userId: ids.B!, tenDoiTac: "Đối tác GTX Hai" });
    await db.affiliateCampaign.update({ where: { id: x.campaign.id }, data: { partnerCanViewAmount: false } });
    await batCo(true);
    const dn = async (sdt: string, n: number) => {
      const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9d00-${String(n).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
      return ((await json(r)).data as { accessToken: string }).accessToken;
    };
    tA = await dn("0966990001", 1);
    tB = await dn("0966990002", 2);
    tC = await dn("0966990003", 3);
    for (const t of [tA, tB, tC]) await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
  }, 180_000);
  afterAll(async () => {
    await don();
    await db.systemSetting.deleteMany({ where: { key: { in: ["affiliate.enabled"] } } });
    await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
    delete process.env.AFFILIATE_PUBLIC_ORIGIN;
    clearSettingsCache();
  }, 180_000);

  it("[GT-DB-01] cờ tắt / không phải đối tác ⇒ cùng 404; bật ⇒ 200", async () => {
    expect((await goi(tA)).status).toBe(200); // đối chứng dương
    expect(await ma(await goi(tC))).toEqual([404, "NOT_FOUND"]); // không phải đối tác
    await batCo(false);
    try {
      expect(await ma(await goi(tA))).toEqual([404, "NOT_FOUND"]);
      // cờ tắt ⇒ cả QR và tạo link cũng 404 (không chỉ phần đọc)
      expect(await ma(await qr(tA, x.asset.id))).toEqual([404, "NOT_FOUND"]);
      expect(await ma(await tao(tA, { membershipId: x.mem.id, siteId: x.site.id, landingPath: "/khoa-robot" }))).toEqual([404, "NOT_FOUND"]);
    } finally {
      await batCo(true);
    }
    await batCo(true, false);
    try {
      expect(await ma(await goi(tA))).toEqual([404, "NOT_FOUND"]); // cờ nguồn tắt
    } finally {
      await batCo(true);
    }
    expect((await goi(tA)).status).toBe(200);
    expect(await ma(await goi(undefined))).toEqual([401, "UNAUTHENTICATED"]);
  });

  it("[GT-DB-02] cách ly + không PII", async () => {
    const a = await json(await goi(tA));
    const b = await json(await goi(tB));
    expect(a.data.link.map((l: { id: string }) => l.id)).toEqual([x.asset.id]);
    expect(b.data.link.map((l: { id: string }) => l.id)).toEqual([y.asset.id]);
    const ja = JSON.stringify(a.data);
    expect(ja).not.toContain(y.token);
    expect(ja).not.toContain("Đối tác GTX Hai");
    expect(ja).toContain(x.token); // đối chứng dương
    expect(ja).not.toMatch(/"(phone|email|sdt|soDienThoai|leadId|studentId|userId)"/i);
    expect(ja).not.toMatch(/gtx-[AB]@seed|8496699|0966990/);
    expect(a.data.phienBan).toBeTruthy();
  });

  it("[GT-DB-03] số tiền hoa hồng ẨN khi chương trình không cho hiện", async () => {
    const a = await json(await goi(tA));
    expect(a.data.hoaHong).toBeNull();
    await db.affiliateCampaign.update({ where: { id: x.campaign.id }, data: { partnerCanViewAmount: true } });
    try {
      const sau = await json(await goi(tA));
      expect(sau.data.hoaHong).not.toBeNull(); // đối chứng: bật ⇒ có khối (rỗng nhưng có)
      expect(sau.data.hoaHong.daGhiSo).toBe(0);
    } finally {
      await db.affiliateCampaign.update({ where: { id: x.campaign.id }, data: { partnerCanViewAmount: false } });
    }
  });

  it("[GT-DB-04] QR: của mình 200; của B / không có / id dài ⇒ cùng 404; thu hồi ⇒ 409", async () => {
    const r = await qr(tA, x.asset.id);
    expect(r.status).toBe(200);
    const d = (await json(r)).data;
    expect(d.dinhDang).toBe("svg");
    expect(d.dataUri.startsWith("data:image/svg+xml")).toBe(true);
    expect(d.lienKetNgan).toContain(x.token);
    expect(await ma(await qr(tA, y.asset.id))).toEqual([404, "NOT_FOUND"]); // link của B
    expect(await ma(await qr(tA, "khong-co"))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await qr(tA, "x".repeat(80)))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await qr(tC, x.asset.id))).toEqual([404, "NOT_FOUND"]); // không phải đối tác
    // thu hồi là MỘT CHIỀU (ràng buộc DB) ⇒ tạo link mới rồi thu hồi nó
    const moi = (await json(await tao(tA, { membershipId: x.mem.id, siteId: x.site.id, landingPath: "/khoa-robot", label: "sẽ thu hồi" }))).data.id as string;
    expect((await qr(tA, moi)).status).toBe(200);
    await db.affiliateTrackingAsset.update({ where: { id: moi }, data: { status: "REVOKED", revokedAt: new Date("2026-11-19T03:00:00.000Z"), revokedReason: "fixture thu hồi" } as never });
    expect(await ma(await qr(tA, moi))).toEqual([409, "VALIDATION"]);
  });

  it("[GT-DB-05] tạo link: đúng ⇒ 200 + dòng của ĐÚNG đối tác; trường lạ ⇒ 400; không phải đối tác ⇒ 404; chưa đăng nhập ⇒ 401", async () => {
    const vao = { membershipId: x.mem.id, siteId: x.site.id, landingPath: "/khoa-robot", label: "Nhóm Zalo" };
    const r = await tao(tA, vao);
    expect(r.status).toBe(200);
    const id = (await json(r)).data.id as string;
    const dong = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id } });
    expect(dong).toMatchObject({ partyId: x.doiTac.id, membershipId: x.mem.id, siteId: x.site.id, landingPath: "/khoa-robot", status: "ACTIVE" });
    expect(await ma(await tao(tA, { ...vao, partyId: y.doiTac.id }))).toEqual([400, "VALIDATION"]); // strict: không nhận khoá lạ
    expect((await ma(await tao(tA, { ...vao, membershipId: y.mem.id })))[0]).toBeGreaterThanOrEqual(400); // membership của B
    expect(await db.affiliateTrackingAsset.count({ where: { partyId: y.doiTac.id } })).toBe(1); // B không bị đụng
    expect(await ma(await tao(tC, vao))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await tao(undefined, vao))).toEqual([401, "UNAUTHENTICATED"]);
  });

  it("[GT-DB-06] chế độ học sinh ⇒ 403 ở cả ba route", async () => {
    // vào chế độ học sinh KHOÁ chính phiên của A (dùng một phiên riêng của A để không ảnh hưởng ca khác)
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: "0966990001", matKhau: MK, thietBi: { maThietBi: "00000000-0000-4000-9d00-0000000000a9", nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const hs = ((await json(r)).data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(hs)));
    expect((await codePost(req("POST", "/x", { ma: "4827", xacNhan: "4827" }, bearer(hs)))).status).toBe(200);
    expect((await enterPost(req("POST", "/x", { studentId: `${NS}sA` }, bearer(hs)))).status).toBe(200);
    expect(await ma(await goi(hs))).toEqual([403, "FORBIDDEN"]);
    expect(await ma(await qr(hs, x.asset.id))).toEqual([403, "FORBIDDEN"]);
    expect(await ma(await tao(hs, { membershipId: x.mem.id, siteId: x.site.id, landingPath: "/khoa-robot" }))).toEqual([403, "FORBIDDEN"]);
  });
});
