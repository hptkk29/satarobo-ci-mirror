// lib/hoa-hong/khieu-nai-quan-he.ts — QUAN HỆ giữa người khiếu nại và một khoản thu "không có dòng của mình". THUẦN.
//
// Nguồn: docs/source-commission/05 §1.2 (`coTheKhieuNaiKhoanThu` vế (b)), 04 §15, H11.
//
// Tập quan hệ HIỆN HIỆN THỰC (khớp H11 trừ một vế): chủ lead hiện tại · người giới thiệu trên nguồn · GV dạy buổi trial của bé.
// VẾ CHƯA CÓ: "người nhập" (`Lead.intakeEmployeeId`) — cột đó là cột DỜI, thêm chỉ khi H11 chốt vế này (02 §6.7). Chưa chốt thì không thêm
// cột, và cũng không lấy `Lead.createdById` thay (người tạo lead ≠ người nhập theo nghĩa hoa hồng — đoán là đẻ ra quyền khiếu nại).
//
// Hàm CHỈ nhận id đã nạp; mọi so sánh đều đòi cả hai vế KHÁC rỗng/null (xem ca `[NHH-DSP-02q-null]`).
export type NguCanhQuanHe = {
  lead: { convertedById: string | null; adminId: string | null; assignedToId: string | null } | null;
  /** `LeadAttribution.referrerParentUserId`. */
  referrerParentUserId: string | null;
  /** `User.id` của nhân sự giới thiệu (đã đổi từ `Employee.id`). */
  referrerEmployeeUserId: string | null;
  /** GV buổi trial bé đã học (`findAttendedTrialForLeadChild`). */
  gvTrialUserId: string | null;
};

export type QuanHe = "CHU_LEAD" | "NGUOI_GIOI_THIEU" | "GV_TRIAL";

export const NHAN_QUAN_HE: Readonly<Record<QuanHe, string>> = {
  CHU_LEAD: "chủ lead",
  NGUOI_GIOI_THIEU: "người giới thiệu",
  GV_TRIAL: "giáo viên dạy trial",
};

const trung = (a: string, b: string | null | undefined): boolean => a.length > 0 && b != null && b.length > 0 && a === b;

export function quanHeVoiKhoan(userId: string, c: NguCanhQuanHe): QuanHe[] {
  const ra: QuanHe[] = [];
  if (c.lead && (trung(userId, c.lead.convertedById) || trung(userId, c.lead.adminId) || trung(userId, c.lead.assignedToId))) ra.push("CHU_LEAD");
  if (trung(userId, c.referrerParentUserId) || trung(userId, c.referrerEmployeeUserId)) ra.push("NGUOI_GIOI_THIEU");
  if (trung(userId, c.gvTrialUserId)) ra.push("GV_TRIAL");
  return ra;
}
