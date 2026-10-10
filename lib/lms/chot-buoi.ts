// lib/lms/chot-buoi.ts — LÕI CHỐT BUỔI, dùng chung admin + site giáo viên (D1, 07/09/2026).
//
// ── Vì sao tách ra ───────────────────────────────────────────────────────────────
//
// Toàn bộ luật này vốn nằm trong `app/(admin)/admin/attendance/_actions.ts`, và cổng
// sở hữu của nó đã ghi rõ *"Chỉ giáo viên phụ trách mới hoàn tất được buổi này"* —
// tức action VỐN được thiết kế cho giáo viên dùng. Chỉ có ĐƯỜNG ĐI là không cho họ
// tới: `decideRoute` đá GV thuần khỏi host admin, và `attendance` không nằm trong
// `TEACHER_ROUTE_SEGMENTS`. Giáo viên bấm vào bị 307 im lặng.
//
// Hệ quả đo trên prod 07/09/2026: 2 buổi COMPLETED / 287 SCHEDULED trong 4 tháng.
//
// D1 mở đường bằng cách MOUNT nút ở site GV (không khoét route-policy, không nới
// permission). Nhưng nếu chép luật sang một action thứ hai thì hai site sẽ trôi khỏi
// nhau — nên luật ở ĐÚNG MỘT chỗ là file này; hai action chỉ còn khác nhau ở
// `revalidatePath`.
//
// ⚠️ HAI QUYẾT ĐỊNH CÓ CHỦ ĐÍCH, chép nguyên từ bản admin — đừng "dọn":
//
// 1. KHÔNG đi qua `completeSessionAction` (classes/[id]/session/_actions.ts). Hàm đó
//    gác sau cờ `SESSION_LIFECYCLE_V2` — cờ TẮT ở cả dev lẫn prod, nên bấm nút chỉ
//    nhận "tính năng chưa được bật". Ở đây gọi thẳng `completeSession` — CÙNG một
//    state machine, không đẻ đường thứ hai đổi `status` bằng tay.
// 2. `assignMode` GIM CỨNG "DEFER". Chủ dự án: "hoàn tất buổi ở đây là hoàn tất điểm
//    danh, nhận xét, ảnh/video — bài tập về nhà không liên quan". Để "NOW" thì event
//    `session.taught` tự tạo HomeworkAssignment và bắn thông báo "Bài tập mới" tới
//    phụ huynh ngay lúc bấm nút. ĐỪNG mở thành tham số cho gọn.
//
// Cổng ba việc được kiểm LẠI Ở SERVER, không tin nút bị disable trên giao diện —
// Server Action là endpoint riêng, POST thẳng vào được.
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { actorGiangDay, passesScope, scopedDb } from "@/lib/db-scope";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { sessionWorkState } from "@/lib/lms/attendance-queue";
import { completeSession } from "@/lib/lms/session-lifecycle";
import {
  buildSessionMediaCoverage,
  isSessionWorkComplete,
  SESSION_MEDIA_SELECT,
  thieuGi,
} from "@/lib/lms/session-order";

export type ChotBuoiKetQua = {
  ok: boolean;
  error?: string;
  /** Buổi vốn đã COMPLETED — bấm lại không phát lại event. */
  alreadyCompleted?: boolean;
  /** Lớp của buổi — để caller `revalidatePath` đúng đường của site mình. */
  classId?: string;
};

/**
 * Chốt một buổi học, có gác đủ: quyền → cách ly cơ sở → sở hữu lớp → chưa huỷ →
 * ba việc đã xong. Caller chỉ cần đưa `sessionId` + `actorUserId` đã xác thực.
 *
 * `actorName` dùng cho AuditLog; caller lấy từ `getAuditActor(session)`.
 */
