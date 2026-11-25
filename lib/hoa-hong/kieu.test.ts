// @vitest-environment node
/**
 * [NHH-KIEU-01] — `batLyDoToiThieu`: lý do ≥ 10 ký tự SAU KHI cắt khoảng trắng. THUẦN.
 *
 * Vì sao có tệp này (lượt cấy lỗi PR5b/PR5c, 08/10): cổng này đứng trước MỌI thao tác tiền cần giải trình (giải hàng chờ, đặt mốc cutover, khoá kỳ, dời hàng chờ…).
 * Hai biên không ca nào ghim: hạ ngưỡng 10 → 9, và bỏ `.trim()` (mười dấu cách thành "lý do hợp lệ") ⇒ cấy cả hai: 0 ca đỏ.
 */
import { describe, expect, it } from "vitest";

import { HoaHongError, LY_DO_TOI_THIEU, batLyDoToiThieu } from "./kieu";

describe("[NHH-KIEU-01] batLyDoToiThieu", () => {
  it("ngưỡng là 10: đúng 10 ký tự qua, 9 ký tự bị từ chối (biên)", () => {
    expect(LY_DO_TOI_THIEU).toBe(10);
    expect(batLyDoToiThieu("a".repeat(10), "Khoá kỳ")).toBe("a".repeat(10));
    expect(() => batLyDoToiThieu("a".repeat(9), "Khoá kỳ")).toThrowError(HoaHongError);
  });

  it("đếm SAU khi cắt khoảng trắng đầu/cuối: 10 dấu cách KHÔNG phải lý do; 9 ký tự có đệm hai đầu cũng không", () => {
    expect(() => batLyDoToiThieu(" ".repeat(10), "Khoá kỳ")).toThrowError(HoaHongError);
    expect(() => batLyDoToiThieu("   " + "a".repeat(9) + "   ", "Khoá kỳ")).toThrowError(HoaHongError);
    expect(batLyDoToiThieu("   " + "a".repeat(10) + "   ", "Khoá kỳ")).toBe("a".repeat(10)); // trả về bản ĐÃ cắt
  });

  it("null / undefined / rỗng ⇒ THIEU_LY_DO; câu lỗi nêu đúng thao tác và con số ngưỡng", () => {
    for (const x of [null, undefined, ""]) {
      try {
        batLyDoToiThieu(x, "Đặt mốc cutover");
        throw new Error("phải ném");
      } catch (e) {
        expect(e).toBeInstanceOf(HoaHongError);
        expect((e as HoaHongError).ma).toBe("THIEU_LY_DO");
        expect((e as HoaHongError).message).toContain("Đặt mốc cutover");
        expect((e as HoaHongError).message).toContain("10");
      }
    }
  });
});
