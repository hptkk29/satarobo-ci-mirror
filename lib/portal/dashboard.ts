import "server-only";
import { db } from "@/lib/db";
import { GHI_DANH_DANG_HOC } from "@/lib/portal/trang-thai-ghi-danh";
import { getChildren } from "@/lib/portal/session";
import {
  getStudentAttendanceSummaries,
  getStudentClasses,
} from "@/lib/portal/learning";
import { assignmentWindow } from "@/lib/lms/assignment-window";
import {
  attendanceRatePercent,
  courseProgressPercent,
} from "@/lib/lms/report-card-core";
import { getParentNotificationCount } from "@/lib/portal/notifications";
import { computeEnrollmentDebt, KHOAN_DA_DONG } from "@/lib/finance/debt";
import type { AttendanceSummary } from "@/lib/attendance/summary";

// =============================================================================
// PORTAL DASHBOARD DATA — R7-09 (PR1)
// Data-fetching cho dashboard PH (công nợ + học bù mở + thông báo) và dashboard
// HV (5 chỉ số điểm danh + bài tập x/y). Ownership do caller bảo đảm
// (requireActiveStudent → studentId; parentUserId từ session). KHÔNG nhận
// studentId qua URL — chống regression R4 (đổi profile không trộn data).
// =============================================================================

const ZERO_SUMMARY: AttendanceSummary = {
  total: 0,
  daDienRa: 0,
  attended: 0,
  absent: 0,
  needMakeup: 0,
  madeUp: 0,
};

export type ParentDashboard = {
  /** Σ công nợ các con — CHỈ Payment kế toán CONFIRMED mới trừ vào "đã nộp" (AC1). */
  totalDebt: number;
  /** Ngày đến hạn gần nhất từ OrderInstallment PENDING (ISO) — null nếu không có. */
  nearestDueDate: string | null;
  /** Số yêu cầu học bù đang mở (ParentRequest type=MAKEUP, status=PENDING). */
  openMakeupRequests: number;
  /** Số thông báo gần đây (7 ngày) cho card thông báo. */
  notificationCount: number;
};

/** Dashboard phụ huynh: gộp công nợ + học bù mở + thông báo của tất cả các con. */
export async function getParentDashboard(parentUserId: string): Promise<ParentDashboard> {
  // REQ-08: dùng lại getChildren cached (layout đã gọi trong cùng request) thay vì query
  // Student riêng → bỏ 1 query trùng/portal home. Chỉ cần id.
  const children = await getChildren(parentUserId);
  const childIds = children.map((c) => c.id);

  if (childIds.length === 0) {
    return { totalDebt: 0, nearestDueDate: null, openMakeupRequests: 0, notificationCount: 0 };
  }

  const [enrollments, nearestInstallment, openMakeupRequests, notificationCount] =
    await Promise.all([
      // Công nợ: chỉ ghi danh đã chốt giá (finalPrice/tuition) + Payment CONFIRMED (AC1).
      // FIX-C3: ghi danh/khoản đã xóa mềm không được tính — thiếu là card "Công nợ
      // còn lại" đếm nợ ma, lệch trang Học phí (billing.ts đã lọc).
      db.enrollment.findMany({
        where: { studentId: { in: childIds }, deletedAt: null }, // FIX-C3
        select: {
          status: true,
          finalPrice: true,
          tuition: true,
          payments: {
            where: KHOAN_DA_DONG, // FIX-C3
            select: { amount: true, accountantStatus: true },
          },
        },
      }),
      // Ngày đến hạn gần nhất từ đợt thanh toán CHƯA trả của các đơn của con.
      db.orderInstallment.findFirst({
        where: {
          status: "PENDING",
          dueDate: { not: null },
          order: { studentId: { in: childIds } },
        },
        orderBy: { dueDate: "asc" },
        select: { dueDate: true },
      }),
      db.parentRequest.count({
        where: { studentId: { in: childIds }, type: "MAKEUP", status: "PENDING" },
      }),
      getParentNotificationCount(parentUserId),
    ]);

  const totalDebt = enrollments.reduce((sum, e) => {
    const finalPrice = e.finalPrice ?? e.tuition ?? null;
    if (finalPrice == null) return sum; // ghi danh chưa chốt giá → bỏ qua
    const debt = computeEnrollmentDebt(finalPrice, e.payments, e.status);
    return debt > 0 ? sum + debt : sum; // chỉ cộng phần còn nợ (đóng thừa không trừ)
  }, 0);

  return {
    totalDebt,
    nearestDueDate: nearestInstallment?.dueDate?.toISOString() ?? null,
    openMakeupRequests,
    notificationCount,
  };
}

