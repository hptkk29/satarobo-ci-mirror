// @vitest-environment node
/**
 * [AFI-*] — `POST /api/public/affiliate/v1/intake` trên Postgres THẬT (AFF-P1b): biểu mẫu đặt trên website đối tác → lead + quy nguồn + dòng referral.
 *
 * Ca khoá các luật mà test thuần không chứng minh được vì chúng sống ở TẦNG GHÉP (route → lõi → chuẩn bị → ingest → resolver → ghi):
 *   · khách LUÔN được lưu, dù token hỏng / link thu hồi / tự giới thiệu / nguồn chưa cấu hình;
 *   · phản hồi KHÔNG lộ referral có được ghi hay không (token đúng ≡ token sai);
 *   · nguồn của lead đi từ CẤU HÌNH (campaign), người hưởng là đối tác trên link; client không đưa được id/tỉ lệ/nguồn;
 *   · first-claim: khách trùng SĐT giữ nguyên người ghi nhận đầu, referral đến sau bị REJECTED_DUPLICATE;
 *   · gửi lặp cùng khoá ⇒ MỘT lead, MỘT referral.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `AFI`. LUẬT 18: mỗi ca tự dựng hiện trường (chuỗi link, danh mục, cờ). Ngày TUYỆT ĐỐI (luật 19).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "10.9.9.7" }) }));

import { NextRequest } from "next/server";
import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { POST as intakePost } from "../../app/api/public/affiliate/v1/intake/route";
import { sinhToken } from "../../lib/affiliate/token";
import { gopLead } from "../../lib/lead/gop-lead";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "AFI";
const CASE = 90_000;
const SDT = "0906000777";
const bienThe = (s: string) => [s, `84${s.slice(1)}`];
const HOST = "afi-doi-tac.example.test";
const ORIGIN = `https://${HOST}`;

let seq = 0;
const ma = (t: string) => `${P}_${t}${(seq += 1)}`;

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { OR: [{ parentName: { startsWith: P } }, { phone: { in: [...bienThe(SDT), ...bienThe("0906000888")] } }] }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  await db.affiliateReferral.deleteMany({ where: { OR: [{ party: { code: { startsWith: P } } }, { leadId: { in: ids } }] } });
  if (ids.length > 0) {
    await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  // Sổ lượt bấm CHỈ-THÊM (trigger chặn xoá — số liệu báo cáo phải kiểm lại được). Chỉ ca test mới tắt trigger để dọn hiện trường của chính nó, rồi bật lại ngay.
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
  await db.affiliateSite.deleteMany({ where: { code: { startsWith: P } } });
  await db.affiliatePartyTag.deleteMany({ where: { party: { code: { startsWith: P } } } });
  await db.affiliatePartyUser.deleteMany({ where: { party: { code: { startsWith: P } } } }); // L3a: bảng nối tài khoản truy cập (FK Restrict tới Affiliate)
  await db.affiliate.deleteMany({ where: { code: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: "afi-tk-" } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: P } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } });
  await db.systemSetting.deleteMany({ where: { key: { in: ["affiliate.enabled"] } } });
}

/** Một chuỗi link ĐẦY ĐỦ và hợp lệ: nguồn → website(+trang đích) → campaign → loại → đối tác → membership → link. */
async function dungHienTruong(p: { nguonMacDinh?: boolean; allowSelf?: boolean; doiTacSdt?: string | null; cookieDays?: number } = {}) {
  const nhom = await db.leadSourceGroup.create({
    data: { code: ma("S"), name: "Nguồn KOL fixture", sourceType: "PARTNER", referrerRequirement: "NONE", sortOrder: 900, status: "ACTIVE", selectable: true },
  });
  const site = await db.affiliateSite.create({
    data: { code: ma("W"), name: "Web fixture", baseUrl: ORIGIN, allowedDomains: [HOST], status: "ACTIVE", trackingEnabled: true, landingPages: { create: { pathPattern: "/khoa-robot" } } },
  });
  const campaign = await db.affiliateCampaign.create({
    data: {
      code: ma("C"),
      name: "Campaign fixture",
      status: "ACTIVE",
      cookieWindowDays: p.cookieDays ?? 30,
      protectWindowDays: 90,
      allowSelfReferral: p.allowSelf ?? false,
      defaultSourceGroupId: p.nguonMacDinh === false ? null : nhom.id,
      sites: { create: { siteId: site.id } },
    },
  });
  const loai = await db.affiliateType.create({ data: { code: ma("T"), name: "Loại fixture" } });
  const doiTac = await db.affiliate.create({
    data: { code: ma("D"), name: "Đối tác fixture", status: "ACTIVE", isActive: true, typeId: loai.id, phone: p.doiTacSdt ?? null },
  });
  const mem = await db.affiliateMembership.create({
    data: { partyId: doiTac.id, campaignId: campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") },
  });
  const token = sinhToken();
  const asset = await db.affiliateTrackingAsset.create({
    data: { partyId: doiTac.id, membershipId: mem.id, campaignId: campaign.id, siteId: site.id, landingPath: "/khoa-robot", publicToken: token, type: "LINK", status: "ACTIVE" },
  });
  return { nhom, site, campaign, loai, doiTac, mem, asset, token };
}

let ipSeq = 0;
function goi(body: unknown, opts: { origin?: string | null } = {}) {
  ipSeq += 1;
  const headers: Record<string, string> = { "content-type": "text/plain", "x-forwarded-for": `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}` };
  if (opts.origin) headers.origin = opts.origin;
  return intakePost(new NextRequest("http://localhost/api/public/affiliate/v1/intake", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers }));
}

