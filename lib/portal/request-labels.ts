import type { ParentRequestType, ParentRequestStatus } from "@prisma/client";

// Phase NHÓM 3 — nhãn cho yêu cầu phụ huynh (dùng chung portal + admin).
export const REQUEST_TYPE_LABEL: Record<ParentRequestType, string> = {
  ABSENCE: "Báo vắng",
  MAKEUP: "Xin học bù",
  TRANSFER_CLASS: "Chuyển lớp",
  TRANSFER_CENTER: "Chuyển cơ sở",
  RESERVE: "Bảo lưu",
  OTHER: "Khác",
  CONSENT_CHANGE: "Đổi đồng ý dùng ảnh",
};

export const REQUEST_STATUS_LABEL: Record<ParentRequestStatus, string> = {
  PENDING: "Chờ xử lý",
  APPROVED: "Đã duyệt",
  REJECTED: "Từ chối",
  CANCELLED: "Đã huỷ",
};

/**
 * Huy hiệu trạng thái yêu cầu — dùng CHUNG cho cả trang quản trị lẫn cổng phụ huynh.
 *
 * Sắc độ 100/700 là cặp đã cân tương phản (≥4,5:1). Riêng CANCELLED trước đây là
 * `text-neutral-500`, đo được 4,35:1 trên nền `neutral-100` — trượt AA; nâng một
 * bậc lên 600. Trạng thái này vẫn là bậc "im lặng nhất" của bảng, chỉ là đọc được.
 */
export const REQUEST_STATUS_BADGE: Record<ParentRequestStatus, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-rose-100 text-rose-700",
  CANCELLED: "bg-neutral-100 text-neutral-600",
};

export const ALL_REQUEST_TYPES = [
  "ABSENCE",
  "MAKEUP",
  "TRANSFER_CLASS",
  "TRANSFER_CENTER",
  "RESERVE",
  "OTHER",
] as const satisfies readonly ParentRequestType[];
