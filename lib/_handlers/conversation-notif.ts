// lib/_handlers/conversation-notif.ts — LMS-15: consumer cho DomainEvent
// "conversation.message_posted" (nhắn 2 chiều PH↔GV theo enrollment).
// authorSide=PARENT → báo GV chính + trợ giảng của lớp (StaffNotification inbox).
// authorSide=STAFF  → báo PH của HV (Notification audience STUDENT — portal feed),
// theo đúng mẫu lib/_handlers/comment-notif.ts. Idempotent qua dedupeKey theo messageId.
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";
import { notifyStaff } from "@/lib/notifications/notify";

const str = (v: unknown): string => (v == null ? "" : String(v));

/**
 * Deep-link chuông cho tin của phụ huynh: hội thoại NHÓM LỚP của lớp chứa enrollment.
 *
 * Vì sao là nhóm lớp chứ không phải luồng-theo-enrollment: màn `/tin-nhan` đã chuyển sang
 * hệ chat mới và định danh hội thoại bằng `c=<conversationId>` — nó KHÔNG đọc param `e`.
 * Hệ mới cũng không có hội thoại theo enrollment; ánh xạ chính thức của luồng PH↔GV cũ là
 * `CLASS_GROUP` của `enrollment.classId` (luật ánh xạ ở `lib/chat/migrate-legacy.ts`).
 * Giữ `?e=<enrollmentId>` nghĩa là bấm chuông rơi vào hộp thư rỗng — đúng thứ đang xảy ra.
 *
 * Lớp chưa/không còn ACTIVE thì chưa chắc có nhóm (BR-01 — `syncConversationMembership`
 * chỉ dựng nhóm cho lớp ACTIVE). Khi đó trả `/tin-nhan` TRẦN: mở đúng hộp thư vẫn hơn là
 * mang theo một param chết mà trang không hiểu.
 */
async function hoiThoaiNhomLop(
  classId: string,
): Promise<{ href: string; conversationId: string | null }> {
  const conv = await db.conversation.findUnique({
    where: {
      type_subjectType_subjectId: {
        type: "CLASS_GROUP",
        subjectType: "CLASS",
        subjectId: classId,
      },
    },
    select: { id: true },
  });
  // Trả kèm id vì thông báo còn cần `entityId` (thu hồi khi hội thoại bị xoá), không chỉ href.
  return conv
    ? { href: `/tin-nhan?c=${conv.id}`, conversationId: conv.id }
    : { href: "/tin-nhan", conversationId: null };
}

export async function onConversationMessagePosted(event: DomainEventLite): Promise<void> {
  const enrollmentId = str(event.payload.enrollmentId);
  const messageId = str(event.payload.messageId);
  const authorSide = str(event.payload.authorSide);
  if (!enrollmentId || !messageId) return;

  const enr = await db.enrollment.findFirst({
    where: { id: enrollmentId, deletedAt: null },
    select: {
      // classId để tra hội thoại nhóm lớp dựng deep-link — xem `hrefHoiThoaiNhomLop`.
      classId: true,
      studentId: true,
      student: { select: { name: true, centerId: true } },
      class: { select: { name: true, teacherId: true, assistantId: true } },
    },
  });
  if (!enr) return;

  const dedupeKey = `conversation.message_posted:${messageId}`;
  const className = enr.class?.name ?? "lớp";
  const studentName = enr.student?.name ?? "học viên";

  if (authorSide === "PARENT") {
    // PH gửi → báo GV chính + trợ giảng phụ trách lớp (StaffNotification inbox).
    const staffIds = [...new Set(
      [enr.class?.teacherId, enr.class?.assistantId].filter(
        (x): x is string => !!x,
      ),
    )];
    // Không có người nhận thì đừng tốn một vòng tra hội thoại.
    if (staffIds.length === 0) return;
    const { href, conversationId } = await hoiThoaiNhomLop(enr.classId);
    // MỘT lời gọi cho cả GV chính lẫn trợ giảng: fan-out realtime gộp thành một lô, thay vì
    // một lượt phát cho mỗi người. Không `reopen` — event phát lại không phải tin nhắn mới,
    // nên `readAt`/`seenAt` phải giữ nguyên. Ngược lại, href ĐƯỢC ghi lại ở nhánh update:
    // đó là đường duy nhất chữa các dòng cũ trên prod còn mang href `?e=` chết.
    await notifyStaff({
      userIds: staffIds,
      dedupeKey,
      category: "CLASS",
      title: "Tin nhắn mới từ phụ huynh",
      body: `Phụ huynh ${studentName} (lớp ${className}) vừa gửi một tin nhắn.`,
      href,
      entityId: conversationId,
    });
    return;
  }

  if (authorSide === "STAFF") {
    // GV trả lời → báo PH của HV (Notification audience STUDENT — portal feed).
    if (!enr.studentId) return;
    await db.notification.upsert({
      where: { dedupeKey },
      create: {
        title: "Tin nhắn mới từ giáo viên",
        body: `Giáo viên lớp ${className} vừa gửi tin nhắn. Vui lòng xem trong mục Tin nhắn.`,
        audience: "STUDENT",
        studentId: enr.studentId,
        centerId: enr.student?.centerId ?? null,
        createdByName: "Hệ thống",
        dedupeKey,
      },
      update: {},
    });
  }
}

export function registerConversationNotifHandlers(): void {
  on("conversation.message_posted", onConversationMessagePosted);
}
