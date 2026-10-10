import { db } from "@/lib/db";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { getSessionBirthdays } from "@/lib/students/birthday";

// LMS-4 — gom thông tin GV cần TRƯỚC buổi học.

export type PreSessionInfo = {
  expectedLesson: { order: number; title: string; materials: string[] } | null;
  expectedIsSuggested: boolean; // true = gợi ý bài tiếp theo (chưa gắn cứng)
  students: { id: string; name: string }[];
  studentsToNote: { id: string; name: string; reasons: string[] }[];
  ungraded: { studentName: string; assignmentTitle: string }[];
};

export async function getPreSessionInfo(sessionId: string): Promise<PreSessionInfo | null> {
  const sess = await db.classSession.findUnique({
    where: { id: sessionId },
    select: {
      date: true,
      lessonId: true,
      class: { select: { id: true, courseId: true } },
    },
  });
  if (!sess) return null;
  const classId = sess.class.id;

  // Giáo trình đang dùng của khoá → danh sách bài.
  const curriculum = await db.curriculum.findFirst({
    where: { courseId: sess.class.courseId, isActive: true },
    orderBy: { version: "desc" },
    select: {
      lessons: {
        orderBy: { order: "asc" },
        select: { id: true, order: true, title: true, materials: true },
      },
    },
  });
  const lessons = curriculum?.lessons ?? [];

  let expectedLesson: PreSessionInfo["expectedLesson"] = null;
  let expectedIsSuggested = false;
  if (sess.lessonId) {
    const l = lessons.find((x) => x.id === sess.lessonId);
    if (l) expectedLesson = { order: l.order, title: l.title, materials: l.materials };
  }
  if (!expectedLesson && lessons.length > 0) {
    // Gợi ý bài tiếp theo dựa trên bài đã dạy gần nhất (session có lessonId, trước buổi này).
    const past = await db.classSession.findMany({
      where: { classId, lessonId: { not: null }, date: { lt: sess.date } },
      select: { lesson: { select: { order: true } } },
    });
    const maxOrder = past.reduce((m, p) => Math.max(m, p.lesson?.order ?? 0), 0);
    const next = lessons.find((l) => l.order > maxOrder) ?? lessons[0];
    expectedLesson = { order: next.order, title: next.title, materials: next.materials };
    expectedIsSuggested = true;
  }

  const [enrollments, absenceGroups, lowFeedback, ungradedRows, birthdays] = await Promise.all([
    db.enrollment.findMany({
      where: { classId, status: { in: ENROLLMENT_ACTIVE_STATUS_LIST }, deletedAt: null }, // FIX-C3
      select: { student: { select: { id: true, name: true } } },
      orderBy: { student: { name: "asc" } },
    }),
    db.attendance.groupBy({
      by: ["studentId"],
      where: { session: { classId }, status: "ABSENT" },
      _count: { _all: true },
    }),
    db.studentSessionFeedback.findMany({
      where: { classSession: { classId }, rating: { lte: 2 } },
      select: { studentId: true },
      distinct: ["studentId"],
    }),
    db.assignmentSubmission.findMany({
      where: {
        assignment: { classId },
        score: null,
        status: { in: ["SUBMITTED", "LATE"] },
      },
      take: 50,
      select: {
        student: { select: { name: true } },
        assignment: { select: { title: true } },
      },
    }),
    // Sinh nhật được TỔ CHỨC tại buổi này (06/08/2026). Đọc theo buổi đã được cron
    // chốt, không tự dò lại ngày sinh — hai chỗ tính độc lập là hai chỗ lệch nhau.
    getSessionBirthdays(sessionId),
  ]);

  const students = enrollments.map((e) => e.student);
  const absentMap = new Map(
    absenceGroups.filter((g) => g._count._all >= 2).map((g) => [g.studentId, g._count._all]),
  );
  const lowSet = new Set(lowFeedback.map((f) => f.studentId));
  const birthdayMap = new Map(birthdays.map((b) => [b.studentId, b]));

  const studentsToNote = students
    .map((s) => {
      const reasons: string[] = [];
      // Sinh nhật lên ĐẦU: đây là việc phải làm TRONG buổi, khác hai lý do dưới
      // (bối cảnh để lưu ý). Buổi tổ chức có thể sớm hơn ngày sinh nhật nên phải
      // ghi rõ ngày, giáo viên không suy ra được từ hồ sơ.
      const bd = birthdayMap.get(s.id);
      if (bd) {
        reasons.push(
          bd.onBirthday
            ? `🎂 Sinh nhật hôm nay (${bd.birthdayText}) — chúc mừng trong buổi`
            : `🎂 Tổ chức sinh nhật (sinh nhật ${bd.birthdayText}, hôm đó lớp không học)`,
        );
      }
      const absent = absentMap.get(s.id);
      if (absent) reasons.push(`Vắng ${absent} buổi`);
      if (lowSet.has(s.id)) reasons.push("Nhận xét gần đây thấp (≤2★)");
      return { id: s.id, name: s.name, reasons };
    })
    .filter((s) => s.reasons.length > 0);

  return {
    expectedLesson,
    expectedIsSuggested,
    students,
    studentsToNote,
    ungraded: ungradedRows.map((r) => ({
      studentName: r.student.name,
      assignmentTitle: r.assignment.title,
    })),
  };
}
