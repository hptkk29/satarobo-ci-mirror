// lib/validators/khuyen-mai.ts — khuôn đầu vào của module Chính sách khuyến mãi (26/09/2026).
// Zod là nguồn sự thật; kiểu suy ra bằng `z.infer`.
import { z } from "zod";
import { laNgayHopLe } from "@/lib/format/thoi-gian-vn";

const ngay = (ten: string) =>
  z.string().trim().refine(laNgayHopLe, `${ten} không hợp lệ (dạng năm-tháng-ngày).`);

/**
 * Mã văn bản — "SR.QD.233", "SR.TB.12"… Viết hoa, chữ/số/dấu chấm/gạch. Chuẩn hoá về chữ hoa
 * để "sr.qd.233" và "SR.QD.233" không thành hai văn bản.
 */
export const maVanBan = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._/-]{1,39}$/, "Mã văn bản gồm chữ, số, dấu chấm hoặc gạch (vd SR.QD.233).");

/**
 * Tệp văn bản gốc: CHỈ nhận KHOÁ đối tượng R2 trong đúng hai thư mục mà route tải lên cấp cho người
 * ban hành (`uploads/documents/…`, `uploads/images/…`). URL hiển thị do SERVER dựng lại từ khoá
 * (`getPublicUrl`) — không bao giờ lấy URL client gửi lên.
 *
 * Vì sao (rà bảo mật 26/09, KM-01): bản đầu nhận `url: z.string().url()` — zod coi
 * `javascript:alert(1)`/`data:text/html,…` là URL hợp lệ, giá trị đó được lưu rồi render thành
 * `<a href>` trước mặt Sale ⇒ XSS lưu trữ. Không có trường `url` ở đây là cố ý.
 */
const tepVanBan = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^uploads\/(documents|images)\/[A-Za-z0-9._/-]{1,400}$/, "Tệp văn bản không hợp lệ — tải lại tệp.")
      // Không cho ".." — không để khoá trỏ lùi ra ngoài thư mục tải lên trên CDN.
      .refine((k) => !k.includes(".."), "Tệp văn bản không hợp lệ — tải lại tệp."),
    ten: z.string().trim().min(1).max(200),
  })
  .nullable();

export const chinhSachSchema = z
  .object({
    maVanBan,
    ten: z.string().trim().min(3, "Tên chính sách tối thiểu 3 ký tự.").max(200),
    noiDungUuDai: z
      .string()
      .trim()
      .min(10, "Ghi rõ ưu đãi khách nhận được — Sale đọc đúng câu này để tư vấn.")
      .max(4000),
    dieuKien: z.string().trim().max(4000).optional().transform((s) => (s ? s : null)),
    tuNgay: ngay("Ngày bắt đầu"),
    denNgay: ngay("Ngày kết thúc"),
    /** OrgUnit.id — rỗng = toàn hệ thống. */
    coSo: z.array(z.string().min(1)).max(50).default([]),
    /** Course.id — rỗng = mọi khoá. */
    khoaHoc: z.array(z.string().min(1)).max(100).default([]),
    tep: tepVanBan.default(null),
  })
  .refine((v) => v.denNgay >= v.tuNgay, { path: ["denNgay"], message: "Ngày kết thúc phải từ ngày bắt đầu trở đi." });
export type ChinhSachInput = z.infer<typeof chinhSachSchema>;

export const suaChinhSachSchema = z.object({ id: z.string().min(1) }).and(chinhSachSchema);

export const thuHoiSchema = z.object({
  id: z.string().min(1),
  lyDo: z.string().trim().min(10, "Ghi lý do thu hồi (tối thiểu 10 ký tự) — Sale sẽ đọc câu này.").max(500),
});

/** Mã voucher khách đọc/nhập — chữ hoa, số, gạch. */
export const maVoucher = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/, "Mã voucher 3–32 ký tự: chữ, số, gạch ngang hoặc gạch dưới.");

export const voucherSchema = z
  .object({
    chinhSachId: z.string().min(1),
    ma: maVoucher,
    kieu: z.enum(["PERCENT", "FIXED"]),
    phanTram: z.number().int().min(1).max(100).nullable().default(null),
    soTien: z.number().int().min(1000).max(100_000_000).nullable().default(null),
    giamToiDa: z.number().int().min(1000).max(100_000_000).nullable().default(null),
    donToiThieu: z.number().int().min(0).max(1_000_000_000).default(0),
    soLuong: z.number().int().min(1).max(1_000_000).nullable().default(null),
    ghiChu: z.string().trim().max(500).optional().transform((s) => (s ? s : null)),
  })
  .superRefine((v, ctx) => {
    if (v.kieu === "PERCENT" && v.phanTram == null) {
      ctx.addIssue({ code: "custom", path: ["phanTram"], message: "Nhập phần trăm giảm (1–100)." });
    }
    if (v.kieu === "FIXED" && v.soTien == null) {
      ctx.addIssue({ code: "custom", path: ["soTien"], message: "Nhập số tiền giảm." });
    }
  });
export type VoucherInput = z.infer<typeof voucherSchema>;

export const tatVoucherSchema = z.object({ id: z.string().min(1), bat: z.boolean() });
