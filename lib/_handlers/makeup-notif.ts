// lib/_handlers/makeup-notif.ts — R7-17: consumer cho DomainEvent học bù
// (makeup.requested, makeup.confirmed). Tạo Notification cho HV/PH (portal feed)
// idempotent theo dedupeKey = "<type>:<makeupNeedId>". Handler không throw lan —
// outbox sẽ retry; resolve centerId qua quan hệ Student.
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";

const str = (v: unknown): string => (v == null ? "" : String(v));

/** Lấy centerId của HV để gắn scope cho thông báo (không bắt buộc). */
async function studentCenterId(studentId: string): Promise<string | null> {
  if (!studentId) return null;
  const s = await db.student.findUnique({
    where: { id: studentId },
    select: { centerId: true },
  });
  return s?.centerId ?? null;
}

// ─── makeup.requested → HV/PH thấy nhu cầu bù đã ghi nhận ──────────────────────
export async function onMakeupRequested(event: DomainEventLite): Promise<void> {
  const makeupNeedId = str(event.payload.makeupNeedId);
  const studentId = str(event.payload.studentId);
  if (!makeupNeedId || !studentId) return;

  const centerId =
    str(event.payload.centerId) || (await studentCenterId(studentId)) || null;
  const dedupeKey = `makeup.requested:${makeupNeedId}`;
  const body =
    "Yêu cầu học bù của bạn đã được ghi nhận. Trung tâm sẽ sắp xếp buổi bù phù hợp.";

  await db.notification.upsert({
    where: { dedupeKey },
    create: {
      title: "Yêu cầu học bù đã được ghi nhận",
      body,
      audience: "STUDENT",
      studentId,
      centerId,
      createdByName: "Hệ thống",
      dedupeKey,
    },
    update: { body },
  });
}

// ─── makeup.confirmed → HV/PH thấy lịch bù đã xác nhận ─────────────────────────
export async function onMakeupConfirmed(event: DomainEventLite): Promise<void> {
  const makeupNeedId = str(event.payload.makeupNeedId);
  const studentId = str(event.payload.studentId);
  if (!makeupNeedId || !studentId) return;

  const centerId = await studentCenterId(studentId);
  const dedupeKey = `makeup.confirmed:${makeupNeedId}`;
  const body =
    "Lịch học bù của bạn đã được xác nhận. Vui lòng kiểm tra chi tiết buổi bù trong cổng học viên.";

  await db.notification.upsert({
    where: { dedupeKey },
    create: {
      title: "Lịch học bù đã được xác nhận",
      body,
      audience: "STUDENT",
      studentId,
      centerId,
      createdByName: "Hệ thống",
      dedupeKey,
    },
    update: { body },
  });
}

export function registerMakeupNotifHandlers(): void {
  on("makeup.requested", onMakeupRequested);
  on("makeup.confirmed", onMakeupConfirmed);
}
