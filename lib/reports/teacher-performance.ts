// lib/reports/teacher-performance.ts — LMS-16: Báo cáo HIỆU SUẤT GIÁO VIÊN — hàm THUẦN.
//
// Nhận MẢNG record PHẲNG (đã query + gắn teacherId sẵn ở Server Component) → trả
// object số liệu. KHÔNG gọi DB ở đây → Vitest test không cần Postgres. Mirror style
// lib/reports/lead.ts + lib/reports/dao-tao.ts.
//
// Mỗi GV:
//  1. Số buổi đã dạy — ClassSession status COMPLETED (effective teacher =
//     actualTeacherId ?? class.teacherId; page gắn sẵn vào field teacherId).
//  2. Tỷ lệ điểm danh trung bình các lớp phụ trách — present(+made-up)/buổi tính.
//  3. Số học viên — distinct studentId trong các enrollment đang hoạt động của GV.
//  4. Điểm học bạ trung bình (nếu có) — trung bình level ReportCardScore (thang 1..4).
import type {
  AttendanceStatusValue,
  MakeupStatusValue,
  SessionStatusValue,
} from "@/lib/labels";

export type EnrollmentStatusValue =
  | "ACTIVE"
  | "CANCELLED"
  | "PENDING"
  | "CONFIRMED"
  | "STUDYING"
  | "PAUSED"
  | "COMPLETED"
  | "WITHDREW"
  | "TRANSFERRED";

// ── Input records (phẳng, đã gắn teacherId ở page) ───────────────────────────
/** GV cần đưa vào báo cáo (có lớp phụ trách). */
export interface TeacherInfo {
  id: string;
  name: string | null;
}

/** Buổi học (đã gắn GV phụ trách thực tế). */
export interface TeacherSessionRecord {
  teacherId: string;
  status: SessionStatusValue;
}

/** Điểm danh 1 buổi của lớp GV phụ trách. */
export interface TeacherAttendanceRecord {
  teacherId: string;
  status: AttendanceStatusValue;
  makeupStatus: MakeupStatusValue | null;
  sessionStatus: SessionStatusValue | null;
}

/** Ghi danh thuộc lớp GV phụ trách. */
export interface TeacherEnrollmentRecord {
  teacherId: string;
  studentId: string;
  status: EnrollmentStatusValue;
}

/** Một điểm tiêu chí học bạ (thang 1..4) thuộc lớp GV phụ trách. */
export interface TeacherScoreRecord {
  teacherId: string;
  level: number;
}

export interface TeacherPerformanceInput {
  teachers: TeacherInfo[];
  sessions: TeacherSessionRecord[];
  attendances: TeacherAttendanceRecord[];
  enrollments: TeacherEnrollmentRecord[];
  scores: TeacherScoreRecord[];
}

// ── Output ───────────────────────────────────────────────────────────────────
export interface TeacherPerformanceRow {
  teacherId: string;
  teacherName: string;
  /** Buổi đã dạy (status COMPLETED). */
  sessionsTaught: number;
  /** Buổi điểm danh được tính (không gồm buổi hủy). */
  attendanceCounted: number;
  attendanceAttended: number;
  /** % chuyên cần trung bình lớp phụ trách (0–100, 1 chữ số). counted=0 → 0. */
  attendanceRate: number;
  /** Số học viên (distinct) đang hoạt động trong lớp phụ trách. */
  studentCount: number;
  /** Điểm học bạ trung bình (thang 1..4, 1 chữ số) — null nếu chưa có điểm. */
  avgReportScore: number | null;
}

export interface TeacherPerformanceReport {
  totalTeachers: number;
  rows: TeacherPerformanceRow[];
}

const PRESENT_SET = new Set<AttendanceStatusValue>(["PRESENT", "LATE"]);
const ABSENT_SET = new Set<AttendanceStatusValue>([
  "ABSENT",
  "EXCUSED",
  "ABSENT_EXCUSED",
  "ABSENT_UNEXCUSED",
]);

