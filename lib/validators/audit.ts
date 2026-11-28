// lib/validators/audit.ts — #05: schema break-glass (xem đầy đủ PII trong audit log).
// Câu 13 BGĐ: break-glass bắt buộc chọn/nhập lý do; hệ thống ghi log riêng.
import { z } from "zod";

/** Lý do break-glass — tối thiểu 10 ký tự (cùng chuẩn reason RBAC). */
export const breakGlassSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Vui lòng nhập lý do xem đầy đủ (tối thiểu 10 ký tự)"),
});

export type BreakGlassInput = z.infer<typeof breakGlassSchema>;