let keySeq = 0;
const khoa = () => `afi-key-${Date.now().toString(36)}-${(keySeq += 1)}`;
const bieuMau = (h: { token: string }, over: Record<string, unknown> = {}) => ({
  v: 1,
  token: h.token,
  idempotencyKey: khoa(),
  parentName: `${P} Phụ huynh`,
  phone: SDT,
  children: [{ fullName: `${P} Bé An` }],
  consentMarketing: true,
  ...over,
});

async function docLead(sdt = SDT) {
  const l = await db.lead.findFirstOrThrow({ where: { phone: { in: bienThe(sdt) }, deletedAt: null }, select: { id: true } });
  return db.lead.findUniqueOrThrow({
    where: { id: l.id },
    select: { id: true, centerId: true, attribution: { include: { group: { select: { code: true } } } } },
  });
}
const soLead = (sdt = SDT) => db.lead.count({ where: { phone: { in: bienThe(sdt) }, deletedAt: null } });

describe.skipIf(!RUN)("biểu mẫu giới thiệu → lead + referral (POST /api/public/affiliate/v1/intake)", () => {
  beforeAll(async () => {
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["CENTER_SALES_CSM"] });
  }, 120_000);

  beforeEach(async () => {
    await don();
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.create({ data: { key: "affiliate.enabled", valueJson: true } });
    clearSettingsCache();
  }, CASE);

  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 180_000);

  it("[AFI-01] link hợp lệ ⇒ lead lưu, nguồn = nguồn cấu hình của campaign, người hưởng = đối tác; referral VALID có hạn bảo vệ; snapshot không PII", async () => {
    const h = await dungHienTruong();
    const res = await goi(bieuMau(h), { origin: ORIGIN });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);

    const lead = await docLead();
    const a = lead.attribution!;
    expect(a.matchedRule).toBe("AFFILIATE_REFERRAL");
    expect(a.identificationMethod).toBe("AFFILIATE");
    expect(a.group.code).toBe(h.nhom.code);
    expect(a.referrerKind).toBe("AFFILIATE");
    expect(a.referrerAffiliateId).toBe(h.doiTac.id);
    expect(a.referrerMissing).toBe(false);
    expect(JSON.stringify(a.signals)).not.toContain(SDT);
    expect((a.signals as { affiliate: { campaignCode: string } }).affiliate.campaignCode).toBe(h.campaign.code);

    const r = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(r.status).toBe("VALID");
    expect(r.partyId).toBe(h.doiTac.id);
    expect(r.campaignId).toBe(h.campaign.id);
    expect(r.assetId).toBe(h.asset.id);
    expect(r.sourceGroupId).toBe(h.nhom.id);
    expect(r.centerId).toBe(lead.centerId);
    expect(r.method).toBe("LINK");
    const ngay = (r.protectedUntil!.getTime() - r.createdAt.getTime()) / 86_400_000;
    expect(ngay).toBeGreaterThan(89.9);
    expect(ngay).toBeLessThan(90.1);
    expect(JSON.stringify(r.sourceSnapshot)).not.toContain(SDT);
  }, CASE);

  it("[AFI-02] phản hồi KHÔNG lộ token đúng/sai: cùng status + cùng thân; token lạ vẫn lưu khách, không có dòng referral", async () => {
    const h = await dungHienTruong();
    const dung = await goi(bieuMau(h, { phone: "0906000888" }));
    const sai = await goi(bieuMau({ token: "ZZZZZZZZZZ" }, { phone: SDT }));
    expect(sai.status).toBe(dung.status);
    expect(await sai.json()).toEqual(await dung.json());

    const lead = await docLead(SDT);
    expect(lead.attribution!.matchedRule).not.toBe("AFFILIATE_REFERRAL");
    expect(lead.attribution!.referrerAffiliateId).toBeNull();
    expect(await db.affiliateReferral.count({ where: { leadId: lead.id } })).toBe(0);
    expect(await soLead("0906000888")).toBe(1); // đối chứng dương: token đúng cũng lưu khách
  }, CASE);

  it("[AFI-03] link bị THU HỒI ⇒ khách vẫn lưu; referral REJECTED (lý do link); lead KHÔNG mang nguồn của campaign", async () => {
    const h = await dungHienTruong();
    await db.affiliateTrackingAsset.update({ where: { id: h.asset.id }, data: { status: "REVOKED", revokedAt: new Date("2026-10-01T00:00:00.000Z"), revokedReason: "thu hồi fixture ca AFI-03" } });
    expect((await goi(bieuMau(h))).status).toBe(200);

    const lead = await docLead();
    expect(lead.attribution!.matchedRule).not.toBe("AFFILIATE_REFERRAL");
    expect(lead.attribution!.group.code).not.toBe(h.nhom.code);
    const r = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(r.status).toBe("REJECTED");
    expect(r.resolutionReason).toContain("LINK_DA_THU_HOI");
    expect(r.rejectedAt).not.toBeNull();
  }, CASE);

  it("[AFI-04] TỰ GIỚI THIỆU (SĐT khách = SĐT đối tác) bị chặn; đối chứng: campaign cho phép ⇒ VALID", async () => {
    const chan = await dungHienTruong({ doiTacSdt: SDT });
    await goi(bieuMau(chan));
    const lead = await docLead();
    const r = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(r.status).toBe("REJECTED");
    expect(r.resolutionReason).toContain("TU_GIOI_THIEU");
    expect(lead.attribution!.referrerAffiliateId).toBeNull();

    await don();
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.create({ data: { key: "affiliate.enabled", valueJson: true } });
    clearSettingsCache();
    const cho = await dungHienTruong({ doiTacSdt: SDT, allowSelf: true });
    await goi(bieuMau(cho));
    const l2 = await docLead();
    expect((await db.affiliateReferral.findFirstOrThrow({ where: { leadId: l2.id } })).status).toBe("VALID");
    expect(l2.attribution!.referrerAffiliateId).toBe(cho.doiTac.id);
  }, CASE);

  it("[AFI-04b] TỰ GIỚI THIỆU so MỌI tài khoản còn gắn với đối tác (L3a: nhiều tài khoản/Party): SĐT khách = SĐT của một THÀNH VIÊN ⇒ bị chặn; đối chứng dương: tài khoản đã GỠ thì không còn là «người của đối tác» ⇒ VALID", async () => {
    const SDT2 = "0906000888";
    const taoTv = (p: { partyId: string; trangThai: "ACTIVE" | "REVOKED" }) =>
      db.user
        .create({ data: { email: `afi-tk-tv-${khoa()}@ci.test`, role: "PARENT", roles: ["PARENT"], name: "AFI thành viên", phone: `84${SDT2.slice(1)}` } })
        .then((u) =>
          db.affiliatePartyUser.create({
            data: { partyId: p.partyId, userId: u.id, role: "MEMBER", status: p.trangThai, ...(p.trangThai === "REVOKED" ? { statusReason: "Gỡ để đối chứng dương AFI-04b", revokedAt: new Date("2026-10-10T03:00:00.000Z") } : {}) },
          }),
        );
    const chan = await dungHienTruong({ doiTacSdt: null });
    await taoTv({ partyId: chan.doiTac.id, trangThai: "ACTIVE" });
    await goi(bieuMau(chan, { phone: SDT2 }));
    const lead = await docLead(SDT2);
    const r = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(r.status).toBe("REJECTED");
    expect(r.resolutionReason).toContain("TU_GIOI_THIEU");

    await don();
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.create({ data: { key: "affiliate.enabled", valueJson: true } });
    clearSettingsCache();
    const cho = await dungHienTruong({ doiTacSdt: null });
    await taoTv({ partyId: cho.doiTac.id, trangThai: "REVOKED" });
    await goi(bieuMau(cho, { phone: SDT2 }));
    const l2 = await docLead(SDT2);
    expect((await db.affiliateReferral.findFirstOrThrow({ where: { leadId: l2.id } })).status).toBe("VALID");
    expect(l2.attribution!.referrerAffiliateId).toBe(cho.doiTac.id);
  }, CASE);

  it("[AFI-05] gửi LẶP cùng khoá ⇒ MỘT lead, MỘT referral, thân phản hồi như nhau", async () => {
    const h = await dungHienTruong();
    const b = bieuMau(h);
    const a1 = await goi(b);
    const a2 = await goi(b);
    expect(a2.status).toBe(a1.status);
    expect(await a2.json()).toEqual(await a1.json());
    expect(await soLead()).toBe(1);
    expect(await db.affiliateReferral.count({ where: { partyId: h.doiTac.id } })).toBe(1);
  }, CASE);

  it("[AFI-06] first-claim: khách ĐÃ có hồ sơ (cùng SĐT) ⇒ referral đến sau REJECTED_DUPLICATE trỏ về lead cũ; attribution lead cũ KHÔNG đổi", async () => {
    const h = await dungHienTruong();
    // Lead gốc đến từ đường web thường (không link).
    await db.lead.create({ data: { parentName: `${P} Gốc`, phone: `84${SDT.slice(1)}`, source: "web", eventId: `afi-goc-${khoa()}` } });
    const goc = await docLead();
    const truoc = goc.attribution ? { rule: goc.attribution.matchedRule, grp: goc.attribution.groupId } : null;

    expect((await goi(bieuMau(h))).status).toBe(200);
    expect(await soLead()).toBe(1);
    const sau = await docLead();
    expect(sau.attribution ? { rule: sau.attribution.matchedRule, grp: sau.attribution.groupId } : null).toEqual(truoc);
    const r = await db.affiliateReferral.findFirstOrThrow({ where: { partyId: h.doiTac.id } });
    expect(r.status).toBe("REJECTED_DUPLICATE");
    expect(r.leadId).toBe(goc.id);
    expect(r.protectedUntil).toBeNull();
  }, CASE);

  it("[AFI-11] ẨN DANH không sửa được hồ sơ có sẵn: SĐT trùng lead đang mở ⇒ KHÔNG thêm con, KHÔNG chèn ghi chú, KHÔNG nâng mốc nhập lại / báo Sale; vẫn để lại dấu vết trùng (như /api/leads) và referral REJECTED_DUPLICATE", async () => {
    const h = await dungHienTruong();
    const goc = await db.lead.create({
      data: { parentName: `${P} Gốc`, phone: `84${SDT.slice(1)}`, source: "web", eventId: `afi-goc-${khoa()}`, status: "MOI", inboundCount: 0 },
      select: { id: true, inboundCount: true, lastInboundAt: true },
    });
    const soCon = () => db.leadChild.count({ where: { leadId: goc.id } });
    const soNote = () => db.leadActivity.count({ where: { leadId: goc.id, content: { contains: "LINK-LUA-DAO" } } });
    const conTruoc = await soCon();

    const res = await goi(bieuMau(h, { children: [{ fullName: `${P} Bé LẠ` }], note: "LINK-LUA-DAO http://x.test" }));
    expect(res.status).toBe(200);
    expect(await soLead()).toBe(1); // không đẻ lead mới

    expect(await soCon(), "không gắn thêm con vào hồ sơ của người khác").toBe(conTruoc);
    expect(await soNote(), "không chèn ghi chú tuỳ ý của người lạ vào dòng thời gian").toBe(0);
    const sau = await db.lead.findUniqueOrThrow({ where: { id: goc.id }, select: { inboundCount: true, lastInboundAt: true } });
    expect(sau.inboundCount, "không nâng bộ đếm nhập lại").toBe(goc.inboundCount);
    expect(sau.lastInboundAt?.getTime() ?? null).toBe(goc.lastInboundAt?.getTime() ?? null);
    // đối chứng dương: dấu vết trùng VẪN ghi (cùng cách /api/leads làm) + referral bị từ chối vì trùng
    expect(await db.leadDuplicate.count({ where: { primaryLeadId: goc.id } })).toBe(1);
    expect((await db.affiliateReferral.findFirstOrThrow({ where: { partyId: h.doiTac.id } })).status).toBe("REJECTED_DUPLICATE");
  }, CASE);

  it("[AFI-07] campaign CHƯA cấu hình nguồn ⇒ referral MANUAL_REVIEW (nhóm UNKNOWN trong dòng), lead vẫn lưu, KHÔNG gắn người giới thiệu", async () => {
    const h = await dungHienTruong({ nguonMacDinh: false });
    expect((await goi(bieuMau(h))).status).toBe(200);
    const lead = await docLead();
    const r = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(r.status).toBe("MANUAL_REVIEW");
    expect(r.resolutionReason).toMatch(/cấu hình/i);
    const unknown = await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "UNKNOWN" }, select: { id: true } });
    expect(r.sourceGroupId).toBe(unknown.id);
    expect(lead.attribution!.referrerAffiliateId).toBeNull();
  }, CASE);

  it("[AFI-08] Origin: KHỚP ⇒ VALID; VẮNG ⇒ VALID; LỆCH ⇒ MANUAL_REVIEW và không phản chiếu ACAO", async () => {
    const h = await dungHienTruong();
    const khop = await goi(bieuMau(h, { phone: "0906000888" }), { origin: ORIGIN });
    expect(khop.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect((await db.affiliateReferral.findFirstOrThrow({ where: { leadId: (await docLead("0906000888")).id } })).status).toBe("VALID");

    const lech = await goi(bieuMau(h), { origin: "https://ke-la.example.test" });
    expect(lech.status).toBe(200);
    expect(lech.headers.get("access-control-allow-origin")).toBeNull();
    const l = await docLead();
    expect((await db.affiliateReferral.findFirstOrThrow({ where: { leadId: l.id } })).status).toBe("MANUAL_REVIEW");
    expect(l.attribution!.referrerAffiliateId).toBeNull();
  }, CASE);

  it("[AFI-09] khoá LẠ trong thân (id đối tác / nguồn / tỉ lệ) ⇒ 400, KHÔNG lead — client không đưa được thứ máy chủ tự quyết", async () => {
    const h = await dungHienTruong();
    for (const them of [{ affiliateId: h.doiTac.id }, { sourceGroupId: h.nhom.id }, { commissionRate: 0.5 }, { employeeId: "x" }]) {
      const res = await goi({ ...bieuMau(h), ...them });
      expect(res.status, JSON.stringify(them)).toBe(400);
    }
    expect(await soLead()).toBe(0);
    expect(await db.affiliateReferral.count({ where: { partyId: h.doiTac.id } })).toBe(0);
  }, CASE);

  it("[AFI-10] cờ TẮT ⇒ 200, khách VẪN được lưu như lead thường nhưng KHÔNG referral/attribution Affiliate (R5 13/10/2026 — không còn 404 làm mất khách); ô ẩn `hp` ⇒ 200 nhưng không lead", async () => {
    const h = await dungHienTruong();
    await db.systemSetting.deleteMany({ where: { key: "affiliate.enabled" } });
    clearSettingsCache();
    expect((await goi(bieuMau(h))).status).toBe(200);
    expect(await soLead()).toBe(1);
    expect(await db.affiliateReferral.count({ where: { partyId: h.doiTac.id } })).toBe(0);
    expect(await db.leadAttribution.count({ where: { matchedRule: "AFFILIATE_REFERRAL" } })).toBe(0);

    await db.systemSetting.create({ data: { key: "affiliate.enabled", valueJson: true } });
    clearSettingsCache();
    const bot = await goi(bieuMau(h, { hp: "http://spam.example" }));
    expect(bot.status).toBe(200);
    expect(await soLead()).toBe(1); // vẫn đúng MỘT lead (của lượt cờ tắt): bot không thêm lead nào
  }, CASE);

  it("[AFI-11] nguồn của campaign vừa bị NGỪNG ⇒ luật không thắng; referral MANUAL_REVIEW kèm lý do; lead không gắn người giới thiệu", async () => {
    const h = await dungHienTruong();
    await db.leadSourceGroup.update({ where: { id: h.nhom.id }, data: { status: "INACTIVE" } });
    expect((await goi(bieuMau(h))).status).toBe(200);
    const lead = await docLead();
    expect(lead.attribution!.matchedRule).not.toBe("AFFILIATE_REFERRAL");
    const r = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(r.status).toBe("MANUAL_REVIEW");
    expect(r.resolutionReason).toContain(lead.attribution!.matchedRule);
  }, CASE);

  it("[AFI-12] click QUÁ cửa sổ cookie ⇒ REJECTED; click của link KHÁC bị bỏ qua (không tin id lạ)", async () => {
    const h = await dungHienTruong({ cookieDays: 7 });
    const cu = await db.referralClick.create({
      data: { assetId: h.asset.id, campaignId: h.campaign.id, partyId: h.doiTac.id, outcome: "OK", occurredAt: new Date(Date.now() - 30 * 86_400_000) },
    });
    await goi(bieuMau(h, { clickId: cu.id }));
    const l1 = await docLead();
    const r1 = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: l1.id } });
    expect(r1.status).toBe("REJECTED");
    expect(r1.resolutionReason).toContain("NGOAI_CUA_SO_COOKIE");
    expect(r1.clickId).toBe(cu.id);

    await don();
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.create({ data: { key: "affiliate.enabled", valueJson: true } });
    clearSettingsCache();
    const a = await dungHienTruong({ cookieDays: 7 });
    const b = await dungHienTruong({ cookieDays: 7 });
    const clickCuaB = await db.referralClick.create({
      data: { assetId: b.asset.id, campaignId: b.campaign.id, partyId: b.doiTac.id, outcome: "OK", occurredAt: new Date(Date.now() - 30 * 86_400_000) },
    });
    await goi(bieuMau(a, { clickId: clickCuaB.id }));
    const l2 = await docLead();
    const r2 = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: l2.id } });
    expect(r2.status).toBe("VALID"); // click lạ không làm quá hạn
    expect(r2.clickId).toBeNull();
  }, CASE);

  it("[AFI-13] GỘP lead: referral của lead phụ đi theo sang lead chính (dry-run không đổi gì) — hàm gộp biết cột AffiliateReferral.leadId", async () => {
    const h = await dungHienTruong();
    await goi(bieuMau(h)); // lead phụ (có referral VALID)
    const phu = await docLead();
    // Lead chính: cùng gia đình (cùng khoá SĐT, dạng viết khác) nhưng là hồ sơ riêng.
    const chinh = await db.lead.create({ data: { parentName: `${P} Chính`, phone: SDT, source: "web", eventId: `afi-chinh-${khoa()}` } });
    const r0 = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: phu.id } });

    await gopLead(db, { phuId: phu.id, chinhId: chinh.id, apply: false, actorName: "t", actorUserId: null });
    expect((await db.affiliateReferral.findUniqueOrThrow({ where: { id: r0.id } })).leadId).toBe(phu.id);

    await gopLead(db, { phuId: phu.id, chinhId: chinh.id, apply: true, actorName: "t", actorUserId: null });
    expect((await db.affiliateReferral.findUniqueOrThrow({ where: { id: r0.id } })).leadId).toBe(chinh.id);
  }, CASE);
});
