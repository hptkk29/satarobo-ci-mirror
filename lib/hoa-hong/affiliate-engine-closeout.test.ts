// @vitest-environment node
/**
 * [L2-EN-*] — ENGINE: cửa sổ bảo vệ của campaign thay cửa sổ ghi công của nguồn cho vai AFFILIATE (AFF-L2, D-A). THUẦN — `tinhDongChoKhoan`, không DB, không đồng hồ.
 *
 *   [L2-EN-01] referral còn được campaign bảo vệ, khoản về NGOÀI cửa sổ nguồn, rule thắng là rule CAMPAIGN ⇒ VẪN ghi dòng AFFILIATE; `mienCuaSoNguon` nói đúng vai
 *   [L2-EN-02] ĐỐI CHỨNG: cùng đầu vào nhưng campaign KHÔNG bảo vệ ⇒ vai AFFILIATE treo `NGOAI_CUA_SO`, 0 dòng
 *   [L2-EN-03] chính sách YÊU CẦU tường minh cửa sổ nguồn (`dungCuaSoNguon`) ⇒ KHÔNG thoát
 *   [L2-EN-04] rule thắng KHÔNG phải rule CAMPAIGN (GLOBAL · AFFILIATE) ⇒ KHÔNG thoát; rule CAMPAIGN của campaign KHÁC không khớp nên cũng không
 *   [L2-EN-05] chỉ vai AFFILIATE thoát: vai thu hút khác (REFERRER_PARENT) vẫn bị cửa sổ nguồn; vai SALE không đổi
 *   [L2-EN-06] khoản TRONG cửa sổ nguồn ⇒ không có gì để thoát: `mienCuaSoNguon` rỗng và kết quả y hệt `baoVeCampaign = false`
 */
import { describe, expect, it } from "vitest";

import { THU_TU_PHAM_VI_MAC_DINH, type QuyTac } from "./chon-quy-tac";
import type { HoaHongContext } from "./kieu";
import type { KetQuaNguoiHuong } from "./nguoi-huong";
import { tinhDongChoKhoan, type DauVaoKhoan } from "./tinh-dong-cho-khoan";
import { MASTER_VAI_HUONG } from "./vai-huong";

const RATE_DATE = new Date("2026-12-20T03:00:00.000Z");
let dem = 0;

