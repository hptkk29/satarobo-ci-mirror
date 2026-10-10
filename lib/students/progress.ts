// Module Quản lý học viên PHẦN 1 — số buổi học (tổng / đã học / còn lại).
//
// Tổng số buổi = số Lesson trong giáo trình (Curriculum active) của khoá lớp.
// Đã học      = buổi có mặt (PRESENT/LATE) + buổi vắng-có-bù đã bù xong (MADE_UP).
// Còn lại     = tổng − đã học.
// Vắng không bù = buổi VẮNG (đủ 4 nhãn vắng, xem lib/labels) chưa bù (PHẦN 2).
//
// Hàm thuần `computeStudentProgress` để test; wrapper `getStudentClassProgress`
// lấy số liệu thật + vị trí buổi theo LỊCH THỰC (ClassSession đã trừ/dời nghỉ).

import { db } from "@/lib/db";
import { vnEndOfDay } from "@/lib/time/vn";
import {
  ABSENT_STATUSES,
  PRESENT_STATUSES,
  type AttendanceStatusValue,
} from "@/lib/labels";

/**
 * ⚠️ 19/08 — TRƯỚC ĐÂY chỉ có 4 giá trị ("PRESENT" | "ABSENT" | "LATE" | "EXCUSED"), trong
 * khi site giáo viên ghi ABSENT_UNEXCUSED / ABSENT_EXCUSED. Bản ghi nhãn mới rơi qua CẢ
 * hai nhánh đếm ⇒ hồ sơ học viên bên admin báo 0 buổi vắng cho mọi buổi do GV điểm danh,
 * còn cổng phụ huynh (map đủ 6 nhãn) lại báo đúng. Alias sang nguồn chung ở lib/labels.
 */
export type AttendanceLiteStatus = AttendanceStatusValue;
export type MakeupStatusLite = "NONE" | "NEEDS_MAKEUP" | "MADE_UP";

export interface AttendanceProgressItem {
  status: AttendanceLiteStatus;
  /** PHẦN 2 — mặc định NONE khi cột chưa tồn tại. */
  makeupStatus?: MakeupStatusLite | null;
}

export interface StudentProgress {
  /** Tổng số buổi của khoá (số lesson giáo trình). */
  total: number;
  /** Đã học = có mặt + vắng-có-bù. */
  attended: number;
  /** Còn lại = tổng − đã học (không âm). */
  remaining: number;
  /** Vắng KHÔNG bù. */
  absentNoMakeup: number;
  /** Số buổi đã diễn ra theo lịch thực (date ≤ hôm nay). */
  sessionsHeld: number;
  /** Buổi đang/sắp học (1..total) — để hiển thị "buổi X / N". */
  currentSession: number;
}

export interface ComputeProgressInput {
  totalLessons: number;
  /** Số buổi đã diễn ra theo lịch thực. */
  sessionsHeld: number;
  attendances: AttendanceProgressItem[];
}

export function computeStudentProgress(input: ComputeProgressInput): StudentProgress {
  const total = Math.max(0, input.totalLessons);
  let attended = 0;
  let absentNoMakeup = 0;

  for (const a of input.attendances) {
    const madeUp = a.makeupStatus === "MADE_UP";
    if (PRESENT_STATUSES.has(a.status) || madeUp) {
      attended++;
    } else if (ABSENT_STATUSES.has(a.status)) {
      absentNoMakeup++;
    }
  }

  const remaining = Math.max(0, total - attended);
  const sessionsHeld = Math.max(0, input.sessionsHeld);
  // Buổi "đang học" = buổi kế tiếp chưa diễn ra; nếu đã hết thì = total.
  const currentSession =
    total === 0 ? 0 : Math.min(total, sessionsHeld < total ? sessionsHeld + 1 : total);

  return { total, attended, remaining, absentNoMakeup, sessionsHeld, currentSession };
}

/**
 * Tổng số buổi của khoá ứng với lớp.
 * Ưu tiên Course.totalSessions (số buổi CHUẨN cam kết), fallback đếm Curriculum
 * lessons, cuối cùng 0. (Đợt 6 #1+2 — lớp chưa soạn giáo trình vẫn ra đúng N.)
 */
