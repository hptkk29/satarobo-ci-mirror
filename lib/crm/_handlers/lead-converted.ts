// lib/crm/_handlers/lead-converted.ts — R2 C2.5: side-effect SAU convert (không trong transaction).
// Handler cho DomainEvent `lead.converted`: gửi email xác nhận đăng ký + mời kích hoạt
// tài khoản phụ huynh (hàng đợi email — fallback an toàn nếu chưa cấu hình Resend).
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";
import { enqueueEnrollmentConfirmation } from "@/lib/email/triggers";
import { sendTuitionZnsForOrder } from "@/lib/notify/order";

// AUTH-SĐT P5 — mẫu ZNS xác nhận ghi danh dùng chung mẫu học phí đã duyệt
// (616258) với thông báo đơn hàng; chưa đặt env → SKIPPED an toàn.
// ⚠️ Tên tham số phải khớp mẫu đã duyệt (bài học PR #77) — vì vậy đi qua
// `sendTuitionZnsForOrder` chứ không tự dựng params tại đây.

export async function onLeadConverted(event: DomainEventLite): Promise<void> {
  const parentUserId = String(event.payload.parentUserId ?? "");
  const studentId = String(event.payload.studentId ?? "");
  if (!parentUserId || !studentId) return;

  const [parent, student, enrollment] = await Promise.all([
    db.user.findUnique({
      where: { id: parentUserId },
      select: { email: true, phone: true, name: true },
    }),
    db.student.findUnique({ where: { id: studentId }, select: { name: true, studentCode: true } }),
    db.enrollment.findFirst({
      where: { studentId, deletedAt: null }, // FIX-C3
      orderBy: { createdAt: "desc" },
      select: { class: { select: { name: true } }, course: { select: { name: true } } },
    }),
  ]);

  if (!parent || !student) return;

  const className = enrollment?.class?.name ?? "—";
  const courseName = enrollment?.course?.name ?? "—";

  if (parent.email) {
    await enqueueEnrollmentConfirmation({
      to: parent.email,
      parentName: parent.name,
      studentName: student.name,
      studentCode: student.studentCode,
      className,
      courseName,
    });
    return;
  }

  // AUTH-SĐT P5 — trước đây nhánh này `return` trống: phụ huynh không có email
  // thì **im lặng mất** email xác nhận ghi danh. Hôm qua đó là ngoại lệ hiếm;
  // sau P5 (email không bắt buộc) nó thành trường hợp PHỔ BIẾN, nên phải có
  // đường thay thế chứ không được bỏ qua.
  if (!parent.phone) {
    console.warn(
      `[lead.converted] phụ huynh ${parentUserId} không có cả email lẫn SĐT — không gửi được xác nhận ghi danh.`,
    );
    return;
  }

  // Mẫu 616258 đòi số tiền + tên học viên lấy từ ĐƠN, không dựng tay được từ
  // event. Không thấy đơn thì im lặng còn hơn gửi tin sai tham số (Zalo trả
  // -1122, tin không tới mà chỗ này vẫn "thành công" vì nuốt lỗi).
  const order = await db.order.findFirst({
    where: { studentId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!order) {
    console.warn(
      `[lead.converted] học viên ${studentId} không có đơn nào — bỏ qua ZNS xác nhận ghi danh.`,
    );
    return;
  }
  await sendTuitionZnsForOrder(order.id, parent.phone);
}

export function registerLeadConvertedHandlers(): void {
  on("lead.converted", onLeadConverted);
}
