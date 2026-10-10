// @vitest-environment node
/**
 * [NHH-POL-TT-*] — `tinhChinhSachChoPhan`: ghép chọn quy tắc + người hưởng + trần + chia tiền cho MỘT phần học
 * viên của MỘT khoản (04 §2 bước 7–11). THUẦN. Đây là hàm mà thử tính, "dự kiến" và engine thật (PR5) cùng gọi.
 */
import { describe, it, expect } from "vitest";

import { THU_TU_PHAM_VI_MAC_DINH, type QuyTac } from "./chon-quy-tac";
import type { HoaHongContext } from "./kieu";
import { tinhChinhSachChoPhan, type DauVaoTinhChinhSach } from "./tinh-chinh-sach";
import type { KetQuaNguoiHuong } from "./nguoi-huong";
import { MASTER_VAI_HUONG } from "./vai-huong";

const RATE_DATE = new Date("2026-10-20T03:00:00.000Z");
const CS1 = "/ho/danang/cs1/";
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

const SEED_V1 = (): QuyTac[] => [
  rule("SALE", 0.04),
  rule("SALE_ADMIN", 0.01),
  rule("CENTER_MANAGER", 0.02),
  rule("MARKETING", 0.01),
  rule("TRIAL_TEACHER", 0.01),
];

const VAI = MASTER_VAI_HUONG.map((v) => ({ code: v.code, resolverType: v.resolverType, resolverKey: v.resolverKey, isAcquisition: v.isAcquisition, isActive: true }));

function hh(p: Partial<HoaHongContext> = {}): HoaHongContext {
  return {
    quyTac: SEED_V1(),
    nhomNguon: [
      { id: "g1", code: "PARENT_REFERRAL", coHoaHong: true },
      { id: "g2", code: "PAID_ADS", coHoaHong: true },
    ],
    vaiHuong: VAI,
    thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH],
    phienBanThuTu: "v1",
    tranTongTiLe: 0.09,
    vatTheoNgay: [],
    ...p,
  };
}

const co = (ids: string[], biLoai: string[] = []): KetQuaNguoiHuong => ({
  loai: "CO_NGUOI",
  nguoi: ids.map((id) => ({ kind: "USER" as const, id })),
  biLoai: biLoai.map((id) => ({ nguoi: { kind: "USER" as const, id }, lyDo: "NGUOI_HUONG_NGHI" as const })),
  canCu: "test",
});

const NGUOI_DU = (): Record<string, KetQuaNguoiHuong> => ({
  SALE: co(["u-sale"]),
  SALE_ADMIN: co(["u-admin"]),
  CENTER_MANAGER: co(["u-ql"]),
  MARKETING: co(["u-qc"]),
  TRIAL_TEACHER: co(["u-gv"]),
});

function dau(p: Partial<DauVaoTinhChinhSach> = {}): DauVaoTinhChinhSach {
  return {
    hoaHong: hh(),
    loaiGiaoDich: "NEW",
    coSo: 10_000_000,
    rateDate: RATE_DATE,
    orgUnitPath: CS1,
    nguon: { sourceGroupId: "g1", coHoaHong: true, affiliateId: null, sourceId: null, campaignId: null, eventId: null },
    nguoiHuong: new Map(Object.entries(NGUOI_DU())),
    roleDefIdsTheoNguoi: new Map(),
    ...p,
  };
}

const tien = (r: ReturnType<typeof tinhChinhSachChoPhan>) => {
  if (r.loai !== "OK") throw new Error(`Mong OK, nhận ${r.loai}`);
  return Object.fromEntries(r.cacVai.map((v) => [v.roleCode, v.trangThai === "SINH_DONG" ? v.tienVai : v.trangThai]));
};

