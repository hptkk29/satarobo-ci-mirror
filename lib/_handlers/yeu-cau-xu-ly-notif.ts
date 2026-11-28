// lib/_handlers/yeu-cau-xu-ly-notif.ts — V8.2: thông báo cho PHỤ HUYNH khi nhân viên XỬ LÝ một yêu cầu (ParentRequest) — duyệt / từ chối.
//
//   parent_request.handled { requestId }  → «Yêu cầu đã được xử lý» (Notification audience=STUDENT, studentId = học viên của yêu cầu)
//
// Cùng bảng `Notification` mà chuông phụ huynh của WEB và `GET /notifications` của app đã đọc ⇒ web và mobile thấy CÙNG một thông báo.
// Chỉ báo khi yêu cầu THẬT SỰ đã có quyết định (APPROVED/REJECTED + handledAt) — không tin payload; `CANCELLED` (phụ huynh tự rút) và `PENDING` không báo.
// Nội dung KHÔNG chứa lời phản hồi của nhân viên (phụ huynh đọc ở mục Yêu cầu); không push; không SataCoin.
// Idempotent: dedupeKey UNIQUE theo (yêu cầu, mốc xử lý) — retry/phát trùng không tạo hai dòng; xử lý lại lần nữa (mốc mới) ⇒ thông báo mới.
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";

const str = (v: unknown): string => (v == null ? "" : String(v));
const NHAN_LOAI: Record<string, string> = {
  ABSENCE: "xin nghỉ",
  MAKEUP: "học bù",
  TRANSFER_CLASS: "chuyển lớp",
  TRANSFER_CENTER: "chuyển cơ sở",
  RESERVE: "bảo lưu",
  CONSENT_CHANGE: "đồng ý hình ảnh",
  OTHER: "khác",
};

export async function onParentRequestHandledNotif(event: DomainEventLite): Promise<void> {
  const requestId = str(event.payload.requestId);
  if (!requestId) return;
  const r = await db.parentRequest.findUnique({ where: { id: requestId }, select: { id: true, studentId: true, type: true, status: true, handledAt: true, student: { select: { centerId: true } } } });
  if (!r || !r.handledAt || (r.status !== "APPROVED" && r.status !== "REJECTED")) return;
  const ketQua = r.status === "APPROVED" ? "đã được duyệt" : "chưa được duyệt";
  await db.notification.createMany({
    data: [
      {
        title: "Yêu cầu đã được xử lý",
        body: `Yêu cầu ${NHAN_LOAI[r.type] ?? ""} của ba mẹ ${ketQua}. Xem chi tiết trong mục Yêu cầu.`.replace("  ", " "),
        audience: "STUDENT" as const,
        studentId: r.studentId,
        centerId: r.student?.centerId ?? null,
        isPublished: true,
        dedupeKey: `parent_request.handled:${r.id}:${r.handledAt.getTime()}`,
      },
    ],
    skipDuplicates: true,
  });
}

export function registerYeuCauXuLyNotifHandlers(): void {
  on("parent_request.handled", onParentRequestHandledNotif);
}
