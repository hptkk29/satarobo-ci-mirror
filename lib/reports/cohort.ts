// lib/reports/cohort.ts — LMS-16: Báo cáo COHORT tiến độ — hàm THUẦN.
//
// Nhóm enrollment theo KỲ BẮT ĐẦU (tháng của startedAt ?? enrolledAt, giờ VN) →
// mỗi cohort tính tiến độ TB + phân rã trạng thái (hoàn thành / đang học / rút).
// KHÔNG gọi DB ở đây → Vitest test không cần Postgres. Mirror style lib/reports/lead.ts.
import { monthKeyVN } from "@/lib/reports/lead";
import type { EnrollmentStatusValue } from "@/lib/reports/teacher-performance";

export type { EnrollmentStatusValue };

// ── Input record (phẳng, đã gắn tiến độ lớp ở page) ──────────────────────────
/** Một ghi danh, kèm tiến độ buổi của lớp tại thời điểm báo cáo. */
export interface CohortEnrollmentRecord {
  /** Mốc bắt đầu cohort — page truyền startedAt ?? enrolledAt. */
  cohortDate: Date;
  status: EnrollmentStatusValue;
  /** Tổng số buổi của lớp (đã loại buổi hủy). */
  totalSessions: number;
  /** Số buổi đã COMPLETED của lớp. */
  completedSessions: number;
}

// ── Output ───────────────────────────────────────────────────────────────────
export interface CohortRow {
  /** "YYYY-MM" giờ VN. */
  cohort: string;
  total: number;
  /** % tiến độ trung bình (0–100, 1 chữ số) = mean(completed/total mỗi enrollment). */
  avgProgress: number;
  completed: number; // status COMPLETED
  studying: number; // đang học (ACTIVE/PENDING/CONFIRMED/STUDYING/PAUSED)
  withdrew: number; // rút (WITHDREW/CANCELLED/TRANSFERRED)
  completionRate: number; // completed / total
  studyingRate: number; // studying / total
  withdrewRate: number; // withdrew / total
}

export interface CohortReport {
  totalEnrollments: number;
  rows: CohortRow[];
}

/** Trạng thái coi là RÚT khỏi lớp. */
export const WITHDREW_STATUSES = new Set<EnrollmentStatusValue>([
  "WITHDREW",
  "CANCELLED",
  "TRANSFERRED",
]);

/** Làm tròn 1 chữ số thập phân (THUẦN). */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** % an toàn (mẫu = 0 → 0). */
export function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return round1((numerator / denominator) * 100);
}

/** Tiến độ 1 enrollment (0–1). totalSessions=0 → 0. THUẦN. */
export function enrollmentProgress(r: CohortEnrollmentRecord): number {
  if (r.totalSessions <= 0) return 0;
  return Math.min(1, r.completedSessions / r.totalSessions);
}

interface Acc {
  total: number;
  progressSum: number;
  completed: number;
  studying: number;
  withdrew: number;
}

/**
 * Tổng hợp báo cáo cohort từ mảng enrollment phẳng. KHÔNG chạm DB.
 * Cohort = tháng (giờ VN) của cohortDate. Sắp xếp tăng dần theo cohort.
 */
export function buildCohortReport(records: CohortEnrollmentRecord[]): CohortReport {
  const m = new Map<string, Acc>();

  for (const r of records) {
    const key = monthKeyVN(r.cohortDate);
    const acc = m.get(key) ?? {
      total: 0,
      progressSum: 0,
      completed: 0,
      studying: 0,
      withdrew: 0,
    };
    acc.total++;
    acc.progressSum += enrollmentProgress(r);
    if (r.status === "COMPLETED") acc.completed++;
    else if (WITHDREW_STATUSES.has(r.status)) acc.withdrew++;
    else acc.studying++;
    m.set(key, acc);
  }

  const rows: CohortRow[] = [...m.entries()]
    .map(([cohort, a]) => ({
      cohort,
      total: a.total,
      avgProgress: a.total > 0 ? round1((a.progressSum / a.total) * 100) : 0,
      completed: a.completed,
      studying: a.studying,
      withdrew: a.withdrew,
      completionRate: pct(a.completed, a.total),
      studyingRate: pct(a.studying, a.total),
      withdrewRate: pct(a.withdrew, a.total),
    }))
    .sort((x, y) => x.cohort.localeCompare(y.cohort));

  return { totalEnrollments: records.length, rows };
}
