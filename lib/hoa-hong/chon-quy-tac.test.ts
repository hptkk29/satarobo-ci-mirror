// @vitest-environment node
/**
 * [NHH-POL-01..03] chọn quy tắc hoa hồng (04 §6.2–§6.5). THUẦN.
 *
 *   POL-01   cụ thể thắng chung trong (vai × loại GD); thứ tự phạm vi ĐỌC TỪ CẤU HÌNH
 *   POL-01b  đa đơn vị: rule chỉ áp khi `orgUnitPath` của rule là TIỀN TỐ của giao dịch; hạng (phạm vi, độ sâu)
 *   POL-02   không rule ⇒ không sinh; EXCLUDE thắng ra 0 đ
 *   POL-03   nguồn UNKNOWN ⇒ mức THẤP NHẤT, tính ĐỘNG
 *
 * Ngày tuyệt đối (luật 19); mỗi ca tự dựng đầu vào (luật 18).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  THU_TU_PHAM_VI_MAC_DINH,
  chonQuyTac,
  kiemThuTuPhamVi,
  quyTacChoNguonKhongRo,
  tienTheoQuyTac,
  type NguCanhChonQuyTac,
  type PhamVi,
  type QuyTac,
} from "./chon-quy-tac";

const HO = "/ho/";
const CS1 = "/ho/danang/cs1/";
const CS2 = "/ho/danang/cs2/";
const GLOBAL_PATH = "/";
const RATE_DATE = new Date("2026-10-20T03:00:00.000Z");
let dem = 0;

function qt(p: Partial<QuyTac> & { scopeType: PhamVi }): QuyTac {
  dem += 1;
  const scope = p.scope ?? {};
  return {
    ruleId: `r${dem}`,
    policyId: `p${dem}`,
    policyCode: `POL-${dem}`,
    versionId: `v${dem}`,
    version: 1,
    documentNumber: "SR.QD.208",
    scopeKey: p.scopeType === "GLOBAL" ? "GLOBAL" : `${p.scopeType}:${Object.values(scope)[0] ?? "x"}`,
    scope,
    orgUnitId: null,
    orgUnitPath: GLOBAL_PATH,
    orgUnitDepth: -1,
    transactionType: "NEW",
    roleCode: "SALE",
    revenueComponent: "TUITION",
    kieuTinh: "PERCENT",
    giaTri: 0.04,
    effectiveFrom: new Date("2026-03-01T00:00:00.000Z"),
    effectiveTo: null,
    trangThai: "ACTIVE",
    ...p,
  };
}

function ctx(p: Partial<NguCanhChonQuyTac> = {}): NguCanhChonQuyTac {
  return {
    roleCode: "SALE",
    transactionType: "NEW",
    revenueComponent: "TUITION",
    rateDate: RATE_DATE,
    orgUnitPath: CS1,
    nguoiHuongUserId: null,
    affiliateId: null,
    sourceId: null,
    campaignId: null,
    eventId: null,
    sourceGroupId: null,
    nguonCoHoaHong: true,
    roleDefIds: [],
    ...p,
  };
}

const THANG = (r: ReturnType<typeof chonQuyTac>): QuyTac => {
  if (r.loai !== "THANG") throw new Error(`Mong THANG, nhận ${r.loai}`);
  return r.quyTac;
};

describe("[NHH-POL-01] cụ thể thắng chung, thứ tự đọc từ cấu hình (04 §6.2–§6.3)", () => {
  it("[NHH-POL-01] ma trận: mỗi bậc cụ thể thắng mọi bậc chung hơn (PERSON > AFFILIATE > SOURCE > CAMPAIGN > EVENT > SOURCE_GROUP > ORG_UNIT > ROLE > GLOBAL)", () => {
    const c = ctx({
      nguoiHuongUserId: "u1",
      affiliateId: "a1",
      sourceId: "s1",
      campaignId: "c1",
      eventId: "e1",
      sourceGroupId: "g1",
      roleDefIds: ["rd1"],
    });
    const rules: QuyTac[] = [
      qt({ scopeType: "GLOBAL", giaTri: 0.01 }),
      qt({ scopeType: "ROLE", scope: { roleDefId: "rd1" }, giaTri: 0.02 }),
      qt({ scopeType: "ORG_UNIT", scope: { orgUnitId: "ou-ho", orgUnitPath: HO }, giaTri: 0.03 }),
      qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "g1" }, giaTri: 0.04 }),
      qt({ scopeType: "EVENT", scope: { sourceId: "e1" }, giaTri: 0.05 }),
      qt({ scopeType: "CAMPAIGN", scope: { sourceId: "c1" }, giaTri: 0.06 }),
      qt({ scopeType: "SOURCE", scope: { sourceId: "s1" }, giaTri: 0.07 }),
      qt({ scopeType: "AFFILIATE", scope: { affiliateId: "a1" }, giaTri: 0.08 }),
      qt({ scopeType: "PERSON", scope: { userId: "u1" }, giaTri: 0.09 }),
    ];
    // Bóc dần từ bậc cụ thể nhất — mỗi lần bóc, bậc liền dưới phải thắng.
    const thuTu = [...THU_TU_PHAM_VI_MAC_DINH];
    let con = [...rules];
    for (const bac of thuTu) {
      const r = THANG(chonQuyTac({ ctx: c, quyTac: con, thuTuPhamVi: thuTu }));
      expect(r.scopeType, `còn ${con.length} rule`).toBe(bac);
      con = con.filter((x) => x.scopeType !== bac);
    }
    expect(chonQuyTac({ ctx: c, quyTac: [], thuTuPhamVi: thuTu }).loai).toBe("KHONG_CO");
  });

  it("[NHH-POL-01] đảo thứ tự cấu hình ⇒ kết quả đảo theo (đọc từ cấu hình, không chép cứng): GLOBAL lên đầu thì GLOBAL thắng PERSON", () => {
    const rules = [
      qt({ scopeType: "GLOBAL", giaTri: 0.01 }),
      qt({ scopeType: "PERSON", scope: { userId: "u1" }, giaTri: 0.09 }),
    ];
    const c = ctx({ nguoiHuongUserId: "u1" });
    expect(THANG(chonQuyTac({ ctx: c, quyTac: rules, thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH] })).scopeType).toBe("PERSON");
    const dao = [...THU_TU_PHAM_VI_MAC_DINH].reverse();
    expect(THANG(chonQuyTac({ ctx: c, quyTac: rules, thuTuPhamVi: dao })).scopeType).toBe("GLOBAL");
  });

  it("[NHH-POL-01c] rule KHÔNG khớp ngữ cảnh thì không tham gia: nhóm khác, người khác, vai RBAC khác, affiliate khác", () => {
    const rules = [
      qt({ scopeType: "GLOBAL", giaTri: 0.01 }),
      qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "g-khac" }, giaTri: 0.05 }),
      qt({ scopeType: "PERSON", scope: { userId: "u-khac" }, giaTri: 0.09 }),
      qt({ scopeType: "ROLE", scope: { roleDefId: "rd-khac" }, giaTri: 0.07 }),
      qt({ scopeType: "AFFILIATE", scope: { affiliateId: "a-khac" }, giaTri: 0.08 }),
    ];
    const c = ctx({ nguoiHuongUserId: "u1", sourceGroupId: "g1", roleDefIds: ["rd1"], affiliateId: "a1" });
    expect(THANG(chonQuyTac({ ctx: c, quyTac: rules, thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH] })).scopeType).toBe("GLOBAL");
  });

  it("[NHH-POL-01d] chỉ rule cùng (vai × loại GD × thành phần) mới tranh nhau; rule vai khác / loại khác bị bỏ qua", () => {
    const rules = [
      qt({ scopeType: "GLOBAL", giaTri: 0.04 }),
      qt({ scopeType: "GLOBAL", roleCode: "MARKETING", giaTri: 0.01 }),
      qt({ scopeType: "GLOBAL", transactionType: "RENEWAL", giaTri: 0.02 }),
      qt({ scopeType: "GLOBAL", revenueComponent: "MATERIAL", giaTri: 0.03 }),
    ];
    const r = THANG(chonQuyTac({ ctx: ctx(), quyTac: rules, thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH] }));
    expect(r.giaTri).toBe(0.04);
  });

  it("[NHH-POL-01e] hiệu lực biên MỞ: effectiveFrom ≤ rateDate < effectiveTo; version nháp/huỷ không tham gia; HẾT hạn thì đúng ngày hết là hết", () => {
    const tu = new Date("2026-10-20T03:00:00.000Z");
    const sau = new Date("2026-11-20T03:00:00.000Z");
    const cu = qt({ scopeType: "GLOBAL", giaTri: 0.03, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: tu, trangThai: "SUPERSEDED" });
    const moi = qt({ scopeType: "GLOBAL", giaTri: 0.04, effectiveFrom: tu, effectiveTo: sau, trangThai: "ACTIVE" });
    const c = (d: Date) => ctx({ rateDate: d });
    const tt = [...THU_TU_PHAM_VI_MAC_DINH];
    // đúng thời khắc bàn giao: chỉ bản MỚI khớp (biên phải mở) — nếu cả hai khớp sẽ ra CHONG_LAN
    expect(THANG(chonQuyTac({ ctx: c(tu), quyTac: [cu, moi], thuTuPhamVi: tt })).giaTri).toBe(0.04);
    expect(THANG(chonQuyTac({ ctx: c(new Date(tu.getTime() - 1)), quyTac: [cu, moi], thuTuPhamVi: tt })).giaTri).toBe(0.03);
    expect(chonQuyTac({ ctx: c(sau), quyTac: [cu, moi], thuTuPhamVi: tt }).loai).toBe("KHONG_CO");
    for (const trangThai of ["DRAFT", "CANCELLED"] as const) {
      expect(chonQuyTac({ ctx: ctx(), quyTac: [qt({ scopeType: "GLOBAL", trangThai })], thuTuPhamVi: tt }).loai).toBe("KHONG_CO");
    }
  });

  it("[NHH-POL-01f] thứ tự phạm vi phải là hoán vị ĐỦ 9 mã: thiếu / lặp / mã lạ ⇒ ném", () => {
    expect(kiemThuTuPhamVi([...THU_TU_PHAM_VI_MAC_DINH])).toEqual([...THU_TU_PHAM_VI_MAC_DINH]);
    expect(() => kiemThuTuPhamVi(THU_TU_PHAM_VI_MAC_DINH.slice(1))).toThrow();
    expect(() => kiemThuTuPhamVi([...THU_TU_PHAM_VI_MAC_DINH.slice(1), "PERSON", "PERSON"])).toThrow();
    expect(() => kiemThuTuPhamVi([...THU_TU_PHAM_VI_MAC_DINH.slice(1), "LẠ"])).toThrow();
    expect(() => chonQuyTac({ ctx: ctx(), quyTac: [], thuTuPhamVi: [] })).toThrow();
  });
});

describe("[NHH-POL-01h] phạm vi ORG_UNIT chỉ khớp đơn vị CON-CHÁU (tiền tố), không khớp theo 'chứa chuỗi'", () => {
  // Cấy 08/10 (V08, startsWith -> includes): 0 ca đỏ — mọi path trong fixture đều bắt đầu bằng "/ho/", nên 'chứa' và 'bắt đầu'
  // cho cùng đáp án. Ca dưới dùng một path mà phạm vi nằm GIỮA chuỗi: không phải đơn vị con của phạm vi.
  const orgRule = (path: string) =>
    qt({ scopeType: "ORG_UNIT", scope: { orgUnitId: "ou", orgUnitPath: path }, orgUnitPath: GLOBAL_PATH, giaTri: 0.05 });

  it("[NHH-POL-01h] trùng / con-cháu ⇒ khớp; anh em (cs10), cha, và path chỉ CHỨA phạm vi ⇒ KHÔNG khớp", () => {
    const rules = [qt({ scopeType: "GLOBAL", giaTri: 0.04 }), orgRule(CS1)];
    const gia = (orgUnitPath: string) => {
      const r = chonQuyTac({ ctx: ctx({ orgUnitPath }), quyTac: rules, thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH] });
      return r.loai === "THANG" ? Number(r.quyTac.giaTri) : r.loai;
    };
    expect(gia(CS1)).toBe(0.05); // chính nó
    expect(gia(`${CS1}lop-a/`)).toBe(0.05); // con-cháu
    expect(gia("/ho/danang/cs10/")).toBe(0.04); // anh em tên bắt đầu giống
    expect(gia("/ho/danang/")).toBe(0.04); // cha
    expect(gia(`/ho/hue${CS1}`)).toBe(0.04); // phạm vi nằm GIỮA chuỗi — không phải con-cháu
  });
});

describe("[NHH-POL-01b] đa đơn vị (04 §6.3)", () => {
  const tt = [...THU_TU_PHAM_VI_MAC_DINH];
  const ruleHo = () => qt({ scopeType: "GLOBAL", giaTri: 0.04, orgUnitId: "ou-ho", orgUnitPath: HO, orgUnitDepth: 0 });
  const ruleCs2 = () => qt({ scopeType: "GLOBAL", giaTri: 0.05, orgUnitId: "ou-cs2", orgUnitPath: CS2, orgUnitDepth: 2 });

  it("[NHH-POL-01b] rule HO + rule CS2 cùng (vai, loại, phạm vi): giao dịch CS2 ⇒ rule CS2 thắng; giao dịch CS1 ⇒ rule HO (rule CS2 KHÔNG áp)", () => {
    const rules = [ruleHo(), ruleCs2()];
    expect(THANG(chonQuyTac({ ctx: ctx({ orgUnitPath: CS2 }), quyTac: rules, thuTuPhamVi: tt })).orgUnitId).toBe("ou-cs2");
    expect(THANG(chonQuyTac({ ctx: ctx({ orgUnitPath: CS1 }), quyTac: rules, thuTuPhamVi: tt })).orgUnitId).toBe("ou-ho");
  });

  it("[NHH-POL-01b] tiền tố phải khớp theo ĐOẠN: '/ho/danang/cs1/' KHÔNG phải tiền tố của '/ho/danang/cs10/'", () => {
    const cs1 = qt({ scopeType: "GLOBAL", orgUnitId: "ou-cs1", orgUnitPath: CS1, orgUnitDepth: 2 });
    expect(chonQuyTac({ ctx: ctx({ orgUnitPath: "/ho/danang/cs10/" }), quyTac: [cs1], thuTuPhamVi: tt }).loai).toBe("KHONG_CO");
    expect(chonQuyTac({ ctx: ctx({ orgUnitPath: CS1 }), quyTac: [cs1], thuTuPhamVi: tt }).loai).toBe("THANG");
  });

  it("[NHH-POL-01b] hai rule CÙNG hạng (cùng phạm vi, cùng độ sâu) ⇒ CHONG_LAN (POLICY_OVERLAP), không đoán", () => {
    const a = qt({ scopeType: "GLOBAL", giaTri: 0.04, orgUnitPath: HO, orgUnitDepth: 0 });
    const b = qt({ scopeType: "GLOBAL", giaTri: 0.05, orgUnitPath: HO, orgUnitDepth: 0 });
    const r = chonQuyTac({ ctx: ctx(), quyTac: [a, b], thuTuPhamVi: tt });
    expect(r.loai).toBe("CHONG_LAN");
    if (r.loai === "CHONG_LAN") expect(r.ungVien.map((u) => u.ruleId).sort()).toEqual([a.ruleId, b.ruleId].sort());
  });

  it("[NHH-POL-01b] hạng SO TỪ ĐIỂN: phạm vi cụ thể hơn thắng dù đơn vị nông hơn (PERSON@HO > GLOBAL@CS2)", () => {
    const person = qt({ scopeType: "PERSON", scope: { userId: "u1" }, giaTri: 0.09, orgUnitPath: HO, orgUnitDepth: 0 });
    const cs2 = ruleCs2();
    expect(THANG(chonQuyTac({ ctx: ctx({ orgUnitPath: CS2, nguoiHuongUserId: "u1" }), quyTac: [cs2, person], thuTuPhamVi: tt })).scopeType).toBe("PERSON");
  });

  it("[NHH-POL-01b] ORG_UNIT: chỉ khớp khi đơn vị của rule là tổ tiên-hoặc-chính-nó của đơn vị giao dịch", () => {
    const ouCs2 = qt({ scopeType: "ORG_UNIT", scope: { orgUnitId: "ou-cs2", orgUnitPath: CS2 }, giaTri: 0.06 });
    expect(chonQuyTac({ ctx: ctx({ orgUnitPath: CS1 }), quyTac: [ouCs2], thuTuPhamVi: tt }).loai).toBe("KHONG_CO");
    expect(chonQuyTac({ ctx: ctx({ orgUnitPath: CS2 }), quyTac: [ouCs2], thuTuPhamVi: tt }).loai).toBe("THANG");
  });

  it("[NHH-POL-01g] lyDo nói rõ vì sao rule thắng + liệt kê ứng viên có hạng", () => {
    const r = chonQuyTac({ ctx: ctx({ orgUnitPath: CS2 }), quyTac: [ruleHo(), ruleCs2()], thuTuPhamVi: tt });
    expect(r.loai).toBe("THANG");
    if (r.loai === "THANG") {
      expect(r.lyDo).toContain("GLOBAL");
      expect(r.lyDo).toContain("SR.QD.208");
      expect(r.ungVien).toHaveLength(2);
      expect(r.ungVien[0]!.ruleId).toBe(r.quyTac.ruleId); // ứng viên xếp theo hạng, thắng đứng đầu
    }
  });
});

describe("[NHH-POL-02] không rule ⇒ không sinh; EXCLUDE chặn kế thừa (04 §6.4)", () => {
  const tt = [...THU_TU_PHAM_VI_MAC_DINH];

  it("[NHH-POL-02] RENEWAL không có policy ⇒ KHONG_CO (không phải 0 đ) — D16; Marketing không có rule ⇒ KHONG_CO — vai tuỳ chọn", () => {
    const rules = [qt({ scopeType: "GLOBAL", transactionType: "NEW" })];
    const r = chonQuyTac({ ctx: ctx({ transactionType: "RENEWAL" }), quyTac: rules, thuTuPhamVi: tt });
    expect(r.loai).toBe("KHONG_CO");
    const m = chonQuyTac({ ctx: ctx({ roleCode: "MARKETING" }), quyTac: rules, thuTuPhamVi: tt });
    expect(m.loai).toBe("KHONG_CO");
  });

  it("[NHH-POL-02b] EXCLUDE cụ thể hơn GLOBAL thắng và ra 0 đ — nhóm 4 không trả Marketing dù có GLOBAL 1%", () => {
    const rules = [
      qt({ scopeType: "GLOBAL", roleCode: "MARKETING", giaTri: 0.01 }),
      qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "g4" }, roleCode: "MARKETING", kieuTinh: "EXCLUDE", giaTri: 0 }),
    ];
    const khongTra = chonQuyTac({ ctx: ctx({ roleCode: "MARKETING", sourceGroupId: "g4" }), quyTac: rules, thuTuPhamVi: tt });
    expect(THANG(khongTra).kieuTinh).toBe("EXCLUDE");
    expect(tienTheoQuyTac(1_000_000, THANG(khongTra))).toBe(0);
    // đối chứng dương: nhóm khác vẫn trả 1%
    const tra = chonQuyTac({ ctx: ctx({ roleCode: "MARKETING", sourceGroupId: "g1" }), quyTac: rules, thuTuPhamVi: tt });
    expect(tienTheoQuyTac(1_000_000, THANG(tra))).toBe(10_000);
  });

  it("[NHH-POL-02c] tienTheoQuyTac: PERCENT làm tròn một lần; FIXED nguyên số; TIER không theo khoản (0)", () => {
    expect(tienTheoQuyTac(1_234_550, qt({ scopeType: "GLOBAL", giaTri: 0.01 }))).toBe(12_346);
    expect(tienTheoQuyTac(1_234_550, qt({ scopeType: "GLOBAL", kieuTinh: "FIXED_PER_PURCHASE", giaTri: 500_000 }))).toBe(500_000);
    expect(tienTheoQuyTac(1_234_550, qt({ scopeType: "GLOBAL", kieuTinh: "TIER_PERIOD_BONUS", giaTri: 0 }))).toBe(0);
  });
});

describe("[NHH-POL-03] nguồn UNKNOWN ⇒ mức THẤP NHẤT trong các nhóm, TÍNH ĐỘNG (04 §6.5, D7)", () => {
  const tt = [...THU_TU_PHAM_VI_MAC_DINH];
  const nhom = [
    { id: "g1", code: "PARENT_REFERRAL", coHoaHong: true },
    { id: "g2", code: "PAID_ADS", coHoaHong: true },
    { id: "g4", code: "WALK_IN", coHoaHong: true },
  ];
  const base = (): Omit<Parameters<typeof quyTacChoNguonKhongRo>[0], "quyTac"> => ({
    ctx: { roleCode: "SALE", transactionType: "NEW", revenueComponent: "TUITION", rateDate: RATE_DATE, orgUnitPath: CS1, nguoiHuongUserId: null, roleDefIds: [] },
    nhomDangHoatDong: nhom,
    thuTuPhamVi: tt,
    coSo: 10_000_000,
  });

  it("[NHH-POL-03] mức thấp nhất trong các nhóm: g1 5%, g2 4%, g4 6% ⇒ UNKNOWN = 4% (nhóm g2); hạ g1 xuống 3% ⇒ UNKNOWN theo xuống 3% — KHÔNG gõ số", () => {
    const rules = (g1: number) => [
      qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "g1" }, giaTri: g1 }),
      qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "g2" }, giaTri: 0.04 }),
      qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "g4" }, giaTri: 0.06 }),
    ];
    const a = quyTacChoNguonKhongRo({ ...base(), quyTac: rules(0.05) });
    expect(a.loai).toBe("THANG");
    if (a.loai === "THANG") {
      expect(a.tien).toBe(400_000);
      expect(a.nhomMin.code).toBe("PAID_ADS");
      expect(a.quyTac.giaTri).toBe(0.04);
      expect(a.lyDo).toContain("PAID_ADS");
      expect(a.theoNhom.map((x) => x.tien)).toEqual([500_000, 400_000, 600_000]);
    }
    const b = quyTacChoNguonKhongRo({ ...base(), quyTac: rules(0.03) });
    expect(b.loai === "THANG" && b.tien).toBe(300_000);
    expect(b.loai === "THANG" && b.nhomMin.code).toBe("PARENT_REFERRAL");
  });

  it("[NHH-POL-03b] một nhóm không có rule của vai ⇒ min = 0 ⇒ KHONG_CO (an toàn: thiếu nguồn chỉ có thể bị trả THIẾU)", () => {
    const rules = [
      qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "g1" }, giaTri: 0.05 }),
      qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "g2" }, giaTri: 0.04 }),
    ]; // g4 không có
    const r = quyTacChoNguonKhongRo({ ...base(), quyTac: rules });
    expect(r.loai).toBe("KHONG_CO");
  });

  it("[NHH-POL-03c] chỉ rule cấp NHÓM tham gia min; rule SOURCE/AFFILIATE (cấp con) KHÔNG làm UNKNOWN rẻ hơn (Q16)", () => {
    const rules = [
      qt({ scopeType: "GLOBAL", giaTri: 0.05 }),
      qt({ scopeType: "SOURCE", scope: { sourceId: "s-rẻ" }, giaTri: 0.01 }),
      qt({ scopeType: "AFFILIATE", scope: { affiliateId: "a-rẻ" }, giaTri: 0.01 }),
    ];
    const r = quyTacChoNguonKhongRo({ ...base(), quyTac: rules });
    expect(r.loai === "THANG" && r.tien).toBe(500_000);
  });

  it("[NHH-POL-03d] giữ chiều PERSON/ROLE khi tính từng nhóm (chiều của NGƯỜI HƯỞNG, không phải của nguồn)", () => {
    const rules = [
      qt({ scopeType: "GLOBAL", giaTri: 0.04 }),
      qt({ scopeType: "PERSON", scope: { userId: "u-vip" }, giaTri: 0.07 }),
    ];
    const r = quyTacChoNguonKhongRo({ ...base(), ctx: { ...base().ctx, nguoiHuongUserId: "u-vip" }, quyTac: rules });
    expect(r.loai === "THANG" && r.tien).toBe(700_000);
  });

  it("[NHH-POL-03e] nhóm EXCLUDE ⇒ min = 0 ⇒ KHONG_CO; không có nhóm hoạt động nào ⇒ KHONG_CO; một nhóm CHỒNG LẤN ⇒ CHONG_LAN", () => {
    const rules = [
      qt({ scopeType: "GLOBAL", giaTri: 0.05 }),
      qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "g4" }, kieuTinh: "EXCLUDE", giaTri: 0 }),
    ];
    expect(quyTacChoNguonKhongRo({ ...base(), quyTac: rules }).loai).toBe("KHONG_CO");
    expect(quyTacChoNguonKhongRo({ ...base(), nhomDangHoatDong: [], quyTac: rules }).loai).toBe("KHONG_CO");
    const chong = [
      qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "g1" }, giaTri: 0.05, orgUnitPath: HO, orgUnitDepth: 0 }),
      qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "g1" }, giaTri: 0.06, orgUnitPath: HO, orgUnitDepth: 0 }),
      qt({ scopeType: "GLOBAL", giaTri: 0.04 }),
    ];
    expect(quyTacChoNguonKhongRo({ ...base(), quyTac: chong }).loai).toBe("CHONG_LAN");
  });

  it("[NHH-POL-03f] hoà tiền ⇒ nhóm đứng TRƯỚC trong danh sách (tất định); cơ sở đổi ⇒ min tính lại trên cơ sở ấy", () => {
    const rules = [
      qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "g1" }, giaTri: 0.04 }),
      qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "g2" }, giaTri: 0.04 }),
      qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "g4" }, giaTri: 0.05 }),
    ];
    const r = quyTacChoNguonKhongRo({ ...base(), coSo: 1_234_550, quyTac: rules });
    expect(r.loai === "THANG" && r.nhomMin.code).toBe("PARENT_REFERRAL");
    expect(r.loai === "THANG" && r.tien).toBe(49_382);
  });
});

describe("[DYN-CE] commissionEnabled: nguồn KHÔNG tham gia hoa hồng theo nguồn ⇒ rule SOURCE_GROUP của nó BẤT HOẠT (chính sách chung vẫn chạy) — TRỪ dòng LOẠI TRỪ (EXCLUDE), luôn chạy", () => {
  const tt = [...THU_TU_PHAM_VI_MAC_DINH];
  const chung = () => qt({ scopeType: "GLOBAL", giaTri: 0.04 });
  const rieng = () => qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "gx" }, giaTri: 0.02 });

  it("[DYN-CE-01] cờ TRUE: rule riêng của nguồn thắng chính sách chung (đối chứng dương)", () => {
    const r = chonQuyTac({ ctx: ctx({ sourceGroupId: "gx", nguonCoHoaHong: true }), quyTac: [chung(), rieng()], thuTuPhamVi: tt });
    expect(THANG(r).giaTri).toBe(0.02);
    expect(THANG(r).scopeType).toBe("SOURCE_GROUP");
  });

  it("[DYN-CE-02] cờ FALSE: rule riêng BẤT HOẠT, chính sách chung vẫn chạy", () => {
    const r = chonQuyTac({ ctx: ctx({ sourceGroupId: "gx", nguonCoHoaHong: false }), quyTac: [chung(), rieng()], thuTuPhamVi: tt });
    expect(THANG(r).giaTri).toBe(0.04);
    expect(THANG(r).scopeType).toBe("GLOBAL");
  });

  it("[DYN-CE-03] cờ FALSE và CHỈ có rule riêng của nguồn ⇒ KHONG_CO (không sinh dòng, không 0%)", () => {
    const r = chonQuyTac({ ctx: ctx({ sourceGroupId: "gx", nguonCoHoaHong: false }), quyTac: [rieng()], thuTuPhamVi: tt });
    expect(r.loai).toBe("KHONG_CO");
  });

  it("[DYN-CE-04] cờ chỉ chặn phạm vi SOURCE_GROUP: rule PERSON/ORG_UNIT của cùng khoản vẫn khớp khi cờ FALSE", () => {
    const person = qt({ scopeType: "PERSON", scope: { userId: "u1" }, giaTri: 0.03 });
    const r = chonQuyTac({ ctx: ctx({ sourceGroupId: "gx", nguonCoHoaHong: false, nguoiHuongUserId: "u1" }), quyTac: [chung(), rieng(), person], thuTuPhamVi: tt });
    expect(THANG(r).scopeType).toBe("PERSON");
  });

  it("[DYN-CE-05] UNKNOWN-min tôn trọng cờ TỪNG nhóm: nhóm cờ FALSE tính theo chính sách chung, không theo rule riêng 0,1% của nó", () => {
    const base = (coHoaHongG2: boolean): Parameters<typeof quyTacChoNguonKhongRo>[0] => ({
      ctx: { roleCode: "SALE", transactionType: "NEW", revenueComponent: "TUITION", rateDate: RATE_DATE, orgUnitPath: CS1, nguoiHuongUserId: null, roleDefIds: [] },
      nhomDangHoatDong: [
        { id: "g1", code: "A", coHoaHong: true },
        { id: "g2", code: "B", coHoaHong: coHoaHongG2 },
      ],
      quyTac: [
        chung(),
        qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "g1" }, giaTri: 0.01 }),
        qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "g2" }, giaTri: 0.001 }),
      ],
      thuTuPhamVi: tt,
      coSo: 10_000_000,
    });
    const tat = quyTacChoNguonKhongRo(base(false));
    expect(tat.loai === "THANG" && tat.nhomMin.code).toBe("A"); // g2 bất hoạt ⇒ 4% chung > 1% của A
    expect(tat.loai === "THANG" && tat.tien).toBe(100_000);
    const bat = quyTacChoNguonKhongRo(base(true));
    expect(bat.loai === "THANG" && bat.nhomMin.code).toBe("B"); // đối chứng dương: cờ TRUE ⇒ 0,1% là thấp nhất
    expect(bat.loai === "THANG" && bat.tien).toBe(10_000);
  });

  // ── MIỄN EXCLUDE (chủ dự án 09/10/2026: «Marketing 1% CHỈ trả cho nguồn quảng cáo; các nguồn khác không trả Marketing») ──
  // Cờ `commissionEnabled` nói «nguồn này có hoa hồng THU HÚT riêng không». Một dòng EXCLUDE không thu hút ai — nó chỉ nói «ở nguồn này, vai X không được trả theo mức chung» — nên
  // nguồn KHÔNG tham gia hoa hồng vẫn mang được dòng đó. Miễn theo KIỂU TÍNH của dòng (thuộc tính của rule), không theo mã nguồn nào.
  const marketingChung = () => qt({ scopeType: "GLOBAL", roleCode: "MARKETING", giaTri: 0.01 });
  const khongMarketing = () => qt({ scopeType: "SOURCE_GROUP", scope: { sourceGroupId: "gx" }, roleCode: "MARKETING", kieuTinh: "EXCLUDE", giaTri: 0 });

  it("[DYN-CE-06] cờ FALSE + dòng EXCLUDE của nguồn ⇒ EXCLUDE THẮNG chính sách chung (vai ra 0 đ ở nguồn này); cờ TRUE cho cùng kết quả (đối chứng dương)", () => {
    for (const co of [false, true]) {
      const r = chonQuyTac({ ctx: ctx({ roleCode: "MARKETING", sourceGroupId: "gx", nguonCoHoaHong: co }), quyTac: [marketingChung(), khongMarketing()], thuTuPhamVi: tt });
      expect(THANG(r).kieuTinh, `cờ ${co}`).toBe("EXCLUDE");
      expect(THANG(r).scopeType).toBe("SOURCE_GROUP");
      expect(tienTheoQuyTac(10_000_000, THANG(r))).toBe(0);
    }
  });

  it("[DYN-CE-07] miễn CHỈ cho EXCLUDE: cờ FALSE thì dòng PERCENT cùng nguồn VẪN bất hoạt (chính sách chung thắng), dù đứng cạnh một dòng EXCLUDE của vai khác", () => {
    const rules = [chung(), marketingChung(), khongMarketing(), rieng()]; // rieng() = SALE 2% phạm vi nguồn gx
    const sale = chonQuyTac({ ctx: ctx({ roleCode: "SALE", sourceGroupId: "gx", nguonCoHoaHong: false }), quyTac: rules, thuTuPhamVi: tt });
    expect(THANG(sale).scopeType).toBe("GLOBAL");
    expect(THANG(sale).giaTri).toBe(0.04);
    const mkt = chonQuyTac({ ctx: ctx({ roleCode: "MARKETING", sourceGroupId: "gx", nguonCoHoaHong: false }), quyTac: rules, thuTuPhamVi: tt });
    expect(THANG(mkt).kieuTinh).toBe("EXCLUDE");
    // miễn không biến cờ thành vô nghĩa: cùng cờ TRUE thì dòng PERCENT của nguồn thắng
    const saleBat = chonQuyTac({ ctx: ctx({ roleCode: "SALE", sourceGroupId: "gx", nguonCoHoaHong: true }), quyTac: rules, thuTuPhamVi: tt });
    expect(THANG(saleBat).scopeType).toBe("SOURCE_GROUP");
  });

  it("[DYN-CE-08] miễn không làm dòng EXCLUDE rò sang nguồn khác: khoản của nguồn gy vẫn nhận vai theo chính sách chung", () => {
    const r = chonQuyTac({ ctx: ctx({ roleCode: "MARKETING", sourceGroupId: "gy", nguonCoHoaHong: false }), quyTac: [marketingChung(), khongMarketing()], thuTuPhamVi: tt });
    expect(THANG(r).scopeType).toBe("GLOBAL");
    expect(THANG(r).kieuTinh).toBe("PERCENT");
  });

  it("[DYN-CE-09] UNKNOWN-min thấy dòng EXCLUDE của nhóm cờ FALSE: một nhóm không trả vai X ⇒ mức thấp nhất của vai X = 0 ⇒ KHONG_CO; bỏ dòng EXCLUDE ⇒ trả mức chung (đối chứng dương)", () => {
    const base = (quyTac: QuyTac[]): Parameters<typeof quyTacChoNguonKhongRo>[0] => ({
      ctx: { roleCode: "MARKETING", transactionType: "NEW", revenueComponent: "TUITION", rateDate: RATE_DATE, orgUnitPath: CS1, nguoiHuongUserId: null, roleDefIds: [] },
      nhomDangHoatDong: [
        { id: "gx", code: "A", coHoaHong: false },
        { id: "gz", code: "B", coHoaHong: true },
      ],
      quyTac,
      thuTuPhamVi: tt,
      coSo: 10_000_000,
    });
    expect(quyTacChoNguonKhongRo(base([marketingChung(), khongMarketing()])).loai).toBe("KHONG_CO");
    const khong = quyTacChoNguonKhongRo(base([marketingChung()]));
    expect(khong.loai === "THANG" && khong.tien).toBe(100_000);
  });
});

describe("[NHH-POL-W] lưới ghim mã nguồn", () => {
  it("[NHH-POL-W1] hàm UNKNOWN là MỘT hàm: không chỗ nào khác trong lib/hoa-hong gõ `Math.min` trên tiền theo nhóm", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/hoa-hong/chon-quy-tac.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(src.split("export function quyTacChoNguonKhongRo").length - 1).toBe(1);
    // không có tỉ lệ gõ tay trong mã chọn quy tắc
    expect(/0\.0[1-9]\b/.test(src)).toBe(false);
  });
});
