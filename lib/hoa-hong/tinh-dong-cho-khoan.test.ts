// @vitest-environment node
/**
 * [NHH-COM-03] / [NHH-POL-04] / [NHH-COM-09] / [NHH-COM-11] / [NHH-COM-20] — `tinhDongChoKhoan`: từ một phần học viên của
 * một khoản thu ra các DÒNG NHÁP (04 §2 bước 7–12, §7). THUẦN. Ví dụ số: V1, V3, V3b, V4, V5 của 04 §18.
 */
import { describe, it, expect } from "vitest";

import { THU_TU_PHAM_VI_MAC_DINH, type QuyTac } from "./chon-quy-tac";
import type { HoaHongContext } from "./kieu";
import { phanGiaiNguoiHuong, type KetQuaNguoiHuong } from "./nguoi-huong";
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

const SEED_V1 = (): QuyTac[] => [
  rule("SALE", 0.04),
  rule("SALE_ADMIN", 0.01),
  rule("CENTER_MANAGER", 0.02),
  rule("MARKETING", 0.01),
  rule("TRIAL_TEACHER", 0.01),
];

const VAI = MASTER_VAI_HUONG.map((v) => ({ code: v.code, resolverType: v.resolverType, resolverKey: v.resolverKey, isAcquisition: v.isAcquisition, isActive: true }));

const hh = (p: Partial<HoaHongContext> = {}): HoaHongContext => ({
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
});

const co = (ids: string[], biLoai: string[] = []): KetQuaNguoiHuong => ({
  loai: "CO_NGUOI",
  nguoi: ids.map((id) => ({ kind: "USER" as const, id })),
  biLoai: biLoai.map((id) => ({ nguoi: { kind: "USER" as const, id }, lyDo: "NGUOI_HUONG_NGHI" as const })),
  canCu: "test",
});
const treo = (lyDo: "KHONG_CO_LEAD" | "KHONG_CO_GV_TRIAL" | "CHUA_KHAI_NGUOI_PHU_TRACH" | "THIEU_NGUOI_GIOI_THIEU"): KetQuaNguoiHuong => ({ loai: "TREO", lyDo, canCu: "test" });

const NGUOI_DU = (): Record<string, KetQuaNguoiHuong> => ({
  SALE: co(["u-sale"]),
  SALE_ADMIN: co(["u-admin"]),
  CENTER_MANAGER: co(["u-ql"]),
  MARKETING: co(["u-qc"]),
  TRIAL_TEACHER: co(["u-gv"]),
});

function dau(p: Partial<DauVaoKhoan> = {}, nguoi: Record<string, KetQuaNguoiHuong> = NGUOI_DU()): DauVaoKhoan {
  return {
    hoaHong: hh(),
    loaiGiaoDich: "NEW",
    coSo: 10_000_000,
    rateDate: RATE_DATE,
    orgUnitPath: "/ho/danang/cs1/",
    nguon: { sourceGroupId: "g1", coHoaHong: true, affiliateId: null, sourceId: null, campaignId: null, eventId: null },
    nguoiHuong: new Map(Object.entries(nguoi)),
    roleDefIdsTheoNguoi: new Map(),
    ngoaiCuaSo: false,
    daTraBangEngineCu: new Set(),
    ...p,
  };
}

const ok = (r: ReturnType<typeof tinhDongChoKhoan>) => {
  if (r.loai !== "OK") throw new Error(`Mong OK, nhận ${r.loai}`);
  return r;
};
const tienTheoNguoi = (r: ReturnType<typeof tinhDongChoKhoan>) => Object.fromEntries(ok(r).dong.map((d) => [`${d.roleCode}:${d.beneficiaryId}`, d.amount]));

describe("[NHH-COM-03] ví dụ PRD — HĐ 12tr chia 3 đợt, Sale 3% ⇒ 120.000đ MỖI đợt", () => {
  const sale3 = hh({ quyTac: [rule("SALE", 0.03)] });
  it("đợt 4.000.000 ⇒ 120.000 (tính trên TIỀN VỀ, không trên giá trị hợp đồng 12tr)", () => {
    for (let dot = 0; dot < 3; dot++) {
      const r = tinhDongChoKhoan(dau({ hoaHong: sale3, coSo: 4_000_000 }, { SALE: co(["u-sale"]) }));
      expect(tienTheoNguoi(r)).toEqual({ "SALE:u-sale": 120_000 });
    }
  });
  it("cấy: tính trên giá trị hợp đồng (12.000.000) ra 360.000 — khác 120.000", () => {
    expect(tienTheoNguoi(tinhDongChoKhoan(dau({ hoaHong: sale3, coSo: 12_000_000 }, { SALE: co(["u-sale"]) })))).toEqual({ "SALE:u-sale": 360_000 });
  });
});

