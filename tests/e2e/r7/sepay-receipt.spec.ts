/**
 * SEPAY-RECEIPT — webhook SePay phải gửi BIÊN NHẬN như đường xác nhận tay.
 *
 * Trước bản vá 03/08, webhook chỉ gọi `ensureParentAccountForOrder` rồi im: khách
 * chuyển khoản tự động không nhận email lẫn ZNS nào, trong khi khách thu tay thì có
 * (`changeOrderStatusAction` bắn PAYMENT_RECEIPT + `notifyOrderByZnsIfNoEmail`).
 *
 * Test ở tầng service (không dựng HTTP): route handler chỉ là wrapper quanh đúng 2
 * hàm dưới đây — `sendEmailForTrigger` và `notifyOrderByZnsIfNoEmail`.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { sendEmailForTrigger } from "../../../lib/email/trigger";
import { notifyOrderByZnsIfNoEmail } from "../../../lib/notify/order";

test.describe("[SEPAY-RECEIPT] biên nhận sau khi tiền về", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  let seq = 0;
  const uniq = () => `${Date.now().toString(36)}-${seq++}`;

  async function seedOrder(opts: { email: string | null; phone: string }) {
    const center = await db.center.create({
      data: { code: `CS${seq}`, name: "CS test", slug: `cs-${uniq()}`, address: "x" },
    });
    return db.order.create({
      data: {
        code: `ORD-${uniq()}`,
        type: "COURSE",
        status: "CONFIRMED",
        customerName: "Phụ huynh Test",
        customerPhone: opts.phone,
        customerEmail: opts.email,
        centerId: center.id,
        subtotal: 5_000_000,
        totalAmount: 5_000_000,
        paidAt: new Date(),
      },
      select: { id: true, code: true, customerEmail: true, customerName: true, totalAmount: true, paidAt: true },
    });
  }

  async function seedReceiptTemplate() {
    return db.emailTemplate.create({
      data: {
        code: `PAYMENT_RECEIPT_${uniq()}`,
        name: "Biên nhận thanh toán",
        trigger: "PAYMENT_RECEIPT",
        subject: "Biên nhận đơn {{order_code}}",
        bodyText: "Chào {{customer_name}}, đã nhận {{total_amount}}đ cho đơn {{order_code}}.",
        bodyHtml: "<p>Chào {{customer_name}}</p>",
        isActive: true,
      },
    });
  }

  test("[SEPAY-RECEIPT-01] khách CÓ email → email biên nhận vào hàng đợi/log, biến được thay đúng", async () => {
    await seedReceiptTemplate();
    const order = await seedOrder({ email: "ph.test@example.com", phone: "0905000101" });

    const res = await sendEmailForTrigger({
      trigger: "PAYMENT_RECEIPT",
      recipient: { email: order.customerEmail, name: order.customerName },
      vars: {
        customer_name: order.customerName,
        order_code: order.code,
        total_amount: order.totalAmount,
        payment_method: "Chuyển khoản (SePay)",
        paid_at: order.paidAt ?? new Date(),
      },
      context: { type: "Order", id: order.id },
      triggerType: "SYSTEM",
      actor: { userId: null, name: "SePay webhook" },
    });

    // Trên môi trường test không có RESEND_API_KEY nên khâu GỬI của nhà cung cấp
    // luôn hỏng — điều cần chốt là đường đi tới được tầng gửi với người nhận +
    // template hợp lệ (2 lý do bỏ qua dưới đây mới là hỏng thật), và EmailLog có
    // bản ghi với biến đã render.
    if (!res.ok) {
      expect(res.skipped).not.toBe("no_recipient_email");
      expect(res.skipped).not.toBe("no_active_template");
    }
    const log = await db.emailLog.findFirst({
      where: { contextType: "Order", contextId: order.id },
      orderBy: { createdAt: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log!.toEmail).toBe("ph.test@example.com");
    expect(log!.subject).toContain(order.code); // {{order_code}} đã render
    expect(log!.triggeredByName).toBe("SePay webhook");
  });

  test("[SEPAY-RECEIPT-02] khách KHÔNG email → đường email tự bỏ qua, ZNS học phí chạy và ghi log", async () => {
    await seedReceiptTemplate();
    const order = await seedOrder({ email: null, phone: "0905000102" });

    // Đường email: không có người nhận → skip có lý do rõ (không ném lỗi).
    const emailRes = await sendEmailForTrigger({
      trigger: "PAYMENT_RECEIPT",
      recipient: { email: order.customerEmail, name: order.customerName },
      vars: { customer_name: order.customerName, order_code: order.code },
      context: { type: "Order", id: order.id },
      triggerType: "SYSTEM",
    });
    expect(emailRes).toEqual({ ok: false, skipped: "no_recipient_email" });

    // Đường ZNS: phải có dấu vết gửi (SKIPPED khi chưa cấu hình Zalo trên môi
    // trường test — điều cần chốt là CÓ ĐI QUA, trước đây webhook không gọi gì).
    await notifyOrderByZnsIfNoEmail(order.id);
    const zaloLog = await db.zaloMessageLog.findFirst({
      where: { toPhone: { contains: "905000102" } },
      orderBy: { createdAt: "desc" },
    });
    expect(zaloLog).not.toBeNull();
  });

  test("[SEPAY-RECEIPT-03] khách CÓ email → KHÔNG gửi ZNS trùng", async () => {
    const order = await seedOrder({ email: "ph.co.email@example.com", phone: "0905000103" });

    await notifyOrderByZnsIfNoEmail(order.id);

    const zaloLog = await db.zaloMessageLog.findFirst({
      where: { toPhone: { contains: "905000103" } },
    });
    expect(zaloLog).toBeNull(); // email lo phần biên nhận, ZNS im lặng
  });
});
