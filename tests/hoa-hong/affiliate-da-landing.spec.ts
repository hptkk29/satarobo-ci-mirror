// @vitest-environment node
/**
 * [AFFL6-*] — AFFILIATE ĐA TÊN MIỀN / ĐA TRANG ĐÍCH trên Postgres THẬT (AFF-L6, docs/source-commission/closeout/l6-da-website-landing.md). CHỈ phần #716 (`affiliate-nhieu-website.spec.ts`) chưa phủ:
 * tên miền RIÊNG của trang đích, snapshot `landingHost`/`landingPageId`, `/r` chuyển đúng tên miền (đọc header `Location` thật qua handler GET), bảng nối Campaign × Trang đích,
 * thu hẹp có cảnh báo link bị ảnh hưởng, tắt trang đích / tắt theo dõi riêng trang, backfill + trigger của migration.
 *
 *   [AFFL6-01] host của trang đích: chuẩn hoá (trùng gốc ⇒ NULL), ∈ allowedDomains, cùng đường dẫn ở hai tên miền là hai trang, CHECK ở DB
 *   [AFFL6-02] phát link trên trang đích có tên miền riêng ⇒ snapshot đúng; `GET /r/<token>` → `Location` ĐÚNG tên miền + đường dẫn (không luôn về website gốc)
 *   [AFFL6-03] client không quyết tên miền: khoá lạ bị từ chối; id trang đích của website khác / sai đường dẫn bị từ chối (admin + cổng đối tác)
 *   [AFFL6-04] campaign ↔ trang đích: không chọn = tất cả; có chọn = chỉ các trang đó (phát admin + cổng + ô chọn); theo TỪNG website; campaign khác không bị ảnh hưởng
 *   [AFFL6-05] thu hẹp có CẢNH BÁO: link đang chạy bị chết ⇒ từ chối kèm số link cho tới khi xác nhận; link chết qua cổng (/r · beacon · intake), KHÔNG bị xoá, lịch sử giữ; bỏ hạn chế ⇒ sống lại
 *   [AFFL6-06] gỡ website khỏi campaign ⇒ xoá lựa chọn trang đích của website đó (gắn lại không «sống lại» lựa chọn cũ)
 *   [AFFL6-07] tắt trang đích / tắt theo dõi RIÊNG trang ⇒ không phát mới, link cũ chết qua cổng, báo số link ảnh hưởng, lịch sử giữ; bật lại ⇒ sống lại
 *   [AFFL6-08] sửa website không được gỡ tên miền đang là host của một trang đích
 *   [AFFL6-09] trigger bất biến: `landingHost` đã có không đổi; `landingPageId` NULL→giá trị được, đổi sang giá trị khác thì không, xoá trang ⇒ về NULL (FK SET NULL) không vướng trigger
 *   [AFFL6-10] backfill của migration: chỉ gán khi khớp DUY NHẤT; mơ hồ / không khớp ⇒ NULL; chạy lại không đổi gì
 *   [AFFL6-11] xoay mã giữ nguyên tên miền + trang đích; link CŨ (chưa có snapshot) vẫn chạy về tên miền của website
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng fixture, chạy ĐƯỢC MỘT MÌNH. LUẬT 19: đồng hồ TIÊM (`NOW`). AN TOÀN DB: không `resetDb()` — dọn THEO TIỀN TỐ `AL6`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

const PHIEN = vi.hoisted(() => ({ session: null as null | { user: { id: string; role: string; name?: string } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => PHIEN.session }));
vi.mock("next/cache", async (goc) => ({ ...(await goc<typeof import("next/cache")>()), revalidatePath: () => undefined }));
vi.setConfig({ testTimeout: 90_000 });

import { GET as rGet } from "../../app/(public)/r/[token]/route";
import { taoLinkCuaToiAction } from "../../app/(portal)/portal/gioi-thieu/_actions";
import { docGioiThieuCuaToi } from "../../lib/affiliate/doc-cua-toi";
import { docDanhSachLink, docTuyChonPhatLink } from "../../lib/affiliate/doc-link";
import { datTrangDichCampaign, ganWebsite, goWebsite } from "../../lib/affiliate/ghi-campaign";
import { phatLink, xoayLink } from "../../lib/affiliate/ghi-link";
import { batTatTrangDich, suaTrangDich, suaWebsite, themTrangDich } from "../../lib/affiliate/ghi-website";
import { xuLyIntakeGioiThieu } from "../../lib/affiliate/intake-cong-khai";
import { xuLyBeacon, type PhuThuoc } from "../../lib/affiliate/theo-doi-cong-khai";
import { db } from "../../lib/db";
import { laDbCucBo } from "../../lib/security/url-db-cuc-bo";
import { clearSettingsCache } from "../../lib/settings/service";
import { LY_DO_BO_QUA, RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";

if (!RUN_DB_TESTS) console.warn(`[AFFL6] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "AL6";
const NOW = new Date("2026-10-05T03:00:00.000Z");
const GOC = "https://test.satarobo.vn";
const NGUOI = { userId: "al6-admin", ten: "Admin AL6" };
const TEN_PHIEN = "Đối tác thử AL6";

let dem = 0;
const hau = () => `${Date.now().toString(36).toUpperCase()}${(dem += 1)}`;
let sdtSeq = 0;
const sdtMoi = () => `09${String(((Date.now() % 90_000_000) + 1_000_000 + (sdtSeq += 7)) % 100_000_000).padStart(8, "0")}`;
const bienThe = (s: string) => [s, `84${s.slice(1)}`];
let ipSeq = 0;

async function assertDbThu(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!laDbCucBo(url)) throw new Error("[AFFL6] TỪ CHỐI: DATABASE_URL không trỏ Postgres cục bộ (hoặc là tunnel VPS).");
  const r = await db.$queryRaw<{ ten: string }[]>`select current_database() as ten`;
  const ten = r[0]?.ten ?? "";
  if (/^(satarobo_local|satarobo_dev)/.test(ten)) throw new Error(`[AFFL6] TỪ CHỐI: database "${ten}" là DB đang phục vụ dev server.`);
}

async function don(): Promise<void> {
  const ds = await db.affiliate.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const ids = ds.map((x) => x.id);
  const camp = await db.affiliateCampaign.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const cid = camp.map((c) => c.id);
  await db.leadAttribution.deleteMany({ where: { lead: { parentName: { startsWith: P } } } });
  await db.leadTouchpoint.deleteMany({ where: { lead: { parentName: { startsWith: P } } } });
  await db.affiliateReferral.deleteMany({ where: { OR: [{ partyId: { in: ids } }, { campaignId: { in: cid } }] } });
  await db.lead.updateMany({ where: { parentName: { startsWith: P } }, data: { deletedAt: new Date() } });
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`ALTER TABLE "ReferralClick" DISABLE TRIGGER "ReferralClick_chi_them"`;
    await tx.referralClick.deleteMany({ where: { OR: [{ partyId: { in: ids } }, { campaignId: { in: cid } }] } });
    await tx.$executeRaw`ALTER TABLE "ReferralClick" ENABLE TRIGGER "ReferralClick_chi_them"`;
  });
  await db.auditLog.deleteMany({ where: { OR: [{ actorName: { in: [NGUOI.ten, TEN_PHIEN] } }, { actorId: { startsWith: "al6-" } }] } });
  await db.affiliateTrackingAsset.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliatePartyUser.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliateMembership.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliateCampaignLanding.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaignRule.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaignSite.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaign.deleteMany({ where: { id: { in: cid } } });
  await db.affiliateSite.deleteMany({ where: { code: { startsWith: P } } });
  await db.affiliatePartyTag.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliate.deleteMany({ where: { id: { in: ids } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: P } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: "al6-" } } });
}

async function batCo(bat: boolean): Promise<void> {
  await db.systemSetting.deleteMany({ where: { key: "affiliate.enabled" } });
  await datCoNguon({ ...CO_NGUON_DAY_DU, enabled: true }, { "affiliate.enabled": bat });
}

type Fx = Awaited<ReturnType<typeof dungHienTruong>>;

/**
 * Website A = «quatang» (gốc `a-<h>.example.test` + tên miền thứ hai `covua.a-<h>.example.test`); website B = một tên miền.
 *   A: LA1 «/» (tên miền gốc) · LA2 «/» (tên miền covua — CÙNG đường dẫn, KHÁC trang đích) · LA3 «/giai-dau/*» (covua) · LA4 «/khoa-hoc/*» (gốc)
 *   B: LB1 «/b»
 * C1 (nguồn NA) gắn A·B; C2 gắn A. P1 ∈ C1 (M1), C2 (M2). P2 ∈ C1 (N1), thuộc tài khoản u2.
 */
