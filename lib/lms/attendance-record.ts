// lib/lms/attendance-record.ts — R3-04: điểm danh là source-of-truth.
// ABSENT → tạo MakeupNeed (C4.3) + đánh dấu makeupStatus; mọi thay đổi ghi AuditLog (C4.4).
import type { Attendance, AttendanceStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { needsMakeup } from "@/lib/lms/attendance-rate";

export async function recordAttendance(
  actor: AuditActor,
  input: {
    sessionId: string;
    studentId: string;
    classId: string;
    status: AttendanceStatus;
    centerId?: string | null;
    missedLessonId?: string | null;
    note?: string | null;
    reason?: string;
  },
): Promise<Attendance> {
  const existing = await db.attendance.findFirst({
    where: { sessionId: input.sessionId, studentId: input.studentId },
  });
  const willMakeup = needsMakeup(input.status);

  const att = existing
    ? await db.attendance.update({
        where: { id: existing.id },
        data: { status: input.status, note: input.note ?? existing.note, makeupStatus: willMakeup ? "NEEDS_MAKEUP" : "NONE" },
      })
    : await db.attendance.create({
        data: {
          sessionId: input.sessionId,
          studentId: input.studentId,
          status: input.status,
          note: input.note ?? null,
          makeupStatus: willMakeup ? "NEEDS_MAKEUP" : "NONE",
          // #04 prep: denormalize centerId (record mới không null → sẵn sàng flip SCOPED).
          centerId: input.centerId ?? null,
        },
      });

  // C4.3 — vắng không phép → cần học bù (idempotent: 1 MakeupNeed/buổi/HS đang mở).
  if (willMakeup) {
    const open = await db.makeupNeed.findFirst({
      where: { studentId: input.studentId, missedSessionId: input.sessionId, status: { in: ["PENDING", "SCHEDULED"] } },
    });
    if (!open) {
      await db.makeupNeed.create({
        data: {
          studentId: input.studentId,
          classId: input.classId,
          centerId: input.centerId ?? null,
          missedSessionId: input.sessionId,
          missedLessonId: input.missedLessonId ?? null,
          createdById: actor.id,
        },
      });
    }
  }

  // C4.4 — ghi audit (chỉ khi sửa, hoặc luôn để có vết).
  await writeAudit({
    actor, module: "attendance", entityType: "Attendance", entityId: att.id, action: existing ? "UPDATE" : "CREATE",
    oldValues: existing ? { status: existing.status } : undefined,
    newValues: { status: input.status }, reason: input.reason, orgUnitId: input.centerId,
  });

  return att;
}
