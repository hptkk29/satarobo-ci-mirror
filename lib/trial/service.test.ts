import { describe, it, expect } from "vitest";
import { buildTrialSessionDates, isOverCapacity } from "./service";

// 2026-06-01 là Thứ 2.
const MON = new Date(2026, 5, 1);

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("buildTrialSessionDates", () => {
  it("N buổi hàng tuần (mỗi 7 ngày), không nghỉ", () => {
    const dates = buildTrialSessionDates(MON, 4, []);
    expect(dates.map(ymd)).toEqual(["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22"]);
  });

  it("count 0 → []", () => {
    expect(buildTrialSessionDates(MON, 0, [])).toEqual([]);
  });

  it("buổi rơi vào Holiday → DỜI +7, tổng vẫn đủ N", () => {
    // Nghỉ 2026-06-08 (buổi 2) → buổi đó dời sang 15/06, đẩy phần sau lùi 1 tuần.
    const dates = buildTrialSessionDates(MON, 4, [new Date(2026, 5, 8)]);
    expect(dates).toHaveLength(4);
    expect(dates.map(ymd)).toEqual(["2026-06-01", "2026-06-15", "2026-06-22", "2026-06-29"]);
    expect(dates.map(ymd)).not.toContain("2026-06-08");
  });

  it("nhiều ngày nghỉ liên tiếp (cùng 1 mốc tuần) đều bị né", () => {
    // Nghỉ cả 01/06 và 08/06 → buổi 1 dời tới 15/06.
    const dates = buildTrialSessionDates(MON, 2, [new Date(2026, 5, 1), new Date(2026, 5, 8)]);
    expect(dates.map(ymd)).toEqual(["2026-06-15", "2026-06-22"]);
  });

  it("deterministic — gọi 2 lần cùng input ra cùng kết quả", () => {
    const a = buildTrialSessionDates(MON, 3, [new Date(2026, 5, 8)]).map(ymd);
    const b = buildTrialSessionDates(MON, 3, [new Date(2026, 5, 8)]).map(ymd);
    expect(a).toEqual(b);
  });
});

describe("isOverCapacity", () => {
  it("dưới sĩ số → không vượt", () => {
    expect(isOverCapacity(3, 5, false)).toBe(false);
  });
  it("bằng sĩ số, không override → vượt", () => {
    expect(isOverCapacity(5, 5, false)).toBe(true);
  });
  it("quá sĩ số, không override → vượt", () => {
    expect(isOverCapacity(6, 5, false)).toBe(true);
  });
  it("bằng/quá sĩ số nhưng override → không chặn", () => {
    expect(isOverCapacity(5, 5, true)).toBe(false);
    expect(isOverCapacity(9, 5, true)).toBe(false);
  });
});
