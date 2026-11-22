// @vitest-environment node
/**
 * [AFL1-DB-*] — CHÍNH SÁCH HOA HỒNG CỦA CAMPAIGN AFFILIATE: soạn bằng UI (đường `luuNhap`) → xem trước → kích hoạt có cổng → engine THẬT quét ra đúng dòng, trên Postgres THẬT (AFF-L1).
 *
 *   [AFL1-DB-01] ĐẦU-CUỐI: campaign nháp bị chặn (liệt kê đủ) → chọn «có thưởng» → lưu NHÁP chính sách campaign qua đường của form (KHÔNG tự kích hoạt) → xem trước (hàng rào + thử tính) →
 *                kích hoạt chính sách → cổng campaign mở → kích hoạt campaign → tiền THẬT 3% (không phải 1% của mức chung); PAUSED không đổi tiền; chính sách hết hạn ⇒ khoản sau về mức chung,
 *                campaign ACTIVE không tự tụt, nhưng chạy lại sau tạm dừng bị chặn
 *   [AFL1-DB-02] `AffiliateCampaignRule.policyId` lệch (SQL tay) ⇒ chặn kích hoạt campaign; sửa về null / trỏ đúng ⇒ qua
 *   [AFL1-DB-03] liệt kê MỌI blocker một lượt (chưa chọn thưởng · thiếu nguồn · thiếu website) và blocker nói đúng nguồn ngừng
 *   [AFL1-DB-04] trần: chính sách campaign đẩy Σ vượt 9% ⇒ VUOT_TRAN kèm đường tới Cấu hình vận hành; KHÔNG tự nâng trần; bản nháp vẫn DRAFT
 *   [AFL1-DB-05] «không có mức riêng» × chính sách: chặn CẢ HAI chiều (đặt NONE khi có chính sách đang áp · kích hoạt chính sách khi đang NONE) và đua hai bên không bao giờ cùng thắng
 *   [AFL1-DB-05b] hàng rào xem trước VÀ kích hoạt nói ĐỦ MỌI lỗi một lượt (đang «không có mức riêng» + vượt trần) — chứng minh lớp kiểm TRƯỚC khi ghi tồn tại và hoạt động
 *   [AFL1-DB-05c] lớp kiểm DƯỚI KHOÁ (tất định, không dựa may rủi): người khác giữ khoá campaign và đặt «không có mức riêng» CHƯA commit ⇒ kích hoạt chính sách chờ rồi từ chối
 *   [AFL1-DB-06] bộ lọc Sổ / Kỳ lấy campaign từ MASTER (campaign có thật + 0 dòng sổ vẫn có mặt; mã lạ thì không); người không có quyền xem campaign giữ danh sách suy từ sổ
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng hiện trường. LUẬT 19: ngày TUYỆT ĐỐI. AN TOÀN DB: không `resetDb()`; mã mang tiền tố `AFL1`; sổ bất biến nên dọn bằng `donKichBan`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "10.9.9.8" }) }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { docCampaignMaster } from "../../lib/affiliate/doc-loc-campaign";
import { docChiTietCampaign } from "../../lib/affiliate/doc-campaign";
import { datCheDoThuong, doiTrangThaiCampaign, ganWebsite, taoCampaign, themQuyTac } from "../../lib/affiliate/ghi-campaign";
import { xuLyIntakeGioiThieu } from "../../lib/affiliate/intake-cong-khai";
import { sinhToken } from "../../lib/affiliate/token";
import { luuNhap, kichHoatPhienBan, kiemHangRao } from "../../lib/hoa-hong/chinh-sach-hanh-dong";
import { docDuLieuSoan } from "../../lib/hoa-hong/chinh-sach-doc";
import { formChoCampaign, formRong, type FormChinhSach } from "../../lib/hoa-hong/chinh-sach-form";
import { choHetHieuLuc, taoChinhSach, taoPhienBanMoi, taoVanBan, kichHoat as kichHoatDichVu } from "../../lib/hoa-hong/chinh-sach-service";
import { docLuaChonBoLocSo } from "../../lib/hoa-hong/doc-so-giao-dien";
import { docCampaignCoTrongKy } from "../../lib/hoa-hong/ky-doc";
import { HoaHongError } from "../../lib/hoa-hong/kieu";
import { thuTinhPhienBan } from "../../lib/hoa-hong/mo-phong-hanh-dong";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { getSetting, clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { actorCua, boiCanh, D, datMocCutover, donKichBan, dongSoCuaKhoan, dungBe, dungKichBan, nguoiKyHo, tienVe, type KichBan } from "./_kich-ban";
import { baoDamNguoiPhuTrach, datTranHoaHong, donNguoiPhuTrach, lamSachChinhSach, rule } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[AFL1] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "AFL1";
const NHAN = "fx-afl1";
const HOST = "afl1-doi-tac.example.test";
const ORIGIN = `https://${HOST}`;
const NOW = D("2026-11-20"); // đồng hồ của bối cảnh quét
const NOW_G = D("2026-10-13"); // đồng hồ của hàm ghi campaign (chính sách đang áp)
const NOW_CS = new Date("2026-10-08T03:00:00.000Z"); // đồng hồ dịch vụ chính sách (văn bản công bố 02/03/2026 ⇒ hiệu lực sớm nhất 23/03/2026 VN)
const ATTRIBUTED = new Date("2026-10-01T03:00:00.000Z");
const NGUOI = { userId: "fx-afl1-user", ten: "Quản trị fixture AFL1" };
const LY_DO = "Lý do đủ dài để qua cổng";

const cuaToi: KichBan[] = [];
let dem = 0;
const hau = () => `${Date.now().toString(36).toUpperCase()}${(dem += 1)}`;

async function don(): Promise<void> {
  const camp = await db.affiliateCampaign.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const cid = camp.map((c) => c.id);
  const ds = await db.affiliate.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const ids = ds.map((x) => x.id);
  // Restrict ⇒ phiên bản chính sách TRƯỚC campaign; văn bản của chúng đi theo.
  const pv = await db.commissionPolicyVersion.findMany({ where: { scopeCampaignId: { in: cid } }, select: { id: true, policyId: true, documentId: true } });
  await db.commissionPolicyVersion.deleteMany({ where: { id: { in: pv.map((v) => v.id) } } });
  await db.commissionPolicy.deleteMany({ where: { id: { in: pv.map((v) => v.policyId) }, versions: { none: {} } } });
  await db.regulationDocument.deleteMany({ where: { documentCode: { startsWith: P } } }).catch(() => undefined);
  // Lead đến từ link thật mang `LeadAttribution.referrerAffiliateId` (FK Restrict): xoá attribution/touchpoint của MỌI lead trỏ vào đối tác của bộ này — kể cả tàn dư của lượt chạy trước bị ngắt giữa
  // chừng (trước đây một tàn dư như vậy làm `don()` ném ở `afterAll`, mà `donNguoiPhuTrach` đứng SAU nó nên không chạy ⇒ cơ sở mang người phụ trách giả làm đỏ chinh-sach.spec POL-09).
  const leadCuaDoiTac = (await db.leadAttribution.findMany({ where: { referrerAffiliateId: { in: ids } }, select: { leadId: true } })).map((a) => a.leadId);
  await db.leadTouchpoint.deleteMany({ where: { leadId: { in: leadCuaDoiTac } } });
  await db.leadAttribution.deleteMany({ where: { referrerAffiliateId: { in: ids } } });
  await db.affiliateReferral.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliateTrackingAsset.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliateMembership.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliateCampaignRule.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaignSite.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaign.deleteMany({ where: { id: { in: cid } } });
  await db.affiliateSite.deleteMany({ where: { code: { startsWith: P } } });
  await db.affiliatePartyTag.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliate.deleteMany({ where: { id: { in: ids } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: P } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } });
  await db.auditLog.deleteMany({ where: { actorName: NGUOI.ten } });
}

/** Nguồn + website + campaign NHÁP (qua hàm ghi thật) — CHƯA chọn thưởng, CHƯA có chính sách. */
async function dungCampaign(p: { nguon?: boolean; website?: boolean } = {}) {
  const h = hau();
  const nhom = await db.leadSourceGroup.create({
    data: { code: `${P}_S${h}`, name: `Nguồn ${P} ${h}`, sourceType: "PARTNER", referrerRequirement: "NONE", sortOrder: 900, status: "ACTIVE", selectable: true, commissionEnabled: true },
  });
  const site = await db.affiliateSite.create({
    data: { code: `${P}_W${h}`, name: `Web ${P} ${h}`, baseUrl: ORIGIN, allowedDomains: [HOST], status: "ACTIVE", trackingEnabled: true, landingPages: { create: { pathPattern: "/khoa-robot" } } },
  });
  const t = await taoCampaign({
    nguoi: NGUOI,
    now: NOW_G,
    vao: {
      code: `${P}_C${h}`,
      name: `Campaign ${P} ${h}`,
      description: null,
      attributionModel: "FIRST_VALID",
      cookieWindowDays: 30,
      protectWindowDays: 90,
      allowSelfReferral: false,
      defaultSourceGroupId: p.nguon === false ? null : nhom.id,
      effectiveFrom: null,
      effectiveTo: null,
    },
  });
  if (!t.ok) throw new Error(`fixture: ${t.loi}`);
  if (p.website !== false) {
    const g = await ganWebsite({ nguoi: NGUOI, campaignId: t.id, siteId: site.id, now: NOW_G });
    if (!g.ok) throw new Error(`fixture: ${g.loi}`);
  }
  return { h, nhom, site, id: t.id, code: t.code };
}
type Camp = Awaited<ReturnType<typeof dungCampaign>>;

