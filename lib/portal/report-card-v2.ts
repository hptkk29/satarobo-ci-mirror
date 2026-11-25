import "server-only";
import { db } from "@/lib/db";
import { getPublishedReportCards } from "@/lib/lms/report-card";

// Portal v2 — dữ liệu "Học bạ" cho con đang chọn.
// R7-15: nếu đã có ReportCard PUBLISHED → đọc SNAPSHOT đã phát hành (đóng băng số liệu,
// KHÔNG tính lại live). Chưa có bản phát hành → bản tổng hợp tạm tính từ enrollment
// mới nhất còn hiệu lực (gồm cả COMPLETED/PAUSED — học viên kết khóa vẫn xem được).

export type ReportCardV2 = {
  studentName: string;
  studentCode: string | null;
  className: string | null;
  courseName: string | null;
  teacher: string | null;
  periodLabel: string;
  /** ISO — CHỈ có với bản đã phát hành; null = bản tạm tính (không hiển thị "Ngày phát hành"). */
  publishedDate: string | null;
  isOfficial: boolean;
  /** id ReportCard PUBLISHED — link PDF snapshot /api/portal/report-card/[id]. */
  reportCardId: string | null;
  /** Nhận xét tổng kết trong snapshot đã phát hành (null với bản tạm tính). */
  finalComment: string | null;
  total: number;
  done: number;
  rate: number;
  /**
   * Số buổi vắng KHÔNG bù từ snapshot (AttendanceSummary.absent) — CHỈ bản chính
   * thức. null = bản tạm tính / snapshot cũ thiếu field → UI fallback total-done.
   * KHÔNG suy "vắng = total - done": total gồm cả buổi CHƯA diễn ra + buổi chờ bù.
   */
  absent: number | null;
  /**
   * Ba khối CHỈ CÓ ở bản ĐÃ PHÁT HÀNH — bổ sung 06/09/2026.
   *
   * Bản v1 (`components/report-card/report-card-view.tsx`) render đủ chúng; bản v2 —
   * thứ prod đang chạy — không mang chúng trong kiểu dữ liệu, nên từ ngày bật cờ
   * `PORTAL_V2_ENABLED` phụ huynh mở học bạ đã phát hành ra là mất sạch phần "Đánh giá
   * năng lực" theo tiêu chí, "Nhận xét theo giai đoạn" và dòng "Kết quả". Đây là phần
   * NỘI DUNG của học bạ, không phải trang trí.
   */
  scores: { criterionId: string; name: string; level: number; note: string | null }[];
  periodComments: { period: string; comment: string }[];
  completionStatus: string | null;
  /**
   * Các bản ĐÃ PHÁT HÀNH cũ hơn (portal v1 render tất cả — v2 phải giữ đường
   * xem/tải học bạ các khoá trước, không chỉ bản mới nhất).
   */
  olderPublished: {
    id: string;
    courseName: string | null;
    className: string | null;
    publishedDate: string | null;
  }[];
};

/** "Tháng MM/YYYY" theo giờ VN (server Vercel chạy UTC — tránh lệch ngày). */
function vnPeriodLabel(d: Date): string {
  const mmYyyy = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    month: "2-digit",
    year: "numeric",
  }).format(d);
  return `Tháng ${mmYyyy}`;
}

// Trạng thái enrollment được tính vào học bạ: đang học + đã kết khóa/tạm dừng.
const CURRENT_STATUSES = ["CONFIRMED", "STUDYING", "ACTIVE"] as const;
const REPORTABLE_STATUSES = [...CURRENT_STATUSES, "PAUSED", "COMPLETED"] as const;

