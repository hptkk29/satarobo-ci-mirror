// Module QL học viên PHẦN 3 — phân loại báo vắng theo mốc 3 ngày.
//
// Báo trước ≥ 3 ngày so với buổi học = đúng hạn (ON_TIME);
// báo < 3 ngày (kể cả sau buổi) = gấp (URGENT) → tư vấn viên ưu tiên xử lý.

export type AbsenceUrgency = "ON_TIME" | "URGENT";

export const URGENT_THRESHOLD_DAYS = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @param sessionDate ngày buổi học xin vắng
 * @param reportedAt  thời điểm phụ huynh báo (mặc định: now của caller)
 */
export function classifyAbsenceUrgency(
  sessionDate: Date,
  reportedAt: Date,
  thresholdDays: number = URGENT_THRESHOLD_DAYS, // caller async truyền từ SystemSetting
): AbsenceUrgency {
  // So sánh theo NGÀY (bỏ giờ) để "báo trước N ngày" ổn định.
  const s = Date.UTC(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate());
  const r = Date.UTC(reportedAt.getFullYear(), reportedAt.getMonth(), reportedAt.getDate());
  const daysAhead = Math.round((s - r) / MS_PER_DAY);
  return daysAhead >= thresholdDays ? "ON_TIME" : "URGENT";
}
