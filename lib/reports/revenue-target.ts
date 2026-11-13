// lib/reports/revenue-target.ts — LMS-16: Doanh thu THỰC vs MỤC TIÊU theo kỳ + cơ sở.
// HÀM THUẦN: nhận mảng Payment đã CONFIRMED (đã lọc accountantStatus=CONFIRMED +
// deletedAt:null ở tầng query) + mảng RevenueTarget → ghép theo kỳ, tính % đạt +
// chênh lệch. KHÔNG gọi DB ở đây. Mirror style lib/reports/lead.ts.
import { monthKeyVN } from "@/lib/reports/lead";

/** Record Payment phẳng (đã lọc CONFIRMED + chưa xóa) cho báo cáo doanh thu. */
export type PaymentRecord = {
  amount: number;
  centerId: string | null;
  /** Ngày thanh toán — gom doanh thu theo kỳ (tháng VN) của ngày này. */
  paidDate: Date;
};

/** Mục tiêu doanh thu của 1 (centerId, period). */
export type RevenueTargetRow = {
  centerId: string | null;
  period: string; // "YYYY-MM"
  targetAmount: number;
};

export type Achievement = {
  /** actual / target — null nếu chưa đặt mục tiêu (hoặc target ≤ 0). */
  achievedRate: number | null;
  /** actual - target — null nếu chưa đặt mục tiêu. */
  variance: number | null;
  /** Đã đạt mục tiêu (target > 0 và actual ≥ target). */
  reached: boolean;
};

/** Tính % đạt + chênh lệch của 1 kỳ. THUẦN, chia-0/null an toàn. */
export function computeAchievement(actual: number, target: number | null): Achievement {
  if (target === null) return { achievedRate: null, variance: null, reached: false };
  return {
    achievedRate: target > 0 ? actual / target : null,
    variance: actual - target,
    reached: target > 0 && actual >= target,
  };
}

export type RevenueVsTargetPeriod = {
  period: string;
  actual: number;
  target: number | null;
} & Achievement;

/**
 * Ghép doanh thu thực (Σ amount theo tháng của paidDate) với mục tiêu theo period.
 * `targets` ĐÃ được caller lọc đúng phạm vi center (vd center đang chọn, hoặc các
 * mục tiêu toàn hệ thống centerId=null) → ở đây chỉ tra theo `period`. THUẦN.
 */
export function buildRevenueTargetReport(
  payments: PaymentRecord[],
  targets: RevenueTargetRow[],
): RevenueVsTargetPeriod[] {
  const actualByPeriod = new Map<string, number>();
  for (const p of payments) {
    const k = monthKeyVN(p.paidDate);
    actualByPeriod.set(k, (actualByPeriod.get(k) ?? 0) + p.amount);
  }
  const targetByPeriod = new Map<string, number>();
  for (const t of targets) targetByPeriod.set(t.period, t.targetAmount);

  const periods = new Set<string>([...actualByPeriod.keys(), ...targetByPeriod.keys()]);
  return [...periods]
    .sort((a, b) => a.localeCompare(b))
    .map((period) => {
      const actual = actualByPeriod.get(period) ?? 0;
      const target = targetByPeriod.has(period)
        ? (targetByPeriod.get(period) as number)
        : null;
      return { period, actual, target, ...computeAchievement(actual, target) };
    });
}

export type RevenueTargetSummary = {
  /** Σ doanh thu thực mọi kỳ. */
  totalActual: number;
  /** Σ mục tiêu các kỳ CÓ đặt mục tiêu. */
  totalTarget: number;
  /** Σ actual của các kỳ có mục tiêu / totalTarget (so cùng phạm vi kỳ). */
  achievedRate: number | null;
  /** Số kỳ đã đạt mục tiêu. */
  reachedPeriods: number;
  /** Số kỳ có đặt mục tiêu. */
  targetedPeriods: number;
};

/** Tổng quan: gộp actual/target toàn dải kỳ. THUẦN. */
export function revenueTargetSummary(
  rows: RevenueVsTargetPeriod[],
): RevenueTargetSummary {
  let totalActual = 0;
  let totalTarget = 0;
  let actualOnTargeted = 0;
  let reachedPeriods = 0;
  let targetedPeriods = 0;
  for (const r of rows) {
    totalActual += r.actual;
    if (r.target !== null) {
      totalTarget += r.target;
      actualOnTargeted += r.actual;
      targetedPeriods += 1;
      if (r.reached) reachedPeriods += 1;
    }
  }
  return {
    totalActual,
    totalTarget,
    achievedRate: totalTarget > 0 ? actualOnTargeted / totalTarget : null,
    reachedPeriods,
    targetedPeriods,
  };
}
