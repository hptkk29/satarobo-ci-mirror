import { describe, expect, it } from "vitest";

import { kiemCheDoHocSinh } from "./che-do-hoc-sinh-thuan";

/** [SKR-13] Dữ liệu sức khoẻ của trẻ là việc của PHỤ HUYNH: Student Mode bị từ chối ở MỌI route lưu (allow-list mặc định từ chối). */
describe("[SKR-13] Student Mode không chạm sức khoẻ lưu trên máy chủ", () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    const pathname = "/api/mobile/v1/parent/health/records";
    it(`${method} ${pathname} ⇒ chặn khi đang ở chế độ học sinh`, () => {
      expect(kiemCheDoHocSinh({ pathname, method, hocSinhId: "hs-1" })).toMatchObject({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
    });
    it(`${method} ${pathname} ⇒ phiên phụ huynh không bị luật này chặn`, () => {
      expect(kiemCheDoHocSinh({ pathname, method, hocSinhId: null })).toEqual({ ok: true });
    });
  }
});
