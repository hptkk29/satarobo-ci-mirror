// @vitest-environment node
/**
 * [AFP-E2E-*] / [AFP-RES-*] / [AFP-DB-*] — HOA HỒNG THEO CAMPAIGN CỦA AFFILIATE trên Postgres THẬT (AFF-P2, docs/source-commission/12 §8).
 *
 * Đây là ca ĐẦU-CUỐI ĐẦU TIÊN của đường tiền affiliate: biểu mẫu giới thiệu → lead + quy nguồn (`signals.affiliate` do P1 ghi, KHÔNG gõ tay) → thanh toán thật → quét bằng engine thật →
 * sổ. Cái mà test thuần không chứng minh được: id campaign/thành viên/referral tra ĐÚNG, rule CAMPAIGN thắng đúng bậc, ba cột chụp vào sổ BẤT BIẾN (điền lúc INSERT, không vá được sau),
 * đảo ngược chép đúng, đổi campaign làm băm đổi và lượt QUÉT thấy drift.
 *
 *   [AFP-E2E-01] bậc thang AFFILIATE: GLOBAL 1% < SOURCE_GROUP 2% < CAMPAIGN 3% ⇒ 300.000đ; sổ mang 3 cột + `resolverBasis.affiliate`; «Vì sao» nêu campaign; trigger bất biến + FK Restrict chặn sửa/xoá
 *   [AFP-E2E-02] rule phạm vi AFFILIATE (đối tác) thắng rule CAMPAIGN (thua AFFILIATE/PERSON — PERSON chứng minh ở mức thuần, vì người hưởng affiliate không có userId)
 *   [AFP-E2E-03] KHÔNG có chính sách CAMPAIGN nào ⇒ tiền như trước AFF-P2 (SOURCE_GROUP thắng); campaign vẫn được CHỤP vào sổ
 *   [AFP-E2E-04] attribution CŨ (không có `signals.affiliate`, kiểu `?ref=`) ⇒ cả ba cột NULL, rule CAMPAIGN không áp
 *   [AFP-E2E-05] đổi nguồn thủ công sang người khác mà `signals.affiliate` còn nguyên ⇒ KHÔNG dán campaign của người cũ vào người mới
 *   [AFP-E2E-06] hoàn tiền ⇒ dòng REVERSAL chép đúng 3 cột + `resolverBasis`; quét lại không đẻ thêm
 *   [AFP-E2E-07] điều chỉnh do khiếu nại (đích DÒNG và đích KHOẢN THU) chép đúng 3 cột từ dòng mẫu
 *   [AFP-E2E-08] đổi campaign của khoản ⇒ băm đổi ⇒ QUÉT thấy drift (TROI) và KHÔNG tự ghi; trả lại ⇒ KHONG_DOI
 *   [AFP-E2E-09] đổi campaign mà tiền không đổi ⇒ băm của ô đổi, không dòng sổ / hàng chờ nào; dòng cũ giữ campaign cũ
 *   [AFP-RES-01..04] `docAffiliateChoHoaHong`: tra campaign theo MÃ (không nhầm campaign khác của cùng đối tác) · referral VALID mới nhất TẤT ĐỊNH (hoà thời điểm ⇒ id lớn hơn) · KHÔNG lọc theo trạng thái campaign/thành viên · cổng mã đối tác
 *   [AFP-DB-01..03] CHECK `pham_vi` chặn thật khi đi vòng bằng SQL thô · dịch vụ chính sách nhận CAMPAIGN · guardrail kích hoạt thật: CAMPAIGN không còn bị chặn, VUOT_TRAN (kể cả FIXED vượt trần) vẫn chặn
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng hiện trường (mã duy nhất, kịch bản riêng). LUẬT 19: ngày TUYỆT ĐỐI — `Date.now()` chỉ làm hậu tố mã.
 * AN TOÀN DB: không `resetDb()`. Sổ BẤT BIẾN nên dọn bằng `donKichBan` (cắt bảng sổ) TRƯỚC khi xoá campaign/referral (FK Restrict).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "10.9.9.7" }) }));
vi.setConfig({ testTimeout: 90_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb } from "../e2e/_helpers/seed";
import { docAffiliateChoHoaHong } from "../../lib/affiliate/campaign-cho-hoa-hong";
import { docSnapshotAffiliate } from "../../lib/affiliate/snapshot-referral";
import { xuLyIntakeGioiThieu } from "../../lib/affiliate/intake-cong-khai";
import { sinhToken } from "../../lib/affiliate/token";
import { docQuyTac, taoChinhSach, taoVanBan } from "../../lib/hoa-hong/chinh-sach-service";
import { dungDongDieuChinhKhieuNai } from "../../lib/hoa-hong/khieu-nai-dieu-chinh";
import { HoaHongError } from "../../lib/hoa-hong/kieu";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { docViSaoDayDu } from "../../lib/hoa-hong/vi-sao-doc";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import {
  boiCanh,
  D,
  datMocCutover,
  donKichBan,
  dongSoCuaKhoan,
  dungBe,
  dungKichBan,
  hoanTien,
  nguoiKyHo,
  themChinhSachNhom,
  themChinhSachPhamVi,
  tienVe,
  type KichBan,
} from "./_kich-ban";
import { baoDamNguoiPhuTrach, chiTietChanKichHoat, datTranHoaHong, donNguoiPhuTrach, lamSachChinhSach, rule, thuKichHoat, trangThaiPhienBan } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[AFP] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "AFP";
const NHAN = "fx-afp";
const HOST = "afp-doi-tac.example.test";
const ORIGIN = `https://${HOST}`;
const NOW = D("2026-11-20");
const NOW_LINK = D("2026-10-05");
const ATTRIBUTED = new Date("2026-10-01T03:00:00.000Z");
const NGAY_THU = D("2026-10-12");

const cuaToi: KichBan[] = [];
let dem = 0;
const hau = () => `${Date.now().toString(36).toUpperCase()}${(dem += 1)}`;

async function don(): Promise<void> {
  const ds = await db.affiliate.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const ids = ds.map((x) => x.id);
  await db.commissionPolicyVersion.deleteMany({ where: { scopeCampaign: { code: { startsWith: P } } } }); // Restrict ⇒ phiên bản chính sách TRƯỚC campaign
  await db.affiliateReferral.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliateTrackingAsset.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliateMembership.deleteMany({ where: { partyId: { in: ids } } });
  const camp = await db.affiliateCampaign.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const cid = camp.map((c) => c.id);
  await db.affiliateCampaignRule.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaignSite.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaign.deleteMany({ where: { id: { in: cid } } });
  await db.affiliateSite.deleteMany({ where: { code: { startsWith: P } } });
  await db.affiliatePartyTag.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliate.deleteMany({ where: { id: { in: ids } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: P } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } });
}

type HienTruong = Awaited<ReturnType<typeof dungHienTruong>>;

/** Chuỗi link ĐẦY ĐỦ và hợp lệ: nguồn → website(+trang đích) → campaign → loại → đối tác → membership → link. Mã duy nhất mỗi lần gọi. */
async function dungHienTruong() {
  const h = hau();
  const nhom = await db.leadSourceGroup.create({
    data: { code: `${P}_S${h}`, name: `Nguồn ${P} ${h}`, sourceType: "PARTNER", referrerRequirement: "NONE", sortOrder: 900, status: "ACTIVE", selectable: true, commissionEnabled: true },
  });
  const site = await db.affiliateSite.create({
    data: { code: `${P}_W${h}`, name: `Web ${P} ${h}`, baseUrl: ORIGIN, allowedDomains: [HOST], status: "ACTIVE", trackingEnabled: true, landingPages: { create: { pathPattern: "/khoa-robot" } } },
  });
  const campaign = await db.affiliateCampaign.create({
    data: { code: `${P}_C${h}`, name: `Campaign thu ${P} ${h}`, status: "ACTIVE", cookieWindowDays: 30, protectWindowDays: 90, defaultSourceGroupId: nhom.id, sites: { create: { siteId: site.id } } },
  });
  const loai = await db.affiliateType.create({ data: { code: `${P}_T${h}`, name: `Loại ${P} ${h}` } });
  const doiTac = await db.affiliate.create({ data: { code: `${P}_D${h}`, name: `Đối tác ${P} ${h}`, status: "ACTIVE", isActive: true, typeId: loai.id } });
  const mem = await db.affiliateMembership.create({ data: { partyId: doiTac.id, campaignId: campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  const token = sinhToken();
  const asset = await db.affiliateTrackingAsset.create({
    data: { partyId: doiTac.id, membershipId: mem.id, campaignId: campaign.id, siteId: site.id, landingPath: "/khoa-robot", publicToken: token, type: "LINK", status: "ACTIVE" },
  });
  return { h, nhom, site, campaign, loai, doiTac, mem, asset, token };
}

/** Thêm một campaign nữa cho CÙNG đối tác (cùng site, cùng nguồn mặc định) + thành viên + link. */
async function themCampaign(ht: HienTruong, ten: string) {
  const h = hau();
  const campaign = await db.affiliateCampaign.create({
    data: { code: `${P}_C${h}`, name: `Campaign ${ten} ${P} ${h}`, status: "ACTIVE", defaultSourceGroupId: ht.nhom.id, sites: { create: { siteId: ht.site.id } } },
  });
  const mem = await db.affiliateMembership.create({ data: { partyId: ht.doiTac.id, campaignId: campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  return { campaign, mem };
}

let ipSeq = 0;
let sdtSeq = 0;
const sdtMoi = () => `09${String(((Date.now() % 90_000_000) + 1_000_000 + (sdtSeq += 7)) % 100_000_000).padStart(8, "0")}`;
const bienThe = (s: string) => [s, `84${s.slice(1)}`];

/**
 * LEAD qua ĐƯỜNG THẬT của P1: lõi `xuLyIntakeGioiThieu` (token → chuỗi link → quyết định → ingest → quy nguồn luật AFFILIATE_REFERRAL → dòng referral).
 * Chỉ GHIM những thứ KHÔNG thuộc thứ đang kiểm: người chốt/cơ sở của lead (để SALE có người nhận) và `attributedAt` sang ngày tuyệt đối (DB đặt `now()` thật).
 */
async function leadTuLinkThat(k: KichBan, ht: HienTruong): Promise<KichBan> {
  const sdt = sdtMoi();
  ipSeq += 1;
  const r = await xuLyIntakeGioiThieu(
    {
      thanTho: JSON.stringify({ v: 1, token: ht.token, idempotencyKey: `afp-${hau().toLowerCase()}-${ipSeq}-xx`, parentName: `${P} PH ${k.ma}`, phone: sdt, children: [{ fullName: `${P} Bé` }], consentMarketing: true }),
      origin: ORIGIN,
      ip: `10.66.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`,
      userAgent: null,
    },
    { now: () => NOW_LINK, choPhepTanSuat: async () => true },
  );
  expect(r.status).toBe(200);
  const lead = await db.lead.findFirstOrThrow({ where: { phone: { in: bienThe(sdt) }, deletedAt: null }, select: { id: true } });
  await db.lead.update({ where: { id: lead.id }, data: { convertedById: k.sale.id, adminId: k.saleAdmin.id, centerId: k.centerId, status: "DA_DANG_KY" } });
  await db.leadAttribution.update({ where: { leadId: lead.id }, data: { attributedAt: ATTRIBUTED } });
  const kk: KichBan = { ...k, lead: await db.lead.findUniqueOrThrow({ where: { id: lead.id } }) };
  cuaToi.push(kk);
  return kk;
}

/** Kịch bản: SALE 4% + AFFILIATE 1% ở GLOBAL (ngưỡng thấp nhất của bậc thang). `coLead: false` — lead đến từ `leadTuLinkThat`. */
async function kb(tien: string) {
  return dungKichBan(tien, { coLead: false, rules: [{ vai: "SALE", rate: 0.04 }, { vai: "AFFILIATE", rate: 0.01 }] });
}

/** MỘT khoản NEW 10.000.000đ đã xác nhận → quét bằng engine thật. */
async function thuVaQuet(k: KichBan, ten: string) {
  const bc = await boiCanh(k, NOW);
  const be = await dungBe(k, ten, { tongTien: 10_000_000 });
  const khoan = await tienVe(k, be, { soTien: 10_000_000, ngay: NGAY_THU });
  const kq = await quetKhoan(db, bc, khoan);
  return { bc, be, khoan, kq, dong: await dongSoCuaKhoan(khoan) };
}

const dongCua = (dong: Awaited<ReturnType<typeof dongSoCuaKhoan>>, vai: string) => dong.find((d) => d.roleCode === vai)!;
type TenCot = "affiliateCampaignId" | "affiliateMembershipId" | "affiliateReferralId";
const cot3 = (d: Record<TenCot, string | null>) => ({ affiliateCampaignId: d.affiliateCampaignId, affiliateMembershipId: d.affiliateMembershipId, affiliateReferralId: d.affiliateReferralId });

describe.skipIf(!RUN_DB_TESTS)("[AFP] hoa hồng theo campaign Affiliate — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["HO_ACCOUNTANT", "CENTER_SALES_CSM"] });
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
    await datMocCutover("2026-10");
    await don().catch(() => undefined); // dọn tàn dư của lượt chạy trước bị ngắt giữa chừng (best-effort)
  }, 180_000);

  afterAll(async () => {
    await donKichBan(cuaToi);
    await don();
    // `baoDamNguoiPhuTrach` (ca [AFP-DB-03]) gán QL_TT/QC cho MỌI cơ sở của DB: để lại là làm đỏ [NHH-POL-09]/[NHH-POL-09b] của chinh-sach.spec (chúng cần một cơ sở CHƯA có người phụ trách).
    await donNguoiPhuTrach(NHAN);
    await datMocCutover(null);
    await datTranHoaHong(null);
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
  }, 180_000);

  it("[AFP-E2E-01] bậc thang: GLOBAL 1% < SOURCE_GROUP 2% < CAMPAIGN 3% ⇒ AFFILIATE nhận 3%; sổ chụp 3 cột + resolverBasis.affiliate; «Vì sao» nêu campaign; sổ bất biến + FK Restrict giữ chúng", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("e01");
    await themChinhSachNhom(k0, ht.nhom.code, [{ vai: "AFFILIATE", rate: 0.02 }]);
    const cp = await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    const k = await leadTuLinkThat(k0, ht);

    // Đối chứng nền: lead thật sự đi qua luật AFFILIATE_REFERRAL và snapshot có hình dạng thật của P1 (không phải JSON gõ tay).
    const a = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k.lead!.id } });
    expect(a.matchedRule).toBe("AFFILIATE_REFERRAL");
    expect(a.referrerAffiliateId).toBe(ht.doiTac.id);
    expect(docSnapshotAffiliate(a.signals)).toMatchObject({ affiliateCode: ht.doiTac.code, campaignCode: ht.campaign.code });
    const referral = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: k.lead!.id, status: "VALID" } });

    const { dong, kq } = await thuVaQuet(k, "a");
    expect(kq.loai).toBe("DA_GHI");
    const aff = dongCua(dong, "AFFILIATE");
    expect(aff).toMatchObject({ amount: 300_000, beneficiaryKind: "AFFILIATE", beneficiaryAffiliateId: ht.doiTac.id, policyVersionId: cp.versionId });
    expect(Number(aff.rate)).toBeCloseTo(0.03, 6);
    // SALE theo GLOBAL (chính sách campaign không có rule SALE) — và vẫn mang campaign: cột nói «khoản này thuộc campaign nào», không chỉ «dòng của vai AFFILIATE».
    const sale = dongCua(dong, "SALE");
    expect(sale).toMatchObject({ amount: 400_000, beneficiaryUserId: k.sale.id });

    const mong = { affiliateCampaignId: ht.campaign.id, affiliateMembershipId: ht.mem.id, affiliateReferralId: referral.id };
    expect(cot3(aff)).toEqual(mong);
    expect(cot3(sale)).toEqual(mong);
    expect(aff.resolverBasis).toMatchObject({
      canCu: "AFFILIATE",
      affiliate: { campaignCode: ht.campaign.code, typeCode: ht.loai.code, partyKind: "PERSON", parentPartyId: null },
    });
    expect((aff.resolverBasis as { affiliate: { tu: string } }).affiliate.tu).toBe("MAC_DINH_CAMPAIGN");

    // «Vì sao con số này»: HO đọc được, nêu TÊN campaign + loại đối tác + tuyến quyết nguồn; không lộ mã campaign thô.
    const visao = await docViSaoDayDu((await nguoiKyHo()).quyen, aff.id);
    expect(visao).not.toBeNull();
    const muc = visao!.muc.find((m) => m.nhan === "Campaign Affiliate")!;
    expect(muc.giaTri).toBe(ht.campaign.name);
    expect(muc.ghiChu).toContain("Đối tác cá nhân");
    expect(muc.ghiChu).toContain(`loại ${ht.loai.code}`);
    expect(JSON.stringify(visao)).not.toContain(ht.campaign.code);

    // Sổ BẤT BIẾN: trigger cấm UPDATE ba cột (đó là lý do chúng phải điền lúc INSERT) …
    await expect(db.$executeRaw`UPDATE "CommissionTransaction" SET "affiliateCampaignId" = NULL WHERE "id" = ${aff.id}`).rejects.toThrow(/bất biến/);
    // … và FK Restrict giữ campaign / thành viên / referral đã sinh tiền khỏi bị xoá.
    await expect(db.affiliateCampaign.delete({ where: { id: ht.campaign.id } })).rejects.toThrow();
    await expect(db.affiliateMembership.delete({ where: { id: ht.mem.id } })).rejects.toThrow();
    await expect(db.affiliateReferral.delete({ where: { id: referral.id } })).rejects.toThrow();
  });

  it("[AFP-E2E-02] rule phạm vi AFFILIATE (đối tác) thắng rule CAMPAIGN: 4% thay vì 3%; bỏ rule AFFILIATE đi thì CAMPAIGN thắng lại (đối chứng dương)", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("e02");
    await themChinhSachNhom(k0, ht.nhom.code, [{ vai: "AFFILIATE", rate: 0.02 }]);
    await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    const k = await leadTuLinkThat(k0, ht);

    const truoc = await thuVaQuet(k, "a");
    expect(dongCua(truoc.dong, "AFFILIATE").amount).toBe(300_000); // chưa có rule đối tác ⇒ CAMPAIGN thắng

    const ap = await themChinhSachPhamVi(k0, "dt", { loai: "AFFILIATE", affiliateId: ht.doiTac.id }, [{ vai: "AFFILIATE", rate: 0.04 }]);
    const sau = await thuVaQuet(k, "b");
    const aff = dongCua(sau.dong, "AFFILIATE");
    expect(aff).toMatchObject({ amount: 400_000, policyVersionId: ap.versionId });
    // 4% (SALE) + 4% (AFFILIATE) = 8% ≤ trần 9% — KHÔNG đụng `crm.commissionMaxTotalRate`.
    expect(cot3(aff).affiliateCampaignId).toBe(ht.campaign.id);
  });

  it("[AFP-E2E-03] KHÔNG có chính sách CAMPAIGN nào ⇒ tiền y như trước AFF-P2 (SOURCE_GROUP 2% thắng GLOBAL 1%); campaign vẫn được CHỤP vào sổ", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("e03");
    await themChinhSachNhom(k0, ht.nhom.code, [{ vai: "AFFILIATE", rate: 0.02 }]);
    const k = await leadTuLinkThat(k0, ht);
    const { dong } = await thuVaQuet(k, "a");
    const aff = dongCua(dong, "AFFILIATE");
    expect(aff.amount).toBe(200_000);
    expect(aff.affiliateCampaignId).toBe(ht.campaign.id); // chụp độc lập với việc có rule CAMPAIGN hay không
  });

  it("[AFP-E2E-04] attribution CŨ (không có `signals.affiliate`, kiểu `?ref=`) ⇒ cả ba cột NULL, rule CAMPAIGN KHÔNG áp, basis không có khoá affiliate", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("e04");
    await themChinhSachNhom(k0, ht.nhom.code, [{ vai: "AFFILIATE", rate: 0.02 }]);
    await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    const k = await leadTuLinkThat(k0, ht);
    // Biến attribution thành bản đời cũ: bỏ đúng khoá `signals.affiliate` (người giới thiệu vẫn là đối tác).
    const a = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k.lead!.id } });
    const { affiliate: _bo, ...conLai } = a.signals as Record<string, unknown>;
    void _bo;
    await db.leadAttribution.update({ where: { leadId: k.lead!.id }, data: { signals: conLai as never } });

    const { dong } = await thuVaQuet(k, "a");
    const aff = dongCua(dong, "AFFILIATE");
    expect(aff).toMatchObject({ amount: 200_000, beneficiaryAffiliateId: ht.doiTac.id }); // vẫn trả đúng đối tác, theo SOURCE_GROUP
    for (const d of dong) expect(cot3(d), d.roleCode).toEqual({ affiliateCampaignId: null, affiliateMembershipId: null, affiliateReferralId: null });
    expect(aff.resolverBasis).not.toHaveProperty("affiliate");
  });

  it("[AFP-E2E-05] đổi người giới thiệu thủ công mà `signals.affiliate` còn nguyên (đối tác CŨ) ⇒ KHÔNG dán campaign của người cũ vào người mới", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("e05");
    await themChinhSachNhom(k0, ht.nhom.code, [{ vai: "AFFILIATE", rate: 0.02 }]);
    await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    const k = await leadTuLinkThat(k0, ht);
    const moi = await db.affiliate.create({ data: { code: `${P}_D${hau()}`, name: `Đối tác mới ${P}`, status: "ACTIVE", isActive: true } });
    await db.leadAttribution.update({ where: { leadId: k.lead!.id }, data: { referrerAffiliateId: moi.id } });

    const { dong } = await thuVaQuet(k, "a");
    const aff = dongCua(dong, "AFFILIATE");
    expect(aff).toMatchObject({ amount: 200_000, beneficiaryAffiliateId: moi.id }); // rule CAMPAIGN KHÔNG áp
    expect(cot3(aff)).toEqual({ affiliateCampaignId: null, affiliateMembershipId: null, affiliateReferralId: null });
  });

  it("[AFP-E2E-06] hoàn tiền ⇒ dòng REVERSAL CHÉP đúng 3 cột và resolverBasis của dòng gốc; quét lại không đẻ thêm", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("e06");
    await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    const k = await leadTuLinkThat(k0, ht);
    const { bc, khoan, dong } = await thuVaQuet(k, "a");
    const goc = dongCua(dong, "AFFILIATE");

    const hoan = await hoanTien(k, khoan, { soTien: 4_000_000, ngay: D("2026-11-05") });
    expect((await quetKhoan(db, bc, hoan)).loai).toBe("DA_DAO");
    const dao = await dongSoCuaKhoan(hoan);
    expect(dao.length).toBeGreaterThanOrEqual(2);
    for (const d of dao) {
      expect(d.entryKind).toBe("REVERSAL");
      expect(d.amount).toBeLessThan(0);
      const g = dongCua(dong, d.roleCode);
      expect(cot3(d), d.roleCode).toEqual(cot3(g));
      expect(cot3(d).affiliateCampaignId, d.roleCode).toBe(ht.campaign.id);
    }
    expect(dongCua(dao, "AFFILIATE").resolverBasis).toEqual(goc.resolverBasis);
    expect(dongCua(dao, "AFFILIATE").amount).toBe(-120_000); // 3% × 4tr — tỉ lệ TIỀN của chính dòng gốc
    expect((await quetKhoan(db, bc, hoan)).loai).toBe("BO_QUA");
    expect(await dongSoCuaKhoan(hoan)).toHaveLength(dao.length);
  });

  it("[AFP-E2E-07] điều chỉnh do khiếu nại chép 3 cột từ dòng mẫu: đích DÒNG (cùng người) VÀ đích KHOẢN THU (người khác nhận) — cả hai nhánh, kèm đối chứng dòng không có campaign", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("e07");
    await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    const k = await leadTuLinkThat(k0, ht);
    const { dong } = await thuVaQuet(k, "a");
    const mau = dongCua(dong, "AFFILIATE");
    const mong = cot3(mau);
    expect(mong.affiliateCampaignId).toBe(ht.campaign.id);

    const chung = { id: "afp-kn-1", disputeId: "afp-kn-d1", soTien: 50_000, lyDoQuyetDinh: "điều chỉnh fixture", periodId: mau.periodId, lateArrival: false } as const;
    // đích DÒNG
    expect(cot3(dungDongDieuChinhKhieuNai({ ...chung, mau, nguoiNhan: null }))).toEqual(mong);
    // đích KHOẢN THU: người nhận KHÁC, vai do HR chọn — nhưng KHOẢN THU vẫn thuộc campaign ấy (cùng đơn · học viên · nguồn · kỳ)
    const vai = await db.beneficiaryRole.findUniqueOrThrow({ where: { code: "SALE" }, select: { id: true, code: true, resolverType: true } });
    const khac = dungDongDieuChinhKhieuNai({ ...chung, id: "afp-kn-2", disputeId: "afp-kn-d2", mau, nguoiNhan: { nguoi: { userId: k.qlcs.id, employeeId: null, ten: "Người nhận khác" }, vai } });
    expect(cot3(khac)).toEqual(mong);
    expect(khac).toMatchObject({ beneficiaryUserId: k.qlcs.id, roleCode: "SALE" });
    // đối chứng: dòng mẫu KHÔNG có campaign thì dòng điều chỉnh cũng KHÔNG (không bịa)
    const trong = { ...mau, affiliateCampaignId: null, affiliateMembershipId: null, affiliateReferralId: null };
    expect(cot3(dungDongDieuChinhKhieuNai({ ...chung, id: "afp-kn-3", disputeId: "afp-kn-d3", mau: trong, nguoiNhan: null }))).toEqual({ affiliateCampaignId: null, affiliateMembershipId: null, affiliateReferralId: null });
  });

  it("[AFP-E2E-08] đổi campaign của khoản ⇒ băm đổi ⇒ QUÉT thấy drift (TROI, KHÔNG tự ghi); trả về campaign cũ ⇒ KHONG_DOI", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("e08");
    await themChinhSachPhamVi(k0, "c1", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    const c2 = await themCampaign(ht, "hai");
    await themChinhSachPhamVi(k0, "c2", { loai: "CAMPAIGN", campaignId: c2.campaign.id }, [{ vai: "AFFILIATE", rate: 0.04 }]);
    const k = await leadTuLinkThat(k0, ht);
    const { bc, khoan, dong } = await thuVaQuet(k, "a");
    expect(dongCua(dong, "AFFILIATE").amount).toBe(300_000);
    expect((await quetKhoan(db, bc, khoan)).loai).toBe("KHONG_DOI"); // băm cũ giữ nguyên khi không có gì đổi

    const a = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k.lead!.id } });
    const sn = a.signals as { affiliate: Record<string, unknown> } & Record<string, unknown>;
    const doiMa = (ma: string) => db.leadAttribution.update({ where: { leadId: k.lead!.id }, data: { signals: { ...sn, affiliate: { ...sn.affiliate, campaignCode: ma } } as never } });

    await doiMa(c2.campaign.code);
    const troi = await quetKhoan(db, bc, khoan);
    expect(troi.loai).toBe("TROI");
    if (troi.loai === "TROI") expect(troi.chenh.map((c) => c.chenh).filter((x) => x !== 0)).toEqual([100_000]); // chỉ AFFILIATE đổi: 3% → 4%
    expect(await dongSoCuaKhoan(khoan)).toHaveLength(dong.length); // lượt QUÉT chỉ phát hiện, không ghi gì

    await doiMa(ht.campaign.code);
    expect((await quetKhoan(db, bc, khoan)).loai).toBe("KHONG_DOI");
  });

  it("[AFP-E2E-09] campaign đổi mà TIỀN không đổi (cả hai campaign đều không có rule CAMPAIGN) ⇒ băm của ô ĐỔI theo (campaign nằm trong băm) nhưng KHÔNG sinh dòng sổ / hàng chờ nào", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("e09");
    await themChinhSachNhom(k0, ht.nhom.code, [{ vai: "AFFILIATE", rate: 0.02 }]);
    const c2 = await themCampaign(ht, "hai");
    const k = await leadTuLinkThat(k0, ht);
    const { bc, khoan, dong } = await thuVaQuet(k, "a");
    const hashO = async () => (await db.commissionCalcSlot.findFirstOrThrow({ where: { paymentId: khoan }, select: { lastMatchedHash: true } })).lastMatchedHash;
    const h0 = await hashO();

    const a = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k.lead!.id } });
    const sn = a.signals as { affiliate: Record<string, unknown> } & Record<string, unknown>;
    await db.leadAttribution.update({ where: { leadId: k.lead!.id }, data: { signals: { ...sn, affiliate: { ...sn.affiliate, campaignCode: c2.campaign.code } } as never } });

    expect((await quetKhoan(db, bc, khoan)).loai).toBe("KHONG_DOI"); // tiền y nguyên ⇒ không phải drift
    expect(await hashO()).not.toBe(h0); // …nhưng băm đầu vào đã ghi nhận campaign mới
    expect(await dongSoCuaKhoan(khoan)).toHaveLength(dong.length); // sổ bất biến: dòng cũ vẫn mang campaign CŨ, không ai viết lại
    expect(dongCua(await dongSoCuaKhoan(khoan), "AFFILIATE").affiliateCampaignId).toBe(ht.campaign.id);
    expect(await db.commissionHold.count({ where: { paymentId: khoan } })).toBe(0);
  });

  // ── Bộ tra campaign / thành viên / referral ────────────────────────────────────────────────────────────

  it("[AFP-RES-01] tra campaign theo MÃ trong bản chụp: đối tác có hai campaign thì ra đúng cái có mã khớp (thành viên của CHÍNH nó); mã lạ ⇒ null", async () => {
    const ht = await dungHienTruong();
    const c2 = await themCampaign(ht, "hai");
    const lead = await db.lead.create({ data: { parentName: `${P} res01`, phone: sdtMoi() } });
    const snap = (ma: string) => docSnapshotAffiliate({ affiliate: { affiliateCode: ht.doiTac.code, campaignCode: ma, tu: "MAC_DINH_CAMPAIGN", tuNhan: "Nguồn mặc định của campaign", typeCode: ht.loai.code } });
    const hoi = (ma: string) => docAffiliateChoHoaHong(db, { leadId: lead.id, referrerKind: "AFFILIATE", referrerAffiliateId: ht.doiTac.id, snapshot: snap(ma) });

    const r1 = await hoi(ht.campaign.code);
    expect(r1).toMatchObject({ campaignId: ht.campaign.id, membershipId: ht.mem.id, campaignName: ht.campaign.name, typeCode: ht.loai.code, partyKind: "PERSON" });
    const r2 = await hoi(c2.campaign.code);
    expect(r2).toMatchObject({ campaignId: c2.campaign.id, membershipId: c2.mem.id });
    expect(r2!.campaignId).not.toBe(r1!.campaignId);
    expect(await hoi(`${P}_KHONGCO`)).toBeNull();
  });

  it("[AFP-RES-02] referral TẤT ĐỊNH: chỉ VALID · đúng lead · đúng đối tác · đúng CAMPAIGN VỪA TRA; mới nhất theo (createdAt, id) — hoà thời điểm thì id lớn hơn", async () => {
    const ht = await dungHienTruong();
    const c2 = await themCampaign(ht, "hai");
    const lead = await db.lead.create({ data: { parentName: `${P} res02`, phone: sdtMoi() } });
    const lead2 = await db.lead.create({ data: { parentName: `${P} res02b`, phone: sdtMoi() } });
    const t = (ngay: string) => new Date(`${ngay}T03:00:00.000Z`);
    const tao = (id: string, p: { campaignId?: string; leadId?: string; status?: "VALID" | "DISPUTED"; luc: Date }) =>
      db.affiliateReferral.create({
        data: {
          id,
          partyId: ht.doiTac.id,
          membershipId: ht.mem.id,
          assetId: ht.asset.id, // CHECK `tai_san_chk`: referral qua link/QR/mã phải trỏ tài sản theo dõi
          campaignId: p.campaignId ?? ht.campaign.id,
          leadId: p.leadId ?? lead.id,
          method: "LINK",
          status: p.status ?? "VALID",
          sourceGroupId: ht.nhom.id,
          sourceSnapshot: {},
          createdAt: p.luc,
        },
      });
    const hoi = () =>
      docAffiliateChoHoaHong(db, {
        leadId: lead.id,
        referrerKind: "AFFILIATE",
        referrerAffiliateId: ht.doiTac.id,
        snapshot: docSnapshotAffiliate({ affiliate: { affiliateCode: ht.doiTac.code, campaignCode: ht.campaign.code } }),
      });

    // Chưa có referral nào ⇒ campaign + thành viên có, referral NULL (không đoán).
    expect((await hoi())!.referralId).toBeNull();
    await tao(`${hau()}-a`, { luc: t("2026-10-02") });
    expect((await hoi())!.referralId).toMatch(/-a$/);
    // Các «mồi» MỚI HƠN nhưng KHÔNG đủ điều kiện: khác campaign, khác lead, không VALID.
    await tao(`${hau()}-m1`, { luc: t("2026-10-09"), campaignId: c2.campaign.id });
    await tao(`${hau()}-m2`, { luc: t("2026-10-09"), leadId: lead2.id });
    await tao(`${hau()}-m3`, { luc: t("2026-10-09"), status: "DISPUTED" });
    expect((await hoi())!.referralId).toMatch(/-a$/);
    // Hai VALID CÙNG thời điểm: id lớn hơn thắng — kết quả không phụ thuộc thứ tự chèn.
    const x = hau();
    // Chèn id NHỎ trước, id LỚN sau: nếu chỉ sắp theo thời điểm thì thứ tự vật lý chọn id nhỏ (sai) — id lớn thắng CHỈ khi có phép so sánh id.
    await tao(`${x}-z1`, { luc: t("2026-10-05") });
    await tao(`${x}-z2`, { luc: t("2026-10-05") });
    expect((await hoi())!.referralId).toBe(`${x}-z2`);
    expect((await hoi())!.referralId).toBe(`${x}-z2`); // lặp lại ⇒ cùng kết quả
  });

  it("[AFP-RES-03] KHÔNG lọc theo trạng thái: campaign ENDED / thành viên ENDED / đối tác ngưng SAU khi khách đã vào ⇒ vẫn ra đúng id (quét lại không làm campaignId rơi về NULL ⇒ không drift giả)", async () => {
    const ht = await dungHienTruong();
    const lead = await db.lead.create({ data: { parentName: `${P} res03`, phone: sdtMoi() } });
    const snapshot = docSnapshotAffiliate({ affiliate: { affiliateCode: ht.doiTac.code, campaignCode: ht.campaign.code } });
    const hoi = () => docAffiliateChoHoaHong(db, { leadId: lead.id, referrerKind: "AFFILIATE", referrerAffiliateId: ht.doiTac.id, snapshot });
    const truoc = await hoi();
    await db.affiliateCampaign.update({ where: { id: ht.campaign.id }, data: { status: "ENDED" } });
    await db.affiliateMembership.update({ where: { id: ht.mem.id }, data: { status: "ENDED", effectiveTo: new Date("2026-10-06T00:00:00.000Z") } });
    await db.affiliate.update({ where: { id: ht.doiTac.id }, data: { status: "ENDED", isActive: false } });
    // AFF-L2: kết quả mang thêm ẢNH CHỤP cấu hình sống (`chup`, `thanhVien`) — nó ĐỔI theo trạng thái (đó là lý do nó chỉ vào resolverBasis, không vào băm). Bất biến cần canh là bộ ID: không rơi về NULL.
    const sau = await hoi();
    const dinhDanh = (x: typeof truoc) => x && { campaignId: x.campaignId, campaignCode: x.campaignCode, membershipId: x.membershipId, referralId: x.referralId, partyId: x.partyId };
    expect(dinhDanh(sau)).toEqual(dinhDanh(truoc));
    expect(sau!.chup.status).toBe("ENDED"); // đối chứng dương: ảnh chụp CÓ thấy đổi — nên so toàn khối bằng toEqual sẽ đỏ oan
    expect(truoc).toMatchObject({ campaignId: ht.campaign.id, membershipId: ht.mem.id });
  });

  it("[AFP-RES-04] CỔNG: không phải attribution của Affiliate, thiếu bản chụp, hoặc bản chụp mang mã của ĐỐI TÁC KHÁC ⇒ null (cả ba id) — mỗi nhánh có đối chứng dương", async () => {
    const ht = await dungHienTruong();
    const khac = await db.affiliate.create({ data: { code: `${P}_D${hau()}`, name: `Đối tác khác ${P}`, status: "ACTIVE", isActive: true } });
    const lead = await db.lead.create({ data: { parentName: `${P} res04`, phone: sdtMoi() } });
    const snap = docSnapshotAffiliate({ affiliate: { affiliateCode: ht.doiTac.code, campaignCode: ht.campaign.code } });
    const hoi = (p: { kind?: "PARENT" | "EMPLOYEE" | "AFFILIATE" | null; aff?: string | null; snapshot?: typeof snap }) =>
      docAffiliateChoHoaHong(db, {
        leadId: lead.id,
        referrerKind: p.kind === undefined ? "AFFILIATE" : p.kind,
        referrerAffiliateId: p.aff === undefined ? ht.doiTac.id : p.aff,
        snapshot: p.snapshot === undefined ? snap : p.snapshot,
      });
    expect(await hoi({})).not.toBeNull(); // đối chứng dương
    expect(await hoi({ kind: "PARENT" })).toBeNull();
    expect(await hoi({ kind: null })).toBeNull();
    expect(await hoi({ aff: null })).toBeNull();
    expect(await hoi({ snapshot: null })).toBeNull();
    expect(await hoi({ aff: khac.id })).toBeNull(); // bản chụp của đối tác CŨ, người giữ công nay là `khac`
    expect(await hoi({ aff: `${P}-khong-ton-tai` })).toBeNull();
  });

  // ── CHECK / dịch vụ / guardrail ────────────────────────────────────────────────────────────────────────

  it("[AFP-DB-01] CHECK `pham_vi` chặn THẬT khi đi vòng bằng SQL thô: CAMPAIGN thiếu cột · CAMPAIGN thừa cột khác · loại khác mang cột campaign; FK chặn campaign không tồn tại; đối chứng dương đi qua", async () => {
    const ht = await dungHienTruong();
    const k = await kb("db01");
    const pol = await db.commissionPolicy.findUniqueOrThrow({ where: { policyCode: k.chinhSach.policyCode } });
    let so = 900;
    const them = (p: { loai: "CAMPAIGN" | "GLOBAL" | "ORG_UNIT"; khoa: string; campaign?: string | null; donVi?: string | null }) => {
      so += 1;
      const id = `${k.ma}-sql-${so}`;
      return db.$executeRaw`
        INSERT INTO "CommissionPolicyVersion" ("id","policyId","versionNo","status","effectiveFrom","reason","scopeType","scopeKey","scopeCampaignId","scopeOrgUnitId","createdAt","updatedAt")
        VALUES (${id}, ${pol.id}, ${so}, 'DRAFT'::"PolicyVersionStatus", now(), 'fixture sql', ${p.loai}::"PolicyScopeType", ${p.khoa}, ${p.campaign ?? null}, ${p.donVi ?? null}, now(), now())`;
    };
    await expect(them({ loai: "CAMPAIGN", khoa: "CAMPAIGN:x" })).rejects.toThrow(/CommissionPolicyVersion_pham_vi_chk/);
    await expect(them({ loai: "CAMPAIGN", khoa: "CAMPAIGN:x", campaign: ht.campaign.id, donVi: k.ouId })).rejects.toThrow(/CommissionPolicyVersion_pham_vi_chk/);
    await expect(them({ loai: "GLOBAL", khoa: "GLOBAL", campaign: ht.campaign.id })).rejects.toThrow(/CommissionPolicyVersion_pham_vi_chk/);
    await expect(them({ loai: "ORG_UNIT", khoa: `ORG_UNIT:${k.ouId}`, campaign: ht.campaign.id, donVi: k.ouId })).rejects.toThrow(/CommissionPolicyVersion_pham_vi_chk/);
    await expect(them({ loai: "CAMPAIGN", khoa: "CAMPAIGN:khong-co", campaign: `${P}-khong-ton-tai` })).rejects.toThrow(/CommissionPolicyVersion_scopeCampaignId_fkey/);
    await expect(them({ loai: "CAMPAIGN", khoa: `CAMPAIGN:${ht.campaign.id}`, campaign: ht.campaign.id })).resolves.toBe(1); // đối chứng dương
    cuaToi.push(k);
  });

  it("[AFP-DB-02] dịch vụ chính sách nhận phạm vi CAMPAIGN: campaign không tồn tại ⇒ lỗi rõ; `docQuyTac` trả rule mang `scope.campaignId`", async () => {
    const ht = await dungHienTruong();
    const k = await kb("db02");
    cuaToi.push(k);
    const vb = await taoVanBan({
      documentCode: `${k.ma}-vb-db02`,
      title: "Quy định (fixture AFP)",
      kind: "COMMISSION_POLICY",
      issuedOn: "2026-02-20",
      publishedOn: "2026-03-02",
      effectiveOn: "2026-03-23",
      approvedByName: "Hồ Đắc Phúc",
      approvedById: null,
      fileKey: "documents/fx-afp.pdf",
      fileName: "fx-afp.pdf",
      fileUrl: "https://example.test/fx-afp.pdf",
      ownerOrgUnitId: null,
      actor: { userId: null, ten: NHAN },
      now: new Date("2026-10-08T03:00:00.000Z"),
    });
    const goc = {
      name: "Chính sách campaign fixture",
      description: null,
      ownerOrgUnitId: null,
      effectiveFrom: new Date("2026-03-22T17:00:00.000Z"),
      effectiveTo: null,
      reason: "SR.QD.fixture afp",
      documentId: vb.id,
      rules: [rule("AFFILIATE", 0.03)],
      actor: { userId: null, ten: NHAN },
      now: new Date("2026-10-08T03:00:00.000Z"),
    };
    await expect(taoChinhSach({ ...goc, policyCode: `${k.ma}-pol-khong`, phamVi: { loai: "CAMPAIGN", campaignId: `${P}-khong-ton-tai` } })).rejects.toBeInstanceOf(HoaHongError);
    const cs = await taoChinhSach({ ...goc, policyCode: `${k.ma}-pol-co`, phamVi: { loai: "CAMPAIGN", campaignId: ht.campaign.id } });
    k.chinhSachThem.push(`${k.ma}-pol-co`);
    expect(await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: cs.versionId }, select: { scopeType: true, scopeKey: true, scopeCampaignId: true, scopeAffiliateId: true } })).toEqual({
      scopeType: "CAMPAIGN",
      scopeKey: `CAMPAIGN:${ht.campaign.id}`,
      scopeCampaignId: ht.campaign.id,
      scopeAffiliateId: null,
    });
    // Bản NHÁP không vào `docQuyTac` (chỉ ACTIVE/EXPIRED/SUPERSEDED) — kích hoạt trực tiếp ở DB để đo ánh xạ cột → `QuyTac`.
    await db.commissionPolicyVersion.update({ where: { id: cs.versionId }, data: { status: "ACTIVE", activatedAt: D("2026-10-08") } });
    const q = (await docQuyTac(db)).find((x) => x.versionId === cs.versionId)!;
    expect(q).toMatchObject({ scopeType: "CAMPAIGN", scope: { campaignId: ht.campaign.id } });
    expect(q.scope.sourceId).toBeUndefined();
  });

  it("[AFP-DB-03] guardrail kích hoạt THẬT: CAMPAIGN không còn bị chặn (PHAM_VI_CHUA_HO_TRO biến mất); VUOT_TRAN (FIXED tham gia kiểm trần) vẫn chặn; bản nháp bị chặn vẫn là DRAFT", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    await datTranHoaHong(null); // trần mặc định 9% — đợt này KHÔNG nâng trần
    const ht = await dungHienTruong();
    const k = await dungKichBan("db03"); // GLOBAL seed v1 = 9% đúng trần
    cuaToi.push(k);
    const tao = async (hauTo: string, rules: Parameters<typeof taoChinhSach>[0]["rules"]) => {
      const code = `${k.ma}-vb-${hauTo}`;
      const vb = await taoVanBan({
        documentCode: code,
        title: "Quy định (fixture AFP)",
        kind: "COMMISSION_POLICY",
        issuedOn: "2026-02-20",
        publishedOn: "2026-03-02",
        effectiveOn: "2026-03-23",
        approvedByName: "Hồ Đắc Phúc",
        approvedById: null,
        fileKey: "documents/fx-afp.pdf",
        fileName: "fx-afp.pdf",
        fileUrl: "https://example.test/fx-afp.pdf",
        ownerOrgUnitId: null,
        actor: { userId: null, ten: NHAN },
        now: new Date("2026-10-08T03:00:00.000Z"),
      });
      const policyCode = `${k.ma}-pol-${hauTo}`;
      const cs = await taoChinhSach({
        policyCode,
        name: `Chính sách campaign ${hauTo}`,
        description: null,
        ownerOrgUnitId: null,
        phamVi: { loai: "CAMPAIGN", campaignId: ht.campaign.id },
        effectiveFrom: new Date("2026-03-22T17:00:00.000Z"),
        effectiveTo: null,
        reason: "SR.QD.fixture afp",
        documentId: vb.id,
        rules,
        actor: { userId: null, ten: NHAN },
        now: new Date("2026-10-08T03:00:00.000Z"),
      });
      k.chinhSachThem.push(policyCode);
      return cs.versionId;
    };

    // Σ trong ngữ cảnh campaign: SALE 5% thay SALE 4% ⇒ 10% > 9% ⇒ chặn, KHÔNG phải vì «phạm vi chưa hỗ trợ»
    const vuot = await tao("vuot", [rule("SALE", 0.05)]);
    const loiVuot = await thuKichHoat(vuot);
    expect(loiVuot).toContain("VUOT_TRAN");
    expect(loiVuot).not.toContain("PHAM_VI_CHUA_HO_TRO");
    expect(await trangThaiPhienBan(vuot)).toBe("DRAFT");
    const chiTiet = await chiTietChanKichHoat(vuot);
    expect(chiTiet.find((l) => l.ma === "VUOT_TRAN")!.thongBao).toContain("campaign");

    // kiểu FIXED KHÔNG còn bị chặn vì «chưa hỗ trợ» (AFF-L2b): nó tham gia kiểm trần như phần trăm — 500.000 ÷ 10tr chuẩn = 5% cộng GLOBAL 9% ⇒ VUOT_TRAN; mã KIỂU biến mất
    const co = await tao("fixed", [rule("AFFILIATE", 0, { calcKind: "FIXED_PER_PURCHASE", rate: null, fixedAmount: 500_000 })]);
    const loiFixed = await thuKichHoat(co);
    expect(loiFixed).toContain("VUOT_TRAN");
    expect(loiFixed).not.toContain("KIEU_TINH_CHUA_HO_TRO");
    // (kiểu TIER vẫn chặn bằng KIEU_TINH_CHUA_HO_TRO — ca thuần [NHH-POL-09b]; ở đường dịch vụ TIER còn đòi bảng bậc nên không dựng được ở đây)

    // đối chứng dương: SALE 4% ở campaign (Σ = 9% đúng trần) ⇒ qua và ACTIVE
    const qua = await tao("qua", [rule("SALE", 0.04)]);
    expect(await thuKichHoat(qua)).toEqual([]);
    expect(await trangThaiPhienBan(qua)).toBe("ACTIVE");
    await lamSachChinhSach(); // trả hiện trường: không để phiên bản sống của ca này chặn bộ chạy sau
    await donNguoiPhuTrach(NHAN); // …và không để lại người phụ trách do `baoDamNguoiPhuTrach` gán cho mọi cơ sở (luật 18)
  });
});
