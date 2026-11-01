// @vitest-environment node
/**
 * [L2-HASH-*] — ĐỐI CHỨNG BĂM "KHÔNG ĐỔI KHI DỮ LIỆU AFFILIATE TRỐNG" (AFF-L2). THUẦN — không DB, không đồng hồ.
 *
 * Băm đầu vào (`hashCuaKetQua`) là thứ làm lượt quét thấy "đầu vào đổi" (INPUT_DRIFT). AFF-L2 chạm lõi tiền (cửa sổ bảo vệ campaign, loại người hưởng, bảng EXPECTED của so bóng) nên phải chứng minh:
 * với MỌI khoản KHÔNG đến từ campaign Affiliate, băm Y HỆT trước AFF-L2 — nếu không, mọi ô đã khớp thành drift giả ngay sau deploy.
 *
 * GOLDEN: các chuỗi bên dưới được IN ra từ mã của `origin/test` (4975cc6af, TRƯỚC AFF-L2) bằng đúng hàm và đúng đầu vào ở đây, rồi dán vào. Test này xanh trên cả hai nhánh iff băm không đổi.
 * Đầu vào dựng thuần (không DB) nên tái lập được ở bất kỳ máy nào.
 *
 *   [L2-HASH-01] sáu khoản KHÔNG campaign (NEW đủ vai · RENEWAL không rule · nguồn không rõ · ngoài cửa sổ · đã trả bằng engine cũ · vượt trần) ⇒ băm = golden
 *   [L2-HASH-02] khoản CÓ campaign mà KHÔNG vai nào thoát cửa sổ nguồn ⇒ băm = golden (chỉ khác khoản không campaign ở khoá `camp`, như AFF-P2)
 *   [L2-HASH-03] khoản có vai thoát cửa sổ nguồn ⇒ băm KHÁC (vai đổi TREO → SINH_DONG nên `vai[].tt`/`phan` đã đổi băm — KHÔNG cần khoá riêng; xem notes §8); đối chứng dương cho [L2-HASH-02]
 *   [L2-HASH-04] băm KHÔNG chứa cấu hình campaign (`updatedAt`, `protectWindowDays`…): chỉ vào `resolverBasis`, không vào băm
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { BoiCanhQuet } from "./boi-canh";
import { THU_TU_PHAM_VI_MAC_DINH, type QuyTac } from "./chon-quy-tac";
import type { HoaHongContext } from "./kieu";
import type { KetQuaNguoiHuong } from "./nguoi-huong";
import { hashCuaKetQua, type KeHoachThu } from "./quet-khoan";
import { tinhDongChoKhoan, type DauVaoKhoan } from "./tinh-dong-cho-khoan";
import { MASTER_VAI_HUONG } from "./vai-huong";

const RATE_DATE = new Date("2026-10-20T03:00:00.000Z");
let dem = 0;
function rule(roleCode: string, rate: number, p: Partial<QuyTac> = {}): QuyTac {
  dem += 1;
  return {
    ruleId: `r${dem}`,
    policyId: "pol-v1",
    policyCode: "SR.QD.208",
    versionId: "v1",
    version: 1,
    documentNumber: "SR.QD.208",
    scopeType: "GLOBAL",
    scopeKey: "GLOBAL",
    scope: {},
    orgUnitId: null,
    orgUnitPath: "/",
    orgUnitDepth: -1,
    transactionType: "NEW",
    roleCode,
    revenueComponent: "TUITION",
    kieuTinh: "PERCENT",
    giaTri: rate,
    effectiveFrom: new Date("2026-03-01T00:00:00.000Z"),
    effectiveTo: null,
    trangThai: "ACTIVE",
    ...p,
  };
}

const VAI = MASTER_VAI_HUONG.map((v) => ({ code: v.code, resolverType: v.resolverType, resolverKey: v.resolverKey, isAcquisition: v.isAcquisition, isActive: true }));
const SEED_V1 = (): QuyTac[] => [rule("SALE", 0.04), rule("SALE_ADMIN", 0.01), rule("CENTER_MANAGER", 0.02), rule("MARKETING", 0.01), rule("TRIAL_TEACHER", 0.01)];
const hh = (quyTac: QuyTac[], tran = 0.09): HoaHongContext => ({
  quyTac,
  nhomNguon: [
    { id: "g1", code: "PARENT_REFERRAL", coHoaHong: true },
    { id: "g2", code: "PAID_ADS", coHoaHong: true },
  ],
  vaiHuong: VAI,
  thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH],
  phienBanThuTu: "v1",
  tranTongTiLe: tran,
  vatTheoNgay: [],
});
const co = (ids: string[]): KetQuaNguoiHuong => ({ loai: "CO_NGUOI", nguoi: ids.map((id) => ({ kind: "USER" as const, id })), biLoai: [], canCu: "test" });
const NGUOI = (): Record<string, KetQuaNguoiHuong> => ({ SALE: co(["u-sale"]), SALE_ADMIN: co(["u-admin"]), CENTER_MANAGER: co(["u-ql"]), MARKETING: co(["u-qc"]), TRIAL_TEACHER: co(["u-gv"]) });

function dau(p: Partial<DauVaoKhoan> & { quyTac?: QuyTac[]; tran?: number; nguoi?: Record<string, KetQuaNguoiHuong> } = {}): DauVaoKhoan {
  const { quyTac, tran, nguoi, ...conLai } = p;
  return {
    hoaHong: hh(quyTac ?? SEED_V1(), tran),
    loaiGiaoDich: "NEW",
    coSo: 10_000_000,
    rateDate: RATE_DATE,
    orgUnitPath: "/ho/danang/cs1/",
    nguon: { sourceGroupId: "g1", coHoaHong: true, affiliateId: null, sourceId: null, campaignId: null, eventId: null },
    nguoiHuong: new Map(Object.entries(nguoi ?? NGUOI())),
    roleDefIdsTheoNguoi: new Map(),
    ngoaiCuaSo: false,
    daTraBangEngineCu: new Set(),
    baoVeCampaign: false,
    lanMua: { laKhoanDau: true, coSoGoc: conLai.coSo ?? 10_000_000 },
    ...conLai,
  };
}

/** Chỉ những trường `hashCuaKetQua` ĐỌC. */
function keHoach(d: DauVaoKhoan): KeHoachThu {
  return {
    vat: { grossAmount: d.coSo, vatRate: 0, netBase: d.coSo },
    loaiGiaoDich: d.loaiGiaoDich,
    studentId: "s1",
    orderItemId: "oi1",
    nguonChinhSach: d.nguon,
    nguon: { attributionId: "at1" },
    ngoaiCuaSo: d.ngoaiCuaSo,
    daTraBangEngineCu: d.daTraBangEngineCu,
  } as unknown as KeHoachThu;
}
const bc = (d: DauVaoKhoan) => ({ hoaHong: { tranTongTiLe: d.hoaHong.tranTongTiLe, phienBanThuTu: d.hoaHong.phienBanThuTu } }) as unknown as BoiCanhQuet;
const bam = (d: DauVaoKhoan): string => hashCuaKetQua(keHoach(d), bc(d), d.coSo, tinhDongChoKhoan(d));