describe("[NHH-POL-TT] seed v1 đủ 5 vai", () => {
  it("[NHH-POL-TT-01] cơ sở 10.000.000 ⇒ Sale 400k · Admin 100k · QLCS 200k · MKT 100k · GV 100k (Σ 9% = trần ⇒ qua)", () => {
    const r = tinhChinhSachChoPhan(dau());
    expect(tien(r)).toEqual({ SALE: 400_000, SALE_ADMIN: 100_000, CENTER_MANAGER: 200_000, MARKETING: 100_000, TRIAL_TEACHER: 100_000 });
    if (r.loai === "OK") expect(r.tiLeTuongDuong).toBeCloseTo(0.09, 9);
  });

  it("[NHH-POL-04b] V3b: cơ sở 1.234.550 ⇒ ghi ĐỦ 5 vai dù Σ tiền 111.111đ > 9% × cơ sở (so trên tỉ lệ)", () => {
    const r = tinhChinhSachChoPhan(dau({ coSo: 1_234_550 }));
    expect(tien(r)).toEqual({ SALE: 49_382, SALE_ADMIN: 12_346, CENTER_MANAGER: 24_691, MARKETING: 12_346, TRIAL_TEACHER: 12_346 });
  });

  it("[NHH-POL-TT-02] RENEWAL không có policy ⇒ 5 vai đều KHONG_RULE, 0 dòng (D16); đối chứng NEW cùng dữ liệu ⇒ sinh dòng", () => {
    const r = tinhChinhSachChoPhan(dau({ loaiGiaoDich: "RENEWAL" }));
    expect(Object.values(tien(r))).toEqual(["KHONG_RULE", "KHONG_RULE", "KHONG_RULE", "KHONG_RULE", "KHONG_RULE"]);
    expect(tien(tinhChinhSachChoPhan(dau())).SALE).toBe(400_000);
  });

  it("[NHH-POL-TT-03] Marketing là vai TUỲ CHỌN: bỏ rule Marketing ⇒ không sinh dòng Marketing, bốn vai kia vẫn sinh; KHÔNG ép 0%", () => {
    const r = tinhChinhSachChoPhan(dau({ hoaHong: hh({ quyTac: SEED_V1().filter((q) => q.roleCode !== "MARKETING") }) }));
    const t = tien(r);
    expect(t.MARKETING).toBeUndefined();
    expect(t.SALE).toBe(400_000);
  });
});

describe("[NHH-POL-TT] trần: vượt ⇒ 0 dòng cho CẢ khoản, không tự cắt (D1)", () => {
  const vuot = (): QuyTac[] => [...SEED_V1().filter((q) => q.roleCode !== "TRIAL_TEACHER"), rule("TRIAL_TEACHER", 0.0101)];

  it("[NHH-POL-TT-04] Σ 9,01% ⇒ loai VUOT_TRAN, KHÔNG có dòng vai nào", () => {
    const r = tinhChinhSachChoPhan(dau({ hoaHong: hh({ quyTac: vuot() }) }));
    expect(r.loai).toBe("VUOT_TRAN");
    if (r.loai === "VUOT_TRAN") {
      expect(r.tran).toBe(0.09);
      expect(r.tiLeTuongDuong).toBeCloseTo(0.0901, 6);
      expect(r.quyTacThang.map((q) => q.roleCode).sort()).toEqual(["CENTER_MANAGER", "MARKETING", "SALE", "SALE_ADMIN", "TRIAL_TEACHER"]);
    }
  });

  it("[NHH-POL-TT-05] trần là THAM SỐ của ngữ cảnh: nâng lên 0.10 ⇒ cùng bộ rule qua; hạ xuống 0.08 ⇒ seed v1 cũng vượt", () => {
    expect(tinhChinhSachChoPhan(dau({ hoaHong: hh({ quyTac: vuot(), tranTongTiLe: 0.1 }) })).loai).toBe("OK");
    expect(tinhChinhSachChoPhan(dau({ hoaHong: hh({ tranTongTiLe: 0.08 }) })).loai).toBe("VUOT_TRAN");
  });

  it("[NHH-POL-TT-06] vai TREO (không người) VẪN tính vào trần: trần là luật cấu hình, không đổi theo hôm nay ai nghỉ", () => {
    const nguoi = new Map(Object.entries(NGUOI_DU()));
    nguoi.set("TRIAL_TEACHER", { loai: "TREO", lyDo: "KHONG_CO_GV_TRIAL", canCu: "x" });
    const r = tinhChinhSachChoPhan(dau({ hoaHong: hh({ quyTac: vuot() }), nguoiHuong: nguoi }));
    expect(r.loai).toBe("VUOT_TRAN");
  });
});

