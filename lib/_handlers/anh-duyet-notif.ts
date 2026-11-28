// lib/_handlers/anh-duyet-notif.ts — V8.5: thông báo «Có ảnh mới» khi QUẢN LÝ DUYỆT một ảnh buổi học (media.approved).
//
//   media.approved { mediaId } → Notification (audience=STUDENT, studentId) cho TỪNG học viên ĐƯỢC THẤY ảnh đó:
//     · ảnh gắn THẺ học viên, HOẶC «ảnh chung cả lớp» với học viên ĐANG HỌC của lớp;
//     · VÀ học viên có đồng ý ảnh GRANTED (không đồng ý ⇒ KHÔNG báo — kể cả không lộ rằng lớp có ảnh);
//     · VÀ ảnh thật sự đang APPROVED (không tin payload).
// Cùng bảng `Notification` mà chuông phụ huynh web + `GET /notifications` đã đọc; học sinh thấy ở `students/:id/notifications` (tiền tố `media.approved:` thuộc danh sách cho phép).
// Nội dung KHÔNG chứa tên tệp/chú thích/URL. Không push. Idempotent: dedupeKey UNIQUE (ảnh × học viên × mốc duyệt).
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";
import { GHI_DANH_DANG_HOC } from "@/lib/portal/trang-thai-ghi-danh";

const str = (v: unknown): string => (v == null ? "" : String(v));
const TOI_DA = 500;

export async function onMediaApprovedNotif(event: DomainEventLite): Promise<void> {
  const mediaId = str(event.payload.mediaId);
  if (!mediaId) return;
  const m = await db.classSessionMedia.findUnique({ where: { id: mediaId }, select: { id: true, status: true, classId: true, isClassWide: true, approvedAt: true, tags: { select: { studentId: true } } } });
  if (!m || m.status !== "APPROVED" || !m.approvedAt) return;
  const lop = await db.class.findUnique({ where: { id: m.classId }, select: { name: true, centerId: true } });
  const dangHoc = await db.enrollment.findMany({ where: { classId: m.classId, status: { in: [...GHI_DANH_DANG_HOC] }, deletedAt: null }, select: { studentId: true }, distinct: ["studentId"], take: TOI_DA });
  const hocLop = new Set(dangHoc.map((e) => e.studentId));
  const duocThay = new Set<string>(m.tags.map((t) => t.studentId));
  if (m.isClassWide) for (const s of hocLop) duocThay.add(s);
  if (duocThay.size === 0) return;
  const dongY = await db.studentConsent.findMany({ where: { studentId: { in: [...duocThay] }, type: "CLASS_MEDIA", status: "GRANTED" }, select: { studentId: true } });
  if (dongY.length === 0) return;
  await db.notification.createMany({
    data: dongY.map((c) => ({
      title: "Có ảnh mới",
      body: `Lớp ${lop?.name ?? ""} vừa có ảnh buổi học mới. Ba mẹ xem trong mục Hình ảnh.`.replace("  ", " "),
      audience: "STUDENT" as const,
      studentId: c.studentId,
      classId: m.classId,
      centerId: lop?.centerId ?? null,
      isPublished: true,
      dedupeKey: `media.approved:${m.id}:${c.studentId}:${m.approvedAt!.getTime()}`,
    })),
    skipDuplicates: true,
  });
}

export function registerAnhDuyetNotifHandlers(): void {
  on("media.approved", onMediaApprovedNotif);
}
