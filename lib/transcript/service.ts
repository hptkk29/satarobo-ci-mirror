import { db } from "@/lib/db";
import { getStudentProgressForClasses } from "@/lib/progress";

// =============================================================================
// Cụm B5 — Học bạ (StudentTranscript). KHÔNG tạo bảng mới: tổng hợp từ dữ liệu
// đã có (Enrollment + progress per-class + completions + kỹ năng + feedback).
// =============================================================================

export interface TranscriptClassRow {
  classId: string;
  className: string;
  classCode: string | null;
  courseName: string;
  centerName: string | null;
  teacherName: string | null;
  status: string;
  enrolledAt: Date | null;
  totalSessions: number;
  attendedSessions: number;
  attendanceRate: number;
  averageScore: number | null;
  passedExams: number;
  examAttempts: number;
}

export interface TranscriptCompletion {
  courseName: string;
  completedAt: Date;
  finalGrade: string | null;
  certificateCode: string;
}

export interface TranscriptSkill {
  skill: string;
  level: string;
  assessedAt: Date;
}

export interface StudentTranscript {
  student: {
    id: string;
    name: string;
    studentCode: string | null;
    currentGrade: number | null;
    school: string | null;
  };
  classes: TranscriptClassRow[];
  completions: TranscriptCompletion[];
  skills: TranscriptSkill[];
  feedbackCount: number;
  summary: {
    totalClasses: number;
    completedCourses: number;
    overallAttendanceRate: number;
    overallAverageScore: number | null;
  };
}

/**
 * Tổng hợp học bạ cho 1 học viên. Caller PHẢI tự kiểm quyền (portal owns-student
 * hoặc admin role+center scope) TRƯỚC khi gọi — service không lộ data con khác.
 */
export async function getStudentTranscript(studentId: string): Promise<StudentTranscript | null> {
  const student = await db.student.findFirst({
    where: { id: studentId, deletedAt: null },
    select: { id: true, name: true, studentCode: true, currentGrade: true, school: true },
  });
  if (!student) return null;

  const [enrollments, completions, skills, feedbackCount] = await Promise.all([
    db.enrollment.findMany({
      where: { studentId, deletedAt: null }, // FIX-C3
      orderBy: { enrolledAt: "desc" },
      select: {
        classId: true,
        status: true,
        enrolledAt: true,
        class: {
          select: {
            name: true,
            classCode: true,
            course: { select: { name: true } },
            center: { select: { name: true } },
            teacher: { select: { name: true } },
          },
        },
      },
    }),
    db.courseCompletion.findMany({
      where: { studentId },
      orderBy: { completedAt: "desc" },
      select: {
        completedAt: true,
        finalGrade: true,
        certificateCode: true,
        course: { select: { name: true } },
      },
    }),
    db.studentSkillAssessment.findMany({
      where: { studentId },
      orderBy: { assessedAt: "desc" },
      take: 30,
      select: { skill: true, level: true, assessedAt: true },
    }),
    db.studentSessionFeedback.count({ where: { studentId } }),
  ]);

  // QRY-14: tiến độ mọi lớp của HV trong 1 lượt batch (thay N×getStudentProgress).
  const progressByClass = await getStudentProgressForClasses(
    studentId,
    enrollments.map((e) => e.classId),
  );
  const classes: TranscriptClassRow[] = enrollments.map((e) => {
    const p = progressByClass.get(e.classId)!; // luôn có: đã truyền mọi classId vào batch.
    return {
      classId: e.classId,
      className: e.class.name,
      classCode: e.class.classCode,
      courseName: e.class.course.name,
      centerName: e.class.center?.name ?? null,
      teacherName: e.class.teacher?.name ?? null,
      status: e.status,
      enrolledAt: e.enrolledAt,
      totalSessions: p.totalSessions,
      attendedSessions: p.attendedSessions,
      attendanceRate: p.attendanceRate,
      averageScore: p.averageScore,
      passedExams: p.passedExams,
      examAttempts: p.examAttempts,
    };
  });

  // Tổng hợp toàn cục.
  const totalSessions = classes.reduce((s, c) => s + c.totalSessions, 0);
  const attendedSessions = classes.reduce((s, c) => s + c.attendedSessions, 0);
  const scored = classes.filter((c) => c.averageScore != null);
  const overallAverageScore =
    scored.length > 0 ? Math.round((scored.reduce((s, c) => s + (c.averageScore ?? 0), 0) / scored.length) * 10) / 10 : null;

  return {
    student,
    classes,
    completions: completions.map((c) => ({
      courseName: c.course.name,
      completedAt: c.completedAt,
      finalGrade: c.finalGrade,
      certificateCode: c.certificateCode,
    })),
    skills: skills.map((s) => ({ skill: String(s.skill), level: String(s.level), assessedAt: s.assessedAt })),
    feedbackCount,
    summary: {
      totalClasses: classes.length,
      completedCourses: completions.length,
      overallAttendanceRate: totalSessions > 0 ? Math.round((attendedSessions / totalSessions) * 100) : 0,
      overallAverageScore,
    },
  };
}