function rule(roleCode: string, rate: number, p: Partial<QuyTac> = {}): QuyTac {
  dem += 1;
  return {
    ruleId: `r${dem}`,
    policyId: "pol-1",
    policyCode: "SR.QD.1",
    versionId: "v1",
    version: 1,
    documentNumber: "SR.QD.1",
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

const ruleCampaign = (roleCode: string, rate: number, campaignId: string, p: Partial<QuyTac> = {}): QuyTac =>
  rule(roleCode, rate, { scopeType: "CAMPAIGN", scopeKey: `CAMPAIGN:${campaignId}`, scope: { campaignId }, ...p });

const VAI = MASTER_VAI_HUONG.map((v) => ({ code: v.code, resolverType: v.resolverType, resolverKey: v.resolverKey, isAcquisition: v.isAcquisition, isActive: true }));

const hh = (quyTac: QuyTac[]): HoaHongContext => ({
  quyTac,
  nhomNguon: [{ id: "g1", code: "PARTNER", coHoaHong: true }],
  vaiHuong: VAI,
  thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH],
  phienBanThuTu: "v1",
  tranTongTiLe: 0.09,
  vatTheoNgay: [],
});

const nguoiUser = (id: string): KetQuaNguoiHuong => ({ loai: "CO_NGUOI", nguoi: [{ kind: "USER", id }], biLoai: [], canCu: "test" });
const doiTac = (id: string): KetQuaNguoiHuong => ({ loai: "CO_NGUOI", nguoi: [{ kind: "AFFILIATE", id }], biLoai: [], canCu: "AFFILIATE" });

function dau(quyTac: QuyTac[], p: Partial<DauVaoKhoan> = {}): DauVaoKhoan {
  return {
    hoaHong: hh(quyTac),
    loaiGiaoDich: "NEW",
    coSo: 10_000_000,
    rateDate: RATE_DATE,
    orgUnitPath: "/ho/danang/cs1/",
    nguon: { sourceGroupId: "g1", coHoaHong: true, affiliateId: "a1", sourceId: null, campaignId: "c1", eventId: null },
    nguoiHuong: new Map<string, KetQuaNguoiHuong>([
      ["SALE", nguoiUser("u-sale")],
      ["AFFILIATE", doiTac("a1")],
    ]),
    roleDefIdsTheoNguoi: new Map(),
    ngoaiCuaSo: true,
    daTraBangEngineCu: new Set(),
    baoVeCampaign: true,
    lanMua: { laKhoanDau: true, coSoGoc: p.coSo ?? 10_000_000 },
    ...p,
  };
}

const ok = (r: ReturnType<typeof tinhDongChoKhoan>) => {
  if (r.loai !== "OK") throw new Error(`Mong OK, nhận ${r.loai}`);
  return r;
};
const tien = (r: ReturnType<typeof tinhDongChoKhoan>) => Object.fromEntries(ok(r).dong.map((d) => [`${d.roleCode}:${d.beneficiaryId}`, d.amount]));
const treoAff = (r: ReturnType<typeof tinhDongChoKhoan>) => ok(r).treo.find((t) => t.roleCode === "AFFILIATE");

const SALE4 = () => rule("SALE", 0.04);

describe("[L2-EN-01] campaign còn bảo vệ ⇒ AFFILIATE thoát cửa sổ nguồn", () => {
  it("khoản NGOÀI cửa sổ nguồn + rule CAMPAIGN 3% thắng ⇒ dòng AFFILIATE 300.000 (SALE 400.000 giữ nguyên), `mienCuaSoNguon = [AFFILIATE]`", () => {
    const r = tinhDongChoKhoan(dau([SALE4(), ruleCampaign("AFFILIATE", 0.03, "c1")]));
    expect(tien(r)).toEqual({ "SALE:u-sale": 400_000, "AFFILIATE:a1": 300_000 });
    expect(ok(r).mienCuaSoNguon).toEqual(["AFFILIATE"]);
    expect(treoAff(r)).toBeUndefined();
  });
});

describe("[L2-EN-02] đối chứng: không được campaign bảo vệ ⇒ cửa sổ nguồn vẫn vô hiệu", () => {
  it("cùng đầu vào nhưng `baoVeCampaign = false` ⇒ AFFILIATE treo NGOAI_CUA_SO, 0 dòng, `mienCuaSoNguon` rỗng", () => {
    const r = tinhDongChoKhoan(dau([SALE4(), ruleCampaign("AFFILIATE", 0.03, "c1")], { baoVeCampaign: false }));
    expect(tien(r)).toEqual({ "SALE:u-sale": 400_000 });
    expect(treoAff(r)?.lyDo).toBe("NGOAI_CUA_SO");
    expect(ok(r).mienCuaSoNguon).toEqual([]);
  });
});

describe("[L2-EN-03] chính sách yêu cầu tường minh cửa sổ nguồn", () => {
  it("rule CAMPAIGN có `dungCuaSoNguon = true` ⇒ KHÔNG thoát dù campaign bảo vệ; bỏ cờ đi thì thoát (đối chứng dương)", () => {
    const yeuCau = tinhDongChoKhoan(dau([SALE4(), ruleCampaign("AFFILIATE", 0.03, "c1", { dungCuaSoNguon: true })]));
    expect(treoAff(yeuCau)?.lyDo).toBe("NGOAI_CUA_SO");
    expect(ok(yeuCau).mienCuaSoNguon).toEqual([]);
    const khongYeuCau = tinhDongChoKhoan(dau([SALE4(), ruleCampaign("AFFILIATE", 0.03, "c1", { dungCuaSoNguon: false })]));
    expect(tien(khongYeuCau)["AFFILIATE:a1"]).toBe(300_000);
  });
});

describe("[L2-EN-04] rule thắng phải là rule CAMPAIGN của ĐÚNG campaign", () => {
  it("chỉ có rule GLOBAL cho AFFILIATE ⇒ KHÔNG thoát (đó không phải chính sách của campaign)", () => {
    const r = tinhDongChoKhoan(dau([SALE4(), rule("AFFILIATE", 0.01)]));
    expect(treoAff(r)?.lyDo).toBe("NGOAI_CUA_SO");
    expect(ok(r).mienCuaSoNguon).toEqual([]);
  });
  it("rule phạm vi AFFILIATE (đối tác) thắng rule CAMPAIGN ⇒ rule thắng không phải CAMPAIGN ⇒ KHÔNG thoát", () => {
    const rAff = rule("AFFILIATE", 0.04, { scopeType: "AFFILIATE", scopeKey: "AFFILIATE:a1", scope: { affiliateId: "a1" } });
    const r = tinhDongChoKhoan(dau([SALE4(), ruleCampaign("AFFILIATE", 0.03, "c1"), rAff]));
    expect(treoAff(r)?.lyDo).toBe("NGOAI_CUA_SO");
  });
  it("chỉ có rule CAMPAIGN của campaign KHÁC (c2) ⇒ không khớp khoản (campaign c1) ⇒ không rule nào ⇒ không dòng AFFILIATE", () => {
    const r = tinhDongChoKhoan(dau([SALE4(), ruleCampaign("AFFILIATE", 0.03, "c2")]));
    expect(tien(r)).toEqual({ "SALE:u-sale": 400_000 });
    expect(ok(r).mienCuaSoNguon).toEqual([]);
  });
});

describe("[L2-EN-05] chỉ vai AFFILIATE thoát", () => {
  it("vai thu hút KHÁC (REFERRER_PARENT) cùng khoản vẫn treo NGOAI_CUA_SO; SALE (không thu hút) không đổi", () => {
    const nguoi = new Map<string, KetQuaNguoiHuong>([
      ["SALE", nguoiUser("u-sale")],
      ["AFFILIATE", doiTac("a1")],
      ["REFERRER_PARENT", nguoiUser("u-ph")],
    ]);
    // rule của REFERRER_PARENT CŨNG là rule CAMPAIGN của đúng campaign này — vậy mà vai ấy vẫn không thoát: chỉ vai đối tác (resolverKey AFFILIATE) được miễn, không phải mọi vai thu hút có rule campaign.
    const r = tinhDongChoKhoan(dau([SALE4(), ruleCampaign("AFFILIATE", 0.03, "c1"), ruleCampaign("REFERRER_PARENT", 0.02, "c1")], { nguoiHuong: nguoi }));
    expect(tien(r)).toEqual({ "SALE:u-sale": 400_000, "AFFILIATE:a1": 300_000 });
    expect(ok(r).treo.find((t) => t.roleCode === "REFERRER_PARENT")?.lyDo).toBe("NGOAI_CUA_SO");
    expect(ok(r).mienCuaSoNguon).toEqual(["AFFILIATE"]);
  });
});

describe("[L2-EN-06] KHÔNG đổi khi không có gì để thoát", () => {
  it("khoản TRONG cửa sổ nguồn: kết quả y hệt nhau dù `baoVeCampaign` đúng hay sai; `mienCuaSoNguon` rỗng", () => {
    const quyTac = () => [SALE4(), ruleCampaign("AFFILIATE", 0.03, "c1")];
    const a = ok(tinhDongChoKhoan(dau(quyTac(), { ngoaiCuaSo: false, baoVeCampaign: true })));
    const b = ok(tinhDongChoKhoan(dau(quyTac(), { ngoaiCuaSo: false, baoVeCampaign: false })));
    expect(a.mienCuaSoNguon).toEqual([]);
    expect(a.dong.map((d) => [d.roleCode, d.amount])).toEqual(b.dong.map((d) => [d.roleCode, d.amount]));
    expect(a.dong.find((d) => d.roleCode === "AFFILIATE")?.amount).toBe(300_000);
  });
  it("nguồn KHÔNG RÕ (sourceGroupId null) ⇒ không thoát (campaign không có tác dụng ở đường nguồn không rõ)", () => {
    const r = tinhDongChoKhoan(dau([SALE4(), ruleCampaign("AFFILIATE", 0.03, "c1")], { nguon: { sourceGroupId: null, coHoaHong: false, affiliateId: "a1", sourceId: null, campaignId: "c1", eventId: null } }));
    expect(ok(r).mienCuaSoNguon).toEqual([]);
  });
});
