import { describe, it, expect } from "vitest";
import {
  shouldRestrictToOwnClasses,
  summarizeSubmissions,
  type SubmissionStatusLite,
} from "./materials";

describe("shouldRestrictToOwnClasses", () => {
  it("plain TEACHER → giới hạn lớp được giao", () => {
    expect(shouldRestrictToOwnClasses(["TEACHER"])).toBe(true);
  });

  it("SUPER_ADMIN / TRAINING / CENTER_MANAGER → KHÔNG giới hạn (xem theo cơ sở)", () => {
    expect(shouldRestrictToOwnClasses(["SUPER_ADMIN"])).toBe(false);
    expect(shouldRestrictToOwnClasses(["TRAINING"])).toBe(false);
    expect(shouldRestrictToOwnClasses(["CENTER_MANAGER"])).toBe(false);
  });

  it("đa vai trò: rộng-thắng (TEACHER + CENTER_MANAGER → không giới hạn)", () => {
    expect(shouldRestrictToOwnClasses(["TEACHER", "CENTER_MANAGER"])).toBe(false);
    expect(shouldRestrictToOwnClasses(["TEACHER", "TRAINING"])).toBe(false);
  });

  it("vai trò không liên quan / rỗng → không giới hạn (gate quyền do can() lo)", () => {
    expect(shouldRestrictToOwnClasses([])).toBe(false);
    expect(shouldRestrictToOwnClasses(["ACCOUNTANT"])).toBe(false);
  });
});

describe("summarizeSubmissions", () => {
  it("đếm đã nộp / đã chấm / muộn; chưa nộp suy từ sĩ số", () => {
    const statuses: SubmissionStatusLite[] = [
      "SUBMITTED",
      "GRADED",
      "LATE",
      "NOT_SUBMITTED",
    ];
    const s = summarizeSubmissions(statuses, 10);
    expect(s.total).toBe(10);
    expect(s.submitted).toBe(3); // SUBMITTED + GRADED + LATE
    expect(s.graded).toBe(1);
    expect(s.late).toBe(1);
    expect(s.notSubmitted).toBe(7); // 10 - 3
  });

  it("không bản ghi nào → tất cả chưa nộp", () => {
    const s = summarizeSubmissions([], 5);
    expect(s).toEqual({ total: 5, submitted: 0, graded: 0, late: 0, notSubmitted: 5 });
  });

  it("clamp chưa nộp ≥ 0 khi submission nhiều hơn sĩ số (HS đã rời lớp)", () => {
    const s = summarizeSubmissions(["SUBMITTED", "SUBMITTED", "GRADED"], 2);
    expect(s.submitted).toBe(3);
    expect(s.notSubmitted).toBe(0);
  });
});
