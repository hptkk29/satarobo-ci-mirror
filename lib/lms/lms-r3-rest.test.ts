// R3 (phần còn lại) — assignment/checklist/session-gen THUẦN. Pure.
import { describe, it, expect } from "vitest";
import { ASSIGNMENT_CONTENT_TYPES, isValidContentType, isLateSubmission } from "@/lib/lms/assignment";
import { isChecklistComplete, missingRequiredSteps } from "@/lib/lms/checklist";
import { generateSessionDates } from "@/lib/lms/session-gen";

describe("[R3-08] assignment", () => {
  it("[R3-08-C8.1] 6 loại nội dung", () => {
    expect(ASSIGNMENT_CONTENT_TYPES).toEqual(["IMAGE", "VIDEO", "FILE", "QUIZ", "TEXT", "PROJECT"]);
    expect(isValidContentType("QUIZ")).toBe(true);
    expect(isValidContentType("AUDIO")).toBe(false);
  });
  it("[R3-08-C8.3] nộp trễ nếu vượt hạn", () => {
    const due = new Date("2026-06-10T23:59:00Z");
    expect(isLateSubmission(due, new Date("2026-06-11T00:00:00Z"))).toBe(true);
    expect(isLateSubmission(due, new Date("2026-06-10T20:00:00Z"))).toBe(false);
    expect(isLateSubmission(null, new Date())).toBe(false); // không hạn
  });
});

describe("[R3-05] checklist", () => {
  it("[R3-05-C5.2] đủ bước bắt buộc mới hoàn tất", () => {
    expect(isChecklistComplete(["attendance", "lesson", "feedback", "homework"])).toBe(true);
    expect(isChecklistComplete(["attendance", "lesson"])).toBe(false);
    expect(missingRequiredSteps(["attendance", "lesson"])).toEqual(["feedback", "homework"]);
  });
});

describe("[R3-02] session generation (né Holiday)", () => {
  it("[R3-02-C2.2] sinh buổi theo thứ, bỏ ngày nghỉ", () => {
    // start thứ 2 2026-06-08; weekdays = T2(1),T4(3); holiday 2026-06-10 (T4)
    const dates = generateSessionDates({
      start: new Date("2026-06-08T00:00:00Z"),
      count: 3,
      weekdays: [1, 3],
      holidays: [new Date("2026-06-10T00:00:00Z")],
    });
    const keys = dates.map((d) => d.toISOString().slice(0, 10));
    expect(keys).toEqual(["2026-06-08", "2026-06-15", "2026-06-17"]); // bỏ 06-10 (nghỉ), nhảy sang T2 tuần sau
  });
});
