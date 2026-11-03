import { z } from "zod";
import { Role } from "@prisma/client";
import { canonicalPhone } from "@/lib/phone";

// Đợt 3B — đa vai trò: form gửi roles[] (union quyền) + primaryRole (vai trò
// chính, dùng cho dashboard mặc định + back-compat User.role). primaryRole PHẢI
// nằm trong roles. HO KHÔNG phải role — center độc lập đi qua orgUnitId (đơn vị).
const userFields = z.object({
  name: z.string().min(1, "Tên không được rỗng").max(100),
  email: z.string().email("Email không hợp lệ").toLowerCase().trim(),
  roles: z.array(z.nativeEnum(Role)).min(1, "Chọn ít nhất 1 vai trò"),
  primaryRole: z.nativeEnum(Role),
  // PR-B dual-write: giữ centerId, thêm orgUnitId (đơn vị tổ chức — gồm cả HO).
  centerId: z.string().min(1).nullable().optional(),
  orgUnitId: z.string().min(1).nullable().optional(),
  employeeId: z.string().min(1).nullable().optional(),
});

const primaryInRoles = (d: { roles: Role[]; primaryRole: Role }) =>
  d.roles.includes(d.primaryRole);
const primaryRefine = {
  message: "Vai trò chính phải nằm trong các vai trò đã chọn",
  path: ["primaryRole"],
};

export const userCreateSchema = userFields
  .extend({
    password: z
      .string()
      .min(8, "Mật khẩu tối thiểu 8 ký tự")
      .max(72, "Mật khẩu tối đa 72 ký tự"),
    // BGĐ 31/07 — SĐT làm tài khoản đăng nhập chính của nhân sự (AUTH-SĐT P3).
    // Lưu canonical 84XXXXXXXXX; rỗng → null (nhân sự cũ chưa có SĐT vẫn tạo được).
    phone: z
      .string()
      .trim()
      .max(20, "SĐT tối đa 20 ký tự")
      .optional()
      .nullable()
      .transform((v, ctx) => {
        if (!v) return null;
        const c = canonicalPhone(v);
        if (!c) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Số điện thoại không hợp lệ",
          });
          return z.NEVER;
        }
        return c;
      }),
  })
  .refine(primaryInRoles, primaryRefine);

export const userUpdateSchema = userFields.refine(primaryInRoles, primaryRefine);

export const passwordResetSchema = z
  .object({
    newPassword: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự").max(72),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Mật khẩu xác nhận không khớp",
    path: ["confirmPassword"],
  });

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