export type StudentDashboard = {
  /** 5 chỉ số điểm danh GỘP toàn bộ lớp đang học (helper R7-08, không trùng lặp). */
  attendance: AttendanceSummary;
  /** Số lớp đang học (để ẩn block nếu chưa xếp lớp). */
  classCount: number;
  /** Bài tập về nhà: đã hoàn thành / tổng được giao (read-only, không quản lý ở đây). */
  homeworkDone: number;
  homeworkTotal: number;
};

/**
 * Dashboard học viên (con đang chọn). 5 chỉ số dùng lại
 * getStudentAttendanceSummaries (R7-08 — KHÔNG nhân bản logic 5 chỉ số), bài tập
 * x/y đọc HomeworkAssignment theo studentId (read-only).
 */
export async function getStudentDashboard(studentId: string): Promise<StudentDashboard> {
  const [summaries, homework, baiLop] = await Promise.all([
    getStudentAttendanceSummaries(studentId),
    db.homeworkAssignment.findMany({
      where: { studentId },
      select: { status: true },
    }),
    // ⚠️ HAI BẢNG KHÁC NHAU, phải cộng cả hai (06/09).
    // `HomeworkAssignment` là BÀI KIỂM TRA (`examId`) giao về nhà theo buổi.
    // `Assignment` là bài tập giáo viên giao cho LỚP — thứ mà /portal/bai-tap liệt kê.
    // Đo trên DB làm việc: 0 dòng HomeworkAssignment và 176 Assignment ⇒ thẻ "Bài tập"
    // ở trang chủ luôn báo 0/0 trong khi con có bài phải nộp.
    demBaiTapLop(studentId),
  ]);

  const attendance = summaries.reduce<AttendanceSummary>(
    (acc, s) => ({
      total: acc.total + s.total,
      daDienRa: acc.daDienRa + s.daDienRa,
      attended: acc.attended + s.attended,
      absent: acc.absent + s.absent,
      needMakeup: acc.needMakeup + s.needMakeup,
      madeUp: acc.madeUp + s.madeUp,
    }),
    { ...ZERO_SUMMARY },
  );

  const homeworkDone =
    homework.filter((h) => h.status === "SUBMITTED" || h.status === "GRADED").length +
    baiLop.daNop;

  return {
    attendance,
    classCount: summaries.length,
    homeworkDone,
    homeworkTotal: homework.length + baiLop.tong,
  };
}

// ── Portal v2 (merge SataUI) — tổng quan TỪNG con cho dashboard PH mới ──────────
export type ParentChildOverview = {
  id: string;
  name: string;
  studentCode: string | null;
  /** Khoá + lớp đang học (hiển thị dưới tên con, giống SataUI). */
  courseName: string | null;
  className: string | null;
  /** % chuyên cần = có mặt / buổi ĐÃ DIỄN RA (xem `attendanceRatePercent`). */
  attendanceRate: number;
  /** % tiến độ khoá = buổi đã dạy / tổng buổi khoá. CÂU HỎI KHÁC với chuyên cần. */
  courseProgressRate: number;
  attended: number;
  /** Số buổi đã dạy — tử số của tiến độ, MẪU SỐ của chuyên cần. */
  daDienRa: number;
  totalSessions: number;
  needMakeup: number;
  /** Bài tập/bài kiểm tra chưa nộp (ASSIGNED/MISSED). */
  pendingHomework: number;
  /** Công nợ còn lại của con (cùng quy ước getParentDashboard — chỉ Payment CONFIRMED). */
  debt: number;
  /** Buổi học kế tiếp (ISO) — null nếu chưa có lịch. */
  nextSessionDate: string | null;
};

/**
 * Dashboard PH v2 cần dữ liệu THEO TỪNG CON (tiến độ/chuyên cần/bài chờ/công nợ) —
 * getParentDashboard chỉ gộp tổng. Hàm này compose lại từ helper sẵn có
 * (getStudentAttendanceSummaries + computeEnrollmentDebt). Ownership: caller truyền
 * parentUserId từ session (KHÔNG qua URL).
 */
