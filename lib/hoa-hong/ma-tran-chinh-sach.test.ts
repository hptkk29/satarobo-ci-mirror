// @vitest-environment node
// [NHH-FE-MT-*] — MA TRẬN CHÍNH SÁCH (chỉ đọc): vai × (các nhóm nguồn đang hoạt động + UNKNOWN), mỗi ô là rule đang THẮNG, dòng cuối là tổng
// so trần. Ma trận không có luật riêng — nó gọi `chonQuyTac` / `quyTacChoNguonKhongRo` của engine. Các ca dưới đây canh đúng
// điều đó: ô khớp bộ chọn, UNKNOWN là mức thấp nhất, tổng so bằng SỐ NGUYÊN micro (9% đúng bằng trần, 9,0001% là vượt).
import { describe, expect, it } from "vitest";
import { THU_TU_PHAM_VI_MAC_DINH, type QuyTac } from "./chon-quy-tac";
import { dungMaTran, type MaTranDauVao } from "./ma-tran-chinh-sach";

const NOW = new Date("2026-11-10T03:00:00.000Z");
const NHOM = [
  { id: "g1", code: "PARENT_REFERRAL", name: "Phụ huynh giới thiệu", coHoaHong: true },
  { id: "g2", code: "PAID_ADS", name: "Quảng cáo", coHoaHong: true },
  { id: "g3", code: "WALK_IN", name: "Khách vãng lai", coHoaHong: true },
];
const VAI = [
  { code: "SALE", name: "Sale", isAcquisition: false },
  { code: "MARKETING", name: "Marketing", isAcquisition: false },
  { code: "CENTER_MANAGER", name: "Quản lý cơ sở", isAcquisition: false },
];

let seq = 0;
function qt(p: Partial<QuyTac> & { roleCode: string; giaTri: number | string }): QuyTac {
  seq += 1;
  return {
    ruleId: `r${seq}`,
    policyId: `p${seq}`,
    policyCode: `POL-${seq}`,
    versionId: `v${seq}`,
    version: 1,
    documentNumber: "SR.QD.1",
    scopeType: "GLOBAL",
    scopeKey: "GLOBAL",
    scope: {},
    orgUnitId: null,
    orgUnitPath: "/",
    orgUnitDepth: -1,
    transactionType: "NEW",
    revenueComponent: "TUITION",
    kieuTinh: "PERCENT",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    trangThai: "ACTIVE",
    ...p,
  };
}
const nhomRule = (roleCode: string, groupId: string, giaTri: number | string, p: Partial<QuyTac> = {}) =>
  qt({ roleCode, giaTri, scopeType: "SOURCE_GROUP", scopeKey: `SOURCE_GROUP:${groupId}`, scope: { sourceGroupId: groupId }, ...p });

const vao = (quyTac: QuyTac[], p: Partial<MaTranDauVao> = {}): MaTranDauVao => ({
  quyTac,
  nhomNguon: NHOM,
  vai: VAI,
  loai: "NEW",
  orgUnitPath: "/",
  rateDate: NOW,
  thuTuPhamVi: THU_TU_PHAM_VI_MAC_DINH,
  tran: 0.09,
  ...p,
});
const o = (m: ReturnType<typeof dungMaTran>, vai: string, cot: string) => m.dong.find((d) => d.vai.code === vai)!.o.find((x) => x.cot === cot)!;

describe("[NHH-FE-MT-01] khung: dòng = vai, cột = nhóm nguồn theo thứ tự + UNKNOWN cuối", () => {
  it("cột và dòng đúng thứ tự đầu vào; UNKNOWN luôn đứng cuối và được đánh dấu", () => {
    const m = dungMaTran(vao([]));
    expect(m.cot.map((c) => c.khoa)).toEqual(["g1", "g2", "g3", "UNKNOWN"]);
    expect(m.cot.map((c) => c.laUnknown)).toEqual([false, false, false, true]);
    expect(m.dong.map((d) => d.vai.code)).toEqual(["SALE", "MARKETING", "CENTER_MANAGER"]);
    expect(m.dong[0]!.o).toHaveLength(4);
  });

  it("không có rule nào ⇒ mọi ô KHONG_CO, tổng 0, không ai vượt trần", () => {
    const m = dungMaTran(vao([]));
    expect(m.dong.flatMap((d) => d.o).every((x) => x.kieu === "KHONG_CO")).toBe(true);
    expect(m.tong.every((t) => t.tongPhanTram === "0" && !t.vuotTran)).toBe(true);
  });
});