describe("[NHH-POL-04] trần 9% — đọc từ cấu hình, Σ TỈ LỆ rule thắng, GV Trial nằm TRONG trần", () => {
  it("V3 seed v1 đủ 5 vai: Σ = 9% = trần ⇒ qua; Sale 400k · Admin 100k · QLCS 200k · MKT 100k · GV 100k", () => {
    const r = tinhDongChoKhoan(dau());
    expect(tienTheoNguoi(r)).toEqual({
      "CENTER_MANAGER:u-ql": 200_000,
      "MARKETING:u-qc": 100_000,
      "SALE:u-sale": 400_000,
      "SALE_ADMIN:u-admin": 100_000,
      "TRIAL_TEACHER:u-gv": 100_000,
    });
  });

  it("9,01% ⇒ VUOT_TRAN: KHÔNG dòng nào cho cả phần (không tự cắt vai nào)", () => {
    const hh901 = hh({ quyTac: [...SEED_V1(), rule("REFERRER_PARENT", 0.0001)] });
    const r = tinhDongChoKhoan(dau({ hoaHong: hh901 }, { ...NGUOI_DU(), REFERRER_PARENT: co(["u-ph"]) }));
    expect(r).toMatchObject({ loai: "VUOT_TRAN", tran: 0.09 });
    expect("dong" in r).toBe(false);
  });

  it("V4: thêm REFERRER_PARENT 1% ⇒ 10% > 9% ⇒ vượt trần", () => {
    const r = tinhDongChoKhoan(dau({ hoaHong: hh({ quyTac: [...SEED_V1(), rule("REFERRER_PARENT", 0.01)] }) }, { ...NGUOI_DU(), REFERRER_PARENT: co(["u-ph"]) }));
    expect(r.loai).toBe("VUOT_TRAN");
  });

  it("trần là THAM SỐ: setting 0.10 ⇒ 9,5% qua; GV Trial vẫn nằm trong trần (bỏ GV ra mà vẫn >trần thì vẫn chặn)", () => {
    const quyTac95 = [...SEED_V1(), rule("REFERRER_PARENT", 0.005)];
    const nguoi = { ...NGUOI_DU(), REFERRER_PARENT: co(["u-ph"]) };
    expect(tinhDongChoKhoan(dau({ hoaHong: hh({ quyTac: quyTac95, tranTongTiLe: 0.1 }) }, nguoi)).loai).toBe("OK");
    expect(tinhDongChoKhoan(dau({ hoaHong: hh({ quyTac: quyTac95, tranTongTiLe: 0.09 }) }, nguoi)).loai).toBe("VUOT_TRAN");
  });

  it("V3b: cơ sở lẻ 1.234.550đ — Σ tiền 111.111đ > 9% × cơ sở (111.109,5) nhưng Σ tỉ lệ = 9% ⇒ VẪN ghi đủ 5 vai", () => {
    const r = tinhDongChoKhoan(dau({ coSo: 1_234_550 }));
    const t = tienTheoNguoi(r);
    expect(Object.values(t).reduce((a, b) => a + b, 0)).toBe(111_111);
    expect(Object.keys(t)).toHaveLength(5);
  });
});

describe("[NHH-COM-20] vai nhiều người — tiền vai tính MỘT lần rồi chia đều (V3)", () => {
  it("2 QC (Marketing 1% × 10tr = 100.000) ⇒ mỗi người 50.000, Σ vai = 100.000", () => {
    const r = tinhDongChoKhoan(dau({}, { ...NGUOI_DU(), MARKETING: co(["u-qc1", "u-qc2"]) }));
    const t = tienTheoNguoi(r);
    expect(t["MARKETING:u-qc1"]).toBe(50_000);
    expect(t["MARKETING:u-qc2"]).toBe(50_000);
  });

  // Cấy 08/10: bỏ `if (p.amount <= 0) continue` ⇒ 0 ca đỏ. Tiền vai 1đ chia hai người ⇒ [1, 0]; dòng 0đ vi phạm CHECK của sổ (amount ≠ 0) và làm nổ cả lượt ghi khoản ấy.
  it("tiền vai chia ra phần 0đ (1đ cho 2 người) ⇒ KHÔNG sinh dòng 0đ; Σ vai vẫn 1đ", () => {
    const r = ok(tinhDongChoKhoan(dau({ coSo: 100 }, { ...NGUOI_DU(), MARKETING: co(["u-qc1", "u-qc2"]) })));
    expect(r.dong.every((d) => d.amount > 0)).toBe(true);
    expect(r.dong.filter((d) => d.roleCode === "MARKETING").map((d) => d.amount)).toEqual([1]);
  });
});

