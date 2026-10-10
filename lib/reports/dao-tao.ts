// lib/reports/dao-tao.ts — R7-17: Báo cáo ĐÀO TẠO (training) — hàm THUẦN.
//
// Nhận MẢNG record PHẲNG (đã query sẵn ở Server Component) → trả object số liệu.
// KHÔNG gọi DB ở đây → Vitest test không cần Postgres. Mirror style
// lib/crm/marketing-report.ts + lib/attendance/summary.ts.
//
// Chỉ số:
//  1. Tỷ lệ chuyên cần theo lớp (attendance rate) — present(+late+made-up) / buổi tính.
//  2. Tỷ lệ hoàn thành bài tập — (SUBMITTED + GRADED) / tổng bài giao.
//  3. Số buổi (Lesson) THIẾU đề thi/bài tập — Lesson không có Exam liên kết.
//  4. Số ca học bù — makeupStatus MADE_UP / NEEDS_MAKEUP.
import type {
  AttendanceStatusValue,
  MakeupStatusValue,
  SessionStatusValue,
} from "@/lib/labels";

export type HomeworkAssignmentStatusValue =
  | "ASSIGNED"
  | "SUBMITTED"
  | "GRADED"
  | "MISSED";

// ── Input records (phẳng) ───────────────────────────────────────────────────
export interface ClassRecord {
  id: string;
  name: string;
  classCode: string | null;
}

export interface AttendanceRecord {
  classId: string;
  status: AttendanceStatusValue;
  makeupStatus: MakeupStatusValue | null;
  sessionStatus: SessionStatusValue | null;
}

export interface HomeworkRecord {
  classId: string;
  status: HomeworkAssignmentStatusValue;
}

/** Lesson đã kèm cờ `hasExam` (page tính từ _count.exams > 0). */
export interface LessonRecord {
  id: string;
  title: string;
  hasExam: boolean;
}

export interface TrainingReportInput {
  classes: ClassRecord[];
  attendances: AttendanceRecord[];
  homework: HomeworkRecord[];
  lessons: LessonRecord[];
}

// ── Output ──────────────────────────────────────────────────────────────────
export interface ClassAttendanceRow {
  classId: string;
  className: string;
  classCode: string | null;
  /** Buổi được tính (không gồm buổi hủy). */
  counted: number;
  attended: number;
  absent: number;
  needMakeup: number;
  madeUp: number;
  /** % chuyên cần (0–100, 1 chữ số thập phân). counted=0 → 0. */
  attendanceRate: number;
}

export interface TrainingReport {
  // Tổng quan
  totalClasses: number;
  // 1. Chuyên cần
  perClass: ClassAttendanceRow[];
  overallAttendanceRate: number;
  // 2. Bài tập
  homeworkTotal: number;
  homeworkCompleted: number; // SUBMITTED + GRADED
  homeworkCompletionRate: number;
  // 3. Buổi thiếu đề thi/bài tập
  lessonsTotal: number;
  lessonsMissingExam: number;
  // 4. Học bù
  makeupMadeUp: number;
  makeupNeeded: number;
}

const PRESENT_SET = new Set<AttendanceStatusValue>(["PRESENT", "LATE"]);
const ABSENT_SET = new Set<AttendanceStatusValue>([
  "ABSENT",
  "EXCUSED",
  "ABSENT_EXCUSED",
  "ABSENT_UNEXCUSED",
]);

const HOMEWORK_DONE = new Set<HomeworkAssignmentStatusValue>(["SUBMITTED", "GRADED"]);

/** Làm tròn 1 chữ số thập phân (THUẦN). */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** % an toàn (mẫu = 0 → 0). */
export function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return round1((numerator / denominator) * 100);
}

/**
 * Tổng hợp báo cáo đào tạo từ các mảng phẳng. KHÔNG chạm DB.
 * Buổi CANCELLED bị loại khỏi mẫu chuyên cần (không tính vắng, không tính học).
 */
export function computeTrainingReport(input: TrainingReportInput): TrainingReport {
  const { classes, attendances, homework, lessons } = input;

  // Khởi tạo dòng theo lớp (giữ thứ tự classes truyền vào).
  const rowMap = new Map<string, ClassAttendanceRow>();
  for (const c of classes) {
    rowMap.set(c.id, {
      classId: c.id,
      className: c.name,
      classCode: c.classCode,
      counted: 0,
      attended: 0,
      absent: 0,
      needMakeup: 0,
      madeUp: 0,
      attendanceRate: 0,
    });
  }

  let makeupMadeUp = 0;
  let makeupNeeded = 0;

  for (const a of attendances) {
    // makeup tính trên TOÀN bộ (không phụ thuộc lớp có trong danh sách hay không).
    if (a.makeupStatus === "MADE_UP") makeupMadeUp++;
    else if (a.makeupStatus === "NEEDS_MAKEUP") makeupNeeded++;

    const row = rowMap.get(a.classId);
    if (!row) continue; // bản ghi ngoài phạm vi lớp đang xét → bỏ.

    // Buổi hủy: không tính vào mẫu.
    if (a.sessionStatus === "CANCELLED") continue;

    row.counted++;
    if (a.makeupStatus === "MADE_UP") {
      row.madeUp++;
      row.attended++;
      continue;
    }
    if (PRESENT_SET.has(a.status)) {
      row.attended++;
      continue;
    }
    if (ABSENT_SET.has(a.status)) {
      if (a.makeupStatus === "NEEDS_MAKEUP") row.needMakeup++;
      else row.absent++;
    }
  }

  let totalCounted = 0;
  let totalAttended = 0;
  const perClass: ClassAttendanceRow[] = [];
  for (const c of classes) {
    const row = rowMap.get(c.id)!;
    row.attendanceRate = pct(row.attended, row.counted);
    totalCounted += row.counted;
    totalAttended += row.attended;
    perClass.push(row);
  }

  // 2. Bài tập.
  const homeworkTotal = homework.length;
  const homeworkCompleted = homework.filter((h) => HOMEWORK_DONE.has(h.status)).length;

  // 3. Buổi thiếu đề thi/bài tập.
  const lessonsTotal = lessons.length;
  const lessonsMissingExam = lessons.filter((l) => !l.hasExam).length;

  return {
    totalClasses: classes.length,
    perClass,
    overallAttendanceRate: pct(totalAttended, totalCounted),
    homeworkTotal,
    homeworkCompleted,
    homeworkCompletionRate: pct(homeworkCompleted, homeworkTotal),
    lessonsTotal,
    lessonsMissingExam,
    makeupMadeUp,
    makeupNeeded,
  };
}
