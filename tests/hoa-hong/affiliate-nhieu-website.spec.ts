// @vitest-environment node
/**
 * [AFF-WEB-*] — AFFILIATE NHIỀU WEBSITE trên Postgres THẬT (AFF-WEB; docs/affiliate/tich-hop-landing-ngoai.md).
 *
 * Đặc tả gốc của bộ AFF-WEB-01..10 KHÔNG nằm trong repo; các mã dưới đây ánh xạ từ nội dung task (ghi trong báo cáo đợt). Quyết định: trang đích thuộc WEBSITE, campaign giới hạn theo website —
 * KHÔNG có `allowedLandingPageIds` theo campaign.
 *
 *   [AFF-WEB-01] cổng đối tác chỉ thấy chương trình (membership ĐANG HOẠT ĐỘNG, campaign đang chạy) của CHÍNH MÌNH
 *   [AFF-WEB-02] website chỉ gồm site ACTIVE ∧ bật theo dõi ∧ ĐÃ GẮN campaign đang chọn
 *   [AFF-WEB-03] trang đích chỉ gồm trang đang bật và KHÔNG có `*` (đối chứng: màn Admin vẫn thấy trang tiền tố)
 *   [AFF-WEB-04] cổng server tự kiểm lại — không tin id client: membership người khác, website không gắn, wildcard, trang tắt, khoá lạ, sai vai, không phải đối tác, cờ tắt
 *   [AFF-WEB-04c] tài khoản vào đối tác qua bảng nối (AFF-L3a): ACTIVE tạo được, tạm ngừng / gỡ thì hết
 *   [AFF-WEB-04b] nút «Link» của đối tác: URL cuối của link đang dùng; không quyền ⇒ Map rỗng
 *   [AFF-WEB-05] MỘT đường ghi: `phatLink` (đối tác suy từ DB, loại LINK, nhật ký cùng giao dịch) + hạn mức link/membership giữ nguyên
 *   [AFF-WEB-06] một đối tác ≥ 2 link ở ≥ 2 website khác nhau (cổng + Admin); danh sách hiện đúng website/trang đích/URL cuối; `/r/<token>` chuyển đúng domain + đường dẫn
 *   [AFF-WEB-06b] cột Referral: Admin đếm referral HỢP LỆ của từng link; cổng đối tác đếm MỌI lượt gửi (R10 · D1)
 *   [AFF-WEB-07] tắt website ⇒ không tạo link mới, click mới bị chặn (ghi lượt bấm không hợp lệ, không cookie), lịch sử giữ nguyên; tắt theo dõi cũng vậy
 *   [AFF-WEB-08] intake từ host website ngoài (quatang.edu.vn · covua.quatang.edu.vn) với token hợp lệ ⇒ lead mang attribution ĐÚNG đối tác/campaign/link; Origin lạ ⇒ chờ xem xét; khoá client cấm ⇒ 400
 *   [AFF-WEB-09] nguồn lead theo CAMPAIGN, không theo website: cùng đối tác, hai campaign khác nguồn ⇒ hai nguồn khác; cùng campaign qua hai website ⇒ cùng nguồn
 *   [AFF-WEB-11] quyền của hai action cổng đối tác = SỞ HỮU hồ sơ (không so vai): ma trận vai × có/không hồ sơ cho tạo link + QR, cờ tắt, đối tác tạm ngừng; ca từ chối không ghi gì
 *   (AFF-WEB-10 là lưới ghim mã nguồn: `lib/affiliate/khong-ten-mien-cung.test.ts`)
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng fixture, chạy ĐƯỢC MỘT MÌNH. LUẬT 19: đồng hồ TIÊM (`NOW`); `Date.now()` chỉ là hậu tố mã duy nhất.
 * AN TOÀN DB: không `resetDb()` — dọn THEO TIỀN TỐ `AWM`; `assertTestDb` + cổng địa chỉ riêng (Postgres trên máy này, không phải DB của dev server).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const PHIEN = vi.hoisted(() => ({ session: null as null | { user: { id: string; role: string; name?: string } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => PHIEN.session }));
// `revalidatePath` cần ngữ cảnh Next đang chạy; phần còn lại của `next/cache` (unstable_cache của đọc cờ) giữ nguyên.
vi.mock("next/cache", async (goc) => ({ ...(await goc<typeof import("next/cache")>()), revalidatePath: () => undefined }));
vi.setConfig({ testTimeout: 90_000 });

import { taoLinkCuaToiAction, taoQrCuaToiAction } from "../../app/(portal)/portal/gioi-thieu/_actions";
import { docGioiThieuCuaToi } from "../../lib/affiliate/doc-cua-toi";
import { docDanhSachLink, docLinkDangDungTheoDoiTac, docTuyChonPhatLink } from "../../lib/affiliate/doc-link";
import { phatLink, thuHoiLink } from "../../lib/affiliate/ghi-link";
import { doiTrangThaiWebsite } from "../../lib/affiliate/ghi-website";
import { xuLyIntakeGioiThieu } from "../../lib/affiliate/intake-cong-khai";
import { xuLyBamLink, type PhuThuoc } from "../../lib/affiliate/theo-doi-cong-khai";
import { sinhToken } from "../../lib/affiliate/token";
import { db } from "../../lib/db";
import { laDbCucBo } from "../../lib/security/url-db-cuc-bo";
import { clearSettingsCache } from "../../lib/settings/service";
import { LY_DO_BO_QUA, RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";

if (!RUN_DB_TESTS) console.warn(`[AFF-WEB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "AWM";
const NOW = new Date("2026-10-05T03:00:00.000Z");
const GOC = "https://test.satarobo.vn";
const NGUOI = { userId: "awm-admin", ten: "Admin AWM" };
const TAT_CA = { partyIds: null, chiTrangChinhXac: false } as const;
/** Tên người trong phiên giả — nhật ký do cổng đối tác ghi mang tên này, dọn theo nó. */
const TEN_PHIEN = "Đối tác thử AWM";

let dem = 0;
const hau = () => `${Date.now().toString(36).toUpperCase()}${(dem += 1)}`;
let sdtSeq = 0;
const sdtMoi = () => `09${String(((Date.now() % 90_000_000) + 1_000_000 + (sdtSeq += 7)) % 100_000_000).padStart(8, "0")}`;
const bienThe = (s: string) => [s, `84${s.slice(1)}`];
let ipSeq = 0;

async function assertDbThu(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!laDbCucBo(url)) throw new Error("[AFF-WEB] TỪ CHỐI: DATABASE_URL không trỏ Postgres cục bộ (hoặc là tunnel VPS).");
  const r = await db.$queryRaw<{ ten: string }[]>`select current_database() as ten`;
  const ten = r[0]?.ten ?? "";
  if (/^(satarobo_local|satarobo_dev)/.test(ten)) throw new Error(`[AFF-WEB] TỪ CHỐI: database "${ten}" là DB đang phục vụ dev server.`);
}

