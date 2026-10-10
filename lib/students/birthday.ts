import "server-only";
import { db } from "@/lib/db";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import {
  birthdayWithinWindow,
  formatDayKeyDMY,
  pickCelebrationSession,
  shiftDayKey,
  vnDayKey,
  vnDayStartUtc,
  type SessionCandidate,
} from "@/lib/students/birthday-dates";

// =============================================================================
// Sinh nhật học viên — LẬP KẾ HOẠCH (pha 1 của cron student-birthday).
//
// Quét học viên có sinh nhật trong cửa sổ tới, tìm BUỔI HỌC để tổ chức, ghi
// StudentBirthdayGreeting (1 dòng / HV / năm).
//
// ⚠️ QUY TẮC CHỦ DỰ ÁN CHỐT 06/08/2026: học viên chưa xếp lớp / lớp đã kết thúc
// (không tìm được buổi nào) → BỎ QUA HOÀN TOÀN. Không tạo dòng, không nhắc việc,
// KHÔNG gửi ZNS. Đừng "tạo tạm cho đủ" — dòng không có buổi tổ chức chỉ làm bẩn
// màn /admin/sinh-nhat và đẩy tin nhắn tới phụ huynh đã nghỉ học.
//
// ⚠️ Vì sao buổi tổ chức phải tính TRƯỚC chứ không đợi tới hôm sinh nhật: buổi tổ
// chức có thể rơi TRƯỚC ngày sinh nhật. Báo vào sáng hôm sinh nhật là báo khi buổi
// đó đã trôi qua — đúng cái bẫy làm hỏng cả tính năng.
// =============================================================================

/** Buổi tổ chức được phép lùi/tiến bao nhiêu ngày so với sinh nhật khi tìm bù. */
const FORWARD_FALLBACK_DAYS = 7;

export interface SessionBirthday {
  greetingId: string;
  studentId: string;
  studentName: string;
  /** Ngày sinh nhật dạng dd/MM — buổi tổ chức có thể KHÁC ngày này. */
  birthdayText: string;
  /** Buổi tổ chức rơi đúng hôm sinh nhật hay tổ chức sớm/bù. */
  onBirthday: boolean;
}

/**
 * Học viên có sinh nhật được TỔ CHỨC tại buổi này — dùng cho banner nhắc giáo viên
 * và thẻ "Cần lưu ý" trước buổi.
 *
 * Đọc theo `celebrationSessionId` chứ không tự dò lại ngày sinh: buổi tổ chức đã
 * được cron chốt, hai chỗ tính độc lập là hai chỗ có thể lệch nhau.
 */
export async function getSessionBirthdays(sessionId: string): Promise<SessionBirthday[]> {
  const rows = await db.studentBirthdayGreeting.findMany({
    where: { celebrationSessionId: sessionId },
    select: {
      id: true,
      birthdayDate: true,
      celebrationDate: true,
      student: { select: { id: true, name: true } },
    },
    orderBy: { birthdayDate: "asc" },
  });
  return rows.map((r) => {
    const birthdayKey = vnDayKey(r.birthdayDate);
    return {
      greetingId: r.id,
      studentId: r.student.id,
      studentName: r.student.name,
      birthdayText: formatDayKeyDMY(birthdayKey).slice(0, 5), // dd/MM
      onBirthday: r.celebrationDate !== null && vnDayKey(r.celebrationDate) === birthdayKey,
    };
  });
}

export interface PlanBirthdaysConfig {
  lookaheadDays: number;
  lookbackDays: number;
}

export interface PlanBirthdaysResult {
  scanned: number;
  /** Có sinh nhật trong cửa sổ (trước khi lọc buổi học). */
  candidates: number;
  planned: number;
  /** Bỏ qua vì không tìm được buổi học nào — đúng quy tắc, không phải lỗi. */
  skippedNoSession: number;
}

/**
 * Quét + ghi sổ sinh nhật sắp tới. Idempotent: gọi lại trong cùng ngày không đẻ
 * dòng mới (khoá `@@unique([studentId, year])`) và không kéo lại các mốc đã xử lý
 * (`staffNotifiedAt` / `znsStatus` / `celebratedAt` KHÔNG bị ghi đè).
 */
