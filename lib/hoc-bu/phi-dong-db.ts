// lib/hoc-bu/phi-dong-db.ts — ĐỌC phí học bù của MỘT dòng cần bù (T06, 07/10/2026). Chỉ đọc; không ghi gì.
//
// Bốn chỗ cần cùng một câu hỏi "đơn phí của dòng này còn sống không, đã thu bao nhiêu":
//   · miễn phí ngoại lệ — đơn phí CHƯA thu thì phải HUỶ cùng lúc, đã có tiền thì từ chối;
//   · huỷ không bù — đã thu phí thì NÓI RA (HB-22: tiền bị bỏ rơi, không ai biết);
//   · xét lại sau khi đơn bị huỷ/hoàn (`don-doi.ts`);
// nên nó ở MỘT hàm. "Còn sống" cùng định nghĩa với màn danh sách (`danh-sach-db.ts`) và checker (`donPhiConSong`).
import type { OrderStatus, Prisma } from "@prisma/client";
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";

type Nguon = Pick<Prisma.TransactionClient, "orderItem" | "payment">;

export type PhiCuaDong = {
  orderId: string;
  /** Mã đơn — thứ người đọc nhận ra; `orderId` (cuid) thì không. */
  orderCode: string;
  orderStatus: OrderStatus;
  orderDaXoa: boolean;
  tongTien: number;
  /** Tổng khoản ĐÃ GHI NHẬN (`KHOAN_DA_GHI_NHAN`, trừ khoản bị kế toán từ chối; khoản hoàn là dòng âm tự trừ ra). */
  daThu: number;
};

export const donPhiConSong = (p: Pick<PhiCuaDong, "orderStatus" | "orderDaXoa">): boolean =>
  !p.orderDaXoa && p.orderStatus !== "CANCELLED" && p.orderStatus !== "REFUNDED";

export async function docPhiCuaDong(nguon: Nguon, feeOrderItemId: string | null): Promise<PhiCuaDong | null> {
  if (!feeOrderItemId) return null;
  const item = await nguon.orderItem.findUnique({
    where: { id: feeOrderItemId },
    select: { order: { select: { id: true, code: true, status: true, deletedAt: true, totalAmount: true } } },
  });
  if (!item) return null;
  const thu = await nguon.payment.aggregate({
    where: { orderId: item.order.id, ...KHOAN_DA_GHI_NHAN },
    _sum: { amount: true },
  });
  return {
    orderId: item.order.id,
    orderCode: item.order.code,
    orderStatus: item.order.status,
    orderDaXoa: item.order.deletedAt !== null,
    tongTien: item.order.totalAmount,
    daThu: thu._sum.amount ?? 0,
  };
}

/**
 * HB-22 — câu cảnh báo khi HUỶ KHÔNG BÙ một dòng mà phụ huynh ĐÃ TRẢ phí. Trước T06 `huyBuoiCanBuAction` không đọc phí: tiền nằm lại
 * trên một đơn mà không dòng cần bù nào còn dùng, và không ai thấy. Quyết định của chủ dự án: huỷ KHÔNG tự hoàn tiền — nhưng phải NÓI.
 * Trả null khi không có gì phải nói.
 */
export async function canhBaoPhiDaThuKhiHuy(nguon: Nguon, feeOrderItemId: string | null): Promise<string | null> {
  const phi = await docPhiCuaDong(nguon, feeOrderItemId);
  if (!phi || !donPhiConSong(phi) || phi.daThu <= 0) return null;
  return `Phụ huynh đã đóng ${phi.daThu.toLocaleString("vi-VN")}đ phí học bù cho buổi này. Huỷ KHÔNG tự hoàn tiền — hãy báo kế toán xử lý hoàn phí (đơn ${phi.orderCode}).`;
}
