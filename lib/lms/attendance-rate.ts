// lib/lms/attendance-rate.ts — R3-04: tỉ lệ chuyên cần + sinh học bù (THUẦN, source-of-truth).
import type { AttendanceStatus } from "@prisma/client";

/** C4.2 — attendanceRate = (PRESENT + LATE) / tổng buổi COMPLETED. THUẦN, chia-0 an toàn. */
export function computeAttendanceRate(counts: {
  present: number;
  late: number;
  totalCompleted: number;
}): number {
  if (counts.totalCompleted <= 0) return 0;
  return (counts.present + counts.late) / counts.totalCompleted;
}

/** Đếm theo danh sách trạng thái (tiện cho query trả status[]). THUẦN. */
export function rateFromStatuses(statuses: AttendanceStatus[]): number {
  const present = statuses.filter((s) => s === "PRESENT").length;
  const late = statuses.filter((s) => s === "LATE").length;
  return computeAttendanceRate({ present, late, totalCompleted: statuses.length });
}

/**
 * Vắng (mọi loại, kể cả CÓ PHÉP) → cần học bù. THUẦN.
 * 02/10/2026 chủ dự án chốt "vắng có phép cũng cần học bù" — trước đó chỉ vắng KHÔNG phép.
 * Không bù nữa thì Huỷ ở /admin/hoc-bu (bắt buộc lý do), không phải bỏ ở lúc điểm danh.
 */
export function needsMakeup(status: AttendanceStatus): boolean {
  return status !== "PRESENT" && status !== "LATE";
}
