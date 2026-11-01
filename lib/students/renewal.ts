// Module QL học viên PHẦN 4 — dự kiến hết hạn & nhắc tái tục.
//
// Ngày kết thúc dự kiến của 1 enrollment = ngày buổi thứ N (N = số lesson giáo
// trình) theo LỊCH THỰC của lớp (đã trừ/dời nghỉ cơ sở). Khi HS còn ≤ 5 buổi →
// vào danh sách "Sắp hết khoá" cho sale + hiển thị cho phụ huynh.

import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { computeSessionDates, expandHolidaySet } from "@/lib/classes/schedule";
import { vnAddDays, vnStartOfDay } from "@/lib/time/vn";
import {
  computeStudentProgress,
  type AttendanceLiteStatus,
  type MakeupStatusLite,
} from "@/lib/students/progress";

export const NEAR_END_THRESHOLD = 5;

export interface ProjectEndDateInput {
  /** Ngày các buổi đã tạo (sẽ tự sort tăng dần). */
  sessionDates: Date[];
  /** Tổng số buổi của khoá (số lesson). */
  totalLessons: number;
  /** 0=CN..6=T7. */
  scheduleDays: number[];
  /** Tập ngày nghỉ "YYYY-MM-DD". */
  holidays: Set<string>;
  /** Mốc bắt đầu khi chưa có buổi nào (class.startDate). */
  fallbackStart: Date | null;
}

/**
 * Ngày buổi thứ N theo lịch thực. Dùng buổi đã tạo nếu đủ; thiếu thì chiếu tiếp
 * từ buổi cuối (hoặc fallbackStart) theo scheduleDays + lịch nghỉ.
 */
export function projectEndDate(input: ProjectEndDateInput): Date | null {
  const { totalLessons, scheduleDays, holidays, fallbackStart } = input;
  if (totalLessons <= 0) return null;

  const sorted = [...input.sessionDates].sort((a, b) => a.getTime() - b.getTime());
  if (sorted.length >= totalLessons) return sorted[totalLessons - 1];

  const needed = totalLessons - sorted.length;
  const last = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  // Mốc quét theo LỊCH VN: buổi 18:00 VN được lưu là 11:00Z, `getDate()` trên
  // server UTC vẫn ra đúng ngày, nhưng buổi ≥17:00 VN thì lệch sang hôm sau.
  const anchor = last
    ? vnAddDays(vnStartOfDay(last), 1)
    : fallbackStart
      ? vnStartOfDay(fallbackStart)
      : null;

  if (!anchor || scheduleDays.length === 0) {
    // Không đủ dữ kiện để chiếu → best-effort: buổi cuối đã biết.
    return last;
  }

  const projected = computeSessionDates({ from: anchor, scheduleDays, count: needed, holidays });
  if (projected.length === needed) return projected[projected.length - 1];
  return last;
}

/** Ngày kết thúc dự kiến của 1 lớp theo lịch thực (dùng cho portal). */
export async function getClassExpectedEndDate(classId: string): Promise<Date | null> {
  const cls = await db.class.findUnique({
    where: { id: classId },
    select: {
      centerId: true,
      courseId: true,
      scheduleDays: true,
      startDate: true,
      course: { select: { totalSessions: true } },
    },
  });
  if (!cls) return null;

  const [curriculum, sessions, holidayRows] = await Promise.all([
    db.curriculum.findFirst({
      where: { courseId: cls.courseId, isActive: true },
      orderBy: { version: "desc" },
      select: { _count: { select: { lessons: true } } },
    }),
    db.classSession.findMany({
      where: { classId },
      select: { date: true },
      orderBy: { date: "asc" },
    }),
    db.holiday.findMany({
      where: { OR: [{ centerId: null }, { centerId: cls.centerId }] },
      select: { date: true, endDate: true },
    }),
  ]);

  return projectEndDate({
    sessionDates: sessions.map((s) => s.date),
    // Ưu tiên số buổi chuẩn của khoá (Đợt 6), fallback giáo trình.
    totalLessons: cls.course?.totalSessions ?? curriculum?._count.lessons ?? 0,
    scheduleDays: cls.scheduleDays,
    holidays: expandHolidaySet(holidayRows),
    fallbackStart: cls.startDate,
  });
}

