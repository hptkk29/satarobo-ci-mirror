import { db } from "@/lib/db";
import { sendEmail } from "./send";
import { renderTemplate } from "./render";

const PROGRESS_REPORT_TEMPLATE_CODE = "PROGRESS_REPORT_VI";

export type ProgressReportEmailParams = {
  studentId: string;
  parentEmail: string;
  parentName: string;
  studentName: string;
  className: string;
  attendanceRate: number;
  attendedSessions: number;
  totalSessions: number;
  coveredLessons: number;
  totalLessons: number;
  submittedAssignments: number;
  totalAssignments: number;
  averageScore: number | null;
  passedExams: number;
  examAttempts: number;
  actor: { userId: string | null; name: string };
};

/**
 * Gửi email báo cáo tiến độ cho phụ huynh. Tìm template theo CODE (trigger
 * MANUAL dùng chung). Trả về true nếu gửi thành công. Fire-and-forget — không throw.
 */
export async function sendProgressReportEmail(
  params: ProgressReportEmailParams,
): Promise<boolean> {
  try {
    if (!params.parentEmail?.trim()) return false;

    const template = await db.emailTemplate.findUnique({
      where: { code: PROGRESS_REPORT_TEMPLATE_CODE },
    });
    if (!template || !template.isActive) {
      console.warn("[progress-report] template missing or inactive — skipping");
      return false;
    }

    const vars: Record<string, string | number | Date> = {
      parent_name: params.parentName,
      student_name: params.studentName,
      class_name: params.className,
      attendance_rate: params.attendanceRate,
      attended_sessions: params.attendedSessions,
      total_sessions: params.totalSessions,
      covered_lessons: params.coveredLessons,
      total_lessons: params.totalLessons,
      submitted_assignments: params.submittedAssignments,
      total_assignments: params.totalAssignments,
      average_score:
        params.averageScore !== null ? `${params.averageScore}/10` : "Chưa có",
      passed_exams: params.passedExams,
      exam_attempts: params.examAttempts,
      report_date: new Date(),
    };

    const result = await sendEmail({
      to: params.parentEmail,
      toName: params.parentName,
      subject: renderTemplate(template.subject, vars),
      bodyText: renderTemplate(template.bodyText, vars),
      bodyHtml: renderTemplate(template.bodyHtml, vars),
      fromName: template.fromName ?? undefined,
      replyTo: template.replyTo ?? undefined,
      templateId: template.id,
      contextType: "Student",
      contextId: params.studentId,
      triggeredByUserId: params.actor.userId,
      triggeredByName: params.actor.name,
      triggerType: "USER_ACTION",
    });

    return result.ok;
  } catch (err) {
    console.error("[progress-report] error:", err);
    return false;
  }
}