const dong = (id: string) => db.affiliateCampaign.findUniqueOrThrow({ where: { id } });
const chonThuong = async (id: string, den: "NONE" | "POLICY", now = NOW_G, lyDo: string | null = null) => datCheDoThuong({ nguoi: NGUOI, id, updatedAtDaThay: (await dong(id)).updatedAt, den, lyDo, now });
const doiTT = async (id: string, den: "ACTIVE" | "PAUSED" | "ENDED", now = NOW_G, lyDo: string | null = null) =>
  doiTrangThaiCampaign({ nguoi: NGUOI, id, updatedAtDaThay: (await dong(id)).updatedAt, den, lyDo, now });
const chanMa = async (code: string, now = NOW_G) => (await docChiTietCampaign(code, now))!.chanKichHoat.map((c) => c.ma).sort();

const FILE_KEY = "uploads/documents/fx-afl1.pdf";
const FILE_URL = `https://example.test/${FILE_KEY}`;

/** Văn bản + chính sách phạm vi CAMPAIGN bằng DỊCH VỤ (không qua form) — dùng cho các ca không cần đường form. Chưa kích hoạt. */
async function chinhSachCampaignQuaService(k: KichBan, c: Camp, hauTo: string, rules = [rule("AFFILIATE", 0.03)]) {
  const vb = await taoVanBan({
    documentCode: `${P}-${k.ma}-vb-${hauTo}`,
    title: "Quy định hoa hồng campaign (fixture AFL1)",
    kind: "COMMISSION_POLICY",
    issuedOn: "2026-02-20",
    publishedOn: "2026-03-02",
    effectiveOn: "2026-03-23",
    approvedByName: "Hồ Đắc Phúc",
    approvedById: null,
    fileKey: "documents/fx-afl1.pdf",
    fileName: "fx-afl1.pdf",
    fileUrl: "https://example.test/fx-afl1.pdf",
    ownerOrgUnitId: null,
    actor: { userId: null, ten: NHAN },
    now: NOW_CS,
  });
  const policyCode = `${k.ma}-afl1-${hauTo}`;
  const cs = await taoChinhSach({
    policyCode,
    name: `Chính sách campaign ${hauTo}`,
    description: null,
    ownerOrgUnitId: null,
    phamVi: { loai: "CAMPAIGN", campaignId: c.id },
    effectiveFrom: new Date("2026-03-22T17:00:00.000Z"),
    effectiveTo: null,
    reason: "SR.QD.fixture afl1",
    documentId: vb.id,
    rules,
    actor: { userId: null, ten: NHAN },
    now: NOW_CS,
  });
  k.chinhSachThem.push(policyCode);
  return { ...cs, policyCode };
}
const kichHoatCS = (versionId: string) => kichHoatDichVu({ versionId, actor: { userId: null, ten: NHAN }, now: NOW_CS, xacNhanCanhBao: { lyDo: "fx-afl1 xác nhận cảnh báo" } });
const maLoiChan = async (versionId: string): Promise<string[]> => {
  try {
    await kichHoatCS(versionId);
  } catch (e) {
    if (e instanceof HoaHongError && e.ma === "KICH_HOAT_BI_CHAN") return (e.chiTiet as { ma: string }[]).map((x) => x.ma).sort();
    throw e;
  }
  return [];
};

