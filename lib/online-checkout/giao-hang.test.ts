import { describe, expect, it } from "vitest";

import { chuanHoaTinh, diaChiMotDong, kiemDiaChi, tinhPhiTheoRate } from "./giao-hang";

const OK = { hoTen: "  Nguyễn  Thu Hà ", soDienThoai: "0905 412 118", tinhThanh: "TP Đà Nẵng", phuongXa: "P. Ngũ Hành Sơn", soNhaDuong: "12 Lê Văn Hiến" };

describe("[GHG-P] giao hàng — hàm thuần", () => {
  it("[GHG-P1] chuanHoaTinh: bỏ dấu, bỏ tiền tố, khoảng trắng", () => {
    for (const s of ["Đà Nẵng", "TP Đà Nẵng", "TP. Đà Nẵng", "Thành phố Đà Nẵng", "  thành phố  đà  nẵng ", "DA NANG", "Tỉnh Đà Nẵng"]) expect(chuanHoaTinh(s), s).toBe("da nang");
    expect(chuanHoaTinh("Thừa Thiên Huế")).toBe("thua thien hue");
    expect(chuanHoaTinh("Hồ Chí Minh")).toBe("ho chi minh");
    expect(chuanHoaTinh("   ")).toBe("");
    expect(chuanHoaTinh("Đà Nẵng")).not.toBe(chuanHoaTinh("Quảng Nam"));
  });
  it("[GHG-P2] kiemDiaChi: đủ 5 trường, cắt khoảng trắng, chuẩn hoá SĐT", () => {
    const r = kiemDiaChi(OK);
    expect(r).toMatchObject({ ok: true, data: { hoTen: "Nguyễn Thu Hà", soDienThoai: "0905412118", tinhThanh: "TP Đà Nẵng" } });
    for (const k of ["hoTen", "soDienThoai", "tinhThanh", "phuongXa", "soNhaDuong"] as const) {
      expect(kiemDiaChi({ ...OK, [k]: "  " }), k).toMatchObject({ ok: false, truong: k });
      expect(kiemDiaChi({ ...OK, [k]: undefined }), k).toMatchObject({ ok: false, truong: k });
      expect(kiemDiaChi({ ...OK, [k]: 123 }), k).toMatchObject({ ok: false, truong: k });
    }
    expect(kiemDiaChi({ ...OK, soNhaDuong: "x".repeat(161) })).toMatchObject({ ok: false, truong: "soNhaDuong" });
  });
  it("[GHG-P3] SĐT Việt Nam: 0xx/84xx/+84xx hợp lệ; số lạ ⇒ từ chối", () => {
    for (const s of ["0905412118", "0905 412 118", "+84905412118", "84905412118", "0356789012", "0812345678"]) expect(kiemDiaChi({ ...OK, soDienThoai: s }), s).toMatchObject({ ok: true });
    for (const s of ["123", "0205412118", "09054121", "090541211899", "abcdefghij", "'; DROP TABLE x;--"]) expect(kiemDiaChi({ ...OK, soDienThoai: s }), s).toMatchObject({ ok: false, truong: "soDienThoai" });
  });
  it("[GHG-P4] tinhPhiTheoRate: miễn khi đạt ngưỡng; không bao giờ âm", () => {
    expect(tinhPhiTheoRate({ fee: 30_000, freeAboveAmount: null }, 5_000_000)).toBe(30_000);
    expect(tinhPhiTheoRate({ fee: 30_000, freeAboveAmount: 1_000_000 }, 999_999)).toBe(30_000);
    expect(tinhPhiTheoRate({ fee: 30_000, freeAboveAmount: 1_000_000 }, 1_000_000)).toBe(0);
    expect(tinhPhiTheoRate({ fee: -5, freeAboveAmount: null }, 0)).toBe(0);
    expect(tinhPhiTheoRate({ fee: 0, freeAboveAmount: 0 }, 0)).toBe(0);
  });
  it("[GHG-P5] diaChiMotDong", () => {
    expect(diaChiMotDong({ soNhaDuong: "12 Lê Văn Hiến", phuongXa: "P. Ngũ Hành Sơn", tinhThanh: "TP Đà Nẵng" })).toBe("12 Lê Văn Hiến, P. Ngũ Hành Sơn, TP Đà Nẵng");
  });
});
