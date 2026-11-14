import { db } from "@/lib/db";

export interface StudentProgress {
  studentId: string;
  classId: string;

  // Attendance — derived from past sessions (date <= now) + Attendance rows.
  // ClassSession has no "status" field; we treat any session whose date has
  // already passed as a held session for tracking purposes.
  totalSessions: number;
  attendedSessions: number;
  attendanceRate: number; // %

  // Lesson coverage from sessions in this class
  totalLessons: number;
  coveredLessons: number;
  lessonCoverageRate: number; // %

  // Assignments
  totalAssignments: number;
  submittedAssignments: number;
  gradedAssignments: number;
  averageScore: number | null; // scaled 0-10
  submissionRate: number; // %

  // Exams (E3)
  examAttempts: number;
  passedExams: number;
}

// Active enrollment statuses (D5 + legacy ACTIVE).
const ACTIVE_ENROLLMENT_STATUSES = ["CONFIRMED", "STUDYING", "ACTIVE"] as const;

// ── Dữ liệu tiến độ đã fetch cho 1 HV (dùng cho compute THUẦN) ────────────────
export interface StudentProgressInput {
  studentId: string;
  classId: string;
  /** Buổi đã diễn ra (date <= now) của lớp. Dùng chung cả lớp trong batch. */
  sessions: { id: string; lessonId: string | null }[];
  /** Bản ghi điểm danh CỦA HV này trong các buổi trên. */
  attendances: { status: string; makeupStatus: string | null }[];
  /** Tổng lesson của curriculum active — hằng số cấp lớp. */
  totalLessons: number;
  /** Bài tập đã nộp CỦA HV này trong lớp. */
  submissions: { status: string; score: number | null; totalPoints: number }[];
  /** Lượt thi (SUBMITTED/GRADED/REVIEWED) CỦA HV này trong lớp. */
  attempts: { passed: boolean | null }[];
}

/**
 * Tính StudentProgress THUẦN từ dữ liệu đã fetch (không chạm DB) — 1 nguồn công thức
 * dùng chung getStudentProgress (1 HV) và getClassProgress (batch cả lớp), tránh lệch
 * số liệu + diệt N+1. Công thức GIỮ NGUYÊN như bản cũ.
 */
export function computeStudentProgress(input: StudentProgressInput): StudentProgress {
  const totalSessions = input.sessions.length;

  // P1-1: có mặt = PRESENT/LATE HOẶC vắng đã học bù (makeupStatus MADE_UP).
  const attendedSessions = input.attendances.filter(
    (a) =>
      a.status === "PRESENT" || a.status === "LATE" || a.makeupStatus === "MADE_UP",
  ).length;
  const attendanceRate =
    totalSessions > 0 ? Math.round((attendedSessions / totalSessions) * 100) : 0;

  const coveredLessonIds = new Set(
    input.sessions.filter((s) => s.lessonId).map((s) => s.lessonId as string),
  );
  const coveredLessons = coveredLessonIds.size;
  const lessonCoverageRate =
    input.totalLessons > 0
      ? Math.round((coveredLessons / input.totalLessons) * 100)
      : 0;

  const totalAssignments = input.submissions.length;
  const submittedAssignments = input.submissions.filter(
    (s) => s.status === "SUBMITTED" || s.status === "LATE" || s.status === "GRADED",
  ).length;
  const gradedSubs = input.submissions.filter(
    (s) => s.status === "GRADED" && s.score !== null,
  );
  const gradedAssignments = gradedSubs.length;
  const averageScore =
    gradedAssignments > 0
      ? gradedSubs.reduce(
          (sum, s) => sum + ((s.score as number) / (s.totalPoints || 1)) * 10,
          0,
        ) / gradedAssignments
      : null;
  const submissionRate =
    totalAssignments > 0
      ? Math.round((submittedAssignments / totalAssignments) * 100)
      : 0;

  const examAttempts = input.attempts.length;
  const passedExams = input.attempts.filter((a) => a.passed === true).length;

  return {
    studentId: input.studentId,
    classId: input.classId,
    totalSessions,
    attendedSessions,
    attendanceRate,
    totalLessons: input.totalLessons,
    coveredLessons,
    lessonCoverageRate,
    totalAssignments,
    submittedAssignments,
    gradedAssignments,
    averageScore: averageScore !== null ? Math.round(averageScore * 10) / 10 : null,
    submissionRate,
    examAttempts,
    passedExams,
  };
}

