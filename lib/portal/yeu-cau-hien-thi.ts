// lib/portal/yeu-cau-hien-thi.ts — NHÃN HIỂN THỊ của yêu cầu phụ huynh, dùng CHUNG cho màn admin (/admin/parent-requests) và cổng phụ huynh (/portal/yeu-cau). THUẦN.
//
// Mọi mốc thời gian đọc theo lịch VN (`lib/time/vn.ts`) — máy chủ chạy UTC, `toLocaleString` trần ở trình duyệt cũng lệch khi SSR.
import type { ParentRequestStatus, ParentRequestType } from "@prisma/client";
import { vnParts } from "@/lib/time/vn";

const THU = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"] as const;
const hai = (n: number) => String(n).padStart(2, "0");

/** `Thứ Sáu, 14/11/2026` — chỉ NGÀY (lịch VN). */
export function nhanNgayDayDu(d: Date): string {
  const p = vnParts(d);
  return `${THU[p.weekday]}, ${hai(p.day)}/${hai(p.month + 1)}/${p.year}`;
}

/** `18:30` (lịch VN). */
export function nhanGio(d: Date): string {
  const p = vnParts(d);
  return `${hai(p.hour)}:${hai(p.minute)}`;
}

/**
 * Mốc phụ huynh ĐỀ XUẤT. Đơn cũ chỉ lưu NGÀY (nửa đêm VN) ⇒ chỉ in ngày; đơn mới có giờ ⇒ `Thứ Hai, 17/11/2026 · 18:30`.
 * `null` khi không có mốc.
 */
export function nhanMocDeXuat(d: Date | null | undefined): string | null {
  if (!d) return null;
  const p = vnParts(d);
  return p.hour === 0 && p.minute === 0 ? nhanNgayDayDu(d) : `${nhanNgayDayDu(d)} · ${nhanGio(d)}`;
}

/** `13/11/2026 08:13` — thời điểm gửi (lịch VN). */
export function nhanThoiDiemGui(d: Date): string {
  const p = vnParts(d);
  return `${hai(p.day)}/${hai(p.month + 1)}/${p.year} ${hai(p.hour)}:${hai(p.minute)}`;
}

/** Thứ tự các nhóm loại yêu cầu khi liệt kê — việc cần làm trong ngày lên trước. */
export const THU_TU_LOAI: readonly ParentRequestType[] = [
  "ABSENCE",
  "MAKEUP",
  "TRANSFER_CLASS",
  "TRANSFER_CENTER",
  "RESERVE",
  "CONSENT_CHANGE",
  "OTHER",
];

/** Mô tả MỘT dòng cho từng loại (tiêu đề nhóm ở màn admin). */
export const MO_TA_LOAI: Record<ParentRequestType, string> = {
  ABSENCE: "Tiếp nhận để ghi buổi đó vắng có phép; phụ huynh rút đơn thì tự gỡ.",
  MAKEUP: "Phụ huynh đề xuất ngày giờ bù — Sale thống nhất lịch rồi xếp vào case dạy bù.",
  TRANSFER_CLASS: "Đổi sang lớp hoặc khung giờ khác.",
  TRANSFER_CENTER: "Chuyển sang cơ sở khác của trung tâm.",
  RESERVE: "Tạm dừng khoá, giữ học phí — lập hồ sơ bảo lưu.",
  CONSENT_CHANGE: "Đổi đồng ý sử dụng hình ảnh của con.",
  OTHER: "Việc khác cần trung tâm hỗ trợ.",
};

/** Trạng thái đã khép (không còn việc cho nhân viên). */
export const laDonDaKhep = (s: ParentRequestStatus): boolean => s !== "PENDING";