async function don(): Promise<void> {
  const ds = await db.affiliate.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const ids = ds.map((x) => x.id);
  const camp = await db.affiliateCampaign.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const cid = camp.map((c) => c.id);
  // Lead do intake sinh ra: attribution/touchpoint trỏ nhóm nguồn của fixture (FK Restrict) nên phải gỡ TRƯỚC khi xoá nhóm; lead giữ lại nhưng xoá mềm.
  await db.leadAttribution.deleteMany({ where: { lead: { parentName: { startsWith: P } } } });
  await db.leadTouchpoint.deleteMany({ where: { lead: { parentName: { startsWith: P } } } });
  await db.affiliateReferral.deleteMany({ where: { OR: [{ partyId: { in: ids } }, { campaignId: { in: cid } }] } });
  await db.lead.updateMany({ where: { parentName: { startsWith: P } }, data: { deletedAt: new Date() } });
  // `ReferralClick` là sổ CHỈ-THÊM (trigger chặn sửa/xoá): tắt trigger trong MỘT transaction rồi bật lại — cùng cách `donAffiliateFx`.
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`ALTER TABLE "ReferralClick" DISABLE TRIGGER "ReferralClick_chi_them"`;
    await tx.referralClick.deleteMany({ where: { OR: [{ partyId: { in: ids } }, { campaignId: { in: cid } }] } });
    await tx.$executeRaw`ALTER TABLE "ReferralClick" ENABLE TRIGGER "ReferralClick_chi_them"`;
  });
  await db.auditLog.deleteMany({ where: { OR: [{ actorName: { in: [NGUOI.ten, TEN_PHIEN] } }, { actorId: { startsWith: "awm-" } }] } });
  await db.affiliateTrackingAsset.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliatePartyUser.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliateMembership.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliateCampaignRule.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaignSite.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaign.deleteMany({ where: { id: { in: cid } } });
  await db.affiliateSite.deleteMany({ where: { code: { startsWith: P } } });
  await db.affiliatePartyTag.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliate.deleteMany({ where: { id: { in: ids } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: P } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: "awm-" } } });
}

async function batCo(bat: boolean): Promise<void> {
  await db.systemSetting.deleteMany({ where: { key: "affiliate.enabled" } });
  await datCoNguon({ ...CO_NGUON_DAY_DU, enabled: true }, { "affiliate.enabled": bat });
}

const taoSite = (h: string, ma: string, p: { baseUrl: string; domains: string[]; status?: "ACTIVE" | "INACTIVE"; tracking?: boolean; trang: { p: string; on?: boolean; label?: string }[] }) =>
  db.affiliateSite.create({
    data: {
      code: `${P}_${ma}${h}`,
      name: `Web ${ma} ${P} ${h}`,
      baseUrl: p.baseUrl,
      allowedDomains: p.domains,
      status: p.status ?? "ACTIVE",
      trackingEnabled: p.tracking ?? true,
      landingPages: { create: p.trang.map((t) => ({ pathPattern: t.p, isActive: t.on ?? true, label: t.label ?? null })) },
    },
  });

type Fx = Awaited<ReturnType<typeof dungHienTruong>>;

/**
 * Hai đối tác (P1 ↔ u1, P2 ↔ u2) và bốn campaign: C1 (nguồn NA) gắn A·B·X(ngừng)·Z(tắt theo dõi) — C2 (nguồn NB) gắn B — C3 (TẠM DỪNG) gắn A.
 *   A = quatang.edu.vn (+ covua.quatang.edu.vn): «/khoa-robot» bật · «/khoa-hoc/*» bật (TIỀN TỐ) · «/tam-tat» TẮT
 *   B = test.satarobo.vn: «/khoa-hoc/robot» bật
 *   X = website NGỪNG · Y = website bật nhưng KHÔNG gắn campaign nào · Z = bật nhưng TẮT theo dõi
 * Membership: P1 ∈ C1 (M1) · C2 (M2) · C3 (M3, campaign tạm dừng); P2 ∈ C1 (N1).
 */
