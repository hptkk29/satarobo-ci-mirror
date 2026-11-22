import { describe, it, expect } from "vitest";
import { can } from "./permissions";

/**
 * Ai được XUẤT danh sách lead ra file (chốt 31/08/2026).
 *
 * Xuất cả danh sách khách hàng ra một file mang đi được là việc khác hẳn "xem được lead
 * của người khác". Trước đợt này route `/api/admin/leads/export` gác nhầm bằng
 * `leads:view-all`, và `leads:export` thì còn cấp cho MARKETING.
 */
describe("[LEADEXP-01] leads:export — chỉ QLCS + Quản trị tối cao", () => {
  it("SUPER_ADMIN được xuất", () => {
    expect(can("SUPER_ADMIN", "leads:export")).toBe(true);
  });

  it("CENTER_MANAGER (QLCS) được xuất", () => {
    expect(can("CENTER_MANAGER", "leads:export")).toBe(true);
  });

  it("MARKETING KHÔNG còn được xuất", () => {
    // Đây là phần bị gỡ 31/08. MARKETING vẫn xem được lead (`leads:view-all`) nhưng
    // không mang cả danh sách đi được nữa — hai việc khác nhau.
    expect(can("MARKETING", "leads:export")).toBe(false);
    expect(can("MARKETING", "leads:view-all")).toBe(true);
  });

  it("các vai còn lại đều không được xuất", () => {
    for (const role of ["SALES_CSM", "TEACHER", "ACCOUNTANT", "HR", "TRAINING", "PARENT"] as const) {
      expect(can(role, "leads:export")).toBe(false);
    }
  });
});