export async function getStudentProgress(
  studentId: string,
  classId: string,
): Promise<StudentProgress> {
  const now = new Date();

  // QRY-01: 6 query tuần tự → 2 wave. Wave 1: các read độc lập.
  const [sessions, cls, submissions, attempts] = await Promise.all([
    db.classSession.findMany({
      // Buổi ĐÃ HUỶ không tính là buổi đã diễn ra (xem lib/labels.ts).
      where: { classId, date: { lte: now }, status: { not: "CANCELLED" } },
      select: { id: true, lessonId: true },
    }),
    db.class.findUnique({ where: { id: classId }, select: { courseId: true } }),
    db.assignmentSubmission.findMany({
      where: { studentId, assignment: { classId } },
      select: { status: true, score: true, assignment: { select: { totalPoints: true } } },
    }),
    db.examAttempt.findMany({
      where: { studentId, exam: { classId }, status: { in: ["SUBMITTED", "GRADED", "REVIEWED"] } },
      select: { passed: true },
    }),
  ]);

  // Wave 2: phụ thuộc wave 1 (attendance cần sessionIds; curriculum cần courseId).
  const [attendances, totalLessons] = await Promise.all([
    sessions.length > 0
      ? db.attendance.findMany({
          where: { sessionId: { in: sessions.map((s) => s.id) }, studentId },
          select: { status: true, makeupStatus: true },
        })
      : Promise.resolve([]),
    getTotalLessons(cls?.courseId ?? null),
  ]);

  return computeStudentProgress({
    studentId,
    classId,
    sessions,
    attendances,
    totalLessons,
    submissions: submissions.map((s) => ({
      status: s.status,
      score: s.score,
      totalPoints: s.assignment.totalPoints,
    })),
    attempts,
  });
}

/** Tổng lesson của curriculum active cho 1 course (null-safe). Dùng chung 1 HV + batch. */
async function getTotalLessons(courseId: string | null): Promise<number> {
  if (!courseId) return 0;
  const activeCurriculum = await db.curriculum.findFirst({
    where: { courseId, isActive: true },
    orderBy: { version: "desc" },
    select: { _count: { select: { lessons: true } } },
  });
  return activeCurriculum?._count.lessons ?? 0;
}

/** Tổng lesson theo NHIỀU course trong 1 query → Map<courseId, count>. Lấy curriculum
 * active version cao nhất mỗi course (khớp getTotalLessons orderBy version desc). */
async function getTotalLessonsForCourses(courseIds: string[]): Promise<Map<string, number>> {
  const byCourse = new Map<string, number>();
  if (courseIds.length === 0) return byCourse;
  const currs = await db.curriculum.findMany({
    where: { courseId: { in: courseIds }, isActive: true },
    orderBy: { version: "desc" },
    select: { courseId: true, _count: { select: { lessons: true } } },
  });
  for (const c of currs) {
    // orderBy version desc → bản đầu tiên gặp mỗi course = version cao nhất.
    if (!byCourse.has(c.courseId)) byCourse.set(c.courseId, c._count.lessons);
  }
  return byCourse;
}

/**
 * QRY-07/14/02 — Tiến độ của 1 HV trên NHIỀU lớp trong ~7 query (thay N×getStudentProgress).
 * Dùng cho transcript, students/edit, portal ket-qua (1 HV × nhiều enrollment).
 * Trả Map<classId, StudentProgress>. computeStudentProgress dùng chung → số liệu y hệt.
 */
