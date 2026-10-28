import { describe, it, expect } from "vitest";
import {
  isNextMonthWindowOpen,
  isManagerImportWindowOpen,
  isWeekendEditWindow,
  emergencyLimitReached,
  lastDayOfMonth,
  needsLeaveRequest,
} from "./shifts";

describe("cửa sổ thời gian (PHẦN 6)", () => {
  it("đề xuất tháng sau mở 25–28", () => {
    expect(isNextMonthWindowOpen(new Date(2026, 5, 24))).toBe(false);
    expect(isNextMonthWindowOpen(new Date(2026, 5, 25))).toBe(true);
    expect(isNextMonthWindowOpen(new Date(2026, 5, 28))).toBe(true);
    expect(isNextMonthWindowOpen(new Date(2026, 5, 29))).toBe(false);
  });

  it("import mở trước ngày cuối tháng (tự nhận 30/31)", () => {
    // tháng 6 có 30 ngày
    expect(isManagerImportWindowOpen(new Date(2026, 5, 29))).toBe(true);
    expect(isManagerImportWindowOpen(new Date(2026, 5, 30))).toBe(false);
    // tháng 7 có 31 ngày
    expect(isManagerImportWindowOpen(new Date(2026, 6, 30))).toBe(true);
    expect(isManagerImportWindowOpen(new Date(2026, 6, 31))).toBe(false);
  });

  it("lastDayOfMonth", () => {
    expect(lastDayOfMonth(new Date(2026, 5, 1))).toBe(30); // T6
    expect(lastDayOfMonth(new Date(2026, 1, 1))).toBe(28); // T2/2026
  });

  it("cuối tuần để sửa", () => {
    expect(isWeekendEditWindow(new Date(2026, 5, 6))).toBe(true); // T7
    expect(isWeekendEditWindow(new Date(2026, 5, 7))).toBe(true); // CN
    expect(isWeekendEditWindow(new Date(2026, 5, 8))).toBe(false); // T2
  });

  it("trần khẩn cấp 3 lần/tháng", () => {
    expect(emergencyLimitReached(2)).toBe(false);
    expect(emergencyLimitReached(3)).toBe(true);
    expect(emergencyLimitReached(4)).toBe(true);
  });

  it("needsLeaveRequest khi < 2 ngày", () => {
    const now = new Date(2026, 5, 10);
    expect(needsLeaveRequest(now, new Date(2026, 5, 11))).toBe(true);
    expect(needsLeaveRequest(now, new Date(2026, 5, 15))).toBe(false);
  });
});
