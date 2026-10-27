// lib/_handlers/hoc-bu-don-doi.ts — T06: consumer của DomainEvent `order.voided` (đơn bị huỷ / hoàn) cho module Học bù.
//
// Nghiệp vụ nằm ở `lib/hoc-bu/don-doi-db.ts` (xét lại dòng cần bù + lượt bù). Handler chỉ đọc payload và gọi; KHÔNG nuốt lỗi — ném thì
// outbox thử lại (tối đa `maxAttempts`), và mọi bước bên trong idempotent (khoá chống lặp của sổ + điều kiện trạng thái).
import { on, type DomainEventLite } from "@/lib/events/registry";
import { xetLaiDonBiLoai, xetLaiHoanMotPhan } from "@/lib/hoc-bu/don-doi-db";

export async function onOrderVoided(event: DomainEventLite): Promise<void> {
  const orderId = typeof event.payload.orderId === "string" ? event.payload.orderId : "";
  const den = event.payload.denTrangThai;
  if (!orderId || (den !== "CANCELLED" && den !== "REFUNDED")) return;
  await xetLaiDonBiLoai({ orderId, denTrangThai: den });
}

/** T14 — một khoản đã thu bị HOÀN (kể cả một phần) mà đơn vẫn sống: xét lại phí học bù của đơn đó. Payload thiếu/lạ thì bỏ qua. */
export async function onPaymentRefunded(event: DomainEventLite): Promise<void> {
  const orderId = typeof event.payload.orderId === "string" ? event.payload.orderId : "";
  if (!orderId) return;
  const paymentId = typeof event.payload.paymentId === "string" && event.payload.paymentId ? event.payload.paymentId : null;
  await xetLaiHoanMotPhan({ orderId, paymentId });
}

export function registerHocBuDonDoiHandlers(): void {
  on("order.voided", onOrderVoided);
  on("payment.refunded", onPaymentRefunded);
}
