import "server-only";
// lib/orders/thu-truoc-db.ts — ĐỌC tình trạng tiền của đơn cho luật "thu trước" (`thu-truoc.ts`). KHÔNG ghi gì.
//
// Đọc bằng `db` trần ở `lib/` (cho phép); QUYỀN + phạm vi cơ sở của người bấm kiểm ở action TRƯỚC khi gọi hàm này.
import { db } from "@/lib/db";
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { laDonPhiHocBu } from "@/lib/hoc-bu/don-phi";
import type { DauVaoThuTruoc } from "@/lib/orders/thu-truoc";

/** Đầu vào của `kiemThuTruoc` trừ `soTien` (do người dùng gõ). `null` = không có đơn. */
export async function docTinhTrangThuTruoc(orderId: string): Promise<Omit<DauVaoThuTruoc, "soTien" | "hanConLai" | "homNay"> | null> {
  const [order, soKeHoachCu, soPhieuDotDangSong, duocGhi, duocRot] = await Promise.all([
    db.order.findUnique({ where: { id: orderId }, select: { totalAmount: true, status: true, items: { select: { type: true, metadata: true } } } }),
    db.orderInstallment.count({ where: { orderId } }),
    // Phiếu "thu toàn đơn" là `installmentNo = 0` và không gắn dòng; mọi phiếu sống KHÁC nó là đợt.
    db.paymentRequest.count({ where: { orderId, status: { not: "VOID" }, OR: [{ installmentNo: { gt: 0 } }, { orderItemId: { not: null } }] } }),
    db.payment.aggregate({ where: { orderId, ...KHOAN_DA_GHI_NHAN }, _sum: { amount: true } }),
    db.paymentAllocation.aggregate({ where: { paymentRequest: { orderId } }, _sum: { amount: true } }),
  ]);
  if (!order) return null;
  return {
    tongDon: order.totalAmount,
    trangThaiDon: order.status,
    laDonPhiHocBu: laDonPhiHocBu(order.items),
    soKeHoachCu,
    soPhieuDotDangSong,
    // Hai sổ (A: Payment, B: phân bổ phiếu) ghi CÙNG một khoản tiền — lấy số lớn hơn, không cộng (cộng là đếm đôi).
    tongDaNhan: Math.max(duocGhi._sum.amount ?? 0, duocRot._sum.amount ?? 0),
  };
}
