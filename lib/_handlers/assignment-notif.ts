// lib/_handlers/assignment-notif.ts — V8.1: thông báo khi GIÁO VIÊN GIAO BÀI TẬP / CHẤM BÀI TẬP (Assignment — LMS lớp offline).
//
//   assignment.assigned  { assignmentId }                         → «Bài tập mới» cho từng học viên ĐANG HỌC của lớp
//   assignment.graded    { assignmentId, studentIds[], gradedAtMs } → «Bài đã được chấm» cho từng học viên vừa được chấm
//
// Ghi vào bảng `Notification` (audience=STUDENT + studentId) — chính nguồn mà chuông phụ huynh của WEB và `GET /notifications` của app đã đọc
// (`getParentNotifications`: STUDENT khớp con của phụ huynh) ⇒ web và mobile thấy CÙNG một thông báo, không có hai nguồn.
//
// ⛔ NỘI DUNG KHÔNG CHỨA ĐIỂM: điểm chỉ hiện khi setting `homework.showScoreToParent` bật (luật của web/app); thông báo chỉ nói «đã chấm».
// ⛔ KHÔNG cộng SataCoin, không gửi push (chưa có FCM/APNs): handler chỉ ghi thông báo trong ứng dụng.
// Idempotent: `dedupeKey` UNIQUE ⇒ dispatcher retry / phát trùng không tạo hai dòng. Cố ý KHÔNG nuốt lỗi DB (để outbox retry).
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";
import { mucBaiTapBaiThiDangHien } from "@/lib/portal/muc-tam-an";
import { GHI_DANH_DANG_HOC } from "@/lib/portal/trang-thai-ghi-danh";

const str = (v: unknown): string => (v == null ? "" : String(v));
const TOI_DA_HOC_VIEN = 500;

export async function onAssignmentAssignedNotif(event: DomainEventLite): Promise<void> {
  if (!mucBaiTapBaiThiDangHien()) return; // V8.24: «Bài tập & bài thi» đang ẩn (PORTAL_BAI_TAP_BAI_THI_ENABLED tắt) ⇒ không báo về thứ không hiện (cùng công tắc với route/menu)
  const assignmentId = str(event.payload.assignmentId);
  if (!assignmentId) return;
  const a = await db.assignment.findUnique({ where: { id: assignmentId }, select: { id: true, title: true, status: true, classId: true, class: { select: { name: true, centerId: true } } } });
  if (!a || a.status !== "PUBLISHED") return; // bản nháp / đã xoá ⇒ không báo
  const hs = await db.enrollment.findMany({
    where: { classId: a.classId, status: { in: [...GHI_DANH_DANG_HOC] }, deletedAt: null },
    select: { studentId: true },
    distinct: ["studentId"],
    take: TOI_DA_HOC_VIEN,
  });
  if (hs.length === 0) return;
  await db.notification.createMany({
    data: hs.map((h) => ({
      title: "Bài tập mới",
      body: `Lớp ${a.class?.name ?? ""} có bài tập mới: ${a.title}`.trim(),
      audience: "STUDENT" as const,
      studentId: h.studentId,
      classId: a.classId,
      centerId: a.class?.centerId ?? null,
      isPublished: true,
      dedupeKey: `assignment.assigned:${a.id}:${h.studentId}`,
    })),
    skipDuplicates: true,
  });
}

export async function onAssignmentGradedNotif(event: DomainEventLite): Promise<void> {
  if (!mucBaiTapBaiThiDangHien()) return;
  const assignmentId = str(event.payload.assignmentId);
  const moc = Number(event.payload.gradedAtMs);
  const ids = Array.isArray(event.payload.studentIds) ? (event.payload.studentIds as unknown[]).map(str).filter(Boolean).slice(0, TOI_DA_HOC_VIEN) : [];
  if (!assignmentId || !Number.isFinite(moc) || ids.length === 0) return;
  const a = await db.assignment.findUnique({ where: { id: assignmentId }, select: { id: true, title: true, classId: true, class: { select: { centerId: true } } } });
  if (!a) return;
  // Chỉ học viên THẬT SỰ có bài chấm của bài này (không tin danh sách trong payload để tạo thông báo cho người lạ).
  const co = await db.assignmentSubmission.findMany({ where: { assignmentId, studentId: { in: ids }, status: "GRADED" }, select: { studentId: true } });
  if (co.length === 0) return;
  await db.notification.createMany({
    data: co.map((s) => ({
      title: "Bài tập đã được chấm",
      body: `Giáo viên đã chấm bài «${a.title}».`,
      audience: "STUDENT" as const,
      studentId: s.studentId,
      classId: a.classId,
      centerId: a.class?.centerId ?? null,
      isPublished: true,
      dedupeKey: `assignment.graded:${a.id}:${s.studentId}:${moc}`,
    })),
    skipDuplicates: true,
  });
}

export function registerAssignmentNotifHandlers(): void {
  on("assignment.assigned", onAssignmentAssignedNotif);
  on("assignment.graded", onAssignmentGradedNotif);
}
