// lib/_handlers/r7-lifecycle.ts — R7-07: consumer cho DomainEvent vòng đời lớp/buổi.
//   • enrollment.assigned → notify PH (lịch + tiến độ con đã có khi enrollment trỏ lớp).
//   • session.taught      → consumer tối thiểu (StaffNotification cho GV). R7-14 sẽ
//     thay/bổ sung handler auto giao bài + sinh tiến độ. Tất cả idempotent (dedupeKey).
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";
import { notifyStaff } from "@/lib/notifications/notify";

const str = (v: unknown): string => (v == null ? "" : String(v));

// ─── enrollment.assigned → PH thấy con đã được xếp lớp (AC3 R7-07) ────────────
export async function onEnrollmentAssigned(event: DomainEventLite): Promise<void> {
  const enrollmentId = str(event.payload.enrollmentId);
  const classId = str(event.payload.classId);
  if (!enrollmentId || !classId) return;

  const enr = await db.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      studentId: true,
      student: { select: { name: true, centerId: true } },
      class: { select: { name: true } },
    },
  });
  if (!enr?.studentId) return;

  // Lịch học + tiến độ hiển thị qua portal NGAY khi enrollment trỏ lớp (đọc
  // ClassSession của lớp) → không phải sinh bảng tiến độ riêng; chỉ cần báo PH.
  const body =
    `Con ${enr.student?.name ?? ""} đã được xếp vào lớp ${enr.class?.name ?? ""}. ` +
    `Lịch học đã hiển thị trong cổng phụ huynh.`;
  await db.notification.upsert({
    where: { dedupeKey: `enrollment.assigned:${enrollmentId}:${classId}` },
    create: {
      title: "Đã xếp lớp",
      body,
      audience: "STUDENT",
      studentId: enr.studentId,
      classId,
      centerId: enr.student?.centerId ?? null,
      createdByName: "Hệ thống",
      dedupeKey: `enrollment.assigned:${enrollmentId}:${classId}`,
    },
    update: { body },
  });
}

// ─── session.taught → GV thấy buổi đã hoàn tất (consumer tối thiểu; R7-14 mở rộng) ──
export async function onSessionTaught(event: DomainEventLite): Promise<void> {
  const sessionId = str(event.payload.sessionId);
  if (!sessionId) return;

  const session = await db.classSession.findUnique({
    where: { id: sessionId },
    select: {
      actualTeacherId: true,
      class: { select: { name: true, teacherId: true } },
    },
  });
  if (!session) return;

  const teacherId = session.actualTeacherId ?? session.class?.teacherId;
  if (!teacherId) return; // R7-14 sẽ xử lý giao bài/tiến độ kể cả khi chưa có GV.

  // Đường ADMIN clean-URL (không tiền tố /admin) — quy ước chung của `href`:
  // chuông admin push thẳng, chuông site GV đổi qua `teacherHref()` (/sessions/* → /lich).
  // Trỏ ĐÍCH DANH buổi (`/sessions/<id>` có page thật) thay vì danh sách, vì thông báo
  // nói về đúng một buổi — bắt GV tự dò lại trong danh sách là bỏ phí thông tin đã có.
  const href = `/sessions/${sessionId}`;

  // `notifyStaff` ghi href ở CẢ create lẫn update — đúng thứ cần để chữa bản ghi sinh trước
  // bản vá href (chúng có `href = null`, thành text chết, và dedupeKey không đổi nên nhánh
  // create không bao giờ chạy lại). Không `reopen`: đây không phải tin mới.
  await notifyStaff({
    userIds: [teacherId],
    dedupeKey: `session.taught:${sessionId}`,
    category: "CLASS",
    title: "Buổi học đã hoàn tất",
    body: `Buổi của lớp ${session.class?.name ?? ""} đã được đánh dấu hoàn tất.`,
    href,
    entityId: sessionId,
  });
}

export function registerR7LifecycleHandlers(): void {
  on("enrollment.assigned", onEnrollmentAssigned);
  on("session.taught", onSessionTaught);
}
