import "server-only";
import { sumRecorded } from "@/lib/finance/ghi-nhan";
import { db } from "@/lib/db";
import { sendZaloNotification } from "@/lib/zalo/service";
import { buildTuitionZnsParams } from "@/lib/zalo/templates";

// =============================================================================
// AUTH-SĐT P5 — thông báo đơn hàng cho khách KHÔNG có email.
//
// Trước P5 `customerEmail` là bắt buộc nên `sendEmailForTrigger` luôn có người
// nhận. Nay email tuỳ chọn, mà hàm đó gặp email rỗng thì trả
// `{skipped:"no_recipient_email"}` — tức khách chỉ có SĐT sẽ **không nhận được
// gì và không ai biết**. Đường này bịt đúng khoảng đó.
//
// CỐ Ý chỉ chạy khi KHÔNG có email: khách có email vẫn nhận đúng bản email dựng
// từ `EmailTemplate` (nội dung phong phú hơn, admin sửa được ở /email-templates).
// Gửi cả hai là gửi trùng.
//
// ⚠️ TÊN THAM SỐ LÀ HỢP ĐỒNG VỚI MẪU ĐÃ DUYỆT — bài học PR #77. Mẫu học phí đã
// duyệt là `616258` với đúng 6 tham số `date/phone/course/total_course_fee/
// paid_fee/studentName`; bộ này do `buildTuitionZnsParams` dựng và có test bất
// biến canh. Chưa đặt env `ZALO_ZNS_TEMPLATE_PAYMENT` → `sendZaloNotification`
// tự SKIPPED, không lỗi, không tốn tin.
//
// Nhận `orderId` thay vì bộ trường rời: mẫu đòi tên học viên, tên khoá và số
// tiền ĐÃ ĐÓNG — những thứ nơi gọi không cầm sẵn. Đọc một lần tại đây bảo đảm
// mọi đường (tạo đơn, xác nhận tay, webhook SePay) gửi cùng một nội dung.
// =============================================================================

const ZNS_TEMPLATE_PAYMENT = process.env.ZALO_ZNS_TEMPLATE_PAYMENT || null;

/**
 * Gửi ZNS mẫu học phí cho một đơn tới `phone`. KHÔNG tự quyết định có nên gửi —
 * nơi gọi chịu trách nhiệm phần đó (xem `notifyOrderByZnsIfNoEmail`).
 * Best-effort: nuốt lỗi, không chặn luồng tiền.
 */
export async function sendTuitionZnsForOrder(orderId: string, phone: string): Promise<void> {
  const order = await db.order
    .findUnique({
      where: { id: orderId },
      select: {
        customerName: true,
        totalAmount: true,
        createdAt: true,
        paidAt: true,
        student: { select: { name: true } },
        items: { select: { itemName: true }, orderBy: { createdAt: "asc" }, take: 1 },
      },
    })
    .catch(() => null);
  if (!order) return;

  // "Đã đóng" = tổng phiếu thu còn hiệu lực của đơn, KHÔNG phải tổng đơn: đơn
  // trả góp lúc mới tạo là 0đ, xác nhận đợt 1 thì mới bằng số đã thu thật.
  const paid = await sumRecorded(orderId).catch(() => 0);

  await sendZaloNotification({
    toPhone: phone,
    templateKey: ZNS_TEMPLATE_PAYMENT,
    params: buildTuitionZnsParams({
      at: order.paidAt ?? order.createdAt,
      phone,
      courseName: order.items[0]?.itemName ?? null,
      totalFee: order.totalAmount,
      paidFee: paid,
      studentName: order.student?.name ?? order.customerName,
    }),
    fallbackEmail: null, // không có email — đó chính là lý do vào đường này
  }).catch(() => {});
}

/**
 * Gửi ZNS xác nhận học phí khi khách KHÔNG có email. Best-effort: nuốt lỗi,
 * không chặn luồng tiền (giống mọi đường thông báo khác).
 */
export async function notifyOrderByZnsIfNoEmail(orderId: string): Promise<void> {
  const gate = await db.order
    .findUnique({
      where: { id: orderId },
      select: { customerEmail: true, customerPhone: true },
    })
    .catch(() => null);
  if (!gate) return;

  if (gate.customerEmail?.trim()) return; // đã có email → email lo, không gửi trùng
  const phone = gate.customerPhone?.trim();
  if (!phone) return;

  await sendTuitionZnsForOrder(orderId, phone);
}