describe("[NHH-FE-MT-02] ô = rule THẮNG của engine (cụ thể thắng chung)", () => {
  it("chỉ có rule GLOBAL ⇒ mọi nhóm cùng mức và đều 'chung'", () => {
    const m = dungMaTran(vao([qt({ roleCode: "SALE", giaTri: "0.04" })]));
    for (const c of ["g1", "g2", "g3"]) {
      const x = o(m, "SALE", c);
      expect(x).toMatchObject({ kieu: "PERCENT", phanTram: "4", cuThe: false });
    }
  });

  it("rule theo nhóm nguồn thắng rule chung ở ĐÚNG nhóm đó; ô mang chính sách + version để nhảy tới", () => {
    const chung = qt({ roleCode: "SALE", giaTri: "0.04", policyCode: "CHUNG", policyId: "pc" });
    const rieng = nhomRule("SALE", "g2", "0.02", { policyCode: "RIENG", policyId: "pr", version: 3 });
    const m = dungMaTran(vao([chung, rieng]));
    expect(o(m, "SALE", "g2")).toMatchObject({ kieu: "PERCENT", phanTram: "2", cuThe: true, policyId: "pr", policyCode: "RIENG", version: 3 });
    expect(o(m, "SALE", "g1")).toMatchObject({ phanTram: "4", cuThe: false, policyId: "pc" });
  });

  it("[NHH-FE-MT-02b] rule của CƠ SỞ (chủ sở hữu CS1) thắng rule Hội sở khi xem tại CS1 — và KHÔNG áp khi xem toàn hệ thống", () => {
    const ho = qt({ roleCode: "SALE", giaTri: "0.04", policyCode: "HO" });
    const cs1 = qt({ roleCode: "SALE", giaTri: "0.05", policyCode: "CS1", orgUnitId: "ou1", orgUnitPath: "/ho/danang/cs1/", orgUnitDepth: 2 });
    const taiCs1 = dungMaTran(vao([ho, cs1], { orgUnitPath: "/ho/danang/cs1/" }));
    expect(o(taiCs1, "SALE", "g1")).toMatchObject({ phanTram: "5", policyCode: "CS1", cuThe: true });
    const toanHe = dungMaTran(vao([ho, cs1], { orgUnitPath: "/" }));
    expect(o(toanHe, "SALE", "g1")).toMatchObject({ phanTram: "4", policyCode: "HO", cuThe: false });
  });

  it("[NHH-FE-MT-02c] loại giao dịch lọc đúng: RENEWAL không lẫn NEW", () => {
    const rules = [qt({ roleCode: "SALE", giaTri: "0.04" }), qt({ roleCode: "SALE", giaTri: "0.01", transactionType: "RENEWAL" })];
    expect(o(dungMaTran(vao(rules, { loai: "NEW" })), "SALE", "g1").kieu).toBe("PERCENT");
    expect(o(dungMaTran(vao(rules, { loai: "NEW" })), "SALE", "g1")).toMatchObject({ phanTram: "4" });
    expect(o(dungMaTran(vao(rules, { loai: "RENEWAL" })), "SALE", "g1")).toMatchObject({ phanTram: "1" });
  });

  it("[NHH-FE-MT-02d] chỉ rule ĐANG hiệu lực tại rateDate: nháp, chưa tới ngày, đã hết hạn ⇒ không có", () => {
    const m = dungMaTran(
      vao([
        qt({ roleCode: "SALE", giaTri: "0.04", trangThai: "DRAFT" }),
        qt({ roleCode: "MARKETING", giaTri: "0.01", effectiveFrom: new Date("2026-12-01T00:00:00.000Z") }),
        qt({ roleCode: "CENTER_MANAGER", giaTri: "0.02", trangThai: "EXPIRED", effectiveTo: new Date("2026-11-01T00:00:00.000Z") }),
      ]),
    );
    expect(m.dong.flatMap((d) => d.o).every((x) => x.kieu === "KHONG_CO")).toBe(true);
  });

  it("[NHH-FE-MT-02e] rule EXCLUDE thắng và hiện là 'loại trừ' (0), không phải KHONG_CO", () => {
    const m = dungMaTran(vao([qt({ roleCode: "SALE", giaTri: "0.04" }), nhomRule("SALE", "g3", 0, { kieuTinh: "EXCLUDE" })]));
    expect(o(m, "SALE", "g3")).toMatchObject({ kieu: "EXCLUDE", cuThe: true });
    expect(o(m, "SALE", "g1").kieu).toBe("PERCENT");
  });

  it("[NHH-FE-MT-02f] hai rule cùng hạng ⇒ CHONG_LAN (không đoán), cột bị đánh dấu", () => {
    const m = dungMaTran(vao([qt({ roleCode: "SALE", giaTri: "0.04" }), qt({ roleCode: "SALE", giaTri: "0.05" })]));
    expect(o(m, "SALE", "g1").kieu).toBe("CHONG_LAN");
    expect(m.cot.find((c) => c.khoa === "g1")!.coChongLan).toBe(true);
  });

  it("[NHH-FE-MT-02g] rule số tiền cố định hiện đúng kiểu, không nhầm thành %", () => {
    const m = dungMaTran(vao([qt({ roleCode: "SALE", giaTri: 500000, kieuTinh: "FIXED_PER_PURCHASE" })]));
    expect(o(m, "SALE", "g1")).toMatchObject({ kieu: "CO_DINH", soTien: 500000 });
    // Cấy 08/10 (rà soát độc lập): bỏ `CO_DINH` khỏi nhánh "không tin được" XANH — cột có ô số tiền cố định thì số % cộng ở dòng tổng chưa gồm
    // khoản đó, phải được đánh dấu (dấu * ở chân bảng). Đối chứng: cột toàn PERCENT thì KHÔNG đánh dấu.
    expect(m.tong.find((t) => t.khoa === "g1")).toMatchObject({ khongTinDuoc: true });
    expect(dungMaTran(vao([qt({ roleCode: "SALE", giaTri: "0.04" })])).tong.find((t) => t.khoa === "g1")).toMatchObject({ khongTinDuoc: false });
  });
});