describe("[NHH-POL-TT] người hưởng", () => {
  it("[NHH-POL-TT-07] đơn không lead ⇒ Sale/Admin TREO (tiền có, người không): không dòng, ghi lý do; các vai khác vẫn sinh", () => {
    const nguoi = new Map(Object.entries(NGUOI_DU()));
    nguoi.set("SALE", { loai: "TREO", lyDo: "KHONG_CO_LEAD", canCu: "x" });
    nguoi.set("SALE_ADMIN", { loai: "TREO", lyDo: "KHONG_CO_LEAD", canCu: "x" });
    const r = tinhChinhSachChoPhan(dau({ nguoiHuong: nguoi }));
    if (r.loai !== "OK") throw new Error(r.loai);
    const sale = r.cacVai.find((v) => v.roleCode === "SALE")!;
    expect(sale.trangThai).toBe("TREO");
    expect(sale.tienVai).toBe(400_000); // tiền hiện ra để màn hàng chờ nói "treo bao nhiêu"
    expect(sale.lyDoTreo).toBe("KHONG_CO_LEAD");
    expect(r.cacVai.find((v) => v.roleCode === "CENTER_MANAGER")!.trangThai).toBe("SINH_DONG");
  });

  it("[NHH-POL-TT-08] QC hai người chia đều, Σ phần = tiền vai; một người nghỉ ⇒ phần của họ TREO, người còn lại KHÔNG ăn thêm (D13)", () => {
    const nguoi = new Map(Object.entries(NGUOI_DU()));
    nguoi.set("MARKETING", co(["u-a", "u-b"], ["u-b"]));
    const r = tinhChinhSachChoPhan(dau({ coSo: 1_000_001, nguoiHuong: nguoi }));
    if (r.loai !== "OK") throw new Error(r.loai);
    const m = r.cacVai.find((v) => v.roleCode === "MARKETING")!;
    expect(m.tienVai).toBe(10_000); // round(1.000.001 × 1%) = 10.000
    expect(m.duocChi).toEqual([{ recipientId: "u-a", amount: 5_000 }]);
    expect(m.treoPhan).toEqual([{ recipientId: "u-b", amount: 5_000 }]);
  });

  it("[NHH-POL-TT-09] PERSON là chiều của NGƯỜI HƯỞNG: mức riêng cho u-sale thắng GLOBAL; vai khác không bị ảnh hưởng", () => {
    const rules = [...SEED_V1(), rule("SALE", 0.05, { scopeType: "PERSON", scopeKey: "PERSON:u-sale", scope: { userId: "u-sale" } })];
    const r = tinhChinhSachChoPhan(dau({ hoaHong: hh({ quyTac: rules, tranTongTiLe: 0.1 }) }));
    expect(tien(r).SALE).toBe(500_000);
    expect(tien(r).SALE_ADMIN).toBe(100_000);
  });

  it("[NHH-POL-TT-09b] ROLE là chiều của NGƯỜI HƯỞNG qua `roleDefIdsTheoNguoi`: u-sale mang vai rd-1 ⇒ 5%; người khác vai ⇒ GLOBAL 4%", () => {
    // Cấy 08/10 (V10, roleDefIds luôn []): 0 ca đỏ — TT-09 thử PERSON, không ca nào thử ROLE ở tầng ghép.
    const rules = [...SEED_V1(), rule("SALE", 0.05, { scopeType: "ROLE", scopeKey: "ROLE:rd-1", scope: { roleDefId: "rd-1" } })];
    const hhMoi = hh({ quyTac: rules, tranTongTiLe: 0.1 });
    const coVai = tinhChinhSachChoPhan(dau({ hoaHong: hhMoi, roleDefIdsTheoNguoi: new Map([["u-sale", ["rd-1"]]]) }));
    expect(tien(coVai).SALE).toBe(500_000);
    const khacVai = tinhChinhSachChoPhan(dau({ hoaHong: hhMoi, roleDefIdsTheoNguoi: new Map([["u-sale", ["rd-khac"]]]) }));
    expect(tien(khacVai).SALE).toBe(400_000);
    const khongVai = tinhChinhSachChoPhan(dau({ hoaHong: hhMoi }));
    expect(tien(khongVai).SALE).toBe(400_000);
    expect(tien(coVai).SALE_ADMIN).toBe(100_000); // vai khác không bị ảnh hưởng
  });

  it("[NHH-POL-TT-10] vai chưa có kết quả người hưởng trong ngữ cảnh ⇒ ném (không im lặng bỏ vai)", () => {
    const nguoi = new Map(Object.entries(NGUOI_DU()));
    nguoi.delete("SALE");
    expect(() => tinhChinhSachChoPhan(dau({ nguoiHuong: nguoi }))).toThrow(/SALE/);
  });
});

