// prisma/seed-lms/classes.ts — Seed lớp + ghi danh + buổi học + điểm danh.
// SCOPED_MODELS (Class/Enrollment/ClassSession) → set centerId = class.centerId trên MỌI row.
// Enrollment: mỗi lớp 8-10 HV cùng cơ sở; HV lấy không lặp trong 1 lớp (tránh partial-unique).
// ClassSession: pastRatio buổi đã diễn ra (COMPLETED) → sinh Attendance; buổi sau SCHEDULED.
import type { PrismaClient } from "@prisma/client";
import type { SeedConfig } from "./_config";
import type { CourseContent } from "./content";
import type { StudentRec } from "./parents-students";
import type { TeacherPool } from "./staff";
import { CENTERS, batchCreate, pad, pick, rand } from "./_lib";

export type ClassRec = { id: string; courseId: string; centerId: string };
const NOW = new Date("2026-07-03T00:00:00Z");
const DAY = 86400_000;

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rand(0, i);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export async function seedClasses(
  db: PrismaClient,
  cfg: SeedConfig,
  studentRecs: StudentRec[],
  teacherPool: TeacherPool,
  content: Record<string, CourseContent>,
  courseIds: { laptrinhrobot: string; luyenthirobosim: string },
): Promise<ClassRec[]> {
  // Pool HV + GV theo cơ sở.
  const studentsByCenter: Record<string, StudentRec[]> = {};
  for (const c of CENTERS_OP) studentsByCenter[c] = [];
  for (const s of studentRecs) if (studentsByCenter[s.centerId]) studentsByCenter[s.centerId]!.push(s);
  for (const c of CENTERS_OP) shuffle(studentsByCenter[c]!);
  const stuCursor: Record<string, number> = { [CENTERS.CS1]: 0, [CENTERS.CS2]: 0 };

  const teachersByCenter: Record<string, string[]> = { [CENTERS.CS1]: [], [CENTERS.CS2]: [] };
  for (const t of teacherPool) if (teachersByCenter[t.centerId]) teachersByCenter[t.centerId]!.push(t.userId);
  // Fallback: nếu cơ sở nào thiếu GV, dùng chung toàn bộ pool.
  const allTeachers = teacherPool.map((t) => t.userId);

  const classes: unknown[] = [];
  const enrollments: unknown[] = [];
  const sessions: unknown[] = [];
  const attendances: unknown[] = [];
  const classRecs: ClassRec[] = [];

  const [minStu, maxStu] = cfg.studentsPerClass;
  const pastCount = Math.round(cfg.sessionsPerClass * cfg.pastSessionRatio);

  for (let ci = 1; ci <= cfg.classes; ci++) {
    const centerId = ci % 2 === 0 ? CENTERS.CS1 : CENTERS.CS2;
    // 80% Lập trình Robot (offline K-9), 20% Luyện thi RoboSim.
    const courseId = ci % 5 === 0 ? courseIds.luyenthirobosim : courseIds.laptrinhrobot;
    const cc = content[courseId];
    const classId = `slms-cls-${pad(ci, 5)}`;
    const centerCode = centerId === CENTERS.CS1 ? "CS1" : "CS2";
    const teachers = teachersByCenter[centerId]!.length > 0 ? teachersByCenter[centerId]! : allTeachers;
    const teacherId = teachers.length > 0 ? teachers[ci % teachers.length] : null;

    // Lịch: 2 buổi/tuần. startDate đặt sao cho pastCount buổi đã qua tính tới NOW.
    const startDate = new Date(NOW.getTime() - pastCount * 3.5 * DAY - rand(0, 14) * DAY);
    const scheduleDays = pick([[2, 4], [3, 6], [2, 5], [1, 4]] as number[][]);
    const startTime = pick(["17:30", "18:00", "08:00", "14:00", "15:30"]);

    classes.push({
      id: classId,
      classCode: `LOP-${centerCode}-${pad(ci, 4)}`,
      name: `Lớp ${centerCode}.${pad(ci, 4)}`,
      courseId,
      centerId,
      teacherId,
      curriculumId: cc?.curriculumId ?? null,
      curriculumVersion: cc ? 1 : null,
      maxStudents: 12,
      minStudents: 5,
      status: "ACTIVE",
      isActive: true,
      scheduleDays,
      startTime,
      endTime: startTime === "08:00" ? "09:30" : startTime === "14:00" ? "15:30" : "19:00",
      startDate,
    });
    classRecs.push({ id: classId, courseId, centerId });

    // Ghi danh HV cùng cơ sở, không lặp trong lớp.
    const pool = studentsByCenter[centerId]!;
    const size = Math.min(rand(minStu, maxStu), pool.length);
    const enrolledIds: string[] = [];
    for (let k = 0; k < size; k++) {
      const s = pool[(stuCursor[centerId]! + k) % pool.length]!;
      enrolledIds.push(s.id);
      enrollments.push({
        id: `slms-enr-${pad(ci, 5)}-${pad(k, 2)}`,
        studentId: s.id,
        classId,
        courseId,
        centerId,
        status: "STUDYING",
        enrolledAt: startDate,
        confirmedAt: startDate,
        startedAt: startDate,
        listPrice: 12000000,
        finalPrice: pick([9990000, 12000000, 15000000]),
        tuition: 12000000,
      });
    }
    stuCursor[centerId] = (stuCursor[centerId]! + size) % pool.length;

    // Buổi học + điểm danh.
    for (let si = 0; si < cfg.sessionsPerClass; si++) {
      const sessionId = `slms-ses-${pad(ci, 5)}-${pad(si, 2)}`;
      const date = new Date(startDate.getTime() + si * 3.5 * DAY);
      const isPast = si < pastCount;
      const lessonId = cc?.lessonIds[si % (cc?.lessonIds.length || 1)] ?? null;
      sessions.push({
        id: sessionId,
        classId,
        date,
        centerId,
        lessonId,
        topic: `Buổi ${si + 1}`,
        status: isPast ? "COMPLETED" : "SCHEDULED",
        completedAt: isPast ? date : null,
        actualTeacherId: isPast ? teacherId : null,
      });
      if (isPast) {
        for (const sid of enrolledIds) {
          const r = rand(1, 100);
          const status =
            r <= 82 ? "PRESENT" : r <= 88 ? "LATE" : r <= 95 ? "ABSENT_EXCUSED" : "ABSENT_UNEXCUSED";
          attendances.push({
            sessionId,
            studentId: sid,
            status,
            centerId,
            makeupStatus: status === "ABSENT_EXCUSED" || status === "ABSENT_UNEXCUSED" ? "NEEDS_MAKEUP" : "NONE",
          });
        }
      }
    }
  }

  await batchCreate("classes", classes, (b) => db.class.createMany({ data: b as never, skipDuplicates: true }), 500);
  await batchCreate("enrollments", enrollments, (b) => db.enrollment.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("sessions", sessions, (b) => db.classSession.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("attendances", attendances, (b) => db.attendance.createMany({ data: b as never, skipDuplicates: true }), 2000);

  console.log(
    `✅ Classes: ${classes.length} lớp · ${enrollments.length} ghi danh · ${sessions.length} buổi · ${attendances.length} điểm danh`,
  );
  return classRecs;
}

const CENTERS_OP = [CENTERS.CS1, CENTERS.CS2] as const;
