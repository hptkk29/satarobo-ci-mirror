import { describe, expect, it } from "vitest";

import { kiemCheDoHocSinh } from "@/lib/mobile-api/che-do-hoc-sinh-thuan";

import { NGUONG_CHI_CON, SO_LUONG_TOI_DA_MAC_DINH, soLuongToiDaCuaSanPham, tonKhoHienThi } from "./danh-muc-hoc-cu";

describe("[SHOP-P] danh mục học cụ — hàm thuần + Student Mode", () => {
  it("[SHOP-P1] tonKhoHienThi: dồi dào/chỉ còn/hết; số tồn thật chỉ lộ khi CHI_CON", () => {
    expect(tonKhoHienThi(100)).toEqual({ trangThai: "CON_HANG", conLai: null });
    expect(tonKhoHienThi(NGUONG_CHI_CON + 1)).toEqual({ trangThai: "CON_HANG", conLai: null });
    expect(tonKhoHienThi(NGUONG_CHI_CON)).toEqual({ trangThai: "CHI_CON", conLai: NGUONG_CHI_CON });
    expect(tonKhoHienThi(1)).toEqual({ trangThai: "CHI_CON", conLai: 1 });
    expect(tonKhoHienThi(0)).toEqual({ trangThai: "HET_HANG", conLai: null });
    expect(tonKhoHienThi(-3)).toEqual({ trangThai: "HET_HANG", conLai: null });
    expect(tonKhoHienThi(8, 10)).toEqual({ trangThai: "CHI_CON", conLai: 8 });
  });
  it("[SHOP-P2] trần số lượng: cấu hình sản phẩm, mặc định 5", () => {
    expect(soLuongToiDaCuaSanPham(null)).toBe(SO_LUONG_TOI_DA_MAC_DINH);
    expect(soLuongToiDaCuaSanPham(2)).toBe(2);
  });
  const ROUTES: Array<[string, string]> = [
    ["GET", "/api/mobile/v1/online/shop/products"],
    ["GET", "/api/mobile/v1/online/shop/products/abc"],
    ["POST", "/api/mobile/v1/parent/shop/products/abc/restock-notify"],
    ["DELETE", "/api/mobile/v1/parent/shop/products/abc/restock-notify"],
  ];
  for (const [method, pathname] of ROUTES) {
    it(`[SHOP-P3] ${method} ${pathname} ⇒ chặn ở Student Mode, phụ huynh không bị chặn`, () => {
      expect(kiemCheDoHocSinh({ pathname, method, hocSinhId: "hs-1" })).toMatchObject({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
      expect(kiemCheDoHocSinh({ pathname, method, hocSinhId: null })).toEqual({ ok: true });
    });
  }
});