async function dungHienTruong() {
  const h = hau();
  const hl = h.toLowerCase();
  const nA = await db.leadSourceGroup.create({
    data: { code: `${P}_NA${h}`, name: `Nguồn NA ${P} ${h}`, sourceType: "PARTNER", referrerRequirement: "NONE", sortOrder: 900, status: "ACTIVE", selectable: true, commissionEnabled: false },
  });
  const goc = `a-${hl}.example.test`;
  const phu = `covua.${goc}`;
  const A = await db.affiliateSite.create({ data: { code: `${P}_A${h}`, name: `Web A ${P} ${h}`, baseUrl: `https://${goc}`, allowedDomains: [goc, phu] } });
  const B = await db.affiliateSite.create({ data: { code: `${P}_B${h}`, name: `Web B ${P} ${h}`, baseUrl: `https://b-${hl}.example.test`, allowedDomains: [`b-${hl}.example.test`] } });
  const trang = (siteId: string, pathPattern: string, host: string | null, extra: Partial<{ isActive: boolean; trackingEnabled: boolean; label: string }> = {}) =>
    db.affiliateLandingPage.create({ data: { siteId, pathPattern, host, hostKey: host ?? "", label: extra.label ?? null, isActive: extra.isActive ?? true, trackingEnabled: extra.trackingEnabled ?? true } });
  const LA1 = await trang(A.id, "/", null);
  const LA2 = await trang(A.id, "/", phu);
  const LA3 = await trang(A.id, "/giai-dau/*", phu, { label: "Giải đấu" });
  const LA4 = await trang(A.id, "/khoa-hoc/*", null);
  const LB1 = await trang(B.id, "/b", null);
  const camp = (ma: string, sites: string[]) =>
    db.affiliateCampaign.create({
      data: {
        code: `${P}_${ma}${h}`, name: `Campaign ${ma} ${P} ${h}`, status: "ACTIVE", cookieWindowDays: 30, protectWindowDays: 90, defaultSourceGroupId: nA.id,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), sites: { create: sites.map((siteId) => ({ siteId })) },
      },
    });
  const C1 = await camp("C1", [A.id, B.id]);
  const C2 = await camp("C2", [A.id]);
  const loai = await db.affiliateType.create({ data: { code: `${P}_T${h}`, name: `Loại ${P} ${h}` } });
  const u1 = await seedUser({ email: `al6-u1-${hl}@ci.test`, role: "PARENT", name: `PH AL6 Một ${h}`, phone: null });
  const u2 = await seedUser({ email: `al6-u2-${hl}@ci.test`, role: "PARENT", name: `PH AL6 Hai ${h}`, phone: null });
  const dt = (ma: string, userId: string) =>
    db.affiliate.create({ data: { code: `${P}_${ma}${h}`, name: `Đối tác ${ma} ${P} ${h}`, status: "ACTIVE", isActive: true, typeId: loai.id, userId, phone: "0988777666", email: `dt.${ma.toLowerCase()}.${hl}@ci.test` } });
  const P1 = await dt("P1", u1.id);
  const P2 = await dt("P2", u2.id);
  const mem = (partyId: string, campaignId: string) => db.affiliateMembership.create({ data: { partyId, campaignId, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  const M1 = await mem(P1.id, C1.id);
  const M2 = await mem(P1.id, C2.id);
  const N1 = await mem(P2.id, C1.id);
  return { h, goc, phu, nA, A, B, LA1, LA2, LA3, LA4, LB1, C1, C2, u1, u2, P1, P2, M1, M2, N1 };
}

const dangNhap = (userId: string) => {
  PHIEN.session = { user: { id: userId, role: "PARENT", name: TEN_PHIEN } };
};
const deps = (): PhuThuoc => ({ client: db, now: () => NOW, goc: GOC, choPhepTanSuat: async () => true, khoaHmac: () => "k".repeat(32), sinhMaPhien: () => "0123456789abcdef0123456789abcdef" });
const phat = (f: Fx, p: { membershipId?: string; siteId?: string; landingPageId?: string | null; landingPath: string }) =>
  phatLink({ nguoi: NGUOI, vao: { partyId: f.P1.id, membershipId: p.membershipId ?? f.M1.id, siteId: p.siteId ?? f.A.id, landingPageId: p.landingPageId ?? null, landingPath: p.landingPath, type: "LINK", label: null }, now: NOW });
async function phatOk(f: Fx, p: Parameters<typeof phat>[1]) {
  const r = await phat(f, p);
  if (!r.ok) throw new Error(`fixture hỏng: ${r.loi}`);
  return db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: r.id } });
}
const goiR = (token: string) => rGet(new NextRequest(`https://test.satarobo.vn/r/${encodeURIComponent(token)}`, { headers: { "x-forwarded-for": `10.9.${(ipSeq += 1) % 200}.1` } }), { params: Promise.resolve({ token }) });
const click = (assetId: string) => db.referralClick.findMany({ where: { assetId }, orderBy: { occurredAt: "asc" }, select: { outcome: true } });
const LY_DO_THU = "Thu hẹp trang đích để kiểm thử";
const chonCamp = async (f: Fx, campaignId: string, ids: string[], xacNhan = true, siteId = f.A.id, lyDo: string | null = LY_DO_THU) => datTrangDichCampaign({ nguoi: NGUOI, campaignId, siteId, landingPageIds: ids, xacNhan, lyDo, now: NOW });
const optPhat = async (f: Fx, membershipId: string, siteId = f.A.id) => {
  const r = await docTuyChonPhatLink(NOW, { partyIds: [f.P1.id], chiTrangChinhXac: false });
  return r.doiTac.find((d) => d.id === f.P1.id)?.chuongTrinh.find((c) => c.membershipId === membershipId)?.websites.find((w) => w.siteId === siteId)?.trangDich.map((t) => t.id).sort() ?? [];
};

