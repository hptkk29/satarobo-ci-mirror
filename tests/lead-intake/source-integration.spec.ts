// @vitest-environment node
/**
 * [SRC-INT-02..09] — TÍCH HỢP NGUỒN × AFFILIATE trên Postgres THẬT (lane C2 · closeout «final-source-integration»).
 *
 * Không thêm tính năng: ghép CHUỖI đầu-cuối `Affiliate → Membership → Campaign → LeadSourceGroup` bằng DỊCH VỤ thật (taoWebsite · themTrangDich · taoCampaign · ganWebsite · themQuyTac ·
 * doiTrangThaiCampaign · phatLink · tuTaoLink · xoayLink · intake công khai) và khoá các luật mà test từng tầng không chứng minh được vì chúng sống ở TẦNG GHÉP.
 *
 *   [SRC-INT-02] CHẶN PUBLISH CAMPAIGN: không nguồn mặc định + không quy tắc ⇒ kích hoạt bị từ chối (DOI_TAC_NGUON), vẫn DRAFT, 0 nhật ký kích hoạt; có nguồn mặc định ⇒ ACTIVE        (SRC-14)
 *   [SRC-INT-03] CHẶN PUBLISH LINK: campaign chỉ có quy tắc cho loại X ⇒ đối tác loại Y KHÔNG phát được link (0 link, 0 nhật ký phát); loại X phát được; thêm quy tắc cho Y ⇒ phát được; nguồn ngừng ⇒ lại chặn
 *                (nguyên nhân là của NGUỒN, không câu chung); xoay mã một link đã có KHÔNG bị chặn                                                                                  (SRC-14)
 *   [SRC-INT-03b] cổng đối tác `tuTaoLink` đi qua CÙNG cổng: đối tác thiếu mapping tự tạo link ⇒ từ chối, 0 link                                                                      (SRC-14)
 *   [SRC-INT-04] DỮ LIỆU LỊCH SỬ thiếu mapping (link có sẵn từ trước cổng) ⇒ intake vẫn lưu khách; referral MANUAL_REVIEW kèm LÝ DO, KHÔNG gắn người giới thiệu, hiện ở hàng chờ xem tay;
 *                bổ sung mapping về sau KHÔNG tự đổi referral cũ; lượt gửi MỚI sau khi bổ sung ⇒ VALID                                                                                (SRC-14 · SRC-09)
 *   [SRC-INT-05] token / mã / nhãn / utm KHÔNG BAO GIỜ thành nguồn: nhãn link, `utm.source`, `note` mang tên một nhóm nguồn khác ⇒ nhóm vẫn là nhóm của CAMPAIGN; token = mã nhóm ⇒ không referral         (SRC-14)
 *   [SRC-INT-06] ĐA WEBSITE: quatang.edu.vn · covua.quatang.edu.vn · satarobo.vn · website tuỳ biến do Admin thêm cùng một campaign ⇒ CÙNG nhóm nguồn (campaign quyết, host không quyết); cùng website
 *                hai campaign khác nguồn ⇒ hai nhóm khác; đổi nguồn mặc định của campaign SAU khi có lead ⇒ lead cũ giữ snapshot                                                     (SRC-14 · SRC-23)
 *   [SRC-INT-06b] quatang.edu.vn qua webhook RIÊNG (D19) khi website quatang cũng nằm trong Affiliate: lead KHÔNG mang attribution Affiliate dù mã link trùng token đang sống                    (SRC-14)
 *   [SRC-INT-07] CLICK-CLAIM: schema đúng migration `20261028090000_affiliate_click_claim` (PK clickId, FK CASCADE tới ReferralClick, RLS bật); `clk` dùng MỘT lần — lượt thứ hai (biểu mẫu khác)
 *                bị xem tay, KHÔNG nhân đôi; phản hồi công khai của lượt thứ hai ≡ lượt đầu (không lộ CRM/membership/nhóm nguồn); gửi lại CHÍNH biểu mẫu đầu vẫn VALID                  (SRC-08 · SRC-09)
 *   [SRC-INT-08] PHONE_ENUMERATION vẫn ĐÓNG: ngưỡng thời gian 700 ms + nhiễu ≤ 850 ms nguyên văn; bốn kết quả khác nhau trong DB trả CÙNG thân phản hồi, CÙNG lớp thời gian                       (SRC-09)
 *
 * Mã ánh xạ SRC-xx = bảng `docs/source-commission/05-quyen-co-kiem-thu-trien-khai.md` §5 (SRC-08 first-claim · SRC-09 trùng SĐT/touchpoint · SRC-14 aff ⇒ nguồn · SRC-23 tầng ghi).
 *
 * LUẬT 18: mỗi ca tự dựng hiện trường (dọn theo tiền tố `SIN`), chạy ĐƯỢC MỘT MÌNH. LUẬT 19: đồng hồ TIÊM (`NOW`); `Date.now()` chỉ là hậu tố mã duy nhất. Không `resetDb()`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "10.9.9.9" }) }));
vi.setConfig({ testTimeout: 120_000 });

import { NextRequest } from "next/server";
import { POST as quatangPost } from "../../app/api/public/webhook/quatang/route";
import { demReferralCanXemTay } from "../../lib/affiliate/doc-referral";
import { doiTrangThaiCampaign, ganWebsite, taoCampaign, themQuyTac } from "../../lib/affiliate/ghi-campaign";
import { phatLink, xoayLink } from "../../lib/affiliate/ghi-link";
import { taoWebsite, themTrangDich } from "../../lib/affiliate/ghi-website";
import { DO_TRE_NHIEU_TOI_DA_MS, DO_TRE_TOI_THIEU_MS, xuLyIntakeGioiThieu } from "../../lib/affiliate/intake-cong-khai";
import { sinhToken } from "../../lib/affiliate/token";
import { LOI_CHUONG_TRINH_CHUA_SAN_SANG, tuTaoLink } from "../../lib/affiliate/tu-tao-link";
import type { Actor } from "../../lib/auth/actor";
import { db } from "../../lib/db";
import { clearSettingsCache } from "../../lib/settings/service";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "SIN";
const NOW = new Date("2026-10-13T03:00:00.000Z");
const NGUOI = { userId: "sin-admin", ten: "Admin SIN" };
const TEN_PHIEN = "Đối tác thử SIN";
const SECRET_QT = "sin-quatang-khoa-thu-nghiem-32-ky-tu!!";

let seq = 0;
const hau = () => `${Date.now().toString(36).toUpperCase()}${(seq += 1)}`;
const ma = (t: string) => `${P}_${t}${hau()}`;
let sdtSeq = 0;
const sdtMoi = () => `090720${String((sdtSeq += 1)).padStart(4, "0")}`;
const bienThe = (s: string) => [s, `84${s.slice(1)}`];
let ipSeq = 0;
const ipMoi = () => `10.66.${Math.floor((ipSeq += 1) / 250)}.${(ipSeq % 250) + 1}`;

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { OR: [{ parentName: { startsWith: P } }, { phone: { startsWith: "090720" } }, { phone: { startsWith: "8490720" } }] }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  await db.affiliateReferral.deleteMany({ where: { OR: [{ party: { code: { startsWith: P } } }, { leadId: { in: ids } }] } });
  if (ids.length > 0) {
    // attribution/touchpoint trỏ nhóm nguồn của fixture (FK Restrict) nên phải gỡ TRƯỚC khi xoá nhóm.
    await db.leadAttribution.deleteMany({ where: { leadId: { in: ids } } });
    await db.leadTouchpoint.deleteMany({ where: { leadId: { in: ids } } });
    await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  await db.webhookDelivery.deleteMany({ where: { source: "quatang", externalId: { startsWith: "sin-" } } });
  // `ReferralClick` là sổ CHỈ-THÊM (trigger chặn sửa/xoá): tắt trigger trong MỘT transaction rồi bật lại — cùng cách `donAffiliateFx`.
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`ALTER TABLE "ReferralClick" DISABLE TRIGGER "ReferralClick_chi_them"`;
    await tx.referralClick.deleteMany({ where: { asset: { party: { code: { startsWith: P } } } } });
    await tx.$executeRaw`ALTER TABLE "ReferralClick" ENABLE TRIGGER "ReferralClick_chi_them"`;
  });
  await db.affiliateTrackingAsset.deleteMany({ where: { party: { code: { startsWith: P } } } });
  await db.affiliatePartyUser.deleteMany({ where: { party: { code: { startsWith: P } } } });
  await db.affiliateMembership.deleteMany({ where: { party: { code: { startsWith: P } } } });
  const camp = await db.affiliateCampaign.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const cid = camp.map((c) => c.id);
  await db.affiliateCampaignRule.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaignLanding.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaignSite.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaign.deleteMany({ where: { id: { in: cid } } });
  const sites = await db.affiliateSite.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  await db.affiliateLandingPage.deleteMany({ where: { siteId: { in: sites.map((s) => s.id) } } });
  await db.affiliateSite.deleteMany({ where: { code: { startsWith: P } } });
  await db.affiliatePartyTag.deleteMany({ where: { party: { code: { startsWith: P } } } });
  await db.affiliate.deleteMany({ where: { code: { startsWith: P } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: P } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } });
  await db.auditLog.deleteMany({ where: { actorName: { in: [NGUOI.ten, TEN_PHIEN] } } });
  await db.user.deleteMany({ where: { email: { startsWith: "sin-tk-" } } });
}

async function batCo(): Promise<void> {
  await db.systemSetting.deleteMany({ where: { key: "affiliate.enabled" } });
  await datCoNguon({ ...CO_NGUON_DAY_DU, enabled: true }, { "affiliate.enabled": true });
}

// ── dựng hiện trường BẰNG DỊCH VỤ ─────────────────────────────────────────────────────────────────────────────

const taoNhom = (t: string, over: Record<string, unknown> = {}) =>
  db.leadSourceGroup.create({ data: { code: ma(t), name: `Nguồn ${t} ${P}`, sourceType: "PARTNER", referrerRequirement: "NONE", sortOrder: 900, status: "ACTIVE", selectable: true, ...over } });

async function taoSiteBangDichVu(p: { t: string; baseUrl: string; domains: string[]; trang: { host?: string; path: string }[] }) {
  const w = await taoWebsite({ nguoi: NGUOI, vao: { code: ma(p.t), name: `Web ${p.t} ${P}`, baseUrl: p.baseUrl, allowedDomains: p.domains, trackingEnabled: true, defaultCampaignId: null } });
  if (!w.ok) throw new Error(`fixture website: ${w.loi}`);
  const trangId: string[] = [];
  for (const t of p.trang) {
    const r = await themTrangDich({ nguoi: NGUOI, vao: { siteId: w.id, ...(t.host ? { host: t.host } : {}), pathPattern: t.path, label: null } });
    if (!r.ok) throw new Error(`fixture trang đích: ${r.loi}`);
    trangId.push(r.id);
  }
  return { id: w.id, trangId };
}

/** Campaign DRAFT → gắn website → chọn «không có mức riêng» (vế thưởng không thuộc bộ này) → [quy tắc] → KÍCH HOẠT bằng dịch vụ thật. */
async function campaignDangChay(p: { t: string; nguonMacDinh: string | null; siteIds: string[]; quyTac?: { typeId: string; sourceGroupId: string }[]; kichHoat?: boolean }) {
  const code = ma(p.t);
  const c = await taoCampaign({
    nguoi: NGUOI,
    now: NOW,
    vao: { code, name: `Campaign ${code}`, description: null, attributionModel: "FIRST_VALID", cookieWindowDays: 30, protectWindowDays: 90, allowSelfReferral: false, defaultSourceGroupId: p.nguonMacDinh, effectiveFrom: null, effectiveTo: null },
  });
  if (!c.ok) throw new Error(`fixture campaign: ${c.loi}`);
  for (const siteId of p.siteIds) {
    const g = await ganWebsite({ nguoi: NGUOI, campaignId: c.id, siteId, now: NOW });
    if (!g.ok) throw new Error(`fixture gắn website: ${g.loi}`);
  }
  for (const q of p.quyTac ?? []) {
    const r = await themQuyTac({ nguoi: NGUOI, campaignId: c.id, vao: { typeId: q.typeId, tagId: null, sourceGroupId: q.sourceGroupId }, lyDo: null, now: NOW });
    if (!r.ok) throw new Error(`fixture quy tắc: ${r.loi}`);
  }
  await db.affiliateCampaign.update({ where: { id: c.id }, data: { rewardMode: "NONE" } });
  if (p.kichHoat !== false) await kichHoat(c.id);
  return { id: c.id, code };
}
const dongCampaign = (id: string) => db.affiliateCampaign.findUniqueOrThrow({ where: { id } });
async function kichHoat(id: string) {
  return doiTrangThaiCampaign({ nguoi: NGUOI, id, updatedAtDaThay: (await dongCampaign(id)).updatedAt, den: "ACTIVE", lyDo: null, now: NOW });
}
async function kichHoatOk(id: string) {
  const r = await kichHoat(id);
  if (!r.ok) throw new Error(`fixture kích hoạt: ${r.loi}`);
}