export async function planBirthdays(
  now: Date,
  cfg: PlanBirthdaysConfig,
): Promise<PlanBirthdaysResult> {
  const todayKey = vnDayKey(now);

  // 1) Học viên ĐANG HỌC có ngày sinh. Chỉ lấy cột cần — bảng Student rất rộng.
  const students = await db.student.findMany({
    where: { status: "ACTIVE", deletedAt: null, dateOfBirth: { not: null } },
    select: { id: true, name: true, centerId: true, dateOfBirth: true },
  });

  // 2) Lọc trong JS theo (tháng, ngày). Không dùng raw SQL: cột dateOfBirth không
  // có index theo tháng/ngày, và số HV đang học ở quy mô này (hàng trăm) làm việc
  // lọc trong bộ nhớ rẻ hơn hẳn so với thêm expression index phải bảo trì.
  const candidates = students
    .map((s) => {
      const occ = birthdayWithinWindow(s.dateOfBirth!, todayKey, cfg.lookaheadDays);
      return occ ? { student: s, occ } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const result: PlanBirthdaysResult = {
    scanned: students.length,
    candidates: candidates.length,
    planned: 0,
    skippedNoSession: 0,
  };
  if (candidates.length === 0) return result;

  // 3) Lớp đang học của các HV ứng viên — MỘT truy vấn cho cả nhóm (đừng lặp
  // findMany theo từng HV: cron chạy hằng ngày, N truy vấn là N lần round-trip).
  const studentIds = candidates.map((c) => c.student.id);
  const enrollments = await db.enrollment.findMany({
    where: {
      studentId: { in: studentIds },
      status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
      deletedAt: null,
    },
    select: { studentId: true, classId: true },
  });
  if (enrollments.length === 0) {
    result.skippedNoSession = candidates.length;
    return result;
  }

  const classIdsByStudent = new Map<string, string[]>();
  for (const e of enrollments) {
    const arr = classIdsByStudent.get(e.studentId);
    if (arr) arr.push(e.classId);
    else classIdsByStudent.set(e.studentId, [e.classId]);
  }

  // 4) Buổi học của các lớp đó trong khoảng đủ rộng để phủ mọi mốc sinh nhật
  // trong cửa sổ: lùi tối đa `lookbackDays` trước ngày sớm nhất, tiến tối đa
  // FORWARD_FALLBACK_DAYS sau ngày muộn nhất.
  const fromKey = shiftDayKey(todayKey, -cfg.lookbackDays);
  const toKey = shiftDayKey(todayKey, cfg.lookaheadDays + FORWARD_FALLBACK_DAYS);
  const sessions = await db.classSession.findMany({
    where: {
      classId: { in: [...new Set(enrollments.map((e) => e.classId))] },
      status: { not: "CANCELLED" },
      date: {
        gte: vnDayStartUtc(fromKey),
        // Cận trên = 00:00 VN của NGÀY KẾ TIẾP, để buổi nằm trong ngày `toKey`
        // không bị cắt mất (buổi lưu ở nửa đêm giờ VN lẫn UTC đều lọt).
        lt: vnDayStartUtc(shiftDayKey(toKey, 1)),
      },
    },
    select: { id: true, date: true, classId: true, class: { select: { name: true } } },
  });

  const sessionsByClass = new Map<string, SessionCandidate[]>();
  for (const s of sessions) {
    const item: SessionCandidate = {
      id: s.id,
      date: s.date,
      classId: s.classId,
      className: s.class.name,
    };
    const arr = sessionsByClass.get(s.classId);
    if (arr) arr.push(item);
    else sessionsByClass.set(s.classId, [item]);
  }

  // 5) Chọn buổi tổ chức + ghi sổ.
  for (const { student, occ } of candidates) {
    const classIds = classIdsByStudent.get(student.id) ?? [];
    const own = classIds.flatMap((cid) => sessionsByClass.get(cid) ?? []);
    const picked = pickCelebrationSession(own, occ.dayKey, {
      lookbackDays: cfg.lookbackDays,
      forwardDays: FORWARD_FALLBACK_DAYS,
    });
    if (!picked) {
      result.skippedNoSession++;
      continue;
    }

    await db.studentBirthdayGreeting.upsert({
      where: { studentId_year: { studentId: student.id, year: occ.year } },
      create: {
        studentId: student.id,
        year: occ.year,
        birthdayDate: occ.date,
        // scopedDb KHÔNG che write → phải tự set centerId, quên là dòng vô hình
        // với chính Sale/QLCS cơ sở đó.
        centerId: student.centerId,
        celebrationSessionId: picked.id,
        celebrationDate: picked.date,
      },
      // Lịch lớp đổi (dời buổi, huỷ buổi) → cập nhật lại buổi tổ chức. KHÔNG đụng
      // staffNotifiedAt/znsStatus/celebratedAt: ghi đè là gửi lại tin đã gửi.
      update: {
        birthdayDate: occ.date,
        centerId: student.centerId,
        celebrationSessionId: picked.id,
        celebrationDate: picked.date,
      },
    });
    result.planned++;
  }

  return result;
}
