import { z } from "zod";

/**
 * E-LEARNING ONLINE — HỢP ĐỒNG DTO + ÁNH XẠ LỖI → HTTP cho lớp API của học viên/phụ huynh (Workstream A viết route, Workstream B gọi).
 *
 * E-learning KHÔNG dựng route học viên. Tệp này là NGUỒN DUY NHẤT của: (1) hình dạng yêu cầu, (2) bảng mã lỗi → trạng thái HTTP, để A và B không mỗi bên
 * một kiểu. THUẦN (không DB, không `server-only`) nên dùng được ở route, ở client và ở test.
 *
 * Quy ước truyền tải — KHÔNG thuộc tệp này, do A chốt với B:
 *  · `parentUserId` KHÔNG BAO GIỜ nằm trong DTO: lấy từ PHIÊN đăng nhập ở máy chủ (cổng PH: `getPortalContext`; mobile: token). Client không gửi, không quyết.
 *  · `studentId` là con ĐANG CHỌN. Cổng web đã có nguyên tắc "KHÔNG lộ `studentId` trên URL portal" (CLAUDE.md) — web dùng cookie đã ký, mobile gửi trong thân/tiêu đề.
 *    Dù đi đường nào, hàm lõi đều TỰ kiểm sở hữu (`SAI_PHU_HUYNH`), nên sai ⇒ không thấy gì.
 *  · Thời gian trả về dạng ISO-8601 UTC (chuỗi).
 */

const id = z.string().trim().min(1).max(100);

export const khoaCuaHocVienRequest = z.object({ studentId: id }).strict();
export const mucLucRequest = z.object({ studentId: id, courseId: id }).strict();
export const baiRequest = z.object({ studentId: id, courseId: id, lessonStableId: id }).strict();
export const ghiTienDoRequest = baiRequest.extend({ percent: z.number().int().min(0).max(100).optional(), daDoc: z.boolean().optional() }).strict();
export const batDauLamBaiRequest = baiRequest;
export const nopBaiRequest = baiRequest.extend({ attemptId: id, traLoi: z.record(z.string().max(100), z.unknown()) }).strict();
export const ketQuaCacLuotRequest = baiRequest;
export const veMediaRequest = baiRequest.extend({ ttlGiay: z.number().int().min(10).max(300).optional() }).strict();
export const chungNhanRequest = z.object({ studentId: id }).strict();

export type KhoaCuaHocVienRequest = z.infer<typeof khoaCuaHocVienRequest>;
export type MucLucRequest = z.infer<typeof mucLucRequest>;
export type BaiRequest = z.infer<typeof baiRequest>;
export type GhiTienDoRequest = z.infer<typeof ghiTienDoRequest>;
export type NopBaiRequest = z.infer<typeof nopBaiRequest>;

/**
 * Mã lỗi của hàm học viên → trạng thái HTTP + nhãn cho client (B quyết câu chữ hiển thị; `ma` là hằng ổn định).
 *  · `SAI_PHU_HUYNH` ⇒ 404 (KHÔNG phải 403): không tiết lộ "học viên này có thật nhưng không phải của bạn".
 *  · hết hạn/thu hồi/chưa có quyền ⇒ 403 nhưng giữ `ma` riêng để client nói đúng ("gia hạn" khác "liên hệ trung tâm").
 *  · `CAI_DAT_KHONG_HOP_LE` ⇒ 503: cổng ĐÓNG khi cấu hình hỏng (lỗi của hệ thống, không phải của người dùng, và không được mở nội dung).
 */
export const HTTP_THEO_MA_LOI = {
  // sở hữu
  SAI_PHU_HUYNH: 404,
  // quyền học
  KHONG_CO_QUYEN: 403,
  DA_THU_HOI: 403,
  HET_HAN: 403,
  // cổng nội dung
  KHOA_CHUA_PHAT_HANH: 404,
  BAI_KHONG_TON_TAI: 404,
  BAI_DA_AN: 404,
  BAI_CHUA_MO: 403,
  DA_HOAN_THANH_KHONG_XEM_LAI: 403,
  CAI_DAT_KHONG_HOP_LE: 503,
  // tiến độ
  LOAI_BAI_KHONG_GHI_TRUC_TIEP: 422,
  THIEU_DU_LIEU: 422,
  // làm bài / thi
  BAI_KHONG_PHAI_DANH_GIA: 422,
  CHUA_GAN_DE: 409,
  DE_KHONG_HOAT_DONG: 409,
  DE_RONG: 409,
  HET_GIO: 409,
  LUOT_KHONG_TON_TAI: 404,
  // P0 Mobile: nháp + gián đoạn + chốt lượt (hợp đồng đề xuất cho A; xung đột revision là 200 với ketQua CONFLICT từng câu)
  LUOT_DA_CHOT: 409,
  LUOT_BI_GIAN_DOAN: 409,
  CAU_KHONG_THUOC_LUOT: 422,
  DAP_AN_KHONG_HOP_LE: 422,
  YEU_CAU_KHONG_HOP_LE: 422,
  VUOT_TAN_SUAT: 429,
  // media
  MEDIA_NGOAI_VUNG: 409,
  BAI_KHONG_PHAI_VIDEO: 422,
  CHUA_CO_VIDEO: 409,
  VE_SAI_DINH_DANG: 400,
  VE_SAI_CHU_KY: 401,
  VE_HET_HAN: 401,
  VE_KHONG_KHOP_QUYEN: 403,
} as const;

export type MaLoiHocVien = keyof typeof HTTP_THEO_MA_LOI;

/** Mã lạ (chưa khai) ⇒ 500, KHÔNG đoán 4xx: một mã mới mà chưa ai ánh xạ là lỗi tích hợp cần thấy ngay. */
export function httpTheoMaLoi(ma: string): number {
  return (HTTP_THEO_MA_LOI as Record<string, number>)[ma] ?? 500;
}

/** Khung phản hồi thống nhất (khớp hợp đồng API của repo: `{ ok, data }` / `{ ok:false, error:{ code, message } }`). */
export type PhanHoi<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
