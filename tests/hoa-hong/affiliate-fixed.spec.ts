// @vitest-environment node
/**
 * [FX-DB-*] — HOA HỒNG CỐ ĐỊNH `FIXED_PER_PURCHASE` của chính sách campaign Affiliate trên Postgres THẬT (AFF-L2b, Q14 đã chốt).
 *
 * Nghĩa đã chốt: số tiền cố định `giaTri` trả MỘT LẦN cho mỗi LẦN MUA (một dòng học phí của đơn), tại khoản thu ĐẦU của lần mua đó. Các khoản sau (trả góp / nhiều đợt) KHÔNG sinh thêm dòng cố định.
 * Hoàn tiền thu hồi theo TỈ LỆ khoản đã hoàn bằng cơ chế REVERSAL có sẵn. Trần so trên tỉ lệ hiệu dụng `giaTri ÷ cơ sở của khoản đầu`.
 *
 * Lead đi qua ĐƯỜNG THẬT của P1 (`xuLyIntakeGioiThieu` → token → referral → quy nguồn), thanh toán bằng hàm thật (`recordPayment`/`confirmPayment`/`refundPayment`), quét bằng engine thật.
 *
 *   [FX-DB-00] ĐỐI CHỨNG «ca cũ không đổi»: không rule FIXED ⇒ số tiền từng đợt Y HỆT bản trước AFF-L2b (số đo trên mã TRƯỚC, không phải số tự tính)
 *   [FX-DB-01] 3 đợt của MỘT lần mua ⇒ ĐÚNG MỘT dòng cố định (đợt 1); đợt 2-3 chỉ có phần trăm của Sale
 *   [FX-DB-02] quét lại ⇒ KHONG_DOI, không đẻ dòng thừa
 *   [FX-DB-03] phiên bản chính sách MỚI đổi giá trị ⇒ dòng đã ghi KHÔNG bị viết lại; lần mua mới dùng giá trị mới
 *   [FX-DB-04] hoàn tiền đợt 1 ⇒ REVERSAL cố định đúng TỈ LỆ hoàn; hoàn đợt 2 KHÔNG đụng dòng cố định; quét lại không trôi giả
 *   [FX-DB-05] hoàn một phần rồi quét lại KHÔNG lật sang VUOT_TRAN (trần đo trên cơ sở GỐC của khoản đầu, không trên cơ sở còn lại)
 *   [FX-DB-06] khoản đầu quá nhỏ (tiền cọc) ⇒ VUOT_TRAN fail-closed (0 dòng cho CẢ khoản, hàng chờ CAP_EXCEEDED); số cố định KHÔNG dời sang khoản sau
 *   [FX-DB-07] người hưởng là TỔ CHỨC ⇒ dòng cố định ON_HOLD; đợt sau không thêm dòng
 *   [FX-DB-08] khoản đến TRỄ (ngày thu sớm hơn khoản đã ghi) ⇒ KHÔNG trả hai lần; khoản chủ không trôi
 *   [FX-DB-09] khoản KHÔNG gắn dòng (chỉ gắn ghi danh) vẫn được nhận ra là «đã có tiền trước» ⇒ không trả lần hai (quét khoản gắn dòng TRƯỚC để lớp sổ cái không che lỗi)
 *   [FX-DB-20] KHÔNG HỒI TỐ: chính sách có hiệu lực SAU thời điểm mua ⇒ lần mua ấy không nhận số cố định (kể cả khoản thu sau); lần mua bắt đầu sau hiệu lực nhận đúng một lần
 *   [FX-DB-10] phạm vi bị chặn ⇒ guardrail kích hoạt THẬT trả FIXED_PHAM_VI_RONG; phạm vi campaign ⇒ qua (kèm cảnh báo trần theo khoản đầu)
 *   [FX-DB-11] «Vì sao con số này» của dòng cố định nêu: số cố định, MỘT lần ở khoản đầu, tỉ lệ hiệu dụng, cơ sở
 *   [FX-DB-13] «khoản đầu» không phụ thuộc THỨ TỰ QUÉT (quét đợt 3 → 2 → 1)
 *   [FX-DB-14] hai khoản CÙNG ngày: id nhỏ hơn là khoản đầu
 *   [FX-DB-15] khoản đầu bị TỪ CHỐI: đang CHỜ quyết thì khoản khác KHÔNG nhận (không trả hai); người duyệt ĐẢO sạch ⇒ số cố định chuyển sang khoản kế (tổng ròng đúng 300.000, không mất)
 *   [FX-DB-16] khoản kế đã quét TRƯỚC khi đảo ⇒ sau khi đảo, quét lại báo INPUT_DRIFT (không im lặng), "Áp dụng" ⇒ tổng ròng đúng 300.000
 *   [FX-DB-17] khoản đầu bị từ chối mà người duyệt chọn «GIỮ NGUYÊN» ⇒ tiền vẫn ở khoản đầu, khoản kế KHÔNG nhận lần hai
 *   [FX-DB-18] khoản đầu được HOÀN HẾT (vẫn là thực thu, số cố định đã đảo −300.000, ròng 0) ⇒ khoản kế KHÔNG nhận lại (hoàn tiền thu hồi chứ không dời số cố định)
 *   [FX-DB-19] khoản ĐẾN TRỄ có ngày thu sớm hơn khoản chủ; khoản chủ sau đó được HOÀN HẾT (vẫn thực thu, ròng 0) ⇒ số cố định KHÔNG dời sang khoản đến trễ
 *   [FX-DB-12] so bóng: dòng cố định theo chính sách campaign ĐỦ điều kiện ⇒ EXPECTED AFFILIATE_CAMPAIGN_POLICY (đúng MỘT dòng, đợt 2 không có gì để so); UNEXPECTED = 0 ⇒ cutover không chặn
 *
 * LUẬT 18: mỗi ca tự dựng hiện trường (mã duy nhất, kịch bản riêng). LUẬT 19: ngày TUYỆT ĐỐI — `Date.now()` chỉ làm hậu tố mã.
 * AN TOÀN DB: không `resetDb()`; sổ bất biến nên dọn bằng `donKichBan` (cắt bảng sổ) TRƯỚC khi xoá campaign/referral (FK Restrict).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "10.9.9.8" }) }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb } from "../e2e/_helpers/seed";
import { xuLyIntakeGioiThieu } from "../../lib/affiliate/intake-cong-khai";
import { sinhToken } from "../../lib/affiliate/token";
import { cacChanPrecheck } from "../../lib/hoa-hong/cutover-kiem-tra";
import { giaiHangCho } from "../../lib/hoa-hong/giai-hang-cho";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { chaySoBong } from "../../lib/hoa-hong/so-bong-db";
import { docViSaoDayDu } from "../../lib/hoa-hong/vi-sao-doc";
import { kichHoat, taoChinhSach, taoVanBan } from "../../lib/hoa-hong/chinh-sach-service";
import { baoDamNguoiPhuTrach, datTranHoaHong, donNguoiPhuTrach, lamSachChinhSach, NOW_CS, thuKichHoat, trangThaiPhienBan } from "./_nguon-dong";
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
  kiemCuaSoSach,
  nguoiKyHo,
  taoChinhSachFx,
  themChinhSachPhamVi,
  tienVe,
  tuChoi,
  type Be,
  type KichBan,
  type RuleFx,
} from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[FX-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "AFX";
const HOST = "afx-doi-tac.example.test";
const ORIGIN = `https://${HOST}`;
const NOW = D("2027-02-10");
const NOW_LINK = D("2026-10-05");
const ATTRIBUTED = new Date("2026-10-01T03:00:00.000Z"); // cửa sổ nguồn 90 ngày ⇒ mọi khoản thu của bộ này nằm TRONG cửa sổ

const cuaToi: KichBan[] = [];
let dem = 0;
const hau = () => `${Date.now().toString(36).toUpperCase()}${(dem += 1)}`;

async function don(): Promise<void> {
  const ds = await db.affiliate.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const ids = ds.map((x) => x.id);
  await db.commissionPolicyVersion.deleteMany({ where: { scopeCampaign: { code: { startsWith: P } } } });
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
  await db.affiliate.deleteMany({ where: { id: { in: ids }, parentPartyId: { not: null } } });
  await db.affiliate.deleteMany({ where: { id: { in: ids } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: P } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } });
}

type HienTruong = Awaited<ReturnType<typeof dungHienTruong>>;

/** Chuỗi link ĐẦY ĐỦ: nguồn → website → campaign → loại → đối tác (cá nhân HOẶC tổ chức) → thành viên → link. */
async function dungHienTruong(p: { toChuc?: boolean } = {}) {
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
  const doiTac = await db.affiliate.create({
    data: { code: `${P}_D${h}`, name: `${p.toChuc ? "Trường" : "Đối tác"} ${P} ${h}`, status: "ACTIVE", isActive: true, typeId: loai.id, partyKind: p.toChuc ? "ORGANIZATION" : "PERSON" },
  });
  const mem = await db.affiliateMembership.create({ data: { partyId: doiTac.id, campaignId: campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  const token = sinhToken();
  await db.affiliateTrackingAsset.create({
    data: { partyId: doiTac.id, membershipId: mem.id, campaignId: campaign.id, siteId: site.id, landingPath: "/khoa-robot", publicToken: token, type: "LINK", status: "ACTIVE" },
  });
  return { h, nhom, site, campaign, loai, doiTac, mem, token };
}

let ipSeq = 0;
let sdtSeq = 0;
const sdtMoi = () => `09${String(((Date.now() % 90_000_000) + 1_000_000 + (sdtSeq += 7)) % 100_000_000).padStart(8, "0")}`;
const bienThe = (s: string) => [s, `84${s.slice(1)}`];

async function leadTuLinkThat(k: KichBan, ht: HienTruong): Promise<KichBan> {
  const sdt = sdtMoi();
  ipSeq += 1;
  const r = await xuLyIntakeGioiThieu(
    {
      thanTho: JSON.stringify({ v: 1, token: ht.token, idempotencyKey: `afx-${hau().toLowerCase()}-${ipSeq}-xx`, parentName: `${P} PH ${k.ma}`, phone: sdt, children: [{ fullName: `${P} Bé` }], consentMarketing: true }),
      origin: ORIGIN,
      ip: `10.78.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`,
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

const SALE4: RuleFx = { vai: "SALE", rate: 0.04 };
const FIXED = (tien: number): RuleFx => ({ vai: "AFFILIATE", kieu: "FIXED_PER_PURCHASE", tien });

/**
 * Kịch bản: lead qua link thật + chính sách campaign `AFFILIATE FIXED tien` (ghi thẳng DB: vòng qua guardrail kích hoạt — guardrail có ca riêng ở [FX-DB-10]) + SALE 4% chung.
 * Một lần mua `tong` đồng, các đợt thu ở `dot` (ngày → số tiền), mỗi đợt gắn dòng đơn.
 */
async function dungLanMua(ten: string, p: { fixed: number; tong: number; toChuc?: boolean; gan?: boolean }) {
  const ht = await dungHienTruong({ toChuc: p.toChuc });
  const k0 = await dungKichBan(ten, { coLead: false, rules: [SALE4] });
  const cs = await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [FIXED(p.fixed)]);
  const k = await leadTuLinkThat(k0, ht);
  const bc = await boiCanh(k, NOW);
  const be = await dungBe(k, "a", { tongTien: p.tong });
  return { ht, k, k0, bc, be, cs };
}

const thu = (k: KichBan, be: Be, ngay: string, soTien: number, gan = true) => tienVe(k, be, { soTien, ngay: D(ngay), gan });
const dongCo = async (paymentId: string, vai: string) => (await dongSoCuaKhoan(paymentId)).filter((d) => d.roleCode === vai);
const tongVai = async (paymentId: string, vai: string) => (await dongCo(paymentId, vai)).reduce((s, d) => s + d.amount, 0);
const soDongCoDinh = (orderItemId: string) => db.commissionTransaction.count({ where: { orderItemId, calcKind: "FIXED_PER_PURCHASE", entryKind: { in: ["ORIGINAL", "LATE_ARRIVAL"] } } });
const holdsCua = (paymentId: string) => db.commissionHold.findMany({ where: { paymentId }, select: { code: true, status: true } });

describe.skipIf(!RUN_DB_TESTS)("[FX-DB] hoa hồng cố định FIXED_PER_PURCHASE — Postgres thật", () => {
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
    await donKichBan(cuaToi);
    await don();
    await datMocCutover(null);
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
  }, 180_000);

  it("[FX-DB-00] ĐỐI CHỨNG «ca cũ KHÔNG đổi»: chính sách chỉ có PERCENT, MỘT lần mua 3 đợt ⇒ tiền từng đợt Y HỆT số đo trên mã TRƯỚC AFF-L2b (240.026 · 280.063 · 279.912 trên bộ SEED_V1 4 vai)", async () => {
    // Các số này được ĐO trên `rc/aff-closeout` chưa sửa (kịch bản S1 của lượt đo trước/sau) rồi dán — không phải số tự tính từ công thức mới.
    const k = await dungKichBan("fx00", { rules: [{ vai: "SALE", rate: 0.04 }, { vai: "SALE_ADMIN", rate: 0.01 }, { vai: "CENTER_MANAGER", rate: 0.02 }, { vai: "MARKETING", rate: 0.01 }, { vai: "TRIAL_TEACHER", rate: 0.01 }] });
    cuaToi.push(k);
    const bc = await boiCanh(k, NOW);
    const be = await dungBe(k, "a", { tongTien: 10_000_000 });
    const tong: number[] = [];
    for (const [so, ngay] of [[3_000_333, "2026-10-10"], [3_500_777, "2026-10-25"], [3_498_890, "2026-11-05"]] as const) {
      const p = await thu(k, be, ngay, so);
      const r = await quetKhoan(db, bc, p);
      expect(r.loai).toBe("DA_GHI");
      tong.push((await dongSoCuaKhoan(p)).reduce((s, d) => s + d.amount, 0));
    }
    expect(tong).toEqual([240_026, 280_063, 279_912]);
  });

  it("[FX-DB-01] 3 đợt của MỘT lần mua: ĐÚNG MỘT dòng cố định ở đợt 1 (300.000); đợt 2-3 chỉ có phần trăm của Sale; mọi dòng mang calcKind/fixedAmount đúng", async () => {
    const { k, bc, be } = await dungLanMua("d01", { fixed: 300_000, tong: 30_000_000 });
    const p1 = await thu(k, be, "2026-10-12", 10_000_000);
    const p2 = await thu(k, be, "2026-10-13", 10_000_000);
    const p3 = await thu(k, be, "2026-10-14", 10_000_000);
    for (const p of [p1, p2, p3]) expect((await quetKhoan(db, bc, p)).loai, p).toBe("DA_GHI");

    const aff1 = await dongCo(p1, "AFFILIATE");
    expect(aff1, "ĐỐI CHỨNG DƯƠNG: đợt 1 PHẢI có dòng cố định").toHaveLength(1);
    expect(aff1[0]).toMatchObject({ amount: 300_000, calcKind: "FIXED_PER_PURCHASE", fixedAmount: 300_000, rate: null, netBase: 10_000_000, beneficiaryType: "PERSON", entryKind: "ORIGINAL" });
    expect(await dongCo(p2, "AFFILIATE")).toHaveLength(0);
    expect(await dongCo(p3, "AFFILIATE")).toHaveLength(0);
    // phần trăm của Sale KHÔNG bị ảnh hưởng: cả ba đợt đều 4%
    expect([await tongVai(p1, "SALE"), await tongVai(p2, "SALE"), await tongVai(p3, "SALE")]).toEqual([400_000, 400_000, 400_000]);
    expect(await soDongCoDinh(be.orderItemId)).toBe(1);
    // trần đã đo trên khoản ĐẦU: 4% + 300.000÷10.000.000 = 7%
    expect(Number(aff1[0]!.equivalentRate)).toBeCloseTo(0.07, 6);
  });

  it("[FX-DB-02] quét lại cả ba đợt ⇒ KHONG_DOI và KHÔNG đẻ dòng thừa (idempotent theo khoá sổ + băm đầu vào)", async () => {
    const { k, bc, be } = await dungLanMua("d02", { fixed: 300_000, tong: 30_000_000 });
    const ps = [await thu(k, be, "2026-10-12", 10_000_000), await thu(k, be, "2026-10-13", 10_000_000), await thu(k, be, "2026-10-14", 5_000_000)];
    for (const p of ps) await quetKhoan(db, bc, p);
    const truoc = await db.commissionTransaction.count({ where: { orderItemId: be.orderItemId } });
    for (const p of ps) expect((await quetKhoan(db, bc, p)).loai, p).toBe("KHONG_DOI");
    expect(await db.commissionTransaction.count({ where: { orderItemId: be.orderItemId } })).toBe(truoc);
    expect(await soDongCoDinh(be.orderItemId)).toBe(1);
    for (const p of ps) expect((await holdsCua(p)).filter((h) => h.status === "OPEN"), "không hàng chờ nào mở").toEqual([]);
  });

  it("[FX-DB-03] phiên bản chính sách MỚI đổi giá trị (300k → 500k) ⇒ dòng ĐÃ GHI không bị viết lại (quét lại KHONG_DOI, vẫn 300k); LẦN MUA MỚI sau ngày hiệu lực dùng 500k", async () => {
    const { k, k0, bc, be, ht, cs } = await dungLanMua("d03", { fixed: 300_000, tong: 20_000_000 });
    const p1 = await thu(k, be, "2026-10-12", 10_000_000);
    await quetKhoan(db, bc, p1);
    expect(await tongVai(p1, "AFFILIATE")).toBe(300_000);

    // V2: 500.000 từ 01/11/2026. Chính sách V1 bị ĐÓNG tại mốc ấy (biên mở) — khoản 12/10 vẫn thuộc V1.
    await taoChinhSachFx(k0.ma, [FIXED(500_000)], 2, cs.policyId, "2026-10-31T17:00:00.000Z", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, "-camp");
    const bc2 = await boiCanh(k, NOW);
    expect((await quetKhoan(db, bc2, p1)).loai).toBe("KHONG_DOI");
    expect(await dongCo(p1, "AFFILIATE")).toHaveLength(1);
    expect(await tongVai(p1, "AFFILIATE")).toBe(300_000);
    expect((await dongCo(p1, "AFFILIATE"))[0]!.versionNo).toBe(1);

    const be2 = await dungBe(k, "b", { tongTien: 10_000_000 });
    const q1 = await thu(k, be2, "2026-11-10", 10_000_000);
    await quetKhoan(db, bc2, q1);
    const moi = await dongCo(q1, "AFFILIATE");
    expect(moi).toHaveLength(1);
    expect(moi[0]).toMatchObject({ amount: 500_000, fixedAmount: 500_000, versionNo: 2 });
  });

  it("[FX-DB-04] hoàn 4tr/10tr của đợt 1 ⇒ REVERSAL cố định −120.000 (đúng TỈ LỆ hoàn của khoản đã sinh ra nó); quét lại đợt 1 KHÔNG trôi; hoàn đợt 2 KHÔNG đụng dòng cố định", async () => {
    const { k, bc, be } = await dungLanMua("d04", { fixed: 300_000, tong: 30_000_000 });
    const p1 = await thu(k, be, "2026-10-12", 10_000_000);
    const p2 = await thu(k, be, "2026-10-13", 10_000_000);
    await quetKhoan(db, bc, p1);
    await quetKhoan(db, bc, p2);

    const h1 = await hoanTien(k, p1, { soTien: 4_000_000, ngay: D("2026-11-05") });
    expect(await quetKhoan(db, bc, h1)).toMatchObject({ loai: "DA_DAO" });
    const dao = await dongSoCuaKhoan(h1);
    expect(dao.find((d) => d.roleCode === "AFFILIATE")).toMatchObject({ entryKind: "REVERSAL", amount: -120_000, calcKind: "FIXED_PER_PURCHASE" });
    expect(dao.find((d) => d.roleCode === "SALE")).toMatchObject({ entryKind: "REVERSAL", amount: -160_000 });
    expect((await quetKhoan(db, bc, p1)).loai, "quét lại sau hoàn một phần: KHÔNG INPUT_DRIFT giả cho dòng cố định").toBe("KHONG_DOI");
    expect((await quetKhoan(db, bc, p1)).loai).toBe("KHONG_DOI");

    // hoàn đợt 2 (đợt không sinh dòng cố định): chỉ thu hồi phần trăm của Sale
    const h2 = await hoanTien(k, p2, { soTien: 5_000_000, ngay: D("2026-11-06") });
    expect(await quetKhoan(db, bc, h2)).toMatchObject({ loai: "DA_DAO" });
    const dao2 = await dongSoCuaKhoan(h2);
    expect(dao2.filter((d) => d.roleCode === "AFFILIATE"), "đối chứng âm: hoàn đợt 2 không có dòng cố định để đảo").toHaveLength(0);
    expect(dao2.find((d) => d.roleCode === "SALE")).toMatchObject({ amount: -200_000 });
    // tổng ròng cố định sau cả hai lần hoàn: 300.000 − 120.000
    const rong = await db.commissionTransaction.aggregate({ where: { orderItemId: be.orderItemId, roleCode: "AFFILIATE" }, _sum: { amount: true } });
    expect(rong._sum.amount).toBe(180_000);
  });

  it("[FX-DB-05] hoàn 4tr/10tr rồi quét lại với FIXED 400.000 + SALE 4% (8% < 9%): trần đo trên cơ sở GỐC ⇒ KHÔNG lật sang VUOT_TRAN (đo trên cơ sở còn lại 6tr sẽ là 10,67% > 9%) và KHÔNG INPUT_DRIFT", async () => {
    const { k, bc, be } = await dungLanMua("d05", { fixed: 400_000, tong: 10_000_000 });
    const p1 = await thu(k, be, "2026-10-12", 10_000_000);
    expect((await quetKhoan(db, bc, p1)).loai).toBe("DA_GHI");
    expect(await tongVai(p1, "AFFILIATE")).toBe(400_000);
    const h = await hoanTien(k, p1, { soTien: 4_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, bc, h);
    expect((await dongSoCuaKhoan(h)).find((d) => d.roleCode === "AFFILIATE")!.amount).toBe(-160_000);
    expect((await quetKhoan(db, bc, p1)).loai).toBe("KHONG_DOI");
    const mo = (await holdsCua(p1)).filter((x) => x.status === "OPEN");
    expect(mo, JSON.stringify(mo)).toEqual([]);
  });

  it("[FX-DB-06] khoản ĐẦU quá nhỏ (cọc 2tr ⇒ 300.000÷2.000.000 = 15% + Sale 4% > trần 9%) ⇒ VUOT_TRAN: 0 dòng cho CẢ khoản (kể cả Sale) + hàng chờ CAP_EXCEEDED; đợt sau KHÔNG nhận số cố định (không né trần bằng cách chia nhỏ khoản đầu)", async () => {
    const { k, bc, be } = await dungLanMua("d06", { fixed: 300_000, tong: 30_000_000 });
    const coc = await thu(k, be, "2026-10-12", 2_000_000);
    const p2 = await thu(k, be, "2026-10-13", 28_000_000);
    expect((await quetKhoan(db, bc, coc)).loai).toBe("GIU");
    expect(await dongSoCuaKhoan(coc)).toHaveLength(0);
    expect((await holdsCua(coc)).map((h) => h.code)).toEqual(["CAP_EXCEEDED"]);
    expect((await quetKhoan(db, bc, p2)).loai).toBe("DA_GHI");
    expect(await dongCo(p2, "AFFILIATE"), "số cố định KHÔNG dời sang khoản sau").toHaveLength(0);
    expect(await tongVai(p2, "SALE"), "ĐỐI CHỨNG DƯƠNG: phần trăm của Sale ở đợt 2 vẫn ra tiền").toBe(1_120_000);
    expect(await soDongCoDinh(be.orderItemId)).toBe(0);
  });

  it("[FX-DB-07] người hưởng là TỔ CHỨC ⇒ dòng cố định ORGANIZATION + ON_HOLD (không vào bảng chi); đợt 2 không thêm dòng; Sale vẫn PENDING", async () => {
    const { k, bc, be, ht } = await dungLanMua("d07", { fixed: 300_000, tong: 20_000_000, toChuc: true });
    const p1 = await thu(k, be, "2026-10-12", 10_000_000);
    const p2 = await thu(k, be, "2026-10-13", 10_000_000);
    await quetKhoan(db, bc, p1);
    await quetKhoan(db, bc, p2);
    const aff = await dongCo(p1, "AFFILIATE");
    expect(aff).toHaveLength(1);
    expect(aff[0]).toMatchObject({ amount: 300_000, calcKind: "FIXED_PER_PURCHASE", beneficiaryAffiliateId: ht.doiTac.id, beneficiaryType: "ORGANIZATION", payoutStatus: "ON_HOLD" });
    expect(await dongCo(p2, "AFFILIATE")).toHaveLength(0);
    expect((await dongCo(p1, "SALE"))[0]).toMatchObject({ beneficiaryType: "PERSON", payoutStatus: "PENDING" });
  });

  it("[FX-DB-08] khoản đến TRỄ: A (20/10) đã ghi cố định; B (12/10, SỚM HƠN) đến sau ⇒ B KHÔNG nhận cố định (sổ đã có chủ), A quét lại KHONG_DOI (không trôi dù nay A không còn là khoản sớm nhất)", async () => {
    const { k, bc, be } = await dungLanMua("d08", { fixed: 300_000, tong: 20_000_000 });
    const a = await thu(k, be, "2026-10-20", 10_000_000);
    expect((await quetKhoan(db, bc, a)).loai).toBe("DA_GHI");
    expect(await tongVai(a, "AFFILIATE")).toBe(300_000);

    const b = await thu(k, be, "2026-10-12", 10_000_000); // ngày thu sớm hơn A, nhưng được ghi sau
    expect((await quetKhoan(db, bc, b)).loai).toBe("DA_GHI");
    expect(await dongCo(b, "AFFILIATE"), "đã có chủ trong sổ ⇒ không trả lần hai").toHaveLength(0);
    expect(await soDongCoDinh(be.orderItemId)).toBe(1);
    expect((await quetKhoan(db, bc, a)).loai, "chủ không trôi").toBe("KHONG_DOI");
    expect((await holdsCua(a)).filter((h) => h.status === "OPEN")).toEqual([]);
  });

  it("[FX-DB-09] khoản KHÔNG gắn dòng đơn (orderItemId = NULL, chỉ gắn ghi danh) đứng TRƯỚC khoản gắn dòng: quét khoản gắn dòng TRƯỚC (chưa có chủ trong sổ) ⇒ vẫn không nhận cố định vì `phanBoKhoan` quy khoản trước về CÙNG dòng; khoản không gắn dòng mới là khoản đầu", async () => {
    const { k, bc, be } = await dungLanMua("d09", { fixed: 300_000, tong: 20_000_000 });
    const p1 = await thu(k, be, "2026-10-12", 10_000_000, false);
    const p2 = await thu(k, be, "2026-10-13", 10_000_000, true);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p1 }, select: { orderItemId: true } })).orderItemId, "TIỀN ĐỀ của ca: đợt 1 phải KHÔNG gắn dòng").toBeNull();
    // thứ tự quét NGƯỢC cố ý: lớp sổ cái chưa có chủ, nên chỉ có phép THỨ TỰ mới ngăn đợt 2 nhận lần đầu (lớp sổ cái che mất lỗi nếu quét đợt 1 trước)
    await quetKhoan(db, bc, p2);
    expect(await dongCo(p2, "AFFILIATE")).toHaveLength(0);
    await quetKhoan(db, bc, p1);
    expect(await tongVai(p1, "AFFILIATE")).toBe(300_000);
    expect(await dongCo(p2, "AFFILIATE")).toHaveLength(0);
    expect(await soDongCoDinh(be.orderItemId)).toBe(1);
  });

  it("[FX-DB-13] «khoản đầu» KHÔNG phụ thuộc thứ tự quét: quét đợt 3, rồi 2, rồi 1 ⇒ số cố định vẫn rơi ĐÚNG vào đợt 1 (tập khoản trước là của lần mua, không của khoản đang hỏi)", async () => {
    const { k, bc, be } = await dungLanMua("d13", { fixed: 300_000, tong: 30_000_000 });
    const p1 = await thu(k, be, "2026-10-12", 10_000_000);
    const p2 = await thu(k, be, "2026-10-13", 10_000_000);
    const p3 = await thu(k, be, "2026-10-14", 10_000_000);
    for (const p of [p3, p2, p1]) await quetKhoan(db, bc, p);
    expect(await dongCo(p3, "AFFILIATE")).toHaveLength(0);
    expect(await dongCo(p2, "AFFILIATE")).toHaveLength(0);
    expect(await tongVai(p1, "AFFILIATE")).toBe(300_000);
    expect(await soDongCoDinh(be.orderItemId)).toBe(1);
    for (const p of [p1, p2, p3]) expect((await quetKhoan(db, bc, p)).loai, "quét lại không trôi").toBe("KHONG_DOI");
  });

  it("[FX-DB-14] HAI khoản CÙNG ngày thu: khoản có id nhỏ hơn là khoản đầu (cùng thứ tự `(paidDate, id)` với «còn nợ trước khoản»), kể cả khi khoản id lớn được quét trước", async () => {
    const { k, bc, be } = await dungLanMua("d14", { fixed: 300_000, tong: 20_000_000 });
    const a = await thu(k, be, "2026-10-12", 10_000_000);
    const b = await thu(k, be, "2026-10-12", 10_000_000);
    const [dau, sau] = [a, b].sort();
    await quetKhoan(db, bc, sau!);
    expect(await dongCo(sau!, "AFFILIATE"), "khoản id lớn KHÔNG phải khoản đầu").toHaveLength(0);
    await quetKhoan(db, bc, dau!);
    expect(await tongVai(dau!, "AFFILIATE")).toBe(300_000);
    expect(await soDongCoDinh(be.orderItemId)).toBe(1);
  });

  it("[FX-DB-20] KHÔNG HỒI TỐ (R5 13/10/2026): chính sách có hiệu lực SAU thời điểm mua (khoản thu đầu của lần mua) ⇒ lần mua ấy KHÔNG nhận số cố định, kể cả khoản thu sau đã nằm trong hiệu lực; đối chứng dương: lần mua BẮT ĐẦU sau hiệu lực nhận đúng một lần", async () => {
    const ht = await dungHienTruong();
    const k0 = await dungKichBan("d20", { coLead: false, rules: [SALE4] });
    // chính sách FIXED chỉ có hiệu lực từ 01/11/2026 (biên: 31/10 17:00Z = 00:00 ngày 01/11 giờ VN)
    const r = await taoChinhSachFx(k0.ma, [FIXED(300_000)], 1, undefined, "2026-10-31T17:00:00.000Z", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, "-camp");
    k0.chinhSachThem.push(r.policyCode);
    const k = await leadTuLinkThat(k0, ht);
    const bc = await boiCanh(k, NOW);

    // Lần mua A: khoản thu ĐẦU 12/10 (trước hiệu lực), khoản thu sau 10/11 (trong hiệu lực)
    const beA = await dungBe(k, "a", { tongTien: 20_000_000 });
    const a1 = await thu(k, beA, "2026-10-12", 10_000_000);
    const a2 = await thu(k, beA, "2026-11-10", 10_000_000);
    await quetKhoan(db, bc, a1);
    await quetKhoan(db, bc, a2);
    expect(await dongCo(a1, "AFFILIATE")).toHaveLength(0);
    expect(await dongCo(a2, "AFFILIATE")).toHaveLength(0); // KHÔNG hồi tố sang khoản thu sau
    expect(await tongVai(a2, "SALE")).toBeGreaterThan(0); // đối chứng: quét có chạy, vai khác vẫn được tính

    // Lần mua B: bắt đầu SAU hiệu lực ⇒ nhận đúng một dòng cố định ở khoản đầu
    const beB = await dungBe(k, "b", { tongTien: 20_000_000 });
    const b1 = await thu(k, beB, "2026-11-12", 10_000_000);
    const b2 = await thu(k, beB, "2026-11-20", 10_000_000);
    await quetKhoan(db, bc, b1);
    await quetKhoan(db, bc, b2);
    expect(await tongVai(b1, "AFFILIATE")).toBe(300_000);
    expect(await dongCo(b2, "AFFILIATE")).toHaveLength(0);
  });

  it("[FX-DB-10] guardrail kích hoạt THẬT: FIXED ở phạm vi rộng (GLOBAL) ⇒ FIXED_PHAM_VI_RONG (KHÔNG phải KIEU_TINH_CHUA_HO_TRO), bản nháp vẫn DRAFT; FIXED ở CAMPAIGN vượt trần ⇒ VUOT_TRAN (FIXED tham gia kiểm trần); FIXED ở CAMPAIGN đúng trần ⇒ QUA, nhưng đòi xác nhận cảnh báo «trần đo ở khoản thu đầu»", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(P);
    await datTranHoaHong(null); // trần mặc định 9%
    const ht = await dungHienTruong();
    const k = await dungKichBan("d10", { coLead: false }); // GLOBAL seed v1 = 9% đúng trần
    cuaToi.push(k);
    const nguoi = { userId: null, ten: "fx-afx" };
    const now = new Date("2026-10-08T03:00:00.000Z");
    const vb = await taoVanBan({
      documentCode: `${k.ma}-vb-d10`, title: "Quy định (fixture AFX)", kind: "COMMISSION_POLICY", issuedOn: "2026-02-20", publishedOn: "2026-03-02", effectiveOn: "2026-03-23",
      approvedByName: "Hồ Đắc Phúc", approvedById: null, fileKey: "documents/fx-afx.pdf", fileName: "fx-afx.pdf", fileUrl: "https://example.test/fx-afx.pdf", ownerOrgUnitId: null, actor: nguoi, now,
    });
    const fixedRule = (roleCode: string, tien: number) => ({ transactionTypeCode: "NEW", roleCode, revenueComponent: "TUITION" as const, calcKind: "FIXED_PER_PURCHASE" as const, rate: null, fixedAmount: tien, tierTable: null, note: null });
    const tao = async (hauTo: string, phamVi: Parameters<typeof taoChinhSach>[0]["phamVi"], rules: Parameters<typeof taoChinhSach>[0]["rules"]) => {
      const policyCode = `${k.ma}-pol-d10-${hauTo}`;
      const cs = await taoChinhSach({
        policyCode, name: `Cố định ${hauTo}`, description: null, ownerOrgUnitId: null, phamVi,
        effectiveFrom: new Date("2026-03-22T17:00:00.000Z"), effectiveTo: null, reason: "SR.QD.fixture afx", documentId: vb.id, rules, actor: nguoi, now,
      });
      k.chinhSachThem.push(policyCode);
      return cs.versionId;
    };

    // 1 — phạm vi RỘNG: chặn bằng mã PHẠM VI
    const rong = await tao("rong", { loai: "GLOBAL" }, [fixedRule("SALE", 100_000)]);
    const loiRong = await thuKichHoat(rong);
    expect(loiRong).toContain("FIXED_PHAM_VI_RONG");
    expect(loiRong).not.toContain("KIEU_TINH_CHUA_HO_TRO");
    expect(await trangThaiPhienBan(rong)).toBe("DRAFT");

    // 2 — CAMPAIGN nhưng Σ vượt trần: SALE cố định 500.000 ÷ 10tr chuẩn = 5% thay SALE 4% ⇒ Σ 10% > 9%
    const vuot = await tao("vuot", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [fixedRule("SALE", 500_000)]);
    const loiVuot = await thuKichHoat(vuot);
    expect(loiVuot).toContain("VUOT_TRAN");
    expect(loiVuot).not.toContain("FIXED_PHAM_VI_RONG");
    expect(loiVuot).not.toContain("KIEU_TINH_CHUA_HO_TRO");

    // 3 — CAMPAIGN, SALE cố định 400.000 = 4% trên khoản chuẩn (Σ 9% đúng trần): QUA — nhưng phải xác nhận cảnh báo trần theo khoản đầu
    const qua = await tao("qua", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [fixedRule("SALE", 400_000)]);
    const chuaXacNhan = await kichHoat({ versionId: qua, actor: nguoi, now: NOW_CS, xacNhanCanhBao: null }).catch((e: unknown) => e as { ma?: string; chiTiet?: { thongBao: string }[] });
    expect(JSON.stringify(chuaXacNhan), "cảnh báo trần theo khoản thu ĐẦU phải đứng giữa người kích hoạt và nút").toContain("khoản thu ĐẦU");
    expect(await trangThaiPhienBan(qua)).toBe("DRAFT");
    expect(await thuKichHoat(qua)).toEqual([]);
    expect(await trangThaiPhienBan(qua)).toBe("ACTIVE");

    await lamSachChinhSach();
    await donNguoiPhuTrach(P);
  });

  it("[FX-DB-11] «Vì sao con số này» của dòng cố định nêu: số cố định · MỘT lần ở khoản thu đầu tiên · tỉ lệ hiệu dụng so với cơ sở khoản đầu · kiểm trần", async () => {
    const { k, bc, be } = await dungLanMua("d11", { fixed: 300_000, tong: 20_000_000 });
    const p1 = await thu(k, be, "2026-10-12", 10_000_000);
    await quetKhoan(db, bc, p1);
    const dong = (await dongCo(p1, "AFFILIATE"))[0]!;
    const ho = await nguoiKyHo();
    const vs = (await docViSaoDayDu(ho.quyen, dong.id))!;
    const toanVan = JSON.stringify(vs.muc);
    expect(toanVan).toContain("Số tiền cố định 300.000đ cho lần mua này");
    expect(toanVan, "câu của bước Công thức (vi-sao.ts), không phải câu của mục «Tỉ lệ»").toContain("Trả MỘT lần cho mỗi lần mua, tại khoản thu đầu tiên đủ điều kiện");
    expect(toanVan).toContain("Tỉ lệ hiệu dụng 3%");
    expect(toanVan).toContain("10.000.000đ");
  });
  /** Hiện trường «khoản đầu bị TỪ CHỐI»: p1 đã ghi cố định → kế toán từ chối → quét ngược dựng hàng chờ PAYMENT_WITHDRAWN (không tự đảo — 01 §6.2). p2 CHƯA quét. */
  async function khoanDauBiTuChoi(ten: string) {
    const h = await dungLanMua(ten, { fixed: 300_000, tong: 20_000_000 });
    const p1 = await thu(h.k, h.be, "2026-10-12", 10_000_000);
    const p2 = await thu(h.k, h.be, "2026-10-13", 10_000_000);
    await quetKhoan(db, h.bc, p1);
    expect(await tongVai(p1, "AFFILIATE"), "TIỀN ĐỀ: khoản đầu đã ghi cố định").toBe(300_000);
    await tuChoi(h.k, p1);
    expect((await quetKhoan(db, h.bc, p1)).loai).toBe("RUT_TIEN");
    const hold = await db.commissionHold.findFirstOrThrow({ where: { paymentId: p1, code: "PAYMENT_WITHDRAWN" } });
    return { ...h, p1, p2, hold };
  }
  const rongCoDinh = async (orderItemId: string) =>
    (await db.commissionTransaction.aggregate({ where: { orderItemId, calcKind: "FIXED_PER_PURCHASE" }, _sum: { amount: true } }))._sum.amount ?? 0;

  it("[FX-DB-15] khoản đầu bị TỪ CHỐI: đang CHỜ quyết (PAYMENT_WITHDRAWN) ⇒ khoản thu khác KHÔNG nhận cố định (tiền còn nằm ở khoản đầu, không trả hai); người duyệt ĐẢO sạch ⇒ khoản kế (chưa quét) NHẬN 300.000 — tổng ròng đúng 300.000, không mất", async () => {
    const { k, bc, be, p2, hold } = await khoanDauBiTuChoi("d15");
    const p3 = await thu(k, be, "2026-10-14", 5_000_000);
    expect((await quetKhoan(db, bc, p3)).loai).toBe("DA_GHI");
    expect(await dongCo(p3, "AFFILIATE"), "đang chờ quyết: chủ vẫn là khoản đầu").toHaveLength(0);
    expect(await rongCoDinh(be.orderItemId)).toBe(300_000);

    const ho = await nguoiKyHo();
    await giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "Kế toán từ chối thật, thu hồi hoa hồng", nguoi: ho });
    expect(await rongCoDinh(be.orderItemId), "đã đảo sạch khoản bị từ chối").toBe(0);

    // p2 chưa từng quét; khoản bị từ chối đã đảo sạch nên KHÔNG còn là chủ ⇒ p2 là khoản đầu THỰC THU ⇒ nhận, ghi trực tiếp
    expect((await quetKhoan(db, bc, p2)).loai).toBe("DA_GHI");
    expect(await tongVai(p2, "AFFILIATE")).toBe(300_000);
    expect(await rongCoDinh(be.orderItemId), "tổng ròng cả lần mua").toBe(300_000);
    expect((await quetKhoan(db, bc, p3)).loai, "p3 đứng SAU p2 nên vẫn không phải khoản đầu").toBe("KHONG_DOI");
  });

  it("[FX-DB-16] khoản kế đã quét TRƯỚC khi đảo: sau khi đảo, quét lại ⇒ INPUT_DRIFT (+300.000, hàng chờ MỞ — không im lặng); 'Áp dụng' ⇒ tổng ròng cố định đúng 300.000 (mất 0, trả hai 0)", async () => {
    const { bc, be, p1, p2, hold } = await khoanDauBiTuChoi("d16");
    await quetKhoan(db, bc, p2);
    expect(await dongCo(p2, "AFFILIATE"), "đang chờ quyết: chưa nhận").toHaveLength(0);
    const ho = await nguoiKyHo();
    await giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "Kế toán từ chối thật, thu hồi hoa hồng", nguoi: ho });
    expect(await rongCoDinh(be.orderItemId)).toBe(0);

    const lai = await quetKhoan(db, bc, p2);
    expect(lai.loai).toBe("TROI");
    const drift = await db.commissionHold.findFirstOrThrow({ where: { paymentId: p2, code: "INPUT_DRIFT", status: "OPEN" } });
    await giaiHangCho(db, bc, { holdId: drift.id, quyetDinh: "AP_DUNG", lyDo: "Khoản đầu đã bị từ chối — số cố định chuyển sang khoản kế", nguoi: ho });
    expect(await tongVai(p2, "AFFILIATE")).toBe(300_000);
    expect(await rongCoDinh(be.orderItemId), "tổng ròng cả lần mua").toBe(300_000);
    expect(await dongCo(p1, "AFFILIATE")).toHaveLength(2); // ORIGINAL + INPUT_CORRECTION đảo — lịch sử còn nguyên
  });

  it("[FX-DB-17] khoản đầu bị từ chối mà người duyệt chọn «GIỮ NGUYÊN» ⇒ tiền cố định vẫn nằm ở khoản đầu; khoản kế KHÔNG nhận lần hai (đối chứng của FX-DB-15: ở đó đã đảo)", async () => {
    const { bc, be, p2, hold } = await khoanDauBiTuChoi("d17");
    const ho = await nguoiKyHo();
    await giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "GIU_NGUYEN", lyDo: "Từ chối nhầm, tiền thật đã về — giữ hoa hồng", nguoi: ho });
    expect(await rongCoDinh(be.orderItemId), "giữ nguyên ⇒ không đảo").toBe(300_000);
    expect((await quetKhoan(db, bc, p2)).loai).toBe("DA_GHI");
    expect(await dongCo(p2, "AFFILIATE")).toHaveLength(0);
    expect(await rongCoDinh(be.orderItemId)).toBe(300_000);
  });

  it("[FX-DB-18] khoản đầu được HOÀN HẾT: khoản ấy vẫn là thực thu, REVERSAL cố định −300.000 (ròng 0) ⇒ khoản kế quét sau KHÔNG nhận lại (hoàn tiền là thu hồi, không dời số cố định sang khoản kế); đối chứng với FX-DB-15 (khoản bị TỪ CHỐI thì dời)", async () => {
    const { k, bc, be } = await dungLanMua("d18", { fixed: 300_000, tong: 20_000_000 });
    const p1 = await thu(k, be, "2026-10-12", 10_000_000);
    const p2 = await thu(k, be, "2026-10-13", 10_000_000);
    await quetKhoan(db, bc, p1);
    const h = await hoanTien(k, p1, { soTien: 10_000_000, ngay: D("2026-11-05") });
    expect((await quetKhoan(db, bc, h)).loai).toBe("DA_DAO");
    expect(await rongCoDinh(be.orderItemId), "hoàn hết ⇒ ròng cố định 0").toBe(0);
    expect((await quetKhoan(db, bc, p2)).loai).toBe("DA_GHI");
    expect(await dongCo(p2, "AFFILIATE"), "khoản đầu còn là thực thu ⇒ vẫn là chủ").toHaveLength(0);
    expect(await rongCoDinh(be.orderItemId)).toBe(0);
  });

  it("[FX-DB-19] khoản chủ (20/10) đã ghi cố định; khoản có ngày thu SỚM hơn (12/10) đến trễ ⇒ không nhận; rồi khoản chủ được HOÀN HẾT (vẫn là thực thu, ròng 0) ⇒ quét lại khoản đến trễ vẫn KHONG_DOI: hoàn tiền thu hồi, không dời số cố định", async () => {
    const { k, bc, be } = await dungLanMua("d19", { fixed: 300_000, tong: 20_000_000 });
    const chu = await thu(k, be, "2026-10-20", 10_000_000);
    await quetKhoan(db, bc, chu);
    const treSom = await thu(k, be, "2026-10-12", 10_000_000);
    expect((await quetKhoan(db, bc, treSom)).loai).toBe("DA_GHI");
    expect(await dongCo(treSom, "AFFILIATE")).toHaveLength(0);
    const h = await hoanTien(k, chu, { soTien: 10_000_000, ngay: D("2026-11-05") });
    expect((await quetKhoan(db, bc, h)).loai).toBe("DA_DAO");
    expect(await rongCoDinh(be.orderItemId)).toBe(0);
    expect((await quetKhoan(db, bc, treSom)).loai).toBe("KHONG_DOI");
    expect(await dongCo(treSom, "AFFILIATE")).toHaveLength(0);
  });

  it("[FX-DB-12] so bóng: lần mua 2 đợt (5tr + 5tr) có dòng cố định theo chính sách campaign ⇒ ĐÚNG MỘT dòng AFFILIATE «EXPECTED AFFILIATE_CAMPAIGN_POLICY» (cũ 0 · mới 50.000); mọi vai khác trùng từng đồng; UNEXPECTED = 0 ⇒ cutover không chặn", async () => {
    await donKichBan(cuaToi.splice(0)); // so bóng đo TOÀN DB — dọn hiện trường của các ca trước (luật 18)
    const ht = await dungHienTruong();
    const k0 = await dungKichBan("d12", { coLead: false, rules: [SALE4, { vai: "SALE_ADMIN", rate: 0.01 }, { vai: "CENTER_MANAGER", rate: 0.02 }, { vai: "MARKETING", rate: 0.01 }] });
    await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [FIXED(50_000)]); // 50.000 ÷ 5tr = 1% ⇒ Σ 9% đúng trần
    const k = await leadTuLinkThat(k0, ht);
    await db.leadAttribution.update({ where: { leadId: k.lead!.id }, data: { attributedAt: new Date("2027-05-01T03:00:00.000Z") } });
    await db.affiliateReferral.updateMany({ where: { leadId: k.lead!.id }, data: { protectedUntil: new Date("2027-08-01T03:00:00.000Z") } });
    const be = await dungBe(k, "a", { tongTien: 10_000_000, ngayDon: D("2027-05-01") });
    await thu(k, be, "2027-05-12", 5_000_000);
    await thu(k, be, "2027-05-13", 5_000_000);
    await kiemCuaSoSach([k], "2027-05-01", "2027-05-31");
    const b = await chaySoBong({ client: db, now: D("2027-06-10"), kyP: "2027-06", tuNgay: "2027-05-01", denNgay: "2027-05-31", tranSoKhoan: 500 });
    const aff = b.dong.filter((d) => d.roleCode === "AFFILIATE");
    expect(aff, "ĐỐI CHỨNG DƯƠNG: dòng cố định phải có trong báo cáo, và chỉ MỘT (đợt 2 không trả)").toHaveLength(1);
    expect(aff[0]).toMatchObject({ loai: "EXPECTED_BUSINESS_DELTA", ma: "AFFILIATE_CAMPAIGN_POLICY", cu: 0, moi: 50_000 });
    expect(b.unexpected.soDong, JSON.stringify(b.dong.filter((d) => d.loai === "UNEXPECTED"))).toBe(0);
    expect(cacChanPrecheck({ invalidAttribution: 0, holdNghiemTrongDuKien: 0, unexpectedDelta: b.unexpected.soDong, diTruChuaSanSang: false })).toEqual([]);
  });
});
