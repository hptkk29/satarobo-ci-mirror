import "server-only";
import { db } from "@/lib/db";
import { getModelVisibleCenterIds } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { sessionTimeRange } from "@/lib/classes/slots";
import { GHI_DANH_DANG_HOC } from "@/lib/portal/trang-thai-ghi-danh";
import { vnYmd } from "@/lib/time/vn";
import type { CalEvent } from "@/components/lms/month-calendar";

// Truy vấn buổi cho lịch (server-only — page admin/portal gọi qua đây, không import db trần).
//
// ─────────────────────────────────────────────────────────────────────────────
// 06/09/2026 — ba thứ phải sửa cùng lúc ở đây
//
// 1. **Ngày của ô lịch phải là ngày VIỆT NAM.** `dayKey` cũ đọc `getFullYear/getMonth/
//    getDate` của TIẾN TRÌNH. Ô lưới tháng là ngày lịch thuần nên không sao, nhưng
//    `ClassSession.date` là một MỐC THỜI GIAN: trên Vercel (UTC) một buổi 00:30 giờ VN
//    bị chấm vào ngày HÔM TRƯỚC. Nay dùng `vnYmd`.
//
// 2. **Giờ in trên ô lấy từ CHÍNH BUỔI.** `class.startTime` chỉ là bản sao của giai đoạn
//    lịch đang hiệu lực (Kế hoạch lịch học nhiều giai đoạn) — lớp đổi ca giữa khoá thì
//    mọi buổi cũ lẫn mới đều hiện giờ của giai đoạn hiện tại. Dùng `sessionTimeRange`,
//    đúng như lib/portal/schedule.ts và learning.ts đã làm.
//
// 3. **Lịch của học viên phải lọc trạng thái ghi danh.** Truy vấn cũ lấy MỌI ghi danh
//    của con — không `status`, không `deletedAt` — nên lịch tháng vẫn chấm đầy buổi của
//    lớp đã chuyển đi/đã rút/đã xoá mềm, trong khi khối "Đã học x/y" ngay bên cạnh (đi
//    qua getStudentClasses) báo 0/0. Hai khối cạnh nhau, hai định nghĩa "lớp của con".
// ─────────────────────────────────────────────────────────────────────────────

/** Buổi trong [from,to) thuộc cơ sở actor nhìn thấy (admin). */
export async function getAdminCalendarEvents(actor: Actor, from: Date, to: Date): Promise<CalEvent[]> {
  // Vá 24/07 — per-model scope thay isHoLevel trần: role HO chỉ nhìn xuyên cơ sở khi
  // CÓ quyền sessions:/classes: scope ALL (SUPER_ADMIN luôn ALL). HO-role khác chức
  // năng (vd TRAINING@HO sau lock 24/07) → lịch chỉ cơ sở mình.
  const scope = getModelVisibleCenterIds("ClassSession", actor);
  const cw = scope === "ALL" ? undefined : { in: scope };
  const sessions = await db.classSession.findMany({
    where: { date: { gte: from, lt: to }, status: { not: "CANCELLED" }, ...(cw ? { class: { centerId: cw } } : {}) },
    select: { date: true, class: { select: { name: true, startTime: true, endTime: true } } },
    take: 2000,
  });
  return sessions.map((s) => ({
    iso: vnYmd(s.date),
    label: s.class?.name ?? "Lớp",
    sublabel: sessionTimeRange(s.date, s.class?.startTime, s.class?.endTime).start,
  }));
}

/** Buổi của 1 học viên trong [from,to) (portal — ownership-scoped theo studentId). */
export async function getStudentCalendarEvents(studentId: string, from: Date, to: Date): Promise<CalEvent[]> {
  const enrollments = await db.enrollment.findMany({
    // CÙNG định nghĩa "lớp của con" với getStudentClasses (lib/portal/learning.ts).
    where: {
      studentId,
      status: { in: [...GHI_DANH_DANG_HOC] },
      deletedAt: null,
    },
    select: { classId: true },
  });
  const classIds = enrollments.map((e) => e.classId);
  if (classIds.length === 0) return [];
  const sessions = await db.classSession.findMany({
    where: { classId: { in: classIds }, date: { gte: from, lt: to }, status: { not: "CANCELLED" } },
    select: { date: true, class: { select: { name: true, startTime: true, endTime: true } } },
    take: 500,
  });
  return sessions.map((s) => ({
    iso: vnYmd(s.date),
    label: s.class?.name ?? "Buổi học",
    sublabel: sessionTimeRange(s.date, s.class?.startTime, s.class?.endTime).start,
  }));
}