describe("[NHH-COM-09] người hưởng RESIGNED — không sinh dòng, phần của họ TREO, KHÔNG chia lại (D13)", () => {
  it("2 QC, một người nghỉ ⇒ người còn lại vẫn chỉ 50.000; phần người nghỉ = treo NGUOI_HUONG_NGHI có hàng chờ", () => {
    const r = ok(tinhDongChoKhoan(dau({}, { ...NGUOI_DU(), MARKETING: co(["u-qc1", "u-qc2"], ["u-qc2"]) })));
    expect(r.dong.filter((d) => d.roleCode === "MARKETING").map((d) => [d.beneficiaryId, d.amount])).toEqual([["u-qc1", 50_000]]);
    expect(r.treo).toEqual([expect.objectContaining({ roleCode: "MARKETING", lyDo: "NGUOI_HUONG_NGHI", tienVai: 50_000, recipientId: "u-qc2", coHangCho: true })]);
  });
});

describe("treo — phân biệt thiếu dữ liệu (có hàng chờ mềm) và trạng thái bình thường (im lặng)", () => {
  it("đơn không lead ⇒ SALE treo KHONG_CO_LEAD có hàng chờ; 4 vai còn lại vẫn sinh dòng (treo không chặn ô)", () => {
    const r = ok(tinhDongChoKhoan(dau({}, { ...NGUOI_DU(), SALE: treo("KHONG_CO_LEAD"), SALE_ADMIN: treo("KHONG_CO_LEAD") })));
    expect(r.dong.map((d) => d.roleCode).sort()).toEqual(["CENTER_MANAGER", "MARKETING", "TRIAL_TEACHER"]);
    expect(r.treo.map((t) => [t.roleCode, t.lyDo, t.tienVai, t.coHangCho]).sort()).toEqual([
      ["SALE", "KHONG_CO_LEAD", 400_000, true],
      ["SALE_ADMIN", "KHONG_CO_LEAD", 100_000, true],
    ]);
  });

  it("bé chưa học thử (KHONG_CO_GV_TRIAL) là chuyện bình thường ⇒ treo IM LẶNG (không hàng chờ)", () => {
    const r = ok(tinhDongChoKhoan(dau({}, { ...NGUOI_DU(), TRIAL_TEACHER: treo("KHONG_CO_GV_TRIAL") })));
    expect(r.treo).toEqual([expect.objectContaining({ roleCode: "TRIAL_TEACHER", lyDo: "KHONG_CO_GV_TRIAL", coHangCho: false })]);
  });
});

describe("[NHH-SRC-11] cửa sổ 90 ngày — vai `isAcquisition` ngoài cửa sổ không sinh tiền, nguồn giữ nguyên (04 §7.3)", () => {
  const hhRef = hh({ quyTac: [rule("SALE", 0.04), rule("REFERRER_PARENT", 0.02)] });
  const nguoi = { SALE: co(["u-sale"]), REFERRER_PARENT: co(["u-ph"]) };

  it("TRONG cửa sổ ⇒ người giới thiệu nhận 2% = 200.000", () => {
    expect(tienTheoNguoi(tinhDongChoKhoan(dau({ hoaHong: hhRef, ngoaiCuaSo: false }, nguoi)))).toEqual({ "REFERRER_PARENT:u-ph": 200_000, "SALE:u-sale": 400_000 });
  });

  it("NGOÀI cửa sổ ⇒ chỉ Sale; người giới thiệu treo NGOAI_CUA_SO, KHÔNG hàng chờ (luật tất định)", () => {
    const r = ok(tinhDongChoKhoan(dau({ hoaHong: hhRef, ngoaiCuaSo: true }, nguoi)));
    expect(r.dong.map((d) => d.roleCode)).toEqual(["SALE"]);
    expect(r.treo).toEqual([expect.objectContaining({ roleCode: "REFERRER_PARENT", lyDo: "NGOAI_CUA_SO", coHangCho: false })]);
  });

  it("cửa sổ KHÔNG áp cho Sale / QLCS / Marketing / GV Trial (không phải vai mang khách về)", () => {
    const r = ok(tinhDongChoKhoan(dau({ ngoaiCuaSo: true })));
    expect(r.dong).toHaveLength(5);
  });

  it("trần vẫn đếm rule của vai bị loại ngoài cửa sổ (trần là luật CẤU HÌNH, không đổi theo ngày về của khoản)", () => {
    const vuot = hh({ quyTac: [...SEED_V1(), rule("REFERRER_PARENT", 0.02)] }); // 11%
    expect(tinhDongChoKhoan(dau({ hoaHong: vuot, ngoaiCuaSo: true }, { ...NGUOI_DU(), REFERRER_PARENT: co(["u-ph"]) })).loai).toBe("VUOT_TRAN");
  });
});

