// lib/parttime/buoi.ts — "buổi vận hành": quy ba nguồn buổi về MỘT dạng. THUẦN.
//
// KHÔNG có bảng OperationalSession (docs/cham-cong/parttime/01-DATA-MODEL.md §1): ClassSession, MakeupCase,
// TrialClassSession đã có đường ghi sống; bảng thứ tư là sự thật thứ tư phải đồng bộ. Phân công gắn vào buổi bằng
// khoá (sourceType, sourceId) — mã buổi ổn định khi xếp lại lịch (audit §7.2).
import type { WorkActivityType, WorkSourceType } from "@prisma/client";

export type BuoiVanHanh = {
  sourceType: WorkSourceType;
  sourceId: string;
  centerId: string;
  /** "YYYY-MM-DD" giờ VN */
  ngay: string;
  /** "HH:mm" */
  gioBatDau: string;
  /** "HH:mm" */
  gioKetThuc: string;
  activity: WorkActivityType;
  trangThai: string;
};

/** Mã phân loại buổi nghĩa là "học vượt" (danh mục SessionCategory, `catalog.ts`). */
export const MA_PHAN_LOAI_HOC_VUOT = "VUOT";

/**
 * Loại hoạt động của một buổi. Học vượt KHÔNG có model riêng — nó dạy bằng `MakeupCase` mang phân loại `VUOT`
 * (`lib/entitlements/hoc-vuot.ts`). Trial luôn là TRIAL: văn bản loại Trial khỏi "tiết đứng chính".
 */
export function loaiHoatDong(
  sourceType: WorkSourceType,
  maPhanLoai: string | null | undefined,
): WorkActivityType {
  if (sourceType === "TRIAL_SESSION") return "TRIAL";
  if (sourceType === "MAKEUP_CASE") return maPhanLoai === MA_PHAN_LOAI_HOC_VUOT ? "ADVANCE" : "MAKEUP";
  return "REGULAR_CLASS";
}
