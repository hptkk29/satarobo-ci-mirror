import { z } from "zod";

/**
 * FREE MODE (Owner OD06=A, F1–F4, 25/11/2026) — HỢP ĐỒNG HTTP THUẦN của lớp Mobile (không DB, không import lõi E nên test/đọc ở đâu cũng được).
 *
 * Bảng mã lỗi → HTTP của Free Mode. Lõi E chỉ GỢI Ý (`docs/elearning/fixtures/online-free-mode-va-quyen-hoc.json › goiYHttp`) và KHÔNG có mã Free Mode nào trong
 * `HTTP_THEO_MA_LOI` (mã lạ ⇒ 500). Bảng dưới là chốt của A; `free-mode-hop-dong.test.ts` ghim nó KHỚP gợi ý của E, trừ các ngoại lệ khai tường minh ở `NGOAI_LE_SO_VOI_E`.
 */
export const HTTP_FREE_MODE = {
  // — mã lõi E (gợi ý của E) —
  CHUA_DANG_NHAP: 401,
  KHONG_TIM_THAY: 404,
  HOC_VIEN_KHONG_TON_TAI: 404,
  CHUA_CO_VIDEO: 404,
  MEDIA_NGOAI_VUNG: 404,
  DA_CO_QUYEN_HOC: 409,
  DA_TUNG_CO_QUYEN: 409,
  CHUA_MO_BAI: 409,
  VUOT_GIOI_HAN_BAI: 403,
  HET_HAN_HOC_THU: 403,
  KHONG_DANG_KY_MIEN_PHI: 403,
  KHONG_DU_DIEU_KIEN: 403,
  VE_THIEU_TAI_KHOAN: 403,
  VE_KHONG_DUNG_TAI_KHOAN: 403,
  VE_SAI_DINH_DANG: 400,
  VE_SAI_CHU_KY: 403,
  VE_HET_HAN: 410,
  VE_KHONG_KHOP_BAN: 410,
  PHAN_TRAM_KHONG_HOP_LE: 422,
  KHOA_IDEMPOTENCY_KHONG_HOP_LE: 422,
  CAI_DAT_KHONG_HOP_LE: 503,
  /** C13 (E, 25/11): khoá có điều kiện tiên quyết (hoàn thành khoá/chứng nhận trước) mà học viên chưa đạt. */
  TIEN_QUYET_CHUA_DAT: 403,
  /** C11 (E, #1289, 26/11): phụ huynh của học viên CHƯA xác minh số điện thoại (`User.phoneVerifiedAt`) ⇒ chưa được tự nhận khoá miễn phí. E TỰ ép trong lõi `tuNhanKhoaMienPhi`. */
  CHUA_XAC_MINH_SDT: 403,
  /** C11 (E, #1289): số khoá miễn phí ĐANG HOẠT ĐỘNG của cùng phụ huynh (mọi con tính chung) đã đạt `hocThu.toiDaKhoaMienPhi`. */
  VUOT_SO_KHOA_MIEN_PHI: 403,
  // — mã của lớp Mobile (A) —
  /** Cổng chính sách Admin `freemode.selfClaim.enabled` đang TẮT. */
  CHINH_SACH_TAT: 403,
  KHO_VIDEO_CHUA_CAU_HINH: 503,
  KHOA_VIDEO_KHONG_HOP_LE: 409,
  /** Bài học thử không ghi tiến độ trực tiếp theo cách client gửi (vd. gửi `daDoc` cho bài VIDEO, hoặc thiếu cả hai trường). */
  LOAI_BAI_KHONG_GHI_TRUC_TIEP: 422,
} as const;

export type MaFreeMode = keyof typeof HTTP_FREE_MODE;

/** Chỗ A CHỦ ĐÍCH khác gợi ý của E (test ghim đúng tập này — thêm/bớt là có chủ đích). */
export const NGOAI_LE_SO_VOI_E: Readonly<Record<string, { goiYE: number; chot: number; lyDo: string }>> = {
  CAI_DAT_KHONG_HOP_LE: { goiYE: 500, chot: 503, lyDo: "cùng ý nghĩa HTTP_THEO_MA_LOI của E (503): cấu hình hỏng là lỗi của hệ thống, cổng ĐÓNG" },
};

export function httpFreeMode(ma: string): number {
  return Object.prototype.hasOwnProperty.call(HTTP_FREE_MODE, ma) ? (HTTP_FREE_MODE as Record<string, number>)[ma]! : 500;
}

