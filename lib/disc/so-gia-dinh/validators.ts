/**
 * ZOD — đầu vào Server Action của sổ gia đình DISC. Zod là nguồn của kiểu (`z.infer`).
 * Không tin client: mọi chuỗi bị cắt độ dài, mọi số bị kẹp biên.
 */
import { z } from "zod";

import { VAI_GIA_DINH } from "./vai";

export const TEN_TOI_DA = 30;
export const SO_THANH_VIEN_TOI_DA_SO = 8;

const idSchema = z.string().trim().min(1).max(64);
const tenSchema = z.string().trim().min(1, "Nhập tên gọi trong nhà.").max(TEN_TOI_DA, `Tên tối đa ${TEN_TOI_DA} ký tự.`);

export const LOP_HOP_LE = ["mam-non", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "tren-12"] as const;

export const vaiTroSchema = z.enum(VAI_GIA_DINH);
export const lopSchema = z.enum(LOP_HOP_LE);
export const cachLamSchema = z.enum(["TU_LAM", "GOC_NHIN"]);
export const kySchema = z.enum(["NGAY_7", "THANG_1", "NAM_1"]);
export const ngayYmdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ.");

const namSinhSchema = z.number().int().min(1920).max(2100);

export const taoSoSchema = z.object({
  tenGiaDinh: z.string().trim().max(60).optional(),
  tenChuSo: tenSchema,
  vaiTroChuSo: z.enum(["bo", "me", "ong", "ba", "nguoi-than", "khac"]),
  namSinhChuSo: namSinhSchema.nullable().optional(),
  /** Gợi ý học viên của tài khoản này làm thành viên vai «con» (mặc định: có). */
  goiYHocVien: z.boolean().optional(),
});
export type TaoSoInput = z.infer<typeof taoSoSchema>;

export const thanhVienSchema = z.object({
  id: idSchema.optional(),
  ten: tenSchema,
  vaiTro: vaiTroSchema,
  lop: lopSchema.nullable().optional(),
  namSinh: namSinhSchema.nullable().optional(),
  ghiChu: z.string().trim().max(200).nullable().optional(),
  studentId: idSchema.nullable().optional(),
});
export type ThanhVienInput = z.infer<typeof thanhVienSchema>;

export const xoaThanhVienSchema = z.object({
  id: idSchema,
  // BẮT BUỘC chọn — cố ý không có mặc định ở tầng lưu (doc 18, 2.2).
  cheDo: z.enum(["giu-bai", "xoa-bai"]),
});
export type XoaThanhVienInput = z.infer<typeof xoaThanhVienSchema>;

export const phatDeSchema = z.object({ thanhVienId: idSchema, cachLam: cachLamSchema });
export type PhatDeInput = z.infer<typeof phatDeSchema>;

/** Câu trả lời theo vị trí: khoá "0".."n-1", giá trị nguyên 1..7 (kiểm lại theo thang bộ đề ở server). */
export const traLoiSchema = z.record(z.string().regex(/^\d{1,3}$/), z.number().int().min(1).max(7));

export const nopBaiSchema = z.object({
  thanhVienId: idSchema,
  cachLam: cachLamSchema,
  ve: z.string().min(10).max(20_000),
  traLoi: traLoiSchema,
});
export type NopBaiInput = z.infer<typeof nopBaiSchema>;

export const luuNhapSchema = z.object({
  thanhVienId: idSchema,
  cachLam: cachLamSchema,
  ve: z.string().min(10).max(20_000),
  traLoi: traLoiSchema,
});
export type LuuNhapInput = z.infer<typeof luuNhapSchema>;

export const taoKeHoachSchema = z.object({ ky: kySchema, batDau: ngayYmdSchema });
export type TaoKeHoachInput = z.infer<typeof taoKeHoachSchema>;

export const viecSchema = z.object({ viecId: idSchema });

export const checkinSchema = z.object({
  keHoachId: idSchema,
  tuan: z.number().int().min(1).max(60),
  /** Điểm hoà thuận 1–5 theo từng thành viên. */
  diem: z.array(z.object({ thanhVienId: idSchema, diem: z.number().int().min(1).max(5) })).min(1).max(SO_THANH_VIEN_TOI_DA_SO),
  capDeChiu: z.tuple([idSchema, idSchema]).nullable().optional(),
});
export type CheckinInput = z.infer<typeof checkinSchema>;

export const pinSchema = z.object({ pin: z.string().regex(/^\d{4}$/, "Mã PIN gồm đúng 4 chữ số.") });
