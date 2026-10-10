import { describe, it, expect } from "vitest";
import { dayKey, monthGrid, shiftMonth, monthGridRange } from "@/lib/lms/calendar";

describe("calendar", () => {
  it("dayKey không bị UTC shift", () => {
    expect(dayKey(new Date(2026, 5, 1, 17, 30))).toBe("2026-06-01");
  });

  it("monthGrid: tuần bắt đầu T2, phủ đủ ngày tháng", () => {
    const g = monthGrid(2026, 5); // June 2026, 1/6 là thứ Hai
    expect(g[0][0].iso).toBe("2026-06-01"); // ô đầu = T2 1/6
    expect(g[0][0].inMonth).toBe(true);
    // mọi ngày trong tháng đều xuất hiện
    const all = g.flat().filter((d) => d.inMonth).map((d) => d.iso);
    expect(all).toContain("2026-06-30");
    expect(new Set(all).size).toBe(30);
  });

  it("monthGrid: ngày tràn từ tháng kề đánh inMonth=false", () => {
    const g = monthGrid(2026, 6); // July 2026, 1/7 là thứ Tư → có ô tràn của tháng 6
    expect(g[0][0].inMonth).toBe(false);
  });

  it("shiftMonth qua biên năm", () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month0: 11 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month0: 0 });
  });

  it("monthGridRange bao trọn lưới", () => {
    const { from, to } = monthGridRange(2026, 5);
    expect(from.getTime()).toBeLessThanOrEqual(new Date(2026, 5, 1).getTime());
    expect(to.getTime()).toBeGreaterThan(new Date(2026, 5, 30).getTime());
  });
});
