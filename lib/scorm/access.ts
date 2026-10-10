// lib/scorm/access.ts — R7-12: quyền mở SCORM player THUẦN (không cần DB/browser).
// canOpenScorm = GV phân công lớp (teacher/assistant/actualTeacher) ∪ training:manage.
// Đọc Actor shape (lib/auth/actor.ts) + helper can() (lib/auth/can.ts).
import type { Actor } from "@/lib/auth/actor";
import { getEffectivePermissions } from "@/lib/auth/can";

/** Action quản lý đào tạo — Đào tạo/Admin được xem thử & mở mọi gói. */
export const TRAINING_MANAGE = "training:manage" as const;

/**
 * Hình dạng tối thiểu của ClassSession (+ class) cần để xác quyền.
 * `actualTeacherId` nằm trên ClassSession (R7-07); teacher/assistant trên Class.
 */
export type ScormClassSession = {
  /** GV thực dạy buổi (R7-07) — soft-ref userId. */
  actualTeacherId?: string | null;
  class?: {
    teacherId?: string | null;
    assistantId?: string | null;
  } | null;
};

/** Actor chỉ cần các trường để kiểm tra danh tính + quyền (tách khỏi DB). */
export type ScormActor = Pick<
  Actor,
  "userId" | "isSuperAdmin" | "permissions" | "grantsAllow"
>;

/** True nếu actor là GV được phân công buổi/lớp này. */
export function isAssignedTeacher(
  actor: ScormActor,
  classSession: ScormClassSession,
): boolean {
  const uid = actor.userId;
  if (!uid) return false;
  const cls = classSession.class ?? null;
  return (
    classSession.actualTeacherId === uid ||
    cls?.teacherId === uid ||
    cls?.assistantId === uid
  );
}

/** True nếu actor có quyền quản lý đào tạo (bỏ qua scope — xem thử mọi gói). */
export function canManageTraining(actor: ScormActor): boolean {
  if (actor.isSuperAdmin) return true;
  return getEffectivePermissions(actor as Actor).has(TRAINING_MANAGE);
}

/**
 * Quyền mở SCORM player: GV phân công lớp HOẶC có training:manage.
 * THUẦN — không chạm DB; caller resolve Actor + ClassSession trước.
 */
export function canOpenScorm(
  actor: ScormActor,
  classSession: ScormClassSession,
): boolean {
  return isAssignedTeacher(actor, classSession) || canManageTraining(actor);
}
