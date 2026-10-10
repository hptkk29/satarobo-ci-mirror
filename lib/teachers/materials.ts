// lib/teachers/materials.ts — FL1-04 (US-LMS-3): helper THUẦN cho trang
// "Tài liệu lớp tôi" (GV xem tài liệu giảng dạy của lớp mình). Tách logic không
// chạm DB để test trực tiếp (Vitest). Quyết định "lớp nào GV thấy" + "thống kê nộp bài".
import type { Role } from "@prisma/client";

/** Trạng thái nộp bài (đồng bộ enum SubmissionStatus của Prisma). */
export type SubmissionStatusLite = "NOT_SUBMITTED" | "SUBMITTED" | "LATE" | "GRADED";

/**
 * Plain TEACHER → chỉ thấy lớp mình dạy (scope ASSIGNED). Vai trò rộng hơn
 * (SUPER_ADMIN / TRAINING / CENTER_MANAGER) xem theo cơ sở (scopedDb lo cách ly),
 * nên KHÔNG giới hạn về assignedClassIds. Đa vai trò: rộng-thắng (union).
 */
export function shouldRestrictToOwnClasses(roles: (Role | string)[]): boolean {
  const set = new Set(roles);
  const hasBroad =
    set.has("SUPER_ADMIN") || set.has("TRAINING") || set.has("CENTER_MANAGER");
  return set.has("TEACHER") && !hasBroad;
}

export type SubmissionStats = {
  /** Tổng HS đang học (mẫu số đánh giá). */
  total: number;
  /** Đã nộp = SUBMITTED + LATE + GRADED. */
  submitted: number;
  /** Trong số đã nộp, đã chấm điểm. */
  graded: number;
  /** Nộp muộn. */
  late: number;
  /** Chưa nộp = total - submitted (clamp ≥ 0). */
  notSubmitted: number;
};

/**
 * Gom thống kê nộp bài của 1 bài tập từ danh sách trạng thái submission + sĩ số.
 * THUẦN — không chạm DB. `total` là số HS đang học của lớp (mẫu số).
 * "Chưa nộp" suy từ sĩ số trừ số đã nộp (submission NOT_SUBMITTED hoặc thiếu bản ghi
 * đều coi là chưa nộp), nên không double-count.
 */
export function summarizeSubmissions(
  statuses: SubmissionStatusLite[],
  total: number,
): SubmissionStats {
  let submitted = 0;
  let graded = 0;
  let late = 0;
  for (const s of statuses) {
    if (s === "SUBMITTED" || s === "LATE" || s === "GRADED") submitted++;
    if (s === "GRADED") graded++;
    if (s === "LATE") late++;
  }
  return {
    total,
    submitted,
    graded,
    late,
    notSubmitted: Math.max(0, total - submitted),
  };
}
