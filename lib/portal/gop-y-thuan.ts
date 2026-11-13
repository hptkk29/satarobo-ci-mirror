// Cổng phụ huynh — phần THUẦN của màn "Góp ý cho trung tâm" (artifact Gop-y.dc.html).

/**
 * Cổng phụ huynh (03/11/2026, chủ dự án): «các khảo sát chỉ cần 1 khảo sát cho 1 mục góp ý — ví dụ góp ý về cơ sở vật chất thì chỉ cần 1 khảo sát,
 * KHÔNG cần khảo sát sau buổi học thử, giữa khoá, cuối khoá». Mỗi khảo sát = một «mục góp ý» ⇒ cổng chỉ liệt kê khảo sát GENERAL.
 * Bốn mốc theo hành trình (AFTER_TRIAL · AFTER_3_SESSIONS · MID_COURSE · END_COURSE) và AFTER_COMPLAINT KHÔNG hiện ở cổng:
 * đo mã 03/11/2026 — không có cron / event / email / ZNS nào gửi khảo sát theo mốc cho phụ huynh hay dẫn tới /portal/khao-sat (chuông thông báo và thẻ Tổng quan
 * đọc qua cùng bộ nạp `getCenterSurveys` nên tự theo bộ lọc), AFTER_COMPLAINT cũng không có đường gửi riêng; mốc chỉ là nhãn admin gõ ở /admin/khao-sat. MỘT hàm thuần này dùng cho loader, trang khảo sát, hành động gửi và test — đừng chép điều kiện.
 */
export const MOC_KHAO_SAT_MUC_GOP_Y = "GENERAL" as const;

/** Khảo sát có thuộc «mục góp ý» của cổng phụ huynh không (chỉ mốc GENERAL). */
export function laKhaoSatMucGopY(milestone: string): boolean {
  return milestone === MOC_KHAO_SAT_MUC_GOP_Y;
}

/** Điều kiện `where` cho mọi truy vấn Survey của cổng phụ huynh. */
export function dieuKienKhaoSatMucGopY(): { milestone: typeof MOC_KHAO_SAT_MUC_GOP_Y } {
  return { milestone: MOC_KHAO_SAT_MUC_GOP_Y };
}

export const CHU_DE_GOP_Y = ["Giáo viên, giờ học", "Cơ sở vật chất", "Học phí", "Cổng phụ huynh này", "Khác"] as const;

/**
 * `ParentFeedback` chỉ có một cột nội dung (≥ 5 ký tự), không có cột chủ đề: chủ đề đi kèm ở đầu nội dung để người đọc ở trang quản trị
 * biết góp ý nói về mảng nào. Nội dung rỗng ⇒ trả rỗng (để server báo "Vui lòng nhập nội dung"), không bịa chữ cho đủ độ dài.
 */
export function noiDungGopY(chuDe: string, noiDung: string): string {
  const nd = noiDung.trim();
  return nd ? `[${chuDe}] ${nd}` : "";
}
