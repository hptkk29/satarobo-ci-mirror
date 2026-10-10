import { describe, it, expect } from "vitest";
import { normalizeAffiliateCode } from "./index";

// BGĐ 31/07 — mã giới thiệu trong link ?ref= phải khớp bất kể người dùng gõ kiểu gì.

describe("normalizeAffiliateCode", () => {
  it("viết hoa + bỏ ký tự lạ", () => {
    expect(normalizeAffiliateCode("an-nguyen")).toBe("ANNGUYEN");
    expect(normalizeAffiliateCode("AN NGUYEN")).toBe("ANNGUYEN");
    expect(normalizeAffiliateCode("  sata_2026!  ")).toBe("SATA2026");
  });

  it("bỏ dấu tiếng Việt (đ → D)", () => {
    expect(normalizeAffiliateCode("Đức Anh")).toBe("DUCANH");
  });

  it("mã quá ngắn / rỗng → null (không gắn nhầm)", () => {
    expect(normalizeAffiliateCode("ab")).toBeNull();
    expect(normalizeAffiliateCode("!!")).toBeNull();
    expect(normalizeAffiliateCode("")).toBeNull();
    expect(normalizeAffiliateCode(null)).toBeNull();
  });

  it("cắt tối đa 32 ký tự", () => {
    expect(normalizeAffiliateCode("A".repeat(50))).toHaveLength(32);
  });
});