/** Enrollment được coi là HỌC VIÊN ĐANG HỌC (tính vào số HV). */
export const ACTIVE_ENROLLMENT_STATUSES = new Set<EnrollmentStatusValue>([
  "ACTIVE",
  "CONFIRMED",
  "STUDYING",
  "PAUSED",
]);

const UNNAMED_LABEL = "(Chưa đặt tên)";

/** Làm tròn 1 chữ số thập phân (THUẦN). */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** % an toàn (mẫu = 0 → 0). */
export function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return round1((numerator / denominator) * 100);
}

interface Acc {
  sessionsTaught: number;
  counted: number;
  attended: number;
  students: Set<string>;
  scoreSum: number;
  scoreCount: number;
}

function newAcc(): Acc {
  return {
    sessionsTaught: 0,
    counted: 0,
    attended: 0,
    students: new Set<string>(),
    scoreSum: 0,
    scoreCount: 0,
  };
}

/**
 * Tổng hợp báo cáo hiệu suất GV từ các mảng phẳng. KHÔNG chạm DB.
 * Buổi CANCELLED bị loại khỏi mẫu chuyên cần. Record có teacherId ngoài danh sách
 * `teachers` bị bỏ qua (không tạo dòng "ma").
 */
export function buildTeacherPerformanceReport(
  input: TeacherPerformanceInput,
): TeacherPerformanceReport {
  const { teachers, sessions, attendances, enrollments, scores } = input;

  const accMap = new Map<string, Acc>();
  const nameMap = new Map<string, string>();
  for (const t of teachers) {
    accMap.set(t.id, newAcc());
    nameMap.set(t.id, t.name?.trim() || UNNAMED_LABEL);
  }

  // 1. Buổi đã dạy (COMPLETED).
  for (const s of sessions) {
    if (s.status !== "COMPLETED") continue;
    const acc = accMap.get(s.teacherId);
    if (acc) acc.sessionsTaught++;
  }

  // 2. Chuyên cần lớp phụ trách.
  for (const a of attendances) {
    const acc = accMap.get(a.teacherId);
    if (!acc) continue;
    if (a.sessionStatus === "CANCELLED") continue; // buổi hủy không tính.
    acc.counted++;
    if (a.makeupStatus === "MADE_UP" || PRESENT_SET.has(a.status)) {
      acc.attended++;
    } else if (ABSENT_SET.has(a.status)) {
      // vắng — không tăng attended.
    }
  }

  // 3. Số học viên đang hoạt động.
  for (const e of enrollments) {
    const acc = accMap.get(e.teacherId);
    if (!acc) continue;
    if (ACTIVE_ENROLLMENT_STATUSES.has(e.status)) acc.students.add(e.studentId);
  }

  // 4. Điểm học bạ trung bình.
  for (const sc of scores) {
    const acc = accMap.get(sc.teacherId);
    if (!acc) continue;
    acc.scoreSum += sc.level;
    acc.scoreCount++;
  }

  const rows: TeacherPerformanceRow[] = teachers.map((t) => {
    const acc = accMap.get(t.id)!;
    return {
      teacherId: t.id,
      teacherName: nameMap.get(t.id) ?? UNNAMED_LABEL,
      sessionsTaught: acc.sessionsTaught,
      attendanceCounted: acc.counted,
      attendanceAttended: acc.attended,
      attendanceRate: pct(acc.attended, acc.counted),
      studentCount: acc.students.size,
      avgReportScore: acc.scoreCount > 0 ? round1(acc.scoreSum / acc.scoreCount) : null,
    };
  });

  // Sắp xếp: nhiều buổi đã dạy nhất lên đầu.
  rows.sort((a, b) => b.sessionsTaught - a.sessionsTaught);

  return { totalTeachers: teachers.length, rows };
}
