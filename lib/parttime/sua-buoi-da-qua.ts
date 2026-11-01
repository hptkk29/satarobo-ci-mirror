// lib/parttime/sua-buoi-da-qua.ts — QLCS SỬA BUỔI ĐÃ QUA (chủ dự án chốt 20/10/2026). THUẦN.
//
// *"cho phép QLCS sửa thông tin các buổi đã qua, nhưng phải ghi lại được log để đối soát với các giáo viên có liên quan"* — và
// chọn phạm vi "cả người thực dạy (nhận công)". Ba thứ sửa được: GV đứng chính (phân công) · trợ giảng (phân công) · người thực
// dạy (`ClassSession.actualTeacherId`, chỉ buổi lớp ĐÃ CHỐT — chính trường quyết định công dạy).
//
// Một ĐƯỜNG RIÊNG, không nới cổng `MO` của `phanCongVaoBuoi` hay cổng đóng băng DA_CHOT của `keHoachDongBo` — nới ở đó là để mọi
// lượt dời lịch / đồng bộ tự viết lại lịch sử. Ở đây mỗi lượt sửa: lý do BẮT BUỘC (gửi nguyên văn cho giáo viên liên quan) ·
// một dòng audit `PT_PAST_SESSION_EDITED` cho TỪNG thay đổi (trước → sau, người liên quan) · chuông cho người cũ và người mới.
import type { TinhTrangBuoi } from "./phan-cong";

export const LY_DO_TOI_THIEU = 10;
export const HANH_DONG_SUA_QUA = "PT_PAST_SESSION_EDITED";
/** Luồng audit của MỘT buổi: entityType cố định + entityId = sourceId ⇒ QLCS đọc lại đủ lịch sử sửa của buổi ở một câu tra. */
export const ENTITY_SUA_QUA = "ParttimeBuoiDaQua";

export type TruongSua = "MAIN_TEACHER" | "TEACHING_ASSISTANT" | "THUC_DAY";

/** Buổi "đã qua" theo nghĩa của màn: đã chốt, hoặc còn mở mà ngày đã trước hôm nay (giờ VN). */
export function laBuoiDaQua(b: { ngay: string; tinhTrang: TinhTrangBuoi }, homNay: string): boolean {
  return b.tinhTrang === "DA_CHOT" || (b.tinhTrang === "MO" && b.ngay < homNay);
}

/** Lý do KHÔNG sửa được — null là được. MỘT hàm cho action (server) và nút trên màn (luật 12). */
export function loiSuaBuoiDaQua(v: {
  ngay: string;
  homNay: string;
  tinhTrang: TinhTrangBuoi;
  apDung: boolean;
  kyDaChot: boolean;
  lyDo: string | null;
}): string | null {
  if (!v.apDung) return "Buổi trước 15/10/2026 thuộc chính sách cũ — không sửa theo SR.QD.238.";
  if (v.tinhTrang === "DA_DONG") return "Buổi đã huỷ / đóng — không có người để sửa.";
  if (!laBuoiDaQua(v, v.homNay)) return "Buổi chưa qua — dùng thao tác phân công thường.";
  if (v.kyDaChot) return `Kỳ công tháng ${v.ngay.slice(5, 7)}/${v.ngay.slice(0, 4)} của cơ sở đã chốt — mở lại kỳ trước khi sửa buổi.`;
  if (v.lyDo != null && v.lyDo.trim().length < LY_DO_TOI_THIEU) return `Ghi lý do (tối thiểu ${LY_DO_TOI_THIEU} ký tự) — lý do gửi kèm cho giáo viên liên quan để đối soát.`;
  return null;
}

/** Người liên quan của một thay đổi (cũ + mới, bỏ trống) — khoá để giáo viên đọc nhật ký của chính mình. */
export function nguoiLienQuan(tu: string | null, den: string | null): string[] {
  return [...new Set([tu, den].filter((x): x is string => !!x))];
}

export const NHAN_TRUONG: Record<TruongSua, string> = {
  MAIN_TEACHER: "Giáo viên đứng chính",
  TEACHING_ASSISTANT: "Trợ giảng",
  THUC_DAY: "Người thực dạy (nhận công)",
};
