// lib/hoc-bu/dong-trang-thai.ts — THUẦN: máy trạng thái của MỘT dòng cần bù (MakeupNeed = MakeupLine) — T05, 07/10/2026.
//
// Trước T05 có 10 chỗ sống đổi `MakeupNeed.status`, chỉ 6 chỗ ghi có điều kiện trạng thái cũ; bảng `MAKEUP_NEXT` trong
// `lib/lms/makeup.ts` thì sai so với thực tế (coi COMPLETED/CANCELLED là cuối đời, thiếu cạnh quay về) và chỉ đường CHẾT gọi nó.
// Đây là bảng DUY NHẤT: một cạnh = (từ, sang, LÝ DO). Cùng một cặp (từ, sang) có thể có nhiều lý do (SCHEDULED→PENDING vì gỡ khỏi
// case, vì huỷ case, vì bé vắng case), và mỗi lý do là một câu chuyện nghiệp vụ khác nhau — nên khoá theo lý do, để chỗ gọi
// KHÔNG thể dùng một cạnh hợp lệ cho một việc không phải của nó.
//
// KHÔNG có cạnh nào đi tới CANCELLED từ SCHEDULED: huỷ lớp từng làm thế (cascade) và bị bỏ theo quyết định 10 của chủ dự án —
// dòng đã xếp case phải về PENDING (gỡ/huỷ case) trước rồi mới huỷ được.
import type { MakeupNeedStatus } from "@prisma/client";

export type LyDoChuyen =
  /** PENDING → SCHEDULED: xếp vào một case. */
  | "XEP_CASE"
  /** SCHEDULED → PENDING: gỡ bé khỏi case chưa điểm danh. */
  | "GO_KHOI_CASE"
  /** SCHEDULED → PENDING: huỷ cả case chưa điểm danh. */
  | "HUY_CASE"
  /** SCHEDULED → PENDING: bé VẮNG ở buổi bù — không tiêu lượt, phí đã thu giữ. */
  | "BE_VANG_CASE"
  /** SCHEDULED → COMPLETED: bé CÓ MẶT ở buổi bù. */
  | "BE_CO_MAT_HOAN_THANH"
  /** PENDING → CANCELLED: quản lý huỷ "không bù nữa" (có lý do, có `waived*`). */
  | "HUY_KHONG_BU"
  /** PENDING → CANCELLED: buổi gốc sửa sang có mặt — nghĩa vụ không còn. */
  | "TU_HUY_DA_CO_MAT"
  /** CANCELLED → PENDING: quản lý khôi phục dòng đã huỷ tay (xoá `waived*`). */
  | "KHOI_PHUC"
  /** CANCELLED → PENDING: buổi gốc đánh vắng LẠI sau khi tự huỷ vì có mặt (chỉ dòng KHÔNG `waivedAt`). */
  | "HOI_SINH_VANG_LAI"
  /** COMPLETED → PENDING: sửa điểm danh case có đảo ngược (ADJUSTMENT hoàn lượt) — T07. */
  | "SUA_DIEM_DANH_DAO_NGUOC"
  /** PENDING → COMPLETED: sửa điểm danh case — bài từng ghi "chưa xong" thực ra đã học xong (T07). Dòng phải còn PENDING (chưa xếp chỗ khác). */
  | "SUA_DIEM_DANH_HOAN_THANH"
  /** PENDING → CANCELLED: duyệt bảo lưu LÙI NGÀY — buổi nằm trong khoảng bảo lưu "không tính vắng" (BR-09), nghĩa vụ bù không còn. Không có `waived*`. */
  | "BAO_LUU_LUI_NGAY";

export type CanhDong = { tu: MakeupNeedStatus; sang: MakeupNeedStatus; lyDo: LyDoChuyen };

export const CANH_DONG: readonly CanhDong[] = [
  { tu: "PENDING", sang: "SCHEDULED", lyDo: "XEP_CASE" },
  { tu: "SCHEDULED", sang: "PENDING", lyDo: "GO_KHOI_CASE" },
  { tu: "SCHEDULED", sang: "PENDING", lyDo: "HUY_CASE" },
  { tu: "SCHEDULED", sang: "PENDING", lyDo: "BE_VANG_CASE" },
  { tu: "SCHEDULED", sang: "COMPLETED", lyDo: "BE_CO_MAT_HOAN_THANH" },
  { tu: "PENDING", sang: "CANCELLED", lyDo: "HUY_KHONG_BU" },
  { tu: "PENDING", sang: "CANCELLED", lyDo: "TU_HUY_DA_CO_MAT" },
  { tu: "CANCELLED", sang: "PENDING", lyDo: "KHOI_PHUC" },
  { tu: "CANCELLED", sang: "PENDING", lyDo: "HOI_SINH_VANG_LAI" },
  { tu: "COMPLETED", sang: "PENDING", lyDo: "SUA_DIEM_DANH_DAO_NGUOC" },
  { tu: "PENDING", sang: "CANCELLED", lyDo: "BAO_LUU_LUI_NGAY" },
  { tu: "PENDING", sang: "COMPLETED", lyDo: "SUA_DIEM_DANH_HOAN_THANH" },
];

export const TRANG_THAI_DONG: readonly MakeupNeedStatus[] = ["PENDING", "SCHEDULED", "COMPLETED", "CANCELLED"];

/** Cạnh (từ, sang, lý do) có nằm trong bảng không. */
export function laCanhHopLe(tu: MakeupNeedStatus, sang: MakeupNeedStatus, lyDo: LyDoChuyen): boolean {
  return CANH_DONG.some((c) => c.tu === tu && c.sang === sang && c.lyDo === lyDo);
}

/** Dòng còn là nghĩa vụ ĐANG MỞ (chưa bù, chưa bị huỷ) — nơi duy nhất định nghĩa "mở". */
export const laDongDangMo = (s: MakeupNeedStatus): boolean => s === "PENDING" || s === "SCHEDULED";
