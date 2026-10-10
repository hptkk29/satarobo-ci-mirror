// app/(admin)/admin/lop-trial/_lib/attendance.ts — GĐ2.
//
// Hàm THUẦN của lưới điểm danh. Đặt ở _lib chứ không nằm trong component có chủ đích:
// component kéo theo `../_actions` → `@/lib/auth` → next-auth, mà next-auth không nạp
// được trong vitest. Để hàm ở đây thì test chạy không cần dựng cả cây phụ thuộc.
import type { EnrollmentRow, TrialAttendanceMark } from "./types";

/**
 * Đếm số em chưa được đánh dấu có mặt/vắng.
 *
 * Đây là điều kiện chặn nút "Lưu điểm danh": lưu dở dang thì buổi trông như đã điểm
 * danh trong khi vài em không có bản ghi nào, mà tiến độ học thử của lead lại tính
 * theo SỐ BẢN GHI có mặt — đếm sai ở đây là lead bị kẹt hoặc bị đẩy trạng thái sớm.
 *
 * Lưu ý ca dễ sai: bỏ chọn một em thì khoá vẫn còn trong nháp nhưng `status` là null,
 * nên phải kiểm giá trị chứ không kiểm sự tồn tại của khoá.
 */
export function demSoEmChuaDanhDau(
  markable: EnrollmentRow[],
  draft: Record<string, { status: TrialAttendanceMark | null }>,
): number {
  return markable.filter((e) => !draft[e.id]?.status).length;
}
