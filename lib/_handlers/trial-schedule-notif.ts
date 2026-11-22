// lib/_handlers/trial-schedule-notif.ts — R7-17: consumer cho trial.schedule_changed.
// Khi buổi học thử bị đổi giờ (updateTrialAction), báo Sale phụ trách lead
// (StaffNotification inbox admin). Idempotent qua dedupeKey kèm giờ mới.
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";
import { notifyStaff } from "@/lib/notifications/notify";

const str = (v: unknown): string => (v == null ? "" : String(v));

function fmtAt(v: unknown): string {
  const s = str(v);
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

// ─── trial.schedule_changed → Sale phụ trách lead (R7-17) ─────────────────────
export async function onTrialScheduleChanged(event: DomainEventLite): Promise<void> {
  const trialId = str(event.payload.trialId);
  const leadId = str(event.payload.leadId);
  if (!trialId || !leadId) return;

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { assignedToId: true, adminId: true, parentName: true },
  });
  const userId = lead?.assignedToId ?? lead?.adminId;
  if (!userId) return;

  const toAt = fmtAt(event.payload.toAt);
  const body =
    `Buổi học thử của phụ huynh ${lead?.parentName ?? ""} đã đổi lịch` +
    (toAt ? ` sang ${toAt}` : "") +
    ".";

  // dedupeKey kèm giờ mới (toAt) → reschedule thật tạo thông báo mới, retry thì không.
  const dedupeKey = `trial.schedule_changed:${trialId}:${str(event.payload.toAt)}`;
  await notifyStaff({
    userIds: [userId],
    dedupeKey,
    category: "LEAD",
    title: "Đổi lịch học thử",
    body,
    href: `/leads/${leadId}`,
    entityId: trialId,
  });
}

export function registerTrialScheduleNotifHandlers(): void {
  on("trial.schedule_changed", onTrialScheduleChanged);
}
