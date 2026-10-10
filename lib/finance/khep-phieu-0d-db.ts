import "server-only";
// lib/finance/khep-phieu-0d-db.ts — KHÉP phiếu gộp OPEN còn phải thu 0đ. CHẠM TIỀN (trạng thái phiếu).
//
// Rà vòng 4 (30/09/2026). Phiếu OPEN mà mọi dòng đã đủ tiền từ ĐƯỜNG KHÁC (gắn tay, mã đời cũ) —
// "phiếu 0đ" — từng được ba chỗ hiểu ba kiểu:
//   · màn (`docPhieuGopDangMo`) coi là KHÔNG mở (giấu đi);
//   · `taoPhieuGop` coi là HẾT VIỆC và tự khép lúc phát phiếu mới;
//   · luật gỡ gắn (`phieuGopSauGoGanTrongTx`) coi là "phiếu mở khác" chặn chỗ ⇒ ĐÓNG phiếu cần mở
//     lại, nhật ký nói có phiếu mở trong khi màn không có (ca `[V3-23]`).
// Nay cả hai đường GHI dùng CHUNG hàm này: khép trước (đã nhận ⇒ ĐÓNG, chưa ⇒ HUỶ — đúng luật nút
// tay), rồi mới đếm / phát. KHÔNG chỉ loại phiếu 0đ khỏi phép đếm: làm vậy thì mở lại đụng chỉ mục
// từng phần `PaymentBill_orderId_open_key` ⇒ P2002 giữa transaction ⇒ cuộn ngược cả lượt gỡ.
//
// ⚠️ Tệp LÁ: không import `phieu-gop.ts` / `ghi-tien-don.ts` — cả hai gọi hàm này (vòng import).
// Người gọi PHẢI đang giữ `khoaDonTrongTx(tx, orderId)`.
import type { Prisma } from "@prisma/client";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { conPhaiThuCuaPhieu } from "@/lib/payments/chia-phieu-gop";

type Tx = Prisma.TransactionClient;

export type PhieuDaKhep = { billId: string; ma: string | null; dich: "VOID" | "CLOSED"; daNhan: number };

/**
 * Khép phiếu OPEN của đơn nếu nó còn phải thu 0đ. `null` khi đơn không có phiếu OPEN, phiếu còn
 * phải thu > 0, hoặc phiếu vừa đổi trạng thái (ghi có điều kiện `status: "OPEN"` đổi 0 dòng).
 */
export async function khepPhieuMo0dTrongTx(
  tx: Tx,
  input: { orderId: string; lyDo: string; actor: AuditActor },
): Promise<PhieuDaKhep | null> {
  const mo = await tx.paymentBill.findFirst({
    where: { orderId: input.orderId, status: "OPEN" },
    select: {
      id: true,
      matchKey: true,
      centerId: true,
      lines: {
        select: {
          paymentRequestId: true,
          sortOrder: true,
          amount: true,
          paymentRequest: { select: { amountDue: true, allocations: { select: { amount: true, roundingWaived: true } } } },
        },
      },
    },
  });
  if (!mo) return null;

  const dong = mo.lines.map((l) => ({
    paymentRequestId: l.paymentRequestId,
    sortOrder: l.sortOrder,
    amount: l.amount,
    amountDue: l.paymentRequest.amountDue,
    daRot: l.paymentRequest.allocations.reduce((s, a) => s + a.amount, 0),
    daTha: l.paymentRequest.allocations.reduce((s, a) => s + a.roundingWaived, 0),
  }));
  if (conPhaiThuCuaPhieu(dong) !== 0) return null;

  const daNhan = dong.reduce((s, d) => s + d.daRot, 0);
  const dich = daNhan > 0 ? "CLOSED" : "VOID";
  const upd = await tx.paymentBill.updateMany({ where: { id: mo.id, status: "OPEN" }, data: { status: dich } });
  if (upd.count === 0) return null;

  await writeAudit({
    tx,
    actor: input.actor,
    module: "finance",
    entityType: "Order",
    entityId: input.orderId,
    action: dich === "VOID" ? "PHIEU_GOP_VOID" : "PHIEU_GOP_CLOSED",
    oldValues: { billId: mo.id, ma: mo.matchKey, status: "OPEN" },
    newValues: { billId: mo.id, status: dich, daNhan },
    reason: input.lyDo,
    orgUnitId: mo.centerId,
  });
  return { billId: mo.id, ma: mo.matchKey, dich, daNhan };
}
