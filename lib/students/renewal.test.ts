import { describe, it, expect } from "vitest";
import { projectEndDate } from "./renewal";
import { ymdVN } from "@/lib/classes/schedule";

describe("projectEndDate", () => {
  const noHolidays = new Set<string>();

  it("đủ buổi đã tạo → trả ngày buổi thứ N", () => {
    const dates = [
      new Date(2026, 0, 5), // T2
      new Date(2026, 0, 7), // T4
      new Date(2026, 0, 12),
      new Date(2026, 0, 14),
    ];
    const end = projectEndDate({
      sessionDates: dates,
      totalLessons: 3,
      scheduleDays: [1, 3],
      holidays: noHolidays,
      fallbackStart: null,
    });
    expect(end && ymdVN(end)).toBe("2026-01-12");
  });

  it("thiếu buổi → chiếu tiếp từ buổi cuối theo scheduleDays", () => {
    const dates = [new Date(2026, 0, 5), new Date(2026, 0, 7)]; // T2,T4
    // cần 4 buổi, đã có 2 → chiếu thêm 2 buổi (T2/T4): 12, 14
    const end = projectEndDate({
      sessionDates: dates,
      totalLessons: 4,
      scheduleDays: [1, 3],
      holidays: noHolidays,
      fallbackStart: null,
    });
    expect(end && ymdVN(end)).toBe("2026-01-14");
  });

  it("chiếu tiếp né ngày nghỉ", () => {
    const dates = [new Date(2026, 0, 5)]; // T2
    // cần 3 buổi (T2/T4), nghỉ 2026-01-07 (T4) → buổi 2 dời 01-12, buổi 3 = 01-14
    const holidays = new Set(["2026-01-07"]);
    const end = projectEndDate({
      sessionDates: dates,
      totalLessons: 3,
      scheduleDays: [1, 3],
      holidays,
      fallbackStart: null,
    });
    expect(end && ymdVN(end)).toBe("2026-01-14");
  });

  it("chưa có buổi nào → chiếu từ fallbackStart", () => {
    const end = projectEndDate({
      sessionDates: [],
      totalLessons: 2,
      scheduleDays: [1, 3], // T2,T4
      holidays: noHolidays,
      fallbackStart: new Date(2026, 0, 5), // T2 05/01
    });
    expect(end && ymdVN(end)).toBe("2026-01-07");
  });

  it("không có lịch + không buổi → null", () => {
    expect(
      projectEndDate({ sessionDates: [], totalLessons: 5, scheduleDays: [], holidays: noHolidays, fallbackStart: null }),
    ).toBeNull();
  });

  it("totalLessons 0 → null", () => {
    expect(
      projectEndDate({
        sessionDates: [new Date(2026, 0, 5)],
        totalLessons: 0,
        scheduleDays: [1],
        holidays: noHolidays,
        fallbackStart: null,
      }),
    ).toBeNull();
  });
});
