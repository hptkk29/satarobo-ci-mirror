// R6-D4 — label registry: lookup + exhaustiveness check.
import { describe, it, expect } from "vitest";
import {
  makeLabelRegistry,
  ENROLLMENT_STATUS,
  ORDER_STATUS,
  PARENT_REQUEST_STATUS,
} from "./registry";

describe("[R6-D4] Label registry", () => {
  it("[R6-D4-T1-01] label lookup theo enum", () => {
    expect(ENROLLMENT_STATUS.label("PAUSED")).toBe("Bảo lưu");
    expect(ENROLLMENT_STATUS.label("STUDYING")).toBe("Đang học");
    expect(ORDER_STATUS.label("PENDING_PAYMENT")).toBe("Chờ thanh toán");
    expect(PARENT_REQUEST_STATUS.label("APPROVED")).toBe("Đã duyệt");
  });

  it("[R6-D4-T1-02] color lookup + has + fallback giá trị lạ", () => {
    expect(ENROLLMENT_STATUS.color("TRANSFERRED")).toBe("violet");
    expect(ENROLLMENT_STATUS.has("STUDYING")).toBe(true);
    expect(ENROLLMENT_STATUS.has("KHONG_CO")).toBe(false);
    expect(ENROLLMENT_STATUS.label("KHONG_CO")).toBe("KHONG_CO"); // fallback = chính nó
  });

  it("[R6-D4-T2-01] assertExhaustive: thiếu nhãn cho 1 giá trị → ném lỗi", () => {
    const partial = makeLabelRegistry<"A" | "B">({
      A: { label: "Alpha", color: "green" },
      B: { label: "Beta", color: "red" },
    });
    expect(() => partial.assertExhaustive(["A", "B"])).not.toThrow();
    // "C" không có nhãn → fail (mô phỏng enum thêm giá trị mới chưa cập nhật registry).
    expect(() => partial.assertExhaustive(["A", "B", "C"])).toThrow(/Thiếu nhãn/);
  });

  it("[R6-D4-T2-02] registry thật phủ đủ values của chính nó", () => {
    expect(() => ENROLLMENT_STATUS.assertExhaustive(ENROLLMENT_STATUS.values)).not.toThrow();
    expect(() => ORDER_STATUS.assertExhaustive(ORDER_STATUS.values)).not.toThrow();
  });
});
