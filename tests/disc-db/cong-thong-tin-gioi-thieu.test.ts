// @vitest-environment node
/**
 * [CTT-GT-*] Tủ sách + Sức khoẻ ghi NGƯỜI GIỚI THIỆU ngay khi khách gửi hộp «để lại thông tin» (chủ dự án 20/11/2026:
 * «cứ có thông tin được submit về thì ghi nhận luôn»). Chạy `taoLeadTuCong` THẬT trên Postgres (ci_test).
 *   [CTT-GT-01] cookie `sr_aff` hợp lệ + Origin khớp website của link ⇒ nguồn = nguồn mặc định của campaign, luật AFFILIATE_REFERRAL, referral VALID
 *   [CTT-GT-02] không tín hiệu (đường cổng phụ huynh truyền `null`) ⇒ không referral, nguồn không phải campaign
 *   [CTT-GT-03] SĐT đã có lead ⇒ không lead thứ hai, nguồn lead cũ KHÔNG đổi, referral REJECTED_DUPLICATE (người đầu tiên giữ công)
 *   [CTT-GT-04] Origin LỆCH ⇒ referral XEM TAY, nguồn không đổi sang campaign (đối chứng: cổng Origin vẫn cắn)
 *   [CTT-GT-05] gửi lặp cùng ngày (cùng eventId) ⇒ một lead, một dòng referral
 *   [CTT-GT-06] link đã THU HỒI ⇒ khách vẫn được lưu, referral REJECTED, nguồn không phải campaign
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { taoLeadTuCong } from "../../lib/cong-thong-tin/tao-lead";
import type { PhieuHopLe } from "../../lib/cong-thong-tin/phieu";
import { sinhToken } from "../../lib/affiliate/token";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { NOW, P, RUN, assertCiTest, don, sdtChuan, sdtMoi } from "./_fx";

const describeDb = RUN ? describe : describe.skip;
const MA = "CTTGTAFF";
const HOST = "cttgt-doi-tac.example.test";
const ORIGIN_KHOP = `https://${HOST}`;

let n = 0;
const ma = (t: string) => `${MA}_${t}${Date.now().toString(36).toUpperCase()}${(n += 1)}`;

async function donAff(): Promise<void> {
  const parties = await db.affiliate.findMany({ where: { code: { startsWith: MA } }, select: { id: true } });
  const pid = parties.map((x) => x.id);
  await db.affiliateReferral.deleteMany({ where: { partyId: { in: pid } } });
  await db.affiliateTrackingAsset.deleteMany({ where: { partyId: { in: pid } } });
  await db.affiliateMembership.deleteMany({ where: { partyId: { in: pid } } });
  const camp = await db.affiliateCampaign.findMany({ where: { code: { startsWith: MA } }, select: { id: true } });
  const cid = camp.map((c) => c.id);
  await db.affiliateCampaignSite.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaign.deleteMany({ where: { id: { in: cid } } });
  const sites = await db.affiliateSite.findMany({ where: { code: { startsWith: MA } }, select: { id: true } });
  await db.affiliateLandingPage.deleteMany({ where: { siteId: { in: sites.map((s) => s.id) } } });
  await db.affiliateSite.deleteMany({ where: { code: { startsWith: MA } } });
  await db.affiliate.deleteMany({ where: { id: { in: pid } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: MA } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: MA } } });
}

async function dungHienTruong(o: { thuHoi?: boolean } = {}) {
  const nhom = await db.leadSourceGroup.create({
    data: { code: ma("S"), name: "Nguồn fixture CTTGT", sourceType: "PARTNER", referrerRequirement: "NONE", sortOrder: 900, status: "ACTIVE", selectable: true },
  });
  const site = await db.affiliateSite.create({
    data: { code: ma("W"), name: "Web fixture CTTGT", baseUrl: ORIGIN_KHOP, allowedDomains: [HOST], status: "ACTIVE", trackingEnabled: true, landingPages: { create: { pathPattern: "/tu-sach", isActive: true } } },
  });
  const campaign = await db.affiliateCampaign.create({
    data: { code: ma("C"), name: "Campaign fixture CTTGT", status: "ACTIVE", cookieWindowDays: 30, protectWindowDays: 90, allowSelfReferral: false, defaultSourceGroupId: nhom.id, sites: { create: { siteId: site.id } } },
  });
  const loai = await db.affiliateType.create({ data: { code: ma("T"), name: "Loại fixture CTTGT" } });
  const doiTac = await db.affiliate.create({ data: { code: ma("D"), name: "Đối tác fixture CTTGT", status: "ACTIVE", isActive: true, typeId: loai.id } });
  const mem = await db.affiliateMembership.create({ data: { partyId: doiTac.id, campaignId: campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  const token = sinhToken();
  await db.affiliateTrackingAsset.create({
    data: {
      partyId: doiTac.id,
      membershipId: mem.id,
      campaignId: campaign.id,
      siteId: site.id,
      landingPath: "/tu-sach",
      publicToken: token,
      type: "LINK",
      status: o.thuHoi ? "REVOKED" : "ACTIVE",
      ...(o.thuHoi ? { revokedAt: new Date("2026-10-01T00:00:00.000Z"), revokedReason: "Fixture: link đã thu hồi" } : {}),
    },
  });
  return { nhom, doiTac, cookie: `${token}.${NOW.getTime()}` };
}

function phieu(sdt: string, nguon: PhieuHopLe["nguon"] = "tu-sach"): PhieuHopLe {
  return {
    hoTen: `${P} Phụ huynh CTTGT`,
    soDienThoai: sdtChuan(sdt),
    diaChi: { thanhPho: "Đà Nẵng", phuong: "Phường Hải Châu", soNha: null, coSoGanNha: null },
    tiepThi: false,
    nguon,
    nguCanh: null,
  };
}

const docLead = (id: string) => db.lead.findUniqueOrThrow({ where: { id }, include: { attribution: true } });
const trangThaiReferral = async (leadId: string) => (await db.affiliateReferral.findMany({ where: { leadId }, select: { status: true } })).map((x) => x.status);

describeDb("[CTT-GT] Tủ sách / Sức khoẻ ghi người giới thiệu khi gửi", () => {
  beforeAll(async () => {
    await assertCiTest();
    await don();
    await donAff();
  });
  beforeEach(async () => {
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU, {});
    await db.systemSetting.deleteMany({ where: { key: "affiliate.enabled" } });
    await db.systemSetting.create({ data: { key: "affiliate.enabled", valueJson: true } });
    clearSettingsCache();
  });
  afterAll(async () => {
    await don();
    await donAff();
    await db.$disconnect();
  });

  it("[CTT-GT-01] cookie hợp lệ + Origin khớp ⇒ nguồn theo campaign, luật AFFILIATE_REFERRAL, referral VALID", async () => {
    const h = await dungHienTruong();
    const kq = await taoLeadTuCong(phieu(sdtMoi()), { cookieGioiThieu: h.cookie, origin: ORIGIN_KHOP }, () => NOW);
    expect(kq.laLeadMoi).toBe(true);
    const lead = await docLead(kq.leadId);
    expect(lead.attribution?.groupId).toBe(h.nhom.id);
    expect(lead.attribution?.matchedRule).toBe("AFFILIATE_REFERRAL");
    expect(lead.attribution?.referrerAffiliateId).toBe(h.doiTac.id);
    expect(await trangThaiReferral(kq.leadId)).toEqual(["VALID"]);
  });

  it("[CTT-GT-02] không tín hiệu (cổng phụ huynh truyền null) ⇒ không referral, nguồn không phải campaign", async () => {
    const h = await dungHienTruong();
    const kq = await taoLeadTuCong(phieu(sdtMoi(), "suc-khoe"), null, () => NOW);
    const lead = await docLead(kq.leadId);
    expect(lead.attribution?.groupId).not.toBe(h.nhom.id);
    expect(lead.attribution?.referrerAffiliateId ?? null).toBeNull();
    expect(await trangThaiReferral(kq.leadId)).toEqual([]);
  });

  it("[CTT-GT-03] SĐT đã có lead ⇒ không lead thứ hai, nguồn cũ không đổi, referral REJECTED_DUPLICATE", async () => {
    const sdt = sdtMoi();
    const dau = await taoLeadTuCong(phieu(sdt), null, () => NOW);
    const truoc = await docLead(dau.leadId);
    const h = await dungHienTruong();
    const sau = await taoLeadTuCong(phieu(sdt, "suc-khoe"), { cookieGioiThieu: h.cookie, origin: ORIGIN_KHOP }, () => NOW);
    expect(sau).toEqual({ leadId: dau.leadId, laLeadMoi: false });
    const lead = await docLead(dau.leadId);
    expect(lead.attribution?.groupId).toBe(truoc.attribution?.groupId);
    expect(lead.attribution?.matchedRule).toBe(truoc.attribution?.matchedRule);
    expect(await trangThaiReferral(dau.leadId)).toEqual(["REJECTED_DUPLICATE"]);
  });

  it("[CTT-GT-04] Origin LỆCH ⇒ referral XEM TAY, nguồn không đổi sang campaign", async () => {
    const h = await dungHienTruong();
    const kq = await taoLeadTuCong(phieu(sdtMoi()), { cookieGioiThieu: h.cookie, origin: "https://trang-khac.example.test" }, () => NOW);
    const lead = await docLead(kq.leadId);
    expect(lead.attribution?.groupId).not.toBe(h.nhom.id);
    expect(await trangThaiReferral(kq.leadId)).toEqual(["MANUAL_REVIEW"]);
  });

  it("[CTT-GT-05] gửi lặp cùng ngày ⇒ một lead, một dòng referral", async () => {
    const h = await dungHienTruong();
    const sdt = sdtMoi();
    const a = await taoLeadTuCong(phieu(sdt), { cookieGioiThieu: h.cookie, origin: ORIGIN_KHOP }, () => NOW);
    const b = await taoLeadTuCong(phieu(sdt), { cookieGioiThieu: h.cookie, origin: ORIGIN_KHOP }, () => NOW);
    expect(b.leadId).toBe(a.leadId);
    expect(await db.lead.count({ where: { phone: sdtChuan(sdt), deletedAt: null } })).toBe(1);
    expect(await trangThaiReferral(a.leadId)).toEqual(["VALID"]);
  });

  it("[CTT-GT-06] link đã thu hồi ⇒ khách vẫn được lưu, referral REJECTED, nguồn không phải campaign", async () => {
    const h = await dungHienTruong({ thuHoi: true });
    const kq = await taoLeadTuCong(phieu(sdtMoi()), { cookieGioiThieu: h.cookie, origin: ORIGIN_KHOP }, () => NOW);
    expect(kq.laLeadMoi).toBe(true);
    const lead = await docLead(kq.leadId);
    expect(lead.attribution?.groupId).not.toBe(h.nhom.id);
    expect(await trangThaiReferral(kq.leadId)).toEqual(["REJECTED"]);
  });
});
