// @vitest-environment node
/**
 * [AHM-*] CHỐNG TRÙNG ⇒ KHÔNG HAI HOA HỒNG, đo bằng ĐƯỜNG TIỀN THẬT (CLOSEOUT Affiliate · lane L5a, ma trận §27 phần sổ).
 *
 * Phần referral của ma trận nằm ở `tests/lead-intake/affiliate-hop-dong.spec.ts` ([AHD-IDM-*]); ở đây đi tiếp một bước: biểu mẫu → lead → khoản thu THẬT (`recordPayment` + `confirmPayment`)
 * → quét bằng engine thật (`quetKhoan`) → ĐẾM dòng sổ `CommissionTransaction`. Thứ cần chứng minh: hai lượt giới thiệu cho CÙNG một khách không bao giờ thành hai dòng hoa hồng
 * AFFILIATE, và người đến sau KHÔNG có dòng nào.
 *
 *   [AHM-01] hai ĐỐI TÁC gửi cùng một khách (tuần tự) ⇒ đúng MỘT dòng AFFILIATE, thụ hưởng = người đến trước; người sau 0 dòng
 *   [AHM-02] CÙNG đối tác gửi lại (khác khoá) ⇒ đúng MỘT dòng AFFILIATE; quét lại không đẻ thêm
 *   [AHM-03] link bị THU HỒI ⇒ khách trả tiền mà KHÔNG có dòng AFFILIATE (đối chứng dương: [AHM-01])
 *   [AHM-04] 3 lượt SONG SONG cùng SĐT: đo số lead, rồi trả tiền trên MỘT lead ⇒ đúng một dòng AFFILIATE cho khoản đó (số lead do race ingest chung quyết, KHÔNG khẳng định ở đây)
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng hiện trường. LUẬT 19: ngày TUYỆT ĐỐI (đồng hồ của lõi intake được TIÊM, mốc tiền ghim ở 2026-10).
 * AN TOÀN DB: không `resetDb()`. Sổ BẤT BIẾN nên dọn bằng `donKichBan` TRƯỚC khi xoá campaign/referral (FK Restrict).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "10.9.9.7" }) }));
vi.setConfig({ testTimeout: 90_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb } from "../e2e/_helpers/seed";
import { xuLyIntakeGioiThieu } from "../../lib/affiliate/intake-cong-khai";
import { sinhToken } from "../../lib/affiliate/token";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { boiCanh, D, datMocCutover, donKichBan, dongSoCuaKhoan, dungBe, dungKichBan, tienVe, type KichBan } from "./_kich-ban";
import { datTranHoaHong } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[AHM] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "AHM";
const HOST = "ahm-doi-tac.example.test";
const ORIGIN = `https://${HOST}`;
const NOW = D("2026-11-20");
const NOW_LINK = D("2026-10-05");
const ATTRIBUTED = new Date("2026-10-01T03:00:00.000Z");
const NGAY_THU = D("2026-10-12");

/** Kịch bản cần dọn, khoá theo `ma`: đăng ký NGAY khi tạo (`kb`) để ca đỏ giữa chừng cũng không để rò cơ sở sống (`NHH-FE-HD-20` đếm mọi cơ sở còn OrgUnit), rồi `nhanLead` thay bằng bản có lead. */
const cuaToi = new Map<string, KichBan>();
let dem = 0;
const hau = () => `${Date.now().toString(36).toUpperCase()}${(dem += 1)}`;

