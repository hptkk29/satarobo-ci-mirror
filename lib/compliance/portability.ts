import "server-only";
import { db } from "@/lib/db";
import { KHOAN_DA_DONG } from "@/lib/finance/debt";

// =============================================================================
// C6 / NĐ13 — Quyền MANG THEO dữ liệu (DSAR): xuất toàn bộ dữ liệu cá nhân của 1
// học viên thành JSON (hồ sơ + ghi danh + chuyên cần + điểm + thanh toán).
// Gate quyền ở action (SUPER_ADMIN, hoặc PH của chính HV).
// =============================================================================

export async function exportStudentData(studentId: string): Promise<Record<string, unknown> | null> {
  const student = await db.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      name: true,
      studentCode: true,
      dateOfBirth: true,
      gender: true,
      phone: true,
      email: true,
      parentName: true,
      parentPhone: true,
      parentEmail: true,
      // 25/09/2026 — 3 ô người lớn mới trên hồ sơ HV: là dữ liệu cá nhân ⇒ có trong bản xuất.
      parentGender: true,
      parentDob: true,
      parentFacebookUrl: true,
      address: true,
      status: true,
      createdAt: true,
    },
  });
  if (!student) return null;

  const [enrollments, attendance, examAttempts, submissions, payments, skills] = await Promise.all([
    db.enrollment.findMany({
      where: { studentId },
      select: { id: true, status: true, finalPrice: true, class: { select: { name: true } }, createdAt: true },
    }),
    db.attendance.findMany({
      where: { studentId },
      select: { status: true, note: true, session: { select: { date: true } } },
      take: 1000,
    }),
    db.examAttempt.findMany({
      where: { studentId },
      select: { totalScore: true, passed: true, status: true, exam: { select: { title: true } }, submittedAt: true },
    }),
    db.assignmentSubmission.findMany({
      where: { studentId },
      select: { score: true, status: true, assignment: { select: { title: true } } },
    }),
    db.payment.findMany({
      where: { enrollment: { studentId }, ...KHOAN_DA_DONG },
      select: { amount: true, method: true, paidDate: true },
    }),
    db.studentSkillAssessment.findMany({
      where: { studentId },
      select: { skill: true, level: true, assessedAt: true },
    }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    student,
    enrollments,
    attendance,
    examAttempts,
    assignmentSubmissions: submissions,
    payments,
    skillAssessments: skills,
  };
}
