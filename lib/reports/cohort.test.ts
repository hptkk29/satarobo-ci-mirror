// LMS-16 — Báo cáo cohort tiến độ (THUẦN, không cần DB). Pure fixtures + assert.
import { describe, it, expect } from "vitest";
import {
  buildCohortReport,
  enrollmentProgress,
  pct,
  type CohortEnrollmentRecord,
} from "@/lib/reports/cohort";

const d = (s: string) => new Date(s);

// Cohort 2026-05: 2 enrollment. Cohort 2026-06: 3 enrollment.
const records: CohortEnrollmentRecord[] = [
  // 2026-05 cohort
  { cohortDate: d("2026-05-02T03:00:00Z"), status: "COMPLETED", totalSessions: 10, completedSessions: 10 },
  { cohortDate: d("2026-05-10T03:00:00Z"), status: "WITHDREW", totalSessions: 10, completedSessions: 4 },
  // 2026-06 cohort
  { cohortDate: d("2026-06-01T03:00:00Z"), status: "STUDYING", totalSessions: 10, completedSessions: 5 },
  { cohortDate: d("2026-06-03T03:00:00Z"), status: "ACTIVE", totalSessions: 8, completedSessions: 2 },
  { cohortDate: d("2026-06-05T03:00:00Z"), status: "TRANSFERRED", totalSessions: 0, completedSessions: 0 },
];

describe("[LMS-16] enrollmentProgress", () => {
  it("completed/total, clamp ≤ 1, total=0 → 0", () => {
    expect(enrollmentProgress(records[0])).toBe(1); // 10/10
    expect(enrollmentProgress(records[2])).toBe(0.5); // 5/10
    expect(enrollmentProgress(records[4])).toBe(0); // total 0
    expect(pct(1, 0)).toBe(0);
  });
});

describe("[LMS-16] buildCohortReport", () => {
  it("nhóm theo tháng VN, sắp xếp tăng dần", () => {
    const r = buildCohortReport(records);
    expect(r.rows.map((x) => x.cohort)).toEqual(["2026-05", "2026-06"]);
    expect(r.totalEnrollments).toBe(5);
  });

  it("cohort 2026-05: tiến độ TB + phân rã trạng thái", () => {
    const c = buildCohortReport(records).rows.find((x) => x.cohort === "2026-05")!;
    expect(c.total).toBe(2);
    // progress = mean(1.0, 0.4) = 0.7 → 70%
    expect(c.avgProgress).toBe(70);
    expect(c.completed).toBe(1);
    expect(c.withdrew).toBe(1);
    expect(c.studying).toBe(0);
    expect(c.completionRate).toBe(50);
    expect(c.withdrewRate).toBe(50);
  });

  it("cohort 2026-06: đang học + rút (TRANSFERRED)", () => {
    const c = buildCohortReport(records).rows.find((x) => x.cohort === "2026-06")!;
    expect(c.total).toBe(3);
    expect(c.studying).toBe(2); // STUDYING + ACTIVE
    expect(c.withdrew).toBe(1); // TRANSFERRED
    expect(c.completed).toBe(0);
    // progress = mean(0.5, 0.25, 0) = 0.25 → 25%
    expect(c.avgProgress).toBe(25);
  });

  it("input rỗng → không lỗi", () => {
    const r = buildCohortReport([]);
    expect(r.totalEnrollments).toBe(0);
    expect(r.rows).toEqual([]);
  });
});