describe("[NHH-FE-MT-03] cột UNKNOWN = mức THẤP NHẤT của từng vai, tính động (D7)", () => {
  it("min theo SỐ TIỀN trên cơ sở chuẩn, kèm nhóm làm nên mức min", () => {
    const m = dungMaTran(vao([qt({ roleCode: "SALE", giaTri: "0.04" }), nhomRule("SALE", "g2", "0.02")]));
    expect(o(m, "SALE", "UNKNOWN")).toMatchObject({ kieu: "PERCENT", phanTram: "2", nhomMin: "PAID_ADS" });
  });

  it("hạ một nguồn xuống thấp hơn ⇒ UNKNOWN đi theo (không phải hằng gõ tay)", () => {
    const truoc = dungMaTran(vao([qt({ roleCode: "SALE", giaTri: "0.04" }), nhomRule("SALE", "g2", "0.02")]));
    const sau = dungMaTran(vao([qt({ roleCode: "SALE", giaTri: "0.04" }), nhomRule("SALE", "g2", "0.02"), nhomRule("SALE", "g3", "0.01")]));
    expect(o(truoc, "SALE", "UNKNOWN")).toMatchObject({ phanTram: "2" });
    expect(o(sau, "SALE", "UNKNOWN")).toMatchObject({ phanTram: "1", nhomMin: "WALK_IN" });
  });

  it("vai chỉ có rule ở MỘT nhóm (các nhóm kia không rule ⇒ 0) ⇒ UNKNOWN = KHONG_CO, vì min = 0", () => {
    const m = dungMaTran(vao([nhomRule("SALE", "g1", "0.04")]));
    expect(o(m, "SALE", "g1").kieu).toBe("PERCENT");
    expect(o(m, "SALE", "UNKNOWN").kieu).toBe("KHONG_CO");
  });

  it("một nhóm CHỒNG LẤN ⇒ cả ô UNKNOWN là CHONG_LAN", () => {
    const m = dungMaTran(vao([qt({ roleCode: "SALE", giaTri: "0.04" }), nhomRule("SALE", "g1", "0.03"), nhomRule("SALE", "g1", "0.02")]));
    expect(o(m, "SALE", "UNKNOWN").kieu).toBe("CHONG_LAN");
  });
});