describe("[NHH-COM-11] GV Trial đã nhận bằng engine CŨ — engine mới loại, LEGACY_DA_TRA, 0 hàng chờ", () => {
  it("GV nằm trong daTraBangEngineCu ⇒ 0 dòng TRIAL_TEACHER + treo LEGACY_DA_TRA không hàng chờ; 4 vai kia nguyên vẹn", () => {
    const r = ok(tinhDongChoKhoan(dau({ daTraBangEngineCu: new Set(["u-gv"]) })));
    expect(r.dong.map((d) => d.roleCode).sort()).toEqual(["CENTER_MANAGER", "MARKETING", "SALE", "SALE_ADMIN"]);
    expect(r.treo).toEqual([expect.objectContaining({ roleCode: "TRIAL_TEACHER", lyDo: "LEGACY_DA_TRA", coHangCho: false })]);
  });
  it("đối chứng dương: ghi danh không có dòng cũ ⇒ có dòng GV Trial", () => {
    expect(ok(tinhDongChoKhoan(dau())).dong.some((d) => d.roleCode === "TRIAL_TEACHER")).toBe(true);
  });

  // Nhánh "đã trả MỘT PHẦN": bé có nhiều GV Trial, chỉ một người đã nhận 1% bằng engine cũ. Cấy 08/10 (`con.length < nh.nguoi.length` ⇒ `false`): 0 ca đỏ ⇒ GV đã nhận
  // vẫn được trả lần hai VÀ tiền vai vẫn chia cho cả người đó. Hai ca dưới khoá cả hai phía: người đã nhận bị loại, tiền vai chia lại cho người CÒN.
  it("2 GV, một người đã nhận bằng engine cũ ⇒ CHỈ người còn lại có dòng và nhận TRỌN tiền vai 100.000 (không chia đôi 50.000)", () => {
    const nguoi = { ...NGUOI_DU(), TRIAL_TEACHER: co(["u-gv", "u-gv2"]) };
    const r = ok(tinhDongChoKhoan(dau({ daTraBangEngineCu: new Set(["u-gv"]) }, nguoi)));
    expect(r.dong.filter((d) => d.roleCode === "TRIAL_TEACHER").map((d) => [d.beneficiaryId, d.amount])).toEqual([["u-gv2", 100_000]]);
    expect(r.treo.filter((t) => t.roleCode === "TRIAL_TEACHER")).toEqual([]); // một phần đã trả KHÔNG phải trạng thái treo
    // đối chứng dương: không ai đã nhận ⇒ chia đều 50.000 / 50.000
    const dem = ok(tinhDongChoKhoan(dau({}, nguoi)));
    expect(dem.dong.filter((d) => d.roleCode === "TRIAL_TEACHER").map((d) => [d.beneficiaryId, d.amount])).toEqual([["u-gv", 50_000], ["u-gv2", 50_000]]);
  });

  it("3 GV (một đã nhận, một đã NGHỈ) ⇒ người đã nhận bị loại, người nghỉ vẫn là phần TREO của nó, người còn nhận phần của mình", () => {
    const nguoi = { ...NGUOI_DU(), TRIAL_TEACHER: co(["u-gv", "u-gv2", "u-gv3"], ["u-gv3"]) };
    const r = ok(tinhDongChoKhoan(dau({ daTraBangEngineCu: new Set(["u-gv"]) }, nguoi)));
    expect(r.dong.filter((d) => d.roleCode === "TRIAL_TEACHER").map((d) => [d.beneficiaryId, d.amount])).toEqual([["u-gv2", 50_000]]);
    expect(r.treo.filter((t) => t.roleCode === "TRIAL_TEACHER")).toEqual([expect.objectContaining({ lyDo: "NGUOI_HUONG_NGHI", recipientId: "u-gv3", tienVai: 50_000 })]);
  });
});