const ruleCampaign = (roleCode: string, rate: number, campaignId: string): QuyTac => rule(roleCode, rate, { scopeType: "CAMPAIGN", scopeKey: `CAMPAIGN:${campaignId}`, scope: { campaignId } });
const doiTac = (id: string): KetQuaNguoiHuong => ({ loai: "CO_NGUOI", nguoi: [{ kind: "AFFILIATE" as const, id }], biLoai: [], canCu: "AFFILIATE" });
const NGUON_C1 = { sourceGroupId: "g1", coHoaHong: true, affiliateId: "a1", sourceId: null, campaignId: "c1", eventId: null };
/** Bộ rule DỰNG MỘT LẦN: `ruleId` nằm trong băm, nên dựng lại mỗi lần gọi là băm khác chỉ vì bộ đếm `dem` — không phải vì mã đổi. */
let QUY_TAC_CAMPAIGN: QuyTac[] | null = null;
const CAMPAIGN_AFF = (p: Partial<DauVaoKhoan> = {}): DauVaoKhoan =>
  dau({ quyTac: (QUY_TAC_CAMPAIGN ??= [rule("SALE", 0.04), ruleCampaign("AFFILIATE", 0.03, "c1")]), nguoi: { SALE: co(["u-sale"]), AFFILIATE: doiTac("a1") }, nguon: NGUON_C1, ...p });

const KHONG_CAMPAIGN: Record<string, DauVaoKhoan> = {
  "01-NEW-du-vai": dau(),
  "02-RENEWAL-khong-rule": dau({ loaiGiaoDich: "RENEWAL" }),
  "03-nguon-khong-ro": dau({ nguon: { sourceGroupId: null, coHoaHong: false, affiliateId: null, sourceId: null, campaignId: null, eventId: null } }),
  "04-ngoai-cua-so": dau({ quyTac: [...SEED_V1(), rule("REFERRER_PARENT", 0.02)], nguoi: { ...NGUOI(), REFERRER_PARENT: co(["u-ph"]) }, ngoaiCuaSo: true }),
  "05-da-tra-engine-cu": dau({ daTraBangEngineCu: new Set(["u-gv"]) }),
  "06-vuot-tran": dau({ tran: 0.05 }),
};

/** Khoản CÓ campaign nhưng KHÔNG vai nào thoát cửa sổ nguồn (trong cửa sổ · hoặc ngoài cửa sổ mà campaign không bảo vệ). */
const CO_CAMPAIGN_KHONG_THOAT: Record<string, DauVaoKhoan> = {
  "07-campaign-trong-cua-so": CAMPAIGN_AFF(),
  "08-campaign-ngoai-cua-so-khong-bao-ve": CAMPAIGN_AFF({ ngoaiCuaSo: true }),
};

