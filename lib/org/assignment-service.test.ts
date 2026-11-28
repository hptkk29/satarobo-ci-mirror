// A0-08 — validateAllocation + isActiveAssignment (THUẦN). Pure, không DB.
import { describe, it, expect } from "vitest";
import {
  validateAllocation,
  isActiveAssignment,
  AssignmentError,
} from "@/lib/org/assignment-service";

const NOW = new Date("2026-06-08");

describe("[A0-08] validateAllocation (AC6)", () => {
  it("[A0-08-T3-01] biên 0 và 100 → OK; null → OK", () => {
    expect(() => validateAllocation(0)).not.toThrow();
    expect(() => validateAllocation(100)).not.toThrow();
    expect(() => validateAllocation(null)).not.toThrow();
  });
  it("[A0-08-T2-02] 101 / -1 / không nguyên → từ chối", () => {
    expect(() => validateAllocation(101)).toThrow(AssignmentError);
    expect(() => validateAllocation(-1)).toThrow(AssignmentError);
    expect(() => validateAllocation(50.5)).toThrow(AssignmentError);
  });
});

describe("[A0-08] isActiveAssignment (T7 lifecycle)", () => {
  const base = { status: "ACTIVE", effectiveFrom: new Date("2000-01-01"), effectiveTo: null as Date | null };
  it("ACTIVE vô thời hạn → active", () => {
    expect(isActiveAssignment(base, NOW)).toBe(true);
  });
  it("[A0-08-T7-01] effectiveTo < now → không active", () => {
    expect(isActiveAssignment({ ...base, effectiveTo: new Date("2020-01-01") }, NOW)).toBe(false);
  });
  it("effectiveFrom > now → không active", () => {
    expect(isActiveAssignment({ ...base, effectiveFrom: new Date("2099-01-01") }, NOW)).toBe(false);
  });
  it("[A0-08-T7-03] effectiveTo == now (biên) → còn active", () => {
    expect(isActiveAssignment({ ...base, effectiveTo: NOW }, NOW)).toBe(true);
  });
  it("[A0-08-T7-02] status EXPIRED → không active", () => {
    expect(isActiveAssignment({ ...base, status: "EXPIRED" }, NOW)).toBe(false);
  });
});
