import { describe, it, expect } from "vitest";
import {
  formatVndPlain,
  formatVndCompact,
  formatVndInput,
  parseVndInput,
} from "@/lib/format/money";

describe("formatVndPlain", () => {
  it("mặc định có khoảng trắng trước đ", () => {
    expect(formatVndPlain(1000000)).toBe("1.000.000 đ");
    expect(formatVndPlain(0)).toBe("0 đ");
  });
  it("withSpace=false → dính đ (giữ đúng site template cũ)", () => {
    expect(formatVndPlain(1500000, false)).toBe("1.500.000đ");
  });
});

describe("formatVndCompact", () => {
  it("rút gọn theo tr/tỷ/k cho trục biểu đồ", () => {
    expect(formatVndCompact(10_000_000)).toBe("10tr");
    expect(formatVndCompact(7_500_000)).toBe("7,5tr");
    expect(formatVndCompact(1_500_000_000)).toBe("1,5 tỷ");
    expect(formatVndCompact(900_000)).toBe("900k");
    expect(formatVndCompact(500)).toBe("500");
    expect(formatVndCompact(0)).toBe("0");
  });
});

describe("parseVndInput", () => {
  it("bóc dấu chấm / khoảng trắng / hậu tố tiền tệ", () => {
    expect(parseVndInput("10.000.000")).toBe(10_000_000);
    expect(parseVndInput("1.500.000 đ")).toBe(1_500_000);
    expect(parseVndInput("1 500 000₫")).toBe(1_500_000);
    expect(parseVndInput("2,500,000 VND")).toBe(2_500_000);
    expect(parseVndInput("10000000")).toBe(10_000_000);
  });

  it("bỏ số 0 thừa ở đầu", () => {
    expect(parseVndInput("007")).toBe(7);
    expect(parseVndInput("0")).toBe(0);
  });

  it("rỗng / rác / chỉ mỗi dấu trừ → null (phân biệt với số 0)", () => {
    expect(parseVndInput("")).toBeNull();
    expect(parseVndInput("   ")).toBeNull();
    expect(parseVndInput("abc")).toBeNull();
    expect(parseVndInput("đ")).toBeNull();
    expect(parseVndInput("-", { allowNegative: true })).toBeNull();
  });

  it("dấu trừ chỉ tính khi bật allowNegative", () => {
    expect(parseVndInput("-1.000.000")).toBe(1_000_000);
    expect(parseVndInput("-1.000.000", { allowNegative: true })).toBe(-1_000_000);
    expect(parseVndInput("-0", { allowNegative: true })).toBe(0); // không đẻ ra -0
    // Dấu trừ giữa chuỗi không phải số âm.
    expect(parseVndInput("1.000-000", { allowNegative: true })).toBe(1_000_000);
  });

  it("số vượt ngưỡng an toàn của JS → null thay vì trả số sai", () => {
    expect(parseVndInput("999999999999999")).toBe(999_999_999_999_999);
    expect(parseVndInput("99999999999999999999")).toBeNull();
  });
});

describe("formatVndInput", () => {
  it("chèn dấu chấm mỗi 3 chữ số, KHÔNG kèm hậu tố đ", () => {
    expect(formatVndInput(0)).toBe("0");
    expect(formatVndInput(1)).toBe("1");
    expect(formatVndInput(999)).toBe("999");
    expect(formatVndInput(1000)).toBe("1.000");
    expect(formatVndInput(10_000_000)).toBe("10.000.000");
    expect(formatVndInput(1_500_000_000)).toBe("1.500.000.000");
  });

  it("số âm giữ dấu trừ", () => {
    expect(formatVndInput(-1_500_000)).toBe("-1.500.000");
    expect(formatVndInput(-0)).toBe("0");
  });

  it("null / undefined / chuỗi rỗng → chuỗi rỗng (ô nhập để trống)", () => {
    expect(formatVndInput(null)).toBe("");
    expect(formatVndInput(undefined)).toBe("");
    expect(formatVndInput("")).toBe("");
    expect(formatVndInput("abc")).toBe("");
  });

  it("nhận cả chuỗi đã có dấu sẵn (giá trị người dùng vừa dán)", () => {
    expect(formatVndInput("10000000")).toBe("10.000.000");
    expect(formatVndInput("1.500.000 đ")).toBe("1.500.000");
    expect(formatVndInput("007")).toBe("7");
    expect(formatVndInput("-1500000")).toBe("-1.500.000");
  });

  it("khứ hồi parse ↔ format giữ nguyên giá trị", () => {
    for (const n of [0, 5, 999, 1000, 10_000_000, 123_456_789]) {
      expect(parseVndInput(formatVndInput(n))).toBe(n);
    }
  });
});
