// @vitest-environment node
/**
 * [AFR-DB-*] — BÁO CÁO HIỆU QUẢ AFFILIATE và LỌC SỔ / KỲ THEO CAMPAIGN, Postgres THẬT (AFF-P3; docs/source-commission/12 §9).
 *
 * H1 — khối «Hiệu quả» của campaign: [AFR-DB-10..16] (xem khối chú thích ngay trước phần H1 ở cuối tệp)
 *
 * H2 — lọc Sổ / Kỳ theo campaign & đối tác
 *   [AFR-DB-01] `docSoHoaHong` lọc `campaignMa`: chỉ dòng của campaign đó; mã LẠ ⇒ 0 dòng (KHÔNG rơi về «không lọc»); không lọc ⇒ đủ (đối chứng dương)
 *   [AFR-DB-02] lọc `doiTacHuongId`: chỉ dòng mà đối tác ấy NHẬN tiền; dòng của nhân sự trong cùng campaign bị loại
 *   [AFR-DB-03] CÁCH LY CƠ SỞ: QLCS CS1 lọc campaign chỉ thấy dòng CS1; Kế toán HO thấy cả hai cơ sở; QLCS không thấy campaign chỉ có ở CS2 trong danh sách lọc
 *   [AFR-DB-04] `docLuaChonBoLocSo`: danh sách campaign / đối tác dựng từ dòng TRONG TẦM NHÌN; view-self không có danh sách đối tác
 *   [AFR-DB-05] `gomSoTheoTrangThaiChi`: Σ các trạng thái ≡ `tongTien`/`tongSo` của `docSoHoaHong` cho CÙNG bộ lọc (HO và QLCS)
 *   [AFR-DB-06] Kỳ: `docPhanCampaignTheoKy` đúng phần của campaign; mã lạ ⇒ rỗng; `docCampaignCoTrongKy` có scope; số của CẢ KỲ (`chupSoLieuKy`) KHÔNG bị lọc theo campaign
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng hiện trường (campaign mã duy nhất ⇒ lọc theo mã của CHÍNH MÌNH, không phụ thuộc DB còn gì). LUẬT 19: ngày TUYỆT ĐỐI.
 * AN TOÀN DB: không `resetDb()`; sổ bất biến nên dọn bằng `donSoCai` (cắt bảng sổ) TRƯỚC khi xoá campaign / đối tác (FK Restrict).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 90_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { docBaoCaoHieuQua } from "../../lib/affiliate/doc-bao-cao";
import { giaiKhoangNgay } from "../../lib/affiliate/bao-cao";
import { docLuaChonBoLocSo, docTrangSo } from "../../lib/hoa-hong/doc-so-giao-dien";
import { docSoHoaHong, gomSoTheoTrangThaiChi } from "../../lib/hoa-hong/doc-so";
import { chupSoLieuKy, docCampaignCoTrongKy, docPhanCampaignTheoKy } from "../../lib/hoa-hong/ky-doc";
import { damBaoToChuc } from "../lead-intake/_nguon-fixture";
import { actorCua, donKichBan, dungKichBan, ganVai, nguoiKyHo, nguoiKyQlcs, type KichBan } from "./_kich-ban";
import { donAffiliateFx, dungChuoi, KHACH, taoClick, taoDoiTac, taoLead, taoReferral, themCampaignChoDoiTac, themDongSo, type Chuoi } from "./_affiliate-so-fx";

if (!RUN_DB_TESTS) console.warn(`[AFR-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const cuaToi: KichBan[] = [];
const CO_AFF = { coAffiliate: true, campaignMaster: { xem: false, dangChon: null } } as const;

async function kb(tien: string) {
  const k = await dungKichBan(tien, { coLead: false, rules: [{ vai: "SALE", rate: 0.04 }] });
  cuaToi.push(k);
  return k;
}

/**
 * Hiện trường sổ: hai cơ sở, hai campaign dùng chung + một campaign CHỈ ở CS2, hai đối tác.
 *   CS1: campA ← AFFILIATE aff1 100.000 PENDING · SALE 50.000 PAID | campB ← AFFILIATE aff2 30.000 EXPORTED | không campaign ← SALE 10.000
 *   CS2: campA ← AFFILIATE aff1 200.000 PENDING | campC (chỉ CS2) ← AFFILIATE aff2 70.000 APPROVED
 */