/** Kịch bản tiền: GLOBAL SALE 4% + AFFILIATE 1% (Σ 5%). `coLead: false` — lead đến từ link thật. */
const kb = (tien: string) => dungKichBan(tien, { coLead: false, rules: [{ vai: "SALE", rate: 0.04 }, { vai: "AFFILIATE", rate: 0.01 }] });
/**
 * Như `kb` nhưng CỐ Ý dọn mọi chính sách còn sống trước: guardrail kích hoạt đọc TOÀN tập ACTIVE, nên hai kịch bản cùng có mức GLOBAL ACTIVE là `CHONG_LAN_RULE`
 * (không liên quan thứ đang kiểm). Chỉ dùng ở ca có KÍCH HOẠT chính sách thật.
 */
const kbSach = async (tien: string) => {
  await lamSachChinhSach();
  return kb(tien);
};

let ipSeq = 0;
let sdtSeq = 0;
const sdtMoi = () => `09${String(((Date.now() % 90_000_000) + 1_000_000 + (sdtSeq += 7)) % 100_000_000).padStart(8, "0")}`;
const bienThe = (s: string) => [s, `84${s.slice(1)}`];

/** Đối tác + thành viên + link cho campaign ĐÃ ACTIVE, rồi lead QUA ĐƯỜNG THẬT của P1. */
async function leadTuLinkThat(k: KichBan, c: Camp): Promise<KichBan & { doiTacId: string }> {
  const loai = await db.affiliateType.create({ data: { code: `${P}_T${hau()}`, name: `Loại ${P}` } });
  const doiTac = await db.affiliate.create({ data: { code: `${P}_D${hau()}`, name: `Đối tác ${P}`, status: "ACTIVE", isActive: true, typeId: loai.id } });
  const mem = await db.affiliateMembership.create({ data: { partyId: doiTac.id, campaignId: c.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  const token = sinhToken();
  await db.affiliateTrackingAsset.create({
    data: { partyId: doiTac.id, membershipId: mem.id, campaignId: c.id, siteId: c.site.id, landingPath: "/khoa-robot", publicToken: token, type: "LINK", status: "ACTIVE" },
  });
  const sdt = sdtMoi();
  ipSeq += 1;
  const r = await xuLyIntakeGioiThieu(
    {
      thanTho: JSON.stringify({ v: 1, token, idempotencyKey: `afl1-${hau().toLowerCase()}-${ipSeq}-xx`, parentName: `${P} PH ${k.ma}`, phone: sdt, children: [{ fullName: `${P} Bé` }], consentMarketing: true }),
      origin: ORIGIN,
      ip: `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`,
      userAgent: null,
    },
    { now: () => new Date("2026-10-05T03:00:00.000Z"), choPhepTanSuat: async () => true, cho: async () => {}, nhieuMs: () => 0 },
  );
  expect(r.status).toBe(200);
  const lead = await db.lead.findFirstOrThrow({ where: { phone: { in: bienThe(sdt) }, deletedAt: null }, select: { id: true } });
  await db.lead.update({ where: { id: lead.id }, data: { convertedById: k.sale.id, adminId: k.saleAdmin.id, centerId: k.centerId, status: "DA_DANG_KY" } });
  await db.leadAttribution.update({ where: { leadId: lead.id }, data: { attributedAt: ATTRIBUTED } });
  const kk = { ...k, lead: await db.lead.findUniqueOrThrow({ where: { id: lead.id } }), doiTacId: doiTac.id };
  cuaToi.push(kk);
  return kk;
}

/** MỘT khoản NEW 10.000.000đ vào ngày `ngay` → quét bằng engine THẬT. Trả dòng AFFILIATE của khoản. */
async function thuVaQuetAff(k: KichBan, ten: string, ngay: Date) {
  const bc = await boiCanh(k, NOW);
  const be = await dungBe(k, ten, { tongTien: 10_000_000 });
  const khoan = await tienVe(k, be, { soTien: 10_000_000, ngay });
  const kq = await quetKhoan(db, bc, khoan);
  expect(kq.loai).toBe("DA_GHI");
  const dongs = await dongSoCuaKhoan(khoan);
  return dongs.find((d) => d.roleCode === "AFFILIATE")!;
}

describe.skipIf(!RUN_DB_TESTS)("[AFL1] chính sách campaign Affiliate — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["HO_ACCOUNTANT", "CENTER_SALES_CSM"] });
    await damBaoDanhMucGoc(db);
    await datCoNguon({ ...CO_NGUON_DAY_DU, affiliate: true });
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
    await datMocCutover("2026-10");
    await don().catch(() => undefined);
  }, 180_000);

  afterAll(async () => {
    // Mỗi bước dọn độc lập: một bước ném KHÔNG được chặn các bước sau — đặc biệt `donNguoiPhuTrach` (người phụ trách giả ở MỌI cơ sở làm đỏ [NHH-POL-09]/[NHH-POL-09b] của chinh-sach.spec).
    const buoc = [
      () => donKichBan(cuaToi),
      () => don(),
      () => donNguoiPhuTrach(NHAN),
      () => datMocCutover(null),
      () => datTranHoaHong(null),
      async () => {
        await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
        clearSettingsCache();
      },
    ];
    const loi: unknown[] = [];
    for (const b of buoc) await b().catch((e: unknown) => loi.push(e));
    if (loi.length > 0) throw loi[0];
  }, 180_000);

  it("[AFL1-DB-01] ĐẦU-CUỐI: chặn có liệt kê → «có thưởng» → LƯU NHÁP chính sách qua đường form (không tự kích hoạt) → xem trước → kích hoạt chính sách → kích hoạt campaign → tiền 3%; PAUSED không đổi tiền; hết hạn ⇒ về mức chung", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    await datTranHoaHong(null); // trần mặc định 9% — đợt này KHÔNG nâng trần
    const c = await dungCampaign();
    const k0 = await kb("l1a"); // `lamSachChinhSach()` đã chạy ở đầu ca
    cuaToi.push(k0);
    const ho = await nguoiKyHo();

    // (1) Mới tạo: chưa chọn thưởng ⇒ bị chặn đúng MỘT điều kiện, và hàm GHI nói y hệt (nút nói thật).
    expect(await chanMa(c.code)).toEqual(["THUONG_CHUA_CHON"]);
    const chan = await doiTT(c.id, "ACTIVE");
    expect(chan).toMatchObject({ ok: false, truong: "kichHoat" });
    expect(chan.ok === false && chan.lyDoChan?.map((x) => x.ma)).toEqual(["THUONG_CHUA_CHON"]);
    expect((await dong(c.id)).status).toBe("DRAFT");

    // (2) Chọn «có thưởng»: chưa có chính sách ⇒ chặn câu khác. Chưa kích hoạt gì.
    expect((await chonThuong(c.id, "POLICY")).ok).toBe(true);
    expect(await chanMa(c.code)).toEqual(["THUONG_THIEU_CHINH_SACH"]);
    expect((await dong(c.id)).status).toBe("DRAFT");

    // (3) Lưu NHÁP chính sách bằng ĐÚNG đường mà trình soạn dùng (form → payload → service). KHÔNG tự kích hoạt.
    const form: FormChinhSach = {
      ...formRong(),
      ...formChoCampaign({ id: c.id, code: c.code, name: `Campaign ${c.code}` }, { coVaiAffiliate: true, coLoaiNew: true }),
      policyCode: `${k0.ma}-afl1-form`,
      name: "Hoa hồng Affiliate — campaign fixture",
      o: { "NEW|AFFILIATE": { kieu: "PERCENT", phanTram: "3" } },
      vanBan: { kieu: "moi", documentCode: `${P}-${k0.ma}-vb-form`, title: "Quy định (fixture AFL1)", issuedOn: "2026-02-20", publishedOn: "2026-03-02", effectiveOn: "2026-03-23", approvedByName: "Hồ Đắc Phúc", tep: { key: FILE_KEY, ten: "fx-afl1.pdf", url: FILE_URL } },
      hieuLucTu: "2026-03-23",
      hieuLucDen: "",
      lyDo: "SR.QD.fixture afl1 (form)",
    };
    expect(form.phamVi).toEqual({ loai: "CAMPAIGN", campaignId: c.id });
    expect(form.vai).toEqual(["AFFILIATE"]);
    const luu = await luuNhap({ actor: ho.quyen, nguoi: { userId: ho.userId, ten: ho.ten }, now: NOW_CS, vao: { form, policyId: null, versionId: null, updatedAtDaThay: null } });
    if (!luu.ok) throw new Error(`luuNhap: ${JSON.stringify(luu.loi)} ${luu.chung}`);
    k0.chinhSachThem.push(form.policyCode);
    const ver = await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: luu.versionId }, include: { rules: true } });
    expect(ver).toMatchObject({ status: "DRAFT", scopeType: "CAMPAIGN", scopeCampaignId: c.id, scopeKey: `CAMPAIGN:${c.id}`, activatedAt: null });
    expect(ver.rules).toHaveLength(1);
    expect(ver.rules[0]).toMatchObject({ transactionTypeCode: "NEW", calcKind: "PERCENT" });
    expect(Number(ver.rules[0]!.rate)).toBeCloseTo(0.03, 6);
    // Lưu nháp KHÔNG kích hoạt cả chính sách lẫn campaign; cổng campaign vẫn nói «thiếu chính sách đang áp».
    expect((await dong(c.id)).status).toBe("DRAFT");
    expect(await chanMa(c.code)).toEqual(["THUONG_THIEU_CHINH_SACH"]);

    // (4) Xem trước: hàng rào (guardrail THẬT) sạch lỗi; thử tính chạy trên bản nháp phạm vi CAMPAIGN không ném.
    const rao = await kiemHangRao({ actor: ho.quyen, now: NOW_CS, versionId: luu.versionId });
    expect(rao.ok).toBe(true);
    if (rao.ok) expect(rao.hangRao.loi).toEqual([]);
    const thu = await thuTinhPhienBan({ actor: ho.quyen, now: NOW_CS, versionId: luu.versionId, tuNgay: "2026-10-01", denNgay: "2026-10-31", orgUnitId: null });
    expect(thu.ok).toBe(true);

    // (5) Kích hoạt CHÍNH SÁCH (bước riêng, khoá riêng) → cổng campaign mở → kích hoạt campaign.
    const kh = await kichHoatPhienBan({ actor: ho.quyen, nguoi: { userId: ho.userId, ten: ho.ten }, now: NOW_CS, versionId: luu.versionId, xacNhanLyDo: null, updatedAtDaThay: luu.updatedAt });
    expect(kh.ok, JSON.stringify(kh)).toBe(true);
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: luu.versionId } })).status).toBe("ACTIVE");
    expect((await dong(c.id)).status).toBe("DRAFT"); // chính sách ACTIVE không kéo campaign theo
    expect(await chanMa(c.code)).toEqual([]);
    expect(await doiTT(c.id, "ACTIVE")).toMatchObject({ ok: true, tu: "DRAFT", den: "ACTIVE" });

    // (6) Tiền THẬT: lead qua link thật ⇒ AFFILIATE 3% (campaign) thay vì 1% (mức chung).
    const k = await leadTuLinkThat(k0, c);
    const a1 = await thuVaQuetAff(k, "a", D("2026-10-12"));
    expect(a1).toMatchObject({ amount: 300_000, beneficiaryKind: "AFFILIATE", beneficiaryAffiliateId: k.doiTacId, policyVersionId: luu.versionId, affiliateCampaignId: c.id });

    // (7) PAUSED KHÔNG đổi tiền (luật 3 của doc 12 §8: engine tra campaign không lọc trạng thái) — đối chứng cho «hạ về PAUSED thì ngừng áp».
    expect((await doiTT(c.id, "PAUSED", NOW_G, LY_DO)).ok).toBe(true);
    const a2 = await thuVaQuetAff(k, "b", D("2026-10-14"));
    expect(a2).toMatchObject({ amount: 300_000, policyVersionId: luu.versionId });
    expect((await doiTT(c.id, "ACTIVE")).ok).toBe(true); // chính sách còn áp ⇒ chạy lại được

    // (8) Xem trước ĐÚNG số tiền: phiên bản 2 nháp 4% ⇒ thử tính cho thấy AFFILIATE tăng (đo trên 2 khoản thật vừa ghi).
    const v2 = await taoPhienBanMoi({ policyId: luu.policyId, phamVi: null, effectiveFrom: new Date("2026-03-22T17:00:00.000Z"), effectiveTo: null, reason: "fixture v2 4%", documentId: ver.documentId, rules: [rule("AFFILIATE", 0.04)], actor: { userId: null, ten: NHAN }, now: NOW_CS });
    const thu2 = await thuTinhPhienBan({ actor: ho.quyen, now: NOW_CS, versionId: v2.versionId, tuNgay: "2026-10-01", denNgay: "2026-10-31", orgUnitId: null });
    expect(thu2.ok).toBe(true);
    if (thu2.ok) {
      const vaiAff = thu2.ketQua.phanRa.vai.find((v) => v.khoa === "AFFILIATE");
      expect(vaiAff, "bảng phân rã theo vai có dòng AFFILIATE").toBeTruthy();
      expect(vaiAff!.chenh).toBeGreaterThanOrEqual(200_000); // 2 khoản × (4% − 3%) × 10.000.000
    }
    await db.commissionPolicyVersion.update({ where: { id: v2.versionId }, data: { status: "CANCELLED" } }); // bỏ nháp: các bước sau đo chính sách v1

    // (9) Chính sách HẾT HẠN tại 20/10: khoản sau đó về mức chung 1%. Campaign ĐANG CHẠY không tự tụt.
    await choHetHieuLuc({ versionId: luu.versionId, effectiveTo: D("2026-10-20"), lyDo: "Kết thúc ưu đãi fixture", actor: { userId: null, ten: NHAN }, now: NOW_CS });
    expect((await dong(c.id)).status).toBe("ACTIVE");
    const a3 = await thuVaQuetAff(k, "c", D("2026-10-25"));
    expect(a3.amount).toBe(100_000);
    expect(a3.policyVersionId).not.toBe(luu.versionId);

    // (10) …nhưng CHẠY LẠI sau tạm dừng đi qua cổng: không còn chính sách đang áp ⇒ chặn.
    expect((await doiTT(c.id, "PAUSED", NOW, LY_DO)).ok).toBe(true);
    const lai = await doiTT(c.id, "ACTIVE", NOW);
    expect(lai).toMatchObject({ ok: false, truong: "kichHoat" });
    expect(lai.ok === false && lai.lyDoChan?.map((x) => x.ma)).toEqual(["THUONG_THIEU_CHINH_SACH"]);
    expect((await dong(c.id)).status).toBe("PAUSED");
  });

  it("[AFL1-DB-02] `AffiliateCampaignRule.policyId` lệch (SQL tay) ⇒ chặn kích hoạt, nói đúng chỗ sửa; trỏ chính sách có phiên bản CỦA campaign này ⇒ qua; null ⇒ qua", async () => {
    const c = await dungCampaign();
    const k = await kb("l1b");
    cuaToi.push(k);
    expect((await chonThuong(c.id, "NONE")).ok).toBe(true);
    const loai = await db.affiliateType.create({ data: { code: `${P}_T${hau()}`, name: `Loại ${P}` } });
    expect((await themQuyTac({ nguoi: NGUOI, campaignId: c.id, vao: { typeId: loai.id, tagId: null, sourceGroupId: c.nhom.id }, lyDo: null, now: NOW_G })).ok).toBe(true);
    const r = await db.affiliateCampaignRule.findFirstOrThrow({ where: { campaignId: c.id } });
    expect(await chanMa(c.code)).toEqual([]);

    // Chính sách KHÔNG có phiên bản campaign này (phạm vi GLOBAL của kịch bản) ⇒ lệch.
    await db.affiliateCampaignRule.update({ where: { id: r.id }, data: { policyId: k.chinhSach.policyId } });
    expect(await chanMa(c.code)).toEqual(["POLICY_RULE_LECH"]);
    const chan = await doiTT(c.id, "ACTIVE");
    expect(chan).toMatchObject({ ok: false, truong: "kichHoat" });
    expect(chan.ok === false && chan.lyDoChan?.map((x) => [x.ma, x.muc])).toEqual([["POLICY_RULE_LECH", "quy-tac"]]);
    expect((await dong(c.id)).status).toBe("DRAFT");

    // Chính sách CÓ phiên bản phạm vi campaign này (nháp cũng tính — cổng hỏi QUAN HỆ, không hỏi trạng thái) ⇒ qua.
    const cs = await chinhSachCampaignQuaService(k, c, "lk");
    await db.affiliateCampaignRule.update({ where: { id: r.id }, data: { policyId: cs.policyId } });
    expect(await chanMa(c.code)).toEqual([]);
    expect((await doiTT(c.id, "ACTIVE")).ok).toBe(true);

    // null ⇒ qua (đối chứng dương nền).
    await db.affiliateCampaignRule.update({ where: { id: r.id }, data: { policyId: null } });
    expect(await chanMa(c.code)).toEqual([]);
  });

  it("[AFL1-DB-03] liệt kê MỌI blocker một lượt; nguồn ngừng nói đúng tên; quy tắc trỏ loại đã tắt là quy tắc chết", async () => {
    const trang = await dungCampaign({ nguon: false, website: false });
    expect(await chanMa(trang.code)).toEqual(["DOI_TAC_NGUON", "THUONG_CHUA_CHON", "WEBSITE"]);
    const kq = await doiTT(trang.id, "ACTIVE");
    expect(kq.ok === false && kq.lyDoChan?.map((x) => x.ma).sort()).toEqual(["DOI_TAC_NGUON", "THUONG_CHUA_CHON", "WEBSITE"]);
    // Lỗi liệt kê đủ cả trong câu chữ gửi người dùng (một dòng mỗi điều kiện).
    expect(kq.ok === false && (kq.loi.match(/•/g) ?? []).length).toBe(3);
    expect((await dong(trang.id)).status).toBe("DRAFT");

    // Quy tắc theo loại đối tác: loại bị TẮT sau khi tạo quy tắc ⇒ không còn áp được; không nguồn mặc định ⇒ chặn.
    const c = await dungCampaign({ nguon: false });
    expect((await chonThuong(c.id, "NONE")).ok).toBe(true);
    const loai = await db.affiliateType.create({ data: { code: `${P}_T${hau()}`, name: `Loại ${P}` } });
    expect((await themQuyTac({ nguoi: NGUOI, campaignId: c.id, vao: { typeId: loai.id, tagId: null, sourceGroupId: c.nhom.id }, lyDo: null, now: NOW_G })).ok).toBe(true);
    expect(await chanMa(c.code)).toEqual([]);
    await db.affiliateType.update({ where: { id: loai.id }, data: { isActive: false } });
    expect(await chanMa(c.code)).toEqual(["DOI_TAC_NGUON"]);
    await db.affiliateType.update({ where: { id: loai.id }, data: { isActive: true } });
    expect(await chanMa(c.code)).toEqual([]);

    // Nguồn ngừng ⇒ blocker nêu TÊN nguồn.
    await db.leadSourceGroup.update({ where: { id: c.nhom.id }, data: { status: "INACTIVE" } });
    const det = (await docChiTietCampaign(c.code, NOW_G))!.chanKichHoat;
    expect(det.map((x) => x.ma)).toContain("NGUON_KHONG_DUNG");
    expect(det.find((x) => x.ma === "NGUON_KHONG_DUNG")!.thongBao).toContain(`Nguồn ${P} ${c.h}`);
  });

  it("[AFL1-DB-04] trần: chính sách campaign đẩy Σ vượt 9% ⇒ VUOT_TRAN kèm đường tới Cấu hình vận hành; KHÔNG tự nâng trần; bản nháp vẫn DRAFT", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    await datTranHoaHong(null);
    const c = await dungCampaign();
    const k = await dungKichBan("l1d", { coLead: false }); // GLOBAL seed v1 = đúng trần 9%
    cuaToi.push(k);
    const cs = await chinhSachCampaignQuaService(k, c, "vuot", [rule("AFFILIATE", 0.03)]); // Σ = 9% + 3% = 12% trong ngữ cảnh campaign
    const ho = await nguoiKyHo();
    const r = await kichHoatPhienBan({ actor: ho.quyen, nguoi: { userId: ho.userId, ten: ho.ten }, now: NOW_CS, versionId: cs.versionId, xacNhanLyDo: null, updatedAtDaThay: (await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: cs.versionId } })).updatedAt.toISOString() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const vt = r.hangRao?.loi.find((l) => l.ma === "VUOT_TRAN");
      expect(vt, "hàng rào có VUOT_TRAN").toBeTruthy();
      expect(vt!.huongXuLy?.duongDan?.href ?? vt!.thongBao).toContain("cau-hinh-van-hanh");
      expect(vt!.thongBao).toContain("campaign");
    }
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: cs.versionId } })).status).toBe("DRAFT");
    clearSettingsCache();
    expect(await getSetting("crm.commissionMaxTotalRate")).toBe(0.09); // không ai nâng trần hộ
  });

  it("[AFL1-DB-05] «không có mức riêng» × chính sách: chặn cả hai chiều; đua hai bên không bao giờ cùng thắng", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    await datTranHoaHong(null);

    // Chiều 1: đặt NONE khi chính sách đang áp ⇒ từ chối, lựa chọn KHÔNG đổi, không dòng nhật ký.
    const c1 = await dungCampaign();
    const k1 = await kbSach("l1e");
    cuaToi.push(k1);
    expect((await chonThuong(c1.id, "POLICY")).ok).toBe(true);
    const cs1 = await chinhSachCampaignQuaService(k1, c1, "n1");
    await kichHoatCS(cs1.versionId);
    const t = await chonThuong(c1.id, "NONE");
    expect(t).toMatchObject({ ok: false, truong: "cheDoThuong" });
    expect((await dong(c1.id)).rewardMode).toBe("POLICY");
    // Đối chứng dương: chính sách hết hạn rồi thì đặt NONE được.
    await choHetHieuLuc({ versionId: cs1.versionId, effectiveTo: D("2026-10-09"), lyDo: "Hết ưu đãi", actor: { userId: null, ten: NHAN }, now: NOW_CS });
    expect((await chonThuong(c1.id, "NONE", D("2026-10-13"))).ok).toBe(true);
    expect((await dong(c1.id)).rewardMode).toBe("NONE");

    // Chiều 2: campaign đang NONE ⇒ kích hoạt chính sách CAMPAIGN bị chặn (CAMPAIGN_KHONG_THUONG), bản nháp vẫn DRAFT; chuyển POLICY thì kích hoạt được.
    const c2 = await dungCampaign();
    const k2 = await kbSach("l1f");
    cuaToi.push(k2);
    expect((await chonThuong(c2.id, "NONE")).ok).toBe(true);
    const cs2 = await chinhSachCampaignQuaService(k2, c2, "n2");
    expect(await maLoiChan(cs2.versionId)).toEqual(["CAMPAIGN_KHONG_THUONG"]);
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: cs2.versionId } })).status).toBe("DRAFT");
    expect((await chonThuong(c2.id, "POLICY")).ok).toBe(true);
    expect(await maLoiChan(cs2.versionId)).toEqual([]);
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: cs2.versionId } })).status).toBe("ACTIVE");

    // ĐUA: «đặt NONE» × «kích hoạt chính sách» — kết thúc KHÔNG BAO GIỜ là (NONE ∧ chính sách đang áp).
    for (let i = 0; i < 4; i += 1) {
      const c = await dungCampaign();
      const k = await kbSach(`l1g${i}`);
      cuaToi.push(k);
      expect((await chonThuong(c.id, "POLICY")).ok).toBe(true);
      const cs = await chinhSachCampaignQuaService(k, c, `r${i}`);
      const cu = (await dong(c.id)).updatedAt;
      const [a, b] = await Promise.allSettled([datCheDoThuong({ nguoi: NGUOI, id: c.id, updatedAtDaThay: cu, den: "NONE", lyDo: null, now: NOW_G }), kichHoatCS(cs.versionId)]);
      void a;
      void b;
      const cuoi = await dong(c.id);
      const ver = await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: cs.versionId } });
      expect(cuoi.rewardMode === "NONE" && ver.status === "ACTIVE", `lần ${i}: mode=${cuoi.rewardMode} policy=${ver.status}`).toBe(false);
    }
  });

  it("[AFL1-DB-05b] hàng rào xem trước VÀ kích hoạt nói ĐỦ MỌI lỗi một lượt: «không có mức riêng» + vượt trần ⇒ cả hai mã cùng hiện", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    await datTranHoaHong(null);
    const c = await dungCampaign();
    const k = await dungKichBan("l1h", { coLead: false }); // GLOBAL seed v1 = đúng trần 9% ⇒ AFFILIATE 3% ở campaign vượt trần
    cuaToi.push(k);
    expect((await chonThuong(c.id, "NONE")).ok).toBe(true);
    const cs = await chinhSachCampaignQuaService(k, c, "n5b", [rule("AFFILIATE", 0.03)]);
    const ho = await nguoiKyHo();
    const rao = await kiemHangRao({ actor: ho.quyen, now: NOW_CS, versionId: cs.versionId });
    expect(rao.ok).toBe(true);
    if (rao.ok) expect(rao.hangRao.loi.map((l) => l.ma).sort()).toEqual(["CAMPAIGN_KHONG_THUONG", "VUOT_TRAN"]);
    expect(await maLoiChan(cs.versionId)).toEqual(["CAMPAIGN_KHONG_THUONG", "VUOT_TRAN"]);
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: cs.versionId } })).status).toBe("DRAFT");
  });

  it("[AFL1-DB-05c] lớp kiểm DƯỚI KHOÁ: người khác giữ khoá campaign + đặt «không có mức riêng» CHƯA commit ⇒ kích hoạt chính sách (đã qua kiểm trước vì thấy POLICY) chờ khoá rồi bị từ chối", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    await datTranHoaHong(null);
    const c = await dungCampaign();
    const k = await kb("l1i");
    cuaToi.push(k);
    expect((await chonThuong(c.id, "POLICY")).ok).toBe(true);
    const cs = await chinhSachCampaignQuaService(k, c, "n5c");

    let nha!: () => void;
    const cong = new Promise<void>((r) => (nha = r));
    let giuXong!: () => void;
    const daGiu = new Promise<void>((r) => (giuXong = r));
    const nguoiGiu = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "AffiliateCampaign" WHERE "id" = ${c.id} FOR UPDATE`;
        await tx.affiliateCampaign.update({ where: { id: c.id }, data: { rewardMode: "NONE" } });
        giuXong();
        await cong;
      },
      { timeout: 60_000, maxWait: 60_000 },
    );
    await daGiu;
    // Kích hoạt chính sách: kiểm TRƯỚC (ngoài giao dịch) đọc trạng thái ĐÃ COMMIT = POLICY ⇒ qua; vào giao dịch thì kẹt ở khoá campaign `FOR SHARE`.
    const dangChay = maLoiChan(cs.versionId);
    let kep = false;
    for (let i = 0; i < 600 && !kep; i += 1) {
      const r = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%AffiliateCampaign%FOR SHARE%'`;
      kep = Number(r[0]!.n) > 0;
      if (!kep) await new Promise((x) => setTimeout(x, 100));
    }
    expect(kep, "kích hoạt phải KẸT ở khoá campaign (nếu không, ca này không đo được lớp dưới khoá)").toBe(true);
    nha();
    await nguoiGiu;
    expect(await dangChay).toEqual(["CAMPAIGN_KHONG_THUONG"]);
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: cs.versionId } })).status).toBe("DRAFT");
    expect((await dong(c.id)).rewardMode).toBe("NONE");
  });

  it("[AFL1-DB-06] bộ lọc Sổ / Kỳ lấy campaign từ MASTER: campaign có thật + 0 dòng sổ vẫn có mặt; mã lạ thì không; người không có quyền xem campaign giữ danh sách suy từ sổ", async () => {
    const c = await dungCampaign();
    const ho = await nguoiKyHo();
    const trong = await db.commissionTransaction.count({ where: { affiliateCampaignId: c.id } });
    expect(trong, "campaign mới chưa có dòng sổ").toBe(0);

    const master = await docLuaChonBoLocSo(ho.quyen, { coAffiliate: true, campaignMaster: { xem: true, dangChon: c.code } });
    expect(master.campaign.map((x) => x.code)).toContain(c.code);
    expect(master.campaign.find((x) => x.code === c.code)!.ten).toBe(`Campaign ${P} ${c.h}`);
    expect(master.campaign.map((x) => x.code)).not.toContain(`${P}_KHONGCO`);

    const suyTuSo = await docLuaChonBoLocSo(ho.quyen, { coAffiliate: true, campaignMaster: { xem: false, dangChon: c.code } });
    expect(suyTuSo.campaign.map((x) => x.code), "không quyền xem campaign ⇒ danh sách suy từ sổ (campaign chưa có tiền không lộ)").not.toContain(c.code);

    const kyMaster = await docCampaignCoTrongKy(ho.quyen, { xem: true, dangChon: null });
    expect(kyMaster.map((x) => x.code)).toContain(c.code);
    const kySo = await docCampaignCoTrongKy(ho.quyen, { xem: false, dangChon: null });
    expect(kySo.map((x) => x.code)).not.toContain(c.code);

    // Trình soạn chính sách: danh sách campaign CHỈ cho người có `affiliate_campaigns:view` (quyền soạn không tự mở nó). Đối chứng dương: HO có quyền ⇒ thấy; người không vai nào ⇒ rỗng.
    expect((await docDuLieuSoan(ho.quyen, NOW_CS)).campaign.map((x) => x.code)).toContain(c.code);
    const khongVai = await seedUser({ email: `${P.toLowerCase()}-khong-vai-${hau().toLowerCase()}@ci.test`, role: "SALES_CSM", name: `${P} không vai`, phone: null });
    expect((await docDuLieuSoan(await actorCua(khongVai.id), NOW_CS)).campaign).toEqual([]);

    // Mã đang lọc nằm NGOÀI trần của danh sách vẫn được tra riêng (không bị dán nhãn «không còn»).
    const rieng = await docCampaignMaster(c.code);
    expect(rieng.filter((x) => x.code === c.code)).toHaveLength(1);
    expect((await docCampaignMaster(`${P}_KHONGCO`)).some((x) => x.code === `${P}_KHONGCO`)).toBe(false);
  });
});
