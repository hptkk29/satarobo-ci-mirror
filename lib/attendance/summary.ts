// lib/attendance/summary.ts — R7-08: 5 chỉ số tiến độ điểm danh của 1 enrollment.
//
// { total, attended (gồm đã-bù), absent, needMakeup, madeUp }.
//  - total          = số buổi CHUẨN của khoá (KHÔNG cộng buổi bù — buổi bù không tăng total).
//  - daDienRa       = số buổi của lớp ĐÃ DIỄN RA tính tới hôm nay (bỏ buổi CANCELLED).
//
// ⚠️ HAI MẪU SỐ, HAI CÂU HỎI KHÁC NHAU — đừng gọi chung là "buổi" (chủ dự án 04/09):
//    Chuyên cần   = attended / daDienRa   — "con đi học đủ không"
//    Tiến độ khoá = daDienRa / total     — "khoá đi được tới đâu"
//
// Vì sao phải tách: trước 04/09 site phụ huynh chia cho `total` (tổng buổi khoá) còn
// giáo viên/admin chia cho số buổi đã diễn ra (`lib/progress.ts`) ⇒ cùng một đứa trẻ,
// cùng một lúc, phụ huynh đọc 7/12 còn giáo viên đọc 7/11. Đo được trên dữ liệu thật.
//  - attended       = có mặt/đi muộn + buổi vắng đã học bù xong (MADE_UP).
//  - madeUp         = buổi vắng đã bù (tập con của attended, báo cáo riêng).
//  - needMakeup     = buổi vắng đang CHỜ bù (NEEDS_MAKEUP).
//  - absent         = buổi vắng KHÔNG bù (không phải made-up / không chờ bù).
// Buổi CANCELLED bị bỏ qua (không tính vắng, không tính học).
//
// Hàm thuần `computeAttendanceSummary` để test bảng biên; wrapper
// `attendanceSummary(enrollmentId)` đọc số liệu thật (ownership do caller bảo đảm,
// theo pattern lib/students/progress.ts).
import { db } from "@/lib/db";
import { getStudentClassProgress } from "@/lib/students/progress";
import type {
  AttendanceStatusValue,
  MakeupStatusValue,
  SessionStatusValue,
} from "@/lib/labels";

export interface AttendanceSummary {
  total: number;
  /** Số buổi ĐÃ DIỄN RA — MẪU SỐ của chuyên cần (xem khối chú thích đầu file). */
  daDienRa: number;
  attended: number;
  absent: number;
  needMakeup: number;
  madeUp: number;
}

export interface AttendanceSummaryItem {
  status: AttendanceStatusValue;
  makeupStatus?: MakeupStatusValue | null;
  sessionStatus?: SessionStatusValue | null;
}

export interface ComputeSummaryInput {
  totalLessons: number;
  /**
   * Số buổi của lớp đã diễn ra. Bỏ trống → rơi về số DÒNG điểm danh (hành vi cũ của
   * nơi gọi chưa kịp truyền) chứ KHÔNG rơi về `totalLessons`: chia cho tổng buổi khoá
   * là đúng cái lệch vừa vá.
   */
  sessionsHeld?: number;
  attendances: AttendanceSummaryItem[];
}

const PRESENT_SET = new Set<AttendanceStatusValue>(["PRESENT", "LATE"]);
const ABSENT_SET = new Set<AttendanceStatusValue>([
  "ABSENT",
  "EXCUSED",
  "ABSENT_EXCUSED",
  "ABSENT_UNEXCUSED",
]);

export function computeAttendanceSummary(input: ComputeSummaryInput): AttendanceSummary {
  const total = Math.max(0, input.totalLessons);
  let attended = 0;
  let absent = 0;
  let needMakeup = 0;
  let madeUp = 0;

  for (const a of input.attendances) {
    // Buổi hủy không tính (không vắng, không học).
    if (a.sessionStatus === "CANCELLED") continue;

    if (a.makeupStatus === "MADE_UP") {
      madeUp++;
      attended++;
      continue;
    }
    if (PRESENT_SET.has(a.status)) {
      attended++;
      continue;
    }
    if (ABSENT_SET.has(a.status)) {
      if (a.makeupStatus === "NEEDS_MAKEUP") needMakeup++;
      else absent++;
    }
  }

  // Buổi CANCELLED đã bị bỏ ở vòng trên nên số dòng còn lại là đường lui hợp lý nhất
  // khi nơi gọi chưa truyền `sessionsHeld`.
  const soDongHopLe = input.attendances.filter((a) => a.sessionStatus !== "CANCELLED").length;
  const daDienRa = Math.max(0, input.sessionsHeld ?? soDongHopLe);

  return { total, daDienRa, attended, absent, needMakeup, madeUp };
}

/**
 * 5 chỉ số thật cho 1 enrollment. total = số buổi chuẩn của khoá (qua
 * getStudentClassProgress — buổi bù không tăng total vì buổi bù thuộc lớp khác,
 * không nằm trong attendances của enrollment này).
 */
