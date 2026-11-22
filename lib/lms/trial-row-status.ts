// lib/lms/trial-row-status.ts — trạng thái MỘT SUẤT TRIAL dưới góc nhìn giáo viên.
//
// PURE (không DB, không `server-only`) để test được bằng vitest. `getTeacherTrialTable`
// trong lib/lms/teacher-schedule.ts nạp dữ liệu rồi gọi hàm này.
//
// Bảng Trial của site GV (chủ dự án 25/08) in đúng 7 nhãn dưới đây. Ba trong số đó
// trước 25/08 KHÔNG có dữ liệu nào chống lưng:
//   • "Bị dời lịch"  → nay có `TrialEnrollment.rescheduledFromSessionId`
//                      (trước đó buổi của học viên là bất biến sau khi xếp);
//   • "Đã nhập học"  → nay `LeadTrialHistory.outcome` thật sự được ghi "ENROLLED"
//                      trong transaction convert (trước đó cột này vĩnh viễn "PENDING");
//   • "Bị rớt"       → cùng cột, ghi "LOST" khi lead chuyển sang mất.

import type { TrialEnrollmentStatus, TrialSessionStatus } from "@prisma/client";

/** 7 trạng thái của một suất Trial. */
export type TrialRowStatus =
  /** Buổi chưa tới. */
  | "upcoming"
  /** Buổi chưa tới, và học viên đã bị dời từ buổi khác sang. */
  | "rescheduled"
  /** Buổi đã qua / đã hoàn tất nhưng chưa có phiếu rubric. */
  | "awaiting-eval"
  /** Đã có phiếu rubric. */
  | "evaluated"
  /** Đã nhập học chính thức ⇒ giáo viên dạy Trial được +1% hoa hồng. */
  | "enrolled"
  /** Lead đã mất sau khi học thử. */
  | "lost"
  /** Bị gỡ khỏi lớp trải nghiệm (KHÁC "rớt": chưa từng học xong để mà rớt). */
  | "withdrawn";

export type TrialRowStatusInput = {
  enrollmentStatus: TrialEnrollmentStatus;
  /** LeadTrialHistory.outcome — "ENROLLED" | "LOST" | "PENDING" | null. */
  outcome: string | null;
  evaluated: boolean;
  rescheduled: boolean;
  /** null = chưa xếp buổi. @db.Date → UTC 00:00 của ngày VN. */
  sessionDate: Date | null;
  sessionStatus: TrialSessionStatus | null;
  /** Mốc UTC 00:00 của NGÀY hôm nay theo giờ VN. */
  todayMs: number;
};

/**
 * Thứ tự quyết định = "việc đã đi tới đâu", cái sau không lật được cái trước:
 *
 *   1. KẾT CỤC ĐÃ CHỐT (nhập học / rớt) thắng tất cả — kể cả khi buổi còn ở tương lai
 *      (con nhập học sớm), kể cả khi chưa ai nhập phiếu.
 *   2. Bị gỡ khỏi lớp.
 *   3. Đã có phiếu rubric.
 *   4. Buổi ĐÃ diễn ra mà chưa có phiếu → việc cần làm của GV.
 *   5. Bị dời lịch — CHỈ có nghĩa với buổi CHƯA tới. Buổi đã dạy xong thì việc cần
 *      nhắc là nhập phiếu, không phải chuyện lịch cũ.
 *   6. Còn lại: sắp tới.
 *
 * "Buổi đã diễn ra" = buổi được đánh COMPLETED, HOẶC ngày buổi < hôm nay. So sánh theo
 * mốc ngày VN (`todayMs`) chứ không theo giờ máy: Vercel chạy UTC, máy dev +07 — dùng
 * `new Date()` trần ở đây là buổi hôm nay nhảy trạng thái tuỳ nơi chạy.
 */
export function trialRowStatus(input: TrialRowStatusInput): TrialRowStatus {
  if (input.outcome === "ENROLLED") return "enrolled";
  if (input.outcome === "LOST") return "lost";
  if (input.enrollmentStatus === "WITHDRAWN") return "withdrawn";
  if (input.evaluated) return "evaluated";

  const happened =
    input.sessionStatus === "COMPLETED" ||
    (input.sessionDate != null && input.sessionDate.getTime() < input.todayMs);
  if (happened) return "awaiting-eval";

  return input.rescheduled ? "rescheduled" : "upcoming";
}

/**
 * Đếm suất ĐANG NỢ PHIẾU — số in trên ô "Trial chờ đánh giá" của trang chủ site GV.
 *
 * Để ở đây (THUẦN, cùng file với định nghĩa trạng thái) chứ không viết
 * `rows.filter(r => r.status === "awaiting-eval").length` ngay tại trang: ô đếm và
 * bảng /teacher/trial phải đọc CÙNG MỘT định nghĩa "còn nợ phiếu", không thì chúnng
 * nói ngược nhau như cặp ô "Buổi chưa điểm danh" đã từng (QA vòng 1, BUG-029).
 */
export function demChoDanhGia(rows: ReadonlyArray<{ status: TrialRowStatus }>): number {
  return rows.filter((r) => r.status === "awaiting-eval").length;
}

/** Suất đã xong việc với GV → rơi xuống bảng "Đã Trial" dù buổi còn ở tương lai. */
export function isSettledTrialRow(status: TrialRowStatus): boolean {
  return status === "enrolled" || status === "lost" || status === "withdrawn";
}