export interface NearingEndItem {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  classId: string;
  className: string;
  courseName: string;
  centerName: string | null;
  total: number;
  attended: number;
  remaining: number;
  expectedEndDate: string | null; // ISO
}

/**
 * Enrollment đang học còn ≤ threshold buổi (mặc định 5), kèm ngày kết thúc dự
 * kiến. centerId để lọc theo cơ sở (quản lý cơ sở).
 */
export async function getNearingEndEnrollments(opts?: {
  threshold?: number;
  centerId?: string | null;
  /** Danh sách cơ sở người xem được thấy (màn /enrollments tab "Sắp hết khoá" — cùng tầm
   *  nhìn với tab Đăng ký, 01/10/2026). `undefined` = không giới hạn; `[]` = không thấy gì. */
  centerIds?: readonly string[];
}): Promise<NearingEndItem[]> {
  // Đợt 3 — đọc động từ SystemSetting (default = NEAR_END_THRESHOLD nếu chưa cấu hình).
  const threshold = opts?.threshold ?? (await getSetting("student.nearEndThreshold"));
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const enrollments = await db.enrollment.findMany({
    where: {
      status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
      deletedAt: null, // FIX-C3
      class: {
        deletedAt: null,
        ...(opts?.centerId ? { centerId: opts.centerId } : {}),
        ...(opts?.centerIds ? { centerId: { in: [...opts.centerIds] } } : {}),
      },
    },
    select: {
      id: true,
      studentId: true,
      student: { select: { name: true } },
      class: {
        select: {
          id: true,
          name: true,
          centerId: true,
          courseId: true,
          scheduleDays: true,
          startDate: true,
          course: { select: { name: true, totalSessions: true } },
          center: { select: { name: true } },
        },
      },
    },
  });
  if (enrollments.length === 0) return [];

  const classIds = [...new Set(enrollments.map((e) => e.class.id))];
  const courseIds = [...new Set(enrollments.map((e) => e.class.courseId))];
  const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
  const centerIds = [...new Set(enrollments.map((e) => e.class.centerId).filter((x): x is string => !!x))];

  const [lessonCounts, sessions, attendances, holidayRows] = await Promise.all([
    db.curriculum.findMany({
      where: { courseId: { in: courseIds }, isActive: true },
      orderBy: { version: "desc" },
      select: { courseId: true, _count: { select: { lessons: true } } },
    }),
    db.classSession.findMany({
      where: { classId: { in: classIds } },
      select: { classId: true, date: true },
      orderBy: { date: "asc" },
    }),
    db.attendance.findMany({
      where: { studentId: { in: studentIds }, session: { classId: { in: classIds } } },
      select: { studentId: true, status: true, makeupStatus: true, session: { select: { classId: true } } },
    }),
    db.holiday.findMany({
      where: { OR: [{ centerId: null }, { centerId: { in: centerIds.length ? centerIds : ["__none__"] } }] },
      select: { date: true, endDate: true, centerId: true },
    }),
  ]);

  // Số lesson theo courseId (curriculum active version cao nhất).
  const lessonByCourse = new Map<string, number>();
  for (const c of lessonCounts) {
    if (!lessonByCourse.has(c.courseId)) lessonByCourse.set(c.courseId, c._count.lessons);
  }

  // Buổi theo classId.
  const sessionsByClass = new Map<string, Date[]>();
  for (const s of sessions) {
    const arr = sessionsByClass.get(s.classId) ?? [];
    arr.push(s.date);
    sessionsByClass.set(s.classId, arr);
  }

  // Attendance theo (studentId|classId).
  const key = (sid: string, cid: string) => `${sid}|${cid}`;
  const attByPair = new Map<string, { status: AttendanceLiteStatus; makeupStatus: MakeupStatusLite }[]>();
  for (const a of attendances) {
    const k = key(a.studentId, a.session.classId);
    const arr = attByPair.get(k) ?? [];
    arr.push({ status: a.status as AttendanceLiteStatus, makeupStatus: a.makeupStatus as MakeupStatusLite });
    attByPair.set(k, arr);
  }

  // Holidays: global + theo cơ sở.
  const globalHolidayRows = holidayRows.filter((h) => !h.centerId);
  const holidayByCenter = new Map<string, { date: Date; endDate: Date | null }[]>();
  for (const h of holidayRows) {
    if (!h.centerId) continue;
    const arr = holidayByCenter.get(h.centerId) ?? [];
    arr.push({ date: h.date, endDate: h.endDate });
    holidayByCenter.set(h.centerId, arr);
  }
  const holidaySetCache = new Map<string, Set<string>>();
  const holidaySetFor = (centerId: string | null): Set<string> => {
    const ck = centerId ?? "__global__";
    const cached = holidaySetCache.get(ck);
    if (cached) return cached;
    const rows = [...globalHolidayRows, ...(centerId ? holidayByCenter.get(centerId) ?? [] : [])];
    const set = expandHolidaySet(rows.map((r) => ({ date: r.date, endDate: r.endDate })));
    holidaySetCache.set(ck, set);
    return set;
  };

  const items: NearingEndItem[] = [];
  for (const e of enrollments) {
    // Ưu tiên số buổi chuẩn của khoá (Đợt 6), fallback giáo trình.
    const total = e.class.course?.totalSessions ?? lessonByCourse.get(e.class.courseId) ?? 0;
    if (total <= 0) continue;
    const classSessions = sessionsByClass.get(e.class.id) ?? [];
    const sessionsHeld = classSessions.filter((d) => d.getTime() <= todayEnd.getTime()).length;
    const progress = computeStudentProgress({
      totalLessons: total,
      sessionsHeld,
      attendances: attByPair.get(key(e.studentId, e.class.id)) ?? [],
    });
    if (progress.remaining <= 0 || progress.remaining > threshold) continue;

    const expectedEnd = projectEndDate({
      sessionDates: classSessions,
      totalLessons: total,
      scheduleDays: e.class.scheduleDays,
      holidays: holidaySetFor(e.class.centerId),
      fallbackStart: e.class.startDate,
    });

    items.push({
      enrollmentId: e.id,
      studentId: e.studentId,
      studentName: e.student.name,
      classId: e.class.id,
      className: e.class.name,
      courseName: e.class.course.name,
      centerName: e.class.center?.name ?? null,
      total: progress.total,
      attended: progress.attended,
      remaining: progress.remaining,
      expectedEndDate: expectedEnd?.toISOString() ?? null,
    });
  }

  // Ít buổi còn lại nhất lên đầu.
  items.sort((a, b) => a.remaining - b.remaining);
  return items;
}

// ═══════════════════════════════════════════════════════════════════════════
// BGĐ 31/07 — TÁI TỤC (renewal link).
// Ghi danh tái tục = Enrollment.renewedFromEnrollmentId ≠ null (nối về ghi danh
// khoá trước của CÙNG học viên — enrollStudent đã verify sở hữu khi tạo).
// Hoa hồng: computeCommission({ isRenewal }) — C10.3: tái tục KHÔNG hưởng 4 tầng.
// Khi sinh bảng hoa hồng từ dữ liệu thật, truyền isRenewalEnrollment(enrollment).
// ═══════════════════════════════════════════════════════════════════════════

/** THUẦN — ghi danh này có phải tái tục không (nguồn cho isRenewal của hoa hồng). */
export function isRenewalEnrollment(e: { renewedFromEnrollmentId: string | null }): boolean {
  return e.renewedFromEnrollmentId != null;
}