async function dungSo() {
  const k1 = await kb("afr1");
  const k2 = await kb("afr2");
  await ganVai(k1.sale.id, k1.ouId, "CENTER_SALES_CSM");
  const a: Chuoi = await dungChuoi({ tenCampaign: "Chiến dịch AFRX A" });
  const b = await themCampaignChoDoiTac(a, "Chiến dịch AFRX B");
  const c = await themCampaignChoDoiTac(a, "Chiến dịch AFRX C (chỉ CS2)");
  const aff2 = await taoDoiTac({ campaign: a.campaign, loai: a.loai.id, ten: "Đối tác AFRX Hai", site: a.site });
  const aff1 = a.doiTac;
  const d = (k: KichBan) => ({ centerId: k.centerId, orgUnitId: k.ouId });
  const l1 = await themDongSo({ ...d(k1), campaignId: a.campaign.id, vai: "AFFILIATE", nguoiId: aff1.id, ten: aff1.name, amount: 100_000, payout: "PENDING" });
  const l2 = await themDongSo({ ...d(k1), campaignId: a.campaign.id, vai: "SALE", nguoiId: k1.sale.id, ten: "Sale CS1", amount: 50_000, payout: "PAID" });
  const l3 = await themDongSo({ ...d(k1), campaignId: b.campaign.id, vai: "AFFILIATE", nguoiId: aff2.doiTac.id, ten: aff2.doiTac.name, amount: 30_000, payout: "EXPORTED" });
  const l4 = await themDongSo({ ...d(k1), campaignId: null, vai: "SALE", nguoiId: k1.sale.id, ten: "Sale CS1", amount: 10_000 });
  const l5 = await themDongSo({ ...d(k2), campaignId: a.campaign.id, vai: "AFFILIATE", nguoiId: aff1.id, ten: aff1.name, amount: 200_000, payout: "PENDING" });
  const l6 = await themDongSo({ ...d(k2), campaignId: c.campaign.id, vai: "AFFILIATE", nguoiId: aff2.doiTac.id, ten: aff2.doiTac.name, amount: 70_000, payout: "APPROVED" });
  return { k1, k2, a, b, c, aff1, aff2: aff2.doiTac, l: { l1, l2, l3, l4, l5, l6 } };
}

const ids = (r: { dong: { id: string }[] }) => r.dong.map((d) => d.id).sort();

