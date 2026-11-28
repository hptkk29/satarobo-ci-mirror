// @vitest-environment node
/**
 * [AHD-*] HỢP ĐỒNG CÔNG KHAI của hai đường nhận khách từ website ngoài + hồi quy bảo mật token + ma trận chống trùng (CLOSEOUT Affiliate · lane L5a).
 * Tài liệu hợp đồng: docs/source-commission/closeout/quatang-hop-dong-intake.md. Ghi chú đo đạc: docs/source-commission/closeout/l5a-hop-dong-bao-mat.md.
 *
 *   [AHD-WEB-*]   MỘT website tuỳ biến do Admin thêm (qua DỊCH VỤ taoWebsite · themTrangDich · phatLink, không INSERT tay website/link):
 *                 token công khai → membership → campaign → ánh xạ nguồn → referral → Lead; client KHÔNG đưa được nguồn/đối tác/tỉ lệ.
 *   [AHD-QT-*]    quatang.edu.vn qua đường RIÊNG hiện hành (webhook, quyết định D19): GHIM đúng thứ nó làm hôm nay — không nối Affiliate.
 *   [AHD-TOK-*]   hồi quy bảo mật token §26: một bảng biến thể × ba đường (intake · /r/:token · beacon) trên Postgres THẬT.
 *   [AHD-IDM-*]   ma trận idempotency / trùng §27 (cùng key · cùng SĐT · cùng/khác đối tác · cùng/khác campaign · song song).
 *   [AHD-OFF-*]   cờ `affiliate.enabled` TẮT §65.
 *   [AHD-LOG-*]   nhật ký không chứa PII/token §66.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `AHD`. LUẬT 18: mỗi ca tự dựng hiện trường (chuỗi link, danh mục, cờ). LUẬT 19: ngày TUYỆT ĐỐI; đồng hồ của đường công khai là đồng hồ thật nên mọi
 * mốc hiệu lực trong fixture đặt rất xa hai phía (2020 / 2099).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "10.9.9.7" }) }));

import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { POST as intakePost, OPTIONS as intakeOptions } from "../../app/api/public/affiliate/v1/intake/route";
import { POST as clickPost, OPTIONS as clickOptions } from "../../app/api/public/affiliate/v1/click/route";
import { GET as rGet } from "../../app/(public)/r/[token]/route";
import { POST as quatangPost } from "../../app/api/public/webhook/quatang/route";
import { sinhToken, BANG_CHU_CROCKFORD } from "../../lib/affiliate/token";
import { taoWebsite, themTrangDich } from "../../lib/affiliate/ghi-website";
import { phatLink } from "../../lib/affiliate/ghi-link";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "AHD";
const CASE = 120_000;
const HOST = "ahd-doi-tac.example.test";
const ORIGIN = `https://${HOST}`;
const TRANG = "/khoa-robot";
const MAT_KHAU_QUATANG = "ahd-quatang-khoa-thu-nghiem-32-ky-tu!!";

/** Dãy SĐT của spec này: 0907 10xxxx — không đụng AFI (0906…) khi hai bộ chạy tuần tự trên cùng DB. */
let sdtSeq = 0;
const sdtMoi = () => `090710${String((sdtSeq += 1)).padStart(4, "0")}`;
const bienThe = (s: string) => [s, `84${s.slice(1)}`];

let seq = 0;
const ma = (t: string) => `${P}_${t}${(seq += 1)}`;

async function don(): Promise<void> {
  const leads = await db.lead.findMany({
    where: { OR: [{ parentName: { startsWith: P } }, { phone: { startsWith: "8490710" } }, { phone: { startsWith: "090710" } }] },
    select: { id: true },
  });
  const ids = leads.map((l) => l.id);
  await db.affiliateReferral.deleteMany({ where: { OR: [{ party: { code: { startsWith: P } } }, { leadId: { in: ids } }] } });
  if (ids.length > 0) {
    await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  await db.webhookDelivery.deleteMany({ where: { source: "quatang", externalId: { startsWith: "ahd-" } } });
  // Sổ lượt bấm CHỈ-THÊM (trigger chặn xoá). Chỉ ca test mới tắt trigger để dọn hiện trường của chính nó, rồi bật lại ngay.
  await db.$executeRaw`ALTER TABLE "ReferralClick" DISABLE TRIGGER "ReferralClick_chi_them"`;
  try {
    await db.referralClick.deleteMany({ where: { asset: { party: { code: { startsWith: P } } } } });
  } finally {
    await db.$executeRaw`ALTER TABLE "ReferralClick" ENABLE TRIGGER "ReferralClick_chi_them"`;
  }
  await db.affiliateTrackingAsset.deleteMany({ where: { party: { code: { startsWith: P } } } });
  await db.affiliateMembership.deleteMany({ where: { party: { code: { startsWith: P } } } });
  const camp = await db.affiliateCampaign.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const cid = camp.map((c) => c.id);
  await db.affiliateCampaignRule.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaignSite.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaign.deleteMany({ where: { id: { in: cid } } });
  const sites = await db.affiliateSite.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  await db.affiliateLandingPage.deleteMany({ where: { siteId: { in: sites.map((s) => s.id) } } });
  await db.affiliateSite.deleteMany({ where: { code: { startsWith: P } } });
  await db.affiliatePartyTag.deleteMany({ where: { party: { code: { startsWith: P } } } });
  await db.affiliate.deleteMany({ where: { code: { startsWith: P } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: P } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } });
  await db.auditLog.deleteMany({ where: { actorName: "Fixture AHD" } });
  await db.systemSetting.deleteMany({ where: { key: { in: ["affiliate.enabled"] } } });
}

type Over = {
  nguonMacDinh?: boolean;
  allowSelf?: boolean;
  doiTacSdt?: string | null;
  site?: Record<string, unknown>;
  trangDichBat?: boolean;
  khongGanSite?: boolean;
  campaign?: Record<string, unknown>;
  party?: Record<string, unknown>;
  membership?: Record<string, unknown>;
  asset?: Record<string, unknown>;
};

/** Một chuỗi link ĐẦY ĐỦ: nguồn → website(+trang đích) → campaign → loại → đối tác → membership → link. `over` làm HỎNG đúng một mắt xích. */
async function dungHienTruong(over: Over = {}) {
  const nhom = await db.leadSourceGroup.create({
    data: { code: ma("S"), name: "Nguồn KOL fixture AHD", sourceType: "PARTNER", referrerRequirement: "NONE", sortOrder: 900, status: "ACTIVE", selectable: true },
  });
  const site = await db.affiliateSite.create({
    data: {
      code: ma("W"),
      name: "Web fixture AHD",
      baseUrl: ORIGIN,
      allowedDomains: [HOST],
      status: "ACTIVE",
      trackingEnabled: true,
      landingPages: { create: { pathPattern: TRANG, isActive: over.trangDichBat ?? true } },
      ...over.site,
    },
  });
  const campaign = await db.affiliateCampaign.create({
    data: {
      code: ma("C"),
      name: "Campaign fixture AHD",
      status: "ACTIVE",
      cookieWindowDays: 30,
      protectWindowDays: 90,
      allowSelfReferral: over.allowSelf ?? false,
      defaultSourceGroupId: over.nguonMacDinh === false ? null : nhom.id,
      ...(over.khongGanSite ? {} : { sites: { create: { siteId: site.id } } }),
      ...over.campaign,
    },
  });
  const loai = await db.affiliateType.create({ data: { code: ma("T"), name: "Loại fixture AHD" } });
  const doiTac = await db.affiliate.create({
    data: { code: ma("D"), name: "Đối tác fixture AHD", status: "ACTIVE", isActive: true, typeId: loai.id, phone: over.doiTacSdt ?? null, ...over.party },
  });
  const mem = await db.affiliateMembership.create({
    data: { partyId: doiTac.id, campaignId: campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), ...over.membership },
  });
  const token = sinhToken();
  const asset = await db.affiliateTrackingAsset.create({
    data: { partyId: doiTac.id, membershipId: mem.id, campaignId: campaign.id, siteId: site.id, landingPath: TRANG, publicToken: token, type: "LINK", status: "ACTIVE", ...over.asset },
  });
  return { nhom, site, campaign, loai, doiTac, mem, asset, token };
}
type HienTruong = Awaited<ReturnType<typeof dungHienTruong>>;

