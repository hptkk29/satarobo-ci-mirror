import "server-only";
import { db } from "@/lib/db";
import { hasRole } from "@/lib/auth/permissions";

// LMS-17 — quyền chấm năng lực robot, DÙNG CHUNG cho UI gate (page) lẫn server action
// (trước đây UI chỉ mở cho SUPER_ADMIN/CENTER_MANAGER, chặn nhầm GV dù backend cho phép).
//   SUPER_ADMIN · CENTER_MANAGER cùng cơ sở · GV/trợ giảng dạy lớp HS đang học.
export async function canAssessStudent(
  user: { id: string; role?: string | null; roles?: string[] | null; centerId: string | null },
  studentId: string,
): Promise<boolean> {
  if (hasRole(user, "SUPER_ADMIN")) return true;
  const student = await db.student.findUnique({
    where: { id: studentId },
    select: { centerId: true },
  });
  if (!student) return false;
  if (hasRole(user, "CENTER_MANAGER")) {
    return !!student.centerId && student.centerId === user.centerId;
  }
  if (hasRole(user, "TEACHER")) {
    const teaches = await db.enrollment.findFirst({
      where: {
        studentId,
        class: { OR: [{ teacherId: user.id }, { assistantId: user.id }] },
      },
      select: { id: true },
    });
    return !!teaches;
  }
  return false;
}