export const THONG_BAO_FREE_MODE: Readonly<Record<string, string>> = {
  CHUA_DANG_NHAP: "Bạn cần đăng nhập.",
  KHONG_TIM_THAY: "Không tìm thấy nội dung này.",
  HOC_VIEN_KHONG_TON_TAI: "Không tìm thấy học viên.",
  CHUA_CO_VIDEO: "Bài này chưa có video.",
  MEDIA_NGOAI_VUNG: "Video chưa sẵn sàng.",
  DA_CO_QUYEN_HOC: "Học viên đã có quyền học khoá này. Hãy học trong phần Khoá học của con.",
  DA_TUNG_CO_QUYEN: "Học viên đã từng có quyền học khoá này nên không tự nhận lại được. Vui lòng liên hệ trung tâm.",
  CHUA_MO_BAI: "Hãy mở bài học trước khi ghi tiến độ.",
  VUOT_GIOI_HAN_BAI: "Đã dùng hết số bài học thử miễn phí của khoá này.",
  HET_HAN_HOC_THU: "Thời gian học thử miễn phí của khoá này đã hết.",
  KHONG_DANG_KY_MIEN_PHI: "Khoá này không mở đăng ký miễn phí.",
  KHONG_DU_DIEU_KIEN: "Học viên chưa đủ điều kiện nhận khoá miễn phí này.",
  VE_THIEU_TAI_KHOAN: "Vé phát không hợp lệ.",
  VE_KHONG_DUNG_TAI_KHOAN: "Vé phát không dành cho tài khoản này.",
  VE_SAI_DINH_DANG: "Vé phát không hợp lệ.",
  VE_SAI_CHU_KY: "Vé phát không hợp lệ.",
  VE_HET_HAN: "Vé phát đã hết hạn. Hãy xin vé mới.",
  VE_KHONG_KHOP_BAN: "Khoá học vừa được cập nhật. Hãy xin vé mới.",
  PHAN_TRAM_KHONG_HOP_LE: "Phần trăm tiến độ không hợp lệ.",
  KHOA_IDEMPOTENCY_KHONG_HOP_LE: "Yêu cầu không hợp lệ.",
  CAI_DAT_KHONG_HOP_LE: "Khoá học đang được cấu hình lại. Vui lòng thử lại sau.",
  TIEN_QUYET_CHUA_DAT: "Học viên cần hoàn thành khoá học tiên quyết trước khi nhận khoá này.",
  CHUA_XAC_MINH_SDT: "Cần xác minh số điện thoại của phụ huynh trước khi nhận khoá miễn phí.",
  VUOT_SO_KHOA_MIEN_PHI: "Đã đạt số khoá miễn phí tối đa. Khi một khoá hết hạn hoặc được huỷ, bạn có thể nhận khoá mới.",
  CHINH_SACH_TAT: "Tính năng tự nhận khoá miễn phí hiện chưa mở.",
  KHO_VIDEO_CHUA_CAU_HINH: "Video chưa sẵn sàng. Vui lòng thử lại sau.",
  KHOA_VIDEO_KHONG_HOP_LE: "Video chưa sẵn sàng.",
  LOAI_BAI_KHONG_GHI_TRUC_TIEP: "Bài này không ghi tiến độ theo cách này.",
};

/** Tham số tìm khoá: slug của khoá công khai (chữ thường, số, gạch ngang). */
export const SLUG_KHOA = /^[a-z0-9][a-z0-9-]{0,119}$/;
/** `stableId` của bài (chữ, số, gạch). */
export const ID_BAI = /^[A-Za-z0-9_-]{1,64}$/;

/** Thân ghi tiến độ học thử. VIDEO: `percent` (0–100, chỉ tăng). READ: `daDoc: true`. Trường lạ ⇒ 400. */
export const tienDoHocThuBodySchema = z
  .object({ percent: z.number().int().min(0).max(100).optional(), daDoc: z.boolean().optional() })
  .strict()
  .refine((v) => v.percent !== undefined || v.daDoc !== undefined, { message: "Cần percent (video) hoặc daDoc (bài đọc)." });
export type TienDoHocThuBody = z.infer<typeof tienDoHocThuBodySchema>;

/** Thân rỗng — client KHÔNG gửi được cờ nào (khoá idempotency do máy chủ suy ra; không có `cheDo`, `daThanhToan`…). */
export const thanRongSchema = z.object({}).strict();

/** Phân trang danh sách khoá học thử. */
export const locHocThuSchema = z
  .object({ trang: z.coerce.number().int().min(1).max(1000).optional(), coTrang: z.coerce.number().int().min(1).max(50).optional() })
  .strict();

/** Khoá idempotency tự nhận khoá miễn phí: SUY RA ở máy chủ theo (học viên × khoá) — client không gửi, nên không thể đổi để vòng qua "chỉ cấp một lần". */
export const khoaTuNhan = (studentId: string, courseId: string): string => `free-claim:${studentId}:${courseId}`;