describe.skipIf(!RUN_DB_TESTS)("[AFR-DB] lọc Sổ / Kỳ theo campaign — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["HO_ACCOUNTANT", "CENTER_SALES_CSM", "CENTER_MANAGER"] });
  }, 180_000);

  afterAll(async () => {
    await donKichBan(cuaToi); // cắt bảng sổ + dọn cơ sở / chính sách của kịch bản
    await donAffiliateFx();
  }, 180_000);

  it("[AFR-DB-01] lọc campaign: chỉ dòng của campaign; mã LẠ ⇒ 0 dòng (không rơi về «không lọc»); không lọc ⇒ đủ (đối chứng dương)", async () => {
    const s = await dungSo();
    const ho = (await nguoiKyHo()).quyen;

    const ra = await docSoHoaHong(db, ho, { campaignMa: s.a.campaign.code, coTrang: 200 });
    expect(ids(ra)).toEqual([s.l.l1.id, s.l.l2.id, s.l.l5.id].sort());
    expect(ra.tongTien).toBe(100_000 + 50_000 + 200_000);
    expect(ra.tongSo).toBe(3);

    expect(ids(await docSoHoaHong(db, ho, { campaignMa: s.b.campaign.code, coTrang: 200 }))).toEqual([s.l.l3.id]);

    // mã LẠ (đúng hình dạng, không có thật) ⇒ KHÔNG dòng nào — bản vá sai sẽ trả TOÀN BỘ sổ ở đây
    const la = await docSoHoaHong(db, ho, { campaignMa: "AFRX_KHONG_CO_THAT", coTrang: 200 });
    expect(la.dong).toEqual([]);
    expect(la.tongSo).toBe(0);
    expect(la.tongTien).toBe(0);

    // đối chứng dương: KHÔNG lọc ⇒ thấy cả dòng không thuộc campaign nào
    const tatCa = await docSoHoaHong(db, ho, { coTrang: 200 });
    for (const x of Object.values(s.l)) expect(tatCa.dong.map((d) => d.id)).toContain(x.id);
  });

  it("[AFR-DB-02] lọc đối tác nhận tiền: chỉ dòng AFFILIATE của đối tác đó; dòng nhân sự cùng campaign bị loại; id lạ ⇒ 0 dòng", async () => {
    const s = await dungSo();
    const ho = (await nguoiKyHo()).quyen;
    const r1 = await docSoHoaHong(db, ho, { doiTacHuongId: s.aff1.id, campaignMa: s.a.campaign.code, coTrang: 200 });
    expect(ids(r1)).toEqual([s.l.l1.id, s.l.l5.id].sort());
    expect(r1.dong.every((d) => d.nguoiHuong.kind === "AFFILIATE" && d.nguoiHuong.id === s.aff1.id)).toBe(true);
    // dòng SALE của campaign A (l2) có trong campaign nhưng KHÔNG phải của đối tác
    expect(ids(r1)).not.toContain(s.l.l2.id);
    // đối chứng: đối tác 2 ở campaign A không có dòng nào
    expect((await docSoHoaHong(db, ho, { doiTacHuongId: s.aff2.id, campaignMa: s.a.campaign.code, coTrang: 200 })).tongSo).toBe(0);
    expect(ids(await docSoHoaHong(db, ho, { doiTacHuongId: s.aff2.id, coTrang: 200 }))).toEqual([s.l.l3.id, s.l.l6.id].sort());
    expect((await docSoHoaHong(db, ho, { doiTacHuongId: "afrx-khong-co-that", coTrang: 200 })).tongSo).toBe(0);
  });

  it("[AFR-DB-03] CÁCH LY: QLCS CS1 lọc campaign A chỉ thấy dòng CS1; Kế toán HO thấy CS1+CS2; QLCS CS1 lọc campaign chỉ-có-ở-CS2 ⇒ 0 dòng", async () => {
    const s = await dungSo();
    const ho = (await nguoiKyHo()).quyen;
    const ql1 = (await nguoiKyQlcs(s.k1)).quyen;

    const hoA = await docSoHoaHong(db, ho, { campaignMa: s.a.campaign.code, coTrang: 200 });
    expect(new Set(hoA.dong.map((d) => d.centerId))).toEqual(new Set([s.k1.centerId, s.k2.centerId])); // đối chứng dương: HO thấy cả hai cơ sở
    const qlA = await docSoHoaHong(db, ql1, { campaignMa: s.a.campaign.code, coTrang: 200 });
    expect(ids(qlA)).toEqual([s.l.l1.id, s.l.l2.id].sort());
    expect(qlA.dong.every((d) => d.centerId === s.k1.centerId)).toBe(true);
    expect(qlA.tongTien).toBe(150_000);

    // campaign C chỉ có ở CS2: HO thấy, QLCS CS1 KHÔNG (kể cả tự gõ đúng mã)
    expect(ids(await docSoHoaHong(db, ho, { campaignMa: s.c.campaign.code, coTrang: 200 }))).toEqual([s.l.l6.id]);
    expect((await docSoHoaHong(db, ql1, { campaignMa: s.c.campaign.code, coTrang: 200 })).tongSo).toBe(0);
    // và tự ép cơ sở CS2 cũng không mở thêm gì
    expect((await docSoHoaHong(db, ql1, { campaignMa: s.a.campaign.code, centerId: s.k2.centerId, coTrang: 200 })).tongSo).toBe(0);
  });

  it("[AFR-DB-04] lựa chọn bộ lọc dựng từ dòng TRONG TẦM NHÌN: QLCS CS1 không thấy campaign C; HO thấy cả ba; view-self không có danh sách đối tác (nhưng có campaign của dòng mình)", async () => {
    const s = await dungSo();
    const ho = (await nguoiKyHo()).quyen;
    const ql1 = (await nguoiKyQlcs(s.k1)).quyen;
    const sale1 = await actorCua(s.k1.sale.id);

    const maHo = (await docLuaChonBoLocSo(ho, CO_AFF)).campaign.map((c) => c.code);
    for (const c of [s.a, s.b, s.c]) expect(maHo).toContain(c.campaign.code);
    const luaQl = await docLuaChonBoLocSo(ql1, CO_AFF);
    expect(luaQl.campaign.map((c) => c.code)).toContain(s.a.campaign.code);
    expect(luaQl.campaign.map((c) => c.code)).toContain(s.b.campaign.code);
    expect(luaQl.campaign.map((c) => c.code)).not.toContain(s.c.campaign.code);
    expect(luaQl.doiTacHuong.map((d) => d.id)).toContain(s.aff1.id);

    const luaSale = await docLuaChonBoLocSo(sale1, CO_AFF);
    expect(luaSale.doiTacHuong).toEqual([]); // view-self: chỉ chính mình
    expect(luaSale.campaign.map((c) => c.code)).toContain(s.a.campaign.code); // dòng SALE l2 của chính Sale thuộc campaign A
    expect(luaSale.campaign.map((c) => c.code)).not.toContain(s.b.campaign.code); // campaign B chỉ có dòng AFFILIATE — không phải của Sale
    // đường lọc view-self: chỉ dòng CỦA MÌNH
    expect(ids(await docTrangSo(sale1, { campaignMa: s.a.campaign.code, coTrang: 200 }))).toEqual([s.l.l2.id]);

    // cờ Affiliate TẮT ⇒ hai danh sách rỗng (không chạy hai câu tra); đối chứng dương ở trên: cờ bật ⇒ có
    const tat = await docLuaChonBoLocSo(ho, { coAffiliate: false, campaignMaster: { xem: false, dangChon: null } });
    expect(tat.campaign).toEqual([]);
    expect(tat.doiTacHuong).toEqual([]);
    expect(tat.thang.length).toBeGreaterThan(0); // các lựa chọn khác của bộ lọc không bị ảnh hưởng
  });

  it("[AFR-DB-05] `gomSoTheoTrangThaiChi`: Σ các trạng thái ≡ tổng của `docSoHoaHong` cho CÙNG bộ lọc, ở HO và ở QLCS; phân theo trạng thái đúng", async () => {
    const s = await dungSo();
    const ho = (await nguoiKyHo()).quyen;
    const ql1 = (await nguoiKyQlcs(s.k1)).quyen;
    for (const actor of [ho, ql1]) {
      const loc = { campaignMa: s.a.campaign.code } as const;
      const g = await gomSoTheoTrangThaiChi(db, actor, loc);
      const tong = await docSoHoaHong(db, actor, { ...loc, coTrang: 200 });
      expect(Object.values(g).reduce((n, x) => n + x.tien, 0)).toBe(tong.tongTien);
      expect(Object.values(g).reduce((n, x) => n + x.soDong, 0)).toBe(tong.tongSo);
    }
    const g = await gomSoTheoTrangThaiChi(db, ho, { campaignMa: s.a.campaign.code });
    expect(g.PENDING).toEqual({ soDong: 2, tien: 300_000 });
    expect(g.PAID).toEqual({ soDong: 1, tien: 50_000 });
    expect(g.EXPORTED).toEqual({ soDong: 0, tien: 0 });
    // lọc đối tác thu hẹp đúng: đối tác 1 ở campaign A chỉ có hai dòng PENDING
    expect(await gomSoTheoTrangThaiChi(db, ho, { campaignMa: s.a.campaign.code, doiTacHuongId: s.aff1.id })).toMatchObject({ PENDING: { soDong: 2, tien: 300_000 }, PAID: { soDong: 0, tien: 0 } });
  });

  it("[AFR-DB-06] Kỳ: phần của campaign đúng + mã lạ rỗng; danh sách campaign có scope; số CẢ KỲ (chụp để Khoá) KHÔNG bị lọc theo campaign", async () => {
    const s = await dungSo();
    const ho = (await nguoiKyHo()).quyen;
    const ql1 = (await nguoiKyQlcs(s.k1)).quyen;
    const ky1 = await db.commissionPeriod.findUniqueOrThrow({ where: { period_centerId: { period: "2026-10", centerId: s.k1.centerId } } });
    const ky2 = await db.commissionPeriod.findUniqueOrThrow({ where: { period_centerId: { period: "2026-10", centerId: s.k2.centerId } } });

    const a = await docPhanCampaignTheoKy([ky1.id, ky2.id], s.a.campaign.code);
    expect(a.get(ky1.id)).toEqual({ hoaHong: 150_000, dieuChinh: 0, soDong: 2 });
    expect(a.get(ky2.id)).toEqual({ hoaHong: 200_000, dieuChinh: 0, soDong: 1 });
    // campaign C chỉ có ở kỳ CS2: kỳ CS1 KHÔNG có mặt trong Map (khác 0 đồng)
    const c = await docPhanCampaignTheoKy([ky1.id, ky2.id], s.c.campaign.code);
    expect(c.has(ky1.id)).toBe(false);
    expect(c.get(ky2.id)).toEqual({ hoaHong: 70_000, dieuChinh: 0, soDong: 1 });
    expect((await docPhanCampaignTheoKy([ky1.id, ky2.id], "AFRX_KHONG_CO_THAT")).size).toBe(0);

    // danh sách campaign của Kỳ đi qua scopedDb: QLCS CS1 không thấy campaign C; HO thấy
    expect((await docCampaignCoTrongKy(ho, { xem: false, dangChon: null })).map((x) => x.code)).toContain(s.c.campaign.code);
    const ql = (await docCampaignCoTrongKy(ql1, { xem: false, dangChon: null })).map((x) => x.code);
    expect(ql).toContain(s.a.campaign.code);
    expect(ql).not.toContain(s.c.campaign.code);

    // số CẢ KỲ: bản chụp mà cổng Khoá so lại — gồm MỌI dòng của kỳ CS1 (campaign A + B + không campaign), không phải chỉ campaign
    const chup = await chupSoLieuKy(ky1.id);
    expect(chup?.hoaHong).toBe(100_000 + 50_000 + 30_000 + 10_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// H1 — khối «Hiệu quả» của campaign
//   [AFR-DB-10] phễu đầy đủ cho Kế toán HO: lượt bấm · referral theo trạng thái · hợp lệ · đã đăng ký (lead.convertedAt, chưa xoá mềm) · hoa hồng theo trạng thái chi
//   [AFR-DB-11] khoảng ngày: nửa mở theo giờ VN — 23:59:59 VN ngày cuối ở TRONG, 00:00 VN ngày kế ở NGOÀI; lượt ngoài khoảng không đếm
//   [AFR-DB-12] CÁCH LY: QLCS CS1 chỉ thấy referral / đã đăng ký / hoa hồng của CS1 (không thấy CS2, không thấy dòng centerId NULL), phamVi = GIOI_HAN; lượt bấm vẫn toàn hệ; HO thấy tất cả
//   [AFR-DB-13] số hoa hồng ≡ số màn Sổ cho CÙNG bộ lọc campaign (tổng, số dòng, từng trạng thái chi) ở HO lẫn QLCS; bảng đối tác: Σ ≤ tổng, đúng chủ nhận
//   [AFR-DB-14] cổng quyền: thiếu khoá nào ⇒ khối đó là null và KHÔNG truy vấn (bảng đối tác không có số của khối đó); người không có khoá hoa hồng ⇒ hoaHong null chứ không ném
//   [AFR-DB-15] KHÔNG PII: toàn bộ JSON báo cáo không chứa tên/SĐT/email khách, SĐT/email đối tác, token link
//   [AFR-DB-16] campaign khác không lọt vào: dữ liệu của campaign B không cộng vào campaign A (mọi khối)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

const TAT_CA_QUYEN = { luotBam: true, referral: true, hoaHong: true } as const;
const NOW_BC = new Date("2026-11-05T03:00:00.000Z");
const KHOANG_10 = giaiKhoangNgay({ tu: "2026-10-01", den: "2026-10-31", now: NOW_BC });
const TRONG = new Date("2026-10-10T03:00:00.000Z");
const NGOAI_TRUOC = new Date("2026-09-15T03:00:00.000Z");

/**
 * Hiện trường phễu cho MỘT campaign X (+ campaign Y làm nhiễu):
 *   lượt bấm X: p1 5 OK + 2 LINK_DA_THU_HOI trong khoảng, 3 OK ngoài; p2 4 OK trong · Y: p1 9 OK (không được lọt vào X)
 *   referral X trong khoảng: CS1 p1 VALID×3 (2 đã chốt, 1 chưa) + MANUAL_REVIEW + REJECTED · CS1 p2 REJECTED_DUPLICATE×1 (trỏ về lead ĐÃ chốt của người khác) · CS2 p2 VALID×2 (1 đã chốt) · NULL p1 VALID×1 (đã chốt)
 *   ngoài khoảng: CS1 p1 VALID (đã chốt) ngày 15/09 · và một VALID mà lead đã XOÁ MỀM (đã chốt) trong khoảng — không tính «đã đăng ký»
 *   sổ X: CS1 p1 AFFILIATE 100k PENDING + SALE 50k PAID · CS2 p2 AFFILIATE 200k APPROVED  | sổ Y: CS1 p1 AFFILIATE 7k
 */
async function dungPheu() {
  const s = await dungSo(); // dùng lại hạ tầng cơ sở / kỳ; dữ liệu phễu đặt riêng bên dưới trên campaign MỚI
  const x = await dungChuoi({ tenCampaign: "Chiến dịch AFRX Phễu" });
  const y = await themCampaignChoDoiTac(x, "Chiến dịch AFRX Nhiễu");
  const p2 = await taoDoiTac({ campaign: x.campaign, loai: x.loai.id, ten: "Đối tác AFRX Phễu Hai", site: x.site });
  const p1 = x.doiTac;
  const cs1 = { centerId: s.k1.centerId, orgUnitId: s.k1.ouId };
  const cs2 = { centerId: s.k2.centerId, orgUnitId: s.k2.ouId };
  const nen1 = { partyId: p1.id, campaignId: x.campaign.id, membershipId: x.mem.id, assetId: x.asset.id, nhomId: x.nhomId };
  const nen2 = { partyId: p2.doiTac.id, campaignId: x.campaign.id, membershipId: p2.mem.id, assetId: p2.asset.id, nhomId: x.nhomId };

  // lượt bấm
  for (let i = 0; i < 5; i++) await taoClick({ assetId: x.asset.id, campaignId: x.campaign.id, partyId: p1.id, outcome: "OK", luc: TRONG });
  for (let i = 0; i < 2; i++) await taoClick({ assetId: x.asset.id, campaignId: x.campaign.id, partyId: p1.id, outcome: "LINK_DA_THU_HOI", luc: TRONG });
  for (let i = 0; i < 3; i++) await taoClick({ assetId: x.asset.id, campaignId: x.campaign.id, partyId: p1.id, outcome: "OK", luc: NGOAI_TRUOC });
  for (let i = 0; i < 4; i++) await taoClick({ assetId: p2.asset.id, campaignId: x.campaign.id, partyId: p2.doiTac.id, outcome: "OK", luc: TRONG });
  for (let i = 0; i < 9; i++) await taoClick({ assetId: y.asset.id, campaignId: y.campaign.id, partyId: p1.id, outcome: "OK", luc: TRONG });

  // referral
  const rf = async (nen: typeof nen1, status: "VALID" | "MANUAL_REVIEW" | "REJECTED" | "REJECTED_DUPLICATE", co: { centerId: string | null; orgUnitId?: string | null }, o: { daDangKy?: boolean; xoaMem?: boolean; luc?: Date } = {}) => {
    const lead = status === "VALID" ? await taoLead({ centerId: co.centerId, daDangKy: o.daDangKy ?? false, xoaMem: o.xoaMem ?? false }) : null;
    return taoReferral({ ...nen, status, luc: o.luc ?? TRONG, centerId: co.centerId, orgUnitId: co.orgUnitId ?? null, leadId: lead?.id ?? null });
  };
  await rf(nen1, "VALID", cs1, { daDangKy: true });
  await rf(nen1, "VALID", cs1, { daDangKy: true });
  await rf(nen1, "VALID", cs1, { daDangKy: false });
  await rf(nen1, "MANUAL_REVIEW", cs1);
  await rf(nen1, "REJECTED", cs1);
  await rf(nen2, "VALID", cs2, { daDangKy: true });
  await rf(nen2, "VALID", cs2, { daDangKy: false });
  await rf(nen1, "VALID", { centerId: null }, { daDangKy: true });
  // REJECTED_DUPLICATE trỏ về lead ĐÃ CHỐT của người ghi nhận trước (hình dạng thật của first-claim): KHÔNG được tính «đã đăng ký» của đối tác này.
  const leadCu = await taoLead({ centerId: cs1.centerId, daDangKy: true });
  await taoReferral({ ...nen2, status: "REJECTED_DUPLICATE", luc: TRONG, centerId: cs1.centerId, orgUnitId: cs1.orgUnitId, leadId: leadCu.id });
  await rf(nen1, "VALID", cs1, { daDangKy: true, luc: NGOAI_TRUOC });
  await rf(nen1, "VALID", cs1, { daDangKy: true, xoaMem: true });

  // sổ
  await themDongSo({ ...cs1, campaignId: x.campaign.id, vai: "AFFILIATE", nguoiId: p1.id, ten: p1.name, amount: 100_000, payout: "PENDING" });
  await themDongSo({ ...cs1, campaignId: x.campaign.id, vai: "SALE", nguoiId: s.k1.sale.id, ten: "Sale CS1", amount: 50_000, payout: "PAID" });
  await themDongSo({ ...cs2, campaignId: x.campaign.id, vai: "AFFILIATE", nguoiId: p2.doiTac.id, ten: p2.doiTac.name, amount: 200_000, payout: "APPROVED" });
  await themDongSo({ ...cs1, campaignId: y.campaign.id, vai: "AFFILIATE", nguoiId: p1.id, ten: p1.name, amount: 7_000, payout: "PENDING" });
  return { s, x, y, p1, p2: p2.doiTac };
}

describe.skipIf(!RUN_DB_TESTS)("[AFR-DB] báo cáo hiệu quả campaign — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["HO_ACCOUNTANT", "CENTER_SALES_CSM", "CENTER_MANAGER"] });
  }, 180_000);

  afterAll(async () => {
    await donKichBan(cuaToi);
    await donAffiliateFx();
  }, 180_000);

  it("[AFR-DB-10] phễu đầy đủ cho Kế toán HO: lượt bấm · referral theo trạng thái · hợp lệ · đã đăng ký · hoa hồng theo trạng thái chi", async () => {
    const f = await dungPheu();
    const ho = (await nguoiKyHo()).quyen;
    const bc = await docBaoCaoHieuQua(ho, { campaignId: f.x.campaign.id, campaignMa: f.x.campaign.code, khoang: KHOANG_10, quyen: TAT_CA_QUYEN });

    expect(bc.luotBam).toMatchObject({ tong: 11, hopLe: 9, khongDung: 2 });
    expect(bc.luotBam!.theoLyDo).toEqual([{ ma: "LINK_DA_THU_HOI", nhan: "Link đã bị thu hồi.", n: 2 }]);
    // trong khoảng: VALID = 3 (CS1) + 2 (CS2) + 1 (NULL) + 1 (lead xoá mềm, vẫn là referral hợp lệ) = 7 ; MANUAL 1 ; REJECTED 1
    expect(bc.referral).toMatchObject({ tong: 10, phamVi: "TAT_CA" });
    expect(bc.referral!.theoTrangThai).toMatchObject({ VALID: 7, MANUAL_REVIEW: 1, REJECTED: 1, REJECTED_DUPLICATE: 1, DISPUTED: 0 });
    // đã đăng ký = VALID ∧ lead đã chốt ∧ lead CHƯA xoá mềm, trong khoảng: CS1 2 + CS2 1 + NULL 1 = 4 (lead xoá mềm và dòng ngày 15/09 không tính)
    expect(bc.referral!.daDangKy).toBe(4);
    expect(bc.hoaHong!.phamVi).toBe("TAT_CA");
    expect(bc.hoaHong!.tong).toEqual({ soDong: 3, tien: 350_000 });
    expect(bc.hoaHong!.theoTrangThai).toMatchObject({ PENDING: { soDong: 1, tien: 100_000 }, PAID: { soDong: 1, tien: 50_000 }, APPROVED: { soDong: 1, tien: 200_000 }, EXPORTED: { soDong: 0, tien: 0 } });
    // bảng đối tác
    const d1 = bc.doiTac.dong.find((d) => d.partyId === f.p1.id)!;
    const d2 = bc.doiTac.dong.find((d) => d.partyId === f.p2.id)!;
    expect(d1).toMatchObject({ luotBam: 5, luotBamLoi: 2, daDangKy: 3, hoaHong: { soDong: 1, tien: 100_000 } });
    expect(d1.referral).toMatchObject({ VALID: 5, MANUAL_REVIEW: 1, REJECTED: 1 });
    expect(d2).toMatchObject({ luotBam: 4, daDangKy: 1, hoaHong: { soDong: 1, tien: 200_000 } }); // daDangKy của p2 = 1: referral REJECTED_DUPLICATE trỏ lead đã chốt KHÔNG được cộng
    expect(d2.referral).toMatchObject({ VALID: 2, REJECTED_DUPLICATE: 1 });
  });

  it("[AFR-DB-11] khoảng ngày NỬA MỞ theo giờ VN: 23:59:59 VN ngày cuối ở TRONG, 00:00 VN ngày kế ở NGOÀI; lượt ngoài khoảng không đếm", async () => {
    const f = await dungPheu();
    const ho = (await nguoiKyHo()).quyen;
    const chiX = { campaignId: f.x.campaign.id, campaignMa: f.x.campaign.code, quyen: { luotBam: true, referral: true, hoaHong: false } } as const;
    const truoc = await docBaoCaoHieuQua(ho, { ...chiX, khoang: KHOANG_10 });
    const them = [
      new Date("2026-10-31T16:59:59.000Z"), // 23:59:59 ngày 31/10 giờ VN — TRONG
      new Date("2026-10-31T17:00:00.000Z"), // 00:00 ngày 01/11 giờ VN — NGOÀI
      new Date("2026-09-30T17:00:00.000Z"), // 00:00 ngày 01/10 giờ VN — TRONG
      new Date("2026-09-30T16:59:59.000Z"), // 23:59:59 ngày 30/09 giờ VN — NGOÀI
    ];
    for (const luc of them) await taoClick({ assetId: f.x.asset.id, campaignId: f.x.campaign.id, partyId: f.p1.id, outcome: "OK", luc });
    const sau = await docBaoCaoHieuQua(ho, { ...chiX, khoang: KHOANG_10 });
    // chỉ HAI trong bốn lượt mới (cuối + đầu) nằm trong khoảng
    expect(sau.luotBam!.hopLe - truoc.luotBam!.hopLe).toBe(2);
    // khoảng tháng 9: 3 lượt cũ (15/09) + lượt 23:59:59 ngày 30/09
    const t9 = await docBaoCaoHieuQua(ho, { ...chiX, khoang: giaiKhoangNgay({ tu: "2026-09-01", den: "2026-09-30", now: NOW_BC }) });
    expect(t9.luotBam!.hopLe).toBe(3 + 1);
    expect(t9.referral!.theoTrangThai.VALID).toBe(1); // referral VALID ngày 15/09
  });

  it("[AFR-DB-12] CÁCH LY: QLCS CS1 chỉ thấy CS1 (không CS2, không dòng NULL), phamVi GIOI_HAN; lượt bấm vẫn toàn hệ; HO thấy tất cả", async () => {
    const f = await dungPheu();
    const ho = (await nguoiKyHo()).quyen;
    const ql1 = (await nguoiKyQlcs(f.s.k1)).quyen;
    const dau = { campaignId: f.x.campaign.id, campaignMa: f.x.campaign.code, khoang: KHOANG_10, quyen: TAT_CA_QUYEN } as const;
    const bHo = await docBaoCaoHieuQua(ho, dau);
    const bQl = await docBaoCaoHieuQua(ql1, dau);
    expect(bQl.referral!.phamVi).toBe("GIOI_HAN");
    // CS1 trong khoảng: VALID×4 (3 + 1 lead xoá mềm) + MANUAL + REJECTED; không có dòng ngoài khoảng, không CS2, không NULL
    expect(bQl.referral!.theoTrangThai).toMatchObject({ VALID: 4, MANUAL_REVIEW: 1, REJECTED: 1, REJECTED_DUPLICATE: 1 });
    expect(bQl.referral!.tong).toBe(7);
    expect(bQl.referral!.daDangKy).toBe(2);
    // đối chứng dương: HO thấy đúng phần nhiều hơn là CS2 (2 VALID) + NULL (1 VALID)
    expect(bHo.referral!.theoTrangThai.VALID).toBe(bQl.referral!.theoTrangThai.VALID + 2 + 1);
    expect(bHo.referral!.daDangKy).toBe(bQl.referral!.daDangKy + 1 + 1);
    // lượt bấm KHÔNG theo cơ sở — cùng số cho hai người xem
    expect(bQl.luotBam).toEqual(bHo.luotBam);
    // hoa hồng: QLCS chỉ thấy dòng CS1
    expect(bQl.hoaHong!.phamVi).toBe("GIOI_HAN");
    expect(bQl.hoaHong!.tong).toEqual({ soDong: 2, tien: 150_000 });
    // bảng đối tác của QLCS không có số referral / tiền của p2 (hoạt động referral của p2 ở CS2)
    const d2 = bQl.doiTac.dong.find((d) => d.partyId === f.p2.id);
    expect(d2?.referral.VALID ?? 0).toBe(0);
    expect(d2?.hoaHong?.tien ?? 0).toBe(0);
  });

  it("[AFR-DB-13] số hoa hồng ≡ số màn Sổ cho CÙNG bộ lọc campaign (tổng, số dòng, từng trạng thái chi) ở HO và QLCS; bảng đối tác Σ ≤ tổng; không phụ thuộc khoảng ngày", async () => {
    const f = await dungPheu();
    const ho = (await nguoiKyHo()).quyen;
    const ql1 = (await nguoiKyQlcs(f.s.k1)).quyen;
    for (const actor of [ho, ql1]) {
      const bc = await docBaoCaoHieuQua(actor, { campaignId: f.x.campaign.id, campaignMa: f.x.campaign.code, khoang: KHOANG_10, quyen: TAT_CA_QUYEN });
      const so = await docSoHoaHong(db, actor, { campaignMa: f.x.campaign.code, coTrang: 200 });
      expect(bc.hoaHong!.tong).toEqual({ soDong: so.tongSo, tien: so.tongTien });
      for (const tt of ["PENDING", "APPROVED", "EXPORTED", "PAID"] as const) {
        const rieng = await docSoHoaHong(db, actor, { campaignMa: f.x.campaign.code, trangThaiChi: tt, coTrang: 200 });
        expect(bc.hoaHong!.theoTrangThai[tt], tt).toEqual({ soDong: rieng.tongSo, tien: rieng.tongTien });
      }
      const tongDoiTac = bc.doiTac.dong.reduce((n, d) => n + (d.hoaHong?.tien ?? 0), 0);
      expect(tongDoiTac).toBeLessThanOrEqual(so.tongTien);
    }
    // hoa hồng KHÔNG theo khoảng ngày: đổi sang tháng 3 thì lượt bấm / referral về 0 còn hoa hồng y nguyên
    const xa = await docBaoCaoHieuQua(ho, { campaignId: f.x.campaign.id, campaignMa: f.x.campaign.code, khoang: giaiKhoangNgay({ tu: "2026-03-01", den: "2026-03-05", now: NOW_BC }), quyen: TAT_CA_QUYEN });
    expect(xa.hoaHong!.tong).toEqual({ soDong: 3, tien: 350_000 });
    expect(xa.referral!.tong).toBe(0);
    expect(xa.luotBam!.tong).toBe(0);
  });

  it("[AFR-DB-14] cổng quyền: thiếu khoá ⇒ khối null và KHÔNG có số trong bảng đối tác; người không có khoá hoa hồng ⇒ hoaHong null (không ném)", async () => {
    const f = await dungPheu();
    const ho = (await nguoiKyHo()).quyen;
    const dau = { campaignId: f.x.campaign.id, campaignMa: f.x.campaign.code, khoang: KHOANG_10 } as const;

    const khongGi = await docBaoCaoHieuQua(ho, { ...dau, quyen: { luotBam: false, referral: false, hoaHong: false } });
    expect([khongGi.luotBam, khongGi.referral, khongGi.hoaHong]).toEqual([null, null, null]);
    expect(khongGi.doiTac.dong).toEqual([]);

    const chiBam = await docBaoCaoHieuQua(ho, { ...dau, quyen: { luotBam: true, referral: false, hoaHong: false } });
    expect(chiBam.luotBam!.tong).toBe(11);
    expect(chiBam.referral).toBeNull();
    expect(chiBam.hoaHong).toBeNull();
    const d1 = chiBam.doiTac.dong.find((d) => d.partyId === f.p1.id)!;
    expect(d1.luotBam).toBe(5);
    expect(d1.referral.VALID).toBe(0); // không truy vấn referral ⇒ không có số, KHÔNG lẫn vào
    expect(d1.hoaHong).toBeNull(); // null = không xem được, KHÁC {0 đồng}

    const chiReferral = await docBaoCaoHieuQua(ho, { ...dau, quyen: { luotBam: false, referral: true, hoaHong: false } });
    expect(chiReferral.luotBam).toBeNull();
    expect(chiReferral.referral!.tong).toBe(10);

    // người KHÔNG có khoá hoa hồng nào (phụ huynh) mà trang vẫn truyền hoaHong:true ⇒ khối null, không ném PermissionError
    const ph = await seedUser({ email: `afrx-ph-${Date.now().toString(36)}@ci.test`, role: "PARENT", name: "PH AFRX", phone: null });
    const actorPh = await actorCua(ph.id);
    const kq = await docBaoCaoHieuQua(actorPh, { ...dau, quyen: { luotBam: false, referral: false, hoaHong: true } });
    expect(kq.hoaHong).toBeNull();
  });

  it("[AFR-DB-15] KHÔNG PII: JSON báo cáo không chứa tên/SĐT/email khách, SĐT/email đối tác, token link", async () => {
    const f = await dungPheu();
    const ho = (await nguoiKyHo()).quyen;
    const bc = await docBaoCaoHieuQua(ho, { campaignId: f.x.campaign.id, campaignMa: f.x.campaign.code, khoang: KHOANG_10, quyen: TAT_CA_QUYEN });
    const json = JSON.stringify(bc);
    expect(json.length).toBeGreaterThan(200); // đối chứng dương: báo cáo có thật, không rỗng
    for (const cam of [KHACH.ten, KHACH.sdt, KHACH.sdt84, KHACH.email, "0988777666", "afrx.example.com", f.x.token, f.x.asset.id]) expect(json, cam).not.toContain(cam);
    // đối chứng dương: tên đối tác (được phép) CÓ mặt
    expect(json).toContain(f.p1.name);
  });

  it("[AFR-DB-16] campaign khác không lọt vào: lượt bấm / sổ của campaign Y không cộng vào X", async () => {
    const f = await dungPheu();
    const ho = (await nguoiKyHo()).quyen;
    const bx = await docBaoCaoHieuQua(ho, { campaignId: f.x.campaign.id, campaignMa: f.x.campaign.code, khoang: KHOANG_10, quyen: TAT_CA_QUYEN });
    const by = await docBaoCaoHieuQua(ho, { campaignId: f.y.campaign.id, campaignMa: f.y.campaign.code, khoang: KHOANG_10, quyen: TAT_CA_QUYEN });
    expect(by.luotBam).toMatchObject({ tong: 9, hopLe: 9 });
    expect(by.hoaHong!.tong).toEqual({ soDong: 1, tien: 7_000 });
    expect(by.referral!.tong).toBe(0);
    expect(bx.luotBam!.tong).toBe(11);
    expect(bx.hoaHong!.tong.tien).toBe(350_000);
  });
});