export async function getStudentProgressForClasses(
  studentId: string,
  classIds: string[],
): Promise<Map<string, StudentProgress>> {
  const result = new Map<string, StudentProgress>();
  if (classIds.length === 0) return result;
  const now = new Date();

  const [sessions, classes, submissions, attempts] = await Promise.all([
    db.classSession.findMany({
      // Buổi ĐÃ HUỶ không tính là buổi đã diễn ra (xem lib/labels.ts).
      where: { classId: { in: classIds }, date: { lte: now }, status: { not: "CANCELLED" } },
      select: { id: true, classId: true, lessonId: true },
    }),
    db.class.findMany({
      where: { id: { in: classIds } },
      select: { id: true, courseId: true },
    }),
    db.assignmentSubmission.findMany({
      where: { studentId, assignment: { classId: { in: classIds } } },
      select: {
        status: true,
        score: true,
        assignment: { select: { classId: true, totalPoints: true } },
      },
    }),
    db.examAttempt.findMany({
      where: {
        studentId,
        exam: { classId: { in: classIds } },
        status: { in: ["SUBMITTED", "GRADED", "REVIEWED"] },
      },
      select: { passed: true, exam: { select: { classId: true } } },
    }),
  ]);

  const sessionIds = sessions.map((s) => s.id);
  const sessionClassById = new Map(sessions.map((s) => [s.id, s.classId]));
  const courseIds = [...new Set(classes.map((c) => c.courseId).filter(Boolean) as string[])];

  const [attendances, lessonsByCourse] = await Promise.all([
    sessionIds.length > 0
      ? db.attendance.findMany({
          where: { sessionId: { in: sessionIds }, studentId },
          select: { sessionId: true, status: true, makeupStatus: true },
        })
      : Promise.resolve([]),
    getTotalLessonsForCourses(courseIds),
  ]);

  // Gom theo classId.
  const sessionsByClass = new Map<string, { id: string; lessonId: string | null }[]>();
  for (const s of sessions) {
    const list = sessionsByClass.get(s.classId) ?? [];
    list.push({ id: s.id, lessonId: s.lessonId });
    sessionsByClass.set(s.classId, list);
  }
  const attByClass = new Map<string, { status: string; makeupStatus: string | null }[]>();
  for (const a of attendances) {
    const classId = sessionClassById.get(a.sessionId);
    if (!classId) continue;
    const list = attByClass.get(classId) ?? [];
    list.push({ status: a.status, makeupStatus: a.makeupStatus });
    attByClass.set(classId, list);
  }
  const subByClass = new Map<string, { status: string; score: number | null; totalPoints: number }[]>();
  for (const s of submissions) {
    const classId = s.assignment.classId;
    const list = subByClass.get(classId) ?? [];
    list.push({ status: s.status, score: s.score, totalPoints: s.assignment.totalPoints });
    subByClass.set(classId, list);
  }
  const attemptByClass = new Map<string, { passed: boolean | null }[]>();
  for (const a of attempts) {
    const classId = a.exam.classId;
    if (!classId) continue; // WHERE đã lọc classId ∈ classIds; guard cho TS narrow.
    const list = attemptByClass.get(classId) ?? [];
    list.push({ passed: a.passed });
    attemptByClass.set(classId, list);
  }
  const courseByClass = new Map(classes.map((c) => [c.id, c.courseId]));

  for (const classId of classIds) {
    const courseId = courseByClass.get(classId) ?? null;
    result.set(
      classId,
      computeStudentProgress({
        studentId,
        classId,
        sessions: sessionsByClass.get(classId) ?? [],
        attendances: attByClass.get(classId) ?? [],
        totalLessons: courseId ? (lessonsByCourse.get(courseId) ?? 0) : 0,
        submissions: subByClass.get(classId) ?? [],
        attempts: attemptByClass.get(classId) ?? [],
      }),
    );
  }
  return result;
}

export interface ClassStudentProgress {
  student: {
    id: string;
    name: string;
    avatarUrl: string | null;
    parentPhone: string | null;
    studentCode: string | null;
  };
  enrollmentId: string;
  progress: StudentProgress;
}

