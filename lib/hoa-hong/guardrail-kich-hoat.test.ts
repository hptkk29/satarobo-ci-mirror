// @vitest-environment node
/**
 * [NHH-POL-05 · 06 · 08 · 09] + [NHH-POL-04g] — guardrail KÍCH HOẠT một version chính sách (04 §6.6). THUẦN.
 *
 * Guardrail là cổng SERVER; UI chỉ hiện lại. Hàm trả MỌI vấn đề cùng lúc (người soạn sửa một lượt), phân
 * `loi` (chặn) và `canhBao` (bắt xác nhận + lý do).
 */
import { describe, it, expect } from "vitest";

import { kiemKichHoat, type DauVaoKichHoat } from "./guardrail-kich-hoat";
import { THU_TU_PHAM_VI_MAC_DINH, type QuyTac } from "./chon-quy-tac";
import { MASTER_LOAI_GIAO_DICH } from "./loai-giao-dich";

const HIEU_LUC = new Date("2026-03-22T17:00:00.000Z"); // 23/03/2026 giờ VN = đúng 15 ngày làm việc sau 02/03
let dem = 0;

function qt(p: Partial<QuyTac> = {}): QuyTac {
  dem += 1;
  return {
    ruleId: `r${dem}`,
    policyId: "pol-moi",
    policyCode: "POL-MOI",
    versionId: "v-moi",
    version: 2,
    documentNumber: "SR.QD.999",
    scopeType: "GLOBAL",
    scopeKey: "GLOBAL",
    scope: {},
    orgUnitId: null,
    orgUnitPath: "/",
    orgUnitDepth: -1,
    transactionType: "NEW",
    roleCode: "SALE",
    revenueComponent: "TUITION",
    kieuTinh: "PERCENT",
    giaTri: 0.04,
    effectiveFrom: HIEU_LUC,
    effectiveTo: null,
    trangThai: "ACTIVE",
    ...p,
  };
}

const VAI = new Map<string, { isActive: boolean; resolverType: "TRANSACTION_ROLE" | "ORG_UNIT_ROLE" | "DIRECT_PERSON"; resolverKey: string | null }>([
  ["SALE", { isActive: true, resolverType: "TRANSACTION_ROLE", resolverKey: null }],
  ["SALE_ADMIN", { isActive: true, resolverType: "TRANSACTION_ROLE", resolverKey: null }],
  ["CENTER_MANAGER", { isActive: true, resolverType: "ORG_UNIT_ROLE", resolverKey: null }],
  ["MARKETING", { isActive: true, resolverType: "ORG_UNIT_ROLE", resolverKey: null }],
  ["TRIAL_TEACHER", { isActive: true, resolverType: "TRANSACTION_ROLE", resolverKey: null }],
]);

function dau(p: Partial<DauVaoKichHoat> = {}): DauVaoKichHoat {
  return {
    phienBan: {
      id: "v-moi",
      policyId: "pol-moi",
      scopeType: "GLOBAL",
      scopeKey: "GLOBAL",
      effectiveFrom: HIEU_LUC,
      effectiveTo: null,
      orgUnitId: null,
      orgUnitPath: "/",
    },
    vanBan: {
      documentCode: "SR.QD.999",
      title: "Quy định hoa hồng",
      issuedOn: "2026-02-20",
      publishedOn: "2026-03-02",
      effectiveOn: "2026-03-23",
      approvedByName: "Hồ Đắc Phúc",
      coTep: true,
      daThuHoi: false,
    },
    quyTacDeXuat: [qt()],
    quyTacDangHieuLuc: [],
    phienBanKhac: [],
    loaiGiaoDich: MASTER_LOAI_GIAO_DICH,
    vaiHuong: VAI,
    coSoThieuNguoiPhuTrach: [],
    nhomNguon: [
      { id: "g1", code: "PARENT_REFERRAL", dangHoatDong: true, coHoaHong: true, ownerEmployeeId: null, referrerRequirement: "PARENT" },
      { id: "g2", code: "PAID_ADS", dangHoatDong: true, coHoaHong: true, ownerEmployeeId: null, referrerRequirement: "NONE" },
    ],
    nghi: [],
    coSoTrongPhamVi: new Set(["cs1", "cs2"]),
    soNgayLamViec: 15,
    tranTongTiLe: 0.09,
    thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH],
    // Trước HIEU_LUC (23/03) — mọi ca thường đều kích hoạt bản có hiệu lực TƯƠNG LAI. Ca "lùi hiệu lực" tự đặt `now`.
    now: new Date("2026-03-03T03:00:00.000Z"),
    ...p,
  };
}

const ma = (r: ReturnType<typeof kiemKichHoat>) => r.loi.map((l) => l.ma).sort();

describe("[NHH-POL-05] văn bản đủ trường", () => {
  it("[NHH-POL-05] đủ số, tiêu đề, ba ngày, người duyệt, tệp ⇒ không lỗi; thiếu từng trường ⇒ lỗi VAN_BAN_THIEU nêu đúng trường", () => {
    expect(ma(kiemKichHoat(dau()))).toEqual([]);
    const truong: [string, Partial<NonNullable<DauVaoKichHoat["vanBan"]>>][] = [
      ["documentCode", { documentCode: " " }],
      ["title", { title: "" }],
      ["issuedOn", { issuedOn: "" }],
      ["publishedOn", { publishedOn: "" }],
      ["effectiveOn", { effectiveOn: "" }],
      ["approvedByName", { approvedByName: "  " }],
      ["coTep", { coTep: false }],
    ];
    for (const [ten, vb] of truong) {
      const r = kiemKichHoat(dau({ vanBan: { ...dau().vanBan!, ...vb } }));
      expect(ma(r), ten).toContain("VAN_BAN_THIEU");
      expect(r.loi.find((l) => l.ma === "VAN_BAN_THIEU")!.thongBao, ten).toContain(ten);
    }
  });

  it("[NHH-POL-05b] không gắn văn bản / văn bản đã thu hồi ⇒ chặn", () => {
    expect(ma(kiemKichHoat(dau({ vanBan: null })))).toContain("VAN_BAN_THIEU");
    expect(ma(kiemKichHoat(dau({ vanBan: { ...dau().vanBan!, daThuHoi: true } })))).toContain("VAN_BAN_DA_THU_HOI");
  });
});

describe("[NHH-POL-06] hiệu lực ≥ công bố + 15 ngày làm việc", () => {
  it("[NHH-POL-06] đúng ngày thứ 15 ⇒ qua; sớm một ngày ⇒ HIEU_LUC_SOM kèm mốc sớm nhất", () => {
    expect(ma(kiemKichHoat(dau()))).toEqual([]);
    const r = kiemKichHoat(dau({ phienBan: { ...dau().phienBan, effectiveFrom: new Date("2026-03-19T17:00:00.000Z") } }));
    expect(ma(r)).toContain("HIEU_LUC_SOM");
    expect(r.loi.find((l) => l.ma === "HIEU_LUC_SOM")!.thongBao).toContain("2026-03-23");
  });

  it("[NHH-POL-06b] khoảng Tết có endDate đẩy mốc; dòng MAINTENANCE cùng ngày thì không", () => {
    const tet = { tuNgay: "2026-03-10", denNgay: "2026-03-11", loai: "HOLIDAY" as const, centerId: null };
    expect(ma(kiemKichHoat(dau({ nghi: [tet] })))).toContain("HIEU_LUC_SOM");
    expect(ma(kiemKichHoat(dau({ nghi: [{ ...tet, loai: "MAINTENANCE" }] })))).toEqual([]);
    // lễ của cơ sở NGOÀI phạm vi không đẩy
    expect(ma(kiemKichHoat(dau({ nghi: [{ ...tet, centerId: "cs9" }] })))).toEqual([]);
  });
});

