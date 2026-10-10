// #17 Gap 1 (câu 55, Đào tạo & GV — Toại ký 06/07/2026):
// "Giáo viên hoàn thiện đánh giá mỗi buổi, thực hiện viết đánh giá ở BUỔI 5 và BUỔI 12."
//
// Mô hình hoá mốc kỳ học bạ mà KHÔNG đổi schema:
// `ReportCard.enrollmentId` là `@unique` (1 bản/ghi danh) và `periodComments` là JSON
// tự do `[{period, comment}]`. Thay vì bỏ ràng buộc unique + migration 2 pha ngay
// trước go-live, ta CỐ ĐỊNH hai khoá kỳ `SESSION_5` / `SESSION_12` trong chính
// `periodComments`. Hai kỳ vẫn phân biệt rõ, dữ liệu cũ (period tự do) không vỡ.
//
// `ClassSession` KHÔNG có số thứ tự buổi → "đạt buổi N" = đếm buổi đã COMPLETED của lớp.
// Buổi CANCELLED không tính (buổi bù sinh cuối lịch, đã là ClassSession riêng).
//
// Module THUẦN — không import db/auth, test không cần DB.
import type { PeriodComment } from "@/lib/lms/report-card-core";

/** Hai mốc kỳ theo câu 55. Thứ tự tăng dần — code dưới dựa vào điều đó. */
export const REPORT_CARD_MILESTONES = [5, 12] as const;
export type ReportCardMilestone = (typeof REPORT_CARD_MILESTONES)[number];

/** Khoá kỳ lưu trong periodComments[].period. */
export function milestonePeriodKey(milestone: ReportCardMilestone): string {
  return `SESSION_${milestone}`;
}

/** Nhãn hiển thị cho UI. */
export function milestoneLabel(milestone: ReportCardMilestone): string {
  const ky = REPORT_CARD_MILESTONES.indexOf(milestone) + 1;
  return `Kỳ ${ky} — buổi ${milestone}`;
}

/** `period` có phải khoá kỳ chuẩn không (phân biệt với period tự do cũ). */
export function isMilestonePeriod(period: string): boolean {
  return REPORT_CARD_MILESTONES.some((m) => milestonePeriodKey(m) === period.trim());
}

/** Các mốc lớp ĐÃ đạt, theo số buổi đã hoàn tất. */
export function reachedMilestones(completedSessions: number): ReportCardMilestone[] {
  return REPORT_CARD_MILESTONES.filter((m) => completedSessions >= m);
}

/** Nhận xét kỳ đã viết chưa (rỗng/trắng = chưa viết). */
function hasComment(periods: PeriodComment[], milestone: ReportCardMilestone): boolean {
  const key = milestonePeriodKey(milestone);
  return periods.some((p) => p.period.trim() === key && p.comment.trim().length > 0);
}

/**
 * Mốc đã đạt NHƯNG giáo viên chưa viết nhận xét → đây là "việc chưa xong" (câu 45).
 * Trả mảng rỗng nghĩa là không còn gì phải nhắc.
 */
export function missingMilestoneComments(
  completedSessions: number,
  periodComments: PeriodComment[],
): ReportCardMilestone[] {
  return reachedMilestones(completedSessions).filter((m) => !hasComment(periodComments, m));
}

/**
 * Dựng danh sách kỳ cho FORM: mọi mốc ĐÃ ĐẠT luôn có một dòng (dù chưa viết), giữ
 * nguyên các period tự do cũ ở cuối. Nhờ vậy GV thấy đúng 2 ô "buổi 5" / "buổi 12"
 * thay vì phải tự bấm "thêm giai đoạn" và tự gõ tên kỳ.
 */
export function ensureMilestonePeriods(
  completedSessions: number,
  periodComments: PeriodComment[],
): PeriodComment[] {
  const reached = reachedMilestones(completedSessions);
  const rows: PeriodComment[] = reached.map((m) => {
    const key = milestonePeriodKey(m);
    const existing = periodComments.find((p) => p.period.trim() === key);
    return { period: key, comment: existing?.comment ?? "" };
  });
  const legacy = periodComments.filter((p) => !isMilestonePeriod(p.period));
  return [...rows, ...legacy];
}
