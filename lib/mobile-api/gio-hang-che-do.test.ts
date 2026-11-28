import { describe, expect, it } from "vitest";

import { kiemCheDoHocSinh } from "./che-do-hoc-sinh-thuan";

/** [GL-14] Giỏ hàng Online là việc của PHỤ HUYNH: phiên khoá vào học viên (Student Mode) bị từ chối ở MỌI route giỏ (allow-list mặc định từ chối). */
describe("[GL-14] Student Mode không chạm giỏ hàng", () => {
  const ROUTES: Array<[string, string]> = [
    ["GET", "/api/mobile/v1/parent/cart"],
    ["PATCH", "/api/mobile/v1/parent/cart"],
    ["DELETE", "/api/mobile/v1/parent/cart"],
    ["POST", "/api/mobile/v1/parent/cart/items"],
    ["PATCH", "/api/mobile/v1/parent/cart/items/abc"],
    ["DELETE", "/api/mobile/v1/parent/cart/items/abc"],
    ["POST", "/api/mobile/v1/parent/cart/checkout"],
    ["POST", "/api/mobile/v1/parent/cart/dong-bi-go/xac-nhan"], // V8.42 (G16)
    ["GET", "/api/mobile/v1/parent/shipping/profile"], // V8.43 giao hàng
    ["PUT", "/api/mobile/v1/parent/shipping/profile"],
    ["GET", "/api/mobile/v1/parent/shipping/methods"],
  ];
  for (const [method, pathname] of ROUTES) {
    it(`${method} ${pathname} ⇒ chặn khi đang ở chế độ học sinh`, () => {
      expect(kiemCheDoHocSinh({ pathname, method, hocSinhId: "hs-1" })).toMatchObject({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
    });
    it(`${method} ${pathname} ⇒ phiên phụ huynh không bị luật này chặn`, () => {
      expect(kiemCheDoHocSinh({ pathname, method, hocSinhId: null })).toEqual({ ok: true });
    });
  }
});