async function getTotalLessons(classId: string): Promise<number> {
  const cls = await db.class.findUnique({
    where: { id: classId },
    select: { course: { select: { id: true, totalSessions: true } } },
  });
  if (!cls?.course) return 0;
  if (cls.course.totalSessions != null) return cls.course.totalSessions;

  const curriculum = await db.curriculum.findFirst({
    where: { courseId: cls.course.id, isActive: true },
    orderBy: { version: "desc" },
    select: { _count: { select: { lessons: true } } },
  });
  return curriculum?._count.lessons ?? 0;
}

/**
 * Tiến độ buổi học của 1 HS trong 1 lớp — đọc số liệu thật.
 * sessionsHeld lấy từ ClassSession (date ≤ hôm nay) = LỊCH THỰC đã dời nghỉ.
 */
export async function getStudentClassProgress(
  studentId: string,
  classId: string,
): Promise<StudentProgress> {
  // 06/09 — HẾT NGÀY THEO LỊCH VN. Bản cũ `new Date(y, m, d, 23, 59, 59)` dựng mốc theo
  // TZ của TIẾN TRÌNH: máy dev (+07) ra 23:59 giờ VN, còn Vercel (UTC) ra 23:59Z tức
  // 06:59 sáng HÔM SAU giờ VN. Cùng một lớp, cùng một lúc, "buổi X/N" trên prod và trên
  // máy lập trình viên lệch nhau đúng một buổi vào những ngày có lịch học.
  const todayEnd = vnEndOfDay(new Date());

  const [totalLessons, sessionsHeld, attendances] = await Promise.all([
    getTotalLessons(classId),
    // 19/08 — LOẠI buổi đã huỷ khỏi "đã diễn ra". Buổi huỷ không tính học cũng không
    // tính vắng (luật ở lib/labels.ts + lib/attendance/summary.ts đã theo); riêng chỗ này
    // còn đếm nên "buổi X/N" và % chuyên cần của cùng một lớp ra hai con số khác nhau
    // tuỳ màn hình.
    db.classSession.count({
      where: { classId, date: { lte: todayEnd }, status: { not: "CANCELLED" } },
    }),
    // Buổi ĐÃ HUỶ cũng phải loại khỏi TỬ SỐ, không chỉ mẫu số: lọc một bên thôi thì thẻ
    // "đã học x/N" và "vắng N" đếm trên hai tập buổi khác nhau.
    db.attendance.findMany({
      where: { studentId, session: { classId, status: { not: "CANCELLED" } } },
      select: { status: true, makeupStatus: true },
    }),
  ]);

  return computeStudentProgress({
    totalLessons,
    sessionsHeld,
    attendances: attendances.map((a) => ({
      status: a.status as AttendanceLiteStatus,
      makeupStatus: a.makeupStatus as MakeupStatusLite,
    })),
  });
}

export interface StudentAbsence {
  date: Date;
  className: string;
  status: AttendanceLiteStatus;
  makeupStatus: MakeupStatusLite;
  absenceReason: string | null;
}

/** Chi tiết buổi vắng (ABSENT/EXCUSED) của HS — ngày, lý do, trạng thái bù. */
export async function getStudentAbsences(studentId: string): Promise<StudentAbsence[]> {
  const rows = await db.attendance.findMany({
    // Buổi huỷ không phải buổi vắng (lib/labels.ts) — đừng liệt kê vào "chi tiết buổi vắng".
    where: {
      studentId,
      status: { in: [...ABSENT_STATUSES] },
      session: { status: { not: "CANCELLED" } },
    },
    select: {
      status: true,
      makeupStatus: true,
      absenceReason: true,
      session: { select: { date: true, class: { select: { name: true } } } },
    },
    orderBy: { session: { date: "desc" } },
  });
  return rows.map((r) => ({
    date: r.session.date,
    className: r.session.class.name,
    status: r.status as AttendanceLiteStatus,
    makeupStatus: r.makeupStatus as MakeupStatusLite,
    absenceReason: r.absenceReason,
  }));
}