describe("[NHH-POL-02] không rule ⇒ không sinh (D16); RENEWAL ban đầu không có chính sách", () => {
  it("RENEWAL không rule ⇒ 0 dòng, 0 treo, mọi vai KHONG_RULE", () => {
    const r = ok(tinhDongChoKhoan(dau({ loaiGiaoDich: "RENEWAL" })));
    expect(r.dong).toEqual([]);
    expect(r.treo).toEqual([]);
  });
  it("vai Marketing là TUỲ CHỌN: chính sách không nhắc thì không dòng, không ép 0%", () => {
    const r = ok(tinhDongChoKhoan(dau({ hoaHong: hh({ quyTac: [rule("SALE", 0.04)] }) })));
    expect(r.dong.map((d) => d.roleCode)).toEqual(["SALE"]);
  });
});

describe("[NHH-POL-03] V5 — nguồn UNKNOWN ⇒ mức THẤP NHẤT trong các nhóm (D7)", () => {
  it("Sale: GLOBAL 4%, nhóm1 3%, nhóm2 5% ⇒ UNKNOWN = 3% = 300.000; lý do ghi nhóm đạt min", () => {
    const quyTac = [
      rule("SALE", 0.04),
      rule("SALE", 0.03, { scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g1", scope: { sourceGroupId: "g1" } }),
      rule("SALE", 0.05, { scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g2", scope: { sourceGroupId: "g2" } }),
    ];
    const r = ok(
      tinhDongChoKhoan(
        dau({ hoaHong: hh({ quyTac }), nguon: { sourceGroupId: null, coHoaHong: true, affiliateId: null, sourceId: null, campaignId: null, eventId: null } }, { SALE: co(["u-sale"]) }),
      ),
    );
    expect(r.dong).toEqual([expect.objectContaining({ roleCode: "SALE", amount: 300_000, nguonKhongRo: true })]);
  });
});

describe("EXCLUDE — thắng như mọi rule nhưng ra 0đ, không dòng (04 §6.4)", () => {
  it("GLOBAL Marketing 1% + rule EXCLUDE ở nhóm 1 ⇒ nguồn nhóm 1 không trả Marketing; ghi vào vaiKhongTien", () => {
    const quyTac = [
      rule("SALE", 0.04),
      rule("MARKETING", 0.01),
      rule("MARKETING", 0, { scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g1", scope: { sourceGroupId: "g1" }, kieuTinh: "EXCLUDE" }),
    ];
    const r = ok(tinhDongChoKhoan(dau({ hoaHong: hh({ quyTac }) }, { SALE: co(["u-sale"]), MARKETING: co(["u-qc"]) })));
    expect(r.dong.map((d) => d.roleCode)).toEqual(["SALE"]);
    expect(r.vaiKhongTien).toEqual([expect.objectContaining({ roleCode: "MARKETING", trangThai: "EXCLUDE" })]);
  });
});

describe("tất định", () => {
  // Cấy 08/10: đảo chiều so sánh vai ⇒ 0 ca đỏ — ca trên chỉ so hai kết quả VỚI NHAU, không so với thứ tự mà mã khai là "tất định".
  it("thứ tự dòng cố định: roleCode TĂNG DẦN (CENTER_MANAGER < MARKETING < SALE < SALE_ADMIN < TRIAL_TEACHER)", () => {
    expect(ok(tinhDongChoKhoan(dau())).dong.map((d) => d.roleCode)).toEqual(["CENTER_MANAGER", "MARKETING", "SALE", "SALE_ADMIN", "TRIAL_TEACHER"]);
  });

  it("cùng đầu vào ⇒ cùng thứ tự dòng (sắp theo vai rồi id), không phụ thuộc thứ tự map", () => {
    const a = tinhDongChoKhoan(dau());
    const nguoiDao = Object.fromEntries(Object.entries(NGUOI_DU()).reverse());
    const b = tinhDongChoKhoan(dau({}, nguoiDao));
    expect(ok(a).dong.map((d) => `${d.roleCode}:${d.beneficiaryId}`)).toEqual(ok(b).dong.map((d) => `${d.roleCode}:${d.beneficiaryId}`));
  });
});

// ── Rule vai nguồn ở phạm vi CHUNG chạy với dữ liệu NGUỒN THẬT (resolver → tính dòng) — nền cho guardrail kích hoạt [NHH-POL-09k..l] ─────────────────
describe("[FIX-F2-ENG] rule GLOBAL REFERRER_PARENT_SALE / SOURCE_OWNER: ai tạo hàng chờ, ai im lặng", () => {
  const attr = (p: Partial<NonNullable<Parameters<typeof phanGiaiNguoiHuong>[1]["attribution"]>> = {}) => ({
    referrerKind: null as "PARENT" | "EMPLOYEE" | "AFFILIATE" | null,
    referrerParentUserId: null,
    referrerEmployeeUserId: null,
    referrerAffiliateId: null,
    referrerSaleUserId: null,
    nguonChuEmployeeId: null,
    nguonChuUserId: null,
    ...p,
  });
  const ctxNguoi = (attribution: ReturnType<typeof attr>) => ({
    centerId: "cs1",
    assigneeDate: RATE_DATE,
    lead: { convertedById: "u-sale", adminId: "u-admin" },
    phanCongCoSo: [],
    gvTrialUserId: null,
    attribution,
    trangThaiNhanSu: new Map<string, string>(),
    affiliateConHoatDong: new Map<string, boolean>(),
  });
  const vaiTu = (code: string) => {
    const v = MASTER_VAI_HUONG.find((x) => x.code === code)!;
    return { code: v.code, resolverType: v.resolverType, resolverKey: v.resolverKey };
  };
  const chay = (roleCode: string, attribution: ReturnType<typeof attr>) => {
    const nguoiHuong = new Map<string, KetQuaNguoiHuong>([
      ["SALE", co(["u-sale"])],
      [roleCode, phanGiaiNguoiHuong(vaiTu(roleCode), ctxNguoi(attribution))],
    ]);
    return ok(tinhDongChoKhoan(dau({ hoaHong: hh({ quyTac: [rule("SALE", 0.04), rule(roleCode, 0.01)] }) }, Object.fromEntries(nguoiHuong))));
  };

  it("REFERRER_PARENT_SALE ở phạm vi chung + lead KHÔNG do phụ huynh giới thiệu ⇒ treo IM LẶNG (không hàng chờ) ⇒ guardrail kích hoạt KHÔNG cần chặn; đối chứng: phụ huynh giới thiệu mà thiếu Sale ⇒ CÓ hàng chờ", () => {
    const khongPh = chay("REFERRER_PARENT_SALE", attr({ referrerKind: "EMPLOYEE", referrerEmployeeUserId: "u-nv" }));
    expect(khongPh.treo).toEqual([expect.objectContaining({ roleCode: "REFERRER_PARENT_SALE", lyDo: "THIEU_NGUOI_GIOI_THIEU", coHangCho: false })]);
    const phThieuSale = chay("REFERRER_PARENT_SALE", attr({ referrerKind: "PARENT", referrerParentUserId: "u-ph" }));
    expect(phThieuSale.treo).toEqual([expect.objectContaining({ roleCode: "REFERRER_PARENT_SALE", lyDo: "THIEU_SALE_PHU_HUYNH", coHangCho: true })]);
    const du = chay("REFERRER_PARENT_SALE", attr({ referrerKind: "PARENT", referrerParentUserId: "u-ph", referrerSaleUserId: "u-sale-ph" }));
    expect(du.treo).toEqual([]);
  });

  it("SOURCE_OWNER ở phạm vi chung + nguồn CHƯA có chủ ⇒ HÀNG CHỜ trên MỌI khoản thu của nguồn ấy (đó là lý do guardrail phải chặn); nguồn có chủ ⇒ không hàng chờ", () => {
    const khongChu = chay("SOURCE_OWNER", attr());
    expect(khongChu.treo).toEqual([expect.objectContaining({ roleCode: "SOURCE_OWNER", lyDo: "NGUON_CHUA_CO_NGUOI_PHU_TRACH", coHangCho: true })]);
    const coChu = chay("SOURCE_OWNER", attr({ nguonChuEmployeeId: "e-chu", nguonChuUserId: "u-chu" }));
    expect(coChu.treo).toEqual([]);
    expect(Object.keys(tienTheoNguoi(tinhDongChoKhoan(dau({ hoaHong: hh({ quyTac: [rule("SALE", 0.04), rule("SOURCE_OWNER", 0.01)] }) }, { SALE: co(["u-sale"]), SOURCE_OWNER: phanGiaiNguoiHuong(vaiTu("SOURCE_OWNER"), ctxNguoi(attr({ nguonChuEmployeeId: "e-chu", nguonChuUserId: "u-chu" }))) }))))).toContain("SOURCE_OWNER:u-chu");
  });
});