describe("[NHH-POL-08] chồng lấn hiệu lực — CÙNG policy, biên MỞ", () => {
  const khac = (p: Partial<DauVaoKichHoat["phienBanKhac"][number]>) => ({
    id: "v-cu",
    policyId: "pol-moi",
    scopeKey: "GLOBAL",
    orgUnitId: null,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null as Date | null,
    daDung: false,
    ...p,
  });
  const KET_THUC = new Date("2026-09-30T17:00:00.000Z");
  const bangHetHan = { ...dau().phienBan, effectiveTo: KET_THUC };

  it("[NHH-POL-08] hai policy KHÁC nhau cùng phạm vi + đơn vị, khoảng giao nhau ⇒ KHÔNG phải CHONG_LAN_HIEU_LUC (04 §6.6: chồng lấn hiệu lực là của CÙNG policy; xung đột khác policy do CHONG_LAN_RULE lo)", () => {
    // Cấy 08/10 (R-chồng-policy): bỏ so `policyId` ⇒ policy TAI_TUC (RENEWAL) không bao giờ kích hoạt được khi HV_MOI (NEW) đang ACTIVE.
    expect(ma(kiemKichHoat(dau({ phienBanKhac: [khac({ policyId: "pol-khac" })] })))).not.toContain("CHONG_LAN_HIEU_LUC");
    // ca thật của seed v1: HV_MOI (NEW, GLOBAL, Hội sở) đang ACTIVE + đề xuất TAI_TUC (RENEWAL, GLOBAL, Hội sở) ⇒ KHÔNG lỗi nào
    const hvMoi = qt({ policyId: "pol-hv-moi", policyCode: "POL-HV-MOI", versionId: "v-hv-moi", trangThai: "ACTIVE", transactionType: "NEW", giaTri: 0.04, effectiveFrom: new Date("2026-01-01T00:00:00.000Z") });
    const taiTuc = qt({ transactionType: "RENEWAL", giaTri: 0.02 });
    const r = kiemKichHoat(dau({ phienBanKhac: [khac({ policyId: "pol-hv-moi" })], quyTacDangHieuLuc: [hvMoi], quyTacDeXuat: [taiTuc] }));
    expect(r.loi).toEqual([]);
  });

  it("[NHH-POL-08] biên: bản kia (CÙNG policy, bắt đầu SAU) bắt đầu đúng lúc bản này kết thúc ⇒ KHÔNG chồng (so `<`, không `<=`)", () => {
    const batDauDungLuc = khac({ effectiveFrom: KET_THUC });
    expect(ma(kiemKichHoat(dau({ phienBan: bangHetHan, phienBanKhac: [batDauDungLuc] })))).not.toContain("CHONG_LAN_HIEU_LUC");
    const batDauSomMotMs = khac({ effectiveFrom: new Date(KET_THUC.getTime() - 1) });
    expect(ma(kiemKichHoat(dau({ phienBan: bangHetHan, phienBanKhac: [batDauSomMotMs] })))).toContain("CHONG_LAN_HIEU_LUC");
  });

  it("[NHH-POL-08b] CÙNG policy, bản trước đang mở: version mới sẽ ĐÓNG nó tại effectiveFrom ⇒ không chồng; nhưng lùi hiệu lực về TRƯỚC bản trước ⇒ chồng", () => {
    const truoc = khac({ policyId: "pol-moi", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") });
    expect(ma(kiemKichHoat(dau({ phienBanKhac: [truoc] })))).not.toContain("CHONG_LAN_HIEU_LUC");
    const lui = khac({ policyId: "pol-moi", effectiveFrom: new Date("2026-06-01T00:00:00.000Z") });
    expect(ma(kiemKichHoat(dau({ phienBanKhac: [lui] })))).toContain("CHONG_LAN_HIEU_LUC");
  });

  it("[NHH-POL-08c] khác phạm vi hoặc khác đơn vị ⇒ không chồng", () => {
    const lui = (p: Partial<DauVaoKichHoat["phienBanKhac"][number]>) => khac({ effectiveFrom: new Date("2026-06-01T00:00:00.000Z"), ...p });
    expect(ma(kiemKichHoat(dau({ phienBanKhac: [lui({})] })))).toContain("CHONG_LAN_HIEU_LUC"); // đối chứng dương: cùng phạm vi + đơn vị
    expect(ma(kiemKichHoat(dau({ phienBanKhac: [lui({ scopeKey: "SOURCE_GROUP:g1" })] })))).not.toContain("CHONG_LAN_HIEU_LUC");
    expect(ma(kiemKichHoat(dau({ phienBanKhac: [lui({ orgUnitId: "ou-cs2" })] })))).not.toContain("CHONG_LAN_HIEU_LUC");
  });

  it("[NHH-POL-08d] hai rule khác policy CÙNG hạng ở cùng ngữ cảnh ⇒ CHONG_LAN_RULE (lưới thứ hai — nơi xung đột KHÁC policy bị bắt)", () => {
    const kia = qt({ policyId: "pol-khac", policyCode: "POL-KHAC", versionId: "v-khac", trangThai: "ACTIVE", giaTri: 0.05, effectiveFrom: new Date("2026-01-01T00:00:00.000Z") });
    expect(ma(kiemKichHoat(dau({ quyTacDangHieuLuc: [kia] })))).toContain("CHONG_LAN_RULE");
  });
});

describe("[NHH-POL-LUI-01] không lùi hiệu lực qua bản ĐÃ DÙNG (locked — chỉ tạo version mới, không đổi ranh giới đã tính tiền)", () => {
  const cu = (p: Partial<DauVaoKichHoat["phienBanKhac"][number]> = {}) => ({
    id: "v-cu",
    policyId: "pol-moi",
    scopeKey: "GLOBAL",
    orgUnitId: null,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null as Date | null,
    daDung: true,
    ...p,
  });
  const SAU_MOC = new Date("2026-04-01T03:00:00.000Z"); // đã qua HIEU_LUC (23/03) ⇒ kích hoạt = lùi hiệu lực

  it("[NHH-POL-LUI-01] bản trước ĐÃ DÙNG sẽ bị đóng tại effectiveFrom nằm TRƯỚC `now` ⇒ LUI_HIEU_LUC_BAN_DA_DUNG; chưa dùng thì qua; effectiveFrom ≥ now thì qua", () => {
    expect(ma(kiemKichHoat(dau({ now: SAU_MOC, phienBanKhac: [cu()] })))).toContain("LUI_HIEU_LUC_BAN_DA_DUNG");
    // đối chứng 1: bản trước CHƯA dùng ⇒ đóng lùi vô hại
    expect(ma(kiemKichHoat(dau({ now: SAU_MOC, phienBanKhac: [cu({ daDung: false })] })))).not.toContain("LUI_HIEU_LUC_BAN_DA_DUNG");
    // đối chứng 2: hiệu lực ở TƯƠNG LAI ⇒ không giao dịch nào đã tính có rateDate ≥ mốc
    expect(ma(kiemKichHoat(dau({ phienBanKhac: [cu()] })))).not.toContain("LUI_HIEU_LUC_BAN_DA_DUNG");
    // biên: effectiveFrom == now ⇒ qua (không giao dịch nào có rateDate ≥ now)
    expect(ma(kiemKichHoat(dau({ now: HIEU_LUC, phienBanKhac: [cu()] })))).not.toContain("LUI_HIEU_LUC_BAN_DA_DUNG");
  });

  it("[NHH-POL-LUI-02] chỉ bản bị ĐÓNG mới tính: khác policy, khác phạm vi, đã tự hết hạn trước mốc, hay bắt đầu SAU mốc ⇒ không phải lùi", () => {
    const lui = (p: Partial<DauVaoKichHoat["phienBanKhac"][number]>) => ma(kiemKichHoat(dau({ now: SAU_MOC, phienBanKhac: [cu(p)] })));
    expect(lui({ policyId: "pol-khac" })).not.toContain("LUI_HIEU_LUC_BAN_DA_DUNG");
    expect(lui({ scopeKey: "SOURCE_GROUP:g1" })).not.toContain("LUI_HIEU_LUC_BAN_DA_DUNG");
    expect(lui({ effectiveTo: new Date("2026-02-01T00:00:00.000Z") })).not.toContain("LUI_HIEU_LUC_BAN_DA_DUNG"); // hết trước mốc: không bị đóng thêm
    expect(lui({ effectiveFrom: new Date("2026-05-01T00:00:00.000Z") })).not.toContain("LUI_HIEU_LUC_BAN_DA_DUNG"); // bắt đầu SAU: không bị đóng
  });
});

describe("[NHH-POL-09] rule hợp lệ về mặt nghiệp vụ", () => {
  it("[NHH-POL-09] loại GD đang TẮT (UPSELL…) ⇒ LOAI_GD_TAT", () => {
    const r = kiemKichHoat(dau({ quyTacDeXuat: [qt({ transactionType: "UPSELL" as never })] }));
    expect(ma(r)).toContain("LOAI_GD_TAT");
  });

  it("[NHH-POL-09a2] loại GD đang BẬT nhưng không có bộ phân loại ⇒ LOAI_GD_TAT (luật 12 — CHECK DB cấm hàng này, guardrail không được tin vào CHECK)", () => {
    // Cấy 08/10: bỏ vế `!hasClassifier` ⇒ 0 ca đỏ, vì fixture chỉ có hàng `isActive: false`. Hàng bên dưới là hàng
    // mà master KHÔNG ĐƯỢC PHÉP có — nhưng guardrail là lớp phòng thủ thứ hai nên phải tự đứng được.
    const hangLoi = MASTER_LOAI_GIAO_DICH.map((l) => (l.code === "NEW" ? { ...l, hasClassifier: false, isActive: true } : l));
    expect(ma(kiemKichHoat(dau({ loaiGiaoDich: hangLoi })))).toContain("LOAI_GD_TAT");
    // đối chứng dương: master nguyên vẹn thì NEW qua
    expect(ma(kiemKichHoat(dau()))).not.toContain("LOAI_GD_TAT");
  });

  it("[NHH-POL-09b] FIXED_PER_PURCHASE / TIER_PERIOD_BONUS ⇒ KIEU_TINH_CHUA_HO_TRO (PENDING_REGULATION); EXCLUDE và PERCENT qua", () => {
    expect(ma(kiemKichHoat(dau({ quyTacDeXuat: [qt({ kieuTinh: "FIXED_PER_PURCHASE", giaTri: 500_000 })] })))).toContain("KIEU_TINH_CHUA_HO_TRO");
    expect(ma(kiemKichHoat(dau({ quyTacDeXuat: [qt({ kieuTinh: "TIER_PERIOD_BONUS", giaTri: 0 })] })))).toContain("KIEU_TINH_CHUA_HO_TRO");
    expect(ma(kiemKichHoat(dau({ quyTacDeXuat: [qt({ kieuTinh: "EXCLUDE", giaTri: 0 })] })))).toEqual([]);
  });

  it("[NHH-POL-09c] vai ORG_UNIT_ROLE thiếu người phụ trách ở cơ sở trong phạm vi ⇒ THIEU_NGUOI_PHU_TRACH (mỗi cơ sở một câu); vai TRANSACTION_ROLE không bị kiểm lúc kích hoạt", () => {
    const r = kiemKichHoat(
      dau({
        quyTacDeXuat: [qt({ roleCode: "MARKETING", giaTri: 0.01 })],
        coSoThieuNguoiPhuTrach: [{ roleCode: "MARKETING", centerId: "cs2" }],
      }),
    );
    expect(r.loi.filter((l) => l.ma === "THIEU_NGUOI_PHU_TRACH")).toHaveLength(1);
    // đối chứng dương: cùng danh sách thiếu nhưng rule là của vai Sale ⇒ không liên quan
    expect(ma(kiemKichHoat(dau({ coSoThieuNguoiPhuTrach: [{ roleCode: "MARKETING", centerId: "cs2" }] })))).not.toContain("THIEU_NGUOI_PHU_TRACH");
  });

  it("[NHH-POL-09d] phạm vi PERSON cho vai nhiều người (ORG_UNIT_ROLE) ⇒ chặn; cho vai TRANSACTION_ROLE ⇒ qua", () => {
    const pv = { ...dau().phienBan, scopeType: "PERSON" as const, scopeKey: "PERSON:u1" };
    expect(ma(kiemKichHoat(dau({ phienBan: pv, quyTacDeXuat: [qt({ scopeType: "PERSON", scopeKey: "PERSON:u1", scope: { userId: "u1" }, roleCode: "MARKETING" })] })))).toContain("PERSON_VAI_NHIEU_NGUOI");
    expect(ma(kiemKichHoat(dau({ phienBan: pv, quyTacDeXuat: [qt({ scopeType: "PERSON", scopeKey: "PERSON:u1", scope: { userId: "u1" } })] })))).not.toContain("PERSON_VAI_NHIEU_NGUOI");
  });

  it("[NHH-POL-09e] nhóm nguồn được trỏ tới không còn hoạt động ⇒ NGUON_KHONG_HOAT_DONG; vai không hoạt động ⇒ VAI_KHONG_HOAT_DONG", () => {
    const pv = { ...dau().phienBan, scopeType: "SOURCE_GROUP" as const, scopeKey: "SOURCE_GROUP:g1" };
    const rule = qt({ scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g1", scope: { sourceGroupId: "g1" } });
    const tat = [
      { id: "g1", code: "PARENT_REFERRAL", dangHoatDong: false, coHoaHong: true, ownerEmployeeId: null, referrerRequirement: "PARENT" },
      { id: "g2", code: "PAID_ADS", dangHoatDong: true, coHoaHong: true, ownerEmployeeId: null, referrerRequirement: "NONE" },
    ];
    expect(ma(kiemKichHoat(dau({ phienBan: pv, quyTacDeXuat: [rule], nhomNguon: tat })))).toContain("NGUON_KHONG_HOAT_DONG");
    expect(ma(kiemKichHoat(dau({ phienBan: pv, quyTacDeXuat: [rule] })))).not.toContain("NGUON_KHONG_HOAT_DONG");
    const vaiTat = new Map(VAI);
    vaiTat.set("SALE", { isActive: false, resolverType: "TRANSACTION_ROLE", resolverKey: null });
    expect(ma(kiemKichHoat(dau({ vaiHuong: vaiTat })))).toContain("VAI_KHONG_HOAT_DONG");
  });

  it("[DYN-GR-01] rule phạm vi SOURCE_GROUP của nguồn commissionEnabled=false ⇒ CHẶN kích hoạt (NGUON_KHONG_THAM_GIA_HOA_HONG); cờ true ⇒ qua (đối chứng dương)", () => {
    const pv = { ...dau().phienBan, scopeType: "SOURCE_GROUP" as const, scopeKey: "SOURCE_GROUP:g1" };
    const rule = qt({ scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g1", scope: { sourceGroupId: "g1" } });
    const tatCo = [
      { id: "g1", code: "WALK_IN", dangHoatDong: true, coHoaHong: false, ownerEmployeeId: null, referrerRequirement: "NONE" },
      { id: "g2", code: "PAID_ADS", dangHoatDong: true, coHoaHong: true, ownerEmployeeId: null, referrerRequirement: "NONE" },
    ];
    const r = kiemKichHoat(dau({ phienBan: pv, quyTacDeXuat: [rule], nhomNguon: tatCo }));
    expect(ma(r)).toEqual(["NGUON_KHONG_THAM_GIA_HOA_HONG"]);
    expect(r.loi[0]!.thongBao).toContain("WALK_IN");
    expect(r.loi[0]!.thongBao).toContain("không tham gia hoa hồng theo nguồn");
    expect(ma(kiemKichHoat(dau({ phienBan: pv, quyTacDeXuat: [rule] })))).toEqual([]); // cờ true ở g1 (mặc định của fixture)
  });

  it("[DYN-GR-02] cờ false CHỈ chặn chính sách riêng của nguồn ấy: chính sách GLOBAL kích hoạt bình thường dù có nguồn cờ false; nguồn không hoạt động chỉ báo MỘT lỗi (không báo đôi)", () => {
    const tatCo = [{ id: "g1", code: "WALK_IN", dangHoatDong: true, coHoaHong: false, ownerEmployeeId: null, referrerRequirement: "NONE" }];
    expect(ma(kiemKichHoat(dau({ nhomNguon: tatCo })))).toEqual([]);
    const pv = { ...dau().phienBan, scopeType: "SOURCE_GROUP" as const, scopeKey: "SOURCE_GROUP:g1" };
    const rule = qt({ scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g1", scope: { sourceGroupId: "g1" } });
    const ngung = [{ id: "g1", code: "WALK_IN", dangHoatDong: false, coHoaHong: false, ownerEmployeeId: null, referrerRequirement: "NONE" }];
    expect(ma(kiemKichHoat(dau({ phienBan: pv, quyTacDeXuat: [rule], nhomNguon: ngung })))).toEqual(["NGUON_KHONG_HOAT_DONG"]);
  });

  it("[DYN-GR-03] lưới kiểm trần tôn trọng cờ: rule SOURCE_GROUP còn sót của nguồn cờ false KHÔNG gây VUOT_TRAN oan cho chính sách khác; cờ true thì VUOT_TRAN (đối chứng dương)", () => {
    const chung = (roleCode: string, giaTri: number) => qt({ policyId: "pol-cu", policyCode: "POL-CU", roleCode, giaTri });
    const dangHieuLuc = [
      chung("SALE", 0.04),
      chung("SALE_ADMIN", 0.01),
      chung("CENTER_MANAGER", 0.02),
      chung("TRIAL_TEACHER", 0.01),
      qt({ policyId: "pol-nguon", policyCode: "POL-NGUON", scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g1", scope: { sourceGroupId: "g1" }, roleCode: "REFERRER_PARENT_SALE", giaTri: 0.02 }),
    ];
    const proposed = [qt({ roleCode: "MARKETING", giaTri: 0.01 })]; // 8% + 1% = 9% ở ô chung
    const nhom = (coHoaHong: boolean) => [
      { id: "g1", code: "PARENT_REFERRAL", dangHoatDong: true, coHoaHong, ownerEmployeeId: null, referrerRequirement: "PARENT" },
      { id: "g2", code: "PAID_ADS", dangHoatDong: true, coHoaHong: true, ownerEmployeeId: null, referrerRequirement: "NONE" },
    ];
    expect(ma(kiemKichHoat(dau({ quyTacDeXuat: proposed, quyTacDangHieuLuc: dangHieuLuc, nhomNguon: nhom(true) })))).toEqual(["VUOT_TRAN"]);
    expect(ma(kiemKichHoat(dau({ quyTacDeXuat: proposed, quyTacDangHieuLuc: dangHieuLuc, nhomNguon: nhom(false) })))).toEqual([]);
  });

  it("[DYN-GR-04] dòng LOẠI TRỪ không đòi nguồn «tham gia hoa hồng»: chính sách chỉ gồm EXCLUDE ở nguồn cờ FALSE ⇒ qua; thêm MỘT dòng PERCENT cùng nguồn ⇒ chặn đúng một lỗi; lời chặn nói dòng loại trừ vẫn chạy (luật 12)", () => {
    const pv = { ...dau().phienBan, scopeType: "SOURCE_GROUP" as const, scopeKey: "SOURCE_GROUP:g1" };
    const goc = { scopeType: "SOURCE_GROUP" as const, scopeKey: "SOURCE_GROUP:g1", scope: { sourceGroupId: "g1" } };
    const loaiTru = qt({ ...goc, roleCode: "MARKETING", kieuTinh: "EXCLUDE", giaTri: 0 });
    const thuHut = qt({ ...goc, roleCode: "SALE", giaTri: 0.02 });
    const tat = [
      { id: "g1", code: "WALK_IN", dangHoatDong: true, coHoaHong: false, ownerEmployeeId: null, referrerRequirement: "NONE" },
      { id: "g2", code: "PAID_ADS", dangHoatDong: true, coHoaHong: true, ownerEmployeeId: null, referrerRequirement: "NONE" },
    ];
    expect(ma(kiemKichHoat(dau({ phienBan: pv, quyTacDeXuat: [loaiTru], nhomNguon: tat })))).toEqual([]);
    const r = kiemKichHoat(dau({ phienBan: pv, quyTacDeXuat: [loaiTru, thuHut], nhomNguon: tat }));
    expect(ma(r)).toEqual(["NGUON_KHONG_THAM_GIA_HOA_HONG"]);
    expect(r.loi[0]!.thongBao).toContain("loại trừ");
    // đối chứng dương: cùng bộ rule, cờ TRUE ⇒ qua
    expect(ma(kiemKichHoat(dau({ phienBan: pv, quyTacDeXuat: [loaiTru, thuHut], nhomNguon: tat.map((n) => ({ ...n, coHoaHong: true })) })))).toEqual([]);
    // dòng EXCLUDE ở nguồn NGỪNG HOẠT ĐỘNG vẫn bị chặn bởi lỗi gốc (miễn cờ không miễn trạng thái)
    const ngung = tat.map((n) => (n.id === "g1" ? { ...n, dangHoatDong: false } : n));
    expect(ma(kiemKichHoat(dau({ phienBan: pv, quyTacDeXuat: [loaiTru], nhomNguon: ngung })))).toEqual(["NGUON_KHONG_HOAT_DONG"]);
  });

  it("[NHH-POL-09f] phạm vi SOURCE/CAMPAIGN/EVENT bị chặn tới PR8 (chưa có scopeSourceId)", () => {
    for (const scopeType of ["SOURCE", "CAMPAIGN", "EVENT"] as const) {
      const pv = { ...dau().phienBan, scopeType, scopeKey: `${scopeType}:s1` };
      expect(ma(kiemKichHoat(dau({ phienBan: pv, quyTacDeXuat: [qt({ scopeType, scopeKey: `${scopeType}:s1`, scope: { sourceId: "s1" } })] })))).toContain("PHAM_VI_CHUA_HO_TRO");
    }
  });

  it("[NHH-POL-09g] version không có rule nào ⇒ KHONG_CO_RULE", () => {
    expect(ma(kiemKichHoat(dau({ quyTacDeXuat: [] })))).toContain("KHONG_CO_RULE");
  });
});

describe("[NHH-POL-04g] trần trên lưới ngữ cảnh hữu hạn (04 §6.6)", () => {
  const seedV1 = (): QuyTac[] => [
    qt({ roleCode: "SALE", giaTri: 0.04 }),
    qt({ roleCode: "SALE_ADMIN", giaTri: 0.01 }),
    qt({ roleCode: "CENTER_MANAGER", giaTri: 0.02 }),
    qt({ roleCode: "MARKETING", giaTri: 0.01 }),
    qt({ roleCode: "TRIAL_TEACHER", giaTri: 0.01 }),
  ];

  it("[NHH-POL-04g] seed v1 Σ 9% đúng trần ⇒ qua; một rule cụ thể hơn đẩy Σ lên 9,5% ở MỘT nhóm ⇒ VUOT_TRAN", () => {
    expect(ma(kiemKichHoat(dau({ quyTacDeXuat: seedV1() })))).toEqual([]);
    const nhom = qt({
      scopeType: "SOURCE_GROUP",
      scopeKey: "SOURCE_GROUP:g1",
      scope: { sourceGroupId: "g1" },
      roleCode: "SALE",
      giaTri: 0.045,
      policyId: "pol-khac",
      policyCode: "POL-KHAC",
      versionId: "v-khac",
      orgUnitPath: "/ho/",
      orgUnitDepth: 0,
    });
    const pv = { ...dau().phienBan, policyId: "pol-khac", scopeType: "SOURCE_GROUP" as const, scopeKey: "SOURCE_GROUP:g1", orgUnitPath: "/ho/" };
    const r = kiemKichHoat(
      dau({ phienBan: pv, quyTacDeXuat: [nhom], quyTacDangHieuLuc: seedV1().map((q) => ({ ...q, policyId: "pol-v1", versionId: "v1" })) }),
    );
    expect(ma(r)).toContain("VUOT_TRAN");
    // đối chứng: 4,0% ở nhóm đó (= mức GLOBAL) ⇒ không vượt
    const bang = qt({ ...nhom, ruleId: "r-bang", giaTri: 0.04 });
    expect(ma(kiemKichHoat(dau({ phienBan: pv, quyTacDeXuat: [bang], quyTacDangHieuLuc: seedV1().map((q) => ({ ...q, policyId: "pol-v1", versionId: "v1" })) })))).not.toContain("VUOT_TRAN");
  });

  it("[NHH-POL-04h] trần lấy từ THAM SỐ: cùng bộ rule, trần 0.10 ⇒ qua", () => {
    const quaTran = [...seedV1().slice(0, 4), qt({ roleCode: "TRIAL_TEACHER", giaTri: 0.015 })];
    expect(ma(kiemKichHoat(dau({ quyTacDeXuat: quaTran })))).toContain("VUOT_TRAN");
    expect(ma(kiemKichHoat(dau({ quyTacDeXuat: quaTran, tranTongTiLe: 0.1 })))).not.toContain("VUOT_TRAN");
  });

  it("[NHH-POL-04j] trần phải được kiểm ở MỌI mốc ngày có rule khác BẮT ĐẦU trong cửa sổ hiệu lực — không chỉ ngày bản này bắt đầu", () => {
    // Cấy 08/10 (G06): chỉ kiểm tại `effectiveFrom` của bản đang kích hoạt ⇒ 0 ca đỏ. Hôm nay A = 5%; đến 30 ngày sau
    // rule ORG_UNIT của CS1 (đã ACTIVE từ trước, hiệu lực tương lai) cộng thêm 5% cho HAI VAI KHÁC ⇒ 10% > 9%.
    const sau30Ngay = new Date(HIEU_LUC.getTime() + 30 * 86_400_000);
    const A = [qt({ roleCode: "SALE", giaTri: 0.04 }), qt({ roleCode: "SALE_ADMIN", giaTri: 0.01 })];
    const cs1 = (roleCode: string, v: number, p: Partial<QuyTac> = {}) =>
      qt({
        roleCode,
        giaTri: v,
        policyId: "pol-cs1",
        policyCode: "POL-CS1",
        versionId: "v-cs1",
        scopeType: "ORG_UNIT",
        scopeKey: "ORG_UNIT:cs1",
        scope: { orgUnitId: "ou-cs1", orgUnitPath: "/ho/danang/cs1/" },
        orgUnitId: "ou-cs1",
        orgUnitPath: "/ho/danang/cs1/",
        orgUnitDepth: 2,
        effectiveFrom: sau30Ngay,
        ...p,
      });
    const tuongLai = [cs1("CENTER_MANAGER", 0.03), cs1("MARKETING", 0.02)];
    const r = kiemKichHoat(dau({ quyTacDeXuat: A, quyTacDangHieuLuc: tuongLai }));
    expect(ma(r)).toContain("VUOT_TRAN");
    expect(r.loi.find((l) => l.ma === "VUOT_TRAN")!.thongBao).toContain("10.0000%");
    // đối chứng 1: rule tương lai chỉ thêm 3% (Σ 8%) ⇒ qua
    expect(ma(kiemKichHoat(dau({ quyTacDeXuat: A, quyTacDangHieuLuc: [cs1("CENTER_MANAGER", 0.03)] })))).not.toContain("VUOT_TRAN");
    // đối chứng 2: bản này KẾT THÚC trước mốc ấy ⇒ không bao giờ chồng với rule tương lai ⇒ qua
    const ketThucSom = { ...dau().phienBan, effectiveTo: new Date(HIEU_LUC.getTime() + 10 * 86_400_000) };
    expect(ma(kiemKichHoat(dau({ phienBan: ketThucSom, quyTacDeXuat: A.map((q) => ({ ...q, effectiveTo: ketThucSom.effectiveTo })), quyTacDangHieuLuc: tuongLai })))).not.toContain("VUOT_TRAN");
  });

  it("[NHH-POL-04k] trần phải được kiểm cả ở mốc một rule ĐANG hiệu lực HẾT HẠN giữa cửa sổ — rule chung của bản đề xuất lộ ra khi rule cụ thể rút đi", () => {
    // Cấy 08/10 (review): lưới chỉ lấy mốc BẮT ĐẦU ⇒ không thấy rằng đến 01/12 rule SALE 1% của CS1 hết hạn và SALE 6% GLOBAL
    // của bản đề xuất (thua nó cho tới lúc ấy) thắng ở CS1: Σ 6+4+2+1 = 13% > 9%. Trước 01/12 Σ ở CS1 chỉ 8%.
    const CS1 = "/ho/danang/cs1/";
    const T0 = new Date("2026-01-01T00:00:00.000Z");
    const HET_HAN = new Date("2026-12-01T00:00:00.000Z");
    const cs1 = (roleCode: string, v: number, p: Partial<QuyTac> = {}) =>
      qt({
        roleCode,
        giaTri: v,
        policyId: `pol-cs1-${roleCode}`,
        policyCode: `POL-CS1-${roleCode}`,
        versionId: `v-cs1-${roleCode}`,
        orgUnitId: "ou-cs1",
        orgUnitPath: CS1,
        orgUnitDepth: 3,
        effectiveFrom: T0,
        trangThai: "ACTIVE",
        ...p,
      });
    const dangHL = [
      qt({ roleCode: "CENTER_MANAGER", giaTri: 0.02, policyId: "pol-ho", policyCode: "POL-HO", versionId: "v-ho", effectiveFrom: T0, trangThai: "ACTIVE" }),
      qt({ roleCode: "MARKETING", giaTri: 0.01, policyId: "pol-ho", policyCode: "POL-HO", versionId: "v-ho", effectiveFrom: T0, trangThai: "ACTIVE" }),
      cs1("SALE", 0.01, { effectiveTo: HET_HAN }),
      cs1("SALE_ADMIN", 0.04),
    ];
    const deXuat = [qt({ roleCode: "SALE", giaTri: 0.06 })];
    const r = kiemKichHoat(dau({ quyTacDeXuat: deXuat, quyTacDangHieuLuc: dangHL }));
    expect(ma(r)).toContain("VUOT_TRAN");
    expect(r.loi.find((l) => l.ma === "VUOT_TRAN")!.thongBao).toContain("13.0000%");
    // đối chứng 1: rule cụ thể KHÔNG hết hạn ⇒ SALE 1% thắng mãi ⇒ Σ ≤ 9% ⇒ qua
    const khongHet = dangHL.map((q) => ({ ...q, effectiveTo: null }));
    expect(ma(kiemKichHoat(dau({ quyTacDeXuat: deXuat, quyTacDangHieuLuc: khongHet })))).not.toContain("VUOT_TRAN");
    // đối chứng 2: bản đề xuất KẾT THÚC trước mốc hết hạn ⇒ không bao giờ thấy 13% ⇒ qua
    const ketThuc = new Date("2026-11-30T00:00:00.000Z");
    const pvHet = { ...dau().phienBan, effectiveTo: ketThuc };
    expect(ma(kiemKichHoat(dau({ phienBan: pvHet, quyTacDeXuat: deXuat.map((q) => ({ ...q, effectiveTo: ketThuc })), quyTacDangHieuLuc: dangHL })))).not.toContain("VUOT_TRAN");
    // đối chứng 3: mốc hết hạn nằm TRƯỚC khi bản đề xuất bắt đầu ⇒ lúc ấy SALE 1% đã hết rồi, mọi mẫu của bản đề xuất đều thấy SALE 6% ở CS1
    // (đây là ca "vượt thật từ ngày đầu": Σ 13% ngay tại effectiveFrom, phải bắt được)
    const hetTruoc = dangHL.map((q) => (q.effectiveTo ? { ...q, effectiveTo: new Date("2026-02-01T00:00:00.000Z") } : q));
    expect(ma(kiemKichHoat(dau({ quyTacDeXuat: deXuat, quyTacDangHieuLuc: hetTruoc })))).toContain("VUOT_TRAN");
  });

  it("[NHH-POL-04i] lưới quá lớn ⇒ báo LUOI_QUA_LON (fail-closed), không chạy vô hạn", () => {
    const nhieu: QuyTac[] = [];
    for (let i = 0; i < 40; i++) nhieu.push(qt({ scopeType: "PERSON", scopeKey: `PERSON:u${i}`, scope: { userId: `u${i}` } }));
    for (let i = 0; i < 40; i++) nhieu.push(qt({ scopeType: "AFFILIATE", scopeKey: `AFFILIATE:a${i}`, scope: { affiliateId: `a${i}` } }));
    for (let i = 0; i < 40; i++) nhieu.push(qt({ scopeType: "SOURCE_GROUP", scopeKey: `SOURCE_GROUP:g${i}`, scope: { sourceGroupId: `g${i}` } }));
    for (let i = 0; i < 40; i++) nhieu.push(qt({ scopeType: "ROLE", scopeKey: `ROLE:r${i}`, scope: { roleDefId: `r${i}` } }));
    expect(ma(kiemKichHoat(dau({ quyTacDeXuat: nhieu })))).toContain("LUOI_QUA_LON");
  });
});

describe("[NHH-POL-03g] cảnh báo UNKNOWN tăng (không chặn)", () => {
  const nhom = [
    { id: "g1", code: "PARENT_REFERRAL", dangHoatDong: true, coHoaHong: true, ownerEmployeeId: null, referrerRequirement: "PARENT" },
    { id: "g2", code: "PAID_ADS", dangHoatDong: true, coHoaHong: true, ownerEmployeeId: null, referrerRequirement: "NONE" },
  ];
  const gr = (g: string, v: number, p: Partial<QuyTac> = {}) =>
    qt({
      scopeType: "SOURCE_GROUP",
      scopeKey: `SOURCE_GROUP:${g}`,
      scope: { sourceGroupId: g },
      giaTri: v,
      versionId: "v1",
      version: 1,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      ...p,
    });

  it("[NHH-POL-03g] nâng nhóm RẺ NHẤT ⇒ mức UNKNOWN tăng ⇒ canhBao UNKNOWN_TANG (loi vẫn rỗng); nâng nhóm ĐẮT thì không", () => {
    const dangCo = [gr("g1", 0.04), gr("g2", 0.05)];
    const pv = { ...dau().phienBan, scopeType: "SOURCE_GROUP" as const, scopeKey: "SOURCE_GROUP:g1" };
    const nangRe = qt({ scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g1", scope: { sourceGroupId: "g1" }, giaTri: 0.045 });
    const a = kiemKichHoat(dau({ phienBan: pv, nhomNguon: nhom, quyTacDangHieuLuc: dangCo, quyTacDeXuat: [nangRe] }));
    expect(a.loi).toEqual([]);
    expect(a.canhBao.map((c) => c.ma)).toContain("UNKNOWN_TANG");
    const nangDat = qt({ scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g2", scope: { sourceGroupId: "g2" }, giaTri: 0.06 });
    const pv2 = { ...pv, scopeKey: "SOURCE_GROUP:g2" };
    const b = kiemKichHoat(dau({ phienBan: pv2, nhomNguon: nhom, quyTacDangHieuLuc: dangCo, quyTacDeXuat: [nangDat] }));
    expect(b.canhBao.map((c) => c.ma)).not.toContain("UNKNOWN_TANG");
  });

  it("[NHH-POL-03h] rule ĐẦU TIÊN của (vai × loại × đơn vị) — mức UNKNOWN 0 → X — KHÔNG phải \"tăng\" (chưa có mức để so)", () => {
    const pv = { ...dau().phienBan, scopeType: "SOURCE_GROUP" as const, scopeKey: "SOURCE_GROUP:g1" };
    const dau1 = qt({ scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g1", scope: { sourceGroupId: "g1" }, giaTri: 0.04 });
    const cung = qt({ scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g2", scope: { sourceGroupId: "g2" }, giaTri: 0.05, policyId: "pol-khac" });
    const r = kiemKichHoat(dau({ phienBan: pv, nhomNguon: nhom, quyTacDangHieuLuc: [], quyTacDeXuat: [dau1, cung] }));
    expect(r.canhBao).toEqual([]);
  });

  it("[NHH-POL-03i] mức UNKNOWN 0 → X khi ô (vai × loại × đơn vị) ĐÃ CÓ rule trước đó (nhóm khác) ⇒ là TĂNG thật ⇒ cảnh báo; không có rule trước ⇒ không", () => {
    // Cấy 08/10 (review): `truoc > 0 &&` nuốt ca này. Đang có g1 4%, g2 chưa có rule ⇒ UNKNOWN = min = 0; thêm g2 5% ⇒ UNKNOWN = 4%
    // = từ hôm ấy nguồn KHÔNG RÕ bắt đầu được trả hoa hồng. Không ai đòi người kích hoạt xác nhận.
    const g1Dang = qt({ scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g1", scope: { sourceGroupId: "g1" }, giaTri: 0.04, policyId: "pol-g1", versionId: "v-g1", trangThai: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") });
    const g2De = qt({ scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g2", scope: { sourceGroupId: "g2" }, giaTri: 0.05 });
    const pv = { ...dau().phienBan, scopeType: "SOURCE_GROUP" as const, scopeKey: "SOURCE_GROUP:g2" };
    const r = kiemKichHoat(dau({ phienBan: pv, nhomNguon: nhom, quyTacDangHieuLuc: [g1Dang], quyTacDeXuat: [g2De] }));
    expect(r.loi).toEqual([]);
    expect(r.canhBao.map((c) => c.ma)).toContain("UNKNOWN_TANG");
    expect(r.canhBao.find((c) => c.ma === "UNKNOWN_TANG")!.thongBao).toContain("0 → 400.000");
    // Ba đối chứng dưới đây có `sau > truoc` THẬT (đề xuất phủ CẢ HAI nhóm ⇒ UNKNOWN 0 → 4%) — nếu không, chúng xanh vì UNKNOWN 0 → 0 chứ không
    // vì điều kiện "ô đã có rule" đúng (cấy 08/10: bản đầu của chúng xanh với cả ba điều kiện bị bỏ).
    const g1De = qt({ scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g1", scope: { sourceGroupId: "g1" }, giaTri: 0.04 });
    const ca2Nhom = [g1De, g2De];
    const canhBao = (dangHL: QuyTac[]) => kiemKichHoat(dau({ phienBan: pv, nhomNguon: nhom, quyTacDangHieuLuc: dangHL, quyTacDeXuat: ca2Nhom })).canhBao;
    // đối chứng dương: không có rule trước nào ⇒ rule đầu tiên của ô ⇒ KHÔNG cảnh báo (04 §6.5)
    expect(canhBao([]).map((c) => c.ma)).not.toContain("UNKNOWN_TANG");
    // đối chứng 1: rule trước thuộc VAI khác ⇒ ô (SALE × NEW) chưa có gì
    expect(canhBao([{ ...g1Dang, roleCode: "SALE_ADMIN" }]).map((c) => c.ma)).not.toContain("UNKNOWN_TANG");
    // đối chứng 2: rule trước thuộc LOẠI GD khác
    expect(canhBao([{ ...g1Dang, transactionType: "RENEWAL" as const }]).map((c) => c.ma)).not.toContain("UNKNOWN_TANG");
    // đối chứng 3: rule trước thuộc CS2 ⇒ chỉ ô của CS2 có rule trước (cảnh báo đúng ô ấy); ô Hội sở "/" chưa có gì (rule CS2 không phủ nó)
    const cs2 = { ...g1Dang, orgUnitId: "ou-cs2", orgUnitPath: "/ho/danang/cs2/", orgUnitDepth: 3 };
    const tb = canhBao([cs2]).find((c) => c.ma === "UNKNOWN_TANG")?.thongBao ?? "";
    expect(tb).toContain("@/ho/danang/cs2/:");
    expect(tb).not.toContain("@/:");
    // và đối chứng dương của chính ba đối chứng: rule trước CÙNG vai + loại + phủ Hội sở ⇒ cảnh báo ở ô Hội sở
    expect(r.canhBao.find((c) => c.ma === "UNKNOWN_TANG")!.thongBao).toContain("SALE·NEW@/:");
  });
});

// ── Vai người hưởng của NGUỒN ĐỘNG: chỉ kích hoạt được khi nguồn CÓ dữ liệu cho vai ấy (res3 MEDIUM-4, 09/10/2026) ──────────────────────────────
// Cấy 1: bỏ vế `resolverType === "SOURCE_OWNER" && !g.ownerEmployeeId` ⇒ [NHH-POL-09h] đỏ. Cấy 2: so MÃ vai thay vì KHOÁ ⇒ [NHH-POL-09i] đỏ (khoá đổi, mã giữ).
describe("[NHH-POL-09h..j] rule vai SOURCE_OWNER / REFERRER_PARENT_SALE trên nguồn thiếu dữ liệu ⇒ CHẶN kích hoạt", () => {
  const VAI_NGUON = new Map<string, { isActive: boolean; resolverType: "TRANSACTION_ROLE" | "ORG_UNIT_ROLE" | "DIRECT_PERSON" | "SOURCE_OWNER"; resolverKey: string | null }>([
    ...VAI,
    ["SOURCE_OWNER", { isActive: true, resolverType: "SOURCE_OWNER", resolverKey: "SOURCE_OWNER" }],
    ["REFERRER_PARENT_SALE", { isActive: true, resolverType: "DIRECT_PERSON", resolverKey: "REFERRER_PARENT_SALE" }],
    ["REFERRER_PARENT", { isActive: true, resolverType: "DIRECT_PERSON", resolverKey: "REFERRER_PARENT" }],
  ]);
  const nhomNguon = (g: { ownerEmployeeId: string | null; referrerRequirement: string }) => [
    { id: "g1", code: "NGUON_THU", dangHoatDong: true, coHoaHong: true, ...g },
    { id: "g2", code: "PAID_ADS", dangHoatDong: true, coHoaHong: true, ownerEmployeeId: null, referrerRequirement: "NONE" },
  ];
  const ruleNguon = (roleCode: string) => qt({ scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g1", scope: { sourceGroupId: "g1" }, roleCode, giaTri: 0.01 });
  const chay = (roleCode: string, g: { ownerEmployeeId: string | null; referrerRequirement: string }) =>
    ma(kiemKichHoat(dau({ vaiHuong: VAI_NGUON as DauVaoKichHoat["vaiHuong"], quyTacDeXuat: [ruleNguon(roleCode)], nhomNguon: nhomNguon(g), phienBan: { ...dau().phienBan, scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g1" } })));

  it("[NHH-POL-09h] SOURCE_OWNER trên nguồn CHƯA khai người phụ trách ⇒ NGUON_CHUA_CO_NGUOI_PHU_TRACH; đã khai ⇒ qua (đối chứng dương)", () => {
    expect(chay("SOURCE_OWNER", { ownerEmployeeId: null, referrerRequirement: "NONE" })).toEqual(["NGUON_CHUA_CO_NGUOI_PHU_TRACH"]);
    expect(chay("SOURCE_OWNER", { ownerEmployeeId: "E1", referrerRequirement: "NONE" })).toEqual([]);
  });

  it("[NHH-POL-09i] REFERRER_PARENT_SALE trên nguồn KHÔNG phải kiểu phụ huynh giới thiệu ⇒ NGUON_KHONG_CO_PHU_HUYNH_GIOI_THIEU; nguồn PARENT ⇒ qua; luật so KHOÁ vai chứ không so mã", () => {
    expect(chay("REFERRER_PARENT_SALE", { ownerEmployeeId: null, referrerRequirement: "NONE" })).toEqual(["NGUON_KHONG_CO_PHU_HUYNH_GIOI_THIEU"]);
    expect(chay("REFERRER_PARENT_SALE", { ownerEmployeeId: null, referrerRequirement: "EMPLOYEE" })).toEqual(["NGUON_KHONG_CO_PHU_HUYNH_GIOI_THIEU"]);
    expect(chay("REFERRER_PARENT_SALE", { ownerEmployeeId: null, referrerRequirement: "PARENT" })).toEqual([]);
    // vai KHÁC cùng kiểu DIRECT_PERSON (REFERRER_PARENT) không bị luật này: nó dùng người giới thiệu trên attribution, không cần Sale PH
    expect(chay("REFERRER_PARENT", { ownerEmployeeId: null, referrerRequirement: "NONE" })).toEqual([]);
  });

  it("[NHH-POL-09j] vai thường (SALE) trên nguồn thiếu chủ / sai kiểu ⇒ không bị hai luật trên (đối chứng âm: luật không chặn oan)", () => {
    expect(chay("SALE", { ownerEmployeeId: null, referrerRequirement: "NONE" })).toEqual([]);
  });
});

// ── Rule vai nguồn ở phạm vi KHÔNG gắn nguồn (GLOBAL / đơn vị / vai…) — áp cho MỌI nguồn (agent F, 09/10/2026) ───────────────────────────────────────
// Cấy 1: bỏ vế `q.scopeType !== "SOURCE_GROUP"` ⇒ [NHH-POL-09k] đỏ. Cấy 2: chặn cả REFERRER_PARENT_SALE ở phạm vi chung ⇒ [NHH-POL-09l] đỏ.
describe("[NHH-POL-09k..l] rule vai SOURCE_OWNER / REFERRER_PARENT_SALE ở phạm vi CHUNG", () => {
  const VAI_NGUON = new Map<string, { isActive: boolean; resolverType: "TRANSACTION_ROLE" | "ORG_UNIT_ROLE" | "DIRECT_PERSON" | "SOURCE_OWNER"; resolverKey: string | null }>([
    ...VAI,
    ["SOURCE_OWNER", { isActive: true, resolverType: "SOURCE_OWNER", resolverKey: "SOURCE_OWNER" }],
    ["REFERRER_PARENT_SALE", { isActive: true, resolverType: "DIRECT_PERSON", resolverKey: "REFERRER_PARENT_SALE" }],
  ]);
  const nhom = (id: string, code: string, owner: string | null, req = "NONE", dangHoatDong = true) => ({ id, code, dangHoatDong, coHoaHong: true, ownerEmployeeId: owner, referrerRequirement: req });
  const chayChung = (roleCode: string, nhomNguon: ReturnType<typeof nhom>[]) =>
    kiemKichHoat(dau({ vaiHuong: VAI_NGUON as DauVaoKichHoat["vaiHuong"], quyTacDeXuat: [qt({ roleCode, giaTri: 0.01 })], nhomNguon }));

  it("[NHH-POL-09k] SOURCE_OWNER ở phạm vi CHUNG khi có nguồn đang hoạt động CHƯA khai người phụ trách ⇒ CHẶN, nêu mã nguồn; mọi nguồn đều có chủ ⇒ qua; nguồn đã ngừng không tính", () => {
    const r = chayChung("SOURCE_OWNER", [nhom("g1", "NGUON_THU", "E1"), nhom("g2", "PAID_ADS", null), nhom("g3", "TIKTOK", null)]);
    expect(ma(r)).toEqual(["NGUON_TOAN_CUC_THIEU_NGUOI_PHU_TRACH"]);
    const tb = r.loi.find((l) => l.ma === "NGUON_TOAN_CUC_THIEU_NGUOI_PHU_TRACH")?.thongBao ?? "";
    expect(tb).toContain("PAID_ADS");
    expect(tb).toContain("TIKTOK");
    expect(tb).not.toContain("NGUON_THU"); // nguồn đã có chủ không bị nêu
    // đối chứng dương
    expect(ma(chayChung("SOURCE_OWNER", [nhom("g1", "NGUON_THU", "E1"), nhom("g2", "PAID_ADS", "E2")]))).toEqual([]);
    expect(ma(chayChung("SOURCE_OWNER", [nhom("g1", "NGUON_THU", "E1"), nhom("g2", "CU", null, "NONE", false)]))).toEqual([]);
    // vai thường ở phạm vi chung trên cùng tập nguồn thiếu chủ ⇒ không bị luật này
    expect(ma(chayChung("SALE", [nhom("g2", "PAID_ADS", null)]))).toEqual([]);
  });

  it("[NHH-POL-09l] REFERRER_PARENT_SALE ở phạm vi CHUNG KHÔNG bị chặn: nguồn không phải PARENT chỉ treo IM LẶNG (THIEU_NGUOI_GIOI_THIEU không vào hàng chờ) — xem ca engine [FIX-F2-ENG] ở tinh-dong-cho-khoan.test.ts", () => {
    expect(ma(chayChung("REFERRER_PARENT_SALE", [nhom("g1", "NGUON_THU", null, "NONE"), nhom("g2", "PAID_ADS", null, "EMPLOYEE")]))).toEqual([]);
  });
});
