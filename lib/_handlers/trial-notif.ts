// lib/_handlers/trial-notif.ts — R7-17: consumer cho DomainEvent "trial.assigned"
// (R7-02). Khi con của lead được xếp lớp trải nghiệm → báo Sale phụ trách lead
// (StaffNotification inbox). LeadChild KHÔNG có user PH trực tiếp nên thông báo
// hướng tới nhân viên (assignedToId, fallback adminId). Idempotent qua dedupeKey.
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";
import { notifyStaff } from "@/lib/notifications/notify";

const str = (v: unknown): string => (v == null ? "" : String(v));

// ─── trial.assigned → Sale phụ trách lead (R7-02) ─────────────────────────────
export async function onTrialAssigned(event: DomainEventLite): Promise<void> {
  const trialEnrollmentId = str(event.payload.trialEnrollmentId);
  const leadChildId = str(event.payload.leadChildId);
  if (!trialEnrollmentId || !leadChildId) return;

  const child = await db.leadChild.findUnique({
    where: { id: leadChildId },
    select: {
      fullName: true,
      leadId: true,
      lead: { select: { assignedToId: true, adminId: true } },
    },
  });
  const userId = child?.lead?.assignedToId ?? child?.lead?.adminId;
  if (!userId) return;

  const childName = child?.fullName ?? "học viên";
  const dedupeKey = `trial.assigned:${trialEnrollmentId}`;
  await notifyStaff({
    userIds: [userId],
    dedupeKey,
    category: "LEAD",
    title: "Đã xếp lớp trải nghiệm",
    body: `Đã xếp lớp trải nghiệm cho ${childName}.`,
    href: child?.leadId ? `/leads/${child.leadId}` : null,
    entityId: trialEnrollmentId,
  });
}

export function registerTrialNotifHandlers(): void {
  on("trial.assigned", onTrialAssigned);
}
