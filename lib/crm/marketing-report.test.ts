// R1-12 — helper kỳ báo cáo (THUẦN). Pure.
import { describe, it, expect } from "vitest";
import { monthKeyOf, previousMonthKey, isMonthlyDeadlinePassed } from "@/lib/crm/marketing-report";

describe("[R1-12] period helpers", () => {
  it("monthKeyOf / previousMonthKey", () => {
    expect(monthKeyOf(new Date("2026-06-15T00:00:00Z"))).toBe("2026-06");
    expect(previousMonthKey(new Date("2026-07-10T00:00:00Z"))).toBe("2026-06");
    expect(previousMonthKey(new Date("2026-01-10T00:00:00Z"))).toBe("2025-12"); // qua năm
  });

  it("[R1-12-C12.3/R1-09-C9.5] isMonthlyDeadlinePassed (ngày 05)", () => {
    expect(isMonthlyDeadlinePassed(new Date("2026-07-10T00:00:00Z"))).toBe(true);
    expect(isMonthlyDeadlinePassed(new Date("2026-07-05T00:00:00Z"))).toBe(true); // >= 5
    expect(isMonthlyDeadlinePassed(new Date("2026-07-03T00:00:00Z"))).toBe(false);
  });
});
