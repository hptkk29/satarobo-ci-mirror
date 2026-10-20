// @vitest-environment node
/**
 * [L2-DB-*] — ENGINE CLOSEOUT của Affiliate trên Postgres THẬT (AFF-L2): cửa sổ bảo vệ của campaign · người hưởng TỔ CHỨC · ảnh chụp bất biến · so bóng.
 *
 * Lead đi qua ĐƯỜNG THẬT của P1 (`xuLyIntakeGioiThieu` → token → referral → quy nguồn), thanh toán bằng hàm thật, quét bằng engine thật. Cái mà test thuần không chứng minh:
 * rule thắng đúng, dòng sổ mang đúng loại người hưởng / trạng thái chi, trigger sổ bất biến cho ON_HOLD → PENDING nhưng không cho lùi, khoá kỳ KHÔNG đẩy dòng giữ vào bảng chi.
 *
 *   D-A  [L2-DB-A1] khoản NGOÀI cửa sổ nguồn nhưng referral còn được campaign bảo vệ ⇒ VẪN ghi dòng AFFILIATE; SALE không đổi; basis nói cửa sổ nào đã áp
 *        [L2-DB-A2] ĐỐI CHỨNG: chính sách yêu cầu cửa sổ nguồn (`dungCuaSoNguon`) ⇒ không dòng
 *        [L2-DB-A3] ĐỐI CHỨNG: quá hạn bảo vệ của referral ⇒ không dòng
 *        [L2-DB-A4] ĐỐI CHỨNG: rule thắng KHÔNG phải rule CAMPAIGN ⇒ không dòng
 *        [L2-DB-A5] campaign ENDED / sửa cửa sổ / thành viên kết thúc SAU ngày thu ⇒ KHONG_DOI (đo ở ngày sự kiện, không ở hôm nay); dòng sổ giữ ảnh chụp cũ
 *        [L2-DB-A6] «Vì sao con số này» nêu cửa sổ đã áp
 *   D-B  [L2-DB-B1] đối tác TỔ CHỨC: dòng mang loại ORGANIZATION + id/tên của CHÍNH tổ chức, KHÔNG sinh dòng cho người đại diện, trạng thái chi ON_HOLD; cá nhân/Sale vẫn PENDING
 *        [L2-DB-B2] hoàn tiền ⇒ REVERSAL của tổ chức cũng ON_HOLD (không thu hồi PENDING rồi xuất chi)
 *        [L2-DB-B3] khoá kỳ ⇒ dòng tổ chức VẪN ON_HOLD; xuất bảng chi KHÔNG chứa nó; màn Kỳ nói riêng số tiền đang giữ; kỳ sang PAID khi mọi dòng CHI ĐƯỢC đã chi
 *        [L2-DB-B4] trigger sổ: ON_HOLD → PENDING được (mở khoá là TIẾN); PENDING → ON_HOLD bị chặn
 *   D-C  [L2-DB-C1] dòng sổ chụp partyId + cấu hình campaign lúc tính; publish V2 của chính sách KHÔNG viết lại sổ của V1; REVERSAL chép nguyên snapshot cũ
 *   D-D  [L2-DB-D1] so bóng: dòng theo chính sách campaign ĐỦ điều kiện ⇒ EXPECTED AFFILIATE_CAMPAIGN_POLICY, UNEXPECTED = 0 ⇒ cutover không chặn
 *        [L2-DB-D2] ĐỐI CHỨNG: đổi nguồn của khách (nguồn không còn khớp referral) ⇒ UNEXPECTED ⇒ cutover chặn
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng hiện trường (mã duy nhất, kịch bản riêng). LUẬT 19: ngày TUYỆT ĐỐI — `Date.now()` chỉ làm hậu tố mã.
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
import { docManHinhKy } from "../../lib/hoa-hong/ky-doc";
import { chuyenRaSoat, khoaKyHoaHong, tinhKy } from "../../lib/hoa-hong/ky-service";
import { docQuyTac, taoChinhSach, taoPhienBanMoi, taoVanBan } from "../../lib/hoa-hong/chinh-sach-service";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { chaySoBong } from "../../lib/hoa-hong/so-bong-db";
import { docViSaoDayDu } from "../../lib/hoa-hong/vi-sao-doc";
import { danhDauDaChi, xuatBangChi } from "../../lib/hoa-hong/xuat-ky";
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
  lamNhanVien,
  nguoiKyHo,
  taoChinhSachFx,
  themChinhSachPhamVi,
  tienVe,
  type KichBan,
  type RuleFx,
} from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[L2-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "AEC";
const HOST = "aec-doi-tac.example.test";
const ORIGIN = `https://${HOST}`;
const NOW = D("2027-02-10");
const NOW_LINK = D("2026-10-05"); // ⇒ protectedUntil = 2027-01-03T03:00Z (campaign bảo vệ 90 ngày)
const ATTRIBUTED = new Date("2026-10-01T03:00:00.000Z"); // cửa sổ nguồn 90 ngày ⇒ hết 2026-12-30
const TRONG_CUA_SO = D("2026-10-12");
/** 93 ngày sau ngày quy nguồn: NGOÀI cửa sổ nguồn, nhưng TRONG hạn bảo vệ của campaign. */
const NGOAI_CUA_SO_NGUON_CON_BAO_VE = D("2027-01-02");

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
  // người đại diện (con) trước tổ chức (cha) — FK Restrict
  await db.affiliate.deleteMany({ where: { id: { in: ids }, parentPartyId: { not: null } } });
  await db.affiliate.deleteMany({ where: { id: { in: ids } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: P } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } });
}

