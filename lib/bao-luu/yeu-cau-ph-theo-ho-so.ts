// lib/bao-luu/yeu-cau-ph-theo-ho-so.ts — THUẦN. Yêu cầu bảo lưu của phụ huynh (`ParentRequest`) đi THEO hồ sơ (vòng 3, chốt chủ dự án 11/10/2026).
//
// Trước đây yêu cầu dừng ở "đã tiếp nhận, chờ Quản lý duyệt" mãi mãi: hồ sơ duyệt / từ chối / huỷ / phục học xong thì cổng phụ huynh vẫn in câu cũ.
// Nay MỖI chuyển trạng thái của hồ sơ có liên quan ghi lại yêu cầu TRONG CÙNG transaction (`chuyenTrangThai`). Chữ ở MỘT chỗ này.
//
// ⚠️ Từ chối / huỷ KHÔNG chép lý do nội bộ sang cổng phụ huynh (lý do là ghi chú của nhân sự). Chỉ báo "trung tâm đã xử lý, sẽ liên hệ".
import type { ParentRequestStatus, StudentReserveEventKind, StudentReserveStatus } from "@prisma/client";

export const CHU_DA_XU_LY_CHUNG = "Trung tâm đã xử lý yêu cầu, nhân viên sẽ liên hệ phụ huynh.";
/** Phục học xong nhưng lớp đích CHƯA có buổi nào từ hôm nay (vòng 4): không bịa ngày. */
export const CHU_CHUA_CO_LICH_HOC_LAI = "Trung tâm sẽ báo lịch học lại";

const dmy = (d: Date) => d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });

export type BuocYeuCau = { status: ParentRequestStatus; response: string };

/**
 * Hồ sơ vừa chuyển (kind, den) ⇒ yêu cầu phụ huynh phải thành gì. `null` = bước này không đổi gì ở cổng phụ huynh
 * (START sau APPROVE, gia hạn, nhắc, chấm dứt…) — đừng ghi đè câu đã đúng.
 */
export function buocYeuCauTheoHoSo(p: {
  kind: StudentReserveEventKind;
  den: StudentReserveStatus;
  now: Date;
  startedAt: Date | null;
  standardEndDate: Date | null;
  /**
   * Ngày buổi học ĐẦU TIÊN của lớp đích (buổi không huỷ, từ ngày phục học trở đi) — vòng 4, chốt chủ dự án 12/10/2026. KHÔNG phải ngày bấm phục học:
   * phụ huynh cần biết bao giờ đi học lại, không cần biết nhân viên bấm lúc nào. `null` = lớp chưa có lịch. BẮT BUỘC (không mặc định): chỗ gọi
   * quên truyền thì `tsc` báo, thay vì lặng lẽ in lại ngày bấm.
   */
  buoiDauLopMoi: Date | null;
}): BuocYeuCau | null {
  if (p.kind === "APPROVE" && p.startedAt && p.standardEndDate) {
    return { status: "APPROVED", response: `Đã duyệt bảo lưu từ ${dmy(p.startedAt)} đến ${dmy(p.standardEndDate)}` };
  }
  if (p.kind === "REJECT") return { status: "REJECTED", response: CHU_DA_XU_LY_CHUNG };
  if (p.kind === "CANCEL") return { status: "CANCELLED", response: CHU_DA_XU_LY_CHUNG };
  if (p.kind === "RESUME" && p.den === "ENDED") {
    return { status: "APPROVED", response: p.buoiDauLopMoi ? `Đã xếp lớp học lại từ ${dmy(p.buoiDauLopMoi)}` : CHU_CHUA_CO_LICH_HOC_LAI };
  }
  return null;
}