async function guiIntake(token: string, origin: string | null) {
  ipSeq += 1;
  const sdt = sdtMoi();
  const kq = await xuLyIntakeGioiThieu(
    {
      thanTho: JSON.stringify({ v: 1, token, idempotencyKey: `al6-${hau().toLowerCase()}-${ipSeq}-xx`, parentName: `${P} PH ${hau()}`, phone: sdt, children: [{ fullName: `${P} Bé` }], consentMarketing: true }),
      origin,
      ip: `10.78.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`,
      userAgent: null,
    },
    { now: () => NOW, choPhepTanSuat: async () => true },
  );
  return { kq, sdt };
}

describe.skipIf(!RUN_DB_TESTS)("[AFFL6] affiliate đa tên miền / đa trang đích — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    vi.stubEnv("AFFILIATE_PUBLIC_ORIGIN", GOC);
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["HO_ACCOUNTANT", "CENTER_SALES_CSM"] });
    await damBaoDanhMucGoc(db);
  }, 180_000);

  beforeEach(async () => {
    await assertDbThu();
    PHIEN.session = null;
    await batCo(true);
    await don();
  }, 120_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await don();
    await db.systemSetting.deleteMany({ where: { key: { in: ["affiliate.enabled"] } } });
    await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
    clearSettingsCache();
  }, 180_000);

  it("[AFFL6-01] host của trang đích: trùng gốc ⇒ NULL; phải ∈ allowedDomains; cùng đường dẫn ở hai tên miền là hai trang; trùng thì từ chối; CHECK ở DB", async () => {
    const f = await dungHienTruong();
    // tên miền thứ hai hợp lệ ⇒ lưu host + hostKey
    const a = await themTrangDich({ nguoi: NGUOI, vao: { siteId: f.A.id, host: f.phu, pathPattern: "/moi", label: null } });
    expect(a.ok).toBe(true);
    const dongA = await db.affiliateLandingPage.findFirstOrThrow({ where: { siteId: f.A.id, pathPattern: "/moi" } });
    expect([dongA.host, dongA.hostKey]).toEqual([f.phu, f.phu]);
    // host TRÙNG gốc URL ⇒ chuẩn hoá về NULL (một trang = một dòng)
    const b = await themTrangDich({ nguoi: NGUOI, vao: { siteId: f.A.id, host: f.goc, pathPattern: "/goc", label: null } });
    expect(b.ok).toBe(true);
    expect(await db.affiliateLandingPage.findFirstOrThrow({ where: { siteId: f.A.id, pathPattern: "/goc" } })).toMatchObject({ host: null, hostKey: "" });
    // …nên thêm lại cùng đường dẫn ở tên miền gốc (viết tường minh hay bỏ trống) là TRÙNG
    for (const host of [null, f.goc]) expect((await themTrangDich({ nguoi: NGUOI, vao: { siteId: f.A.id, host, pathPattern: "/goc", label: null } })).ok, String(host)).toBe(false);
    // đối chứng dương: cùng «/» ở hai tên miền đã có sẵn (LA1 + LA2) — và «/moi» thêm được ở TÊN MIỀN GỐC dù đã có ở covua
    expect((await themTrangDich({ nguoi: NGUOI, vao: { siteId: f.A.id, host: null, pathPattern: "/moi", label: null } })).ok).toBe(true);
    // tên miền ngoài danh sách / sai dạng ⇒ từ chối, gắn ô host
    for (const host of ["evil.example", `www.${f.goc}`, "*.example.test", `https://${f.phu}`, f.phu.toUpperCase().slice(0, 3) + "!"]) {
      const r = await themTrangDich({ nguoi: NGUOI, vao: { siteId: f.A.id, host, pathPattern: "/x", label: null } });
      expect(r.ok, host).toBe(false);
      if (!r.ok) expect(r.truong, host).toBe("host");
    }
    // DB cũng giữ: hostKey lệch host / tên miền sai dạng bị CHECK chặn dù đi đường tắt
    await expect(db.$executeRaw`INSERT INTO "AffiliateLandingPage" ("id","siteId","pathPattern","host","hostKey","updatedAt") VALUES ('al6-bad1', ${f.A.id}, '/bad1', ${f.phu}, '', NOW())`).rejects.toThrow(/AffiliateLandingPage_host_key_chk/);
    await expect(db.$executeRaw`INSERT INTO "AffiliateLandingPage" ("id","siteId","pathPattern","host","hostKey","updatedAt") VALUES ('al6-bad2', ${f.A.id}, '/bad2', 'EVIL.com', 'EVIL.com', NOW())`).rejects.toThrow(/AffiliateLandingPage_host_chk/);
    // khoá duy nhất theo (website, tên miền, đường dẫn) ở tầng DB
    await expect(db.affiliateLandingPage.create({ data: { siteId: f.A.id, pathPattern: "/", host: f.phu, hostKey: f.phu } })).rejects.toThrow();
  });

  it("[AFFL6-02] phát link trên trang đích có tên miền riêng ⇒ snapshot đúng; `GET /r/<token>` → Location ĐÚNG tên miền + đường dẫn của link (không luôn về website gốc)", async () => {
    const f = await dungHienTruong();
    const covua = await phatOk(f, { landingPageId: f.LA3.id, landingPath: "/giai-dau/2027" });
    const goc = await phatOk(f, { landingPageId: f.LA4.id, landingPath: "/khoa-hoc/robot" });
    const tuDong = await phatOk(f, { landingPath: "/khoa-hoc/ai" }); // không chọn trang đích ⇒ tìm trên tên miền của website
    expect([covua.landingHost, covua.landingPageId]).toEqual([f.phu, f.LA3.id]);
    expect([goc.landingHost, goc.landingPageId]).toEqual([f.goc, f.LA4.id]);
    expect([tuDong.landingHost, tuDong.landingPageId]).toEqual([f.goc, f.LA4.id]);

    const rCovua = await goiR(covua.publicToken);
    expect(rCovua.status).toBe(302);
    expect(rCovua.headers.get("location")!.startsWith(`https://${f.phu}/giai-dau/2027?aff=${covua.publicToken}&cmp=${f.C1.code}&clk=`)).toBe(true);
    const rGoc = await goiR(goc.publicToken);
    expect(rGoc.headers.get("location")!.startsWith(`https://${f.goc}/khoa-hoc/robot?aff=${goc.publicToken}&cmp=${f.C1.code}&clk=`)).toBe(true);
    expect(rCovua.headers.get("set-cookie") ?? "").toContain("sr_aff=");

    // danh sách (Admin): mỗi link nói TÊN MIỀN ĐÍCH + URL cuối đúng tên miền đó; người chỉ xem nhận địa chỉ sạch
    const ds = await docDanhSachLink({ trang: 1, kichThuoc: 25, trangThai: null, campaignMa: null, doiTacMa: f.P1.code, coTheXemDayDu: true, gocLinkNgan: GOC, now: NOW });
    const dongCovua = ds.dong.find((d) => d.token === covua.publicToken)!;
    expect([dongCovua.landingHost, dongCovua.landingNhan]).toEqual([f.phu, "Giải đấu"]);
    expect(dongCovua.urlCuoi).toBe(`https://${f.phu}/giai-dau/2027?aff=${covua.publicToken}&cmp=${f.C1.code}`);
    const xem = await docDanhSachLink({ trang: 1, kichThuoc: 25, trangThai: null, campaignMa: null, doiTacMa: f.P1.code, coTheXemDayDu: false, gocLinkNgan: GOC, now: NOW });
    expect(xem.dong.find((d) => d.landingHost === f.phu)!.urlCuoi).toBe(`https://${f.phu}/giai-dau/2027`);
  });

  it("[AFFL6-03] client không quyết tên miền: khoá lạ bị từ chối; id trang đích của website khác / sai đường dẫn / sai website bị từ chối — cả Admin lẫn cổng đối tác", async () => {
    const f = await dungHienTruong();
    // khoá `landingHost` / `host` từ client ⇒ lược đồ strict từ chối
    for (const them of [{ landingHost: "evil.example" }, { host: "evil.example" }]) {
      const r = await phatLink({ nguoi: NGUOI, vao: { partyId: f.P1.id, membershipId: f.M1.id, siteId: f.A.id, landingPath: "/khoa-hoc/x", type: "LINK", label: null, ...them }, now: NOW });
      expect(r.ok, JSON.stringify(them)).toBe(false);
    }
    // id trang đích của website KHÁC; đường dẫn không khớp mẫu của trang đã chọn; trang đích không tồn tại
    expect((await phat(f, { landingPageId: f.LB1.id, landingPath: "/b" })).ok).toBe(false);
    expect((await phat(f, { landingPageId: f.LA3.id, landingPath: "/khoa-hoc/x" })).ok).toBe(false);
    expect((await phat(f, { landingPageId: "khong-co", landingPath: "/khoa-hoc/x" })).ok).toBe(false);
    expect(await db.affiliateTrackingAsset.count({ where: { partyId: f.P1.id } })).toBe(0);

    // cổng đối tác: trang đích «đúng» (không `*`) của website — LA2 (covua «/») chọn được và mang tên miền covua
    dangNhap(f.u1.id);
    const ok = await taoLinkCuaToiAction({ membershipId: f.M1.id, siteId: f.A.id, landingPageId: f.LA2.id, landingPath: "/" });
    expect(ok.ok).toBe(true);
    expect(await db.affiliateTrackingAsset.findFirstOrThrow({ where: { partyId: f.P1.id } })).toMatchObject({ landingHost: f.phu, landingPageId: f.LA2.id });
    // id của website khác / cùng đường dẫn nhưng id lệch / khoá lạ ⇒ từ chối, không tạo thêm
    for (const x of [
      { landingPageId: f.LB1.id, landingPath: "/" },
      { landingPageId: f.LA1.id, landingPath: "/b" },
      { landingPageId: f.LA2.id, landingPath: "/", landingHost: "evil.example" },
    ]) {
      expect((await taoLinkCuaToiAction({ membershipId: f.M1.id, siteId: f.A.id, ...x })).ok, JSON.stringify(x)).toBe(false);
    }
    expect(await db.affiliateTrackingAsset.count({ where: { partyId: f.P1.id } })).toBe(1);
    // người khác (u2) không dùng được membership của P1 dù biết id trang đích
    dangNhap(f.u2.id);
    expect((await taoLinkCuaToiAction({ membershipId: f.M1.id, siteId: f.A.id, landingPageId: f.LA2.id, landingPath: "/" })).ok).toBe(false);
  });

  it("[AFFL6-04] campaign ↔ trang đích: không chọn = tất cả; có chọn = chỉ các trang đó (phát Admin · cổng đối tác · ô chọn); theo TỪNG website; campaign khác không bị ảnh hưởng", async () => {
    const f = await dungHienTruong();
    // KHÔNG chọn ⇒ ô chọn thấy MỌI trang đang bật của A (đối chứng) và B
    expect(await optPhat(f, f.M1.id)).toEqual([f.LA1.id, f.LA2.id, f.LA3.id, f.LA4.id].sort());
    expect(await optPhat(f, f.M1.id, f.B.id)).toEqual([f.LB1.id]);

    // C1 × A chỉ chạy trang LA4
    const r = await chonCamp(f, f.C1.id, [f.LA4.id]);
    expect(r).toEqual({ ok: true, soLinkAnhHuong: 0 });
    expect(await db.affiliateCampaignLanding.count({ where: { campaignId: f.C1.id } })).toBe(1);
    expect(await optPhat(f, f.M1.id)).toEqual([f.LA4.id]);
    // theo TỪNG website: B của C1 không bị thu hẹp; campaign C2 (cũng gắn A) vẫn thấy đủ
    expect(await optPhat(f, f.M1.id, f.B.id)).toEqual([f.LB1.id]);
    expect(await optPhat(f, f.M2.id)).toEqual([f.LA1.id, f.LA2.id, f.LA3.id, f.LA4.id].sort());

    // phát Admin: trang LA4 được; LA3 (đã chọn khỏi campaign) và đường dẫn trùng mẫu LA3 mà không chọn id (tìm theo tên miền gốc) đều bị từ chối
    expect((await phat(f, { landingPageId: f.LA4.id, landingPath: "/khoa-hoc/ok" })).ok).toBe(true);
    expect((await phat(f, { landingPageId: f.LA3.id, landingPath: "/giai-dau/x" })).ok).toBe(false);
    expect((await phat(f, { landingPath: "/" })).ok).toBe(false); // «/» thuộc LA1 — không nằm trong lựa chọn của campaign
    // campaign C2 (không thu hẹp) vẫn phát được LA3
    expect((await phat(f, { membershipId: f.M2.id, landingPageId: f.LA3.id, landingPath: "/giai-dau/x" })).ok).toBe(true);
    // cổng đối tác: chỉ thấy LA4 ở C1; gửi id LA2 (bị loại) ⇒ từ chối
    dangNhap(f.u1.id);
    const cong = await docGioiThieuCuaToi(f.u1.id, NOW);
    const m1 = cong!.taoLink.chuongTrinh.find((c) => c.membershipId === f.M1.id)!;
    // C1 × A chỉ còn LA4 (tiền tố `*`) mà cổng đối tác chỉ cho trang «đúng» ⇒ website A không còn trang nào để chọn ⇒ biến khỏi ô chọn; B (không thu hẹp) vẫn còn
    expect(m1.websites.map((w) => w.siteId)).toEqual([f.B.id]);
    expect((await taoLinkCuaToiAction({ membershipId: f.M1.id, siteId: f.A.id, landingPageId: f.LA2.id, landingPath: "/" })).ok).toBe(false);

    // chọn id không thuộc website / trang đang tắt ⇒ từ chối, không ghi gì
    expect((await chonCamp(f, f.C1.id, [f.LB1.id])).ok).toBe(false);
    await db.affiliateLandingPage.update({ where: { id: f.LA1.id }, data: { isActive: false } });
    expect((await chonCamp(f, f.C1.id, [f.LA1.id])).ok).toBe(false);
    expect(await db.affiliateCampaignLanding.count({ where: { campaignId: f.C1.id } })).toBe(1);
    // bỏ hạn chế ⇒ tất cả (trừ trang tắt)
    expect((await chonCamp(f, f.C1.id, [])).ok).toBe(true);
    expect(await optPhat(f, f.M1.id)).toEqual([f.LA2.id, f.LA3.id, f.LA4.id].sort());
    // website chưa gắn campaign ⇒ không chọn được trang đích
    expect((await chonCamp(f, f.C2.id, [f.LB1.id], true, f.B.id)).ok).toBe(false);
  });

  it("[AFFL6-05] thu hẹp có CẢNH BÁO: từ chối kèm số link cho tới khi xác nhận; link chết qua cổng (/r · beacon · intake), KHÔNG bị xoá; bỏ hạn chế ⇒ sống lại", async () => {
    const f = await dungHienTruong();
    const covua = await phatOk(f, { landingPageId: f.LA3.id, landingPath: "/giai-dau/2027" });
    const goc = await phatOk(f, { landingPageId: f.LA4.id, landingPath: "/khoa-hoc/robot" });
    expect((await goiR(covua.publicToken)).headers.get("location")).toContain(`https://${f.phu}/giai-dau/2027`);

    // KHÔNG xác nhận ⇒ từ chối kèm đúng 1 link bị ảnh hưởng; DB không đổi
    const hoi = await chonCamp(f, f.C1.id, [f.LA4.id], false);
    expect(hoi).toMatchObject({ ok: false, canXacNhan: true, soLinkAnhHuong: 1 });
    expect(await db.affiliateCampaignLanding.count({ where: { campaignId: f.C1.id } })).toBe(0);
    // thu hẹp KHÔNG làm chết link nào (LA4 vẫn trong lựa chọn của link `goc`) thì không cần xác nhận — chọn thêm LA3 giữ cả hai
    expect((await chonCamp(f, f.C1.id, [f.LA3.id, f.LA4.id], false)).ok).toBe(true);
    // đã xác nhận nhưng KHÔNG có lý do (hoặc quá ngắn) ⇒ từ chối, DB không đổi; đối chứng dương ngay dưới: có lý do thì thu hẹp
    expect(await chonCamp(f, f.C1.id, [f.LA4.id], true, f.A.id, null)).toMatchObject({ ok: false, truong: "lyDo" });
    expect(await chonCamp(f, f.C1.id, [f.LA4.id], true, f.A.id, "ngắn")).toMatchObject({ ok: false, truong: "lyDo" });
    expect((await db.affiliateCampaignLanding.findMany({ where: { campaignId: f.C1.id }, select: { landingPageId: true } })).map((x) => x.landingPageId).sort()).toEqual([f.LA3.id, f.LA4.id].sort());
    // xác nhận + lý do ⇒ thu hẹp thật
    expect(await chonCamp(f, f.C1.id, [f.LA4.id], true)).toEqual({ ok: true, soLinkAnhHuong: 1 });

    // link `covua`: ACTIVE nguyên, nhưng qua cổng thì chết — /r ghi lượt bấm TRANG_DICH_KHONG_CON, không cookie, không gắn aff/cmp
    const clickTruoc = (await click(covua.id)).length;
    const r = await goiR(covua.publicToken);
    expect(r.headers.get("location")).not.toContain("aff=");
    expect(r.headers.get("set-cookie") ?? "").not.toContain("sr_aff=");
    const sau = await click(covua.id);
    expect(sau).toHaveLength(clickTruoc + 1);
    expect(sau.at(-1)!.outcome).toBe("TRANG_DICH_KHONG_CON");
    expect((await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: covua.id } })).status).toBe("ACTIVE");
    // đối chứng dương: link `goc` vẫn chạy
    expect((await goiR(goc.publicToken)).headers.get("location")).toContain("aff=");

    // beacon từ trang trên tên miền covua: không ghi gì (URL không còn khớp trang đích nằm trong lựa chọn của campaign)
    const beacon = await xuLyBeacon({ thanTho: JSON.stringify({ v: 1, token: covua.publicToken, landingUrl: `https://${f.phu}/giai-dau/2027` }), origin: `https://${f.phu}`, ip: "10.5.5.5", cookiePhien: null }, deps());
    expect(beacon.ketCuc).toBe("KHONG_GHI");
    // intake từ tên miền covua cho link đã bị thu hẹp ⇒ KHÔNG thành referral hợp lệ (nhưng khách vẫn được lưu)
    const { kq, sdt } = await guiIntake(covua.publicToken, `https://${f.phu}`);
    expect(kq.status).toBe(200);
    const lead = await db.lead.findFirst({ where: { phone: { in: bienThe(sdt) }, deletedAt: null }, select: { id: true } });
    expect(lead).not.toBeNull();
    const rf = await db.affiliateReferral.findFirst({ where: { leadId: lead!.id } });
    expect(rf?.status ?? "KHONG_CO").not.toBe("VALID");

    // bỏ hạn chế ⇒ link sống lại (đối chứng: nó chưa từng bị thu hồi)
    expect((await chonCamp(f, f.C1.id, [])).ok).toBe(true);
    expect((await goiR(covua.publicToken)).headers.get("location")).toContain(`https://${f.phu}/giai-dau/2027?aff=`);
  });

  it("[AFFL6-06] gỡ website khỏi campaign ⇒ xoá lựa chọn trang đích của website đó; gắn lại KHÔNG «sống lại» lựa chọn cũ", async () => {
    const f = await dungHienTruong();
    expect((await chonCamp(f, f.C1.id, [f.LA4.id])).ok).toBe(true);
    expect((await chonCamp(f, f.C1.id, [f.LB1.id], true, f.B.id)).ok).toBe(true);
    expect(await db.affiliateCampaignLanding.count({ where: { campaignId: f.C1.id } })).toBe(2);
    const go = await goWebsite({ nguoi: NGUOI, campaignId: f.C1.id, siteId: f.A.id, lyDo: null, now: NOW });
    expect(go.ok).toBe(true);
    // chỉ lựa chọn của A bị xoá; của B còn nguyên (đối chứng)
    expect((await db.affiliateCampaignLanding.findMany({ where: { campaignId: f.C1.id }, select: { landingPageId: true } })).map((x) => x.landingPageId)).toEqual([f.LB1.id]);
    expect((await ganWebsite({ nguoi: NGUOI, campaignId: f.C1.id, siteId: f.A.id, now: NOW })).ok).toBe(true);
    expect(await optPhat(f, f.M1.id)).toEqual([f.LA1.id, f.LA2.id, f.LA3.id, f.LA4.id].sort());
  });

  it("[AFFL6-07] tắt trang đích / tắt theo dõi RIÊNG trang ⇒ không phát mới, link cũ chết qua cổng, báo số link ảnh hưởng, lịch sử giữ; website vẫn bật; bật lại ⇒ sống lại", async () => {
    const f = await dungHienTruong();
    const covua = await phatOk(f, { landingPageId: f.LA3.id, landingPath: "/giai-dau/2027" });
    const goc = await phatOk(f, { landingPageId: f.LA4.id, landingPath: "/khoa-hoc/robot" });
    const lay = () => db.affiliateLandingPage.findUniqueOrThrow({ where: { id: f.LA3.id } });

    // tắt THEO DÕI riêng LA3 (website bật, LA3 bật)
    const t1 = await suaTrangDich({ nguoi: NGUOI, id: f.LA3.id, updatedAtDaThay: (await lay()).updatedAt, vao: { trackingEnabled: false }, lyDo: null });
    expect(t1).toMatchObject({ ok: true, soLinkAnhHuong: 1 });
    expect((await phat(f, { landingPageId: f.LA3.id, landingPath: "/giai-dau/y" })).ok).toBe(false);
    expect(await optPhat(f, f.M1.id)).not.toContain(f.LA3.id);
    const r = await goiR(covua.publicToken);
    expect(r.headers.get("location")).not.toContain("aff=");
    expect((await click(covua.id)).at(-1)!.outcome).toBe("TRANG_DICH_KHONG_CON");
    expect((await goiR(goc.publicToken)).headers.get("location")).toContain("aff="); // trang khác không ảnh hưởng
    // bật lại ⇒ sống lại
    const t2 = await suaTrangDich({ nguoi: NGUOI, id: f.LA3.id, updatedAtDaThay: (await lay()).updatedAt, vao: { trackingEnabled: true }, lyDo: null });
    expect(t2).toMatchObject({ ok: true, soLinkAnhHuong: 0 });
    expect((await goiR(covua.publicToken)).headers.get("location")).toContain("aff=");

    // TẮT hẳn trang đích ⇒ báo 1 link, chết qua cổng; link vẫn ACTIVE (lịch sử giữ)
    const t3 = await batTatTrangDich({ nguoi: NGUOI, id: f.LA3.id, updatedAtDaThay: (await lay()).updatedAt, den: false, lyDo: null });
    expect(t3).toMatchObject({ ok: true, soLinkAnhHuong: 1 });
    expect((await phat(f, { landingPageId: f.LA3.id, landingPath: "/giai-dau/z" })).ok).toBe(false);
    expect((await goiR(covua.publicToken)).headers.get("location")).not.toContain("aff=");
    expect((await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: covua.id } })).status).toBe("ACTIVE");
    // ĐỔI tên miền của trang đích về mặc định cũng làm chết link ở tên miền cũ và được báo
    await batTatTrangDich({ nguoi: NGUOI, id: f.LA3.id, updatedAtDaThay: (await lay()).updatedAt, den: true, lyDo: null });
    const t4 = await suaTrangDich({ nguoi: NGUOI, id: f.LA3.id, updatedAtDaThay: (await lay()).updatedAt, vao: { host: null }, lyDo: null });
    expect(t4).toMatchObject({ ok: true, soLinkAnhHuong: 1 });
    expect(await lay()).toMatchObject({ host: null, hostKey: "" });
  });

  it("[AFFL6-08] sửa website không được gỡ tên miền đang là host của một trang đích (và không đổi gốc URL sang host riêng của trang đích)", async () => {
    const f = await dungHienTruong();
    const lay = () => db.affiliateSite.findUniqueOrThrow({ where: { id: f.A.id } });
    const goHost = await suaWebsite({ nguoi: NGUOI, id: f.A.id, updatedAtDaThay: (await lay()).updatedAt, vao: { allowedDomains: [f.goc] }, lyDo: null });
    expect(goHost.ok).toBe(false);
    if (!goHost.ok) expect(goHost.truong).toBe("allowedDomains");
    // đổi gốc URL sang tên miền covua (đang là host riêng của LA2/LA3) ⇒ từ chối
    const doiGoc = await suaWebsite({ nguoi: NGUOI, id: f.A.id, updatedAtDaThay: (await lay()).updatedAt, vao: { baseUrl: `https://${f.phu}` }, lyDo: null });
    expect(doiGoc.ok).toBe(false);
    expect((await lay()).allowedDomains).toEqual([f.goc, f.phu]);
    // đối chứng dương: thêm tên miền mới vào danh sách thì được
    const them = await suaWebsite({ nguoi: NGUOI, id: f.A.id, updatedAtDaThay: (await lay()).updatedAt, vao: { allowedDomains: [f.goc, f.phu, `moi.${f.goc}`] }, lyDo: null });
    expect(them.ok).toBe(true);
    // chuyển hết trang đích khỏi covua rồi mới gỡ được
    await db.affiliateLandingPage.deleteMany({ where: { siteId: f.A.id, host: f.phu } });
    const goHost2 = await suaWebsite({ nguoi: NGUOI, id: f.A.id, updatedAtDaThay: (await lay()).updatedAt, vao: { allowedDomains: [f.goc] }, lyDo: null });
    expect(goHost2.ok).toBe(true);
  });

  it("[AFFL6-09] trigger bất biến: landingHost đã có không đổi; landingPageId NULL→giá trị được, đổi sang giá trị khác thì không; xoá trang đích ⇒ về NULL không vướng trigger", async () => {
    const f = await dungHienTruong();
    const a = await phatOk(f, { landingPageId: f.LA3.id, landingPath: "/giai-dau/2027" });
    await expect(db.affiliateTrackingAsset.update({ where: { id: a.id }, data: { landingHost: f.goc } })).rejects.toThrow(/định danh của link không đổi/);
    await expect(db.affiliateTrackingAsset.update({ where: { id: a.id }, data: { landingPageId: f.LA4.id } })).rejects.toThrow(/định danh của link không đổi/);
    // vẫn thu hồi được (trigger cũ không bị làm hỏng) và nhãn đổi được
    await expect(db.affiliateTrackingAsset.update({ where: { id: a.id }, data: { label: "Poster" } })).resolves.toBeTruthy();

    // link CŨ (chưa snapshot): NULL → giá trị được phép một lần; sau đó khoá
    const cu = await db.affiliateTrackingAsset.create({ data: { partyId: f.P1.id, membershipId: f.M1.id, campaignId: f.C1.id, siteId: f.A.id, landingPath: "/khoa-hoc/cu", publicToken: "A6B6C6D6E6" } });
    await expect(db.affiliateTrackingAsset.update({ where: { id: cu.id }, data: { landingPageId: f.LA4.id } })).resolves.toBeTruthy();
    await expect(db.affiliateTrackingAsset.update({ where: { id: cu.id }, data: { landingPageId: f.LA1.id } })).rejects.toThrow(/định danh của link không đổi/);

    // xoá dòng trang đích (đường tắt của DB) ⇒ FK SET NULL chạy qua trigger mà không bị chặn
    await db.affiliateCampaignLanding.deleteMany({ where: { landingPageId: f.LA3.id } });
    await db.affiliateLandingPage.delete({ where: { id: f.LA3.id } });
    expect((await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: a.id } })).landingPageId).toBeNull();
  });

  it("[AFFL6-10] backfill của migration: chỉ gán khi khớp DUY NHẤT; mơ hồ / không khớp ⇒ NULL; chạy lại không đổi gì; không chạm link đã có snapshot", async () => {
    const f = await dungHienTruong();
    // site C: «/a» chính xác + «/*» tiền tố ⇒ đường dẫn /a khớp HAI trang (mơ hồ)
    const C = await db.affiliateSite.create({ data: { code: `${P}_C${f.h}`, name: `Web C ${P}`, baseUrl: `https://c-${f.h.toLowerCase()}.example.test`, allowedDomains: [`c-${f.h.toLowerCase()}.example.test`] } });
    const lc1 = await db.affiliateLandingPage.create({ data: { siteId: C.id, pathPattern: "/a" } });
    await db.affiliateLandingPage.create({ data: { siteId: C.id, pathPattern: "/*" } });
    await db.affiliateCampaignSite.create({ data: { campaignId: f.C1.id, siteId: C.id } });
    let tk = 0;
    const tao = (siteId: string, landingPath: string) =>
      db.affiliateTrackingAsset.create({ data: { partyId: f.P1.id, membershipId: f.M1.id, campaignId: f.C1.id, siteId, landingPath, publicToken: `A6B6C6D6${String(10 + (tk += 1)).slice(-2)}`.replace(/[IOLU]/g, "7") } });
    const duyNhat = await tao(f.A.id, "/khoa-hoc/robot"); // chỉ LA4 (tiền tố, tên miền gốc) khớp — LA2/LA3 ở covua KHÔNG tính
    const goc = await tao(f.A.id, "/"); // «/» chính xác ở tên miền gốc: LA1 (LA2 cùng «/» nhưng ở covua)
    const mo = await tao(C.id, "/a"); // /a khớp «/a» VÀ «/*» ⇒ mơ hồ
    const khongKhop = await tao(f.A.id, "/khong-co"); // không trang nào
    const daCo = await db.affiliateTrackingAsset.create({ data: { partyId: f.P1.id, membershipId: f.M1.id, campaignId: f.C1.id, siteId: f.A.id, landingPath: "/khoa-hoc/x", publicToken: "A6B6C6D6E7", landingHost: f.goc, landingPageId: f.LA4.id } });

    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026143000_affiliate_da_website_landing/migration.sql"), "utf8");
    const i = sql.indexOf('UPDATE "AffiliateTrackingAsset" AS a');
    expect(i).toBeGreaterThan(0);
    const lenh = sql.slice(i);
    await db.$executeRaw(Prisma.raw(lenh));
    const doc = async () => Object.fromEntries((await db.affiliateTrackingAsset.findMany({ where: { partyId: f.P1.id }, select: { id: true, landingPageId: true } })).map((x) => [x.id, x.landingPageId]));
    const sau = await doc();
    expect(sau[duyNhat.id]).toBe(f.LA4.id);
    expect(sau[goc.id]).toBe(f.LA1.id);
    expect(sau[mo.id]).toBeNull(); // mơ hồ ⇒ không đoán
    expect(sau[khongKhop.id]).toBeNull();
    expect(sau[daCo.id]).toBe(f.LA4.id); // đã có ⇒ giữ
    void lc1;
    // chạy lại: không đổi
    await db.$executeRaw(Prisma.raw(lenh));
    expect(await doc()).toEqual(sau);
    // và backfill KHÔNG ghi tên miền (landingHost còn NULL ⇒ link cũ tiếp tục đi về tên miền của website)
    expect((await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: duyNhat.id } })).landingHost).toBeNull();
  });

  it("[AFFL6-11] xoay mã giữ nguyên tên miền + trang đích; link CŨ (chưa có snapshot) vẫn chạy về tên miền của website", async () => {
    const f = await dungHienTruong();
    const a = await phatOk(f, { landingPageId: f.LA3.id, landingPath: "/giai-dau/2027" });
    const x = await xoayLink({ nguoi: NGUOI, id: a.id, updatedAtDaThay: a.updatedAt, lyDo: "Xoay mã để thử AL6", now: NOW });
    if (!x.ok) throw new Error(x.loi);
    const moi = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: x.id } });
    expect([moi.landingHost, moi.landingPageId, moi.landingPath]).toEqual([f.phu, f.LA3.id, "/giai-dau/2027"]);
    expect((await goiR(moi.publicToken)).headers.get("location")).toContain(`https://${f.phu}/giai-dau/2027?aff=${moi.publicToken}`);
    expect((await goiR(a.publicToken)).headers.get("location")).not.toContain("aff="); // link cũ đã thu hồi

    // link CŨ trước AFF-L6: không snapshot ⇒ tên miền của website (gốc), đúng nơi nó vẫn luôn chuyển tới
    const cu = await db.affiliateTrackingAsset.create({ data: { partyId: f.P1.id, membershipId: f.M1.id, campaignId: f.C1.id, siteId: f.A.id, landingPath: "/khoa-hoc/cu", publicToken: "A6B6C6D6E8" } });
    expect((await goiR(cu.publicToken)).headers.get("location")!.startsWith(`https://${f.goc}/khoa-hoc/cu?aff=A6B6C6D6E8&cmp=${f.C1.code}&clk=`)).toBe(true);
    // xoay link cũ ⇒ link mới được chụp tên miền của website
    const x2 = await xoayLink({ nguoi: NGUOI, id: cu.id, updatedAtDaThay: cu.updatedAt, lyDo: "Xoay link cũ để thử AL6", now: NOW });
    if (!x2.ok) throw new Error(x2.loi);
    expect(await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: x2.id } })).toMatchObject({ landingHost: f.goc, landingPageId: f.LA4.id });
  });
});
