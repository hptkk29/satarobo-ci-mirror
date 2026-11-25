import { describe, expect, it } from "vitest";
import { CHU_DE_GOP_Y, noiDungGopY } from "@/lib/portal/gop-y-thuan";

describe("[GY-01] nội dung góp ý", () => {
  it("chủ đề đi đầu nội dung", () => {
    expect(noiDungGopY("Học phí", "  Muốn đóng theo tháng ")).toBe("[Học phí] Muốn đóng theo tháng");
  });
  it("nội dung rỗng ⇒ rỗng (không bịa chữ để qua kiểm tra độ dài)", () => {
    expect(noiDungGopY("Khác", "   ")).toBe("");
  });
  it("có đủ chủ đề của thiết kế", () => {
    expect(CHU_DE_GOP_Y).toHaveLength(5);
  });
});