async function dungHienTruong() {
  const h = hau();
  const grp = (ma: string) => db.leadSourceGroup.create({ data: { code: `${P}_${ma}${h}`, name: `Nguồn ${ma} ${P} ${h}`, sourceType: "PARTNER", referrerRequirement: "NONE", sortOrder: 900, status: "ACTIVE", selectable: true, commissionEnabled: true } });
  const nA = await grp("NA");
  const nB = await grp("NB");
  const A = await taoSite(h, "A", { baseUrl: "https://quatang.edu.vn", domains: ["quatang.edu.vn", "covua.quatang.edu.vn"], trang: [{ p: "/khoa-robot", label: "Khoá robot" }, { p: "/khoa-hoc/*" }, { p: "/tam-tat", on: false }] });
  const B = await taoSite(h, "B", { baseUrl: "https://test.satarobo.vn", domains: ["test.satarobo.vn"], trang: [{ p: "/khoa-hoc/robot" }] });
  const X = await taoSite(h, "X", { baseUrl: `https://awm-x-${h.toLowerCase()}.example.test`, domains: [`awm-x-${h.toLowerCase()}.example.test`], status: "INACTIVE", trang: [{ p: "/x" }] });
  const Y = await taoSite(h, "Y", { baseUrl: `https://awm-y-${h.toLowerCase()}.example.test`, domains: [`awm-y-${h.toLowerCase()}.example.test`], trang: [{ p: "/y" }] });
  const Z = await taoSite(h, "Z", { baseUrl: `https://awm-z-${h.toLowerCase()}.example.test`, domains: [`awm-z-${h.toLowerCase()}.example.test`], tracking: false, trang: [{ p: "/z" }] });
  const camp = (ma: string, nhom: string, sites: string[], status: "ACTIVE" | "PAUSED" = "ACTIVE") =>
    db.affiliateCampaign.create({
      data: { code: `${P}_${ma}${h}`, name: `Campaign ${ma} ${P} ${h}`, status, cookieWindowDays: 30, protectWindowDays: 90, defaultSourceGroupId: nhom, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), sites: { create: sites.map((siteId) => ({ siteId })) } },
    });
  const C1 = await camp("C1", nA.id, [A.id, B.id, X.id, Z.id]);
  const C2 = await camp("C2", nB.id, [B.id]);
  const C3 = await camp("C3", nA.id, [A.id], "PAUSED");
  const loai = await db.affiliateType.create({ data: { code: `${P}_T${h}`, name: `Loại ${P} ${h}` } });
  const u1 = await seedUser({ email: `awm-u1-${h.toLowerCase()}@ci.test`, role: "PARENT", name: `PH AWM Một ${h}`, phone: null });
  const u2 = await seedUser({ email: `awm-u2-${h.toLowerCase()}@ci.test`, role: "PARENT", name: `PH AWM Hai ${h}`, phone: null });
  const dt = (ma: string, userId: string) => db.affiliate.create({ data: { code: `${P}_${ma}${h}`, name: `Đối tác ${ma} ${P} ${h}`, status: "ACTIVE", isActive: true, typeId: loai.id, userId, phone: "0988777666", email: `dt.${ma.toLowerCase()}.${h.toLowerCase()}@awm.example.com` } });
  const P1 = await dt("P1", u1.id);
  const P2 = await dt("P2", u2.id);
  const mem = (partyId: string, campaignId: string) => db.affiliateMembership.create({ data: { partyId, campaignId, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  const M1 = await mem(P1.id, C1.id);
  const M2 = await mem(P1.id, C2.id);
  const M3 = await mem(P1.id, C3.id);
  const N1 = await mem(P2.id, C1.id);
  return { h, nA, nB, A, B, X, Y, Z, C1, C2, C3, loai, u1, u2, P1, P2, M1, M2, M3, N1 };
}

const demLink = (partyId: string) => db.affiliateTrackingAsset.count({ where: { partyId } });
const vao = (f: Fx, p: Partial<{ membershipId: string; siteId: string; landingPath: string }> = {}) => ({ membershipId: f.M1.id, siteId: f.A.id, landingPath: "/khoa-robot", ...p });
const dangNhap = (userId: string, role = "PARENT") => {
  PHIEN.session = { user: { id: userId, role, name: TEN_PHIEN } };
};

const deps = (): PhuThuoc => ({ client: db, now: () => NOW, goc: GOC, choPhepTanSuat: async () => true, khoaHmac: () => "k".repeat(32), sinhMaPhien: () => "0123456789abcdef0123456789abcdef" });
const bam = (token: string) => xuLyBamLink({ tokenTho: token, ip: "10.1.1.1", query: {}, cookiePhien: null, referer: null }, deps());

async function guiIntake(token: string, origin: string | null, them: Record<string, unknown> = {}) {
  ipSeq += 1;
  const sdt = sdtMoi();
  const kq = await xuLyIntakeGioiThieu(
    {
      thanTho: JSON.stringify({ v: 1, token, idempotencyKey: `awm-${hau().toLowerCase()}-${ipSeq}-xx`, parentName: `${P} PH ${hau()}`, phone: sdt, children: [{ fullName: `${P} Bé` }], consentMarketing: true, ...them }),
      origin,
      ip: `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`,
      userAgent: null,
    },
    { now: () => NOW, choPhepTanSuat: async () => true, cho: async () => {}, nhieuMs: () => 0 },
  );
  return { kq, sdt };
}
const leadTheoSdt = (sdt: string) => db.lead.findFirst({ where: { phone: { in: bienThe(sdt) }, deletedAt: null }, select: { id: true } });

describe.skipIf(!RUN_DB_TESTS)("[AFF-WEB] affiliate nhiều website — Postgres thật", () => {
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

  it("[AFF-WEB-01] cổng đối tác chỉ thấy chương trình của CHÍNH MÌNH: membership đang hoạt động ∧ campaign đang chạy; của người khác / campaign tạm dừng / membership tạm ngưng ⇒ không có", async () => {
    const f = await dungHienTruong();
    const a = await docGioiThieuCuaToi(f.u1.id, NOW);
    const b = await docGioiThieuCuaToi(f.u2.id, NOW);
    // đối chứng dương: mỗi người thấy ĐÚNG phần của mình (M3 thuộc campaign TẠM DỪNG nên không có)
    expect(a!.taoLink.chuongTrinh.map((c) => c.membershipId).sort()).toEqual([f.M1.id, f.M2.id].sort());
    expect(b!.taoLink.chuongTrinh.map((c) => c.membershipId)).toEqual([f.N1.id]);
    // đối chứng ÂM hai chiều
    expect(JSON.stringify(a)).not.toContain(f.N1.id);
    expect(JSON.stringify(b)).not.toContain(f.M1.id);
    expect(JSON.stringify(b)).not.toContain(f.M2.id);
    expect(JSON.stringify(a)).not.toContain(f.M3.id);

    // membership TẠM NGƯNG ⇒ biến mất khỏi ô chọn (đối chứng: trước đó có)
    await db.affiliateMembership.update({ where: { id: f.M2.id }, data: { status: "SUSPENDED" } });
    const sau = await docGioiThieuCuaToi(f.u1.id, NOW);
    expect(sau!.taoLink.chuongTrinh.map((c) => c.membershipId)).toEqual([f.M1.id]);
  });

  it("[AFF-WEB-02] website chỉ gồm site ACTIVE ∧ bật theo dõi ∧ ĐÃ GẮN campaign: theo từng campaign", async () => {
    const f = await dungHienTruong();
    const a = await docGioiThieuCuaToi(f.u1.id, NOW);
    const ct = (id: string) => a!.taoLink.chuongTrinh.find((c) => c.membershipId === id)!;
    // C1 gắn A·B·X·Z nhưng X ngừng, Z tắt theo dõi; Y bật nhưng KHÔNG gắn campaign nào ⇒ chỉ A và B
    expect(ct(f.M1.id).websites.map((w) => w.host).sort()).toEqual(["quatang.edu.vn", "test.satarobo.vn"]);
    // C2 chỉ gắn B (đối chứng: danh sách website ĐỔI theo campaign)
    expect(ct(f.M2.id).websites.map((w) => w.host)).toEqual(["test.satarobo.vn"]);
    const host = JSON.stringify(a);
    for (const loai of [f.X, f.Y, f.Z]) expect(host, loai.code).not.toContain(loai.baseUrl.replace("https://", ""));

    // ngừng A ⇒ A biến khỏi ô chọn C1 (đối chứng dương: B còn)
    await db.affiliateSite.update({ where: { id: f.A.id }, data: { status: "INACTIVE" } });
    const sau = await docGioiThieuCuaToi(f.u1.id, NOW);
    expect(sau!.taoLink.chuongTrinh.find((c) => c.membershipId === f.M1.id)!.websites.map((w) => w.host)).toEqual(["test.satarobo.vn"]);
  });

  it("[AFF-WEB-03] trang đích: chỉ trang ĐANG BẬT và KHÔNG có `*` ở cổng đối tác; Admin vẫn thấy trang tiền tố (đối chứng dương)", async () => {
    const f = await dungHienTruong();
    const a = await docGioiThieuCuaToi(f.u1.id, NOW);
    const m1 = a!.taoLink.chuongTrinh.find((c) => c.membershipId === f.M1.id)!;
    const trangA = m1.websites.find((w) => w.host === "quatang.edu.vn")!.trangDich;
    expect(trangA.map((t) => t.mau)).toEqual(["/khoa-robot"]); // không «/khoa-hoc/*» (tiền tố), không «/tam-tat» (tắt)
    expect(trangA[0]).toMatchObject({ nhan: "Khoá robot", kieu: "CHINH_XAC" });
    expect(m1.websites.find((w) => w.host === "test.satarobo.vn")!.trangDich.map((t) => t.mau)).toEqual(["/khoa-hoc/robot"]);
    expect(JSON.stringify(a)).not.toContain("*");

    // đối chứng dương: màn Admin (phạm vi quản trị) thấy CẢ trang tiền tố — chỉ không thấy trang đã tắt
    const admin = await docTuyChonPhatLink(NOW, TAT_CA);
    const cuaAdmin = admin.doiTac.find((d) => d.id === f.P1.id)!.chuongTrinh.find((c) => c.membershipId === f.M1.id)!.websites.find((w) => w.host === "quatang.edu.vn")!;
    expect(cuaAdmin.trangDich.map((t) => t.mau).sort()).toEqual(["/khoa-hoc/*", "/khoa-robot"]);
    expect(cuaAdmin.trangDich.find((t) => t.mau === "/khoa-hoc/*")!.kieu).toBe("TIEN_TO");
  });

  it("[AFF-WEB-04] cổng server tự kiểm lại: mọi id/đường dẫn client gửi đều bị đối chiếu với DB — mỗi ca từ chối KHÔNG ghi gì, và có đối chứng dương", async () => {
    const f = await dungHienTruong();
    dangNhap(f.u1.id);
    const truoc = await demLink(f.P1.id);
    const truocP2 = await demLink(f.P2.id);
    const tuChoi = async (input: unknown, mong: RegExp, nhan: string) => {
      const kq = await taoLinkCuaToiAction(input);
      expect(kq.ok, nhan).toBe(false);
      if (!kq.ok) expect(kq.loi, nhan).toMatch(mong);
      expect(await demLink(f.P1.id), `${nhan}: không được ghi link cho P1`).toBe(truoc);
      expect(await demLink(f.P2.id), `${nhan}: không được ghi link cho P2`).toBe(truocP2);
    };

    await tuChoi(vao(f, { membershipId: f.N1.id }), /Không tìm thấy chương trình của bạn/, "membership của NGƯỜI KHÁC");
    await tuChoi(vao(f, { membershipId: "khong-ton-tai-123" }), /Không tìm thấy chương trình của bạn/, "membership không tồn tại (cùng câu — không dò được id)");
    await tuChoi(vao(f, { siteId: f.Y.id, landingPath: "/y" }), /không được gắn vào campaign/, "website KHÔNG gắn campaign");
    await tuChoi(vao(f, { siteId: f.X.id, landingPath: "/x" }), /./, "website đã NGỪNG");
    await tuChoi(vao(f, { siteId: f.Z.id, landingPath: "/z" }), /./, "website TẮT theo dõi");
    await tuChoi(vao(f, { landingPath: "/khoa-hoc/abc" }), /trang đích|danh sách/i, "đường dẫn chỉ khớp qua trang TIỀN TỐ (wildcard)");
    await tuChoi(vao(f, { landingPath: "/khoa-hoc/*" }), /trang đích/i, "chính mẫu wildcard");
    await tuChoi(vao(f, { landingPath: "/tam-tat" }), /danh sách|trang đích/i, "trang đích ĐÃ TẮT");
    await tuChoi(vao(f, { landingPath: "/khong-co-trang-nay" }), /danh sách|trang đích/i, "trang không tồn tại");
    await tuChoi({ ...vao(f), partyId: f.P2.id }, /./, "client gửi partyId (lược đồ strict từ chối khoá lạ)");
    await tuChoi({ ...vao(f), type: "QR" }, /./, "client gửi type");
    await tuChoi({ ...vao(f), campaignId: f.C2.id }, /./, "client gửi campaignId");

    // đối chứng dương: cùng hàm, đầu vào hợp lệ ⇒ ghi
    const ok = await taoLinkCuaToiAction(vao(f));
    expect(ok.ok).toBe(true);
    expect(await demLink(f.P1.id)).toBe(truoc + 1);

    // sai danh tính ⇒ không ghi (đối chứng: vẫn là đầu vào hợp lệ như trên)
    const truocCuoi = await demLink(f.P1.id);
    PHIEN.session = null;
    expect(await taoLinkCuaToiAction(vao(f))).toMatchObject({ ok: false, loi: "Chưa đăng nhập" });
    // quyền = DỮ LIỆU SỞ HỮU (Affiliate.userId), không so vai: người không có hồ sơ đối tác bị chặn dù vai gì
    const khac = await seedUser({ email: `awm-khac-${f.h.toLowerCase()}@ci.test`, role: "PARENT", name: "PH không phải đối tác", phone: null });
    dangNhap(khac.id);
    expect(await taoLinkCuaToiAction(vao(f))).toMatchObject({ ok: false, loi: expect.stringContaining("chưa là đối tác") });
    dangNhap(khac.id, "TEACHER");
    expect(await taoLinkCuaToiAction(vao(f))).toMatchObject({ ok: false, loi: expect.stringContaining("chưa là đối tác") });
    dangNhap(f.u1.id);
    await batCo(false);
    expect(await taoLinkCuaToiAction(vao(f))).toMatchObject({ ok: false });
    await batCo(true);
    expect(await demLink(f.P1.id)).toBe(truocCuoi);
  });

  it("[AFF-WEB-04c] tài khoản vào đối tác qua BẢNG NỐI (AFF-L3a) cũng tạo được link; bị TẠM NGỪNG / GỠ thì hết — cùng điểm vào `partyIdsVaoDuoc` với menu và trang", async () => {
    const f = await dungHienTruong();
    const u3 = await seedUser({ email: `awm-u3-${f.h.toLowerCase()}@ci.test`, role: "PARENT", name: "PH thành viên tổ chức", phone: null });
    const noi = await db.affiliatePartyUser.create({ data: { partyId: f.P2.id, userId: u3.id, role: "MEMBER", status: "ACTIVE" } });
    dangNhap(u3.id);
    const truoc = await demLink(f.P2.id);
    // thành viên ACTIVE của P2: tạo được link trên membership của P2 (N1), KHÔNG chạm được membership của P1 (M1)
    const ok = await taoLinkCuaToiAction(vao(f, { membershipId: f.N1.id }));
    expect(ok.ok).toBe(true);
    expect(await demLink(f.P2.id)).toBe(truoc + 1);
    expect(await taoLinkCuaToiAction(vao(f, { membershipId: f.M1.id }))).toMatchObject({ ok: false, loi: expect.stringContaining("Không tìm thấy chương trình của bạn") });
    const link = await db.affiliateTrackingAsset.findFirstOrThrow({ where: { partyId: f.P2.id } });
    expect(link.createdById).toBe(u3.id);
    expect(await taoQrCuaToiAction({ id: link.id })).toMatchObject({ ok: true });

    // TẠM NGỪNG ⇒ không tạo mới, không xin QR (đối chứng: ngay trước đó còn được)
    await db.affiliatePartyUser.update({ where: { id: noi.id }, data: { status: "SUSPENDED", statusReason: "Tạm ngừng để kiểm thử AWM" } });
    expect((await taoLinkCuaToiAction(vao(f, { membershipId: f.N1.id }))).ok).toBe(false);
    expect(await taoQrCuaToiAction({ id: link.id })).toMatchObject({ ok: false, truong: expect.stringMatching(/khongTimThay|quyen/) });
    expect(await demLink(f.P2.id)).toBe(truoc + 1);
    // GỠ liên kết ⇒ cũng hết
    await db.affiliatePartyUser.update({ where: { id: noi.id }, data: { status: "REVOKED", statusReason: "Gỡ liên kết để kiểm thử AWM", revokedAt: NOW } });
    expect((await taoLinkCuaToiAction(vao(f, { membershipId: f.N1.id }))).ok).toBe(false);
  });

  it("[AFF-WEB-11] quyền của HAI action cổng đối tác = SỞ HỮU hồ sơ đối tác, không so vai: ma trận vai × (có / không có hồ sơ) cho cả tạo link lẫn QR; mỗi ca từ chối không ghi gì", async () => {
    const f = await dungHienTruong();
    dangNhap(f.u1.id);
    const goc = await taoLinkCuaToiAction(vao(f));
    expect(goc.ok).toBe(true); // link sẵn của P1 để thử QR
    if (!goc.ok) return;
    const nhatKy = () => db.auditLog.count({ where: { actorName: TEN_PHIEN } });
    const dau = { p1: await demLink(f.P1.id), p2: await demLink(f.P2.id), nk: await nhatKy() };
    const khongGhi = async (nhan: string) => {
      expect(await demLink(f.P1.id), `${nhan}: link P1`).toBe(dau.p1);
      expect(await demLink(f.P2.id), `${nhan}: link P2`).toBe(dau.p2);
      expect(await nhatKy(), `${nhan}: nhật ký`).toBe(dau.nk);
    };

    // ÂM: người KHÔNG có hồ sơ đối tác — vai nào cũng bị chặn ĐÚNG CÂU «chưa là đối tác» (không phải câu của lõi), kể cả SUPER_ADMIN (không có lối tắt theo vai)
    const la = await seedUser({ email: `awm-la-${f.h.toLowerCase()}@ci.test`, role: "PARENT", name: "Người không có hồ sơ đối tác", phone: null });
    for (const vai of ["PARENT", "TEACHER", "SALES_CSM", "CENTER_MANAGER", "SUPER_ADMIN"]) {
      dangNhap(la.id, vai);
      expect(await taoLinkCuaToiAction(vao(f)), `tạo link / ${vai}`).toMatchObject({ ok: false, truong: "quyen", loi: expect.stringContaining("chưa là đối tác") });
      expect(await taoQrCuaToiAction({ id: goc.id }), `QR / ${vai}`).toMatchObject({ ok: false, truong: "quyen" });
    }
    PHIEN.session = { user: { id: la.id, name: TEN_PHIEN } } as never; // phiên KHÔNG mang vai
    expect(await taoLinkCuaToiAction(vao(f))).toMatchObject({ ok: false, truong: "quyen" });
    expect(await taoQrCuaToiAction({ id: goc.id })).toMatchObject({ ok: false, truong: "quyen" });
    await khongGhi("người không có hồ sơ");

    // ÂM: có hồ sơ nhưng của NGƯỜI KHÁC — membership / link của P1 không phải của P2 (cùng câu «không tìm thấy», không phân biệt tồn tại hay không)
    dangNhap(f.u2.id);
    expect(await taoLinkCuaToiAction(vao(f))).toMatchObject({ ok: false, truong: "membershipId" });
    expect(await taoQrCuaToiAction({ id: goc.id })).toMatchObject({ ok: false, truong: "khongTimThay" });
    expect(await taoQrCuaToiAction({ id: "khong-ton-tai-123" })).toMatchObject({ ok: false, truong: "khongTimThay" });
    await khongGhi("hồ sơ của người khác");

    // ÂM: cờ module tắt ⇒ chủ hồ sơ cũng bị chặn (cả hai action)
    dangNhap(f.u1.id);
    await batCo(false);
    expect(await taoLinkCuaToiAction(vao(f))).toMatchObject({ ok: false, truong: "quyen" });
    expect(await taoQrCuaToiAction({ id: goc.id })).toMatchObject({ ok: false, truong: "quyen" });
    await batCo(true);
    await khongGhi("cờ tắt");

    // ÂM: đối tác không còn ACTIVE (tạm ngừng) ⇒ không tạo link mới
    await db.affiliate.update({ where: { id: f.P1.id }, data: { status: "SUSPENDED", isActive: false } });
    expect((await taoLinkCuaToiAction(vao(f))).ok).toBe(false);
    await db.affiliate.update({ where: { id: f.P1.id }, data: { status: "ACTIVE", isActive: true } });
    await khongGhi("đối tác tạm ngừng");

    // DƯƠNG (đối chứng của mọi ca trên — cùng đầu vào, chỉ khác người gọi): chủ hồ sơ tạo được và xin được QR, DÙ phiên mang vai nào — quyền là sở hữu, không phải vai
    let them = 0;
    for (const vai of ["PARENT", "TEACHER", "SUPER_ADMIN"]) {
      dangNhap(f.u1.id, vai);
      expect((await taoLinkCuaToiAction(vao(f))).ok, `chủ hồ sơ tạo link / ${vai}`).toBe(true);
      them += 1;
      expect(await taoQrCuaToiAction({ id: goc.id }), `chủ hồ sơ QR / ${vai}`).toMatchObject({ ok: true, lienKetNgan: expect.stringContaining("/r/") });
    }
    PHIEN.session = { user: { id: f.u1.id, name: TEN_PHIEN } } as never; // phiên không mang vai
    expect((await taoLinkCuaToiAction(vao(f))).ok).toBe(true);
    them += 1;
    expect(await demLink(f.P1.id)).toBe(dau.p1 + them);
    expect(await demLink(f.P2.id)).toBe(dau.p2);
  });

  it("[AFF-WEB-04b] nút «Link» của đối tác: URL cuối của link ĐANG DÙNG mới nhất; không quyền ⇒ Map rỗng và KHÔNG truy vấn; link hỏng chuỗi / đã thu hồi bị bỏ qua", async () => {
    const f = await dungHienTruong();
    const base = { partyId: f.P1.id, membershipId: f.M1.id, campaignId: f.C1.id };
    const cu = await db.affiliateTrackingAsset.create({ data: { ...base, siteId: f.A.id, landingPath: "/khoa-robot", publicToken: sinhToken(), createdAt: new Date("2026-09-01T00:00:00.000Z") } });
    const moi = await db.affiliateTrackingAsset.create({ data: { ...base, siteId: f.B.id, landingPath: "/khoa-hoc/robot", publicToken: sinhToken(), createdAt: new Date("2026-09-02T00:00:00.000Z") } });
    // link MỚI NHẤT nhưng chuỗi hỏng (website Z tắt theo dõi) ⇒ bị bỏ qua, rơi về link dùng được kế tiếp
    await db.affiliateTrackingAsset.create({ data: { ...base, siteId: f.Z.id, landingPath: "/z", publicToken: sinhToken(), createdAt: new Date("2026-09-03T00:00:00.000Z") } });
    // link ĐÃ THU HỒI mới hơn nữa ⇒ cũng bỏ qua
    await db.affiliateTrackingAsset.create({ data: { ...base, siteId: f.A.id, landingPath: "/khoa-robot", publicToken: sinhToken(), status: "REVOKED", revokedAt: NOW, revokedReason: "fixture AWM thu hồi", createdAt: new Date("2026-09-04T00:00:00.000Z") } });

    const co = await docLinkDangDungTheoDoiTac([f.P1.id, f.P2.id], { coTheXemDayDu: true, now: NOW });
    expect([...co.keys()]).toEqual([f.P1.id]); // P2 chưa có link nào ⇒ không có mặt (nơi gọi vẽ nút «tạo link»)
    expect(co.get(f.P1.id)).toMatchObject({ id: moi.id, urlCuoi: `https://test.satarobo.vn/khoa-hoc/robot?aff=${moi.publicToken}&cmp=${f.C1.code}`, website: expect.stringContaining(`Web B ${P}`) });
    expect(co.get(f.P1.id)!.urlCuoi).not.toContain(cu.publicToken);

    // KHÔNG quyền ⇒ Map rỗng (token đầy đủ không rời tầng đọc), kể cả khi đối tác có link dùng được (đối chứng dương ở trên)
    const khong = await docLinkDangDungTheoDoiTac([f.P1.id, f.P2.id], { coTheXemDayDu: false, now: NOW });
    expect(khong.size).toBe(0);
    // không có đối tác nào ⇒ rỗng, không lỗi
    expect((await docLinkDangDungTheoDoiTac([], { coTheXemDayDu: true, now: NOW })).size).toBe(0);
    // website của link mới nhất bị NGỪNG ⇒ rơi về link ở website còn lại (A)
    await db.affiliateSite.update({ where: { id: f.B.id }, data: { status: "INACTIVE" } });
    expect((await docLinkDangDungTheoDoiTac([f.P1.id], { coTheXemDayDu: true, now: NOW })).get(f.P1.id)!.urlCuoi).toBe(`https://quatang.edu.vn/khoa-robot?aff=${cu.publicToken}&cmp=${f.C1.code}`);
  });

  it("[AFF-WEB-05] MỘT đường ghi: đối tác suy từ DB, loại LINK, nhật ký cùng giao dịch; hạn mức link/membership vẫn chặn, thu hồi một cái thì tạo tiếp được", async () => {
    const f = await dungHienTruong();
    dangNhap(f.u1.id);
    const ok = await taoLinkCuaToiAction({ ...vao(f), label: "  Nhóm Zalo 3A " });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const dong = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: ok.id } });
    expect(dong).toMatchObject({ partyId: f.P1.id, membershipId: f.M1.id, campaignId: f.C1.id, siteId: f.A.id, landingPath: "/khoa-robot", type: "LINK", status: "ACTIVE", label: "Nhóm Zalo 3A", createdById: f.u1.id });
    // nhật ký ghi bởi CHÍNH đường `phatLink` (cùng giao dịch), actor là đối tác; không lộ token đầy đủ
    const nhatKy = await db.auditLog.findFirstOrThrow({ where: { entityType: "AffiliateTrackingAsset", entityId: ok.id, action: "AFFILIATE_LINK_PHAT" } });
    expect(nhatKy.actorId).toBe(f.u1.id);
    expect(JSON.stringify(nhatKy.newValues)).not.toContain(dong.publicToken);

    // hạn mức: 50 link ACTIVE trong M2 ⇒ link thứ 51 bị chặn; thu hồi một ⇒ tạo tiếp được
    await db.affiliateTrackingAsset.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({ partyId: f.P1.id, membershipId: f.M2.id, campaignId: f.C2.id, siteId: f.B.id, landingPath: "/khoa-hoc/robot", publicToken: sinhToken(), type: "LINK" as const, label: `fx ${i}` })),
    });
    const m2 = vao(f, { membershipId: f.M2.id, siteId: f.B.id, landingPath: "/khoa-hoc/robot" });
    const chan = await taoLinkCuaToiAction(m2);
    expect(chan.ok).toBe(false);
    if (!chan.ok) expect(chan.loi).toMatch(/tối đa 50/);
    const opt = await docGioiThieuCuaToi(f.u1.id, NOW);
    expect(opt!.taoLink.chuongTrinh.find((c) => c.membershipId === f.M2.id)).toMatchObject({ soLinkDangChay: 50, soLinkToiDa: 50 }); // ô chọn nói đúng hạn mức
    expect(opt!.taoLink.chuongTrinh.find((c) => c.membershipId === f.M1.id)).toMatchObject({ soLinkDangChay: 1, soLinkToiDa: 50 }); // đối chứng: M1 mới có 1
    const mot = await db.affiliateTrackingAsset.findFirstOrThrow({ where: { membershipId: f.M2.id, status: "ACTIVE" }, orderBy: { id: "asc" } });
    expect((await thuHoiLink({ nguoi: NGUOI, id: mot.id, updatedAtDaThay: mot.updatedAt, lyDo: "Thu hồi để kiểm tra hạn mức", now: NOW })).ok).toBe(true);
    expect((await taoLinkCuaToiAction(m2)).ok).toBe(true);
  });

  it("[AFF-WEB-06] một đối tác ≥ 2 link ở ≥ 2 website (cổng + Admin): danh sách hiện website · trang đích · URL cuối; `/r/<token>` chuyển đúng domain + đường dẫn", async () => {
    const f = await dungHienTruong();
    dangNhap(f.u1.id);
    const la = await taoLinkCuaToiAction(vao(f)); // A (quatang.edu.vn) /khoa-robot
    const lb = await taoLinkCuaToiAction(vao(f, { siteId: f.B.id, landingPath: "/khoa-hoc/robot" })); // B (test.satarobo.vn)
    expect([la.ok, lb.ok]).toEqual([true, true]);
    // thêm một link từ phía ADMIN (cùng hàm ghi): trang tiền tố trên A
    const lc = await phatLink({ nguoi: NGUOI, vao: { partyId: f.P1.id, membershipId: f.M1.id, siteId: f.A.id, landingPath: "/khoa-hoc/xyz", type: "LINK", label: null }, now: NOW });
    expect(lc.ok).toBe(true);

    const ds = await docDanhSachLink({ trang: 1, kichThuoc: 25, trangThai: null, campaignMa: null, doiTacMa: f.P1.code, coTheXemDayDu: true, gocLinkNgan: GOC, gocNhinDoiTac: false, now: NOW });
    expect(ds.dong.map((d) => `${d.website.host}${d.landingPath}`).sort()).toEqual(["quatang.edu.vn/khoa-hoc/xyz", "quatang.edu.vn/khoa-robot", "test.satarobo.vn/khoa-hoc/robot"]);
    const dongA = ds.dong.find((d) => d.landingPath === "/khoa-robot")!;
    const dongB = ds.dong.find((d) => d.website.host === "test.satarobo.vn")!;
    expect(dongA.urlCuoi).toBe(`https://quatang.edu.vn/khoa-robot?aff=${dongA.token}&cmp=${f.C1.code}`);
    expect(dongB.urlCuoi).toBe(`https://test.satarobo.vn/khoa-hoc/robot?aff=${dongB.token}&cmp=${f.C1.code}`);
    expect(dongA.lienKetNgan).toBe(`${GOC}/r/${dongA.token}`);

    // cổng đối tác thấy cùng hai website (đối chứng: chỉ link của MÌNH)
    const cong = await docGioiThieuCuaToi(f.u1.id, NOW);
    expect(new Set(cong!.link.map((l) => l.website))).toEqual(new Set(["quatang.edu.vn", "test.satarobo.vn"]));
    expect(cong!.link.find((l) => l.website === "test.satarobo.vn")).toMatchObject({ trangDich: "/khoa-hoc/robot", urlCuoi: dongB.urlCuoi });

    // `/r/<token>` ⇒ 302 tới ĐÚNG domain + đường dẫn của website của link đó (không lẫn sang website kia)
    const rA = await bam(dongA.token);
    const rB = await bam(dongB.token);
    expect(rA.ketCuc).toBe("OK");
    expect(rA.diemDen.startsWith(`https://quatang.edu.vn/khoa-robot?aff=${dongA.token}&cmp=${f.C1.code}&clk=`)).toBe(true);
    expect(rB.ketCuc).toBe("OK");
    expect(rB.diemDen.startsWith(`https://test.satarobo.vn/khoa-hoc/robot?aff=${dongB.token}&cmp=${f.C1.code}&clk=`)).toBe(true);
    expect(rA.cookieGioiThieu).not.toBeNull();

    // QR của cổng: dựng từ link CỦA MÌNH, mang gốc cấu hình; link của người khác ⇒ như không tồn tại
    const idA = cong!.link.find((l) => l.website === "quatang.edu.vn" && l.trangDich === "/khoa-robot")!.id;
    const qr = await taoQrCuaToiAction({ id: idA });
    expect(qr).toMatchObject({ ok: true, lienKetNgan: `${GOC}/r/${dongA.token}` });
    dangNhap(f.u2.id);
    expect(await taoQrCuaToiAction({ id: idA })).toMatchObject({ ok: false, truong: "khongTimThay" });
  });

  it("[AFF-WEB-06b] cột Referral: màn quản trị đếm referral HỢP LỆ của TỪNG link (không lẫn link khác); cổng đối tác đếm MỌI lượt gửi, không tách hợp lệ/không, không phụ thuộc thời gian (R10 · D1)", async () => {
    const f = await dungHienTruong();
    const mk = async (siteId: string, landingPath: string) => (await db.affiliateTrackingAsset.create({ data: { partyId: f.P1.id, membershipId: f.M1.id, campaignId: f.C1.id, siteId, landingPath, publicToken: sinhToken() } }));
    const a = await mk(f.A.id, "/khoa-robot");
    const b = await mk(f.B.id, "/khoa-hoc/robot");
    const rf = async (assetId: string, status: "VALID" | "MANUAL_REVIEW" | "REJECTED") => {
      const lead = await db.lead.create({ data: { parentName: `${P} KH ${hau()}`, phone: sdtMoi() } });
      return db.affiliateReferral.create({
        data: {
          partyId: f.P1.id, campaignId: f.C1.id, membershipId: f.M1.id, assetId, method: "LINK", status, sourceGroupId: f.nA.id,
          sourceSnapshot: { affiliateCode: "X", campaignCode: "Y", method: "LINK", typeCode: null, tagCodes: [], origin: "KHOP" },
          leadId: status === "VALID" ? lead.id : null,
          rejectedAt: status === "REJECTED" ? NOW : null,
          resolutionReason: status === "REJECTED" ? "TU_GIOI_THIEU" : null,
        },
      });
    };
    for (const st of ["VALID", "VALID", "VALID", "MANUAL_REVIEW", "REJECTED"] as const) await rf(a.id, st); // link A: 3 hợp lệ + 2 không
    await rf(b.id, "VALID"); // link B: 1 hợp lệ

    const ds = await docDanhSachLink({ trang: 1, kichThuoc: 25, trangThai: null, campaignMa: null, doiTacMa: f.P1.code, coTheXemDayDu: true, gocLinkNgan: GOC, gocNhinDoiTac: false, now: NOW });
    expect(Object.fromEntries(ds.dong.map((d) => [d.token, d.soReferral]))).toEqual({ [a.publicToken]: 3, [b.publicToken]: 1 });
    // người chỉ xem cũng thấy CON SỐ (không phải token) — số referral không phải bí mật của đối tác
    const xem = await docDanhSachLink({ trang: 1, kichThuoc: 25, trangThai: null, campaignMa: null, doiTacMa: f.P1.code, coTheXemDayDu: false, gocLinkNgan: GOC, gocNhinDoiTac: false, now: NOW });
    expect(xem.dong.map((d) => d.soReferral).sort()).toEqual([1, 3]);
    // R10 · D1: cổng đối tác đếm MỌI lượt gửi của từng link (A: 3 hợp lệ + 1 xem tay + 1 từ chối = 5; B: 1) — KHÔNG tách hợp lệ/không và KHÔNG phụ thuộc thời gian (bản N1 che 7 ngày rồi hiện số hợp lệ).
    // `createdAt` do DB đóng bằng đồng hồ thật ⇒ ghim về ngày TUYỆT ĐỐI (luật 19).
    await db.affiliateReferral.updateMany({ where: { partyId: f.P1.id }, data: { createdAt: new Date("2026-09-20T03:00:00.000Z") } });
    for (const luc of [NOW, new Date("2026-09-22T03:00:00.000Z"), new Date("2027-09-20T03:00:00.000Z")]) {
      const cong = await docGioiThieuCuaToi(f.u1.id, luc);
      expect(Object.fromEntries(cong!.link.map((l) => [l.website, l.soReferral])), luc.toISOString()).toEqual({ "quatang.edu.vn": 5, "test.satarobo.vn": 1 });
    }
    // màn quản trị (nhân viên) KHÔNG bị che: vẫn thấy số thật ở chính thời điểm đó
    const quanTri = await docDanhSachLink({ trang: 1, kichThuoc: 25, trangThai: null, campaignMa: null, doiTacMa: f.P1.code, coTheXemDayDu: true, gocLinkNgan: GOC, gocNhinDoiTac: false, now: new Date("2026-09-22T03:00:00.000Z") });
    expect(quanTri.dong.map((d) => d.soReferral).sort()).toEqual([1, 3]);
  });

  it("[AFF-WEB-07] tắt website ⇒ không tạo link mới, click mới bị chặn (ghi lượt bấm không hợp lệ, không cookie), lịch sử giữ nguyên; tắt theo dõi cũng vậy; website kia không ảnh hưởng", async () => {
    const f = await dungHienTruong();
    dangNhap(f.u1.id);
    const la = await taoLinkCuaToiAction(vao(f));
    const lb = await taoLinkCuaToiAction(vao(f, { siteId: f.B.id, landingPath: "/khoa-hoc/robot" }));
    expect([la.ok, lb.ok]).toEqual([true, true]);
    const tok = async (id: string) => (await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id } })).publicToken;
    const tokA = await tok((la as { id: string }).id);
    const tokB = await tok((lb as { id: string }).id);
    expect((await bam(tokB)).ketCuc).toBe("OK"); // trước khi tắt: click hợp lệ
    const clickTruoc = await db.referralClick.count({ where: { partyId: f.P1.id } });

    // NGỪNG website B bằng đúng hàm của tab Website
    const site = await db.affiliateSite.findUniqueOrThrow({ where: { id: f.B.id } });
    const tat = await doiTrangThaiWebsite({ nguoi: NGUOI, id: f.B.id, updatedAtDaThay: site.updatedAt, den: "INACTIVE", lyDo: "Ngừng website để kiểm thử AWM" });
    expect(tat.ok).toBe(true);

    // không tạo link MỚI trên B (cả hai đường), nhưng A vẫn tạo được (đối chứng dương)
    const truoc = await demLink(f.P1.id);
    expect((await taoLinkCuaToiAction(vao(f, { siteId: f.B.id, landingPath: "/khoa-hoc/robot" }))).ok).toBe(false);
    expect((await phatLink({ nguoi: NGUOI, vao: { partyId: f.P1.id, membershipId: f.M2.id, siteId: f.B.id, landingPath: "/khoa-hoc/robot", type: "LINK", label: null }, now: NOW })).ok).toBe(false);
    expect(await demLink(f.P1.id)).toBe(truoc);
    expect((await taoLinkCuaToiAction(vao(f, { landingPath: "/khoa-hoc/abc" }))).ok).toBe(false); // (A: chỉ trang «đúng» ở cổng đối tác)
    expect((await taoLinkCuaToiAction(vao(f))).ok).toBe(true);

    // ô chọn cũng không còn B cho đối tác
    const opt = await docGioiThieuCuaToi(f.u1.id, NOW);
    expect(opt!.taoLink.chuongTrinh.find((c) => c.membershipId === f.M1.id)!.websites.map((w) => w.host)).toEqual(["quatang.edu.vn"]);

    // click mới vào link B: KHÔNG hợp lệ, không cookie giới thiệu, không gắn aff/cmp vào điểm đến; lượt bấm ĐƯỢC GHI với mã lý do
    const r = await bam(tokB);
    expect(r.ketCuc).toBe("KHONG_HOP_LE");
    expect(r.cookieGioiThieu).toBeNull();
    expect(r.diemDen).not.toContain("aff=");
    const click = await db.referralClick.findMany({ where: { partyId: f.P1.id }, orderBy: { occurredAt: "asc" }, select: { outcome: true, assetId: true } });
    expect(click).toHaveLength(clickTruoc + 1);
    expect(click.at(-1)!.outcome).toBe("WEBSITE_KHONG_HOAT_DONG");
    expect(click.filter((c) => c.outcome === "OK")).toHaveLength(1); // lịch sử: lượt OK trước khi tắt còn nguyên

    // lịch sử giữ nguyên: link B vẫn ACTIVE trong DB (không bị thu hồi ngầm) nhưng danh sách nói vì sao không dùng được
    const ds = await docDanhSachLink({ trang: 1, kichThuoc: 25, trangThai: null, campaignMa: null, doiTacMa: f.P1.code, coTheXemDayDu: true, gocLinkNgan: GOC, gocNhinDoiTac: false, now: NOW });
    const dongB = ds.dong.find((d) => d.token === tokB)!;
    expect(dongB.trangThai).toBe("ACTIVE");
    expect(dongB.lyDoKhongDung).toBe("Website không còn ở trạng thái hoạt động.");
    expect(dongB.soLuotBam).toBe(1);
    expect(dongB.soLuotBamLoi).toBe(1);

    // bật lại ⇒ link B dùng được trở lại (đối chứng: ngừng KHÔNG phải thu hồi)
    const site2 = await db.affiliateSite.findUniqueOrThrow({ where: { id: f.B.id } });
    expect((await doiTrangThaiWebsite({ nguoi: NGUOI, id: f.B.id, updatedAtDaThay: site2.updatedAt, den: "ACTIVE", lyDo: null })).ok).toBe(true);
    expect((await bam(tokB)).ketCuc).toBe("OK");

    // tắt THEO DÕI của A (website vẫn hoạt động) ⇒ click vào link A bị chặn, link B không ảnh hưởng
    await db.affiliateSite.update({ where: { id: f.A.id }, data: { trackingEnabled: false } });
    const rA = await bam(tokA);
    expect([rA.ketCuc, rA.cookieGioiThieu]).toEqual(["KHONG_HOP_LE", null]);
    expect((await bam(tokB)).ketCuc).toBe("OK");
  });

  it("[AFF-WEB-08] intake từ host website ngoài với token hợp lệ ⇒ lead mang attribution ĐÚNG đối tác/campaign/link; Origin lạ ⇒ chờ xem xét; khoá client cấm ⇒ 400 và không lead", async () => {
    const f = await dungHienTruong();
    const l = await phatLink({ nguoi: NGUOI, vao: { partyId: f.P1.id, membershipId: f.M1.id, siteId: f.A.id, landingPath: "/khoa-robot", type: "LINK", label: null }, now: NOW });
    if (!l.ok) throw new Error(`fixture hỏng: ${l.loi}`);
    const asset = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } });

    // host chính và host phụ (tên miền thứ hai của CÙNG website) đều được
    for (const origin of ["https://quatang.edu.vn", "https://covua.quatang.edu.vn"]) {
      const { kq, sdt } = await guiIntake(asset.publicToken, origin);
      expect(kq.status, origin).toBe(200);
      expect(kq.acao, origin).toBe(origin); // CORS chỉ phản chiếu origin nằm trong allowedDomains của website của link
      const lead = await leadTheoSdt(sdt);
      expect(lead, origin).not.toBeNull();
      const rf = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: lead!.id } });
      expect(rf, origin).toMatchObject({ status: "VALID", partyId: f.P1.id, campaignId: f.C1.id, membershipId: f.M1.id, assetId: asset.id });
      const at = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead!.id } });
      expect(at.referrerAffiliateId, origin).toBe(f.P1.id);
    }

    // Origin LẠ (không thuộc website của link): khách VẪN được lưu, nhưng referral chờ xem xét — không âm thầm hợp lệ; không phản chiếu CORS
    const la = await guiIntake(asset.publicToken, "https://evil.example");
    expect(la.kq.status).toBe(200);
    expect(la.kq.acao).toBeNull();
    const leadLa = await leadTheoSdt(la.sdt);
    expect(leadLa).not.toBeNull();
    expect((await db.affiliateReferral.findFirstOrThrow({ where: { leadId: leadLa!.id } })).status).toBe("MANUAL_REVIEW");

    // client KHÔNG được gửi id đối tác / nguồn / tỉ lệ: lược đồ strict ⇒ 400, không lead
    for (const cam of [{ affiliateId: f.P2.id }, { partyId: f.P2.id }, { sourceGroupId: f.nB.id }, { campaignId: f.C2.id }, { rate: 0.5 }]) {
      const r = await guiIntake(asset.publicToken, "https://quatang.edu.vn", cam);
      expect(r.kq.status, JSON.stringify(cam)).toBe(400);
      expect(await leadTheoSdt(r.sdt), JSON.stringify(cam)).toBeNull();
    }
  });

  it("[AFF-WEB-09] nguồn lead theo CAMPAIGN, không theo website: cùng đối tác hai campaign khác nguồn ⇒ hai nguồn khác; cùng campaign qua hai website ⇒ cùng nguồn", async () => {
    const f = await dungHienTruong();
    const phat = async (membershipId: string, siteId: string, landingPath: string) => {
      const m = membershipId === f.M1.id ? f.C1 : f.C2;
      const r = await phatLink({ nguoi: NGUOI, vao: { partyId: f.P1.id, membershipId, siteId, landingPath, type: "LINK", label: null }, now: NOW });
      if (!r.ok) throw new Error(`fixture hỏng: ${r.loi}`);
      return { token: (await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: r.id } })).publicToken, campaign: m };
    };
    const c1a = await phat(f.M1.id, f.A.id, "/khoa-robot"); // C1 qua website A
    const c1b = await phat(f.M1.id, f.B.id, "/khoa-hoc/robot"); // C1 qua website B
    const c2b = await phat(f.M2.id, f.B.id, "/khoa-hoc/robot"); // C2 qua website B

    const nguonCua = async (token: string, origin: string) => {
      const { kq, sdt } = await guiIntake(token, origin);
      expect(kq.status).toBe(200);
      const lead = await leadTheoSdt(sdt);
      const rf = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: lead!.id } });
      const at = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead!.id } });
      expect(rf.status).toBe("VALID");
      return { referral: rf.sourceGroupId, attribution: at.groupId, campaignId: rf.campaignId };
    };
    const a = await nguonCua(c1a.token, "https://quatang.edu.vn");
    const b = await nguonCua(c1b.token, "https://test.satarobo.vn");
    const c = await nguonCua(c2b.token, "https://test.satarobo.vn");

    // cùng campaign C1, hai website khác nhau ⇒ CÙNG nguồn NA
    expect([a.campaignId, b.campaignId]).toEqual([f.C1.id, f.C1.id]);
    expect([a.referral, a.attribution, b.referral, b.attribution]).toEqual([f.nA.id, f.nA.id, f.nA.id, f.nA.id]);
    // cùng website B nhưng campaign C2 ⇒ nguồn NB (nguồn đi theo campaign, KHÔNG theo website)
    expect(c.campaignId).toBe(f.C2.id);
    expect([c.referral, c.attribution]).toEqual([f.nB.id, f.nB.id]);
  });
});
