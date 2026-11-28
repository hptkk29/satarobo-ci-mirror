// @vitest-environment node
/**
 * [GLS-*] LINK GIỚI THIỆU CỦA SALE ⇒ LEAD GIAO THẲNG CHO SALE ĐÓ, KHÔNG TIÊU LƯỢT CHIA (chủ dự án 20/11/2026). Postgres thật (ci_test).
 *   [GLS-01] Tủ sách: khách KHÔNG chọn cơ sở ⇒ lead mang cơ sở của Sale, chủ = Sale, nguồn chia AFFILIATE, sổ lượt KHÔNG đổi
 *   [GLS-02] khách chọn ĐÚNG cơ sở của Sale ⇒ giao Sale; chọn cơ sở KHÁC ⇒ chia theo cơ sở khách chọn (không về tay Sale)
 *   [GLS-03] link của nhân sự KHÔNG phải Sale ⇒ không giao cho người đó (chia như cũ)
 *   [GLS-04] DISC: lưu bài qua link của Sale ⇒ giao thẳng cho Sale
 *   [GLS-05] lượt giới thiệu KHÔNG hợp lệ (Origin lệch ⇒ xem tay) ⇒ không kéo lead về Sale
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ gia: null as string | null, origin: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (ten: string) => (ten === "sr_aff" && H.gia ? { name: ten, value: H.gia } : undefined) }),
  headers: async () => new Headers({ "user-agent": "vitest", ...(H.origin ? { origin: H.origin } : {}) }),
}));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { taoLeadTuCong } from "../../lib/cong-thong-tin/tao-lead";
import type { PhieuHopLe } from "../../lib/cong-thong-tin/phieu";
import { layCoSoNhanLead } from "../../lib/lead/chia-theo-phuong-ghi";
import { taoCongCrmThat } from "../../lib/disc/crm-that";
import { sinhToken } from "../../lib/affiliate/token";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { NOW, P, RUN, assertCiTest, dauVao, depLuu, don, khoaIdem, luu, sdtChuan, sdtMoi } from "./_fx";

const describeDb = RUN ? describe : describe.skip;
const MA = "GLSAFF";
const HOST = "gls-doi-tac.example.test";
const ORIGIN = `https://${HOST}`;
let n = 0;
const ma = (t: string) => `${MA}_${t}${Date.now().toString(36).toUpperCase()}${(n += 1)}`;

async function donAff(): Promise<void> {
  const parties = await db.affiliate.findMany({ where: { code: { startsWith: MA } }, select: { id: true } });
  const pid = parties.map((x) => x.id);
  await db.affiliateReferral.deleteMany({ where: { partyId: { in: pid } } });
  await db.affiliateTrackingAsset.deleteMany({ where: { partyId: { in: pid } } });
  await db.affiliateMembership.deleteMany({ where: { partyId: { in: pid } } });
  const camp = await db.affiliateCampaign.findMany({ where: { code: { startsWith: MA } }, select: { id: true } });
  await db.affiliateCampaignSite.deleteMany({ where: { campaignId: { in: camp.map((c) => c.id) } } });
  await db.affiliateCampaign.deleteMany({ where: { id: { in: camp.map((c) => c.id) } } });
  const sites = await db.affiliateSite.findMany({ where: { code: { startsWith: MA } }, select: { id: true } });
  await db.affiliateLandingPage.deleteMany({ where: { siteId: { in: sites.map((s) => s.id) } } });
  await db.affiliateSite.deleteMany({ where: { code: { startsWith: MA } } });
  await db.affiliate.deleteMany({ where: { id: { in: pid } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: MA } } });
  const users = await db.user.findMany({ where: { email: { startsWith: "gls-" } }, select: { id: true } });
  const uid = users.map((u) => u.id);
  await db.leadAssignmentLog.deleteMany({ where: { OR: [{ assignedToId: { in: uid } }] } }).catch(() => undefined);
  await db.lead.updateMany({ where: { assignedToId: { in: uid } }, data: { assignedToId: null } });
  await db.leadRotationTurn.deleteMany({ where: { userId: { in: uid } } });
  await db.user.deleteMany({ where: { id: { in: uid } } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: "GLS-" } } });
}

/** Nhân sự + tài khoản (vai cho trước, ở cơ sở cho trước) + đối tác nối nhân sự + link hợp lệ trên website fixture. */
async function dungLinkCua(vai: "SALES_CSM" | "TEACHER", centerId: string) {
  const h = ma("X");
  const emp = await db.employee.create({ data: { employeeCode: `GLS-${h}`, fullName: `${P} NV ${h}`, jobTitle: vai, department: "KINH_DOANH" } });
  const user = await db.user.create({
    data: { name: `${P} ${h}`, email: `gls-${h.toLowerCase()}@example.test`, role: vai, roles: [vai], centerId, employeeId: emp.id, isActive: true },
    select: { id: true },
  });
  const nhom = await db.leadSourceGroup.create({
    data: { code: ma("S"), name: `Nguồn GLS ${h}`, sourceType: "REFERRAL", referrerRequirement: "NONE", sortOrder: 900, status: "ACTIVE", selectable: true },
  });
  const site = await db.affiliateSite.create({
    data: { code: ma("W"), name: `Web GLS ${h}`, baseUrl: ORIGIN, allowedDomains: [HOST], status: "ACTIVE", trackingEnabled: true, landingPages: { create: { pathPattern: "/tu-sach", isActive: true } } },
  });
  const campaign = await db.affiliateCampaign.create({
    data: { code: ma("C"), name: `Campaign GLS ${h}`, status: "ACTIVE", cookieWindowDays: 30, protectWindowDays: 90, allowSelfReferral: false, defaultSourceGroupId: nhom.id, sites: { create: { siteId: site.id } } },
  });
  const doiTac = await db.affiliate.create({ data: { code: ma("D"), name: `Đối tác GLS ${h}`, status: "ACTIVE", isActive: true, employeeId: emp.id } });
  const mem = await db.affiliateMembership.create({ data: { partyId: doiTac.id, campaignId: campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  const token = sinhToken();
  await db.affiliateTrackingAsset.create({
    data: { partyId: doiTac.id, membershipId: mem.id, campaignId: campaign.id, siteId: site.id, landingPath: "/tu-sach", publicToken: token, type: "LINK", status: "ACTIVE" },
  });
  return { userId: user.id, cookie: `${token}.${NOW.getTime()}` };
}

function phieu(sdt: string, coSoGanNha: string | null = null): PhieuHopLe {
  return {
    hoTen: `${P} PH GLS`,
    soDienThoai: sdtChuan(sdt),
    diaChi: { thanhPho: "Đà Nẵng", phuong: "Phường Hải Châu", soNha: null, coSoGanNha },
    tiepThi: false,
    nguon: "tu-sach",
    nguCanh: null,
  };
}

const tongLuot = async () => (await db.leadRotationTurn.aggregate({ _sum: { turns: true } }))._sum.turns ?? 0;
const docLead = (id: string) => db.lead.findUniqueOrThrow({ where: { id }, select: { centerId: true, assignedToId: true, assignmentSource: true } });

describeDb("[GLS] link của Sale ⇒ giao thẳng cho Sale", () => {
  let csA: { id: string; code: string | null } = { id: "", code: null };
  let csB: { id: string; code: string | null } = { id: "", code: null };
  beforeAll(async () => {
    await assertCiTest();
    await don();
    await donAff();
    const nhan = await layCoSoNhanLead();
    const cs = await db.center.findMany({ where: { id: { in: nhan.map((c) => c.id) } }, select: { id: true, code: true }, orderBy: { code: "asc" } });
    expect(cs.length).toBeGreaterThanOrEqual(2); // cần hai cơ sở nhận lead để phân biệt «cùng» và «khác» cơ sở
    csA = cs[0]!;
    csB = cs[1]!;
  });
  beforeEach(async () => {
    H.gia = null;
    H.origin = ORIGIN;
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

  it("[GLS-01] Tủ sách, khách KHÔNG chọn cơ sở ⇒ cơ sở của Sale, chủ = Sale (AFFILIATE), sổ lượt KHÔNG đổi", async () => {
    const s = await dungLinkCua("SALES_CSM", csA.id);
    const truoc = await tongLuot();
    const kq = await taoLeadTuCong(phieu(sdtMoi()), { cookieGioiThieu: s.cookie, origin: ORIGIN }, () => NOW);
    expect(await docLead(kq.leadId)).toEqual({ centerId: csA.id, assignedToId: s.userId, assignmentSource: "AFFILIATE" });
    expect(await tongLuot()).toBe(truoc); // không tiêu lượt chia
  });

  it("[GLS-02] khách chọn ĐÚNG cơ sở của Sale ⇒ giao Sale; chọn cơ sở KHÁC ⇒ lead ở cơ sở khách chọn, KHÔNG về tay Sale", async () => {
    const s = await dungLinkCua("SALES_CSM", csA.id);
    const cung = await taoLeadTuCong(phieu(sdtMoi(), csA.code), { cookieGioiThieu: s.cookie, origin: ORIGIN }, () => NOW);
    expect(await docLead(cung.leadId)).toMatchObject({ centerId: csA.id, assignedToId: s.userId, assignmentSource: "AFFILIATE" });
    const khac = await taoLeadTuCong(phieu(sdtMoi(), csB.code), { cookieGioiThieu: s.cookie, origin: ORIGIN }, () => NOW);
    const l = await docLead(khac.leadId);
    expect(l.centerId).toBe(csB.id);
    expect(l.assignedToId).not.toBe(s.userId);
  });

  it("[GLS-03] link của nhân sự KHÔNG phải Sale ⇒ không giao cho người đó", async () => {
    const gv = await dungLinkCua("TEACHER", csA.id);
    const kq = await taoLeadTuCong(phieu(sdtMoi()), { cookieGioiThieu: gv.cookie, origin: ORIGIN }, () => NOW);
    const l = await docLead(kq.leadId);
    expect(l.assignedToId).not.toBe(gv.userId);
    expect(l.assignmentSource).not.toBe("AFFILIATE");
  });

  it("[GLS-04] DISC: lưu bài qua link của Sale (khách không chọn cơ sở) ⇒ giao thẳng cho Sale", async () => {
    const s = await dungLinkCua("SALES_CSM", csA.id);
    H.gia = s.cookie;
    const key = khoaIdem("gls");
    const r = await luu(dauVao(sdtMoi(), { key }), depLuu(taoCongCrmThat(() => NOW)));
    expect(r.ok).toBe(true);
    const ban = await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(await docLead(ban.leadId!)).toEqual({ centerId: csA.id, assignedToId: s.userId, assignmentSource: "AFFILIATE" });
  });

  it("[GLS-05] lượt giới thiệu KHÔNG hợp lệ (Origin lệch ⇒ xem tay) ⇒ không kéo lead về Sale", async () => {
    const s = await dungLinkCua("SALES_CSM", csA.id);
    const kq = await taoLeadTuCong(phieu(sdtMoi()), { cookieGioiThieu: s.cookie, origin: "https://trang-khac.example.test" }, () => NOW);
    expect((await docLead(kq.leadId)).assignedToId).not.toBe(s.userId);
  });
});
