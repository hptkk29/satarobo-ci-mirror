// lib/auth/system-actor.ts — R6-F1/D1: Actor hệ thống cho cron/webhook (không request/session).
//
// Job nền (cron, webhook, dispatcher) không có user → cần Actor để dùng chung
// scopedDb/can()/factory. SYSTEM_ACTOR bỏ qua scope (như HO-level) và can()=true,
// nhưng mọi ghi audit dùng actorId=null + actorName="System" (truy vết rõ là máy).
import type { Actor } from "@/lib/auth/actor";

/** userId ảo cho hệ thống (không tồn tại trong bảng User). */
export const SYSTEM_USER_ID = "system";

/**
 * Actor hệ thống — quyền đầy đủ, bypass cách ly cơ sở (job chạy toàn hệ thống).
 * Dùng cho cron/webhook/dispatcher. KHÔNG dùng thay cho user thật trong request.
 */
export const SYSTEM_ACTOR: Actor = {
  userId: SYSTEM_USER_ID,
  isSuperAdmin: true,
  isHoLevel: true,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [],
  visibleOrgUnitIds: [],
  grantsAllow: new Set(),
  assignedClassIds: new Set(),
};

/** actorName chuẩn cho audit khi hệ thống ghi (cron/webhook). */
export const SYSTEM_ACTOR_NAME = "System";
