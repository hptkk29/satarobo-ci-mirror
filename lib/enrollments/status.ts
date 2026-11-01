import type { EnrollmentStatus } from "@prisma/client";

/**
 * FIX-H4 — Guard state machine cho Enrollment.
 *
 * State machine: các chuyển trạng thái HỢP LỆ theo từng trạng thái nguồn.
 * Mẫu theo `lib/orders/status.ts` (transition map + canTransition).
 *
 * Quy tắc:
 * - PENDING (chờ xếp lớp) → CONFIRMED | CANCELLED
 * - CONFIRMED (đã xếp lớp) → STUDYING | ACTIVE | WITHDREW | CANCELLED
 * - STUDYING / ACTIVE (đang học) → PAUSED | COMPLETED | WITHDREW | TRANSFERRED
 * - PAUSED (bảo lưu) → STUDYING | ACTIVE | WITHDREW | TRANSFERRED
 * - COMPLETED | WITHDREW | TRANSFERRED | CANCELLED → terminal (không ra)
 *
 * Lưu ý: transfer thực hiện qua `transferEnrollment` (đặt TRANSFERRED) — vẫn liệt kê
 * TRANSFERRED là đích hợp lệ từ STUDYING/ACTIVE/PAUSED để map nhất quán.
 */
export const ENROLLMENT_TRANSITIONS: Record<EnrollmentStatus, EnrollmentStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["STUDYING", "ACTIVE", "WITHDREW", "CANCELLED"],
  STUDYING: ["PAUSED", "COMPLETED", "WITHDREW", "TRANSFERRED"],
  ACTIVE: ["PAUSED", "COMPLETED", "WITHDREW", "TRANSFERRED"],
  PAUSED: ["STUDYING", "ACTIVE", "WITHDREW", "TRANSFERRED"],
  COMPLETED: [], // terminal
  WITHDREW: [], // terminal
  TRANSFERRED: [], // terminal
  CANCELLED: [], // terminal
};

/**
 * `true` nếu chuyển từ `from` sang `to` hợp lệ theo state machine.
 * No-op (from === to) trả `false` — không coi là transition hợp lệ
 * (action gọi đã chặn riêng "Trạng thái không thay đổi").
 */
export function canTransition(from: EnrollmentStatus, to: EnrollmentStatus): boolean {
  return ENROLLMENT_TRANSITIONS[from]?.includes(to) ?? false;
}