async function doiTac(t: string, typeId: string | null, userId: string | null = null) {
  return db.affiliate.create({ data: { code: ma(t), name: `Đối tác ${t} ${P}`, status: "ACTIVE", isActive: true, typeId, userId, phone: "0988777666", email: `${P.toLowerCase()}.${hau().toLowerCase()}@sin.example.com` } });
}
const thanhVien = (partyId: string, campaignId: string) => db.affiliateMembership.create({ data: { partyId, campaignId, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
const phat = (p: { partyId: string; membershipId: string; siteId: string; landingPath: string; landingPageId?: string | null; label?: string | null }) =>
  phatLink({ nguoi: NGUOI, now: NOW, vao: { type: "LINK", label: null, landingPageId: null, ...p } });
async function phatOk(p: Parameters<typeof phat>[0]) {
  const r = await phat(p);
  if (!r.ok) throw new Error(`fixture phát link: ${r.loi}`);
  return r;
}

// ── intake công khai (lõi, đồng hồ + hàm chờ TIÊM — không chờ thật) ───────────────────────────────────────────

let khoaSeq = 0;
const khoa = () => `sin-key-${Date.now().toString(36)}-${(khoaSeq += 1)}`;
function bieuMau(token: string, over: Record<string, unknown> = {}) {
  return { v: 1, token, idempotencyKey: khoa(), parentName: `${P} Phụ huynh`, phone: sdtMoi(), children: [{ fullName: `${P} Bé An` }], consentMarketing: true, ...over };
}
async function guiIntake(body: Record<string, unknown>, origin: string | null) {
  const cho: number[] = [];
  const kq = await xuLyIntakeGioiThieu(
    { thanTho: JSON.stringify(body), origin, ip: ipMoi(), userAgent: null },
    { now: () => NOW, choPhepTanSuat: async () => true, cho: async (ms) => void cho.push(ms), nhieuMs: () => 40 },
  );
  return { kq, cho, sdt: String(body.phone) };
}
const docLead = (sdt: string) =>
  db.lead.findFirstOrThrow({ where: { phone: { in: bienThe(sdt) }, deletedAt: null }, select: { id: true, source: true, attribution: { include: { group: { select: { code: true } } } } } });
const docReferral = (leadId: string) => db.affiliateReferral.findFirstOrThrow({ where: { leadId } });

const actorHo = (): Actor =>
  ({ userId: "sin-actor", isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() }) as Actor;

describe.skipIf(!RUN)("[SRC-INT-AFF] tích hợp Nguồn × Affiliate — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["HO_ACCOUNTANT", "CENTER_SALES_CSM"] });
    await damBaoDanhMucGoc(db);
  }, 180_000);

  beforeEach(async () => {
    process.env.WEBHOOK_QUATANG_SECRET = SECRET_QT;
    vi.stubEnv("AFFILIATE_PUBLIC_ORIGIN", "https://test.satarobo.vn");
    await don();
    await batCo();
  }, 180_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await don();
    delete process.env.WEBHOOK_QUATANG_SECRET;
    await db.systemSetting.deleteMany({ where: { key: { in: ["affiliate.enabled"] } } });
    await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
    clearSettingsCache();
  }, 180_000);

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  it("[SRC-INT-02] chặn PUBLISH campaign khi chưa có cách quy nguồn nào: kích hoạt bị từ chối (DOI_TAC_NGUON), vẫn DRAFT, 0 nhật ký kích hoạt; đối chứng dương: có nguồn mặc định ⇒ ACTIVE", async () => {
    const w = await taoSiteBangDichVu({ t: "W", baseUrl: "https://sin-02.example.test", domains: ["sin-02.example.test"], trang: [{ path: "/khoa-robot" }] });
    const c = await campaignDangChay({ t: "C", nguonMacDinh: null, siteIds: [w.id], kichHoat: false });
    const truocAudit = await db.auditLog.count({ where: { entityId: c.id, actorName: NGUOI.ten, action: { contains: "KICH_HOAT" } } });

    const r = await kichHoat(c.id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.lyDoChan?.map((x) => x.ma)).toContain("DOI_TAC_NGUON");
    expect((await dongCampaign(c.id)).status).toBe("DRAFT");
    expect(await db.auditLog.count({ where: { entityId: c.id, actorName: NGUOI.ten, action: { contains: "KICH_HOAT" } } })).toBe(truocAudit);

    // đối chứng dương: cùng campaign, thêm nguồn mặc định ⇒ qua cổng
    const nguon = await taoNhom("N");
    await db.affiliateCampaign.update({ where: { id: c.id }, data: { defaultSourceGroupId: nguon.id } });
    await kichHoatOk(c.id);
    expect((await dongCampaign(c.id)).status).toBe("ACTIVE");
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  it("[SRC-INT-03] chặn PUBLISH link: campaign chỉ có quy tắc cho loại X ⇒ đối tác loại Y không phát được (0 link, 0 nhật ký phát); loại X phát được; thêm quy tắc cho Y ⇒ phát được; nguồn ngừng ⇒ chặn lại kèm nguyên nhân; xoay mã link có sẵn KHÔNG bị chặn", async () => {
    const nguon = await taoNhom("N");
    const loaiX = await db.affiliateType.create({ data: { code: ma("TX"), name: `Loại X ${P}` } });
    const loaiY = await db.affiliateType.create({ data: { code: ma("TY"), name: `Loại Y ${P}` } });
    const w = await taoSiteBangDichVu({ t: "W", baseUrl: "https://sin-03.example.test", domains: ["sin-03.example.test"], trang: [{ path: "/khoa-robot" }] });
    const c = await campaignDangChay({ t: "C", nguonMacDinh: null, siteIds: [w.id], quyTac: [{ typeId: loaiX.id, sourceGroupId: nguon.id }] }); // kích hoạt ĐƯỢC: có quy tắc sống
    expect((await dongCampaign(c.id)).status).toBe("ACTIVE");

    const dtX = await doiTac("DX", loaiX.id);
    const dtY = await doiTac("DY", loaiY.id);
    const mX = await thanhVien(dtX.id, c.id);
    const mY = await thanhVien(dtY.id, c.id);
    const dem = (partyId: string) => db.affiliateTrackingAsset.count({ where: { partyId } });
    const demAudit = () => db.auditLog.count({ where: { action: "AFFILIATE_LINK_PHAT", actorName: NGUOI.ten } });

    // ĐỐI CHỨNG DƯƠNG: loại X có quy tắc ⇒ phát được
    const lienX = await phatOk({ partyId: dtX.id, membershipId: mX.id, siteId: w.id, landingPath: "/khoa-robot" });
    expect(await dem(dtX.id)).toBe(1);
    const audit1 = await demAudit();

    // loại Y: campaign không có quy tắc/nguồn mặc định cho Y ⇒ CHẶN, không ghi gì
    const chan = await phat({ partyId: dtY.id, membershipId: mY.id, siteId: w.id, landingPath: "/khoa-robot" });
    expect(chan.ok).toBe(false);
    if (chan.ok) return;
    expect(chan.truong).toBe("chung");
    expect(chan.loi).toMatch(/chưa có nguồn khách/);
    expect(chan.loi).toMatch(/tab Campaign/);
    expect(await dem(dtY.id)).toBe(0);
    expect(await demAudit()).toBe(audit1);

    // khai quy tắc cho loại Y (fixture trực tiếp: quy tắc chỉ thêm được khi campaign không ACTIVE) ⇒ phát được
    await db.affiliateCampaignRule.create({ data: { campaignId: c.id, typeId: loaiY.id, tagId: null, ruleKey: `T:${loaiY.id}|G:*`, sourceGroupId: nguon.id } });
    await phatOk({ partyId: dtY.id, membershipId: mY.id, siteId: w.id, landingPath: "/khoa-robot" });
    expect(await dem(dtY.id)).toBe(1);

    // nguồn bị NGỪNG sau kích hoạt ⇒ link MỚI bị chặn, nguyên nhân nói đúng là của nguồn
    await db.leadSourceGroup.update({ where: { id: nguon.id }, data: { status: "INACTIVE" } });
    const ngung = await phat({ partyId: dtX.id, membershipId: mX.id, siteId: w.id, landingPath: "/khoa-robot" });
    expect(ngung.ok).toBe(false);
    if (!ngung.ok) {
      expect(ngung.loi).toMatch(/đang không dùng được/);
      expect(ngung.loi).toContain(`Nguồn «${nguon.name}»`);
      expect(ngung.loi).not.toMatch(/chưa có nguồn khách/); // đây là nguồn CÓ nhưng hỏng, không phải «chưa quy nguồn»
    }
    expect(await dem(dtX.id)).toBe(1);

    // XOAY MÃ không bị chặn bởi nguồn hỏng (đóng cửa một mã đang lộ)
    const xoay = await xoayLink({ nguoi: NGUOI, id: lienX.id, updatedAtDaThay: new Date(lienX.updatedAt), lyDo: "Mã bị lộ trên mạng xã hội", now: NOW });
    expect(xoay.ok).toBe(true);
    expect(await db.affiliateTrackingAsset.count({ where: { partyId: dtX.id, status: "ACTIVE" } })).toBe(1);
    expect(await db.affiliateTrackingAsset.count({ where: { partyId: dtX.id, status: "REVOKED" } })).toBe(1);

    // nguồn hoạt động trở lại ⇒ phát được (cổng đọc trạng thái SỐNG, không nhớ lần chặn trước)
    await db.leadSourceGroup.update({ where: { id: nguon.id }, data: { status: "ACTIVE" } });
    expect((await phat({ partyId: dtX.id, membershipId: mX.id, siteId: w.id, landingPath: "/khoa-robot" })).ok).toBe(true);
  });

  it("[SRC-INT-03b] cổng ĐỐI TÁC `tuTaoLink` đi qua CÙNG cổng nguồn: đối tác thiếu mapping tự tạo link ⇒ từ chối, 0 link; có mapping ⇒ tạo được", async () => {
    const nguon = await taoNhom("N");
    const loaiX = await db.affiliateType.create({ data: { code: ma("TX"), name: `Loại X ${P}` } });
    const loaiY = await db.affiliateType.create({ data: { code: ma("TY"), name: `Loại Y ${P}` } });
    const w = await taoSiteBangDichVu({ t: "W", baseUrl: "https://sin-03b.example.test", domains: ["sin-03b.example.test"], trang: [{ path: "/khoa-robot" }] });
    const c = await campaignDangChay({ t: "C", nguonMacDinh: null, siteIds: [w.id], quyTac: [{ typeId: loaiX.id, sourceGroupId: nguon.id }] });
    const uX = await seedUser({ email: `sin-tk-x-${hau().toLowerCase()}@ci.test`, role: "PARENT", name: TEN_PHIEN, phone: null });
    const uY = await seedUser({ email: `sin-tk-y-${hau().toLowerCase()}@ci.test`, role: "PARENT", name: TEN_PHIEN, phone: null });
    const dtX = await doiTac("DX", loaiX.id, uX.id);
    const dtY = await doiTac("DY", loaiY.id, uY.id);
    const mX = await thanhVien(dtX.id, c.id);
    const mY = await thanhVien(dtY.id, c.id);
    const vao = (membershipId: string) => ({ membershipId, siteId: w.id, landingPageId: null, landingPath: "/khoa-robot" });

    const y = await tuTaoLink({ nguoi: { userId: uY.id, ten: TEN_PHIEN }, vao: vao(mY.id), now: NOW });
    expect(y.ok).toBe(false);
    // đối tác KHÔNG đọc cấu hình nội bộ: câu riêng, không nhắc «nguồn» / «tab Campaign»
    if (!y.ok) expect(y).toEqual({ ok: false, loi: LOI_CHUONG_TRINH_CHUA_SAN_SANG, truong: "chung" });
    if (!y.ok) expect(y.loi).not.toMatch(/tab Campaign|nguồn/i);
    expect(await db.affiliateTrackingAsset.count({ where: { partyId: dtY.id } })).toBe(0);

    const x = await tuTaoLink({ nguoi: { userId: uX.id, ten: TEN_PHIEN }, vao: vao(mX.id), now: NOW });
    expect(x.ok).toBe(true);
    expect(await db.affiliateTrackingAsset.count({ where: { partyId: dtX.id } })).toBe(1);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  it("[SRC-INT-04] dữ liệu LỊCH SỬ thiếu mapping (link có từ trước cổng) ⇒ khách vẫn lưu; referral MANUAL_REVIEW kèm LÝ DO, không gắn người giới thiệu, hiện ở hàng chờ xem tay; bổ sung mapping KHÔNG tự đổi referral cũ; lượt gửi mới ⇒ VALID", async () => {
    const w = await taoSiteBangDichVu({ t: "W", baseUrl: "https://sin-04.example.test", domains: ["sin-04.example.test"], trang: [{ path: "/khoa-robot" }] });
    const origin = "https://sin-04.example.test";
    const camp = await campaignDangChay({ t: "C", nguonMacDinh: null, siteIds: [w.id], kichHoat: false });
    await db.affiliateCampaign.update({ where: { id: camp.id }, data: { status: "ACTIVE" } }); // dữ liệu cũ: campaign chạy từ TRƯỚC cổng kích hoạt (không qua `doiTrangThaiCampaign`)
    const dt = await doiTac("D", null);
    const m = await thanhVien(dt.id, camp.id);
    const lien = await db.affiliateTrackingAsset.create({ data: { partyId: dt.id, membershipId: m.id, campaignId: camp.id, siteId: w.id, landingPath: "/khoa-robot", publicToken: sinhToken(), type: "LINK", status: "ACTIVE" } });

    const dau = await guiIntake(bieuMau(lien.publicToken), origin);
    expect(dau.kq.status).toBe(200); // người gọi không thấy gì khác thường
    const lead = await docLead(dau.sdt);
    const r1 = await docReferral(lead.id);
    expect(r1.status).toBe("MANUAL_REVIEW");
    expect(r1.resolutionReason ?? "").toMatch(/cấu hình/i); // KHÔNG câm: có lý do đọc được
    expect(lead.attribution!.referrerAffiliateId).toBeNull(); // không ai được ghi công
    expect(lead.attribution!.matchedRule).not.toBe("AFFILIATE_REFERRAL");
    expect(await demReferralCanXemTay(actorHo())).toBeGreaterThanOrEqual(1); // nằm ở hàng chờ xem tay

    // bổ sung mapping về sau: referral CŨ không tự đổi (lịch sử không bị viết lại); lượt MỚI ⇒ VALID
    const nguon = await taoNhom("N");
    await db.affiliateCampaign.update({ where: { id: camp.id }, data: { defaultSourceGroupId: nguon.id } });
    expect((await docReferral(lead.id)).status).toBe("MANUAL_REVIEW");
    const moi = await guiIntake(bieuMau(lien.publicToken), origin);
    const lead2 = await docLead(moi.sdt);
    const r2 = await docReferral(lead2.id);
    expect(r2.status).toBe("VALID");
    expect(r2.sourceGroupId).toBe(nguon.id);
    expect(lead2.attribution!.referrerAffiliateId).toBe(dt.id);
    expect(lead2.attribution!.group.code).toBe(nguon.code);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  it("[SRC-INT-05] token / mã / nhãn / utm KHÔNG thành nguồn: nhãn link, utm.source, note mang tên nhóm nguồn khác ⇒ nhóm vẫn là nhóm của CAMPAIGN; token = mã nhóm ⇒ không referral", async () => {
    const nguon = await taoNhom("N");
    const khac = await taoNhom("K");
    const w = await taoSiteBangDichVu({ t: "W", baseUrl: "https://sin-05.example.test", domains: ["sin-05.example.test"], trang: [{ path: "/khoa-robot" }] });
    const origin = "https://sin-05.example.test";
    const c = await campaignDangChay({ t: "C", nguonMacDinh: nguon.id, siteIds: [w.id] });
    const dt = await doiTac("D", null);
    const m = await thanhVien(dt.id, c.id);
    // nhãn của link mang MÃ MỘT NHÓM KHÁC (và «PAID_ADS» — nhóm hệ thống)
    const lien = await phatOk({ partyId: dt.id, membershipId: m.id, siteId: w.id, landingPath: "/khoa-robot", label: khac.code });
    const a = await guiIntake(bieuMau(lien.token, { utm: { source: "PAID_ADS", utm_source: khac.code, utm_campaign: "EMPLOYEE_REFERRAL" }, note: `${khac.code} PAID_ADS` }), origin);
    const lead = await docLead(a.sdt);
    expect(lead.attribution!.group.code).toBe(nguon.code); // nhóm của CAMPAIGN, không phải chuỗi nào trong payload
    expect(lead.attribution!.referrerAffiliateId).toBe(dt.id);
    expect(lead.source).toBe("affiliate"); // nhãn kỹ thuật cố định

    // token là CHỮ trùng mã một nhóm nguồn ⇒ không phải token ⇒ khách lưu, KHÔNG referral/đối tác
    const b = await guiIntake(bieuMau(khac.code.toUpperCase().slice(0, 10)), origin);
    expect(b.kq.status).toBe(200);
    const lead2 = await docLead(b.sdt);
    expect(await db.affiliateReferral.count({ where: { leadId: lead2.id, status: "VALID" } })).toBe(0);
    expect(lead2.attribution?.referrerAffiliateId ?? null).toBeNull();
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  it("[SRC-INT-06] ĐA WEBSITE: quatang.edu.vn · covua.quatang.edu.vn · satarobo.vn · website tuỳ biến cùng MỘT campaign ⇒ CÙNG nhóm nguồn; cùng website hai campaign khác nguồn ⇒ hai nhóm khác; đổi nguồn mặc định SAU khi có lead ⇒ lead cũ giữ snapshot", async () => {
    const nA = await taoNhom("NA");
    const nB = await taoNhom("NB");
    // website tên/mã GIỐNG một nguồn khác — host/tên website không được quyết nguồn
    const wQt = await taoSiteBangDichVu({
      t: "QT",
      baseUrl: "https://quatang.edu.vn",
      domains: ["quatang.edu.vn", "covua.quatang.edu.vn"],
      trang: [{ path: "/khoa-robot" }, { host: "covua.quatang.edu.vn", path: "/giai-dau/*" }],
    });
    const wSr = await taoSiteBangDichVu({ t: "SR", baseUrl: "https://satarobo.vn", domains: ["satarobo.vn"], trang: [{ path: "/khoa-hoc/*" }] });
    const wTuyBien = await taoSiteBangDichVu({ t: "PAIDADS", baseUrl: "https://sin-tuy-bien.example.test", domains: ["sin-tuy-bien.example.test"], trang: [{ path: "/dang-ky/*" }] });
    const cA = await campaignDangChay({ t: "CA", nguonMacDinh: nA.id, siteIds: [wQt.id, wSr.id, wTuyBien.id] });
    const cB = await campaignDangChay({ t: "CB", nguonMacDinh: nB.id, siteIds: [wQt.id] });
    const dt = await doiTac("D", null);
    const mA = await thanhVien(dt.id, cA.id);
    const mB = await thanhVien(dt.id, cB.id);

    const luot = [
      { ten: "quatang.edu.vn", site: wQt.id, trang: wQt.trangId[0]!, path: "/khoa-robot", origin: "https://quatang.edu.vn" },
      { ten: "covua.quatang.edu.vn", site: wQt.id, trang: wQt.trangId[1]!, path: "/giai-dau/2027", origin: "https://covua.quatang.edu.vn" },
      { ten: "satarobo.vn", site: wSr.id, trang: wSr.trangId[0]!, path: "/khoa-hoc/robot", origin: "https://satarobo.vn" },
      { ten: "website tuỳ biến", site: wTuyBien.id, trang: wTuyBien.trangId[0]!, path: "/dang-ky/robot", origin: "https://sin-tuy-bien.example.test" },
    ];
    const lead: Record<string, string> = {};
    for (const l of luot) {
      const lien = await phatOk({ partyId: dt.id, membershipId: mA.id, siteId: l.site, landingPageId: l.trang, landingPath: l.path });
      const g = await guiIntake(bieuMau(lien.token), l.origin);
      expect(g.kq.status, l.ten).toBe(200);
      const ld = await docLead(g.sdt);
      const rf = await docReferral(ld.id);
      expect(rf.status, l.ten).toBe("VALID");
      expect(ld.attribution!.group.code, l.ten).toBe(nA.code); // host KHÔNG quyết nguồn
      expect(rf.sourceGroupId, l.ten).toBe(nA.id);
      expect(ld.attribution!.referrerAffiliateId, l.ten).toBe(dt.id);
      lead[l.ten] = ld.id;
    }
    // đối chứng: cùng website quatang, campaign KHÁC ⇒ nhóm KHÁC
    const lienB = await phatOk({ partyId: dt.id, membershipId: mB.id, siteId: wQt.id, landingPageId: wQt.trangId[0]!, landingPath: "/khoa-robot" });
    const gB = await guiIntake(bieuMau(lienB.token), "https://quatang.edu.vn");
    const ldB = await docLead(gB.sdt);
    expect(ldB.attribution!.group.code).toBe(nB.code);
    expect((await docReferral(ldB.id)).campaignId).toBe(cB.id);

    // đổi nguồn mặc định của campaign A SAU khi đã có lead ⇒ lead cũ giữ NGUYÊN (snapshot), lead mới theo nguồn mới
    const nC = await taoNhom("NC");
    await db.affiliateCampaign.update({ where: { id: cA.id }, data: { defaultSourceGroupId: nC.id } });
    for (const [ten, id] of Object.entries(lead)) {
      const ld = await db.lead.findUniqueOrThrow({ where: { id }, select: { attribution: { include: { group: { select: { code: true } } } } } });
      expect(ld.attribution!.group.code, `${ten} sau khi đổi nguồn campaign`).toBe(nA.code);
      expect((await docReferral(id)).sourceGroupId, ten).toBe(nA.id);
    }
    const lienMoi = await phatOk({ partyId: dt.id, membershipId: mA.id, siteId: wSr.id, landingPageId: wSr.trangId[0]!, landingPath: "/khoa-hoc/robot" });
    const gMoi = await guiIntake(bieuMau(lienMoi.token), "https://satarobo.vn");
    expect((await docLead(gMoi.sdt)).attribution!.group.code).toBe(nC.code);
  });

  it("[SRC-INT-06b] quatang.edu.vn qua webhook RIÊNG (D19) khi website quatang cũng nằm trong Affiliate: lead KHÔNG mang attribution Affiliate dù `aff_ma_link_cuoi` trùng token đang sống; nhóm = nhóm đường vào, không phải nhóm campaign", async () => {
    const nA = await taoNhom("NA");
    const w = await taoSiteBangDichVu({ t: "QT", baseUrl: "https://quatang.edu.vn", domains: ["quatang.edu.vn", "covua.quatang.edu.vn"], trang: [{ path: "/khoa-robot" }] });
    const c = await campaignDangChay({ t: "C", nguonMacDinh: nA.id, siteIds: [w.id] });
    const dt = await doiTac("D", null);
    const m = await thanhVien(dt.id, c.id);
    const lien = await phatOk({ partyId: dt.id, membershipId: m.id, siteId: w.id, landingPath: "/khoa-robot" });
    const sdt = sdtMoi();
    const res = await quatangPost(
      new NextRequest("http://localhost/api/public/webhook/quatang", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ipMoi(), "x-webhook-secret": SECRET_QT },
        body: JSON.stringify({ ho_ten_con: `${P} Bé Quà`, ho_ten: `${P} PH quatang`, sdt, event_id: `sin-qt-${hau().toLowerCase()}`, aff_ma_link_cuoi: lien.token, aff_ma_link_dau: lien.token }),
      }),
    );
    expect(res.status).toBe(200);
    const ld = await docLead(sdt);
    expect(ld.source).toBe("quatang");
    expect(ld.attribution!.group.code).not.toBe(nA.code);
    expect(ld.attribution!.referrerAffiliateId).toBeNull();
    expect(await db.affiliateReferral.count({ where: { leadId: ld.id } })).toBe(0);
    expect(await db.referralClick.count({ where: { assetId: lien.id } })).toBe(0);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  it("[SRC-INT-07] CLICK-CLAIM: schema đúng migration (PK clickId, FK CASCADE tới ReferralClick, RLS bật); `clk` dùng MỘT lần; lượt hai bị xem tay, KHÔNG nhân đôi; phản hồi công khai lượt hai ≡ lượt đầu; gửi lại CHÍNH biểu mẫu đầu vẫn VALID", async () => {
    // — schema do migration `20261028090000_affiliate_click_claim` dựng (đọc từ catalog, không từ Prisma) —
    const cot = await db.$queryRaw<{ column_name: string; is_nullable: string }[]>`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'AffiliateClickClaim' ORDER BY ordinal_position`;
    expect(cot.map((x) => x.column_name)).toEqual(["clickId", "idempotencyKey", "createdAt"]);
    expect(cot.every((x) => x.is_nullable === "NO")).toBe(true);
    const khoaChinh = await db.$queryRaw<{ attname: string }[]>`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = '"AffiliateClickClaim"'::regclass AND i.indisprimary`;
    expect(khoaChinh.map((x) => x.attname)).toEqual(["clickId"]);
    const fk = await db.$queryRaw<{ ref: string; xoa: string }[]>`SELECT confrelid::regclass::text AS ref, confdeltype::text AS xoa FROM pg_constraint WHERE conrelid = '"AffiliateClickClaim"'::regclass AND contype = 'f'`;
    expect(fk).toEqual([{ ref: '"ReferralClick"', xoa: "c" }]); // ON DELETE CASCADE
    const rls = await db.$queryRaw<{ relrowsecurity: boolean }[]>`SELECT relrowsecurity FROM pg_class WHERE oid = '"AffiliateClickClaim"'::regclass`;
    expect(rls[0]?.relrowsecurity).toBe(true);

    // — hành vi: dùng một lần —
    const nguon = await taoNhom("N");
    const w = await taoSiteBangDichVu({ t: "W", baseUrl: "https://sin-07.example.test", domains: ["sin-07.example.test"], trang: [{ path: "/khoa-robot" }] });
    const origin = "https://sin-07.example.test";
    const c = await campaignDangChay({ t: "C", nguonMacDinh: nguon.id, siteIds: [w.id] });
    const dt = await doiTac("D", null);
    const m = await thanhVien(dt.id, c.id);
    const lien = await phatOk({ partyId: dt.id, membershipId: m.id, siteId: w.id, landingPath: "/khoa-robot" });
    const click = await db.referralClick.create({ data: { assetId: lien.id, campaignId: c.id, partyId: dt.id, outcome: "OK", occurredAt: new Date("2026-10-12T03:00:00.000Z") } });

    const f1 = bieuMau(lien.token, { clickId: click.id });
    const a = await guiIntake(f1, origin);
    const ld1 = await docLead(a.sdt);
    expect((await docReferral(ld1.id)).status).toBe("VALID");
    expect((await db.affiliateClickClaim.findUniqueOrThrow({ where: { clickId: click.id } })).idempotencyKey).toBe(f1.idempotencyKey);

    // lượt hai: KHÁC biểu mẫu, CÙNG clk ⇒ xem tay, không đối tác, không nhân đôi giữ chỗ
    const b = await guiIntake(bieuMau(lien.token, { clickId: click.id }), origin);
    const ld2 = await docLead(b.sdt);
    const r2 = await docReferral(ld2.id);
    expect(r2.status).toBe("MANUAL_REVIEW");
    expect((r2.sourceSnapshot as { click?: string }).click).toBe("DA_DUNG"); // lý do xem tay được GHI (không câm)
    expect(ld2.attribution!.referrerAffiliateId).toBeNull();
    expect(await db.affiliateClickClaim.count({ where: { clickId: click.id } })).toBe(1);
    expect(await db.affiliateReferral.count({ where: { partyId: dt.id, status: "VALID" } })).toBe(1);

    // phản hồi công khai: lượt hai ≡ lượt đầu (không lộ trạng thái CRM / membership / nhóm nguồn)
    expect(b.kq.status).toBe(a.kq.status);
    expect(b.kq.body).toEqual(a.kq.body);
    expect(b.cho).toEqual(a.cho);
    const tho = JSON.stringify(b.kq.body);
    for (const khongLo of [dt.code, dt.id, m.id, nguon.code, nguon.id, "membership", "MANUAL_REVIEW", "VALID"]) expect(tho).not.toContain(khongLo);

    // gửi lại CHÍNH biểu mẫu đầu (cùng khoá) ⇒ vẫn là người giữ chỗ, không thành lead thứ ba
    const lai = await guiIntake(f1, origin);
    expect(lai.kq.status).toBe(200);
    expect(await db.lead.count({ where: { phone: { in: bienThe(a.sdt) }, deletedAt: null } })).toBe(1);
    expect(await db.affiliateReferral.count({ where: { partyId: dt.id } })).toBe(2);

    // lớp GIỮ CHỖ (không chỉ kiểm referral cũ): `clk` đã bị giữ bởi biểu mẫu KHÁC mà CHƯA có referral (lượt đầu chết giữa chừng) ⇒ lượt này vẫn bị chặn
    const click2 = await db.referralClick.create({ data: { assetId: lien.id, campaignId: c.id, partyId: dt.id, outcome: "OK", occurredAt: new Date("2026-10-12T04:00:00.000Z") } });
    await db.affiliateClickClaim.create({ data: { clickId: click2.id, idempotencyKey: khoa() } });
    const c2 = await guiIntake(bieuMau(lien.token, { clickId: click2.id }), origin);
    const r3 = await docReferral((await docLead(c2.sdt)).id);
    expect(r3.status).toBe("MANUAL_REVIEW");
    expect((r3.sourceSnapshot as { click?: string }).click).toBe("DA_DUNG");

    // ĐUA: ba biểu mẫu khác nhau cùng một `clk` ⇒ đúng MỘT referral VALID, đúng MỘT dòng giữ chỗ
    const click3 = await db.referralClick.create({ data: { assetId: lien.id, campaignId: c.id, partyId: dt.id, outcome: "OK", occurredAt: new Date("2026-10-12T05:00:00.000Z") } });
    const dua = await Promise.all([0, 1, 2].map(() => guiIntake(bieuMau(lien.token, { clickId: click3.id }), origin)));
    const refs = await Promise.all(dua.map(async (d) => (await docReferral((await docLead(d.sdt)).id)).status));
    expect(refs.filter((x) => x === "VALID")).toHaveLength(1);
    expect(refs.filter((x) => x === "MANUAL_REVIEW")).toHaveLength(2);
    expect(await db.affiliateClickClaim.count({ where: { clickId: click3.id } })).toBe(1);
  });

  it("[SRC-INT-08] PHONE_ENUMERATION vẫn ĐÓNG: ngưỡng 700 ms + nhiễu 0..150 ms nguyên văn; lead MỚI · SĐT đã có · xem tay · bị từ chối ⇒ CÙNG status, CÙNG thân, CÙNG số lần chờ", async () => {
    expect(DO_TRE_TOI_THIEU_MS).toBe(700);
    expect(DO_TRE_TOI_THIEU_MS + DO_TRE_NHIEU_TOI_DA_MS).toBe(850);

    const nguon = await taoNhom("N");
    const w = await taoSiteBangDichVu({ t: "W", baseUrl: "https://sin-08.example.test", domains: ["sin-08.example.test"], trang: [{ path: "/khoa-robot" }] });
    const origin = "https://sin-08.example.test";
    const c = await campaignDangChay({ t: "C", nguonMacDinh: nguon.id, siteIds: [w.id] });
    const dt = await doiTac("D", null);
    const m = await thanhVien(dt.id, c.id);
    const lien = await phatOk({ partyId: dt.id, membershipId: m.id, siteId: w.id, landingPath: "/khoa-robot" });

    const sdt = sdtMoi();
    const moi = await guiIntake(bieuMau(lien.token, { phone: sdt }), origin); // lead MỚI → VALID
    const daCo = await guiIntake(bieuMau(lien.token, { phone: sdt }), origin); // CÙNG SĐT ⇒ trùng
    const xemTay = await guiIntake(bieuMau(lien.token), null); // thiếu Origin lẫn clk ⇒ xem tay
    await db.affiliateTrackingAsset.update({ where: { id: lien.id }, data: { status: "REVOKED", revokedAt: new Date("2026-10-01T00:00:00.000Z"), revokedReason: "thu hồi fixture SIN" } });
    const tuChoi = await guiIntake(bieuMau(lien.token), origin); // link đã thu hồi ⇒ từ chối
    const trangThai = (await db.affiliateReferral.findMany({ where: { partyId: dt.id }, select: { status: true } })).map((r) => r.status).sort();
    expect(trangThai).toEqual(["MANUAL_REVIEW", "REJECTED", "REJECTED_DUPLICATE", "VALID"]); // đối chứng dương: bốn nhánh THẬT sự khác nhau trong DB…
    for (const x of [daCo, xemTay, tuChoi]) {
      expect(x.kq.status).toBe(moi.kq.status); // …mà người gọi không phân biệt được
      expect(x.kq.body).toEqual(moi.kq.body);
      expect(x.cho).toEqual(moi.cho);
    }
    expect(moi.cho).toEqual([DO_TRE_TOI_THIEU_MS + 40]);
  });
});
