// lib/orders/sale-orders.ts — đơn hàng nhìn từ site Sale.
//
// Ranh giới của màn Sale, viết ra để đừng ai nới dần:
//   · Sale TẠO đơn cho khách CỦA MÌNH và GHI NHẬN tiền đã thu.
//   · Sale KHÔNG xác nhận thanh toán (`payments:manage` — Kế toán/Super Admin),
//     không huỷ đơn, không hoàn tiền, không sửa đơn của người khác.
// Hai việc đó khác nhau về hệ quả: ghi nhận là "tôi đã cầm tiền", xác nhận là
// "sổ sách công nhận khoản này". Gộp vào một nút là bỏ mất lớp đối soát.
import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { leadOwnershipWhere } from "@/lib/lead/ownership";
// Trục B có ĐÚNG MỘT nhà — gõ tay lại điều kiện ở đây là mở đường cho hai màn
// đếm hai kiểu (cổng `lib/finance/ghi-nhan.test.ts` chặn).
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";

export type SaleOrderRow = {
  id: string;
  /** Mã đơn hiển thị, vd `ORD-260521-000001`. Cột thật tên là `code`. */
  code: string;
  type: string;
  status: string;
  totalAmount: number;
  /** Đã GHI NHẬN (saleStatus RECORDED) — chưa chắc đã được kế toán xác nhận. */
  daGhiNhan: number;
  createdAt: Date;
  items: { id: string; itemName: string; quantity: number; unitPrice: number }[];
};

export type SaleLeadOrders = {
  orders: SaleOrderRow[];
  tongDon: number;
  tongDaGhiNhan: number;
  conThieu: number;
};

/**
 * Đơn của MỘT khách, chỉ trả khi khách đó của người đang xem.
 *
 * Vì sao kiểm sở hữu ở đây nữa dù trang đã kiểm: hàm này là một cửa riêng, và
 * cửa nào cũng phải tự khoá — trang gọi đúng hôm nay không đảm bảo trang gọi
 * đúng sau ba lần refactor.
 */
export async function getSaleLeadOrders(
  actor: Actor,
  userId: string,
  leadId: string,
): Promise<SaleLeadOrders | null> {
  const sdb = scopedDb(actor);

  const lead = await sdb.lead.findFirst({
    where: { id: leadId, deletedAt: null, AND: [leadOwnershipWhere(userId)] },
    select: { id: true },
  });
  if (!lead) return null;

  const rows = await sdb.order.findMany({
    where: { leadId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      code: true,
      type: true,
      status: true,
      totalAmount: true,
      createdAt: true,
      items: {
        select: { id: true, itemName: true, quantity: true, unitPrice: true },
        orderBy: { createdAt: "asc" },
      },
      payments: {
        // Chỉ đếm khoản CHƯA bị xoá mềm và đang ở trạng thái đã ghi nhận —
        // cùng bộ lọc mà `getLeadPaymentSummary` dùng, để hai con số trên hai
        // màn không bao giờ chênh nhau.
        where: KHOAN_DA_GHI_NHAN,
        select: { amount: true },
      },
    },
  });

  const orders: SaleOrderRow[] = rows.map((o) => ({
    id: o.id,
    code: o.code,
    type: o.type,
    status: o.status,
    totalAmount: o.totalAmount,
    daGhiNhan: o.payments.reduce((s, p) => s + p.amount, 0),
    createdAt: o.createdAt,
    items: o.items,
  }));

  const tongDon = orders.reduce((s, o) => s + o.totalAmount, 0);
  const tongDaGhiNhan = orders.reduce((s, o) => s + o.daGhiNhan, 0);

  return {
    orders,
    tongDon,
    tongDaGhiNhan,
    // Không cho âm: thu dư (trả trước, làm tròn) là chuyện có thật, và hiện
    // "còn thiếu −200.000đ" thì người đọc phải dịch trong đầu.
    conThieu: Math.max(0, tongDon - tongDaGhiNhan),
  };
}