describe("[NHH-FE-MT-04] dòng cuối: tổng mỗi cột so với trần ĐỌC TỪ THAM SỐ, so bằng số nguyên", () => {
  const nam = [
    qt({ roleCode: "SALE", giaTri: "0.04" }),
    qt({ roleCode: "MARKETING", giaTri: "0.03" }),
    qt({ roleCode: "CENTER_MANAGER", giaTri: "0.02" }),
  ];

  it("tổng 9% = đúng trần 9% ⇒ KHÔNG vượt (so bằng micro, không epsilon)", () => {
    const m = dungMaTran(vao(nam));
    expect(m.tong.find((t) => t.khoa === "g1")).toMatchObject({ tongPhanTram: "9", vuotTran: false });
  });

  it("9,0001% ⇒ vượt; trần lấy từ tham số (đổi 0.10 ⇒ hết vượt)", () => {
    const hon = [...nam.slice(0, 2), qt({ roleCode: "CENTER_MANAGER", giaTri: "0.020001" })];
    expect(dungMaTran(vao(hon)).tong.find((t) => t.khoa === "g1")).toMatchObject({ tongPhanTram: "9,0001", vuotTran: true });
    expect(dungMaTran(vao(hon, { tran: 0.1 })).tong.find((t) => t.khoa === "g1")).toMatchObject({ vuotTran: false });
  });

  it("chỉ cột bị vượt mới tô: rule riêng nhóm g2 đẩy g2 lên 10% còn g1, g3 giữ 9%", () => {
    const m = dungMaTran(vao([...nam, nhomRule("SALE", "g2", "0.05")]));
    expect(m.tong.filter((t) => t.vuotTran).map((t) => t.khoa)).toEqual(["g2"]);
    expect(m.tong.find((t) => t.khoa === "g2")!.tongPhanTram).toBe("10");
  });

  it("EXCLUDE và KHONG_CO góp 0 vào tổng; cột UNKNOWN cộng mức min từng vai", () => {
    const m = dungMaTran(vao([...nam, nhomRule("SALE", "g3", 0, { kieuTinh: "EXCLUDE" })]));
    expect(m.tong.find((t) => t.khoa === "g3")!.tongPhanTram).toBe("5");
    // UNKNOWN: SALE min = 0 (g3 loại) ⇒ KHONG_CO; MARKETING 3% + CM 2%
    expect(m.tong.find((t) => t.khoa === "UNKNOWN")!.tongPhanTram).toBe("5");
  });

  it("ô CHONG_LAN làm cột đánh dấu 'không tin được tổng' thay vì cộng đoán", () => {
    const m = dungMaTran(vao([...nam, qt({ roleCode: "SALE", giaTri: "0.05" })]));
    expect(m.tong.find((t) => t.khoa === "g1")).toMatchObject({ khongTinDuoc: true });
  });

  it("trả lại trần đã dùng để chân bảng in (không viết cứng 9%)", () => {
    expect(dungMaTran(vao(nam, { tran: 0.085 })).tranPhanTram).toBe("8,5");
  });
});
