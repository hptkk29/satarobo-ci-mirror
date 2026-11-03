// lib/labels/registry.ts — R6-D4: nhãn + màu enum về 1 registry + exhaustiveness check.
// Record<Enum,...> cho exhaustiveness LÚC BIÊN DỊCH (thêm giá trị enum mà thiếu nhãn → TS lỗi).
// assertExhaustive() bắt LÚC CHẠY khi giá trị đến từ string (vd seed/import). (T1/T2)
import type {
  EnrollmentStatus,
  OrderStatus,
  ParentRequestStatus,
  CommissionStatus,
  SubmissionStatus,
} from "@prisma/client";

export type LabelEntry = { label: string; color: string };

/** Bọc 1 map nhãn (Record<Enum,LabelEntry>) thành tiện ích tra cứu + kiểm phủ. */
export function makeLabelRegistry<E extends string>(map: Record<E, LabelEntry>) {
  return {
    map,
    values: Object.keys(map) as E[],
    has: (v: string): v is E => Object.prototype.hasOwnProperty.call(map, v),
    label: (v: string): string => (map as Record<string, LabelEntry>)[v]?.label ?? v,
    color: (v: string): string => (map as Record<string, LabelEntry>)[v]?.color ?? "gray",
    /** T2 — ném nếu allValues có giá trị THIẾU nhãn (vd enum mới chưa cập nhật registry). */
    assertExhaustive: (allValues: readonly string[]): void => {
      const missing = allValues.filter((v) => !Object.prototype.hasOwnProperty.call(map, v));
      if (missing.length > 0) {
        throw new Error(`[labels] Thiếu nhãn cho giá trị enum: ${missing.join(", ")}`);
      }
    },
  };
}

// ── Enrollment ────────────────────────────────────────────────────────────────
const ENROLLMENT_STATUS_MAP: Record<EnrollmentStatus, LabelEntry> = {
  ACTIVE: { label: "Đang học (cũ)", color: "green" },
  CANCELLED: { label: "Đã huỷ", color: "red" },
  PENDING: { label: "Chờ xác nhận", color: "amber" },
  CONFIRMED: { label: "Đã xác nhận", color: "blue" },
  STUDYING: { label: "Đang học", color: "green" },
  PAUSED: { label: "Bảo lưu", color: "amber" },
  COMPLETED: { label: "Hoàn thành", color: "slate" },
  WITHDREW: { label: "Nghỉ học", color: "red" },
  TRANSFERRED: { label: "Đã chuyển", color: "violet" },
};
export const ENROLLMENT_STATUS = makeLabelRegistry<EnrollmentStatus>(ENROLLMENT_STATUS_MAP);

// ── Order ─────────────────────────────────────────────────────────────────────
const ORDER_STATUS_MAP: Record<OrderStatus, LabelEntry> = {
  DRAFT: { label: "Nháp", color: "slate" },
  PENDING_PAYMENT: { label: "Chờ thanh toán", color: "amber" },
  CONFIRMED: { label: "Đã thanh toán", color: "blue" },
  COMPLETED: { label: "Hoàn tất", color: "green" },
  CANCELLED: { label: "Đã huỷ", color: "red" },
  REFUNDED: { label: "Đã hoàn tiền", color: "violet" },
};
export const ORDER_STATUS = makeLabelRegistry<OrderStatus>(ORDER_STATUS_MAP);

// ── ParentRequest ──────────────────────────────────────────────────────────────
const PARENT_REQUEST_STATUS_MAP: Record<ParentRequestStatus, LabelEntry> = {
  PENDING: { label: "Chờ xử lý", color: "amber" },
  APPROVED: { label: "Đã duyệt", color: "green" },
  REJECTED: { label: "Từ chối", color: "red" },
  CANCELLED: { label: "Đã huỷ", color: "slate" },
};
export const PARENT_REQUEST_STATUS = makeLabelRegistry<ParentRequestStatus>(PARENT_REQUEST_STATUS_MAP);

// ── Commission statement ─────────────────────────────────────────────────────────
const COMMISSION_STATUS_MAP: Record<CommissionStatus, LabelEntry> = {
  DRAFT: { label: "Nháp", color: "slate" },
  APPROVED: { label: "Đã duyệt", color: "green" },
  REOPENED: { label: "Mở lại", color: "amber" },
};
export const COMMISSION_STATUS = makeLabelRegistry<CommissionStatus>(COMMISSION_STATUS_MAP);


// ── AssignmentSubmission ──────────────────────────────────────────────────────
// QA site GV vòng 1 (BUG-010): repo đang có BA bảng nhãn chép tay cho enum này, lệch
// nhau. Bản trong hồ sơ học viên rút còn đúng hai nhãn ("Đã nộp"/"Chưa nộp") nên bài
// NỘP MUỘN đọc ra y hệt bài nộp đúng hạn, và bài ĐÃ CHẤM không phân biệt được với bài
// đang chờ chấm — ô Điểm để trống thì không rõ là chưa chấm hay chấm 0 điểm.
const SUBMISSION_STATUS_MAP: Record<SubmissionStatus, LabelEntry> = {
  NOT_SUBMITTED: { label: "Chưa nộp", color: "amber" },
  SUBMITTED: { label: "Đã nộp", color: "blue" },
  LATE: { label: "Nộp muộn", color: "amber" },
  GRADED: { label: "Đã chấm", color: "green" },
};
export const SUBMISSION_STATUS = makeLabelRegistry<SubmissionStatus>(SUBMISSION_STATUS_MAP);