export async function attendanceSummary(enrollmentId: string): Promise<AttendanceSummary> {
  const enr = await db.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { studentId: true, classId: true },
  });
  if (!enr)
    return { total: 0, daDienRa: 0, attended: 0, absent: 0, needMakeup: 0, madeUp: 0 };

  const [{ total }, attendances, daDienRa] = await Promise.all([
    getStudentClassProgress(enr.studentId, enr.classId),
    db.attendance.findMany({
      where: { studentId: enr.studentId, session: { classId: enr.classId } },
      select: { status: true, makeupStatus: true, session: { select: { status: true } } },
    }),
    db.classSession.count({
      where: {
        classId: enr.classId,
        status: { not: "CANCELLED" },
        date: { lte: new Date() },
      },
    }),
  ]);

  return computeAttendanceSummary({
    totalLessons: total,
    sessionsHeld: daDienRa,
    attendances: attendances.map((a) => ({
      status: a.status as AttendanceStatusValue,
      makeupStatus: a.makeupStatus as MakeupStatusValue,
      sessionStatus: a.session.status as SessionStatusValue,
    })),
  });
}

/**
 * Bản GỘP của `attendanceSummary` cho NHIỀU ghi danh — số truy vấn CỐ ĐỊNH (4), không
 * phụ thuộc số ghi danh.
 *
 * ⚠️ Dùng hàm này ở mọi màn DANH SÁCH. `attendanceSummary(enrollmentId)` tốn ~6 truy vấn
 * mỗi lần gọi (enrollment + getStudentClassProgress + attendance), nên
 * `Promise.all(enrollments.map(attendanceSummary))` ở trang học bạ site GV bắn ~700 truy
 * vấn ĐỒNG THỜI cho một giáo viên 6 lớp — đủ để nuốt sạch pool kết nối và làm mọi request
 * khác của cả hệ thống xếp hàng. Giữ `attendanceSummary` cho màn chi tiết 1 ghi danh.
 *
 * Trả Map<enrollmentId, AttendanceSummary>; ghi danh không tìm thấy → không có khoá.
 */
export async function attendanceSummaryForEnrollments(
  enrollmentIds: string[],
): Promise<Map<string, AttendanceSummary>> {
  const out = new Map<string, AttendanceSummary>();
  if (enrollmentIds.length === 0) return out;

  const enrollments = await db.enrollment.findMany({
    where: { id: { in: enrollmentIds } },
    select: { id: true, studentId: true, classId: true },
  });
  if (enrollments.length === 0) return out;

  const classIds = [...new Set(enrollments.map((e) => e.classId))];
  const studentIds = [...new Set(enrollments.map((e) => e.studentId))];

  const [classes, attendances, buoiDaDienRa] = await Promise.all([
    db.class.findMany({
      where: { id: { in: classIds } },
      select: { id: true, course: { select: { id: true, totalSessions: true } } },
    }),
    db.attendance.findMany({
      where: { studentId: { in: studentIds }, session: { classId: { in: classIds } } },
      select: {
        studentId: true,
        status: true,
        makeupStatus: true,
        session: { select: { classId: true, status: true } },
      },
    }),
    // Buổi ĐÃ DIỄN RA theo từng lớp — MỘT truy vấn gom cho mọi lớp, giữ đúng lời hứa
    // "số truy vấn CỐ ĐỊNH" của hàm này (xem chú thích trên: bản theo từng ghi danh
    // từng bắn ~700 truy vấn đồng thời ở trang học bạ site GV).
    db.classSession.groupBy({
      by: ["classId"],
      where: {
        classId: { in: classIds },
        status: { not: "CANCELLED" },
        date: { lte: new Date() },
      },
      _count: { _all: true },
    }),
  ]);
  const daDienRaByClass = new Map(
    buoiDaDienRa.map((r) => [r.classId, r._count._all]),
  );

  // Tổng buổi chuẩn của khoá: ưu tiên Course.totalSessions, thiếu thì đếm lesson của
  // curriculum ACTIVE version cao nhất — cùng luật với getTotalLessons (1 HV/1 lớp).
  const courseNeedingCurriculum = classes
    .map((c) => c.course)
    .filter((c): c is { id: string; totalSessions: number | null } => !!c && c.totalSessions == null)
    .map((c) => c.id);
  const lessonCountByCourse = new Map<string, number>();
  if (courseNeedingCurriculum.length > 0) {
    const currs = await db.curriculum.findMany({
      where: { courseId: { in: [...new Set(courseNeedingCurriculum)] }, isActive: true },
      orderBy: { version: "desc" },
      select: { courseId: true, _count: { select: { lessons: true } } },
    });
    for (const c of currs) {
      // orderBy version desc → bản gặp đầu tiên mỗi course = version cao nhất.
      if (!lessonCountByCourse.has(c.courseId)) {
        lessonCountByCourse.set(c.courseId, c._count.lessons);
      }
    }
  }
  const totalByClass = new Map<string, number>();
  for (const c of classes) {
    const total =
      c.course?.totalSessions ??
      (c.course ? (lessonCountByCourse.get(c.course.id) ?? 0) : 0);
    totalByClass.set(c.id, total);
  }

  const byPair = new Map<string, AttendanceSummaryItem[]>();
  for (const a of attendances) {
    const key = `${a.studentId}:${a.session.classId}`;
    const arr = byPair.get(key) ?? [];
    arr.push({
      status: a.status as AttendanceStatusValue,
      makeupStatus: a.makeupStatus as MakeupStatusValue,
      sessionStatus: a.session.status as SessionStatusValue,
    });
    byPair.set(key, arr);
  }

  for (const e of enrollments) {
    out.set(
      e.id,
      computeAttendanceSummary({
        totalLessons: totalByClass.get(e.classId) ?? 0,
        sessionsHeld: daDienRaByClass.get(e.classId) ?? 0,
        attendances: byPair.get(`${e.studentId}:${e.classId}`) ?? [],
      }),
    );
  }
  return out;
}
