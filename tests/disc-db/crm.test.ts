// @vitest-environment node
/**
 * [DDB-CRM-*] CRM THẬT (lõi lead / quy nguồn / affiliate) qua `taoCongCrmThat` + `luuKetQuaDisc` trên Postgres thật (ci_test).
 *   [DDB-CRM-01] không mã giới thiệu ⇒ lead mới, nguồn «KH tự đến» (WALK_IN), đồng ý tiếp thị = false dù người gõ tích
 *   [DDB-CRM-02] SĐT đã có lead ⇒ KHÔNG tạo lead thứ hai, KHÔNG đổi nguồn, bài trỏ về lead cũ (kể cả khi có cookie giới thiệu)
 *   [DDB-CRM-03] mã giới thiệu HỢP LỆ (cookie sr_aff): LÚC LƯU KHÔNG ghi referral (N4); chỉ ghi SAU khi chủ số nhận bài (taoGhiReferralSauNhanThat)
 *   [DDB-CRM-04] mã giới thiệu RÁC ⇒ rơi về «KH tự đến», không ném
 *   [DDB-CRM-05] KHÔNG có tên con / năm sinh / điểm / bộ đề trong Lead · LeadAttribution · LeadActivity · LeadTouchpoint · AffiliateReferral
 *   [DDB-CRM-06] gọi CRM lặp cho cùng một bài ⇒ cùng lead (eventId disc:<id>), không thêm
 * Cookie `sr_aff` được GIẢ ở `next/headers` (không có request thật); mọi thứ còn lại chạy thật.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const COOKIE = vi.hoisted(() => ({ gia: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (ten: string) => (ten === "sr_aff" && COOKIE.gia ? { name: ten, value: COOKIE.gia } : undefined) }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { layCoSoNhanLead } from "../../lib/lead/chia-theo-phuong-ghi";
import { maCoSoChonDuoc } from "../../lib/disc/dia-chi";
import { taoCongCrmThat, taoGhiReferralSauNhanThat } from "../../lib/disc/crm-that";
import { sinhToken } from "../../lib/affiliate/token";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { NOW, P, RUN, TEN_CON, assertCiTest, dauVao, depLuu, don, khoaIdem, luu, sdtChuan, sdtMoi } from "./_fx";

const describeDb = RUN ? describe : describe.skip;
const MA = "DISCDBAFF";
const HOST = "discdb-doi-tac.example.test";
const TRANG = "/disc";

async function donAff(): Promise<void> {
  const parties = await db.affiliate.findMany({ where: { code: { startsWith: MA } }, select: { id: true } });
  const pid = parties.map((x) => x.id);
  await db.affiliateReferral.deleteMany({ where: { partyId: { in: pid } } });
  await db.affiliateTrackingAsset.deleteMany({ where: { partyId: { in: pid } } });
  await db.affiliateMembership.deleteMany({ where: { partyId: { in: pid } } });
  const camp = await db.affiliateCampaign.findMany({ where: { code: { startsWith: MA } }, select: { id: true } });
  const cid = camp.map((c) => c.id);
  await db.affiliateCampaignRule.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaignSite.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaign.deleteMany({ where: { id: { in: cid } } });
  const sites = await db.affiliateSite.findMany({ where: { code: { startsWith: MA } }, select: { id: true } });
  await db.affiliateLandingPage.deleteMany({ where: { siteId: { in: sites.map((s) => s.id) } } });
  await db.affiliateSite.deleteMany({ where: { code: { startsWith: MA } } });
  await db.affiliate.deleteMany({ where: { id: { in: pid } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: MA } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: MA } } });
}

let n = 0;
const ma = (t: string) => `${MA}_${t}${Date.now().toString(36).toUpperCase()}${(n += 1)}`;

async function dungHienTruong() {
  const nhom = await db.leadSourceGroup.create({
    data: { code: ma("S"), name: "Nguồn KOL fixture DISCDB", sourceType: "PARTNER", referrerRequirement: "NONE", sortOrder: 900, status: "ACTIVE", selectable: true },
  });
  const site = await db.affiliateSite.create({
    data: { code: ma("W"), name: "Web fixture DISCDB", baseUrl: `https://${HOST}`, allowedDomains: [HOST], status: "ACTIVE", trackingEnabled: true, landingPages: { create: { pathPattern: TRANG, isActive: true } } },
  });
  const campaign = await db.affiliateCampaign.create({
    data: { code: ma("C"), name: "Campaign fixture DISCDB", status: "ACTIVE", cookieWindowDays: 30, protectWindowDays: 90, allowSelfReferral: false, defaultSourceGroupId: nhom.id, sites: { create: { siteId: site.id } } },
  });
  const loai = await db.affiliateType.create({ data: { code: ma("T"), name: "Loại fixture DISCDB" } });
  const doiTac = await db.affiliate.create({ data: { code: ma("D"), name: "Đối tác fixture DISCDB", status: "ACTIVE", isActive: true, typeId: loai.id } });
  const mem = await db.affiliateMembership.create({ data: { partyId: doiTac.id, campaignId: campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  const token = sinhToken();
  await db.affiliateTrackingAsset.create({
    data: { partyId: doiTac.id, membershipId: mem.id, campaignId: campaign.id, siteId: site.id, landingPath: TRANG, publicToken: token, type: "LINK", status: "ACTIVE" },
  });
  return { nhom, doiTac, token };
}

async function luuQuaCrm(sdt: string, o: Parameters<typeof dauVao>[1] = {}) {
  const key = o.key ?? khoaIdem("crm");
  const r = await luu(dauVao(sdt, { ...o, key }), depLuu(taoCongCrmThat(() => NOW)));
  if (!r.ok) throw new Error(`luu hỏng: ${r.loi}`);
  const ban = await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: key } });
  return { r, ban };
}
/** Bước "sau khi chủ số nhận bài" (nhan-prisma.sauKhiNhan) — referral CHỈ ghi ở đây (N4). */
const sauNhan = (submissionId: string, sdt: string) => taoGhiReferralSauNhanThat(() => NOW)({ submissionId, sdtChuan: sdtChuan(sdt) });
const docLead = (id: string) =>
  db.lead.findUniqueOrThrow({ where: { id }, include: { attribution: { include: { group: { select: { code: true, id: true } } } } } });

