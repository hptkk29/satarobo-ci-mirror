import type { LeadChildStatus } from "@prisma/client";

/**
 * Nhãn + màu của trạng thái phễu TỪNG CON (C-06).
 *
 * Tách khỏi `lost-status.ts` vì file đó dựng schema zod ở tầng module — kéo nó vào một
 * component `"use client"` là kéo cả zod xuống trình duyệt cho đúng hai bảng chữ. Ở đây
 * chỉ có hằng số, không phụ thuộc gì ngoài kiểu enum (bị xoá lúc biên dịch).
 */
export const LEAD_CHILD_STATUS_LABEL: Record<LeadChildStatus, string> = {
  NEW: "Mới",
  CONSULTING: "Đang tư vấn",
  TRIAL_SCHEDULED: "Hẹn học thử",
  TRIAL_ATTENDED: "Đã học thử",
  ENROLLED: "Chốt",
  LOST: "Rớt",
};

export const LEAD_CHILD_STATUS_BADGE: Record<LeadChildStatus, string> = {
  NEW: "bg-sky-100 text-sky-700",
  CONSULTING: "bg-indigo-100 text-indigo-700",
  TRIAL_SCHEDULED: "bg-violet-100 text-violet-700",
  TRIAL_ATTENDED: "bg-purple-100 text-purple-700",
  ENROLLED: "bg-green-100 text-green-700",
  LOST: "bg-red-100 text-red-700",
};