export async function getStudentReportCard(studentId: string): Promise<ReportCardV2 | null> {
  // KHÔNG nuốt lỗi getPublishedReportCards — lỗi DB nổi lên error boundary,
  // tránh dán nhãn "bản tạm tính" cho học viên đã có học bạ phát hành.
  const [student, published] = await Promise.all([
    db.student.findUnique({ where: { id: studentId }, select: { name: true, studentCode: true } }),
    getPublishedReportCards(studentId),
  ]);
  if (!student) return null;

  // ── Bản CHÍNH THỨC: render từ snapshot published[0] (mới nhất theo publishedAt) ──
  const official = published[0];
  if (official) {
    // Giáo viên lấy theo ĐÚNG enrollment của học bạ đã phát hành (không lấy enrollment khác).
    const enr = await db.enrollment.findUnique({
      where: { id: official.enrollmentId },
      select: { class: { select: { teacher: { select: { name: true } } } } },
    });
    const publishedAt = official.publishedAt ? new Date(official.publishedAt) : null;
    // Snapshot JSON có thể là bản cũ thiếu absent → guard runtime, UI fallback.
    const attSnap = official.metrics.attendance;
    return {
      studentName: official.student.name || student.name,
      studentCode: official.student.studentCode ?? student.studentCode,
      className: official.className || null,
      courseName: official.course.name || null,
      teacher: enr?.class?.teacher?.name ?? null,
      periodLabel: vnPeriodLabel(publishedAt ?? new Date()),
      publishedDate: publishedAt ? publishedAt.toISOString() : null,
      isOfficial: true,
      reportCardId: official.id,
      finalComment: official.finalComment,
      scores: official.scores,
      periodComments: official.periodComments,
      completionStatus: official.completionStatus,
      total: attSnap.total,
      done: attSnap.attended,
      absent: typeof attSnap.absent === "number" ? attSnap.absent : null,
      rate: attSnap.rate,
      olderPublished: published.slice(1).map((p) => ({
        id: p.id,
        courseName: p.course.name || null,
        className: p.className || null,
        publishedDate: p.publishedAt ? new Date(p.publishedAt).toISOString() : null,
      })),
    };
  }

  // ── Bản TẠM TÍNH: chưa có bản phát hành → tổng hợp live từ 1 enrollment duy nhất ──
  // (lớp/khóa/giáo viên/chuyên cần cùng nguồn — không lệch nhau). Ưu tiên enrollment
  // đang học (cùng cách chọn với getStudentSchedule); không có thì lấy PAUSED/COMPLETED
  // mới nhất. Lọc deletedAt: null (FIX-C3) — không hiện lớp đã xóa mềm.
  const enrollments = await db.enrollment.findMany({
    where: { studentId, deletedAt: null, status: { in: [...REPORTABLE_STATUSES] } },
    orderBy: { createdAt: "desc" },
    select: {
      status: true,
      class: {
        select: {
          id: true,
          // Class.name bắt buộc (classCode nullable — lớp chưa đặt mã sẽ ra "—",
          // lệch với bản chính thức vốn snapshot Class.name).
          name: true,
          course: { select: { name: true } },
          teacher: { select: { name: true } },
        },
      },
    },
  });
  const enr =
    enrollments.find((e) => (CURRENT_STATUSES as readonly string[]).includes(e.status)) ??
    enrollments[0];

  const base: ReportCardV2 = {
    studentName: student.name,
    studentCode: student.studentCode,
    // Bản TẠM TÍNH chưa có snapshot nên chưa có ba khối của bản phát hành.
    scores: [],
    periodComments: [],
    completionStatus: null,
    className: null,
    courseName: null,
    teacher: null,
    periodLabel: vnPeriodLabel(new Date()),
    publishedDate: null,
    isOfficial: false,
    reportCardId: null,
    finalComment: null,
    total: 0,
    done: 0,
    absent: null,
    rate: 0,
    olderPublished: [],
  };
  const cls = enr?.class;
  if (!cls) return base;

  const now = new Date();
  const [sessions, attendance] = await Promise.all([
    db.classSession.findMany({
      where: { classId: cls.id, status: { not: "CANCELLED" } },
      select: { date: true },
    }),
    // Đồng bộ chuẩn hệ thống (lib/attendance/summary.ts): loại attendance của buổi
    // CANCELLED khỏi mẫu số (R7-06 hủy không xóa row) — khớp query sessions ở trên.
    db.attendance.findMany({
      where: { studentId, session: { classId: cls.id, status: { not: "CANCELLED" } } },
      select: { status: true, makeupStatus: true },
    }),
  ]);
  // Buổi vắng đã học bù xong (MADE_UP) tính là CÓ MẶT — cùng quy tắc với
  // lib/attendance/summary.ts + lib/students/progress.ts (schema: "tính như có mặt").
  const present = attendance.filter(
    (a) => a.makeupStatus === "MADE_UP" || a.status === "PRESENT" || a.status === "LATE",
  ).length;

  // ⚠️ MẪU SỐ của chuyên cần là SỐ BUỔI ĐÃ DIỄN RA, không phải số DÒNG điểm danh
  // (06/09). Hai số đó khác nhau đúng ở những buổi giáo viên chưa chấm: chia cho số
  // dòng thì buổi chưa chấm biến mất khỏi mẫu số và % vọt lên, lệch hẳn với thẻ ở
  // trang chủ phụ huynh và với site giáo viên — cùng một đứa trẻ, hai con số.
  // Đây đúng là phép chia đã được thống nhất ở lib/attendance/summary.ts hôm 04/09.
  // Truy vấn `sessions` phía trên đã loại buổi CANCELLED rồi.
  const daDienRa = sessions.filter((s) => s.date < now).length;

  return {
    ...base,
    className: cls.name,
    courseName: cls.course?.name ?? null,
    teacher: cls.teacher?.name ?? null,
    total: sessions.length,
    done: daDienRa,
    rate: daDienRa > 0 ? Math.round((present / daDienRa) * 100) : 0,
  };
}
