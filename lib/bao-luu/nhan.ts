import type { StudentReserveEventKind, StudentReserveStatus, StudentReserveType } from "@prisma/client";

// lib/bao-luu/nhan.ts — NHÃN HIỂN THỊ của hồ sơ bảo lưu (thuần, không DB). Một chỗ cho màn danh sách, màn chi tiết và
// thông báo: hai bản chép nhãn là hai bản lệch nhau ở lần ai đó đổi một chữ.
//
// ⚠️ `Record<StudentReserveStatus, …>` (không phải `Partial`): thêm trạng thái vào enum mà quên nhãn là LỖI BIÊN DỊCH,
// không phải một ô trống câm trên màn hình (luật 7).

export type ToneTrangThai = "success" | "warning" | "danger" | "info" | "brand" | "muted";

export const NHAN_TRANG_THAI: Record<StudentReserveStatus, string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt, chờ bắt đầu",
  ACTIVE: "Đang bảo lưu",
  RESUME_PENDING: "Chờ phục học",
  ENDED: "Đã kết thúc",
  REJECTED: "Bị từ chối",
  CANCELLED: "Đã huỷ",
  OVERDUE: "Quá hạn bảo lưu",
  NOTICE_SENT: "Đã gửi thông báo",
  TERMINATED: "Đã chấm dứt",
};

export const TONE_TRANG_THAI: Record<StudentReserveStatus, ToneTrangThai> = {
  PENDING: "warning",
  APPROVED: "info",
  ACTIVE: "brand",
  RESUME_PENDING: "info",
  ENDED: "muted",
  REJECTED: "danger",
  CANCELLED: "muted",
  OVERDUE: "danger",
  NOTICE_SENT: "warning",
  TERMINATED: "danger",
};

export const NHAN_LOAI: Record<StudentReserveType, string> = {
  PARENT: "Theo đề nghị phụ huynh",
  CENTER: "Trung tâm tạm dừng lớp",
  LEGACY: "Hồ sơ cũ (trước khi có quy chế)",
};

export const NHAN_SU_KIEN: Record<StudentReserveEventKind, string> = {
  REQUEST: "Lập hồ sơ",
  APPROVE: "Duyệt",
  REJECT: "Từ chối",
  START: "Bắt đầu bảo lưu",
  EXTEND_REQUEST: "Đề nghị gia hạn",
  EXTEND: "Gia hạn",
  CONTACT: "Liên hệ phụ huynh",
  NOTICE: "Gửi thông báo chính thức",
  RESUME_REQUEST: "Đề nghị phục học",
  RESUME: "Phục học",
  EXPIRE: "Quá hạn",
  ESCALATE: "Chuyển cấp xử lý",
  TERMINATE: "Chấm dứt bảo lưu",
  RESTORE: "Khôi phục hồ sơ",
  CANCEL: "Huỷ hồ sơ",
  CONVERT_CENTER: "Chuyển sang cơ sở khác",
};

/** Ba tab của danh sách. `ma` đi trên URL (`?tab=`), nên là chuỗi cố định, không dấu. */
export const TAB_DANH_SACH = [
  { ma: "cho-duyet", nhan: "Chờ duyệt", trangThai: ["PENDING"] },
  { ma: "dang", nhan: "Đang bảo lưu", trangThai: ["APPROVED", "ACTIVE", "RESUME_PENDING", "OVERDUE", "NOTICE_SENT"] },
  { ma: "ket-thuc", nhan: "Đã kết thúc", trangThai: ["ENDED", "REJECTED", "CANCELLED", "TERMINATED"] },
] as const satisfies readonly { ma: string; nhan: string; trangThai: readonly StudentReserveStatus[] }[];

export type MaTab = (typeof TAB_DANH_SACH)[number]["ma"];

/** Tab mặc định = hàng đợi của người duyệt; người không duyệt được thì mở "Đang bảo lưu". */
export function chonTab(q: string | undefined, coQuyenDuyet: boolean): MaTab {
  const t = TAB_DANH_SACH.find((x) => x.ma === q);
  if (t) return t.ma;
  return coQuyenDuyet ? "cho-duyet" : "dang";
}
