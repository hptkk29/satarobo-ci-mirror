import { z } from "zod";
import { canonicalPhone } from "@/lib/phone";

/**
 * AUTH-SĐT P3 — login nhận CẢ SĐT lẫn email: `identifier` hợp lệ khi là email
 * đúng dạng HOẶC SĐT di động VN canonical hoá được (lib/phone.ts). Hai tập
 * không giao nhau (email luôn chứa ký tự ngoài chữ số) nên tầng authorize rẽ
 * nhánh được bằng `canonicalPhone(identifier) !== null`.
 * KHÔNG lowercase email ở đây — ngữ nghĩa hoa/thường của login giữ nguyên như
 * trước P3 (đổi = phải đo trùng lower(email) trên PROD trước, xem PR P3).
 */
export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, "Nhập số điện thoại hoặc email")
    .refine((v) => z.string().email().safeParse(v).success || canonicalPhone(v) !== null, {
      message: "Số điện thoại hoặc email không hợp lệ",
    }),
  password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự"),
});

/**
 * AUTH-SĐT P5 — `/kich-hoat` nhận SĐT hoặc email, cùng tập hợp lệ với login.
 *
 * Khác `loginSchema.identifier` ở đúng một điểm: **transform về dạng tra cứu**
 * (SĐT → canonical `84…`, email → lowercase). Lý do phải lowercase ở đây trong
 * khi login cố ý KHÔNG: schema cũ của màn kích hoạt (`z.string().email()
 * .toLowerCase()`) đã lowercase từ trước, nên giữ nguyên để **không đổi tập tài
 * khoản khớp được** — đổi ngữ nghĩa hoa/thường là việc riêng, phải đo trùng
 * `lower(email)` trên PROD trước (scripts/sql/login-email-case.sql).
 */
export const activationIdentifierSchema = z
  .string()
  .trim()
  .min(1, "Nhập số điện thoại hoặc email")
  .refine((v) => z.string().email().safeParse(v).success || canonicalPhone(v) !== null, {
    message: "Số điện thoại hoặc email không hợp lệ",
  })
  .transform((v) => canonicalPhone(v) ?? v.toLowerCase());

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(8),
    newPassword: z.string().min(8, "Mật khẩu mới tối thiểu 8 ký tự"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Mật khẩu xác nhận không khớp",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