type HienTruong = Awaited<ReturnType<typeof dungHienTruong>>;

/** Chuỗi link ĐẦY ĐỦ: nguồn → website → campaign → loại → đối tác (cá nhân HOẶC tổ chức + người đại diện) → thành viên → link. */
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
  const daiDien = p.toChuc
    ? await db.affiliate.create({ data: { code: `${P}_R${h}`, name: `Người đại diện ${P} ${h}`, status: "ACTIVE", isActive: true, typeId: loai.id, parentPartyId: doiTac.id } })
    : null;
  const mem = await db.affiliateMembership.create({ data: { partyId: doiTac.id, campaignId: campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  const token = sinhToken();
  await db.affiliateTrackingAsset.create({
    data: { partyId: doiTac.id, membershipId: mem.id, campaignId: campaign.id, siteId: site.id, landingPath: "/khoa-robot", publicToken: token, type: "LINK", status: "ACTIVE" },
  });
  return { h, nhom, site, campaign, loai, doiTac, daiDien, mem, token };
}

let ipSeq = 0;
let sdtSeq = 0;
const sdtMoi = () => `09${String(((Date.now() % 90_000_000) + 1_000_000 + (sdtSeq += 7)) % 100_000_000).padStart(8, "0")}`;
const bienThe = (s: string) => [s, `84${s.slice(1)}`];

/** LEAD qua ĐƯỜNG THẬT của P1. Chỉ GHIM thứ KHÔNG thuộc đối tượng đo: người chốt/cơ sở của lead và `attributedAt` sang ngày tuyệt đối. */
async function leadTuLinkThat(k: KichBan, ht: HienTruong): Promise<KichBan> {
  const sdt = sdtMoi();
  ipSeq += 1;
  const r = await xuLyIntakeGioiThieu(
    {
      thanTho: JSON.stringify({ v: 1, token: ht.token, idempotencyKey: `aec-${hau().toLowerCase()}-${ipSeq}-xx`, parentName: `${P} PH ${k.ma}`, phone: sdt, children: [{ fullName: `${P} Bé` }], consentMarketing: true }),
      origin: ORIGIN,
      ip: `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`,
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
const kb = (tien: string, rules: RuleFx[] = [SALE4]) => dungKichBan(tien, { coLead: false, rules });

/** MỘT khoản NEW 10.000.000đ đã xác nhận ở `ngay` → quét bằng engine thật. */
async function thuVaQuet(k: KichBan, ten: string, ngay: Date, soTien = 10_000_000) {
  const bc = await boiCanh(k, NOW);
  const be = await dungBe(k, ten, { tongTien: soTien });
  const khoan = await tienVe(k, be, { soTien, ngay });
  const kq = await quetKhoan(db, bc, khoan);
  return { bc, be, khoan, kq, dong: await dongSoCuaKhoan(khoan) };
}

const dongCua = (dong: Awaited<ReturnType<typeof dongSoCuaKhoan>>, vai: string) => dong.find((d) => d.roleCode === vai);
type Basis = { affiliate?: { partyId?: string; campaign?: Record<string, unknown>; cuaSo?: { ap: string; lyDo: string; baoVeDen: string | null; ngoaiCuaSoNguon: boolean } | null } };
const basis = (d: { resolverBasis: unknown } | undefined) => (d?.resolverBasis ?? {}) as Basis;
const kyCua = (k: KichBan, thang: string) => db.commissionPeriod.findFirstOrThrow({ where: { period: thang, centerId: k.centerId } });

describe.skipIf(!RUN_DB_TESTS)("[L2-DB] engine closeout Affiliate — Postgres thật", () => {
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

  // ═══ D-A ═══════════════════════════════════════════════════════════════════════════════════════════════

  it("[L2-DB-A1] khoản NGOÀI cửa sổ nguồn, referral CÒN được campaign bảo vệ, rule CAMPAIGN thắng ⇒ VẪN ghi AFFILIATE 300.000; SALE 400.000 giữ nguyên; basis nói «bảo vệ của campaign»", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("a1");
    await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    const k = await leadTuLinkThat(k0, ht);
    const referral = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: k.lead!.id, status: "VALID" } });
    expect(referral.protectedUntil?.toISOString()).toBe("2027-01-03T03:00:00.000Z"); // đối chứng nền: bảo vệ tới sau ngày thu

    const { kq, dong } = await thuVaQuet(k, "a", NGOAI_CUA_SO_NGUON_CON_BAO_VE);
    expect(kq.loai).toBe("DA_GHI");
    const aff = dongCua(dong, "AFFILIATE");
    expect(aff, "ĐỐI CHỨNG DƯƠNG: dòng AFFILIATE phải TỒN TẠI dù ngoài cửa sổ nguồn").toBeDefined();
    expect(aff).toMatchObject({ amount: 300_000, beneficiaryKind: "AFFILIATE", beneficiaryAffiliateId: ht.doiTac.id, beneficiaryType: "PERSON", payoutStatus: "PENDING" });
    expect(dongCua(dong, "SALE")).toMatchObject({ amount: 400_000, beneficiaryUserId: k.sale.id, beneficiaryType: "PERSON" });
    expect(basis(aff).affiliate?.cuaSo).toMatchObject({ ap: "BAO_VE_CAMPAIGN", lyDo: "MIEN_CUA_SO_NGUON", ngoaiCuaSoNguon: true, baoVeDen: "2027-01-03T03:00:00.000Z" });
    // vai KHÔNG thu hút không chịu cửa sổ ghi công ⇒ không có phép đo nào để nói
    expect(basis(dongCua(dong, "SALE")).affiliate?.cuaSo).toBeNull();
  });

  it("[L2-DB-A2] ĐỐI CHỨNG: chính sách YÊU CẦU tường minh dùng cửa sổ nguồn (`dungCuaSoNguon`) ⇒ KHÔNG dòng AFFILIATE; SALE vẫn 400.000", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("a2");
    await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03, dungCuaSoNguon: true }]);
    const k = await leadTuLinkThat(k0, ht);
    const { dong } = await thuVaQuet(k, "a", NGOAI_CUA_SO_NGUON_CON_BAO_VE);
    expect(dongCua(dong, "AFFILIATE")).toBeUndefined();
    expect(dongCua(dong, "SALE")?.amount).toBe(400_000);
  });

  it("[L2-DB-A3] ĐỐI CHỨNG: ngày thu QUÁ hạn bảo vệ của referral ⇒ KHÔNG dòng AFFILIATE (cửa sổ nguồn vẫn là luật)", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("a3");
    await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    const k = await leadTuLinkThat(k0, ht);
    await db.affiliateReferral.updateMany({ where: { leadId: k.lead!.id }, data: { protectedUntil: D("2027-01-01") } }); // hết hạn TRƯỚC ngày thu 2027-01-02
    const { dong } = await thuVaQuet(k, "a", NGOAI_CUA_SO_NGUON_CON_BAO_VE);
    expect(dongCua(dong, "AFFILIATE")).toBeUndefined();
    expect(dongCua(dong, "SALE")?.amount).toBe(400_000);
  });

  it("[L2-DB-A4] ĐỐI CHỨNG: rule thắng của AFFILIATE là GLOBAL (không phải rule CAMPAIGN) ⇒ KHÔNG dòng dù campaign bảo vệ; có rule CAMPAIGN thì có (cùng khách, cùng ngày)", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("a4", [SALE4, { vai: "AFFILIATE", rate: 0.01 }]);
    const k = await leadTuLinkThat(k0, ht);
    const truoc = await thuVaQuet(k, "a", NGOAI_CUA_SO_NGUON_CON_BAO_VE);
    expect(dongCua(truoc.dong, "AFFILIATE")).toBeUndefined(); // GLOBAL 1% không phải chính sách của campaign
    await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    // k0.chinhSachThem là mảng dùng chung với `k` (spread nông) ⇒ khoản MỚI thấy chính sách mới
    const sau = await thuVaQuet(k, "b", NGOAI_CUA_SO_NGUON_CON_BAO_VE);
    expect(dongCua(sau.dong, "AFFILIATE")?.amount).toBe(300_000);
  });

  it("[L2-DB-A5] campaign ENDED + sửa cửa sổ bảo vệ + thành viên kết thúc SAU ngày thu ⇒ quét lại KHONG_DOI (đo ở NGÀY SỰ KIỆN, không ở hôm nay); dòng sổ giữ ảnh chụp CŨ", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("a5");
    await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    const k = await leadTuLinkThat(k0, ht);
    const { bc, khoan, dong } = await thuVaQuet(k, "a", NGOAI_CUA_SO_NGUON_CON_BAO_VE);
    const goc = dongCua(dong, "AFFILIATE")!;
    expect(goc.amount).toBe(300_000);

    const hamO = () => db.commissionCalcSlot.findFirstOrThrow({ where: { paymentId: khoan }, select: { firstInputHash: true, lastMatchedHash: true } });
    const oTruoc = await hamO();
    await db.affiliateCampaign.update({ where: { id: ht.campaign.id }, data: { status: "ENDED", protectWindowDays: 365 } });
    await db.affiliateMembership.update({ where: { id: ht.mem.id }, data: { effectiveTo: D("2027-03-01"), status: "ENDED" } });
    const lai = await quetKhoan(db, bc, khoan);
    expect(lai.loai, JSON.stringify(lai)).toBe("KHONG_DOI");
    // `KHONG_DOI` một mình KHÔNG chứng minh băm đứng yên (băm đổi mà tiền không đổi cũng ra KHONG_DOI — AFP-E2E-09): đo thẳng băm của ô. Cấu hình campaign KHÔNG được vào băm.
    expect(await hamO()).toEqual(oTruoc);
    const sau = await dongSoCuaKhoan(khoan);
    expect(sau).toHaveLength(dong.length); // không đẻ dòng điều chỉnh nào
    expect(basis(dongCua(sau, "AFFILIATE")).affiliate?.campaign).toMatchObject({ protectWindowDays: 90, status: "ACTIVE" }); // ảnh chụp LÚC TÍNH, không phải cấu hình hôm nay
  });

  it("[L2-DB-A6] «Vì sao con số này» của dòng AFFILIATE nêu cửa sổ đã áp: bảo vệ của campaign (ngoài cửa sổ nguồn) vs của nguồn (trong cửa sổ)", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("a6");
    await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    const k = await leadTuLinkThat(k0, ht);
    const ho = await nguoiKyHo();
    const ngoai = await thuVaQuet(k, "a", NGOAI_CUA_SO_NGUON_CON_BAO_VE);
    const trong = await thuVaQuet(k, "b", TRONG_CUA_SO);
    const muc = async (id: string) => (await docViSaoDayDu(ho.quyen, id))!.muc.find((m) => m.nhan === "Cửa sổ ghi công");

    const a = await muc(dongCua(ngoai.dong, "AFFILIATE")!.id);
    expect(a?.giaTri).toBe("Bảo vệ của campaign đến 03/01/2027 (90 ngày)");
    expect(a?.ghiChu).toContain("KHÔNG vô hiệu khoản này lần hai");
    const b = await muc(dongCua(trong.dong, "AFFILIATE")!.id);
    expect(b?.giaTri).toBe("Của nguồn (90 ngày)");
    expect(b?.ghiChu).toContain("trong cửa sổ ghi công của nguồn");
  });

  it("[L2-DB-A7] cờ `dungCuaSoNguon` đi qua DỊCH VỤ chính sách thật: soạn mới ghi cột · nạp thành QuyTac · `taoPhienBanMoi` (chép rule) mang theo; rule không khai cờ thì không có cờ", async () => {
    const ht = await dungHienTruong();
    const k = await kb("a7");
    cuaToi.push(k);
    const nguoi = { userId: null, ten: "fx-aec" };
    const now = new Date("2026-10-08T03:00:00.000Z");
    const vb = await taoVanBan({
      documentCode: `${k.ma}-vb-a7`, title: "Quy định (fixture AEC)", kind: "COMMISSION_POLICY", issuedOn: "2026-02-20", publishedOn: "2026-03-02", effectiveOn: "2026-03-23",
      approvedByName: "Hồ Đắc Phúc", approvedById: null, fileKey: "documents/fx-aec.pdf", fileName: "fx-aec.pdf", fileUrl: "https://example.test/fx-aec.pdf", ownerOrgUnitId: null, actor: nguoi, now,
    });
    const ruleIn = (roleCode: string, rate: number, p: { dungCuaSoNguon?: boolean } = {}) => ({
      transactionTypeCode: "NEW", roleCode, revenueComponent: "TUITION" as const, calcKind: "PERCENT" as const, rate, fixedAmount: null, tierTable: null, note: null, ...p,
    });
    const cs = await taoChinhSach({
      policyCode: `${k.ma}-pol-a7`, name: "Chính sách cờ cửa sổ nguồn", description: null, ownerOrgUnitId: null, phamVi: { loai: "CAMPAIGN", campaignId: ht.campaign.id },
      effectiveFrom: new Date("2026-03-22T17:00:00.000Z"), effectiveTo: null, reason: "SR.QD.fixture aec", documentId: vb.id,
      rules: [ruleIn("AFFILIATE", 0.03, { dungCuaSoNguon: true }), ruleIn("SALE", 0.02)], actor: nguoi, now,
    });
    k.chinhSachThem.push(`${k.ma}-pol-a7`);
    await db.commissionPolicyVersion.update({ where: { id: cs.versionId }, data: { status: "ACTIVE", activatedAt: D("2026-10-08") } });
    const cot = async (versionId: string) => Object.fromEntries((await db.commissionRule.findMany({ where: { versionId }, select: { beneficiaryRole: { select: { code: true } }, dungCuaSoNguon: true } })).map((r) => [r.beneficiaryRole.code, r.dungCuaSoNguon]));
    expect(await cot(cs.versionId)).toEqual({ AFFILIATE: true, SALE: false }); // ghi cột đúng từng rule
    const q = (await docQuyTac(db)).filter((x) => x.versionId === cs.versionId);
    expect(q.find((x) => x.roleCode === "AFFILIATE")!.dungCuaSoNguon).toBe(true); // nạp thành QuyTac
    expect(q.find((x) => x.roleCode === "SALE")!.dungCuaSoNguon).toBeUndefined(); // không khai ⇒ không có (hình dạng cũ)
    // V2 chép rule từ V1 (`rules: null`): cờ phải đi theo — mất cờ ở đây là chính sách «dùng cửa sổ nguồn» im lặng đổi nghĩa ở lần sửa kế tiếp
    const v2 = await taoPhienBanMoi({ policyId: cs.policyId, phamVi: null, effectiveFrom: new Date("2026-11-01T00:00:00.000Z"), effectiveTo: null, reason: "chép V1", documentId: vb.id, rules: null, actor: nguoi, now });
    expect(await cot(v2.versionId)).toEqual({ AFFILIATE: true, SALE: false });
  });

  // ═══ D-B ═══════════════════════════════════════════════════════════════════════════════════════════════

  it("[L2-DB-B1] đối tác TỔ CHỨC: dòng mang ORGANIZATION + id/tên của CHÍNH tổ chức, ON_HOLD; KHÔNG dòng nào cho người đại diện; Sale (cá nhân) PENDING; đối chứng: đối tác cá nhân PENDING", async () => {
    const htOrg = await dungHienTruong({ toChuc: true });
    const k0 = await kb("b1");
    await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: htOrg.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    const k = await leadTuLinkThat(k0, htOrg);
    const { dong } = await thuVaQuet(k, "a", TRONG_CUA_SO);
    const org = dongCua(dong, "AFFILIATE")!;
    expect(org).toMatchObject({
      amount: 300_000,
      beneficiaryKind: "AFFILIATE",
      beneficiaryAffiliateId: htOrg.doiTac.id,
      beneficiaryName: htOrg.doiTac.name,
      beneficiaryType: "ORGANIZATION",
      payoutStatus: "ON_HOLD",
    });
    expect(basis(org).affiliate?.partyId).toBe(htOrg.doiTac.id);
    expect(await db.commissionTransaction.count({ where: { beneficiaryAffiliateId: htOrg.daiDien!.id } })).toBe(0); // KHÔNG chuyển sang người đại diện
    expect(dongCua(dong, "SALE")).toMatchObject({ beneficiaryType: "PERSON", payoutStatus: "PENDING" });
    const visao = await docViSaoDayDu((await nguoiKyHo()).quyen, org.id);
    const nh = visao!.muc.find((m) => m.nhan === "Người hưởng")!;
    expect(nh.giaTri).toContain("(tổ chức)");
    expect(nh.ghiChu).toContain("không chuyển sang người đại diện");
    expect(visao!.muc.find((m) => m.nhan === "Chi trả")?.giaTri).toContain("Đang giữ");

    // đối chứng dương: cùng cấu hình nhưng đối tác CÁ NHÂN ⇒ PERSON · PENDING
    const htCn = await dungHienTruong();
    const k1 = await kb("b1c");
    await themChinhSachPhamVi(k1, "camp", { loai: "CAMPAIGN", campaignId: htCn.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    const kc = await leadTuLinkThat(k1, htCn);
    const cn = dongCua((await thuVaQuet(kc, "a", TRONG_CUA_SO)).dong, "AFFILIATE")!;
    expect(cn).toMatchObject({ beneficiaryType: "PERSON", payoutStatus: "PENDING", beneficiaryAffiliateId: htCn.doiTac.id });
  });

  it("[L2-DB-B2] hoàn tiền ⇒ REVERSAL của dòng tổ chức cũng ON_HOLD + chép loại ORGANIZATION; REVERSAL của Sale vẫn PENDING", async () => {
    const ht = await dungHienTruong({ toChuc: true });
    const k0 = await kb("b2");
    await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    const k = await leadTuLinkThat(k0, ht);
    const { bc, khoan } = await thuVaQuet(k, "a", TRONG_CUA_SO);
    const hoan = await hoanTien(k, khoan, { soTien: 4_000_000, ngay: D("2026-11-05") });
    expect((await quetKhoan(db, bc, hoan)).loai).toBe("DA_DAO");
    const dao = await dongSoCuaKhoan(hoan);
    expect(dao.every((d) => d.entryKind === "REVERSAL")).toBe(true);
    expect(dongCua(dao, "AFFILIATE")).toMatchObject({ amount: -120_000, beneficiaryType: "ORGANIZATION", payoutStatus: "ON_HOLD" });
    expect(dongCua(dao, "SALE")).toMatchObject({ amount: -160_000, beneficiaryType: "PERSON", payoutStatus: "PENDING" });
  });

  it("[L2-DB-B3] khoá kỳ ⇒ dòng tổ chức VẪN ON_HOLD (không APPROVED); bảng chi KHÔNG chứa nó; màn Kỳ nói riêng tiền đang giữ; kỳ sang PAID khi mọi dòng CHI ĐƯỢC đã chi", async () => {
    const ht = await dungHienTruong({ toChuc: true });
    const k0 = await kb("b3");
    await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    await lamNhanVien(k0.sale.id, "sale");
    const k = await leadTuLinkThat(k0, ht);
    const ho = await nguoiKyHo();
    const { bc, khoan } = await thuVaQuet(k, "a", TRONG_CUA_SO);

    const ky = await kyCua(k, "2026-10");
    await tinhKy(db, bc, { periodId: ky.id, soThangDoiSoat: 0, actor: ho });
    await chuyenRaSoat(db, { periodId: ky.id, actor: ho, now: NOW });
    await khoaKyHoaHong(db, { periodId: ky.id, actor: ho, now: NOW, lyDo: "khoá kỳ 10 để chi hoa hồng" });
    const sau = await dongSoCuaKhoan(khoan);
    expect(dongCua(sau, "AFFILIATE")!.payoutStatus, "khoá kỳ chỉ đẩy PENDING → APPROVED, KHÔNG đụng ON_HOLD").toBe("ON_HOLD");
    expect(dongCua(sau, "SALE")!.payoutStatus).toBe("APPROVED");

    const man = await docManHinhKy(ho.quyen, { thang: "2026-10", centerId: k.centerId, kyCutover: "2026-10" });
    expect(man.giuToChuc).toEqual({ soDong: 1, tien: 300_000 });
    expect(man.chuaXuat).toEqual({ noiBo: 1, ngoai: 0 }); // tiền tổ chức KHÔNG nằm trong «chưa xuất»

    const pay = await xuatBangChi(db, { thang: "2026-10", kind: "PAYROLL", actor: ho, now: NOW, lyDo: "xuất bảng lương tháng 10" });
    expect(pay).toMatchObject({ soDong: 1, tongChi: 400_000 });
    // không còn dòng nào CHI ĐƯỢC cho quyết toán người ngoài: dòng ON_HOLD của tổ chức không phải «dòng chưa vào lô»
    await expect(xuatBangChi(db, { thang: "2026-10", kind: "EXTERNAL_SETTLEMENT", actor: ho, now: NOW, lyDo: "quyết toán người ngoài" })).rejects.toMatchObject({ ma: "KHONG_CO_DONG_DE_XUAT" });
    expect(await danhDauDaChi(db, { batchId: pay.batchId, actor: ho, now: NOW, lyDo: "đã chuyển khoản bảng lương" })).toEqual({ soDong: 1, soKyPaid: 1 });
    expect((await kyCua(k, "2026-10")).status).toBe("PAID");
    expect(dongCua(await dongSoCuaKhoan(khoan), "AFFILIATE")!.payoutStatus).toBe("ON_HOLD"); // vẫn giữ: chi chưa được
  });

  it("[L2-DB-B4] trigger sổ: ON_HOLD → PENDING được (mở khoá là TIẾN); PENDING → ON_HOLD bị chặn; dòng cá nhân PENDING → ON_HOLD cũng bị chặn", async () => {
    const ht = await dungHienTruong({ toChuc: true });
    const k0 = await kb("b4");
    await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    const k = await leadTuLinkThat(k0, ht);
    const { dong } = await thuVaQuet(k, "a", TRONG_CUA_SO);
    const org = dongCua(dong, "AFFILIATE")!;
    const sale = dongCua(dong, "SALE")!;
    expect(org.payoutStatus).toBe("ON_HOLD");
    await db.commissionTransaction.update({ where: { id: org.id }, data: { payoutStatus: "PENDING" } }); // đủ hồ sơ ⇒ mở khoá
    await expect(db.commissionTransaction.update({ where: { id: org.id }, data: { payoutStatus: "ON_HOLD" } })).rejects.toThrow(/chỉ tiến/);
    await expect(db.commissionTransaction.update({ where: { id: sale.id }, data: { payoutStatus: "ON_HOLD" } })).rejects.toThrow(/chỉ tiến/);
    // sổ vẫn bất biến ở mọi cột khác
    await expect(db.commissionTransaction.update({ where: { id: org.id }, data: { beneficiaryType: "PERSON" } })).rejects.toThrow(/bất biến/);
  });

  // ═══ D-C ═══════════════════════════════════════════════════════════════════════════════════════════════

  it("[L2-DB-C1] sổ chụp partyId + cấu hình campaign LÚC TÍNH; publish V2 KHÔNG viết lại sổ V1 (quét lại KHONG_DOI), khoản mới dùng V2; REVERSAL chép nguyên snapshot cũ dù campaign đã sửa", async () => {
    const ht = await dungHienTruong();
    const k0 = await kb("c1");
    const cp = await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.03 }]);
    const k = await leadTuLinkThat(k0, ht);
    const v1 = await thuVaQuet(k, "a", TRONG_CUA_SO);
    const aff1 = dongCua(v1.dong, "AFFILIATE")!;
    expect(aff1).toMatchObject({ amount: 300_000, versionNo: 1, policyVersionId: cp.versionId });
    expect(basis(aff1).affiliate?.partyId).toBe(ht.doiTac.id);
    expect(basis(aff1).affiliate?.campaign).toMatchObject({ status: "ACTIVE", attributionModel: "FIRST_VALID", cookieWindowDays: 30, protectWindowDays: 90, defaultSourceGroupId: ht.nhom.id });
    expect(typeof (basis(aff1).affiliate?.campaign as { updatedAt: unknown }).updatedAt).toBe("string");

    // publish V2: 5% hiệu lực từ 21/10/2026 (đóng V1 tại mốc đó) — tổng SALE 4% + AFFILIATE 5% = 9% ≤ trần
    const v2 = await taoChinhSachFx(k0.ma, [{ vai: "AFFILIATE", rate: 0.05 }], 2, cp.policyId, "2026-10-20T17:00:00.000Z", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, "-camp");
    // admin sửa campaign SAU khi V1 đã ghi sổ
    await db.affiliateCampaign.update({ where: { id: ht.campaign.id }, data: { protectWindowDays: 180 } });

    const hamO = () => db.commissionCalcSlot.findFirstOrThrow({ where: { paymentId: v1.khoan }, select: { firstInputHash: true, lastMatchedHash: true } });
    const oTruoc = await hamO();
    const lai = await quetKhoan(db, v1.bc, v1.khoan);
    expect(lai.loai, JSON.stringify(lai)).toBe("KHONG_DOI"); // V2 hiệu lực SAU ngày thu ⇒ khoản cũ vẫn theo V1
    expect(await hamO()).toEqual(oTruoc); // và băm của ô đứng yên: publish V2 + sửa campaign không làm mọi ô cũ thành «đổi đầu vào»
    const sau1 = dongCua(await dongSoCuaKhoan(v1.khoan), "AFFILIATE")!;
    expect(sau1).toMatchObject({ amount: 300_000, versionNo: 1, policyVersionId: cp.versionId });
    expect(basis(sau1).affiliate?.campaign).toMatchObject({ protectWindowDays: 90 });

    const v2Khoan = await thuVaQuet(k, "b", D("2026-10-25"));
    expect(dongCua(v2Khoan.dong, "AFFILIATE")).toMatchObject({ amount: 500_000, versionNo: 2, policyVersionId: v2.versionId });
    expect(basis(dongCua(v2Khoan.dong, "AFFILIATE")).affiliate?.campaign).toMatchObject({ protectWindowDays: 180 }); // khoản MỚI chụp cấu hình HIỆN TẠI

    // hoàn một phần khoản V1 ⇒ REVERSAL chép V1 + snapshot cũ (không tra lại chính sách V2 / campaign đã sửa)
    const hoan = await hoanTien(k, v1.khoan, { soTien: 4_000_000, ngay: D("2026-11-05") });
    expect((await quetKhoan(db, v1.bc, hoan)).loai).toBe("DA_DAO");
    const dao = dongCua(await dongSoCuaKhoan(hoan), "AFFILIATE")!;
    expect(dao).toMatchObject({ entryKind: "REVERSAL", amount: -120_000, versionNo: 1, policyVersionId: cp.versionId, affiliateCampaignId: ht.campaign.id, beneficiaryType: "PERSON" });
    expect(basis(dao).affiliate?.campaign).toMatchObject({ protectWindowDays: 90 });
    expect(basis(dao).affiliate?.partyId).toBe(ht.doiTac.id);
  });

  // ═══ D-D ═══════════════════════════════════════════════════════════════════════════════════════════════

  /**
   * Hiện trường so bóng: ĐỦ vai để engine cũ và mới trùng từng đồng (SALE 4 · SALE_ADMIN 1 · QLCS 2 · MARKETING 1 = 8%) + AFFILIATE theo CAMPAIGN 1% = 9% ≤ trần.
   * Ngày thu 12/05/2027 ở một THÁNG riêng (so bóng cộng MỌI khoản thu của cả DB trong cửa sổ — `kiemCuaSoSach` ném nếu spec khác để lại khoản). Hai núm GHIM (`attributedAt`, `protectedUntil`) dời
   * sang quanh ngày thu để khoản nằm TRONG cửa sổ nguồn — thứ đang đo ở đây là phân loại chênh, không phải cửa sổ.
   */
  async function hienTruongSoBong(tien: string) {
    // So bóng đo TOÀN DB: chính sách ACTIVE của các ca TRƯỚC trong tệp này (mỗi ca một bộ GLOBAL) chồng lấn với bộ của ca này ⇒ CHONG_LAN, và khoản thu của chúng lọt vào cửa sổ (luật 18). Dọn trước khi dựng.
    await donKichBan(cuaToi.splice(0));
    const ht = await dungHienTruong();
    const k0 = await kb(tien, [SALE4, { vai: "SALE_ADMIN", rate: 0.01 }, { vai: "CENTER_MANAGER", rate: 0.02 }, { vai: "MARKETING", rate: 0.01 }]);
    await themChinhSachPhamVi(k0, "camp", { loai: "CAMPAIGN", campaignId: ht.campaign.id }, [{ vai: "AFFILIATE", rate: 0.01 }]);
    const k = await leadTuLinkThat(k0, ht);
    await db.leadAttribution.update({ where: { leadId: k.lead!.id }, data: { attributedAt: new Date("2027-05-01T03:00:00.000Z") } });
    await db.affiliateReferral.updateMany({ where: { leadId: k.lead!.id }, data: { protectedUntil: new Date("2027-08-01T03:00:00.000Z") } });
    const be = await dungBe(k, "a", { tongTien: 10_000_000, ngayDon: D("2027-05-01") });
    await tienVe(k, be, { soTien: 10_000_000, ngay: D("2027-05-12") });
    return { ht, k };
  }
  const soBong = (k: KichBan) =>
    kiemCuaSoSach([k], "2027-05-01", "2027-05-31").then(() => chaySoBong({ client: db, now: D("2027-06-10"), kyP: "2027-06", tuNgay: "2027-05-01", denNgay: "2027-05-31", tranSoKhoan: 500 }));
  const bangChung = (unexpectedDelta: number) => ({ invalidAttribution: 0, holdNghiemTrongDuKien: 0, unexpectedDelta, diTruChuaSanSang: false });

  it("[L2-DB-D1] so bóng: dòng AFFILIATE theo chính sách campaign ĐỦ điều kiện ⇒ EXPECTED AFFILIATE_CAMPAIGN_POLICY; UNEXPECTED = 0 ⇒ cutover không chặn", async () => {
    const { k } = await hienTruongSoBong("d1");
    const b = await soBong(k);
    const aff = b.dong.filter((d) => d.roleCode === "AFFILIATE");
    expect(aff, "ĐỐI CHỨNG DƯƠNG: dòng AFFILIATE phải có trong báo cáo").toHaveLength(1);
    expect(aff[0]).toMatchObject({ loai: "EXPECTED_BUSINESS_DELTA", ma: "AFFILIATE_CAMPAIGN_POLICY", cu: 0, moi: 100_000 });
    expect(b.unexpected.soDong, JSON.stringify(b.dong.filter((d) => d.loai === "UNEXPECTED"))).toBe(0);
    expect(cacChanPrecheck(bangChung(b.unexpected.soDong))).toEqual([]);
  });

  it("[L2-DB-D2] ĐỐI CHỨNG: nguồn của khách bị đổi sang nhóm khác (không còn khớp nguồn referral đã giải) ⇒ dòng AFFILIATE UNEXPECTED ⇒ cutover CHẶN", async () => {
    const { k } = await hienTruongSoBong("d2");
    const khac = await db.leadSourceGroup.create({
      data: { code: `${P}_X${hau()}`, name: `Nguồn khác ${P}`, sourceType: "PARTNER", referrerRequirement: "NONE", sortOrder: 901, status: "ACTIVE", selectable: true, commissionEnabled: true },
    });
    await db.leadAttribution.update({ where: { leadId: k.lead!.id }, data: { groupId: khac.id } });
    const b = await soBong(k);
    const aff = b.dong.find((d) => d.roleCode === "AFFILIATE");
    expect(aff, JSON.stringify(b.dong)).toMatchObject({ loai: "UNEXPECTED", ma: "DONG_MOI_NGOAI_DANH_SACH" });
    expect(cacChanPrecheck(bangChung(b.unexpected.soDong)).map((c) => c.ma)).toEqual(["CO_CHENH_BAT_NGO"]);
  });

  // ═══ D-F — ĐÃ CHUYỂN SANG tests/hoa-hong/affiliate-fixed.spec.ts (AFF-L2b) ═══════════════════════════════
  // Ca `[L2-DB-F1]` từng ĐO hành vi «trả theo từng khoản thu + trần đo trên cơ sở của đợt» để chứng minh vì sao D-F DỪNG. Q14 đã chốt (một lần mỗi lần mua, ở khoản đầu) nên ca ghim ấy bị thay bằng bộ `[FX-DB-*]`.
});
