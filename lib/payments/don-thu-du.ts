import "server-only";
// lib/payments/don-thu-du.ts — việc SAU COMMIT khi một đơn vừa THU ĐỦ: chốt đơn → cấp tài khoản phụ
// huynh → biên nhận. MỘT chỗ cho mọi đường tiền tự động [GĐ1 POS · 06/10/2026].
//
// Dời NGUYÊN VĂN `confirmSettledOrder` + `sendOrderReceipt` khỏi `lib/payments/payos-ingest.ts`
// (thiết kế §5.3). Hai đường gọi CÙNG một hàm — cùng luật bằng mã, không bằng trí nhớ:
//   · `allocateToOrder` (webhook / đối soát tay, đời cũ) — sau commit, khi `settled`;
//   · handler `phieu-gop.da-chia` (`lib/payments/sau-da-chia.ts`) — phiếu gộp (QR mã mới + thẻ POS)
//     chia xong mà đơn thu đủ.
// Lưới `[POS1-EV-08]` ghim: hai đường cùng gọi `sauKhiDonThuDu`, `payos-ingest.ts` không còn thân cũ.
//
// ⚠️ KHÔNG import `@/lib/finance/payment` (lưới `[GGW-04]` — sổ marker của đường xác nhận đơn).
import { db } from "@/lib/db";
import { ensureParentAccountForOrder } from "@/lib/parents/provision";
import { sendEmailForTrigger } from "@/lib/email/trigger";
import { notifyOrderByZnsIfNoEmail } from "@/lib/notify/order";

/**
 * Đơn vừa thu đủ ⇒ chốt (CHỈ khi còn PENDING_PAYMENT) + nếu CHÍNH lượt này chốt: cấp tài khoản phụ
 * huynh + biên nhận. Trả `true` = lượt này vừa chốt đơn. Gọi lại bao nhiêu lần cũng chỉ một lần chốt,
 * một biên nhận (phép chốt có điều kiện là cổng chống gửi trùng).
 *
 * `nguoiChot` = tên ghi vào lịch sử trạng thái (vd "Cổng thanh toán (webhook)").
 */
export async function sauKhiDonThuDu(input: {
  orderId: string;
  soTien: number;
  providerTxnId: string;
  nguoiChot: string;
  /**
   * Nhận cả đơn đã bị đặt CONFIRMED NGẦM mà chưa ai làm việc sau chốt (`confirmedAt` NULL).
   *
   * ⚠️ PHÁT HIỆN F6 (đo 06/10/2026, ca `[POS1-EV-04]`): đường phiếu gộp gọi `recomputeRequestStatuses`
   * TRONG giao dịch rót tiền, và hàm đó tự đẩy đơn thu đủ lên CONFIRMED + `paidAt` (rollup một chiều,
   * `lib/payments/payment-request.ts`) — KHÔNG lịch sử trạng thái, KHÔNG `confirmedAt`, KHÔNG biên
   * nhận, KHÔNG cấp tài khoản. Tới lúc handler chạy, phép chốt "còn PENDING_PAYMENT" luôn đổi 0 dòng ⇒
   * các việc sau chốt KHÔNG BAO GIỜ chạy cho đơn thu qua phiếu gộp (và nút chốt tay cũng không chạy
   * được vì đơn đã CONFIRMED). Vế thứ hai của phép chốt — `status = CONFIRMED AND confirmedAt IS NULL`
   * — là cổng nhận lượt ĐÚNG MỘT LẦN (đặt `confirmedAt` có điều kiện).
   *
   * BẮT BUỘC, không mặc định (luật 7): `allocateToOrder` truyền `false` — đường cũ không gọi
   * `recomputeRequestStatuses` nên giữ NGUYÊN hành vi; handler phiếu gộp truyền `true`.
   */
  nhanDonChotNgam: boolean;
  /**
   * Nhãn "Phương thức thanh toán" in trên biên nhận gửi phụ huynh — theo ĐƯỜNG TIỀN THẬT của khoản
   * vừa lấp đủ đơn (rà đối kháng 06/10/2026: thu bằng thẻ mà biên nhận in "Chuyển khoản (payOS)").
   * `null` ⇒ hành vi cũ (phương thức chọn trên đơn, không có thì "Chuyển khoản (payOS)").
   * BẮT BUỘC, không mặc định (luật 7): `tsc` liệt kê mọi chỗ gọi.
   */
  nhanPhuongThuc: string | null;
}): Promise<boolean> {
  const orderConfirmed = await confirmSettledOrder(
    input.orderId,
    input.soTien,
    input.providerTxnId,
    input.nguoiChot,
    input.nhanDonChotNgam,
  );
  if (orderConfirmed) {
    await ensureParentAccountForOrder(input.orderId).catch((err) =>
      console.error("[payos] provision parent:", err),
    );
    await sendOrderReceipt(input.orderId, input.nhanPhuongThuc).catch((err) => console.error("[payos] receipt:", err));
  }
  return orderConfirmed;
}

