import { z } from "zod";

/** Lược đồ yêu cầu của nhóm /auth (API di động v1). `maThietBi` hạ về chữ thường TRƯỚC khi kiểm dạng UUID (bản rà P-20). */
export const thietBiSchema = z.object({
  maThietBi: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "Mã thiết bị không hợp lệ")),
  nenTang: z.enum(["ios", "android"]),
  tenMay: z.string().trim().max(100).optional(),
  phienBanApp: z.string().trim().max(32).optional(),
});

export const dangNhapSchema = z.object({
  dinhDanh: z.string().min(1, "Nhập số điện thoại hoặc email").max(254),
  matKhau: z.string().min(1, "Nhập mật khẩu").max(200),
  thietBi: thietBiSchema,
});

export const lamMoiSchema = z.object({ refreshToken: z.string().min(1).max(128) });
export const dangXuatSchema = z.object({ refreshToken: z.string().min(1).max(128) });

export type DangNhapInput = z.infer<typeof dangNhapSchema>;

/** `POST /notifications/read` — danh sách id mục thông báo cần đánh dấu đã đọc (tối đa 100; id lạ bị bỏ ở dịch vụ). */
export const danhDauDaDocSchema = z.object({ ids: z.array(z.string().min(1).max(100)).max(100) });