export async function getParentChildrenOverview(
  parentUserId: string,
): Promise<ParentChildOverview[]> {
  // REQ-08/QRY-13: dùng lại getChildren cached (cùng where + order by name; PortalChild
  // đã có id/name/studentCode) → bỏ query Student trùng thứ 3/portal home.
  const children = await getChildren(parentUserId);

  return Promise.all(
    children.map(async (c) => {
      const [summaries, homework, baiLop, enrollments, activeEnr, nextSession] = await Promise.all([
        getStudentAttendanceSummaries(c.id),
        db.homeworkAssignment.findMany({
          where: { studentId: c.id },
          select: { status: true },
        }),
        demBaiTapLop(c.id),
        db.enrollment.findMany({
          where: { studentId: c.id, deletedAt: null }, // FIX-C3 — chống "nợ ma" từ ghi danh xóa mềm
          select: {
            status: true,
            finalPrice: true,
            tuition: true,
            payments: {
              where: KHOAN_DA_DONG, // FIX-C3
              select: { amount: true, accountantStatus: true },
            },
          },
        }),
        db.enrollment.findFirst({
          where: { studentId: c.id, status: { in: [...GHI_DANH_DANG_HOC] }, deletedAt: null }, // FIX-C3
          orderBy: { createdAt: "desc" },
          select: {
            class: { select: { classCode: true } },
            course: { select: { name: true } },
          },
        }),
        db.classSession.findFirst({
          where: {
            class: { enrollments: { some: { studentId: c.id, status: { in: [...GHI_DANH_DANG_HOC] }, deletedAt: null } } }, // FIX-C3
            date: { gte: new Date() },
            status: { not: "CANCELLED" },
          },
          orderBy: { date: "asc" },
          select: { date: true },
        }),
      ]);

      const att = summaries.reduce<AttendanceSummary>(
        (acc, s) => ({
          total: acc.total + s.total,
          daDienRa: acc.daDienRa + s.daDienRa,
          attended: acc.attended + s.attended,
          absent: acc.absent + s.absent,
          needMakeup: acc.needMakeup + s.needMakeup,
          madeUp: acc.madeUp + s.madeUp,
        }),
        { ...ZERO_SUMMARY },
      );

      // Cộng CẢ HAI nguồn — xem chú thích ở `getStudentDashboard`.
      const pendingHomework =
        homework.filter((h) => h.status !== "SUBMITTED" && h.status !== "GRADED").length +
        baiLop.chuaNop;

      const debt = enrollments.reduce((sum, e) => {
        const finalPrice = e.finalPrice ?? e.tuition ?? null;
        if (finalPrice == null) return sum;
        const d = computeEnrollmentDebt(finalPrice, e.payments, e.status);
        return d > 0 ? sum + d : sum;
      }, 0);

      return {
        id: c.id,
        name: c.name,
        studentCode: c.studentCode,
        courseName: activeEnr?.course?.name ?? null,
        className: activeEnr?.class?.classCode ?? null,
        // CÙNG công thức với học bạ và site GV — không chép lại phép chia ở đây nữa.
        attendanceRate: attendanceRatePercent(att),
        courseProgressRate: courseProgressPercent(att),
        attended: att.attended,
        daDienRa: att.daDienRa,
        totalSessions: att.total,
        needMakeup: att.needMakeup,
        pendingHomework,
        debt,
        nextSessionDate: nextSession?.date?.toISOString() ?? null,
      };
    }),
  );
}

/**
 * Bài tập giáo viên giao cho LỚP mà con đang theo — đếm theo đúng luật cửa nộp của
 * `lib/lms/assignment-window.ts`, cùng luật mà cổng nộp bài và site giáo viên dùng.
 *
 * Bài đã ĐÓNG CỬA mà chưa nộp thì không đếm là "chờ nộp" nữa: nhắc phụ huynh làm một
 * việc họ không còn làm được là nhắc sai.
 */
async function demBaiTapLop(
  studentId: string,
): Promise<{ tong: number; daNop: number; chuaNop: number }> {
  const lop = await getStudentClasses(studentId);
  if (lop.length === 0) return { tong: 0, daNop: 0, chuaNop: 0 };
  const rows = await db.assignment.findMany({
    where: {
      classId: { in: lop.map((c) => c.id) },
      status: { in: ["PUBLISHED", "CLOSED"] },
    },
    select: {
      status: true,
      dueAt: true,
      lateUntil: true,
      submissions: { where: { studentId }, select: { status: true }, take: 1 },
    },
  });
  const now = new Date();
  let daNop = 0;
  let chuaNop = 0;
  for (const a of rows) {
    const st = a.submissions[0]?.status ?? "";
    if (st === "SUBMITTED" || st === "GRADED") daNop++;
    else if (assignmentWindow(a, now).acceptsSubmission) chuaNop++;
  }
  return { tong: rows.length, daNop, chuaNop };
}
