import "server-only";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";

// =============================================================================
// R7-05 C10 — Sửa mã học viên. CHỈ SUPER_ADMIN; reason BẮT BUỘC; audit lại
// (giữ vết oldCode→newCode). Mã HV là định danh đối ngoại (biên lai/học bạ) nên
// đổi mã là thao tác nhạy cảm — KHÔNG để CENTER_MANAGER/SALES tự sửa qua form thường.
// =============================================================================

/** Actor tối thiểu cho thao tác đổi mã (id+name để audit, cờ quyền SUPER_ADMIN). */
export type ChangeStudentCodeActor = {
  id: string;
  name: string;
  isSuperAdmin: boolean;
};

export async function changeStudentCode(params: {
  actor: ChangeStudentCodeActor;
  studentId: string;
  newCode: string;
  reason: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!params.actor.isSuperAdmin) {
    return { ok: false, error: "Chỉ SUPER_ADMIN được sửa mã học viên" };
  }
  const reason = params.reason?.trim();
  if (!reason) return { ok: false, error: "Lý do sửa mã là bắt buộc" };
  const newCode = params.newCode?.trim();
  if (!newCode) return { ok: false, error: "Mã mới không hợp lệ" };

  const student = await db.student.findUnique({
    where: { id: params.studentId },
    select: { id: true, studentCode: true, centerId: true },
  });
  if (!student) return { ok: false, error: "Không tìm thấy học viên" };
  if (student.studentCode === newCode) return { ok: true }; // no-op idempotent

  const clash = await db.student.findUnique({
    where: { studentCode: newCode },
    select: { id: true },
  });
  if (clash) return { ok: false, error: "Mã đã tồn tại cho học viên khác" };

  try {
    await db.$transaction(async (tx) => {
      await tx.student.update({
        where: { id: student.id },
        data: { studentCode: newCode },
      });
      await writeAudit({
        actor: { id: params.actor.id, name: params.actor.name },
        module: "students",
        entityType: "Student",
        entityId: student.id,
        action: "CHANGE_CODE",
        oldValues: { studentCode: student.studentCode },
        newValues: { studentCode: newCode },
        reason,
        orgUnitId: student.centerId,
        tx,
      });
    });
  } catch {
    // Đụng unique race (P2002) khi 2 request cùng đổi về 1 mã → báo lịch sự.
    return { ok: false, error: "Mã đã tồn tại cho học viên khác" };
  }

  return { ok: true };
}