/**
 * Đơn đã đóng đủ → CONFIRMED. `updateMany` có điều kiện `PENDING_PAYMENT` để hai
 * luồng song song chỉ một cái đổi được trạng thái; trả về true = CHÍNH luồng này
 * vừa chuyển (chỉ khi đó mới gửi biên nhận, tránh gửi trùng).
 */
async function confirmSettledOrder(
  orderId: string,
  amount: number,
  providerTxnId: string,
  nguoiChot: string,
  nhanDonChotNgam: boolean,
): Promise<boolean> {
  const now = new Date();
  // ⚠️ ĐÃ GỠ [14/09/2026] — mệnh đề OR lọc theo `discountApprovalStatus` (cổng chống
  // lách duyệt giảm giá trên đường TỰ CHỐT đơn, BGĐ 31/07).
  //
  // Gỡ CÙNG LÚC với cổng người chốt ở `app/(admin)/admin/orders/_actions.ts` — hai cổng
  // là một cặp, lệch nhịp thì máy chốt được mà người không chốt được.
  //
  // `status: "PENDING_PAYMENT"` GIỮ NGUYÊN: đó không phải cổng duyệt mà là điều kiện
  // chống chốt lại đơn đã chốt/đã huỷ (và là thứ làm lời gọi này idempotent).
  const upd = await db.order.updateMany({
    where: {
      id: orderId,
      status: "PENDING_PAYMENT",
    },
    data: {
      status: "CONFIRMED",
      confirmedAt: now,
      paidAt: now,
      gatewayTxnId: providerTxnId,
    },
  });
  let daChot = upd.count > 0;
  // F6 — đơn đã CONFIRMED NGẦM (rollup của `recomputeRequestStatuses`) mà chưa ai làm việc sau chốt:
  // nhận lượt bằng phép ghi CÓ ĐIỀU KIỆN `confirmedAt IS NULL` (đúng một lần). Không đụng `paidAt`
  // (rollup đã đặt). Chỉ đường phiếu gộp xin vế này — xem `nhanDonChotNgam`.
  if (!daChot && nhanDonChotNgam) {
    const ngam = await db.order.updateMany({
      where: { id: orderId, status: "CONFIRMED", confirmedAt: null },
      data: { confirmedAt: now, gatewayTxnId: providerTxnId },
    });
    daChot = ngam.count > 0;
  }
  if (!daChot) return false;

  await db.orderStatusHistory
    .create({
      data: {
        orderId,
        fromStatus: "PENDING_PAYMENT",
        toStatus: "CONFIRMED",
        changedByUserId: null,
        changedByName: nguoiChot,
        reason: `Tự động xác nhận: đã thu đủ mọi đợt (giao dịch cuối ${amount.toLocaleString(
          "vi-VN",
        )}đ, ref ${providerTxnId})`,
      },
    })
    .catch((err) => console.error("[payos] order history:", err));
  return true;
}

/**
 * Biên nhận sau khi đơn được xác nhận — mirror `sendOrderReceipt` của webhook
 * SePay: khách có email → email PAYMENT_RECEIPT; chỉ có SĐT → ZNS học phí.
 * Best-effort: lỗi thông báo KHÔNG được làm webhook trả 500 (tiền đã ghi sổ xong,
 * payOS retry sẽ đi vào nhánh DUPLICATE và không gửi lại gì).
 */
async function sendOrderReceipt(orderId: string, nhanPhuongThuc: string | null): Promise<void> {
  const order = await db.order
    .findUnique({
      where: { id: orderId },
      select: {
        id: true,
        code: true,
        customerEmail: true,
        customerName: true,
        totalAmount: true,
        paidAt: true,
        paymentMethod: { select: { name: true } },
      },
    })
    .catch(() => null);
  if (!order) return;

  if (order.customerEmail?.trim()) {
    await sendEmailForTrigger({
      trigger: "PAYMENT_RECEIPT",
      recipient: { email: order.customerEmail, name: order.customerName },
      vars: {
        customer_name: order.customerName,
        order_code: order.code,
        total_amount: order.totalAmount,
        payment_method: nhanPhuongThuc ?? order.paymentMethod?.name ?? "Chuyển khoản (payOS)",
        paid_at: order.paidAt ?? new Date(),
      },
      context: { type: "Order", id: order.id },
      triggerType: "SYSTEM",
      actor: { userId: null, name: "payOS webhook" },
    }).catch((err) => console.error("[payos] PAYMENT_RECEIPT email:", err));
  }

  await notifyOrderByZnsIfNoEmail(order.id).catch((err) =>
    console.error("[payos] ZNS receipt:", err),
  );
}
