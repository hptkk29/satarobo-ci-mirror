"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { getStudentProgress } from "@/lib/progress";
import { mapWithConcurrency } from "@/lib/util/concurrency";
import { sendProgressReportEmail } from "@/lib/email/progress-report";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { hasRole } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";

// =============================================================================
// CLASS LMS ACTIONS — Phase T2.1
// Tạo báo cáo tiến độ hàng loạt cho cả lớp + gửi email phụ huynh.
// =============================================================================

export async function generateClassProgressReports(
  classId: string,
): Promise<{ ok: boolean; created?: number; emailed?: number; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("completions:manage"))) {
    return { ok: false, error: "Không có quyền tạo báo cáo" };
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const cls = await sdb.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: { id: true, name: true, teacherId: true },
  });
  if (!cls) return { ok: false, error: "Không tìm thấy lớp" };

  // TEACHER chỉ tạo báo cáo cho lớp mình phụ trách.
  if (hasRole(session.user, "TEACHER") && cls.teacherId !== session.user.id) {
    return { ok: false, error: "Chỉ giáo viên phụ trách lớp mới tạo được báo cáo" };
  }

  const enrollments = await sdb.enrollment.findMany({
    where: { classId, status: { in: ENROLLMENT_ACTIVE_STATUS_LIST } },
    select: {
      student: {
        select: {
          id: true,
          name: true,
          parentName: true,
          parentEmail: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  if (enrollments.length === 0) {
    return { ok: false, error: "Lớp chưa có học viên đang học" };
  }

  const actorName = session.user.name ?? session.user.email ?? "Hệ thống";
  const actorId = session.user.id ?? null;
  let created = 0;
  let emailed = 0;

  // Song song CÓ TRẦN (3): mỗi học viên tốn ~6 truy vấn + 1 email + 1 insert. Nối đuôi thì
  // lớp 20 em chạy ~160 lượt tuần tự trong MỘT Server Action — dễ chạm trần thời gian và
  // người bấm không biết nó còn chạy hay đã chết. Trần thấp vì có gửi email ở giữa.
  await mapWithConcurrency(enrollments, 3, async (e) => {
    const st = e.student;
    const p = await getStudentProgress(st.id, classId);

    let sent = false;
    if (st.parentEmail) {
      sent = await sendProgressReportEmail({
        studentId: st.id,
        parentEmail: st.parentEmail,
        parentName: st.parentName ?? "Quý phụ huynh",
        studentName: st.name,
        className: cls.name,
        attendanceRate: p.attendanceRate,
        attendedSessions: p.attendedSessions,
        totalSessions: p.totalSessions,
        coveredLessons: p.coveredLessons,
        totalLessons: p.totalLessons,
        submittedAssignments: p.submittedAssignments,
        totalAssignments: p.totalAssignments,
        averageScore: p.averageScore,
        passedExams: p.passedExams,
        examAttempts: p.examAttempts,
        actor: { userId: actorId, name: actorName },
      });
      if (sent) emailed++;
    }

    await sdb.progressReportLog.create({
      data: {
        studentId: st.id,
        classId,
        reportTitle: `Báo cáo tiến độ — ${cls.name}`,
        sentToEmail: sent ? st.parentEmail : null,
        sentAt: sent ? new Date() : null,
        metadata: {
          generatedByName: actorName,
          attendanceRate: p.attendanceRate,
          attendedSessions: p.attendedSessions,
          totalSessions: p.totalSessions,
          coveredLessons: p.coveredLessons,
          totalLessons: p.totalLessons,
          submittedAssignments: p.submittedAssignments,
          totalAssignments: p.totalAssignments,
          gradedAssignments: p.gradedAssignments,
          averageScore: p.averageScore,
          passedExams: p.passedExams,
          examAttempts: p.examAttempts,
        },
      },
    });
    created++;
  });

  revalidatePath(`/classes/${classId}/progress`);
  return { ok: true, created, emailed };
}