/** Thêm một ĐỐI TÁC khác vào CÙNG campaign + website (membership + link riêng). */
async function themDoiTac(h: HienTruong) {
  const doiTac = await db.affiliate.create({ data: { code: ma("D"), name: "Đối tác thứ hai AHD", status: "ACTIVE", isActive: true, typeId: h.loai.id } });
  const mem = await db.affiliateMembership.create({ data: { partyId: doiTac.id, campaignId: h.campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  const token = sinhToken();
  const asset = await db.affiliateTrackingAsset.create({
    data: { partyId: doiTac.id, membershipId: mem.id, campaignId: h.campaign.id, siteId: h.site.id, landingPath: TRANG, publicToken: token, type: "LINK", status: "ACTIVE" },
  });
  return { doiTac, mem, asset, token };
}

/** Thêm một CAMPAIGN khác (cùng website, cùng nguồn mặc định) cho CÙNG đối tác. */
async function themCampaign(h: HienTruong) {
  const campaign = await db.affiliateCampaign.create({
    data: { code: ma("C"), name: "Campaign thứ hai AHD", status: "ACTIVE", cookieWindowDays: 30, protectWindowDays: 90, defaultSourceGroupId: h.nhom.id, sites: { create: { siteId: h.site.id } } },
  });
  const mem = await db.affiliateMembership.create({ data: { partyId: h.doiTac.id, campaignId: campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  const token = sinhToken();
  const asset = await db.affiliateTrackingAsset.create({
    data: { partyId: h.doiTac.id, membershipId: mem.id, campaignId: campaign.id, siteId: h.site.id, landingPath: TRANG, publicToken: token, type: "LINK", status: "ACTIVE" },
  });
  return { campaign, mem, asset, token };
}

async function datLaiCo(): Promise<void> {
  await damBaoDanhMucGoc(db);
  await datCoNguon(CO_NGUON_DAY_DU);
  await db.systemSetting.deleteMany({ where: { key: "affiliate.enabled" } });
  await db.systemSetting.create({ data: { key: "affiliate.enabled", valueJson: true } });
  clearSettingsCache();
}

let ipSeq = 0;
const ipMoi = () => {
  ipSeq += 1;
  return `10.78.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
};

/**
 * R9·T2: thiếu CẢ Origin lẫn `clk` ⇒ XEM TAY, nên MẶC ĐỊNH các ca hợp đồng gửi từ website của đối tác (`ORIGIN`) — như trình duyệt thật. `origin: null` = cố ý KHÔNG gửi Origin (gọi từ máy chủ).
 */
function goiIntake(body: unknown, opts: { origin?: string | null; ip?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "text/plain", "x-forwarded-for": opts.ip ?? ipMoi() };
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.origin = origin;
  return intakePost(new NextRequest("http://localhost/api/public/affiliate/v1/intake", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers }));
}

function goiBeacon(body: unknown, opts: { origin?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "text/plain", "x-forwarded-for": ipMoi() };
  if (opts.origin) headers.origin = opts.origin;
  return clickPost(new NextRequest("http://localhost/api/public/affiliate/v1/click", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers }));
}

function goiR(token: string) {
  return rGet(new NextRequest(`https://satarobo.vn/r/${encodeURIComponent(token)}`, { headers: { "x-forwarded-for": ipMoi() } }), { params: Promise.resolve({ token }) });
}

let keySeq = 0;
const khoa = () => `ahd-key-${Date.now().toString(36)}-${(keySeq += 1)}`;
const bieuMau = (h: { token: string }, sdt: string, over: Record<string, unknown> = {}) => ({
  v: 1,
  token: h.token,
  idempotencyKey: khoa(),
  parentName: `${P} Phụ huynh`,
  phone: sdt,
  children: [{ fullName: `${P} Bé An` }],
  consentMarketing: true,
  ...over,
});

const docLeadTheoSdt = async (sdt: string) => {
  const l = await db.lead.findFirstOrThrow({ where: { phone: { in: bienThe(sdt) }, deletedAt: null }, select: { id: true } });
  return db.lead.findUniqueOrThrow({
    where: { id: l.id },
    select: { id: true, source: true, eventId: true, centerId: true, assignedToId: true, attribution: { include: { group: { select: { code: true } } } } },
  });
};
const soLead = (sdt: string) => db.lead.count({ where: { phone: { in: bienThe(sdt) }, deletedAt: null } });
const soReferralCuaLead = (leadId: string) => db.affiliateReferral.count({ where: { leadId } });

/** Toàn bộ header trừ tên được bỏ (mặc định ACAO — chỗ DUY NHẤT được phép khác nhau). */
const dauHeader = (r: Response, bo: readonly string[] = ["access-control-allow-origin"]) =>
  [...r.headers.entries()].filter(([k]) => !bo.includes(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Đổi đúng MỘT ký tự trong bảng chữ (khác ký tự cũ) — token chắc chắn khác, vẫn đúng định dạng. */
function doiMotKyTu(token: string, vt: number): string {
  const cu = token[vt]!;
  const moi = BANG_CHU_CROCKFORD[(BANG_CHU_CROCKFORD.indexOf(cu) + 1) % BANG_CHU_CROCKFORD.length]!;
  return token.slice(0, vt) + moi + token.slice(vt + 1);
}

// ── Bảng biến thể «link tồn tại nhưng KHÔNG hợp lệ» ────────────────────────────────────────────────────────────
const QUA_KHU = { from: new Date("2020-01-01T00:00:00.000Z"), to: new Date("2020-06-01T00:00:00.000Z") };
const TUONG_LAI = new Date("2099-01-01T00:00:00.000Z");

type BienThe = { ma: string; ten: string; over: Over };
const BIEN_THE_KHONG_HOP_LE: readonly BienThe[] = [
  { ma: "LINK_DA_THU_HOI", ten: "link bị thu hồi", over: { asset: { status: "REVOKED", revokedAt: new Date("2026-10-01T00:00:00.000Z"), revokedReason: "thu hồi fixture AHD" } } },
  { ma: "DOI_TAC_KHONG_HOAT_DONG", ten: "đối tác bị tạm khoá (SUSPENDED)", over: { party: { status: "SUSPENDED" } } },
  { ma: "DOI_TAC_KHONG_HOAT_DONG", ten: "đối tác đã kết thúc (ENDED)", over: { party: { status: "ENDED" } } },
  { ma: "THANH_VIEN_KHONG_HOAT_DONG", ten: "membership SUSPENDED", over: { membership: { status: "SUSPENDED" } } },
  { ma: "THANH_VIEN_KHONG_HOAT_DONG", ten: "membership ENDED", over: { membership: { status: "ENDED" } } },
  { ma: "THANH_VIEN_HET_HAN", ten: "membership hết hạn (effectiveTo trong quá khứ)", over: { membership: { effectiveFrom: QUA_KHU.from, effectiveTo: QUA_KHU.to } } },
  { ma: "THANH_VIEN_CHUA_HIEU_LUC", ten: "membership chưa tới ngày hiệu lực", over: { membership: { effectiveFrom: TUONG_LAI } } },
  { ma: "CAMPAIGN_KHONG_HOAT_DONG", ten: "campaign PAUSED", over: { campaign: { status: "PAUSED" } } },
  { ma: "CAMPAIGN_KHONG_HOAT_DONG", ten: "campaign DRAFT", over: { campaign: { status: "DRAFT" } } },
  { ma: "CAMPAIGN_KHONG_HOAT_DONG", ten: "campaign ENDED", over: { campaign: { status: "ENDED" } } },
  { ma: "CAMPAIGN_HET_HAN", ten: "campaign hết hạn (effectiveTo trong quá khứ)", over: { campaign: { effectiveFrom: QUA_KHU.from, effectiveTo: QUA_KHU.to } } },
  { ma: "CAMPAIGN_CHUA_HIEU_LUC", ten: "campaign chưa tới ngày hiệu lực", over: { campaign: { effectiveFrom: TUONG_LAI } } },
  { ma: "WEBSITE_KHONG_HOAT_DONG", ten: "website INACTIVE", over: { site: { status: "INACTIVE" } } },
  { ma: "THEO_DOI_DANG_TAT", ten: "website tắt theo dõi", over: { site: { trackingEnabled: false } } },
  { ma: "TRANG_DICH_KHONG_CON", ten: "trang đích bị tắt", over: { trangDichBat: false } },
  { ma: "SITE_KHONG_GAN_CAMPAIGN", ten: "website không còn gắn campaign", over: { khongGanSite: true } },
];

describe.skipIf(!RUN)("hợp đồng công khai · bảo mật token · chống trùng (Affiliate closeout L5a)", () => {
  beforeAll(async () => {
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["CENTER_SALES_CSM"] });
  }, 180_000);

  beforeEach(async () => {
    process.env.WEBHOOK_QUATANG_SECRET = MAT_KHAU_QUATANG;
    // Trang chủ dự phòng của `/r` nay đến từ MỘT biến cấu hình (AFFILIATE_PUBLIC_ORIGIN) — không còn tên miền cứng trong mã (AFF-WEB). Các ca dưới ghim "token lạ ⇒ về trang chủ" nên phải đặt gốc của môi trường.
    // Ca KHÔNG cấu hình ⇒ `Location: /` tương đối nằm ở app/(public)/r/[token]/route.test.ts [RT-04].
    vi.stubEnv("AFFILIATE_PUBLIC_ORIGIN", "https://satarobo.vn");
    await don();
    await datLaiCo();
  }, CASE);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await don();
    delete process.env.WEBHOOK_QUATANG_SECRET;
    await db.$disconnect();
  }, 180_000);

  // ══════════════════════════════════════════════════════════════════════════════════════════════════════════
  // WEB — website tuỳ biến do Admin thêm, dựng bằng DỊCH VỤ thật
  // ══════════════════════════════════════════════════════════════════════════════════════════════════════════
  describe("website tuỳ biến (đường Affiliate)", () => {
    const NGUOI = { userId: "fx-ahd-user", ten: "Fixture AHD" };
    const NOW = new Date("2026-10-13T03:00:00.000Z");

    /** Admin thêm website → thêm trang đích → (campaign/membership dựng tay: dịch vụ riêng, ngoài phạm vi hợp đồng này) → phát link BẰNG DỊCH VỤ. */
    async function adminThemWebsiteMoi() {
      const hostMoi = "ahd-website-moi.example.com";
      const w = await taoWebsite({ nguoi: NGUOI, vao: { code: ma("W"), name: "Website tuỳ biến AHD", baseUrl: `https://${hostMoi}`, allowedDomains: [hostMoi], trackingEnabled: true, defaultCampaignId: null } });
      if (!w.ok) throw new Error(`fixture website: ${w.loi}`);
      const td = await themTrangDich({ nguoi: NGUOI, vao: { siteId: w.id, pathPattern: "/dang-ky/*", label: "Đăng ký" } });
      if (!td.ok) throw new Error(`fixture trang đích: ${td.loi}`);
      const nhom = await db.leadSourceGroup.create({ data: { code: ma("S"), name: "Nguồn website mới AHD", sourceType: "PARTNER", referrerRequirement: "NONE", sortOrder: 900, status: "ACTIVE", selectable: true } });
      const campaign = await db.affiliateCampaign.create({
        data: { code: ma("C"), name: "Campaign website mới AHD", status: "ACTIVE", cookieWindowDays: 30, protectWindowDays: 90, defaultSourceGroupId: nhom.id, sites: { create: { siteId: w.id } } },
      });
      const loai = await db.affiliateType.create({ data: { code: ma("T"), name: "Loại AHD" } });
      const doiTac = await db.affiliate.create({ data: { code: ma("D"), name: "Đối tác website mới AHD", status: "ACTIVE", isActive: true, typeId: loai.id } });
      const mem = await db.affiliateMembership.create({ data: { partyId: doiTac.id, campaignId: campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
      const link = await phatLink({ nguoi: NGUOI, now: NOW, vao: { partyId: doiTac.id, membershipId: mem.id, siteId: w.id, landingPath: "/dang-ky/khoa-robot", type: "LINK", label: null } });
      if (!link.ok) throw new Error(`fixture link: ${link.loi}`);
      return { hostMoi, originMoi: `https://${hostMoi}`, nhom, campaign, doiTac, mem, siteId: w.id, token: link.token };
    }

    it("[AHD-WEB-01] token do DỊCH VỤ phát → biểu mẫu từ website mới ⇒ Lead + nguồn = nguồn CẤU HÌNH của campaign + người hưởng = đối tác trên link; referral VALID; ACAO phản chiếu origin của website", async () => {
      const w = await adminThemWebsiteMoi();
      const sdt = sdtMoi();
      const res = await goiIntake(bieuMau(w, sdt), { origin: w.originMoi });
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe(w.originMoi);
      expect(res.headers.get("vary")).toContain("Origin");
      expect(res.headers.get("cache-control")).toContain("no-store");

      const lead = await docLeadTheoSdt(sdt);
      expect(lead.source).toBe("affiliate"); // nguồn KỸ THUẬT cố định, không phải nguồn nghiệp vụ
      expect(lead.eventId).toMatch(/^affiliate:ahd-key-/);
      expect(lead.attribution!.matchedRule).toBe("AFFILIATE_REFERRAL");
      expect(lead.attribution!.group.code).toBe(w.nhom.code); // nguồn nghiệp vụ = cấu hình campaign
      expect(lead.attribution!.referrerAffiliateId).toBe(w.doiTac.id);
      const r = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: lead.id } });
      expect(r.status).toBe("VALID");
      expect(r.membershipId).toBe(w.mem.id);
      expect(r.campaignId).toBe(w.campaign.id);
      expect(r.sourceGroupId).toBe(w.nhom.id);
    }, CASE);

    it("[AHD-WEB-02] Origin của website KHÁC (kể cả website khác của cùng hệ thống) ⇒ khách vẫn lưu, referral MANUAL_REVIEW, KHÔNG ACAO, người giới thiệu không gắn", async () => {
      const w = await adminThemWebsiteMoi();
      const sdt = sdtMoi();
      const res = await goiIntake(bieuMau(w, sdt), { origin: ORIGIN }); // ORIGIN = website khác, không phải của link này
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      const lead = await docLeadTheoSdt(sdt);
      const r = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: lead.id } });
      expect(r.status).toBe("MANUAL_REVIEW");
      expect(lead.attribution!.referrerAffiliateId).toBeNull();
    }, CASE);

    it("[AHD-WEB-03] KHÔNG TIN FRONTEND: nguồn/đối tác/tỉ lệ/nhân viên/trạng thái referral trong thân ⇒ 400 và không lead; `utm`/`note`/`centerCode`/`parentName` mang nội dung kẻ gian KHÔNG đổi nguồn hay người hưởng", async () => {
      const w = await adminThemWebsiteMoi();
      const sdt = sdtMoi();
      const khoaLa = [
        { affiliateId: w.doiTac.id },
        { partyId: w.doiTac.id },
        { sourceGroupId: w.nhom.id },
        { source: "quatang" },
        { leadSource: "PAID_ADS" },
        { commissionRate: 0.5 },
        { rate: 9 },
        { employeeId: "x" },
        { employeeCode: "NV001" },
        { campaignId: w.campaign.id },
        { membershipId: w.mem.id },
        { status: "VALID" },
        { referralStatus: "VALID" },
        { assetId: "x" },
        { createdAt: "2020-01-01" },
        { eventId: "affiliate:x" },
      ];
      for (const them of khoaLa) {
        const res = await goiIntake({ ...bieuMau(w, sdt), ...them }, { origin: w.originMoi });
        expect(res.status, JSON.stringify(them)).toBe(400);
      }
      // khoá lạ trong phần tử `children` cũng bị từ chối (strict lồng)
      expect((await goiIntake(bieuMau(w, sdt, { children: [{ fullName: `${P} Bé`, interestedCourseId: "x" }] }))).status).toBe(400);
      expect(await soLead(sdt)).toBe(0);
      expect(await db.affiliateReferral.count({ where: { partyId: w.doiTac.id } })).toBe(0);

      // Nội dung hợp lệ về HÌNH DẠNG nhưng mang ý đồ giả mạo: không tác dụng.
      const res = await goiIntake(
        bieuMau(w, sdt, {
          parentName: `${P} ADMIN affiliateId=${w.doiTac.id}`,
          note: `source=quatang rate=9 affiliateId=${w.doiTac.id}`,
          centerCode: "KHONG-CO",
          utm: { utm_source: "quatang", utm_campaign: "PAID_ADS", utm_medium: "../../x" },
        }),
        { origin: w.originMoi },
      );
      expect(res.status).toBe(200);
      const lead = await docLeadTheoSdt(sdt);
      expect(lead.source).toBe("affiliate");
      expect(lead.attribution!.matchedRule).toBe("AFFILIATE_REFERRAL");
      expect(lead.attribution!.group.code).toBe(w.nhom.code);
      expect(lead.attribution!.referrerAffiliateId).toBe(w.doiTac.id);
    }, CASE);

    it("[AHD-WEB-04] hợp đồng CORS: preflight OPTIONS ⇒ 204 KHÔNG ACAO (client phải gửi `text/plain`); gửi `application/json` vẫn được MÁY CHỦ xử lý (trình duyệt mới là bên chặn)", async () => {
      const w = await adminThemWebsiteMoi();
      for (const opt of [intakeOptions, clickOptions]) {
        const pre = await opt();
        expect(pre.status).toBe(204);
        expect(pre.headers.get("access-control-allow-origin")).toBeNull();
        expect(pre.headers.get("access-control-allow-methods")).toBeNull();
        expect(await pre.text()).toBe("");
      }
      const sdt = sdtMoi();
      const res = await intakePost(
        new NextRequest("http://localhost/api/public/affiliate/v1/intake", {
          method: "POST",
          body: JSON.stringify(bieuMau(w, sdt)),
          headers: { "content-type": "application/json", origin: w.originMoi, "x-forwarded-for": ipMoi() },
        }),
      );
      expect(res.status).toBe(200);
      expect(await soLead(sdt)).toBe(1);
    }, CASE);

    it("[AHD-WEB-05] giới hạn hình dạng: thân > 16 384 ký tự ⇒ 413; JSON hỏng ⇒ 400; SĐT hỏng ⇒ 400; khoá lặp lại sai định dạng ⇒ 400; token > 40 ký tự ⇒ 400 — không ca nào tạo lead", async () => {
      const w = await adminThemWebsiteMoi();
      const sdt = sdtMoi();
      expect((await goiIntake("x".repeat(16_385))).status).toBe(413);
      expect((await goiIntake("{không phải json")).status).toBe(400);
      expect((await goiIntake(bieuMau(w, "abc"))).status).toBe(400);
      expect((await goiIntake(bieuMau(w, sdt, { idempotencyKey: "ngan" }))).status).toBe(400);
      expect((await goiIntake(bieuMau(w, sdt, { idempotencyKey: "có dấu cách và tiếng việt!!" }))).status).toBe(400);
      expect((await goiIntake(bieuMau({ token: "A".repeat(41) }, sdt))).status).toBe(400);
      expect((await goiIntake(bieuMau(w, sdt, { note: "n".repeat(501) }))).status).toBe(400);
      expect((await goiIntake(bieuMau(w, sdt, { children: new Array(6).fill({ fullName: "a" }) }))).status).toBe(400);
      expect(await soLead(sdt)).toBe(0);
    }, CASE);

    it("[AHD-WEB-06] giới hạn tần suất theo IP: 10 lượt/phút/IP ⇒ lượt thứ 11 là 429 (thân chung, không lộ gì); IP khác không bị ảnh hưởng", async () => {
      const w = await adminThemWebsiteMoi();
      const ip = ipMoi();
      // Thân hợp lệ về HÌNH DẠNG nhưng SĐT hỏng: chạm hàng rào tần suất (đứng SAU kiểm hình dạng) mà không tạo lead.
      const xau = (n: number) => bieuMau(w, "abc", { idempotencyKey: `ahd-rl-${n}-${Date.now().toString(36)}` });
      for (let i = 1; i <= 10; i += 1) expect((await goiIntake(xau(i), { ip })).status).toBe(400);
      const qua = await goiIntake(xau(11), { ip });
      expect(qua.status).toBe(429);
      expect(await qua.json()).toEqual({ ok: false, message: "Bạn gửi hơi nhanh. Đợi một phút rồi thử lại nhé." });
      expect((await goiIntake(xau(12), { ip: ipMoi() })).status).toBe(400); // IP khác: không dính
    }, CASE);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════════════════
  // QT — quatang.edu.vn: đường RIÊNG hiện hành (D19). Ghim hành vi hôm nay.
  // ══════════════════════════════════════════════════════════════════════════════════════════════════════════
  describe("quatang.edu.vn (đường webhook riêng — D19)", () => {
    const payloadQt = (over: Record<string, unknown> = {}) => ({
      ho_ten_con: `${P} Bé Quà`,
      ho_ten: `${P} Phụ huynh quatang`,
      sdt: "0907100901",
      email: "ahd-quatang@example.com",
      truong: "Trường AHD",
      lop: "Lớp 3",
      co_so: "211 Nguyễn Hữu Thọ, Đà Nẵng",
      tinh: "Đà Nẵng",
      event_id: `ahd-qt-${Date.now().toString(36)}-${(keySeq += 1)}`,
      ...over,
    });
    function goiQt(body: unknown, opts: { secret?: string | null; ip?: string; contentLength?: number } = {}) {
      const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.ip ?? ipMoi() };
      if (opts.secret !== null) headers["x-webhook-secret"] = opts.secret ?? MAT_KHAU_QUATANG;
      if (opts.contentLength !== undefined) headers["content-length"] = String(opts.contentLength);
      return quatangPost(new NextRequest("http://localhost/api/public/webhook/quatang", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers }));
    }

    it("[AHD-QT-01] xác thực: thiếu/sai bí mật ⇒ 401 và KHÔNG ghi gì; bí mật đúng ⇒ 200; secret đặt qua query `?secret=` cũng được chấp nhận (ghi nhận hành vi hiện hành)", async () => {
      const sdt = "0907100901";
      expect((await goiQt(payloadQt(), { secret: null })).status).toBe(401);
      expect((await goiQt(payloadQt(), { secret: "sai-bi-mat" })).status).toBe(401);
      expect(await soLead(sdt)).toBe(0);
      expect(await db.webhookDelivery.count({ where: { source: "quatang", externalId: { startsWith: "ahd-" } } })).toBe(0);

      const ok = await goiQt(payloadQt());
      expect(ok.status).toBe(200);
      expect((await ok.json()) as { ok: boolean }).toMatchObject({ ok: true, duplicate: false });
      expect(await soLead(sdt)).toBe(1);

      const qs = await quatangPost(
        new NextRequest(`http://localhost/api/public/webhook/quatang?secret=${encodeURIComponent(MAT_KHAU_QUATANG)}`, {
          method: "POST",
          body: JSON.stringify(payloadQt({ sdt: "0907100902" })),
          headers: { "x-forwarded-for": ipMoi() },
        }),
      );
      expect(qs.status).toBe(200);
      expect(await soLead("0907100902")).toBe(1);
    }, CASE);

    it("[AHD-QT-02] ĐÚNG THỨ NÓ LÀM HÔM NAY: Lead.source = `quatang` (không phải `affiliate`), eventId = `quatang:<event_id>`, nguồn nghiệp vụ = đường vào mặc định WALK_IN (KH tự đến — chủ dự án 28/10/2026), KHÔNG dòng AffiliateReferral, KHÔNG người giới thiệu", async () => {
      const p = payloadQt();
      const res = await goiQt(p);
      expect(res.status).toBe(200);
      const lead = await docLeadTheoSdt("0907100901");
      expect(lead.source).toBe("quatang");
      expect(lead.eventId).toBe(`quatang:${p.event_id}`);
      expect(lead.attribution!.matchedRule).toBe("DUONG_VAO_MAC_DINH");
      expect(lead.attribution!.group.code).toBe("WALK_IN");
      expect(lead.attribution!.referrerAffiliateId).toBeNull();
      expect(await soReferralCuaLead(lead.id)).toBe(0);
    }, CASE);

    it("[AHD-QT-03] D19: tham số `aff_*` của quatang CHỈ vào ghi chú — kể cả khi `aff_ma_link_cuoi` TRÙNG một token Affiliate đang sống: KHÔNG referral, KHÔNG gắn đối tác, KHÔNG click, KHÔNG đổi nguồn", async () => {
      const h = await dungHienTruong();
      const p = payloadQt({ aff_ma_link_cuoi: h.token, aff_ma_link_dau: h.token, aff_click_id: "cm1abcdefghijklmnopqrstuv", aff_ten_nv: "Ten NV", aff_utm: "utm_source=x" });
      expect((await goiQt(p)).status).toBe(200);
      const lead = await docLeadTheoSdt("0907100901");
      expect(lead.attribution!.matchedRule).toBe("DUONG_VAO_MAC_DINH");
      expect(lead.attribution!.referrerAffiliateId).toBeNull();
      expect(await db.affiliateReferral.count({ where: { OR: [{ leadId: lead.id }, { partyId: h.doiTac.id }] } })).toBe(0);
      expect(await db.referralClick.count({ where: { assetId: h.asset.id } })).toBe(0);
      const ghiChu = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, select: { note: true } });
      expect(ghiChu.note ?? "").toContain(`Mã link giới thiệu: ${h.token}`); // đi vào Lead.note, và CHỈ vào đó
    }, CASE);

    it("[AHD-QT-04] KHÔNG TIN payload: `source`/`affiliateId`/`commissionRate`/`sourceGroupId` trong JSON bị BỎ QUA (không lỗi) — nguồn vẫn `quatang`, nhóm vẫn WALK_IN", async () => {
      const h = await dungHienTruong();
      const p = payloadQt({ source: "affiliate", affiliateId: h.doiTac.id, commissionRate: 0.9, sourceGroupId: h.nhom.id, leadSource: "MANUAL" });
      expect((await goiQt(p)).status).toBe(200);
      const lead = await docLeadTheoSdt("0907100901");
      expect(lead.source).toBe("quatang");
      expect(lead.attribution!.group.code).toBe("WALK_IN");
      expect(lead.attribution!.referrerAffiliateId).toBeNull();
    }, CASE);

    it("[AHD-QT-05] idempotency: cùng `event_id` ⇒ MỘT lead, lượt 2 trả `duplicate:true`, WebhookDelivery ghi DUPLICATE; chưa có `event_id` thì khoá dựng từ `ts`/`aff_thoi_diem_click` + SĐT", async () => {
      const p = payloadQt();
      const a = await goiQt(p);
      const b = await goiQt(p);
      expect(await a.json()).toMatchObject({ ok: true, duplicate: false });
      expect(await b.json()).toMatchObject({ ok: true, duplicate: true });
      expect(await soLead("0907100901")).toBe(1);
      const dl = await db.webhookDelivery.findMany({ where: { source: "quatang", externalId: p.event_id }, select: { status: true }, orderBy: { receivedAt: "asc" } });
      expect(dl.map((d) => d.status)).toEqual(["PROCESSED", "DUPLICATE"]);

      const khongId = payloadQt({ event_id: undefined, sdt: "0907100903", ts: "ahd-ts-1" });
      expect(await (await goiQt(khongId)).json()).toMatchObject({ duplicate: false });
      expect(await (await goiQt(khongId)).json()).toMatchObject({ duplicate: true });
      expect(await soLead("0907100903")).toBe(1);
      // Khoá dự phòng phải THẬT SỰ được dựng và lưu — nếu không thì lượt 2 vẫn «trùng» chỉ nhờ tra-trùng-SĐT của ingest và ca này xanh vì lý do sai.
      const khoaDuPhong = "ahd-ts-1-84907100903";
      expect((await docLeadTheoSdt("0907100903")).eventId).toBe(`quatang:${khoaDuPhong}`);
      expect(await db.webhookDelivery.count({ where: { source: "quatang", externalId: khoaDuPhong } })).toBe(2);
    }, CASE);

    it("[AHD-QT-06] SĐT hỏng ⇒ HTTP 200 `{ok:false}` (webhook không để nguồn retry bão hoà), WebhookDelivery FAILED giữ payload để gửi lại, KHÔNG lead", async () => {
      const p = payloadQt({ sdt: "12345" });
      const res = await goiQt(p);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: false });
      const dl = await db.webhookDelivery.findFirstOrThrow({ where: { source: "quatang", externalId: p.event_id }, select: { status: true, payload: true } });
      expect(dl.status).toBe("FAILED");
      expect((dl.payload as { sdt: string }).sdt).toBe("12345");
      expect(await db.lead.count({ where: { parentName: { startsWith: P } } })).toBe(0);
    }, CASE);

    it("[AHD-QT-07] hàng rào: 60 lượt/phút/IP ⇒ 429 (đứng TRƯỚC kiểm bí mật nên kẻ gian không thử khoá miễn phí); Content-Length > 100 000 ⇒ 413; GET/OPTIONS không có handler", async () => {
      const ip = ipMoi();
      for (let i = 0; i < 60; i += 1) expect((await goiQt({}, { secret: "sai", ip })).status).toBe(401);
      expect((await goiQt({}, { secret: "sai", ip })).status).toBe(429);
      expect((await goiQt(payloadQt(), { ip: ipMoi(), contentLength: 100_001 })).status).toBe(413);
      const mod = (await import("../../app/api/public/webhook/quatang/route")) as Record<string, unknown>;
      expect(Object.keys(mod).filter((k) => ["GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].includes(k))).toEqual([]);
    }, CASE);

    it("[AHD-QT-08] cờ `affiliate.enabled` KHÔNG gác đường quatang (đường riêng): cờ TẮT mà webhook vẫn nhận khách như cũ", async () => {
      await db.systemSetting.deleteMany({ where: { key: "affiliate.enabled" } });
      clearSettingsCache();
      expect((await goiQt(payloadQt())).status).toBe(200);
      expect(await soLead("0907100901")).toBe(1);
    }, CASE);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════════════════
  // TOK — hồi quy bảo mật token (§26)
  // ══════════════════════════════════════════════════════════════════════════════════════════════════════════
  describe("bảo mật token", () => {
    it("[AHD-TOK-01] ĐỐI CHỨNG DƯƠNG: token đúng ⇒ referral VALID; các dạng viết khác của CÙNG token (chữ thường · có khoảng trắng · gạch nối kiểu đọc qua điện thoại) ⇒ cũng VALID (chuẩn hoá là CHỦ Ý, cho mã nhập tay)", async () => {
      const h = await dungHienTruong();
      const dang: [string, string][] = [
        ["đúng nguyên văn", h.token],
        ["chữ thường", h.token.toLowerCase()],
        ["có khoảng trắng hai đầu và giữa", ` ${h.token.slice(0, 4)} ${h.token.slice(4)} `],
        ["gạch nối nhóm 4-4-2", `${h.token.slice(0, 4)}-${h.token.slice(4, 8)}-${h.token.slice(8)}`],
      ];
      for (const [ten, tokenGui] of dang) {
        const sdt = sdtMoi();
        const res = await goiIntake(bieuMau({ token: tokenGui }, sdt));
        expect(res.status, ten).toBe(200);
        const lead = await docLeadTheoSdt(sdt);
        const r = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: lead.id } });
        expect(r.status, ten).toBe("VALID");
        expect(r.assetId, ten).toBe(h.asset.id);
      }
    }, CASE);

    it("[AHD-TOK-02] token KHÔNG TỒN TẠI / SỬA HỎNG ⇒ cùng status + cùng thân + cùng header với token đúng; khách vẫn lưu; KHÔNG dòng referral; không dòng click", async () => {
      const h = await dungHienTruong();
      const chuan = await goiIntake(bieuMau(h, sdtMoi())); // tham chiếu: token ĐÚNG, không Origin
      const thamChieu = { status: chuan.status, body: await chuan.json(), dau: dauHeader(chuan) };

      const hong: [string, string][] = [
        ["đổi 1 ký tự đầu", doiMotKyTu(h.token, 0)],
        ["đổi 1 ký tự giữa", doiMotKyTu(h.token, 5)],
        ["đổi 1 ký tự cuối", doiMotKyTu(h.token, 9)],
        ["không có trong DB (hợp lệ về hình dạng)", "ZZZZZZZZZZ"],
        ["thiếu 1 ký tự", h.token.slice(0, 9)],
        ["thừa 1 ký tự", `${h.token}A`],
        ["chứa ký tự ngoài bảng chữ (U)", `UUUUUUUUUU`],
        ["chỉ gạch/khoảng trắng", "----  ----"],
        ["33–40 ký tự (qua lược đồ, hỏng khi chuẩn hoá)", "A".repeat(36)],
      ];
      for (const [ten, tokenGui] of hong) {
        const sdt = sdtMoi();
        const res = await goiIntake(bieuMau({ token: tokenGui }, sdt));
        expect(res.status, ten).toBe(thamChieu.status);
        expect(await res.json(), ten).toEqual(thamChieu.body);
        expect(dauHeader(res), ten).toEqual(thamChieu.dau);
        const lead = await docLeadTheoSdt(sdt);
        expect(lead.attribution!.matchedRule, ten).not.toBe("AFFILIATE_REFERRAL");
        expect(lead.attribution!.referrerAffiliateId, ten).toBeNull();
        expect(await soReferralCuaLead(lead.id), ten).toBe(0);
      }
      // Hợp đồng LƯỢC ĐỒ: token > 40 ký tự hoặc rỗng bị 400 — lộ DUY NHẤT hình dạng yêu cầu, không lộ token nào có thật.
      expect((await goiIntake(bieuMau({ token: "A".repeat(41) }, sdtMoi()))).status).toBe(400);
      expect((await goiIntake(bieuMau({ token: "" }, sdtMoi()))).status).toBe(400);
      expect(await db.referralClick.count({ where: { assetId: h.asset.id } })).toBe(0);
    }, CASE);

    BIEN_THE_KHONG_HOP_LE.forEach((bt, vt) => {
      it(`[AHD-TOK-V${String(vt + 1).padStart(2, "0")}] (${bt.ma}) ${bt.ten} ⇒ ba đường KHÔNG lộ lý do: intake = phản hồi của token lạ; /r = 302 không tham số theo dõi; beacon = 204; referral REJECTED có lý do NỘI BỘ`, async () => {
        const h = await dungHienTruong(bt.over);
        const lat = await dungHienTruong(); // một link SỐNG khác làm đối chứng dương cho /r và beacon

        // ── intake ──
        const sdtV = sdtMoi();
        const sdtN = sdtMoi();
        const v = await goiIntake(bieuMau(h, sdtV));
        const n = await goiIntake(bieuMau({ token: "ZZZZZZZZZZ" }, sdtN));
        expect(v.status).toBe(n.status);
        expect(await v.json()).toEqual(await n.json());
        expect(dauHeader(v)).toEqual(dauHeader(n));

        const lead = await docLeadTheoSdt(sdtV);
        expect(lead.attribution!.matchedRule).not.toBe("AFFILIATE_REFERRAL");
        expect(lead.attribution!.referrerAffiliateId).toBeNull();
        expect(lead.attribution!.group.code).not.toBe(h.nhom.code);
        const r = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: lead.id } });
        expect(r.status).toBe("REJECTED");
        expect(r.resolutionReason).toBe(`LINK_KHONG_HOP_LE:${bt.ma}`);
        expect(r.rejectedAt).not.toBeNull();
        expect(r.protectedUntil).toBeNull();
        expect(await soReferralCuaLead((await docLeadTheoSdt(sdtN)).id)).toBe(0); // token lạ: không có dòng nào

        // ── /r/:token ──
        const rBad = await goiR(h.token);
        expect(rBad.status).toBe(302);
        expect(await rBad.text()).toBe("");
        const loc = rBad.headers.get("location") ?? "";
        expect(loc).not.toMatch(/[?&](aff|cmp|clk)=/);
        expect(loc).not.toContain(h.token);
        expect(loc).not.toContain(bt.ma);
        expect([`https://satarobo.vn/`, `${ORIGIN}${TRANG}`]).toContain(loc);
        const cookBad = rBad.headers.getSetCookie().map((c) => c.split("=")[0]);
        expect(cookBad).not.toContain("sr_aff"); // KHÔNG đặt cookie giới thiệu
        for (const [k, val] of rBad.headers.entries()) if (k !== "location") expect(val).not.toContain(bt.ma); // lý do không rò ra header
        const click = await db.referralClick.findMany({ where: { assetId: h.asset.id }, select: { outcome: true } });
        expect(click).toEqual([{ outcome: bt.ma }]); // chỉ SỔ NỘI BỘ biết lý do

        const rOk = await goiR(lat.token); // đối chứng dương: link sống ⇒ có tham số + cookie giới thiệu
        expect(rOk.headers.get("location")).toMatch(/[?&]aff=/);
        expect(rOk.headers.getSetCookie().map((c) => c.split("=")[0])).toContain("sr_aff");

        // ── beacon ──
        const thanBeacon = (token: string) => ({ v: 1, token, landingUrl: `${ORIGIN}${TRANG}` });
        const bBad = await goiBeacon(thanBeacon(h.token), { origin: ORIGIN });
        const bLa = await goiBeacon(thanBeacon("ZZZZZZZZZZ"), { origin: ORIGIN });
        expect(bBad.status).toBe(204);
        expect(bLa.status).toBe(204);
        expect(await bBad.text()).toBe("");
        expect(dauHeader(bBad)).toEqual(dauHeader(bLa));
        const sauBeacon = await db.referralClick.findMany({ where: { assetId: h.asset.id }, select: { outcome: true } });
        for (const c of sauBeacon) expect(c.outcome).toBe(bt.ma); // KHÔNG BAO GIỜ "OK" cho chuỗi hỏng
        expect(sauBeacon.length).toBeLessThanOrEqual(2);
      }, CASE);
    });

    it("[AHD-TOK-ACAO] CHỖ RÒ NHỎ ĐÃ BIẾT (ghim): `Access-Control-Allow-Origin` là header DUY NHẤT khác nhau, và chỉ khi token TỒN TẠI ∧ Origin khớp tên miền của link — kể cả link đã thu hồi; hệ quả = kẻ biết tên miền đối tác có thể phân biệt «token từng tồn tại» bằng cách giả header Origin", async () => {
      const h = await dungHienTruong({ asset: { status: "REVOKED", revokedAt: new Date("2026-10-01T00:00:00.000Z"), revokedReason: "thu hồi fixture AHD" } });
      const tonTai = await goiIntake(bieuMau(h, sdtMoi()), { origin: ORIGIN });
      const khongTon = await goiIntake(bieuMau({ token: "ZZZZZZZZZZ" }, sdtMoi()), { origin: ORIGIN });
      expect(tonTai.headers.get("access-control-allow-origin")).toBe(ORIGIN);
      expect(khongTon.headers.get("access-control-allow-origin")).toBeNull();
      // Mọi thứ còn lại vẫn đồng nhất:
      expect(tonTai.status).toBe(khongTon.status);
      expect(await tonTai.json()).toEqual(await khongTon.json());
      expect(dauHeader(tonTai)).toEqual(dauHeader(khongTon));
      // Origin lạ thì kẻ dò không thấy gì: ACAO vắng ở CẢ HAI.
      const lat1 = await goiIntake(bieuMau(h, sdtMoi()), { origin: "https://ke-la.example.test" });
      const lat2 = await goiIntake(bieuMau({ token: "ZZZZZZZZZZ" }, sdtMoi()), { origin: "https://ke-la.example.test" });
      expect(lat1.headers.get("access-control-allow-origin")).toBeNull();
      expect(lat2.headers.get("access-control-allow-origin")).toBeNull();
    }, CASE);

    it("[AHD-TOK-REDIR] CHỖ KHÁC BIỆT ĐÃ BIẾT của `/r/:token` (ghim): token KHÔNG tồn tại ⇒ về trang chủ, KHÔNG cookie nào; token TỒN TẠI nhưng chuỗi hỏng ⇒ về trang đích SẠCH của website + cookie phiên ẩn danh `sr_aff_s` (không có `sr_aff`). Lý do KHÔNG phân biệt được giữa các kiểu hỏng", async () => {
      const thuHoi = await dungHienTruong({ asset: { status: "REVOKED", revokedAt: new Date("2026-10-01T00:00:00.000Z"), revokedReason: "thu hồi fixture AHD" } });
      const hetHan = await dungHienTruong({ membership: { effectiveFrom: QUA_KHU.from, effectiveTo: QUA_KHU.to } });
      const dungToken = await goiR(thuHoi.token);
      const hetHanRes = await goiR(hetHan.token);
      const lat = await goiR("ZZZZZZZZZZ");
      // hai kiểu hỏng khác nhau ⇒ đầu ra GIỐNG NHAU (trừ giá trị cookie phiên ngẫu nhiên)
      expect(dungToken.headers.get("location")).toBe(`${ORIGIN}${TRANG}`);
      expect(hetHanRes.headers.get("location")).toBe(dungToken.headers.get("location"));
      expect(dungToken.headers.getSetCookie().map((c) => c.split("=")[0])).toEqual(hetHanRes.headers.getSetCookie().map((c) => c.split("=")[0]));
      // token lạ
      expect(lat.headers.get("location")).toBe("https://satarobo.vn/");
      expect(lat.headers.getSetCookie()).toEqual([]);
      expect(dungToken.headers.getSetCookie().map((c) => c.split("=")[0])).toEqual(["sr_aff_s"]);
      // Không lệch ở các header khác:
      // (`x-middleware-set-cookie` là bản sao nội bộ của Next cho `set-cookie`, không phải header thêm.)
      const boQua = ["location", "set-cookie", "x-middleware-set-cookie"];
      expect(dauHeader(dungToken, boQua)).toEqual(dauHeader(lat, boQua));
    }, CASE);

    it("[AHD-TOK-BEACON] beacon: MỌI nhánh lỗi đều 204 rỗng (thân hỏng · quá 4 096 ký tự · token lạ · landingUrl ngoài tên miền · open-redirect thử) và KHÔNG ghi click; link sống + landingUrl đúng ⇒ ghi OK", async () => {
      const h = await dungHienTruong();
      const gui = async (body: unknown, origin: string | null = ORIGIN) => {
        const res = await goiBeacon(body, { origin });
        expect(res.status).toBe(204);
        expect(await res.text()).toBe("");
        return res;
      };
      await gui("{khong phai json");
      await gui("x".repeat(4097));
      await gui({ v: 2, token: h.token, landingUrl: `${ORIGIN}${TRANG}` }); // sai phiên bản
      await gui({ v: 1, token: "ZZZZZZZZZZ", landingUrl: `${ORIGIN}${TRANG}` });
      await gui({ v: 1, token: h.token, landingUrl: `https://ke-la.example.test${TRANG}` });
      await gui({ v: 1, token: h.token, landingUrl: `${ORIGIN}${TRANG}@ke-la.example.test` });
      await gui({ v: 1, token: h.token, landingUrl: `${ORIGIN}/trang-khong-duoc-phep` });
      await gui({ v: 1, token: h.token, landingUrl: `http://${HOST}${TRANG}` }); // không https
      expect(await db.referralClick.count({ where: { assetId: h.asset.id } })).toBe(0);

      const ok = await gui({ v: 1, token: h.token, landingUrl: `${ORIGIN}${TRANG}?utm_source=fb&x=1#frag`, utm: { utm_source: "fb" } });
      expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
      const rows = await db.referralClick.findMany({ where: { assetId: h.asset.id }, select: { outcome: true, referrerHost: true } });
      expect(rows).toEqual([{ outcome: "OK", referrerHost: HOST }]);
    }, CASE);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════════════════
  // IDM — ma trận idempotency / trùng (§27)
  // ══════════════════════════════════════════════════════════════════════════════════════════════════════════
  describe("ma trận idempotency / trùng", () => {
    /** Mọi referral (mọi trạng thái) của các lead mang SĐT này. */
    const referralCuaSdt = (sdt: string) =>
      db.affiliateReferral.findMany({
        where: { lead: { phone: { in: bienThe(sdt) } } },
        select: { id: true, status: true, partyId: true, campaignId: true, assetId: true, leadId: true, idempotencyKey: true },
        orderBy: { createdAt: "asc" },
      });
    const soValid = (rs: { status: string }[]) => rs.filter((r) => r.status === "VALID").length;

    it("[AHD-IDM-01] CÙNG key, CÙNG mọi thứ ⇒ 1 lead, 1 referral, thân phản hồi như nhau (kể cả khi gửi lại với `parentName` khác)", async () => {
      const h = await dungHienTruong();
      const sdt = sdtMoi();
      const b = bieuMau(h, sdt);
      const a1 = await goiIntake(b);
      const a2 = await goiIntake({ ...b, parentName: `${P} Tên khác hẳn` });
      expect(a2.status).toBe(a1.status);
      expect(await a2.json()).toEqual(await a1.json());
      expect(await soLead(sdt)).toBe(1);
      const rs = await referralCuaSdt(sdt);
      expect(rs).toHaveLength(1);
      expect(rs[0]!.status).toBe("VALID");
    }, CASE);

    it("[AHD-IDM-02] CÙNG key, KHÁC SĐT (phát hiện) ⇒ lượt 2 được trả 200 NHƯNG bị coi là gửi lặp: KHÔNG lead thứ hai, khách thứ hai KHÔNG được lưu — ghim hành vi hiện hành", async () => {
      const h = await dungHienTruong();
      const [s1, s2] = [sdtMoi(), sdtMoi()];
      const b = bieuMau(h, s1);
      expect((await goiIntake(b)).status).toBe(200);
      const hai = await goiIntake({ ...b, phone: s2 });
      expect(hai.status).toBe(200);
      expect(await soLead(s1)).toBe(1);
      expect(await soLead(s2)).toBe(0); // ← khách thứ hai bị nuốt (xem notes: phát hiện LOW)
      expect((await referralCuaSdt(s2)).length).toBe(0);
    }, CASE);

    it("[AHD-IDM-03] CÙNG SĐT, KHÁC key, CÙNG đối tác + campaign ⇒ 1 lead; referral đầu VALID, referral sau REJECTED_DUPLICATE trỏ về lead cũ; đúng MỘT VALID", async () => {
      const h = await dungHienTruong();
      const sdt = sdtMoi();
      await goiIntake(bieuMau(h, sdt));
      await goiIntake(bieuMau(h, sdt));
      expect(await soLead(sdt)).toBe(1);
      const rs = await referralCuaSdt(sdt);
      expect(rs.map((r) => r.status)).toEqual(["VALID", "REJECTED_DUPLICATE"]);
      expect(new Set(rs.map((r) => r.leadId)).size).toBe(1);
      expect(soValid(rs)).toBe(1);
    }, CASE);

    it("[AHD-IDM-04] CÙNG SĐT, KHÁC ĐỐI TÁC (cùng campaign) ⇒ người đến trước giữ công; người sau REJECTED_DUPLICATE; attribution của lead KHÔNG đổi sang người sau", async () => {
      const h = await dungHienTruong();
      const b2 = await themDoiTac(h);
      const sdt = sdtMoi();
      await goiIntake(bieuMau(h, sdt));
      await goiIntake(bieuMau(b2, sdt));
      const rs = await referralCuaSdt(sdt);
      expect(rs).toHaveLength(2);
      expect(rs[0]).toMatchObject({ partyId: h.doiTac.id, status: "VALID" });
      expect(rs[1]).toMatchObject({ partyId: b2.doiTac.id, status: "REJECTED_DUPLICATE" });
      expect(soValid(rs)).toBe(1);
      const lead = await docLeadTheoSdt(sdt);
      expect(lead.attribution!.referrerAffiliateId).toBe(h.doiTac.id);
    }, CASE);

    it("[AHD-IDM-05] CÙNG SĐT, KHÁC CAMPAIGN (cùng đối tác) ⇒ campaign đến sau REJECTED_DUPLICATE; attribution vẫn campaign đầu", async () => {
      const h = await dungHienTruong();
      const c2 = await themCampaign(h);
      const sdt = sdtMoi();
      await goiIntake(bieuMau(h, sdt));
      await goiIntake(bieuMau(c2, sdt));
      const rs = await referralCuaSdt(sdt);
      expect(rs).toHaveLength(2);
      expect(rs[0]).toMatchObject({ campaignId: h.campaign.id, status: "VALID" });
      expect(rs[1]).toMatchObject({ campaignId: c2.campaign.id, status: "REJECTED_DUPLICATE" });
      expect(soValid(rs)).toBe(1);
      const lead = await docLeadTheoSdt(sdt);
      expect((lead.attribution!.signals as { affiliate: { campaignCode: string } }).affiliate.campaignCode).toBe(h.campaign.code);
    }, CASE);

    it("[AHD-IDM-06] KHÁC SĐT, CÙNG đối tác ⇒ hai lead, hai referral VALID (đối chứng dương: hai KHÁCH khác nhau thì đều được ghi công)", async () => {
      const h = await dungHienTruong();
      const [s1, s2] = [sdtMoi(), sdtMoi()];
      await goiIntake(bieuMau(h, s1));
      await goiIntake(bieuMau(h, s2));
      expect(await soLead(s1)).toBe(1);
      expect(await soLead(s2)).toBe(1);
      expect(soValid(await referralCuaSdt(s1))).toBe(1);
      expect(soValid(await referralCuaSdt(s2))).toBe(1);
    }, CASE);

    it("[AHD-IDM-07] khách ĐÃ có hồ sơ từ đường KHÔNG-Affiliate (quatang/web) ⇒ link giới thiệu đến sau KHÔNG cướp công: REJECTED_DUPLICATE, nguồn lead cũ nguyên vẹn", async () => {
      const h = await dungHienTruong();
      const sdt = sdtMoi();
      const qt = await quatangPost(
        new NextRequest("http://localhost/api/public/webhook/quatang", {
          method: "POST",
          body: JSON.stringify({ ho_ten: `${P} Phụ huynh quatang`, ho_ten_con: `${P} Bé`, sdt, event_id: `ahd-qt-idm07-${keySeq}` }),
          headers: { "x-webhook-secret": MAT_KHAU_QUATANG, "x-forwarded-for": ipMoi() },
        }),
      );
      expect(qt.status).toBe(200);
      const truoc = await docLeadTheoSdt(sdt);
      await goiIntake(bieuMau(h, sdt));
      const sau = await docLeadTheoSdt(sdt);
      expect(sau.id).toBe(truoc.id);
      expect(sau.attribution!.matchedRule).toBe(truoc.attribution!.matchedRule);
      expect(sau.attribution!.referrerAffiliateId).toBeNull();
      const rs = await referralCuaSdt(sdt);
      expect(rs).toHaveLength(1);
      expect(rs[0]!.status).toBe("REJECTED_DUPLICATE");
    }, CASE);

    it("[AHD-IDM-08] SONG SONG, CÙNG key: 2 request ⇒ 1 lead, 1 referral (UNIQUE eventId + UNIQUE idempotencyKey chặn) — nửa XÁC ĐỊNH của ma trận song song", async () => {
      const h = await dungHienTruong();
      const sdtA = sdtMoi();
      const bA = bieuMau(h, sdtA);
      const [r1, r2] = await Promise.all([goiIntake(bA), goiIntake(bA)]);
      expect([r1.status, r2.status]).toEqual([200, 200]);
      expect(await soLead(sdtA)).toBe(1);
      expect(await referralCuaSdt(sdtA)).toHaveLength(1);
    }, CASE);

    it("[AHD-IDM-09] SONG SONG, CÙNG SĐT khác key (3 request): chỉ khẳng định bất biến THEO LEAD — mỗi lead tối đa MỘT referral VALID. KHÔNG khẳng định «một khách = một lead»: race tra-trùng-SĐT của ingest chung ĐÃ BIẾT cho nhiều lead (đo 3/3 lead, xem notes lane, phát hiện F-IDM)", async () => {
      const h = await dungHienTruong();
      const sdtB = sdtMoi();
      const kq = await Promise.all([goiIntake(bieuMau(h, sdtB)), goiIntake(bieuMau(h, sdtB)), goiIntake(bieuMau(h, sdtB))]);
      for (const k of kq) expect(k.status).toBe(200);
      const rs = await referralCuaSdt(sdtB);
      // bất biến cứng: mỗi lead có TỐI ĐA một VALID
      const theoLead = new Map<string, number>();
      for (const r of rs) if (r.status === "VALID") theoLead.set(r.leadId!, (theoLead.get(r.leadId!) ?? 0) + 1);
      for (const [, n] of theoLead) expect(n).toBeLessThanOrEqual(1);
      expect(rs.length).toBeGreaterThanOrEqual(1);
    }, CASE);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════════════════
  // OFF — cờ `affiliate.enabled` TẮT (§65)
  // ══════════════════════════════════════════════════════════════════════════════════════════════════════════
  describe("cờ TẮT", () => {
    async function soDong(h: HienTruong, sdt: string) {
      return {
        lead: await soLead(sdt),
        referral: await db.affiliateReferral.count({ where: { partyId: h.doiTac.id } }),
        click: await db.referralClick.count({ where: { assetId: h.asset.id } }),
        attrAff: await db.leadAttribution.count({ where: { matchedRule: "AFFILIATE_REFERRAL", lead: { phone: { in: bienThe(sdt) } } } }),
      };
    }

    it("[AHD-OFF-01] `affiliate.enabled` TẮT ⇒ /intake VẪN LƯU khách như lead thường (200, ACAO đúng origin) nhưng KHÔNG referral · KHÔNG attribution Affiliate · KHÔNG lượt bấm; /click 404; /r chuyển trang đích SẠCH (không aff/cmp/clk, không cookie, không ghi lượt bấm)", async () => {
      const h = await dungHienTruong();
      await db.systemSetting.deleteMany({ where: { key: "affiliate.enabled" } });
      clearSettingsCache();
      const sdt = sdtMoi();

      const i = await goiIntake(bieuMau(h, sdt), { origin: ORIGIN });
      expect(i.status).toBe(200);
      expect(await i.json()).toEqual({ ok: true, message: "Đã nhận thông tin. Cảm ơn bạn!" });
      expect(i.headers.get("access-control-allow-origin")).toBe(ORIGIN);
      const c = await goiBeacon({ v: 1, token: h.token, landingUrl: `${ORIGIN}${TRANG}` }, { origin: ORIGIN });
      expect(c.status).toBe(404);
      expect(await c.text()).toBe("");
      const r = await goiR(h.token);
      expect(r.status).toBe(302);
      const dich = r.headers.get("location") ?? "";
      expect(dich.startsWith(`${ORIGIN}${TRANG}`)).toBe(true);
      expect(dich).not.toMatch(/[?&](aff|cmp|clk)=/);
      expect(r.headers.getSetCookie()).toEqual([]);

      // khách ĐƯỢC LƯU (1 lead thường); mọi thứ thuộc Affiliate = 0
      expect(await soDong(h, sdt)).toEqual({ lead: 1, referral: 0, click: 0, attrAff: 0 });
      expect((await intakeOptions()).status).toBe(204);
      expect((await clickOptions()).status).toBe(204);
    }, CASE);

    it("[AHD-OFF-02] cờ affiliate BẬT nhưng module Nguồn (`nguon.enabled`) TẮT ⇒ cũng KHÔNG ghi công: lead thường, không referral/attribution Affiliate (cờ con không được rò ra khi cờ tổng tắt); /r chuyển trang sạch", async () => {
      const h = await dungHienTruong();
      await datCoNguon({});
      const sdt = sdtMoi();
      expect((await goiIntake(bieuMau(h, sdt), { origin: ORIGIN })).status).toBe(200);
      const r = await goiR(h.token);
      expect(r.status).toBe(302);
      expect(r.headers.get("location") ?? "").not.toMatch(/[?&](aff|cmp|clk)=/);
      expect(await soDong(h, sdt)).toEqual({ lead: 1, referral: 0, click: 0, attrAff: 0 });
    }, CASE);

    it("[AHD-OFF-03] cờ TẮT ⇒ đường lead CŨ vẫn nhận khách như thường (quatang): có lead, KHÔNG attribution Affiliate", async () => {
      const h = await dungHienTruong();
      await db.systemSetting.deleteMany({ where: { key: "affiliate.enabled" } });
      clearSettingsCache();
      const sdt = sdtMoi();
      const res = await quatangPost(
        new NextRequest("http://localhost/api/public/webhook/quatang", {
          method: "POST",
          body: JSON.stringify({ ho_ten: `${P} PH off`, ho_ten_con: `${P} Bé`, sdt, event_id: `ahd-qt-off-${keySeq}` }),
          headers: { "x-webhook-secret": MAT_KHAU_QUATANG, "x-forwarded-for": ipMoi() },
        }),
      );
      expect(res.status).toBe(200);
      expect(await soDong(h, sdt)).toEqual({ lead: 1, referral: 0, click: 0, attrAff: 0 });
    }, CASE);

    it("[AHD-OFF-04] cờ BẬT lại ⇒ cùng link chạy ngay (đối chứng dương cho OFF-01: 404 là do CỜ chứ không phải do fixture hỏng)", async () => {
      const h = await dungHienTruong();
      const sdt = sdtMoi();
      expect((await goiIntake(bieuMau(h, sdt), { origin: ORIGIN })).status).toBe(200);
      expect((await soDong(h, sdt)).referral).toBe(1);
      expect((await goiR(h.token)).status).toBe(302);
    }, CASE);

    it("[AHD-OFF-05] cờ TẮT: token LẠ / origin LẠ vẫn lưu khách nhưng KHÔNG phản chiếu ACAO (chỉ origin trong allowedDomains của website của link mới được đọc câu trả lời); cùng thân trả lời cho mọi nhánh", async () => {
      const h = await dungHienTruong();
      await db.systemSetting.deleteMany({ where: { key: "affiliate.enabled" } });
      clearSettingsCache();
      const sdtLa = sdtMoi();
      const laToken = await goiIntake(bieuMau({ token: "ZZZZZZZZZZ" }, sdtLa), { origin: ORIGIN });
      expect(laToken.status).toBe(200);
      expect(laToken.headers.get("access-control-allow-origin")).toBeNull();
      const sdtOriginLa = sdtMoi();
      const originLa = await goiIntake(bieuMau(h, sdtOriginLa), { origin: "https://khong-duoc-phep.example.test" });
      expect(originLa.status).toBe(200);
      expect(originLa.headers.get("access-control-allow-origin")).toBeNull();
      expect(await originLa.json()).toEqual(await laToken.json());
      expect(await soLead(sdtLa)).toBe(1);
      expect(await soLead(sdtOriginLa)).toBe(1);
      expect((await soDong(h, sdtOriginLa)).referral).toBe(0);
    }, CASE);

    it("[AHD-OFF-06] cờ TẮT: gửi lặp cùng khoá chống trùng ⇒ vẫn MỘT lead (idempotency không phụ thuộc cờ)", async () => {
      const h = await dungHienTruong();
      await db.systemSetting.deleteMany({ where: { key: "affiliate.enabled" } });
      clearSettingsCache();
      const sdt = sdtMoi();
      const body = bieuMau(h, sdt);
      expect((await goiIntake(body, { origin: ORIGIN })).status).toBe(200);
      expect((await goiIntake(body, { origin: ORIGIN })).status).toBe(200);
      expect(await soLead(sdt)).toBe(1);
      expect((await soDong(h, sdt)).referral).toBe(0);
    }, CASE);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════════════════
  // LOG — nhật ký không rò PII / token (§66)
  // ══════════════════════════════════════════════════════════════════════════════════════════════════════════
  describe("nhật ký", () => {
    /** Mọi thứ đi ra console — gộp thành MỘT chuỗi để quét. Error được xổ cả message lẫn stack. */
    function bat() {
      const ra: string[] = [];
      const gom = (...a: unknown[]) => ra.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}\n${x.stack ?? ""}` : typeof x === "string" ? x : JSON.stringify(x))).join(" "));
      for (const k of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, k).mockImplementation(gom);
      return () => ra.join("\n");
    }

    it("[AHD-LOG-01] đường THÀNH CÔNG và đường link-hỏng (intake · /r · beacon) KHÔNG in tên/SĐT/email/token ra console", async () => {
      const doc = bat();
      const h = await dungHienTruong();
      const hong = await dungHienTruong({ asset: { status: "REVOKED", revokedAt: new Date("2026-10-01T00:00:00.000Z"), revokedReason: "thu hồi fixture AHD" } });
      const sdt = sdtMoi();
      const email = "ahd-pii-rieng@example.com";
      await goiIntake(bieuMau(h, sdt, { email, parentName: `${P} Họ Tên Rất Riêng` }), { origin: ORIGIN });
      await goiIntake(bieuMau(hong, sdtMoi(), { email }), { origin: ORIGIN });
      await goiIntake(bieuMau({ token: "ZZZZZZZZZZ" }, sdtMoi(), { email }));
      await goiR(h.token);
      await goiR(hong.token);
      await goiBeacon({ v: 1, token: h.token, landingUrl: `${ORIGIN}${TRANG}` }, { origin: ORIGIN });
      const log = doc();
      for (const bi of [sdt, sdt.slice(1), email, "Họ Tên Rất Riêng", h.token, hong.token]) expect(log, `rò «${bi}»`).not.toContain(bi);
    }, CASE);

    /**
     * Sự cố hạ tầng đúng hình dạng Prisma báo khi hết kết nối (P2024): thông điệp có tên lệnh gọi nhưng KHÔNG có giá trị đối số.
     * ⚠️ Cố ý KHÔNG dùng lỗi VALIDATION của Prisma: loại đó in cả đối số (token, SĐT…) và chính client Prisma tự ghi nó ra `prisma:error`
     * (lib/db.ts `log: ["error"]`) — kênh nằm ngoài tầm mã Affiliate. Từ cổng công khai với đầu vào đã chuẩn hoá thì không tới được lỗi loại đó (xem notes lane, mục 5).
     */
    const suCoHaTang = () =>
      new Prisma.PrismaClientKnownRequestError("Invalid `prisma.affiliateTrackingAsset.findUnique()` invocation:\n\nTimed out fetching a new connection from the connection pool.", {
        code: "P2024",
        clientVersion: "5.22.0",
      });

    it("[AHD-LOG-02] SỰ CỐ DB khi tra token (P2024 hết kết nối) ⇒ khách VẪN lưu (T4), phản hồi như thường, và nhật ký KHÔNG chứa token/SĐT/tên/email", async () => {
      const h = await dungHienTruong();
      const doc = bat();
      const sdt = sdtMoi();
      const email = "ahd-pii-log02@example.com";
      vi.spyOn(db.affiliateTrackingAsset, "findUnique").mockImplementation((() => Promise.reject(suCoHaTang())) as never);
      const res = await goiIntake(bieuMau(h, sdt, { email, parentName: `${P} Họ Tên Log02` }), { origin: ORIGIN });
      expect(res.status).toBe(200); // khách không mất vì hệ thống theo dõi hỏng
      expect(await soLead(sdt)).toBe(1);
      expect(await soReferralCuaLead((await docLeadTheoSdt(sdt)).id)).toBe(0);
      const log = doc();
      expect(log).toContain("[affiliate-intake]"); // đối chứng dương: sự cố ĐƯỢC ghi lại…
      for (const bi of [sdt, sdt.slice(1), email, "Họ Tên Log02", h.token]) expect(log, `rò «${bi}»`).not.toContain(bi); // …nhưng không kèm dữ liệu khách/token
    }, CASE);

    it("[AHD-LOG-03] SỰ CỐ DB khi tra token ở `/r` và beacon ⇒ vẫn 302/204 (khách không thấy lỗi) và nhật ký KHÔNG chứa token", async () => {
      const h = await dungHienTruong();
      const doc = bat();
      vi.spyOn(db.affiliateTrackingAsset, "findUnique").mockImplementation((() => Promise.reject(suCoHaTang())) as never);
      const r = await goiR(h.token);
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).toBe("https://satarobo.vn/");
      const b = await goiBeacon({ v: 1, token: h.token, landingUrl: `${ORIGIN}${TRANG}` }, { origin: ORIGIN });
      expect(b.status).toBe(204);
      const log = doc();
      expect(log).toContain("[affiliate]");
      expect(log).not.toContain(h.token);
    }, CASE);

    it("[AHD-LOG-04] SỰ CỐ DB khi GHI lead (trigger Postgres thật làm INSERT Lead nổ) ⇒ 500 câu chung không lộ nội bộ, và nhật ký KHÔNG chứa SĐT/tên/email/token", async () => {
      const h = await dungHienTruong();
      await db.$executeRaw`CREATE OR REPLACE FUNCTION ahd_no_lead() RETURNS trigger AS $f$ BEGIN IF NEW."parentName" LIKE 'AHD NO-LEAD%' THEN RAISE EXCEPTION 'ahd no-lead'; END IF; RETURN NEW; END; $f$ LANGUAGE plpgsql`;
      await db.$executeRaw`DROP TRIGGER IF EXISTS ahd_no_lead_trg ON "Lead"`;
      await db.$executeRaw`CREATE TRIGGER ahd_no_lead_trg BEFORE INSERT ON "Lead" FOR EACH ROW EXECUTE FUNCTION ahd_no_lead()`;
      try {
        const doc = bat();
        const sdt = sdtMoi();
        const email = "ahd-pii-log04@example.com";
        const res = await goiIntake(bieuMau(h, sdt, { email, parentName: "AHD NO-LEAD Họ Tên Log04" }), { origin: ORIGIN });
        expect(res.status).toBe(500);
        const than = JSON.stringify(await res.json());
        expect(than).toBe(JSON.stringify({ ok: false, message: "Chưa lưu được thông tin. Bạn thử lại giúp nhé." }));
        expect(await soLead(sdt)).toBe(0);
        const log = doc();
        expect(log).toContain("[intake:affiliate]"); // đối chứng dương
        for (const bi of [sdt, sdt.slice(1), email, "Họ Tên Log04", h.token]) expect(log, `rò «${bi}»`).not.toContain(bi);
      } finally {
        await db.$executeRaw`DROP TRIGGER IF EXISTS ahd_no_lead_trg ON "Lead"`;
        await db.$executeRaw`DROP FUNCTION IF EXISTS ahd_no_lead()`;
      }
    }, CASE);
  });
});

