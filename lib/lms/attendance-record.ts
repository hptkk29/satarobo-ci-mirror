// lib/lms/attendance-record.ts — R3-04: điểm danh là source-of-truth.
// ABSENT → tạo MakeupNeed (C4.3) + đánh dấu makeupStatus; mọi thay đổi ghi AuditLog (C4.4).
import type { Attendance, AttendanceStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { needsMakeup } from "@/lib/lms/attendance-rate";
import { taoDongHocBu } from "@/lib/hoc-bu/dong-service";
import { makeupStatusSauKhiLuu } from "@/lib/hoc-bu/giu-da-bu";

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
  // MADE_UP do module học bù đặt — lưu điểm danh không được hạ nó (T02, HB-05/HB-40).
  const makeupStatus = makeupStatusSauKhiLuu({
    status: input.status,
    cu: existing?.makeupStatus,
    guiLen: willMakeup ? "NEEDS_MAKEUP" : "NONE",
  });

  const att = existing
    ? await db.attendance.update({
        where: { id: existing.id },
        data: { status: input.status, note: input.note ?? existing.note, makeupStatus },
      })
    : await db.attendance.create({
        data: {
          sessionId: input.sessionId,
          studentId: input.studentId,
          status: input.status,
          note: input.note ?? null,
          makeupStatus,
          // #04 prep: denormalize centerId (record mới không null → sẵn sàng flip SCOPED).
          centerId: input.centerId ?? null,
        },
      });

  // C4.3 — vắng không phép → cần học bù. Qua `taoDongHocBu` (T05): idempotent theo unique (HS, buổi lỡ) — một dòng cho mỗi buổi, mọi
  // trạng thái. ĐƯỜNG NÀY KHÔNG CÓ CALLER Ở PRODUCTION (chỉ test R3 dùng; điểm danh thật đi `teacher/lop` + `admin/attendance`) — gỡ ở T16.
  if (willMakeup) {
    await db.$transaction((tx) =>
      taoDongHocBu(tx, {
        studentId: input.studentId,
        missedSessionId: input.sessionId,
        nguon: "ABSENCE",
        originalAttendanceId: att.id,
        createdById: actor.id,
      }),
    );
  }

  // C4.4 — ghi audit (chỉ khi sửa, hoặc luôn để có vết).
  await writeAudit({
    actor, module: "attendance", entityType: "Attendance", entityId: att.id, action: existing ? "UPDATE" : "CREATE",
    oldValues: existing ? { status: existing.status } : undefined,
    newValues: { status: input.status }, reason: input.reason, orgUnitId: input.centerId,
  });

  return att;
}
