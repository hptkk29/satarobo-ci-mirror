import { z } from "zod";
import { ALL_ACTIONS } from "@/lib/auth/permissions";

// ALL_ACTIONS đảm bảo action string khớp 1-1 với matrix → reject input
// không hợp lệ ngay từ Zod parse.
const ACTION_ENUM = z.enum(ALL_ACTIONS as unknown as [string, ...string[]]);

export const grantCreateSchema = z.object({
  action: ACTION_ENUM,
  grant: z.enum(["ALLOW", "DENY"]),
  reason: z.string().max(500).optional().nullable(),
});

export const grantUpdateSchema = z.object({
  grant: z.enum(["ALLOW", "DENY"]),
  reason: z.string().max(500).optional().nullable(),
});

export type GrantCreateInput = z.infer<typeof grantCreateSchema>;
export type GrantUpdateInput = z.infer<typeof grantUpdateSchema>;
