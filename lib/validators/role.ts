// lib/validators/role.ts — A0-02 Zod schema cho RBAC (reason BẮT BUỘC).
import { z } from "zod";

/** Mã role: chữ in hoa, số, gạch dưới; bắt đầu bằng chữ; 2–40 ký tự. */
export const ROLE_CODE_RE = /^[A-Z][A-Z0-9_]{1,39}$/;

export const SCOPE_TYPES = [
  "GLOBAL",
  "CENTER",
  "CLASS",
  "OWN",
  "CHILDREN",
  "ASSIGNED",
] as const;

const reason = z.string().trim().min(3, "Lý do thay đổi là bắt buộc (≥3 ký tự).");

const roleCode = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine((c) => ROLE_CODE_RE.test(c), {
    message: "Mã role: chữ IN HOA/số/gạch dưới, bắt đầu bằng chữ, 2–40 ký tự.",
  });

export const createRoleSchema = z.object({
  code: roleCode,
  name: z.string().trim().min(1, "Tên role không được để trống.").max(100),
  reason,
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  /** Chỉ role non-system mới đổi được code (service kiểm tra). */
  code: roleCode.optional(),
  reason,
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const rolePermissionItemSchema = z.object({
  action: z.string().trim().min(1),
  scopeType: z.enum(SCOPE_TYPES),
});

export const setRolePermissionsSchema = z.object({
  permissions: z.array(rolePermissionItemSchema),
  reason,
});
export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>;

/**
 * Menu gọn theo vai (28/09/2026) — đường dẫn mục menu ẨN với vai. KHÔNG phải quyền: chỉ gọn
 * lối vào (`lib/auth/menu-gon.ts`). Chỉ nhận đường dẫn nội bộ dạng "/students", "/bao-cao/churn".
 */
export const setRoleAnMenuSchema = z.object({
  anMenu: z
    .array(z.string().trim().regex(/^\/[a-z0-9\-/]*$/, "Đường dẫn menu không hợp lệ."))
    .max(200, "Quá nhiều mục."),
  reason,
});
export type SetRoleAnMenuInput = z.infer<typeof setRoleAnMenuSchema>;

export const assignUserOrgRoleSchema = z
  .object({
    userId: z.string().min(1),
    orgUnitId: z.string().min(1),
    roleId: z.string().min(1),
    effectiveFrom: z.coerce.date().optional(),
    effectiveTo: z.coerce.date().nullish(),
    reason,
  })
  .refine(
    (v) => !(v.effectiveTo && v.effectiveFrom && v.effectiveTo < v.effectiveFrom),
    { message: "effectiveTo phải sau effectiveFrom.", path: ["effectiveTo"] },
  );
export type AssignUserOrgRoleInput = z.infer<typeof assignUserOrgRoleSchema>;

export const revokeUserOrgRoleSchema = z.object({
  userId: z.string().min(1),
  orgUnitId: z.string().min(1),
  roleId: z.string().min(1),
  reason,
});
export type RevokeUserOrgRoleInput = z.infer<typeof revokeUserOrgRoleSchema>;
