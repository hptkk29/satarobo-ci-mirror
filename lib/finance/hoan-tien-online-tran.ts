import type { Prisma } from "@prisma/client";

import { laKhoanDaXacNhan } from "@/lib/finance/debt";

/**
 * V8.40 — TRẦN HOÀN TIỀN ONLINE (PAY-06). Hai phía, dùng Ở HAI NƠI: lúc DUYỆT và lúc CHI (cùng một hàm — hai bản chép là hai chỗ lệch):
 *
 *     tran = min( thực trả của dòng − đã hoàn/đã duyệt khác của CHÍNH dòng ,
 *                 tiền ĐÃ THU (kế toán xác nhận) của đơn − Σ hoàn/duyệt khác của CẢ đơn )
 *
 * Vì sao hai phía: tiền Online nằm ở mức ĐƠN (không gắn dòng) — chỉ chặn theo dòng thì hai dòng cùng hoàn «hết giá» có thể vượt tổng thật thu của đơn (thu thiếu/đã hoàn khoản khác);
 * chỉ chặn theo đơn thì hoàn một dòng vượt giá dòng đó. Bản THUẦN `tinhTranHoanOnline` + bản đọc DB `docSoLieuTranHoanOnline` (dưới khoá đơn, trong giao dịch của người gọi).
 */
export type SoLieuTranHoan = {
  /** (đơn giá − giảm) × số lượng của dòng */
  thucTraDong: number;
  /** Σ số tiền đã duyệt/đã chi của CÁC yêu cầu ONLINE khác trên CÙNG dòng (APPROVED + PAID) */
  daHoanKhacCuaDong: number;
  /** Σ tiền đã thu, kế toán ĐÃ XÁC NHẬN, dương, không phải bút toán điều chỉnh — của cả đơn */
  daThuXacNhanDon: number;
  /** Σ số tiền đã duyệt/đã chi của CÁC yêu cầu ONLINE khác trên CẢ đơn (APPROVED + PAID) */
  daHoanKhacCuaDon: number;
};

export function tinhTranHoanOnline(s: SoLieuTranHoan): number {
  const conDong = s.thucTraDong - s.daHoanKhacCuaDong;
  const conDon = s.daThuXacNhanDon - s.daHoanKhacCuaDon;
  return Math.max(0, Math.min(conDong, conDon));
}

type Tx = Prisma.TransactionClient;

/** Đọc số liệu trần cho MỘT dòng đơn ONLINE. `boQuaYeuCauId` = chính yêu cầu đang duyệt/chi (không tính trùng). Gọi dưới khoá đơn. */
export async function docSoLieuTranHoanOnline(tx: Tx, input: { orderId: string; orderItemId: string; boQuaYeuCauId?: string | null }): Promise<SoLieuTranHoan | null> {
  const dong = await tx.orderItem.findFirst({ where: { id: input.orderItemId, orderId: input.orderId }, select: { unitPrice: true, discountAmount: true, quantity: true } });
  if (!dong) return null;
  const [thu, yc] = await Promise.all([
    tx.payment.findMany({
      where: { orderId: input.orderId, deletedAt: null, amount: { gt: 0 }, adjustmentOfId: null },
      select: { amount: true, accountantStatus: true, deletedAt: true, adjustmentOfId: true, saleStatus: true, paidDate: true, createdAt: true, orderItemId: true, enrollmentId: true, centerId: true, id: true },
    }),
    tx.refundRequest.findMany({
      where: { kenh: "ONLINE", status: { in: ["APPROVED", "PAID"] }, orderItem: { orderId: input.orderId }, ...(input.boQuaYeuCauId ? { id: { not: input.boQuaYeuCauId } } : {}) },
      select: { orderItemId: true, approvedAmount: true },
    }),
  ]);
  const daThuXacNhanDon = thu.filter((p) => laKhoanDaXacNhan(p as never)).reduce((s, p) => s + p.amount, 0);
  const hoanDon = yc.reduce((s, r) => s + (r.approvedAmount ?? 0), 0);
  const hoanDong = yc.filter((r) => r.orderItemId === input.orderItemId).reduce((s, r) => s + (r.approvedAmount ?? 0), 0);
  return { thucTraDong: dong.unitPrice * dong.quantity - dong.discountAmount, daHoanKhacCuaDong: hoanDong, daThuXacNhanDon, daHoanKhacCuaDon: hoanDon };
}
