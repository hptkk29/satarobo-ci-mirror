import { describe, it, expect } from "vitest";
import { classifyAbsenceUrgency } from "./absence";

describe("classifyAbsenceUrgency", () => {
  const reported = new Date(2026, 5, 1); // 01/06/2026

  it("báo trước đúng 3 ngày = đúng hạn", () => {
    expect(classifyAbsenceUrgency(new Date(2026, 5, 4), reported)).toBe("ON_TIME");
  });

  it("báo trước >3 ngày = đúng hạn", () => {
    expect(classifyAbsenceUrgency(new Date(2026, 5, 10), reported)).toBe("ON_TIME");
  });

  it("báo trước 2 ngày = gấp", () => {
    expect(classifyAbsenceUrgency(new Date(2026, 5, 3), reported)).toBe("URGENT");
  });

  it("báo cùng ngày buổi học = gấp", () => {
    expect(classifyAbsenceUrgency(new Date(2026, 5, 1), reported)).toBe("URGENT");
  });

  it("báo sau buổi học (trễ) = gấp", () => {
    expect(classifyAbsenceUrgency(new Date(2026, 4, 30), reported)).toBe("URGENT");
  });

  it("bỏ qua giờ trong ngày — báo sáng cho buổi 3 ngày sau vẫn đúng hạn", () => {
    const reportedMorning = new Date(2026, 5, 1, 8, 0);
    const sessionEvening = new Date(2026, 5, 4, 20, 0);
    expect(classifyAbsenceUrgency(sessionEvening, reportedMorning)).toBe("ON_TIME");
  });
});
