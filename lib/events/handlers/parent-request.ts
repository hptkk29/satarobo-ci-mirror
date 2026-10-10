// lib/events/handlers/parent-request.ts — #08 (L8.2): consumer cho DomainEvent
// "parent_request.created". PH tạo yêu cầu → báo MỌI Sale + Quản lý cơ sở tại cơ sở
// của HV (câu 40). Idempotent qua dedupeKey theo requestId (replay không nhân đôi).
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";
import { notifyParentRequestCreated } from "@/lib/portal/parent-request-notify";

const str = (v: unknown): string => (v == null ? "" : String(v));

export async function onParentRequestCreated(event: DomainEventLite): Promise<void> {
  const requestId = str(event.payload.requestId);
  if (!requestId) return;

  const centerId = str(event.payload.centerId) || null;
  const type = str(event.payload.type);
  const studentId = str(event.payload.studentId);

  const student = studentId
    ? await db.student.findUnique({ where: { id: studentId }, select: { name: true } })
    : null;

  await notifyParentRequestCreated({
    requestId,
    centerId,
    type,
    studentName: student?.name ?? null,
  });
}

export function registerParentRequestHandlers(): void {
  on("parent_request.created", onParentRequestCreated);
}