export async function chotBuoi(input: {
  sessionId: string;
  actorUserId: string;
  actorId: string | null;
  actorName: string;
  /**
   * 28/09 — gọi từ SITE GV thì "giang-day" (cơ sở của lớp mình dạy tính là cơ sở mình,
   * xem `actorGiangDay`); gọi từ admin thì "quan-tri". BẮT BUỘC, không mặc định (luật 7).
   */
  phamVi: "giang-day" | "quan-tri";
}): Promise<ChotBuoiKetQua> {
  if (!(await checkPermission("sessions:edit"))) {
    return { ok: false, error: "Không có quyền hoàn tất buổi" };
  }

  const actorGoc = await resolveActor(input.actorUserId);
  const actor = input.phamVi === "giang-day" ? actorGiangDay(actorGoc) : actorGoc;
  const sdb = scopedDb(actor);

  const sess = await sdb.classSession.findUnique({
    where: { id: input.sessionId },
    select: {
      id: true,
      classId: true,
      status: true,
      centerId: true,
      class: { select: { centerId: true } },
    },
  });
  if (!sess) return { ok: false, error: "Không tìm thấy buổi học" };
  if (
    !passesScope("Class", { centerId: sess.class?.centerId ?? null }, actor)
  ) {
    return { ok: false, error: "Lớp không thuộc cơ sở bạn quản lý" };
  }

  // Ownership: quản lý/HO/SUPER_ADMIN, hoặc GV phụ trách ĐÚNG lớp này — khớp luật của
  // completeSessionAction để hai đường không cho phép hai tập người khác nhau.
  const isManager =
    actor.isSuperAdmin ||
    actor.isHoLevel ||
    actor.orgRoles.some((r) => r.roleCode === "CENTER_MANAGER");
  if (!isManager && !actor.assignedClassIds.has(sess.classId)) {
    return {
      ok: false,
      error: "Chỉ giáo viên phụ trách mới hoàn tất được buổi này",
    };
  }
  if (sess.status === "CANCELLED") {
    return {
      ok: false,
      error: "Buổi đã bị huỷ — không thể hoàn tất",
      classId: sess.classId,
    };
  }

  const [roster, attendanceRows, feedbackRows, mediaRows] = await Promise.all([
    sdb.enrollment.findMany({
      where: {
        classId: sess.classId,
        status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
        deletedAt: null,
        student: { deletedAt: null },
      },
      select: { studentId: true },
    }),
    sdb.attendance.findMany({
      where: { sessionId: input.sessionId },
      select: { studentId: true, status: true },
    }),
    sdb.studentSessionFeedback.findMany({
      where: { classSessionId: input.sessionId },
      select: { studentId: true },
    }),
    // Từng dòng kèm thẻ học viên — luật là mọi em đi học phải có ảnh, đếm gộp không
    // trả lời được câu đó (xem SessionWorkInput.media).
    sdb.classSessionMedia.findMany({
      where: { classSessionId: input.sessionId, status: { not: "REJECTED" } },
      select: SESSION_MEDIA_SELECT,
    }),
  ]);

  const cover = buildSessionMediaCoverage(mediaRows).get(input.sessionId) ?? {
    classWide: false,
    tagged: new Set<string>(),
  };
  const work = sessionWorkState({
    rosterStudentIds: roster.map((r) => r.studentId),
    attendanceRows,
    feedbackStudentIds: feedbackRows.map((f) => f.studentId),
    media: { taggedStudentIds: cover.tagged, hasClassWide: cover.classWide },
  });
  if (!isSessionWorkComplete(work)) {
    return { ok: false, error: thieuGi(work), classId: sess.classId };
  }

  const res = await completeSession({
    sessionId: input.sessionId,
    // Đã kiểm điểm danh ĐỦ CẢ LỚP ở trên — chặt hơn hẳn cảnh báo "chưa có bản ghi nào"
    // của lifecycle, nên không cần hỏi lại người dùng.
    confirmNoAttendance: true,
    assignMode: "DEFER", // xem ghi chú (2) ở đầu file
    nguonChot: "TAY", // nút "Chốt buổi" — có người bấm
    actorId: input.actorId,
    actorName: input.actorName,
  });
  if (!res.ok) {
    return {
      ok: false,
      error: res.error ?? "Hoàn tất buổi thất bại",
      classId: sess.classId,
    };
  }
  return {
    ok: true,
    alreadyCompleted: res.alreadyCompleted,
    classId: sess.classId,
  };
}
