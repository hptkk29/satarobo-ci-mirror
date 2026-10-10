import { z } from "zod";
import { PaymentMethodType } from "@prisma/client";

const baseSchema = z.object({
  code: z
    .string()
    .min(1, "Mã không được rỗng")
    .max(50, "Mã tối đa 50 ký tự")
    .regex(/^[A-Z][A-Z0-9_]*$/, "Mã chỉ chứa A-Z, 0-9, _ (bắt đầu bằng chữ)"),
  name: z.string().min(1, "Tên không được rỗng").max(200),
  type: z.nativeEnum(PaymentMethodType),
  description: z.string().max(1000).nullable().optional(),
  image: z
    .string()
    .url("URL hình ảnh không hợp lệ")
    .nullable()
    .optional()
    .or(z.literal("")),

  canBuyCourse: z.boolean(),
  canBuyPackage: z.boolean(),
  canBuyExam: z.boolean(),
  canBuyProduct: z.boolean(),
  canDeposit: z.boolean(),

  bankBin: z.string().trim().max(6).nullable().optional(),
  bankName: z.string().max(100).nullable().optional(),
  bankBranch: z.string().max(200).nullable().optional(),
  bankAccountNumber: z.string().max(50).nullable().optional(),
  bankAccountName: z.string().max(200).nullable().optional(),

  gatewayConfig: z.string().nullable().optional(), // raw JSON string

  /**
   * Cơ sở sở hữu phương thức này. `null` = DÙNG CHUNG mọi cơ sở.
   *
   * ⚠️ Không phải "chưa gán" — xem ghi chú ở model PaymentMethod (prisma/schema.prisma)
   * và BACKFILL_SPECS (lib/org/center-bridge.ts). Form gửi lên chuỗi rỗng cho mục
   * "— Dùng chung —", nên chuẩn hoá "" → null NGAY tại đây thay vì để từng action tự
   * nhớ: quên một chỗ là ghi xuống chuỗi rỗng, và `centerId = ""` không khớp cơ sở nào
   * mà cũng không phải dùng chung ⇒ phương thức tàng hình ở mọi nơi.
   */
  centerId: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),

  displayOrder: z.number().int().min(0).max(9999),
  isActive: z.boolean(),
});

function validateConditional(
  data: z.infer<typeof baseSchema>,
  ctx: z.RefinementCtx,
) {
  // ⚠️ 31/08/2026 — ĐẢO lại chốt 30/08. Ba ô tài khoản nay là BẮT BUỘC với chuyển khoản,
  // vì chúng đã thành NGUỒN DỰNG MÃ QR (lib/payments/vietqr.ts:resolveOrderPaymentConfig).
  //
  // Ngày 30/08 em bỏ ràng buộc này với lý do "4 cột bank* là dữ liệu chết, bắt điền một ô
  // không ai đọc là cái bẫy". Lý do đó nay KHÔNG còn đúng: chủ dự án chốt 31/08 đưa hẳn
  // việc khai tài khoản vào form này, nên bỏ trống = phương thức chuyển khoản KHÔNG dựng
  // được QR, và người dùng chỉ phát hiện lúc bấm "Xuất QR" trên đơn thật.
  //
  // `bankBin` bắt buộc đúng 6 chữ số — chuẩn EMVCo của VietQR; sai một chữ số là ảnh QR
  // vẫn dựng ra nhưng trỏ nhầm ngân hàng.
  if (data.type === PaymentMethodType.BANK_TRANSFER) {
    if (!/^\d{6}$/.test(data.bankBin?.trim() ?? "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bankBin"],
        message: "Mã ngân hàng (BIN) gồm đúng 6 chữ số — vd Vietinbank 970415",
      });
    }
    if (!data.bankAccountNumber?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bankAccountNumber"],
        message: "Bắt buộc khi loại = Chuyển khoản — mã QR dựng từ số này",
      });
    }
    if (!data.bankAccountName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bankAccountName"],
        message: "Bắt buộc khi loại = Chuyển khoản — tên hiện khi phụ huynh quét QR",
      });
    }
  }

  if (data.gatewayConfig?.trim()) {
    try {
      JSON.parse(data.gatewayConfig);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gatewayConfig"],
        message: "JSON không hợp lệ",
      });
    }
  }
}

export const paymentMethodCreateSchema =
  baseSchema.superRefine(validateConditional);
export const paymentMethodUpdateSchema =
  baseSchema.superRefine(validateConditional);

export type PaymentMethodFormData = z.infer<typeof baseSchema>;
