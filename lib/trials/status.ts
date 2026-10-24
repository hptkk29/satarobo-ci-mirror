import type { TrialClassStatus, ChildGrasp } from "@prisma/client";

// =============================================================================
// TRIAL CLASS — labels + badge styling (Phase T1.4)
// =============================================================================

export const TRIAL_STATUS_LABEL: Record<TrialClassStatus, string> = {
  SCHEDULED: "Chờ xếp lịch",
  CONFIRMED: "Đã xác nhận",
  ATTENDED: "Đã học thử",
  MISSED: "Vắng mặt",
  POSTPONED: "Hoãn lại",
  ENROLLED: "Đã ghi danh",
  REJECTED: "Từ chối",
};

export const TRIAL_STATUS_BADGE: Record<TrialClassStatus, string> = {
  SCHEDULED: "bg-gray-100 text-gray-700",
  CONFIRMED: "bg-blue-100 text-blue-700",
  ATTENDED: "bg-emerald-100 text-emerald-700",
  MISSED: "bg-amber-100 text-amber-700",
  POSTPONED: "bg-orange-100 text-orange-700",
  ENROLLED: "bg-purple-100 text-purple-700",
  REJECTED: "bg-rose-100 text-rose-700",
};

export const ALL_TRIAL_STATUSES = [
  "SCHEDULED",
  "CONFIRMED",
  "ATTENDED",
  "MISSED",
  "POSTPONED",
  "ENROLLED",
  "REJECTED",
] as const satisfies readonly TrialClassStatus[];

export const CHILD_GRASP_LABEL: Record<ChildGrasp, string> = {
  EXCELLENT: "Xuất sắc",
  GOOD: "Tốt",
  AVERAGE: "Trung bình",
  POOR: "Cần hỗ trợ",
};
