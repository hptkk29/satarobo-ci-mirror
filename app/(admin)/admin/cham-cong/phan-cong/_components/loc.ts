// Nhãn của màn Phân công buổi — thuần, dùng chung server/client. Thẻ số + bộ lọc nay ở `lib/parttime/control-tower.ts`
// (`THE` — một vị từ cho cả đếm lẫn lọc).
import type { TrangThaiNhanLuc } from "@/lib/parttime/phan-cong";

export type Tone = "danger" | "warning" | "success" | "info" | "muted";

export const NHAN_TRANG_THAI: Record<TrangThaiNhanLuc, { nhan: string; tone: Tone }> = {
  STAFFING_DRAFT: { nhan: "Thiếu người", tone: "danger" },
  NEEDS_REASSIGNMENT: { nhan: "Cần phân lại", tone: "danger" },
  STAFFING_REJECTED: { nhan: "Bị từ chối", tone: "danger" },
  WAITING_ACCEPTANCE: { nhan: "Chờ nhận lớp", tone: "warning" },
  PARTIALLY_ACCEPTED: { nhan: "Nhận một phần", tone: "warning" },
  STAFFING_CONFIRMED: { nhan: "Đủ người", tone: "success" },
};

export const TONE_CLS: Record<Tone, string> = {
  danger: "bg-state-danger-soft text-state-danger-ink",
  warning: "bg-state-warning-soft text-state-warning-ink",
  success: "bg-state-success-soft text-state-success-ink",
  info: "bg-state-info-soft text-state-info-ink",
  muted: "bg-muted text-muted-foreground",
};
