// lib/_handlers/comment-notif.ts — R7-17: consumer cho DomainEvent "comment.added".
// Khi GV lưu 1 nhận xét per-HV cho 1 buổi học (StudentSessionFeedback —
// app/(admin)/admin/sessions/[id]/_actions.ts saveSessionFeedback), PH của HV đó
// nhận 1 Notification (audience STUDENT) trong sổ liên lạc điện tử (portal feed).
// KHÁC classComment (nhận xét chung cả lớp) — đây là nhận xét RIÊNG từng HV.
// Idempotent: dedupeKey ổn định theo commentId (StudentSessionFeedback.id) →
// sửa nhận xét (upsert cùng dòng) không tạo thông báo trùng; replay không nhân đôi.
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";

const str = (v: unknown): string => (v == null ? "" : String(v));

export async function onCommentAdded(event: DomainEventLite): Promise<void> {
  const studentId = str(event.payload.studentId);
  if (!studentId) return;

  // centerId resolve từ student (payload không mang centerId).
  const student = await db.student.findUnique({
    where: { id: studentId },
    select: { centerId: true },
  });
  if (!student) return;

  const commentId = str(event.payload.commentId);
  const dedupeKey = commentId ? `comment.added:${commentId}` : `comment.added:${event.id}`;
  const body = "Giáo viên vừa gửi nhận xét mới cho học viên. Vui lòng xem trong sổ liên lạc.";

  await db.notification.upsert({
    where: { dedupeKey },
    create: {
      title: "Nhận xét mới từ giáo viên",
      body,
      audience: "STUDENT",
      studentId,
      centerId: student.centerId,
      createdByName: "Hệ thống",
      dedupeKey,
    },
    update: { body },
  });
}

export function registerCommentNotifHandlers(): void {
  on("comment.added", onCommentAdded);
}