async function don(): Promise<void> {
  const ds = await db.affiliate.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const ids = ds.map((x) => x.id);
  await db.affiliateReferral.deleteMany({ where: { partyId: { in: ids } } });
  // Lead (kể cả lead thừa do race ở ca AHM-04) mang `LeadAttribution.referrerAffiliateId` ⇒ phải đi TRƯỚC khi xoá đối tác (FK Restrict). `donKichBan` đã gỡ học viên/đơn của kịch bản.
  await db.lead.deleteMany({ where: { parentName: { startsWith: P } } });
  await db.affiliateTrackingAsset.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliateMembership.deleteMany({ where: { partyId: { in: ids } } });
  const camp = await db.affiliateCampaign.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const cid = camp.map((c) => c.id);
  await db.affiliateCampaignRule.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaignSite.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaign.deleteMany({ where: { id: { in: cid } } });
  const sites = await db.affiliateSite.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  await db.affiliateLandingPage.deleteMany({ where: { siteId: { in: sites.map((s) => s.id) } } });
  await db.affiliateSite.deleteMany({ where: { code: { startsWith: P } } });
  await db.affiliatePartyTag.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliate.deleteMany({ where: { id: { in: ids } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: P } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } });
}

/** Chuỗi link ĐẦY ĐỦ và hợp lệ + một hàm thêm ĐỐI TÁC thứ hai vào cùng campaign/website. */
async function dungHienTruong(opts: { thuHoi?: boolean } = {}) {
  const h = hau();
  const nhom = await db.leadSourceGroup.create({
    data: { code: `${P}_S${h}`, name: `Nguồn ${P} ${h}`, sourceType: "PARTNER", referrerRequirement: "NONE", sortOrder: 900, status: "ACTIVE", selectable: true, commissionEnabled: true },
  });
  const site = await db.affiliateSite.create({
    data: { code: `${P}_W${h}`, name: `Web ${P} ${h}`, baseUrl: ORIGIN, allowedDomains: [HOST], status: "ACTIVE", trackingEnabled: true, landingPages: { create: { pathPattern: "/khoa-robot" } } },
  });
  const campaign = await db.affiliateCampaign.create({
    data: { code: `${P}_C${h}`, name: `Campaign ${P} ${h}`, status: "ACTIVE", cookieWindowDays: 30, protectWindowDays: 90, defaultSourceGroupId: nhom.id, sites: { create: { siteId: site.id } } },
  });
  const loai = await db.affiliateType.create({ data: { code: `${P}_T${h}`, name: `Loại ${P} ${h}` } });

  const themDoiTac = async (nhan: string, thuHoi = false) => {
    const doiTac = await db.affiliate.create({ data: { code: `${P}_D${nhan}${h}`, name: `Đối tác ${nhan} ${P}`, status: "ACTIVE", isActive: true, typeId: loai.id } });
    const mem = await db.affiliateMembership.create({ data: { partyId: doiTac.id, campaignId: campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
    const token = sinhToken();
    const asset = await db.affiliateTrackingAsset.create({
      data: {
        partyId: doiTac.id, membershipId: mem.id, campaignId: campaign.id, siteId: site.id, landingPath: "/khoa-robot", publicToken: token, type: "LINK",
        status: thuHoi ? "REVOKED" : "ACTIVE", ...(thuHoi ? { revokedAt: new Date("2026-10-01T00:00:00.000Z"), revokedReason: "thu hồi fixture AHM" } : {}),
      },
    });
    return { doiTac, mem, asset, token };
  };
  const a = await themDoiTac("A", opts.thuHoi);
  return { h, nhom, site, campaign, loai, themDoiTac, ...a };
}

let ipSeq = 0;
let sdtSeq = 0;
const sdtMoi = () => `0908${String(Date.now() % 100_000).padStart(5, "0")}${(sdtSeq += 1) % 10}`; // 0908 + 5 số + 1 số = 10 chữ số, di động hợp lệ
const bienThe = (s: string) => [s, `84${s.slice(1)}`];

/** MỘT lượt gửi biểu mẫu qua lõi intake THẬT (đồng hồ tiêm, không giới hạn tần suất). */
async function gui(token: string, sdt: string, khoa: string) {
  ipSeq += 1;
  const r = await xuLyIntakeGioiThieu(
    {
      thanTho: JSON.stringify({ v: 1, token, idempotencyKey: khoa, parentName: `${P} PH`, phone: sdt, children: [{ fullName: `${P} Bé` }], consentMarketing: true }),
      origin: ORIGIN,
      ip: `10.67.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`,
      userAgent: null,
    },
    { now: () => NOW_LINK, choPhepTanSuat: async () => true },
  );
  expect(r.status).toBe(200);
}

/** Gắn lead (đầu tiên theo SĐT) vào kịch bản: người chốt/cơ sở để SALE có người nhận; `attributedAt` sang ngày tuyệt đối. */
async function nhanLead(k: KichBan, sdt: string, leadId?: string): Promise<KichBan> {
  const id = leadId ?? (await db.lead.findFirstOrThrow({ where: { phone: { in: bienThe(sdt) }, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } })).id;
  await db.lead.update({ where: { id }, data: { convertedById: k.sale.id, adminId: k.saleAdmin.id, centerId: k.centerId, status: "DA_DANG_KY" } });
  await db.leadAttribution.update({ where: { leadId: id }, data: { attributedAt: ATTRIBUTED } });
  const kk: KichBan = { ...k, lead: await db.lead.findUniqueOrThrow({ where: { id } }) };
  cuaToi.set(kk.ma, kk);
  return kk;
}

/** MỘT khoản NEW 10.000.000đ đã xác nhận → quét bằng engine thật. */
async function thuVaQuet(k: KichBan, ten: string) {
  const bc = await boiCanh(k, NOW);
  const be = await dungBe(k, ten, { tongTien: 10_000_000 });
  const khoan = await tienVe(k, be, { soTien: 10_000_000, ngay: NGAY_THU });
  const kq = await quetKhoan(db, bc, khoan);
  return { bc, khoan, kq, dong: await dongSoCuaKhoan(khoan) };
}

const kb = async (tien: string) => {
  const k = await dungKichBan(tien, { coLead: false, rules: [{ vai: "SALE", rate: 0.04 }, { vai: "AFFILIATE", rate: 0.01 }] });
  cuaToi.set(k.ma, k);
  return k;
};
const dongAff = (dong: Awaited<ReturnType<typeof dongSoCuaKhoan>>) => dong.filter((d) => d.roleCode === "AFFILIATE");

describe.skipIf(!RUN_DB_TESTS)("[AHM] chống trùng ⇒ không hai hoa hồng — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["HO_ACCOUNTANT", "CENTER_SALES_CSM"] });
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
    await datMocCutover("2026-10");
    await don().catch(() => undefined);
  }, 180_000);

  afterAll(async () => {
    await donKichBan([...cuaToi.values()]);
    await don();
    await datMocCutover(null);
    await datTranHoaHong(null);
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
  }, 180_000);

  it("[AHM-01] hai ĐỐI TÁC gửi CÙNG một khách ⇒ đúng MỘT dòng AFFILIATE trả cho người đến TRƯỚC; người đến sau (REJECTED_DUPLICATE) 0 dòng", async () => {
    const ht = await dungHienTruong();
    const b = await ht.themDoiTac("B");
    const k0 = await kb("m01");
    const sdt = sdtMoi();
    await gui(ht.token, sdt, `ahm-a-${hau().toLowerCase()}-01`);
    await gui(b.token, sdt, `ahm-b-${hau().toLowerCase()}-01`);
    const rs = await db.affiliateReferral.findMany({ where: { lead: { phone: { in: bienThe(sdt) } } }, select: { partyId: true, status: true }, orderBy: { createdAt: "asc" } });
    expect(rs).toEqual([
      { partyId: ht.doiTac.id, status: "VALID" },
      { partyId: b.doiTac.id, status: "REJECTED_DUPLICATE" },
    ]);

    const k = await nhanLead(k0, sdt);
    const { kq, dong } = await thuVaQuet(k, "a");
    expect(kq.loai).toBe("DA_GHI");
    const aff = dongAff(dong);
    expect(aff).toHaveLength(1); // đối chứng dương: người đến trước CÓ tiền
    expect(aff[0]).toMatchObject({ amount: 100_000, beneficiaryKind: "AFFILIATE", beneficiaryAffiliateId: ht.doiTac.id });
    expect(dong.filter((d) => d.beneficiaryAffiliateId === b.doiTac.id)).toHaveLength(0); // người đến sau: không dòng nào
    expect(dong.filter((d) => d.roleCode === "SALE")).toHaveLength(1);
  });

  it("[AHM-02] CÙNG đối tác gửi lại cùng khách (khác khoá) ⇒ đúng MỘT dòng AFFILIATE; quét lại không đẻ thêm", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("m02");
    const sdt = sdtMoi();
    await gui(ht.token, sdt, `ahm-a-${hau().toLowerCase()}-02`);
    await gui(ht.token, sdt, `ahm-a-${hau().toLowerCase()}-03`);
    const rs = await db.affiliateReferral.findMany({ where: { lead: { phone: { in: bienThe(sdt) } } }, select: { status: true }, orderBy: { createdAt: "asc" } });
    expect(rs.map((r) => r.status)).toEqual(["VALID", "REJECTED_DUPLICATE"]);

    const k = await nhanLead(k0, sdt);
    const { bc, khoan, dong } = await thuVaQuet(k, "a");
    expect(dongAff(dong)).toHaveLength(1);
    expect((await quetKhoan(db, bc, khoan)).loai).toBe("KHONG_DOI");
    expect(dongAff(await dongSoCuaKhoan(khoan))).toHaveLength(1);
  });

  it("[AHM-03] link bị THU HỒI ⇒ khách vẫn lưu và trả tiền nhưng KHÔNG có dòng AFFILIATE (chỉ SALE); referral REJECTED", async () => {
    const ht = await dungHienTruong({ thuHoi: true });
    const k0 = await kb("m03");
    const sdt = sdtMoi();
    await gui(ht.token, sdt, `ahm-a-${hau().toLowerCase()}-04`);
    const rs = await db.affiliateReferral.findMany({ where: { lead: { phone: { in: bienThe(sdt) } } }, select: { status: true } });
    expect(rs.map((r) => r.status)).toEqual(["REJECTED"]);

    const k = await nhanLead(k0, sdt);
    const { kq, dong } = await thuVaQuet(k, "a");
    expect(kq.loai).toBe("DA_GHI");
    expect(dong.filter((d) => d.roleCode === "SALE")).toHaveLength(1); // đối chứng dương: khoản này CÓ sinh tiền cho vai khác
    expect(dongAff(dong)).toHaveLength(0);
    expect(dong.filter((d) => d.beneficiaryAffiliateId === ht.doiTac.id)).toHaveLength(0);
  });

  it("[AHM-04] 3 lượt SONG SONG cùng SĐT khác khoá: đo số lead; trả tiền trên MỘT lead ⇒ đúng MỘT dòng AFFILIATE cho khoản đó", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("m04");
    const sdt = sdtMoi();
    await Promise.all([1, 2, 3].map((i) => gui(ht.token, sdt, `ahm-a-${hau().toLowerCase()}-p${i}`)));
    const soLead = await db.lead.count({ where: { phone: { in: bienThe(sdt) }, deletedAt: null } });
    expect(soLead).toBeGreaterThanOrEqual(1); // KHÔNG khẳng định == 1: race tra-trùng-SĐT của ingest chung (notes lane, F-IDM)
    const ref = await db.affiliateReferral.findMany({ where: { lead: { phone: { in: bienThe(sdt) } } }, select: { leadId: true, status: true } });
    const validTheoLead = new Map<string, number>();
    for (const r of ref) if (r.status === "VALID") validTheoLead.set(r.leadId!, (validTheoLead.get(r.leadId!) ?? 0) + 1);
    for (const [, n] of validTheoLead) expect(n).toBeLessThanOrEqual(1);

    const k = await nhanLead(k0, sdt);
    const { dong } = await thuVaQuet(k, "a");
    expect(dongAff(dong)).toHaveLength(1);
  });
});