describe("[NHH-POL-TT] nguồn không rõ = mức thấp nhất, và EXCLUDE", () => {
  it("[NHH-POL-TT-11] UNKNOWN: Sale g1 5% / g2 4% ⇒ lấy 4% (nhóm PAID_ADS) trên cơ sở của khoản; lyDo nói rõ nhóm", () => {
    const rules = [
      ...SEED_V1().filter((q) => q.roleCode !== "SALE"),
      rule("SALE", 0.05, { scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g1", scope: { sourceGroupId: "g1" } }),
      rule("SALE", 0.04, { scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g2", scope: { sourceGroupId: "g2" } }),
    ];
    const r = tinhChinhSachChoPhan(dau({ hoaHong: hh({ quyTac: rules, tranTongTiLe: 0.1 }), nguon: { sourceGroupId: null, coHoaHong: true, affiliateId: null, sourceId: null, campaignId: null, eventId: null } }));
    if (r.loai !== "OK") throw new Error(r.loai);
    const s = r.cacVai.find((v) => v.roleCode === "SALE")!;
    expect(s.tienVai).toBe(400_000);
    expect(s.lyDo).toContain("PAID_ADS");
    expect(s.nguonKhongRo).toBe(true);
    // đối chứng: nguồn biết là g1 ⇒ 5%
    const g1 = tinhChinhSachChoPhan(dau({ hoaHong: hh({ quyTac: rules, tranTongTiLe: 0.1 }) }));
    expect(tien(g1).SALE).toBe(500_000);
  });

  it("[NHH-POL-TT-12] EXCLUDE thắng GLOBAL: nhóm 4 không trả Marketing ⇒ KHONG_RULE-kiểu EXCLUDE, 0 dòng; nhóm khác vẫn trả", () => {
    const rules = [...SEED_V1(), rule("MARKETING", 0, { kieuTinh: "EXCLUDE", scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g4", scope: { sourceGroupId: "g4" } })];
    const g4 = tinhChinhSachChoPhan(dau({ hoaHong: hh({ quyTac: rules }), nguon: { sourceGroupId: "g4", coHoaHong: true, affiliateId: null, sourceId: null, campaignId: null, eventId: null } }));
    if (g4.loai !== "OK") throw new Error(g4.loai);
    expect(g4.cacVai.find((v) => v.roleCode === "MARKETING")!.trangThai).toBe("EXCLUDE");
    expect(tien(tinhChinhSachChoPhan(dau({ hoaHong: hh({ quyTac: rules }) }))).MARKETING).toBe(100_000);
  });

  it("[NHH-POL-TT-13] hai rule cùng hạng ⇒ loai CHONG_LAN (POLICY_OVERLAP), 0 dòng", () => {
    const rules = [...SEED_V1(), rule("SALE", 0.05, { policyId: "pol-khac" })];
    const r = tinhChinhSachChoPhan(dau({ hoaHong: hh({ quyTac: rules }) }));
    expect(r.loai).toBe("CHONG_LAN");
    if (r.loai === "CHONG_LAN") expect(r.roleCode).toBe("SALE");
  });

  it("[NHH-POL-TT-14] vai TẮT trong master (isActive=false) bị bỏ qua, không sinh dòng", () => {
    const vai = VAI.map((v) => (v.code === "MARKETING" ? { ...v, isActive: false } : v));
    const t = tien(tinhChinhSachChoPhan(dau({ hoaHong: hh({ vaiHuong: vai }) })));
    expect(t.MARKETING).toBeUndefined();
    expect(t.SALE).toBe(400_000);
  });
});

describe("[NHH-POL-TT] cơ sở và loại giao dịch", () => {
  it("[NHH-POL-TT-15] cơ sở 0 ⇒ mọi vai 0 đ nhưng vẫn qua trần; cơ sở âm bị từ chối", () => {
    const r = tinhChinhSachChoPhan(dau({ coSo: 0 }));
    expect(r.loai).toBe("OK");
    expect(() => tinhChinhSachChoPhan(dau({ coSo: -1 }))).toThrow();
  });

  it("[NHH-POL-TT-16] policy theo ĐƠN VỊ: rule riêng CS2 không áp giao dịch CS1; áp giao dịch CS2", () => {
    const rules = [
      ...SEED_V1(),
      rule("SALE", 0.05, { orgUnitId: "ou-cs2", orgUnitPath: "/ho/danang/cs2/", orgUnitDepth: 2, policyId: "pol-cs2" }),
    ];
    const h = hh({ quyTac: rules, tranTongTiLe: 0.1 });
    expect(tien(tinhChinhSachChoPhan(dau({ hoaHong: h, orgUnitPath: CS1 }))).SALE).toBe(400_000);
    expect(tien(tinhChinhSachChoPhan(dau({ hoaHong: h, orgUnitPath: "/ho/danang/cs2/" }))).SALE).toBe(500_000);
  });
});
