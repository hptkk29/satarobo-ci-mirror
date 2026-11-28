/** [CTP-*] Hiển thị câu thi — phần thuần. */
import { describe, expect, it } from "vitest";
import { dauDungSai, laDungSai } from "./cau-thi-pure";

describe("[CTP-01] laDungSai", () => {
  it("chỉ TRUE_FALSE có đúng 2 lựa chọn", () => {
    expect(laDungSai("TRUE_FALSE", 2)).toBe(true);
    expect(laDungSai("TRUE_FALSE", 3)).toBe(false); // dữ liệu hỏng ⇒ danh sách thường, không vỡ bố cục
    expect(laDungSai("SINGLE", 2)).toBe(false);
    expect(laDungSai("MULTIPLE", 2)).toBe(false);
  });
});

describe("[CTP-02] dauDungSai — theo NHÃN (lựa chọn bị trộn)", () => {
  it("Đúng → ✓, Sai → ✕, không phân biệt hoa thường/khoảng trắng đầu", () => {
    expect(dauDungSai("Đúng")).toBe("✓");
    expect(dauDungSai("  đúng rồi")).toBe("✓");
    expect(dauDungSai("Sai")).toBe("✕");
    expect(dauDungSai("SAI")).toBe("✕");
  });
  it("nhãn lạ ⇒ không dấu (không đoán)", () => {
    expect(dauDungSai("Có")).toBe("");
    expect(dauDungSai("")).toBe("");
  });
});