// ⚠️ Dán từ mã origin/test (4975cc6af) — KHÔNG sửa tay cho xanh. Đổi một chuỗi = đổi băm của mọi ô đã khớp trên prod.
const GOLDEN: Record<string, string> = {
  "01-NEW-du-vai": "3a6f5e6a15a158249b81a3506d446092bdcc98cb07cd24e2e24ad80adf9a79a6",
  "02-RENEWAL-khong-rule": "4b5e2fcd45113fd1e724a8295523ecb72a189690a27bef10d8bde3ae3e26dbca",
  "03-nguon-khong-ro": "8fe3df9e7340035019e06e5416607e85bb57fccba69211b7b348fd22394a30f5",
  "04-ngoai-cua-so": "d19e214c1a0b1423aac3c6061ac365178401f3249a0ec3ba44e9b2f743693d8f",
  "05-da-tra-engine-cu": "7550d85f2c4b2969334b5e6e4ba4a968e360622fe5a0e3cf4a7e25a1f00e096e",
  "06-vuot-tran": "1ad156171a2e23becfcf7698b5dd717b3dcb2a508023341e746e51c4866d2602",
  "07-campaign-trong-cua-so": "7df1937934ea1502d93544c0ea4b62aaa985ba027396057435473d6758db2e74",
  "08-campaign-ngoai-cua-so-khong-bao-ve": "ae8c7dd692c0b006871be028e6671612d42c3c7620ed32a32403c1a1d603448e",
};
const TAT_CA: Record<string, DauVaoKhoan> = { ...KHONG_CAMPAIGN, ...CO_CAMPAIGN_KHONG_THOAT };

describe("[L2-HASH-01] khoản KHÔNG campaign: băm Y HỆT trước AFF-L2", () => {
  it("in ra để dán golden (chạy với GOLDEN_OUT=<tệp> để ghi ra tệp)", () => {
    const ra = process.env.GOLDEN_OUT;
    if (!ra) return;
    writeFileSync(ra, JSON.stringify(Object.fromEntries(Object.entries(TAT_CA).map(([k, d]) => [k, bam(d)])), null, 2));
  });
  for (const ten of Object.keys(KHONG_CAMPAIGN)) {
    it(`[L2-HASH-01] ${ten} = golden`, () => {
      expect(bam(KHONG_CAMPAIGN[ten]!)).toBe(GOLDEN[ten]);
    });
  }
  it("đối chứng: golden KHÔNG suy biến — các băm đôi một khác nhau", () => {
    expect(new Set(Object.values(GOLDEN)).size).toBe(Object.keys(GOLDEN).length);
  });
});

describe("[L2-HASH-02] khoản CÓ campaign nhưng không vai nào thoát cửa sổ nguồn: băm Y HỆT trước AFF-L2", () => {
  for (const ten of Object.keys(CO_CAMPAIGN_KHONG_THOAT)) {
    it(`[L2-HASH-02] ${ten} = golden`, () => {
      expect(bam(CO_CAMPAIGN_KHONG_THOAT[ten]!)).toBe(GOLDEN[ten]);
    });
  }
  it("[L2-HASH-02] `baoVeCampaign = true` mà KHÔNG có gì để thoát (khoản trong cửa sổ nguồn) ⇒ băm KHÔNG đổi", () => {
    expect(bam(CAMPAIGN_AFF({ baoVeCampaign: true }))).toBe(GOLDEN["07-campaign-trong-cua-so"]);
  });
});

describe("[L2-HASH-03] có vai thoát cửa sổ nguồn ⇒ băm KHÁC (đối chứng dương)", () => {
  it("ngoài cửa sổ nguồn + campaign bảo vệ ⇒ AFFILIATE thoát ⇒ băm khác cả băm 'không bảo vệ' lẫn băm 'trong cửa sổ'; tất định", () => {
    const thoat = bam(CAMPAIGN_AFF({ ngoaiCuaSo: true, baoVeCampaign: true }));
    expect(thoat).not.toBe(GOLDEN["08-campaign-ngoai-cua-so-khong-bao-ve"]);
    expect(thoat).not.toBe(GOLDEN["07-campaign-trong-cua-so"]);
    expect(bam(CAMPAIGN_AFF({ ngoaiCuaSo: true, baoVeCampaign: true }))).toBe(thoat);
  });
});

describe("[L2-HASH-04] băm KHÔNG chứa cấu hình campaign", () => {
  it("cùng đầu vào, chỉ khác ảnh chụp campaign (updatedAt, protectWindowDays…) ⇒ cùng băm — vì ảnh chụp chỉ nằm trong resolverBasis của dòng", () => {
    const d = CAMPAIGN_AFF({ ngoaiCuaSo: true, baoVeCampaign: true });
    const kq = tinhDongChoKhoan(d);
    const a = hashCuaKetQua({ ...keHoach(d), affiliate: { chup: { updatedAt: new Date("2026-10-01"), protectWindowDays: 90 } } } as unknown as KeHoachThu, bc(d), d.coSo, kq);
    const b = hashCuaKetQua({ ...keHoach(d), affiliate: { chup: { updatedAt: new Date("2026-12-31"), protectWindowDays: 365 } } } as unknown as KeHoachThu, bc(d), d.coSo, kq);
    expect(a).toBe(b);
  });
});
