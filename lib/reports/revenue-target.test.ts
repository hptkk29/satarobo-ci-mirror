// LMS-16 — Doanh thu thực vs mục tiêu (THUẦN, không cần DB). Pure fixtures + assert.
import { describe, it, expect } from "vitest";
import {
  buildRevenueTargetReport,
  computeAchievement,
  revenueTargetSummary,
  type PaymentRecord,
  type RevenueTargetRow,
} from "@/lib/reports/revenue-target";

const d = (s: string) => new Date(s);

// Payment CONFIRMED (đã lọc ở tầng query). Giờ VN = UTC+7.
const payments: PaymentRecord[] = [
  { amount: 1_000_000, centerId: "c1", paidDate: d("2026-05-03T03:00:00Z") },
  { amount: 2_000_000, centerId: "c1", paidDate: d("2026-05-20T03:00:00Z") },
  { amount: 3_000_000, centerId: "c1", paidDate: d("2026-06-02T03:00:00Z") },
];

const targets: RevenueTargetRow[] = [
  { centerId: "c1", period: "2026-05", targetAmount: 3_000_000 }, // đạt đúng 100%
  { centerId: "c1", period: "2026-06", targetAmount: 6_000_000 }, // mới 50%
  { centerId: "c1", period: "2026-07", targetAmount: 5_000_000 }, // chưa có doanh thu
];

describe("[LMS-16] computeAchievement", () => {
  it("đủ %/chênh lệch khi có mục tiêu", () => {
    expect(computeAchievement(3_000_000, 6_000_000)).toEqual({
      achievedRate: 0.5,
      variance: -3_000_000,
      reached: false,
    });
    expect(computeAchievement(6_000_000, 6_000_000)).toMatchObject({
      achievedRate: 1,
      reached: true,
    });
  });
  it("target null → rate/variance null, reached false", () => {
    expect(computeAchievement(5_000_000, null)).toEqual({
      achievedRate: null,
      variance: null,
      reached: false,
    });
  });
  it("target 0 → rate null (chia-0 an toàn), không reached", () => {
    expect(computeAchievement(1_000_000, 0)).toEqual({
      achievedRate: null,
      variance: 1_000_000,
      reached: false,
    });
  });
});

describe("[LMS-16] buildRevenueTargetReport", () => {
  it("gom doanh thu thực theo tháng (paidDate) + ghép mục tiêu", () => {
    const rows = buildRevenueTargetReport(payments, targets);
    const byKey = Object.fromEntries(rows.map((r) => [r.period, r]));
    expect(rows.map((r) => r.period)).toEqual(["2026-05", "2026-06", "2026-07"]);

    // Tháng 05: 1tr + 2tr = 3tr, mục tiêu 3tr → đạt 100%.
    expect(byKey["2026-05"].actual).toBe(3_000_000);
    expect(byKey["2026-05"].target).toBe(3_000_000);
    expect(byKey["2026-05"].achievedRate).toBeCloseTo(1);
    expect(byKey["2026-05"].reached).toBe(true);

    // Tháng 06: 3tr / 6tr → 50%, chênh -3tr.
    expect(byKey["2026-06"].actual).toBe(3_000_000);
    expect(byKey["2026-06"].achievedRate).toBeCloseTo(0.5);
    expect(byKey["2026-06"].variance).toBe(-3_000_000);
    expect(byKey["2026-06"].reached).toBe(false);

    // Tháng 07: chưa có doanh thu nhưng có mục tiêu → actual 0.
    expect(byKey["2026-07"].actual).toBe(0);
    expect(byKey["2026-07"].target).toBe(5_000_000);
    expect(byKey["2026-07"].achievedRate).toBe(0);
  });

  it("kỳ có doanh thu nhưng KHÔNG có mục tiêu → target null", () => {
    const rows = buildRevenueTargetReport(payments, []);
    expect(rows.every((r) => r.target === null)).toBe(true);
    expect(rows.find((r) => r.period === "2026-05")?.actual).toBe(3_000_000);
  });

  it("rỗng → []", () => {
    expect(buildRevenueTargetReport([], [])).toEqual([]);
  });
});

describe("[LMS-16] revenueTargetSummary", () => {
  it("gộp actual/target + số kỳ đạt", () => {
    const rows = buildRevenueTargetReport(payments, targets);
    const s = revenueTargetSummary(rows);
    expect(s.totalActual).toBe(6_000_000); // 3tr + 3tr (+0 tháng 07)
    expect(s.totalTarget).toBe(14_000_000); // 3 + 6 + 5
    expect(s.targetedPeriods).toBe(3);
    expect(s.reachedPeriods).toBe(1); // chỉ tháng 05
    expect(s.achievedRate).toBeCloseTo(6_000_000 / 14_000_000);
  });
  it("không có mục tiêu → achievedRate null", () => {
    const rows = buildRevenueTargetReport(payments, []);
    expect(revenueTargetSummary(rows).achievedRate).toBeNull();
  });
});
