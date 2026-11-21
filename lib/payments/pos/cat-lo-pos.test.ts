// [POS-CL] Cắt lô gửi lên server cho màn import file POS. THUẦN.
import { describe, it, expect } from "vitest";
import { catLoPos, loVuotTran, TRAN_GUI_MOT_LO } from "./cat-lo-pos";
import type { DongPos } from "./kieu";

let n = 0;
function dong(p: Partial<DongPos> = {}): DongPos {
  n += 1;
  return {
    maGiaoDich: `FT${String(n).padStart(10, "0")}`,
    loaiGiaoDich: "Thanh toán",
    hinhThuc: "Thẻ",
    trangThai: "Thành công",
    soTien: 1_500_000,
    thoiGian: "2026-09-29T17:31:35+07:00",
    dienGiai: "",
    maChuanChi: null,
    maGiaoDichThe: null,
    maGiaoDichGoc: null,
    trangThaiHoanHuy: null,
    maDonHang: null,
    maQuay: null,
    maThietBi: null,
    soTheMasked: null,
    loaiThe: null,
    maHachToan: null,
    phiGiaoDich: null,
    ...p,
  };
}

describe("[POS-CL] catLoPos", () => {
  it("[POS-CL-01] dòng Hủy đứng TRƯỚC gốc ở ranh giới lô ⇒ gốc vẫn đi lô trước dòng Hủy", () => {
    const goc = dong();
    const huy = dong({ loaiGiaoDich: "Hủy", soTien: -1_500_000, maGiaoDichGoc: goc.maGiaoDich });
    // File xếp giờ giảm dần: Hủy ở đầu, gốc ở cuối, lô 2 dòng.
    const lo = catLoPos([huy, dong(), dong(), goc], { dong: 2, byte: 1e9 });
    const loCuaGoc = lo.findIndex((l) => l.dong.some((d) => d.maGiaoDich === goc.maGiaoDich));
    const loCuaHuy = lo.findIndex((l) => l.dong.some((d) => d.maGiaoDich === huy.maGiaoDich));
    expect(loCuaGoc).toBeLessThanOrEqual(loCuaHuy);
    expect(lo.flatMap((l) => l.dong)).toHaveLength(4);
  });

  it("[POS-CL-02] lô mang kèm dòng hủy trỏ vào dòng TRONG lô — gồm cả dòng hủy Thất bại (server tự loại)", () => {
    const goc = dong();
    const khac = dong();
    const huyLoi = dong({ loaiGiaoDich: "Hủy", trangThai: "Thất bại", maGiaoDichGoc: goc.maGiaoDich });
    const lo = catLoPos([goc, khac, huyLoi], { dong: 1, byte: 1e9 });
    const loGoc = lo.find((l) => l.dong[0]!.maGiaoDich === goc.maGiaoDich)!;
    expect(loGoc.dongHuyCuaFile.map((h) => h.maGiaoDich)).toEqual([huyLoi.maGiaoDich]);
    expect(loGoc.dongHuyCuaFile[0]!.trangThai).toBe("Thất bại");
    const loKhac = lo.find((l) => l.dong[0]!.maGiaoDich === khac.maGiaoDich)!;
    expect(loKhac.dongHuyCuaFile, "không gửi dòng hủy không liên quan").toEqual([]);
  });

  it("[POS-CL-03] cắt theo BYTE: 300 dòng ghi chú 4.000 ký tự có dấu ⇒ mỗi lô dưới trần", () => {
    const dai = "Học phí bé Nguyễn Phương Quỳnh Anh ".repeat(120).slice(0, 4000);
    const tatCa = Array.from({ length: 300 }, () => dong({ dienGiai: dai }));
    const lo = catLoPos(tatCa);
    expect(lo.length).toBeGreaterThan(1);
    for (const l of lo) {
      expect(new TextEncoder().encode(JSON.stringify(l)).length).toBeLessThan(700_000);
    }
    expect(lo.flatMap((l) => l.dong)).toHaveLength(300);
  });

  it("[POS-CL-04] loVuotTran: MỘT dòng ghi chú quá dài ⇒ lô của nó vượt trần gửi; lô thường thì không", () => {
    const qua = dong({ dienGiai: "x".repeat(TRAN_GUI_MOT_LO) });
    const lo = catLoPos([dong(), qua, dong()]);
    const loQua = lo.find((l) => l.dong.some((d) => d.maGiaoDich === qua.maGiaoDich))!;
    expect(loVuotTran(loQua)).toBe(true);
    expect(lo.filter(loVuotTran)).toHaveLength(1);
    const dai = "Học phí bé Nguyễn Phương Quỳnh Anh ".repeat(120).slice(0, 4000);
    expect(catLoPos(Array.from({ length: 300 }, () => dong({ dienGiai: dai }))).some(loVuotTran)).toBe(false);
  });
});
