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
import { DO_TRE_NHIEU_TOI_DA_MS, DO_TRE_TOI_THIEU_MS, xuLyIntakeGioiThieu } from "../../lib/affiliate/intake-cong-khai";
import { ingestIntakeLead } from "../../lib/lead/intake/ingest";
import { affiliateIntakeSchema, mapAffiliateIntake } from "../../lib/lead/intake/map-affiliate";
import { KHONG_CO_TIN_HIEU_NGUON } from "../../lib/nguon/tin-hieu";
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
  // R9 · T2: mặc định gửi Origin KHỚP (biểu mẫu trình duyệt thật). Muốn VẮNG phải nói rõ `origin: null` — vắng cả Origin lẫn `clk` nay là XEM TAY, không còn VALID.
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.origin = origin;
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

  it("[AFI-08] Origin: KHỚP ⇒ VALID; LỆCH ⇒ MANUAL_REVIEW và không phản chiếu ACAO (VẮNG: xem ma trận T2 ở [T2-*])", async () => {
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
    expect(r2.clickId).toBeNull(); // click của link khác KHÔNG được gắn vào link này và không làm quá hạn…
    expect(r2.status).toBe("MANUAL_REVIEW"); // …nhưng từ R9 · T2 nó là tín hiệu giả mạo/mang sang link lạ ⇒ XEM TAY (trước: bỏ qua lặng lẽ ⇒ VALID)
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

  // ── R9 · T2 — ma trận Origin × lượt bấm (docs/source-commission/12 §11.7) ────────────────────────
  type H = Awaited<ReturnType<typeof dungHienTruong>>;
  const taoClick = (h: H, over: { occurredAt?: Date } = {}) =>
    db.referralClick.create({ data: { assetId: h.asset.id, campaignId: h.campaign.id, partyId: h.doiTac.id, outcome: "OK", occurredAt: over.occurredAt ?? new Date() } });
  const referralCua = async (sdt = SDT) => {
    const l = await docLead(sdt);
    return { lead: l, ref: await db.affiliateReferral.findFirstOrThrow({ where: { leadId: l.id } }) };
  };
  const snap = (r: { sourceSnapshot: unknown }) => r.sourceSnapshot as { click?: string; doTinCay?: string; origin?: string };

  it("[T2-01] ĐỦ tín hiệu (Origin khớp + clk hợp lệ chưa dùng) ⇒ VALID, độ tin cậy CAO, lượt bấm được gắn", async () => {
    const h = await dungHienTruong();
    const c = await taoClick(h);
    expect((await goi(bieuMau(h, { clickId: c.id }), { origin: ORIGIN })).status).toBe(200);
    const { lead, ref } = await referralCua();
    expect(ref).toMatchObject({ status: "VALID", clickId: c.id });
    expect(snap(ref)).toMatchObject({ origin: "KHOP", click: "HOP_LE", doTinCay: "CAO" });
    expect(lead.attribution!.matchedRule).toBe("AFFILIATE_REFERRAL");
  }, CASE);

  it("[T2-02] CHỈ Origin (không clk) ⇒ VALID, độ tin cậy TRUNG BÌNH", async () => {
    const h = await dungHienTruong();
    await goi(bieuMau(h), { origin: ORIGIN });
    const { ref } = await referralCua();
    expect(ref.status).toBe("VALID");
    expect(snap(ref)).toMatchObject({ origin: "KHOP", click: "VANG", doTinCay: "TRUNG_BINH" });
  }, CASE);

  it("[T2-03] CHỈ clk hợp lệ (không Origin — máy chủ-máy chủ có mang theo lượt bấm) ⇒ VALID, độ tin cậy TRUNG BÌNH", async () => {
    const h = await dungHienTruong();
    const c = await taoClick(h);
    await goi(bieuMau(h, { clickId: c.id }), { origin: null });
    const { ref } = await referralCua();
    expect(ref).toMatchObject({ status: "VALID", clickId: c.id });
    expect(snap(ref)).toMatchObject({ origin: "VANG", click: "HOP_LE", doTinCay: "TRUNG_BINH" });
  }, CASE);

  it("[T2-04] THIẾU CẢ HAI (không Origin, không clk) ⇒ 200, khách VẪN lưu; referral MANUAL_REVIEW; KHÔNG hạn bảo vệ, KHÔNG nguồn Affiliate, KHÔNG dòng hoa hồng", async () => {
    const h = await dungHienTruong();
    const res = await goi(bieuMau(h), { origin: null });
    expect(res.status).toBe(200);
    expect(await soLead()).toBe(1); // không bỏ lead, không gọi nó là «nguồn không rõ» rồi vứt
    const { lead, ref } = await referralCua();
    expect(ref.status).toBe("MANUAL_REVIEW");
    expect(ref.protectedUntil).toBeNull(); // không giữ công 730 ngày cho SĐT này
    expect(ref.resolutionReason).toContain("Origin lẫn mã lượt bấm");
    expect(snap(ref)).toMatchObject({ origin: "VANG", click: "VANG", doTinCay: "THAP" });
    expect(lead.attribution!.matchedRule).not.toBe("AFFILIATE_REFERRAL");
    expect(lead.attribution!.referrerAffiliateId).toBeNull();
    // hoa hồng: chưa có ô tính / dòng sổ nào gắn lead này, và attribution không mang đối tác nào để engine tính cho
    expect(await db.commissionCalcSlot.count({ where: { payment: { order: { leadId: lead.id } } } })).toBe(0);
    // đối chứng dương: cùng hiện trường, thêm Origin khớp ⇒ VALID (không phải hiện trường này vốn hỏng)
    await goi(bieuMau(h, { phone: "0906000888" }), { origin: ORIGIN });
    expect((await referralCua("0906000888")).ref.status).toBe("VALID");
  }, CASE);

  it("[T2-05] link bị THU HỒI ⇒ REJECTED dù đủ tín hiệu (lý do thật hơn «thiếu tín hiệu» luôn thắng); khách vẫn lưu", async () => {
    const h = await dungHienTruong();
    const c = await taoClick(h);
    await db.affiliateTrackingAsset.update({ where: { id: h.asset.id }, data: { status: "REVOKED", revokedAt: new Date("2026-10-01T00:00:00.000Z"), revokedReason: "thu hồi fixture R9" } });
    expect((await goi(bieuMau(h, { clickId: c.id }), { origin: ORIGIN })).status).toBe(200);
    const { lead, ref } = await referralCua();
    expect(ref.status).toBe("REJECTED");
    expect(lead.attribution!.referrerAffiliateId).toBeNull();
  }, CASE);

  it("[T2-06] lượt bấm BỊ SỬA / sai / của link khác ⇒ MANUAL_REVIEW dù Origin khớp (không còn bỏ qua lặng lẽ); lead vẫn lưu; không gắn lượt bấm giả", async () => {
    const a = await dungHienTruong();
    const b = await dungHienTruong();
    const cuaB = await taoClick(b);
    const khongTonTai = `c${"a".repeat(24)}`; // đúng định dạng, không có trong DB
    const kieuHong = ["<script>alert(1)</script>", khongTonTai, cuaB.id];
    for (const [i, clk] of kieuHong.entries()) {
      const sdt = `09060009${i}${i}`;
      await goi(bieuMau(a, { phone: sdt, clickId: clk }), { origin: ORIGIN });
      const { ref } = await referralCua(sdt);
      expect(ref.status, clk).toBe("MANUAL_REVIEW");
      expect(ref.clickId, clk).toBeNull();
      expect(snap(ref), clk).toMatchObject({ click: "KHONG_HOP_LE", doTinCay: "THAP" });
      expect(ref.resolutionReason, clk).toContain("không hợp lệ");
    }
    await db.lead.deleteMany({ where: { phone: { in: [0, 1, 2].map((i) => `09060009${i}${i}`) } } }); // dọn: SĐT ngoài danh sách dọn mặc định của `don()`
  }, CASE);

  it("[T2-07] GỬI LẶP: cùng khoá ⇒ MỘT lead + MỘT referral (gửi lại KHÔNG bị tính là dùng lại clk); khoá MỚI mà dùng lại clk ⇒ lượt sau MANUAL_REVIEW, lượt đầu giữ nguyên", async () => {
    const h = await dungHienTruong();
    const c = await taoClick(h);
    const dau = bieuMau(h, { clickId: c.id });
    await goi(dau, { origin: ORIGIN });
    await goi(dau, { origin: ORIGIN }); // cùng idempotencyKey
    expect(await soLead()).toBe(1);
    expect(await db.affiliateReferral.count({ where: { partyId: h.doiTac.id } })).toBe(1);
    expect((await referralCua()).ref.status).toBe("VALID");

    // phát lại: một khách KHÁC (SĐT khác) dùng lại đúng lượt bấm đó với khoá MỚI
    await goi(bieuMau(h, { phone: "0906000888", clickId: c.id }), { origin: ORIGIN });
    const sau = await referralCua("0906000888");
    expect(sau.ref.status).toBe("MANUAL_REVIEW");
    expect(sau.ref.resolutionReason).toContain("đã được dùng");
    expect(sau.ref.clickId).toBe(c.id);
    expect((await referralCua()).ref.status).toBe("VALID"); // lượt đầu không bị lật
    expect(sau.lead.attribution!.referrerAffiliateId).toBeNull();
  }, CASE);

  it("[T2-08] lượt bấm HẾT HẠN cookie + thiếu Origin ⇒ REJECTED (lý do cookie đứng trước tín hiệu T2)", async () => {
    const h = await dungHienTruong({ cookieDays: 7 });
    const cu = await taoClick(h, { occurredAt: new Date(Date.now() - 30 * 86_400_000) });
    await goi(bieuMau(h, { clickId: cu.id }), { origin: null });
    const { ref } = await referralCua();
    expect(ref.status).toBe("REJECTED");
    expect(ref.resolutionReason).toContain("NGOAI_CUA_SO_COOKIE");
  }, CASE);

  // ── R9 · ngữ nghĩa cờ: `affiliate.enabled` TẮT ⇒ KHÔNG tạo attribution Affiliate MỚI qua đường nhập nội bộ (ô chọn nguồn) ──────
  it("[FLG-DB-01] người nhập CHỌN một đối tác ĐANG HOẠT ĐỘNG ở ô chọn nguồn: cờ Affiliate TẮT ⇒ phiếu bị chặn TRƯỚC giao dịch (0 lead, 0 attribution Affiliate); cờ BẬT (đối chứng dương) ⇒ attribution CHON_NGUON mang đối tác", async () => {
    const h = await dungHienTruong();
    const nhomDoiTac = await db.leadSourceGroup.create({
      data: { code: ma("G"), name: "Nguồn đối tác chọn tay", sourceType: "PARTNER", referrerRequirement: "AFFILIATE_ORG", sortOrder: 901, status: "ACTIVE", selectable: true },
    });
    const phieu = (sdt: string) => {
      const m = mapAffiliateIntake(affiliateIntakeSchema.parse(bieuMau(h, { phone: sdt })));
      if (!m.ok) throw new Error(m.error);
      return m.lead;
    };
    const nhap = (sdt: string) =>
      ingestIntakeLead(phieu(sdt), {
        source: "nhap-tay",
        tinHieuNguon: {
          ...KHONG_CO_TIN_HIEU_NGUON,
          nguonChon: { groupId: nhomDoiTac.id, employeeId: null, parentUserId: null, studentId: null, affiliateId: h.doiTac.id, giaiTrinh: null },
        },
      });

    // cờ TẮT (đặt tường minh false — khác với «chưa có dòng»)
    await db.systemSetting.deleteMany({ where: { key: "affiliate.enabled" } });
    await db.systemSetting.create({ data: { key: "affiliate.enabled", valueJson: false } });
    clearSettingsCache();
    const tat = await nhap(SDT);
    expect(tat.ok).toBe(false);
    expect(tat.error).toMatch(/không tồn tại hoặc đã tắt/);
    expect(await soLead()).toBe(0);
    expect(await db.leadAttribution.count({ where: { referrerAffiliateId: h.doiTac.id } })).toBe(0);

    // cờ BẬT ⇒ cùng đầu vào, qua được
    await db.systemSetting.deleteMany({ where: { key: "affiliate.enabled" } });
    await db.systemSetting.create({ data: { key: "affiliate.enabled", valueJson: true } });
    clearSettingsCache();
    const bat = await nhap(SDT);
    expect(bat.ok, bat.error).toBe(true);
    const a = (await docLead()).attribution!;
    expect(a).toMatchObject({ matchedRule: "CHON_NGUON", referrerKind: "AFFILIATE", referrerAffiliateId: h.doiTac.id });
  }, CASE);

  // ── R9 · N1 — không để phản hồi công khai làm lộ «SĐT này đã có trong CRM chưa» ────────────────────
  const ngayTho = (h: H, over: Record<string, unknown> = {}) => JSON.stringify(bieuMau(h, over));
  type KetQuaTho = Awaited<ReturnType<typeof xuLyIntakeGioiThieu>>;
  /** Gọi LÕI với đồng hồ cố định + hàm chờ ghi nhận (không chờ thật): trả kết quả và danh sách số ms đã xin chờ. */
  async function chayLoi(thanTho: string, origin: string | null): Promise<{ kq: KetQuaTho; cho: number[] }> {
    ipSeq += 1;
    const cho: number[] = [];
    const kq = await xuLyIntakeGioiThieu(
      { thanTho, origin, ip: `10.88.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`, userAgent: null },
      { now: () => new Date("2026-10-14T03:00:00.000Z"), choPhepTanSuat: async () => true, cho: async (ms) => void cho.push(ms), nhieuMs: () => 40 },
    );
    return { kq, cho };
  }

  it("[AFI-14] BỐN kết quả khác nhau (lead mới · SĐT đã có · xem tay · bị từ chối) trả CÙNG status + CÙNG thân + CÙNG lớp thời gian; khác biệt chỉ nằm ở DB/cổng quản trị", async () => {
    const h = await dungHienTruong();
    const moi = await chayLoi(ngayTho(h), ORIGIN); // lead MỚI → VALID
    const daCo = await chayLoi(ngayTho(h), ORIGIN); // CÙNG SĐT, khoá mới → lead trùng → REJECTED_DUPLICATE
    const xemTay = await chayLoi(ngayTho(h, { phone: "0906000888" }), null); // SĐT mới, thiếu tín hiệu → MANUAL_REVIEW
    await db.affiliateTrackingAsset.update({ where: { id: h.asset.id }, data: { status: "REVOKED", revokedAt: new Date("2026-10-01T00:00:00.000Z"), revokedReason: "thu hồi fixture R9" } });
    const tuChoi = await chayLoi(ngayTho(h, { phone: "0906000999" }), ORIGIN); // link thu hồi → REJECTED
    await db.lead.deleteMany({ where: { phone: "0906000999" } });

    const trangThai = (await db.affiliateReferral.findMany({ where: { partyId: h.doiTac.id }, select: { status: true } })).map((r) => r.status).sort();
    expect(trangThai).toEqual(["MANUAL_REVIEW", "REJECTED", "REJECTED_DUPLICATE", "VALID"]); // đối chứng dương: bốn nhánh THẬT sự khác nhau trong DB…
    for (const x of [daCo, xemTay, tuChoi]) {
      expect(x.kq.status).toBe(moi.kq.status); // …mà người gọi không phân biệt được
      expect(x.kq.body).toEqual(moi.kq.body);
      expect(x.cho).toEqual(moi.cho);
    }
    expect(moi.kq.status).toBe(200);
    expect(moi.cho).toEqual([DO_TRE_TOI_THIEU_MS + 40]); // đồng hồ cố định ⇒ chờ đúng ngưỡng + nhiễu, MỘT lần
    expect(DO_TRE_NHIEU_TOI_DA_MS).toBeGreaterThan(0);
  }, CASE);

  it("[AFI-16] KÝ TỰ ĐIỀU KHIỂN (NUL…) ở BẤT KỲ trường chuỗi nào ⇒ 400 «Dữ liệu không hợp lệ» TRƯỚC khi chạm DB — cùng kết quả dù SĐT đã có trong CRM hay chưa (đường «lead mới» ghi tên nên ném 500 với NUL, đường «trùng» thì không ⇒ từng là bộ dò chỉ bằng mã trạng thái, không cần token đúng)", async () => {
    const h = await dungHienTruong();
    // lead có sẵn với SĐT P (nhánh «trùng»)
    expect((await goi(bieuMau(h), { origin: ORIGIN })).status).toBe(200);
    const truoc = await soLead();
    expect(truoc).toBe(1);
    const sdtMoi = "0906000888";
    const BAI = [
      ["parentName", { parentName: "a\u0000b" }],
      ["note", { note: "dong\u0007chuong" }],
      ["email", { email: "x\u0000@y.vn" }],
      ["children[].fullName", { children: [{ fullName: "Bé\u0000An" }] }],
      ["utm", { utm: { utm_source: "fb\u0000" } }],
      ["token", { token: "tok\u0000en" }],
    ] as const;
    for (const [ten, them] of BAI) {
      for (const sdt of [SDT, sdtMoi]) {
        const res = await goi(bieuMau(h, { phone: sdt, ...them }), { origin: ORIGIN });
        expect(res.status, `${ten} @ ${sdt}`).toBe(400);
        expect(await res.json(), `${ten} @ ${sdt}`).toEqual({ ok: false, message: "Dữ liệu không hợp lệ." });
      }
    }
    expect(await soLead()).toBe(1); // không lead nào mới sinh ra
    expect(await soLead(sdtMoi)).toBe(0);
    // đối chứng dương: \t \n \r (ô ghi chú nhiều dòng) vẫn được
    expect((await goi(bieuMau(h, { phone: sdtMoi, note: "dòng một\r\n\tdòng hai" }), { origin: ORIGIN })).status).toBe(200);
    expect(await soLead(sdtMoi)).toBe(1);
  }, CASE);

  it("[AFI-15] lớp thời gian KHÔNG áp cho nhánh không chạm khách: bot (hp) · JSON hỏng · thân quá lớn · khoá lạ — không chờ (và không thêm thông tin)", async () => {
    const h = await dungHienTruong();
    for (const [ten, tho] of [
      ["bot hp", ngayTho(h, { hp: "gotcha" })],
      ["JSON hỏng", "{không phải json"],
      ["khoá lạ", ngayTho(h, { affiliateId: h.doiTac.id })],
      ["thân quá lớn", "x".repeat(20_000)],
    ] as const) {
      const r = await chayLoi(tho, ORIGIN);
      expect(r.cho, ten).toEqual([]);
    }
    expect(await soLead()).toBe(0);
  }, CASE);
});