export async function getClassProgress(
  classId: string,
  // P0-3: chỉ KÈM SĐT phụ huynh khi caller có quyền xem PII (mặc định KHÔNG).
  // Caller PHẢI truyền canViewParentContact(session.user). Khi false, parentPhone
  // luôn null trong kết quả → KHÔNG gửi xuống client cho GV.
  includeParentContact = false,
): Promise<ClassStudentProgress[]> {
  const now = new Date();

  // QRY-08: trước đây gọi getStudentProgress() PER HV → N×6 query (lớp 20 HV = 120).
  // Nay fetch dữ liệu CẢ LỚP 1 lần rồi computeStudentProgress() thuần từng HV → ~7 query.
  const [enrollments, sessions, cls] = await Promise.all([
    db.enrollment.findMany({
      where: {
        classId,
        status: { in: [...ACTIVE_ENROLLMENT_STATUSES] },
        deletedAt: null, // FIX-C3
      },
      select: {
        id: true,
        student: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            parentPhone: true,
            studentCode: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.classSession.findMany({
      // Buổi ĐÃ HUỶ không tính là buổi đã diễn ra (xem lib/labels.ts).
      where: { classId, date: { lte: now }, status: { not: "CANCELLED" } },
      select: { id: true, lessonId: true },
    }),
    db.class.findUnique({ where: { id: classId }, select: { courseId: true } }),
  ]);

  if (enrollments.length === 0) return [];
  const studentIds = enrollments.map((e) => e.student.id);
  const sessionIds = sessions.map((s) => s.id);

  // Dữ liệu per-HV của TOÀN LỚP trong 1 query mỗi loại (studentId IN [...]).
  const [totalLessons, attendances, submissions, attempts] = await Promise.all([
    getTotalLessons(cls?.courseId ?? null),
    sessionIds.length > 0
      ? db.attendance.findMany({
          where: { sessionId: { in: sessionIds }, studentId: { in: studentIds } },
          select: { studentId: true, status: true, makeupStatus: true },
        })
      : Promise.resolve([]),
    db.assignmentSubmission.findMany({
      where: { studentId: { in: studentIds }, assignment: { classId } },
      select: {
        studentId: true,
        status: true,
        score: true,
        assignment: { select: { totalPoints: true } },
      },
    }),
    db.examAttempt.findMany({
      where: {
        studentId: { in: studentIds },
        exam: { classId },
        status: { in: ["SUBMITTED", "GRADED", "REVIEWED"] },
      },
      select: { studentId: true, passed: true },
    }),
  ]);

  // Gom theo studentId để compute per-HV không lặp query.
  const attBy = groupByStudent(attendances);
  const subBy = groupByStudent(submissions);
  const attemptBy = groupByStudent(attempts);

  return enrollments.map((e) => ({
    enrollmentId: e.id,
    student: {
      ...e.student,
      parentPhone: includeParentContact ? e.student.parentPhone : null,
    },
    progress: computeStudentProgress({
      studentId: e.student.id,
      classId,
      sessions,
      totalLessons,
      attendances: (attBy.get(e.student.id) ?? []).map((a) => ({
        status: a.status,
        makeupStatus: a.makeupStatus,
      })),
      submissions: (subBy.get(e.student.id) ?? []).map((s) => ({
        status: s.status,
        score: s.score,
        totalPoints: s.assignment.totalPoints,
      })),
      attempts: (attemptBy.get(e.student.id) ?? []).map((a) => ({ passed: a.passed })),
    }),
  }));
}

/** Gom mảng row có studentId thành Map<studentId, row[]>. */
function groupByStudent<T extends { studentId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const list = map.get(r.studentId);
    if (list) list.push(r);
    else map.set(r.studentId, [r]);
  }
  return map;
}

// =============================================================================
// Phase T2.1 — Gradebook (ma trận điểm) + Lộ trình giáo trình
// =============================================================================

export interface GradebookLesson {
  id: string;
  order: number;
  title: string;
  taught: boolean;
  sessionDate: string | null;
}

export interface GradebookColumn {
  id: string;
  kind: "exam" | "assignment";
  title: string;
  totalPoints: number;
}

export interface GradebookCell {
  score: number | null; // điểm thô (theo thang totalPoints của cột)
  status: string; // exam: AttemptStatus | "—" · assignment: SubmissionStatus
  passed: boolean | null;
}

export interface GradebookRow {
  studentId: string;
  name: string;
  studentCode: string | null;
  cells: Record<string, GradebookCell>; // key = column.id
}

export interface ClassGradebook {
  lessons: GradebookLesson[];
  totalLessons: number;
  coveredLessons: number;
  lessonCoverageRate: number;
  columns: GradebookColumn[];
  rows: GradebookRow[];
}

// Exam/Assignment đã giao = đang mở hoặc đã đóng (không tính DRAFT/ARCHIVED).
const GIVEN_EXAM_STATUSES = ["PUBLISHED", "CLOSED"] as const;
const GIVEN_ASSIGNMENT_STATUSES = ["PUBLISHED", "CLOSED"] as const;

export async function getClassGradebook(
  classId: string,
): Promise<ClassGradebook> {
  const now = new Date();

  const cls = await db.class.findUnique({
    where: { id: classId },
    select: { courseId: true },
  });

  // 1) Lộ trình giáo trình: lesson của curriculum active + buổi đã dạy.
  let lessonsRaw: { id: string; order: number; title: string }[] = [];
  if (cls?.courseId) {
    const curriculum = await db.curriculum.findFirst({
      where: { courseId: cls.courseId, isActive: true },
      orderBy: { version: "desc" },
      select: {
        lessons: {
          select: { id: true, order: true, title: true },
          orderBy: { order: "asc" },
        },
      },
    });
    lessonsRaw = curriculum?.lessons ?? [];
  }

  const sessions = await db.classSession.findMany({
    // Buổi ĐÃ HUỶ không tính là buổi đã diễn ra (xem lib/labels.ts).
    where: { classId, lessonId: { not: null }, date: { lte: now }, status: { not: "CANCELLED" } },
    select: { lessonId: true, date: true },
    orderBy: { date: "desc" },
  });
  const taughtDate = new Map<string, Date>();
  for (const s of sessions) {
    if (s.lessonId && !taughtDate.has(s.lessonId)) taughtDate.set(s.lessonId, s.date);
  }

  const lessons: GradebookLesson[] = lessonsRaw.map((l) => ({
    id: l.id,
    order: l.order,
    title: l.title,
    taught: taughtDate.has(l.id),
    sessionDate: taughtDate.get(l.id)?.toISOString() ?? null,
  }));
  const coveredLessons = lessons.filter((l) => l.taught).length;
  const totalLessons = lessons.length;
  const lessonCoverageRate =
    totalLessons > 0 ? Math.round((coveredLessons / totalLessons) * 100) : 0;

  // 2) Cột: exam + assignment đã giao cho lớp.
  const [exams, assignments, enrollments] = await Promise.all([
    db.exam.findMany({
      where: { classId, status: { in: [...GIVEN_EXAM_STATUSES] } },
      select: { id: true, title: true, totalPoints: true },
      orderBy: { createdAt: "asc" },
    }),
    db.assignment.findMany({
      where: { classId, status: { in: [...GIVEN_ASSIGNMENT_STATUSES] } },
      select: { id: true, title: true, totalPoints: true },
      orderBy: { assignedAt: "asc" },
    }),
    db.enrollment.findMany({
      where: { classId, status: { in: [...ACTIVE_ENROLLMENT_STATUSES] }, deletedAt: null }, // FIX-C3
      select: {
        student: { select: { id: true, name: true, studentCode: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const columns: GradebookColumn[] = [
    ...exams.map((e) => ({
      id: `exam:${e.id}`,
      kind: "exam" as const,
      title: e.title,
      totalPoints: e.totalPoints,
    })),
    ...assignments.map((a) => ({
      id: `assignment:${a.id}`,
      kind: "assignment" as const,
      title: a.title,
      totalPoints: a.totalPoints,
    })),
  ];

  const studentIds = enrollments.map((e) => e.student.id);
  const examIds = exams.map((e) => e.id);
  const assignmentIds = assignments.map((a) => a.id);

  const [attempts, submissions] = await Promise.all([
    examIds.length && studentIds.length
      ? db.examAttempt.findMany({
          where: { examId: { in: examIds }, studentId: { in: studentIds } },
          select: {
            examId: true,
            studentId: true,
            totalScore: true,
            status: true,
            passed: true,
          },
        })
      : Promise.resolve([]),
    assignmentIds.length && studentIds.length
      ? db.assignmentSubmission.findMany({
          where: {
            assignmentId: { in: assignmentIds },
            studentId: { in: studentIds },
          },
          select: {
            assignmentId: true,
            studentId: true,
            score: true,
            status: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const attemptKey = (s: string, e: string) => `${s}|${e}`;
  const attemptMap = new Map(
    attempts.map((a) => [attemptKey(a.studentId, a.examId), a]),
  );
  const subMap = new Map(
    submissions.map((s) => [attemptKey(s.studentId, s.assignmentId), s]),
  );

  const rows: GradebookRow[] = enrollments.map((e) => {
    const st = e.student;
    const cells: Record<string, GradebookCell> = {};
    for (const exam of exams) {
      const a = attemptMap.get(attemptKey(st.id, exam.id));
      cells[`exam:${exam.id}`] = {
        score: a?.totalScore ?? null,
        status: a?.status ?? "—",
        passed: a?.passed ?? null,
      };
    }
    for (const asg of assignments) {
      const s = subMap.get(attemptKey(st.id, asg.id));
      cells[`assignment:${asg.id}`] = {
        score: s?.score ?? null,
        status: s?.status ?? "NOT_SUBMITTED",
        passed: null,
      };
    }
    return { studentId: st.id, name: st.name, studentCode: st.studentCode, cells };
  });

  return {
    lessons,
    totalLessons,
    coveredLessons,
    lessonCoverageRate,
    columns,
    rows,
  };
}