describeDb("[DDB-CRM] CRM thật", () => {
  beforeAll(async () => {
    await assertCiTest();
    await don();
    await donAff();
  });
  beforeEach(async () => {
    COOKIE.gia = null;
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

  it("[DDB-CRM-01] không mã giới thiệu ⇒ lead mới, nguồn WALK_IN, tiếp thị = false dù người gõ tích", async () => {
    const sdt = sdtMoi();
    const { ban } = await luuQuaCrm(sdt, { tiepThi: true });
    expect(ban.consentMarketing).toBe(true); // ô tích của người gõ được GHI NHẬN trên bài…
    expect(ban.leadId).not.toBeNull();
    const lead = await docLead(ban.leadId!);
    expect(lead.consentMarketing).toBe(false); // …nhưng KHÔNG bật trên lead (chủ số chưa xác thực)
    expect(lead.phone).toBe(sdtChuan(sdt));
    expect(lead.eventId).toBe(`disc:${ban.id}`);
    expect(lead.attribution?.group.code).toBe("WALK_IN");
    expect(lead.source).toBe("web");
  });

  it("[DDB-CRM-02] SĐT đã có lead ⇒ không tạo lead thứ hai, không đổi nguồn (kể cả có cookie giới thiệu hợp lệ)", async () => {
    const sdt = sdtMoi();
    const a = await luuQuaCrm(sdt);
    const truoc = await docLead(a.ban.leadId!);
    const h = await dungHienTruong();
    COOKIE.gia = `${h.token}.${NOW.getTime()}`;
    const b = await luuQuaCrm(sdt);
    expect(b.ban.leadId).toBe(a.ban.leadId);
    expect(await db.lead.count({ where: { phone: { in: [sdt, sdtChuan(sdt)] }, deletedAt: null } })).toBe(1);
    const sau = await docLead(a.ban.leadId!);
    expect(sau.attribution?.groupId).toBe(truoc.attribution?.groupId);
    expect(sau.attribution?.group.code).toBe("WALK_IN");
    expect(sau.attribution?.matchedRule).toBe(truoc.attribution?.matchedRule);
    expect(sau.eventId).toBe(truoc.eventId);
    expect(sau.source).toBe(truoc.source);
    // N4: lượt lưu KHÔNG đủ để gắn referral cho SĐT này — kể cả trên lead cũ
    expect(await db.affiliateReferral.count({ where: { leadId: a.ban.leadId! } })).toBe(0);
  });

  it("[DDB-CRM-03] N4: mã giới thiệu hợp lệ nhưng LÚC LƯU ⇒ KHÔNG referral, KHÔNG nguồn affiliate; SAU khi chủ số nhận bài ⇒ referral MANUAL_REVIEW (xem tay), nguồn vẫn «KH tự đến»", async () => {
    // Đo 02/11/2026: adapter DISC không có Origin lẫn mã lượt bấm ⇒ `quyetDinhReferral` ra XEM_TAY. Giữ có chủ đích (không tự ghi công) — xem [DDB-CRM-03x].
    const h = await dungHienTruong();
    COOKIE.gia = `${h.token}.${NOW.getTime()}`;
    const sdt = sdtMoi();
    const { ban } = await luuQuaCrm(sdt);
    const lead = await docLead(ban.leadId!);
    expect(lead.attribution?.group.code).toBe("WALK_IN");
    expect(await db.affiliateReferral.count({ where: { leadId: lead.id } })).toBe(0); // lưu bài bằng SĐT người khác không bơm được referral
    expect(await sauNhan(ban.id, sdt)).toBe("DA_GHI");
    const rf = await db.affiliateReferral.findMany({ where: { leadId: lead.id }, select: { status: true, partyId: true } });
    expect(rf.map((x) => x.status)).toEqual(["MANUAL_REVIEW"]);
    expect(rf[0]!.partyId).toBe(h.doiTac.id);
    expect((await docLead(lead.id)).attribution?.group.code).toBe("WALK_IN"); // nguồn lead không đổi
    expect(await sauNhan(ban.id, sdt)).toBe("DA_GHI"); // gọi lặp ⇒ idempotent
    expect(await db.affiliateReferral.count({ where: { leadId: lead.id } })).toBe(1);
  });

  it("[DDB-CRM-03n] N4: kẻ lưu bài bằng SĐT nạn nhân + email của mình + cookie affiliate của mình ⇒ lead KHÔNG mang referral lẫn email", async () => {
    const h = await dungHienTruong();
    COOKIE.gia = `${h.token}.${NOW.getTime()}`;
    const { ban } = await luuQuaCrm(sdtMoi(), { email: "ke-tan-cong@example.test", tiepThi: true });
    const lead = await docLead(ban.leadId!);
    expect(lead.email).toBeNull();
    expect(lead.consentMarketing).toBe(false);
    expect(await db.affiliateReferral.count({ where: { leadId: lead.id } })).toBe(0);
    expect(await db.affiliateReferral.count({ where: { partyId: h.doiTac.id } })).toBe(0);
    const nhat = JSON.stringify(await db.$queryRaw`select * from "Lead" where id = ${lead.id}`);
    expect(nhat).not.toContain("ke-tan-cong");
  });

  // PIN BUG (it.fails) — NỢ CÓ CHỦ ĐÍCH (ISSUE-1): server action không đọc được clickId/Origin hợp lệ ⇒ luôn XEM_TAY. Bơm thêm tín hiệu từ cookie
  // sr_aff_s sẽ biến vector N4 (affiliate dùng SĐT người lạ) thành VALID tự động — rủi ro ghi công sai lớn hơn lợi ích. Giữ ghim.
  it.fails("[DDB-CRM-03x] mã giới thiệu hợp lệ ⇒ nguồn = nguồn mặc định của campaign + referral VALID", async () => {
    const h = await dungHienTruong();
    COOKIE.gia = `${h.token}.${NOW.getTime()}`;
    const sdt = sdtMoi();
    const { ban } = await luuQuaCrm(sdt);
    await sauNhan(ban.id, sdt);
    const lead = await docLead(ban.leadId!);
    expect(lead.attribution?.groupId).toBe(h.nhom.id);
    expect((await db.affiliateReferral.findMany({ where: { leadId: lead.id }, select: { status: true } })).map((x) => x.status)).toEqual(["VALID"]);
  });

  it("[DDB-CRM-04] mã giới thiệu RÁC ⇒ KH tự đến, không ném", async () => {
    COOKIE.gia = "khong-phai-token-that.123";
    const { ban } = await luuQuaCrm(sdtMoi());
    const lead = await docLead(ban.leadId!);
    expect(lead.attribution?.group.code).toBe("WALK_IN");
    expect(await db.affiliateReferral.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it("[DDB-CRM-05] không có tên con / năm sinh / điểm / bộ đề trong Lead · Attribution · Activity · Touchpoint · Referral", async () => {
    const h = await dungHienTruong();
    COOKIE.gia = `${h.token}.${NOW.getTime()}`;
    const sdt = sdtMoi();
    const a = await luuQuaCrm(sdt, { tiepThi: true, email: "gia@example.test" });
    await sauNhan(a.ban.id, sdt); // referral chỉ có sau khi chủ số nhận bài (cookie còn trong request nhận)
    COOKIE.gia = null;
    await luuQuaCrm(sdt); // lượt trùng cũng ghi dấu vết lên lead cũ
    const id = a.ban.leadId!;
    const [lead, attr, act, tp, rf] = await Promise.all([
      db.$queryRaw<unknown[]>`select * from "Lead" where id = ${id}`,
      db.$queryRaw<unknown[]>`select * from "LeadAttribution" where "leadId" = ${id}`,
      db.$queryRaw<unknown[]>`select * from "LeadActivity" where "leadId" = ${id}`,
      db.$queryRaw<unknown[]>`select * from "LeadTouchpoint" where "leadId" = ${id}`,
      db.$queryRaw<unknown[]>`select * from "AffiliateReferral" where "leadId" = ${id}`,
    ]);
    // Đối chứng dương: có dữ liệu để quét (tránh xanh vì rỗng)
    expect(lead).toHaveLength(1);
    expect(attr).toHaveLength(1);
    expect(tp.length).toBeGreaterThanOrEqual(1);
    expect(rf.length).toBeGreaterThanOrEqual(1);
    const nhat = JSON.stringify({ lead, attr, act, tp, rf });
    expect(nhat).not.toContain("Kiểm-Thử");
    expect(nhat).not.toContain(TEN_CON);
    expect(nhat).not.toMatch(/(?<![0-9a-z])2016(?![0-9a-z])/i); // năm sinh con
    for (const cam of ["PH-GIA", "HS-GIA", "engine-GIA", "birthYear", "bacHoc", "traLoi", "\"D\":", "diem"]) expect(nhat, cam).not.toContain(cam);
    // Đối chứng dương cho chính bộ quét: tên PHỤ HUYNH (thông tin liên hệ người lớn) CÓ trong lead
    expect(nhat).toContain(`${P} Phụ huynh`);
  });

  it("[DDB-CRM-07] địa chỉ nơi ở (thành phố · phường/xã · số nhà) ghi vào ĐÚNG ô của lead; không khai ⇒ các ô trống", async () => {
    const sdt = sdtMoi();
    const key = khoaIdem("dc");
    const r = await luu({ ...dauVao(sdt, { key }), diaChi: { thanhPho: "Tp Đà Nẵng", phuong: "Phường Hải Châu", soNha: "12 Lê Duẩn", coSoGanNha: null } }, depLuu(taoCongCrmThat(() => NOW)));
    expect(r.ok).toBe(true);
    const ban = await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: key } });
    const lead = await docLead(ban.leadId!);
    expect([lead.city, lead.ward, lead.addressLine]).toEqual(["Tp Đà Nẵng", "Phường Hải Châu", "12 Lê Duẩn"]);
    const khong = await luuQuaCrm(sdtMoi());
    const l2 = await docLead(khong.ban.leadId!);
    expect([l2.city, l2.ward, l2.addressLine]).toEqual([null, null, null]);
  });

  it("[DDB-CRM-08] khách TỰ chọn «cơ sở gần nhà» ⇒ lead mang ĐÚNG cơ sở đó, với MỌI cơ sở chọn được (thắng chia đều), địa chỉ vẫn ghi cùng lúc", async () => {
    const nhan = await layCoSoNhanLead();
    const choChon = new Set(maCoSoChonDuoc());
    const cacCo = await db.center.findMany({ where: { id: { in: nhan.map((c) => c.id) }, code: { in: [...choChon] } }, select: { id: true, code: true } });
    // Phải thử ÍT NHẤT hai cơ sở: chọn đúng cơ sở mà chia đều cũng sẽ chọn thì không chứng minh được gì.
    expect(cacCo.length).toBeGreaterThanOrEqual(2);
    for (const co of cacCo) {
      const key = khoaIdem("cs");
      const r = await luu({ ...dauVao(sdtMoi(), { key }), diaChi: { thanhPho: "Tp Đà Nẵng", phuong: "Phường Hải Châu", soNha: null, coSoGanNha: co.code } }, depLuu(taoCongCrmThat(() => NOW)));
      expect(r.ok).toBe(true);
      const lead = await docLead((await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: key } })).leadId!);
      expect(lead.centerId, `cơ sở ${co.code}`).toBe(co.id);
      expect(lead.city).toBe("Tp Đà Nẵng");
    }
  });

  it("[DDB-CRM-06] gọi CRM lặp cho cùng một bài ⇒ cùng lead", async () => {
    const sdt = sdtMoi();
    const { ban } = await luuQuaCrm(sdt);
    const crm = taoCongCrmThat(() => NOW);
    const l1 = await crm({ submissionId: ban.id, soDienThoai: sdtChuan(sdt), tenPhuHuynh: `${P} Phụ huynh`, email: null, tiepThi: false, chienDich: "DISC", diaChi: null });
    const l2 = await crm({ submissionId: ban.id, soDienThoai: sdtChuan(sdt), tenPhuHuynh: `${P} Phụ huynh`, email: null, tiepThi: false, chienDich: "DISC", diaChi: null });
    expect(l1.leadId).toBe(ban.leadId);
    expect(l2.leadId).toBe(ban.leadId);
    expect(await db.lead.count({ where: { eventId: `disc:${ban.id}` } })).toBe(1);
  });
});
