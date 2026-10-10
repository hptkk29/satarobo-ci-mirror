// lib/cham-cong/_handlers/attendance-day.ts — handler DomainEvent `hr.attendance_day_dirty`:
// tính lại một ngày công. Idempotent (recompute là upsert), an toàn chạy lại.
import { on, type DomainEventLite } from "@/lib/events/registry";
import { ATTENDANCE_DAY_DIRTY, recomputeAttendanceDay } from "../recompute";

export async function onAttendanceDayDirty(event: DomainEventLite): Promise<void> {
  const userId = String(event.payload.userId ?? "");
  const ymd = String(event.payload.workDate ?? "");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!userId || !m) return; // payload hỏng — bỏ qua, không retry vô ích
  await recomputeAttendanceDay(userId, new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
}

export function registerAttendanceDayHandlers(): void {
  on(ATTENDANCE_DAY_DIRTY, onAttendanceDayDirty);
}
