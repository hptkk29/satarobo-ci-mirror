// lib/reports/churn.ts — LMS-16: Báo cáo churn / drop-off (học viên rời lớp).
// HÀM THUẦN: nhận MẢNG enrollment phẳng (đã query + resolve sẵn ở tầng page) →
// trả tỉ lệ rời lớp theo kỳ (tháng) + theo cơ sở. KHÔNG gọi DB ở đây (Vitest
// không cần Postgres). Mirror style lib/reports/lead.ts.
import { monthKeyVN } from "@/lib/reports/lead";

/** Record enrollment phẳng cho báo cáo churn. */
export type ChurnEnrollmentRecord = {
  status: string; // EnrollmentStatus
  centerId: string | null;
  /** Mốc bắt đầu học (page resolve: startedAt ?? enrolledAt). */
  startedAt: Date;
  /** Mốc kết thúc (rời/hoàn thành/chuyển). null = vẫn đang học. */
  endedAt: Date | null;
};

const ratio = (num: number, denom: number): number => (denom > 0 ? num / denom : 0);
const UNKNOWN_LABEL = "Không rõ";

/** Status được coi là RỜI LỚP (drop-off). */
export const WITHDREW_STATUS = "WITHDREW";
/** Status đã hoàn thành khóa (không tính churn). */
export const COMPLETED_STATUS = "COMPLETED";

export function isWithdrew(r: ChurnEnrollmentRecord): boolean {
  return r.status === WITHDREW_STATUS;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM" kế tiếp. THUẦN. */
export function nextMonthKey(key: string): string {
  const [y, m] = key.split("-").map((x) => parseInt(x, 10));
  return m >= 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
}

/** Liệt kê các tháng "YYYY-MM" liên tục từ `from` tới `to` (bao gồm 2 đầu). THUẦN. */
export function enumerateMonths(from: string, to: string): string[] {
  if (from > to) return [];
  const out = [from];
  let cur = from;
  while (cur < to) {
    cur = nextMonthKey(cur);
    out.push(cur);
  }
  return out;
}

/**
 * Một enrollment có "đang học đầu kỳ" `period` không: đã bắt đầu TRƯỚC kỳ này
 * (tháng bắt đầu < period) VÀ chưa kết thúc trước kỳ (endedAt null hoặc tháng
 * kết thúc >= period). THUẦN.
 */
function activeAtStartOf(r: ChurnEnrollmentRecord, period: string): boolean {
  if (monthKeyVN(r.startedAt) >= period) return false;
  return r.endedAt === null || monthKeyVN(r.endedAt) >= period;
}

/** Rời lớp TRONG kỳ `period`: WITHDREW và tháng kết thúc === period. THUẦN. */
function withdrewInMonth(r: ChurnEnrollmentRecord, period: string): boolean {
  return isWithdrew(r) && r.endedAt !== null && monthKeyVN(r.endedAt) === period;
}

export type ChurnPeriod = {
  period: string;
  /** Số enrollment đang học ở đầu kỳ (mẫu số). */
  activeAtStart: number;
  /** Số enrollment rời lớp trong kỳ (tử số). */
  withdrew: number;
  /** withdrew / activeAtStart (chia-0 an toàn). */
  churnRate: number;
};

/**
 * Tỉ lệ churn theo từng tháng trong khoảng dữ liệu (từ tháng bắt đầu sớm nhất
 * tới tháng kết thúc/bắt đầu muộn nhất). Mảng rỗng → []. THUẦN.
 */
export function churnByMonth(records: ChurnEnrollmentRecord[]): ChurnPeriod[] {
  if (records.length === 0) return [];
  let min: string | null = null;
  let max: string | null = null;
  for (const r of records) {
    const sk = monthKeyVN(r.startedAt);
    if (min === null || sk < min) min = sk;
    if (max === null || sk > max) max = sk;
    if (r.endedAt) {
      const ek = monthKeyVN(r.endedAt);
      if (ek > (max as string)) max = ek;
    }
  }
  return enumerateMonths(min as string, max as string).map((period) => {
    const activeAtStart = records.filter((r) => activeAtStartOf(r, period)).length;
    const withdrew = records.filter((r) => withdrewInMonth(r, period)).length;
    return { period, activeAtStart, withdrew, churnRate: ratio(withdrew, activeAtStart) };
  });
}

export type ChurnCenterStat = {
  key: string;
  label: string;
  /** Tổng enrollment thuộc cơ sở. */
  total: number;
  withdrew: number;
  /** withdrew / total (tỉ lệ rời lớp tích lũy của cơ sở). */
  churnRate: number;
};

/** Nhóm theo cơ sở: tổng / rời lớp / tỉ lệ. null → "Không rõ". THUẦN. */
export function churnByCenter(
  records: ChurnEnrollmentRecord[],
  centerNames?: Record<string, string>,
): ChurnCenterStat[] {
  const m = new Map<string, { total: number; withdrew: number }>();
  for (const r of records) {
    const key = r.centerId ?? UNKNOWN_LABEL;
    const cur = m.get(key) ?? { total: 0, withdrew: 0 };
    cur.total += 1;
    if (isWithdrew(r)) cur.withdrew += 1;
    m.set(key, cur);
  }
  return [...m.entries()]
    .map(([key, v]) => ({
      key,
      label:
        centerNames?.[key] ?? (key === UNKNOWN_LABEL ? UNKNOWN_LABEL : key),
      total: v.total,
      withdrew: v.withdrew,
      churnRate: ratio(v.withdrew, v.total),
    }))
    .sort((a, b) => b.total - a.total);
}

export type ChurnSummary = {
  total: number;
  /** Đang học (endedAt null). */
  active: number;
  withdrew: number;
  completed: number;
  /** withdrew / total — tỉ lệ rời lớp tổng. */
  churnRate: number;
};

/** Tổng quan churn từ mảng record phẳng. Rỗng → toàn 0. THUẦN. */
export function churnSummary(records: ChurnEnrollmentRecord[]): ChurnSummary {
  const total = records.length;
  const active = records.filter((r) => r.endedAt === null).length;
  const withdrew = records.filter(isWithdrew).length;
  const completed = records.filter((r) => r.status === COMPLETED_STATUS).length;
  return { total, active, withdrew, completed, churnRate: ratio(withdrew, total) };
}

export type ChurnReport = {
  summary: ChurnSummary;
  byMonth: ChurnPeriod[];
  byCenter: ChurnCenterStat[];
};

/** Tổng hợp toàn bộ báo cáo churn. THUẦN — đầu vào rỗng → số 0. */
export function buildChurnReport(
  records: ChurnEnrollmentRecord[],
  centerNames?: Record<string, string>,
): ChurnReport {
  return {
    summary: churnSummary(records),
    byMonth: churnByMonth(records),
    byCenter: churnByCenter(records, centerNames),
  };
}
