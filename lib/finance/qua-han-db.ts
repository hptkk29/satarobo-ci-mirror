// lib/finance/qua-han-db.ts — ĐỢT QUÁ HẠN: phần chạm DB. PHIÊN G2 · US-23.
//
// ⚠️ CHỈ ĐỌC. Không hàm nào trong tệp này ghi một dòng nào, và đó là luật của cron nhắc nợ:
// *"cron KHÔNG ghi dòng tiền nào"* (chốt của chủ dự án). Một cron vừa nhắc vừa ghi là một
// cron mà không ai dám chạy lại khi nghi ngờ.
import "server-only";
import { db } from "@/lib/db";
import { locDotCuaConDangBaoLuu } from "@/lib/finance/bao-luu-tien";
import { gomTheoNha, type DotQuaHan, type NhaQuaHan } from "@/lib/finance/qua-han";
import { TRANG_THAI_DON_KHONG_NHAN_TIEN } from "@/lib/payments/don-nhan-tien";

export type NhaQuaHanDayDu = NhaQuaHan & {
  orderCode: string;
  customerName: string;
  /** Sale phụ trách — người sẽ nhận tin nhắc. `null` = không suy được. */
  saleUserId: string | null;
};

export type KetQuaDocQuaHan = {
  nha: NhaQuaHanDayDu[];
  /** Số đợt ĐƯỢC THA vì con đang bảo lưu (AC4). Nói ra, đừng lọc im lặng. */
  thaViBaoLuu: number;
  /** Số nhà không suy được sale phụ trách ⇒ không ai nhận tin. Cũng phải nói ra. */
  khongCoSale: number;
};

/**
 * Các nhà đang có con quá hạn.
 *
 * ⚠️ Ba lớp lọc, và cả ba đều cần:
 *   1. đơn phải còn NHẬN TIỀN được (`TRANG_THAI_DON_KHONG_NHAN_TIEN`) — nhắc nợ trên một đơn
 *      đã huỷ là gọi điện đòi tiền một hợp đồng không còn tồn tại;
 *   2. đợt còn mở (`PENDING`/`PARTIAL`) và đã qua hạn;
 *   3. con KHÔNG đang bảo lưu (AC4) — dùng CHÍNH hàm mà cron đối soát dùng
 *      (`locDotCuaConDangBaoLuu`, F2), không viết lại điều kiện.
 *
 * ⚠️ `now` là THAM SỐ (luật 19): "quá hạn chưa" phụ thuộc đồng hồ, và một ca test dùng ngày
 * tuyệt đối cộng một hàm rơi về `new Date()` là ca hẹn giờ nổ.
 */
export async function docNhaQuaHan(input: { now: Date; toiDa?: number }): Promise<KetQuaDocQuaHan> {
  const rows = await db.paymentRequest.findMany({
    where: {
      status: { in: ["PENDING", "PARTIAL"] },
      dueDate: { not: null, lt: input.now },
      orderItemId: { not: null },
      order: {
        deletedAt: null,
        status: { notIn: [...TRANG_THAI_DON_KHONG_NHAN_TIEN] },
      },
    },
    select: {
      id: true,
      orderId: true,
      orderItemId: true,
      installmentNo: true,
      amountDue: true,
      dueDate: true,
      allocations: { select: { amount: true } },
      orderItem: { select: { itemName: true } },
      order: {
        select: {
          code: true,
          customerName: true,
          createdById: true,
          lead: { select: { assignedToId: true } },
        },
      },
    },
    orderBy: { dueDate: "asc" },
    take: input.toiDa ?? 2000,
  });

  const tha = await locDotCuaConDangBaoLuu(
    db,
    rows.map((r) => ({ id: r.id, orderItemId: r.orderItemId })),
  );

  const dot: DotQuaHan[] = [];
  const thongTinDon = new Map<string, { code: string; customerName: string; saleUserId: string | null }>();

  for (const r of rows) {
    if (tha.has(r.id)) continue;
    const conThieu = r.amountDue - r.allocations.reduce((s, a) => s + a.amount, 0);
    // Đợt `PARTIAL` đã rót đủ (hoặc dư) thì không còn thiếu gì — `deriveStatus` có ngưỡng dung
    // sai làm tròn riêng, nên đừng tin mỗi `status` mà phải đo số.
    if (conThieu <= 0) continue;

    dot.push({
      paymentRequestId: r.id,
      orderId: r.orderId,
      orderItemId: r.orderItemId!,
      tenCon: r.orderItem?.itemName ?? "(chưa đặt tên)",
      installmentNo: r.installmentNo,
      conThieu,
      dueDate: r.dueDate!,
    });
    if (!thongTinDon.has(r.orderId)) {
      thongTinDon.set(r.orderId, {
        code: r.order?.code ?? "",
        customerName: r.order?.customerName ?? "",
        // ⚠️ Sale CHĂM lead (`Lead.assignedToId`) đứng TRƯỚC người TẠO đơn
        // (`Order.createdById`). Người tạo đơn có thể là kế toán nhập hộ, hoặc một lượt
        // chốt hàng loạt — nhắc họ là nhắc nhầm người. Cả hai cột đều đã đo là có thật.
        saleUserId: r.order?.lead?.assignedToId ?? r.order?.createdById ?? null,
      });
    }
  }

  const nha = gomTheoNha(dot, input.now).map((n) => {
    const t = thongTinDon.get(n.orderId)!;
    return { ...n, orderCode: t.code, customerName: t.customerName, saleUserId: t.saleUserId };
  });

  return {
    nha,
    thaViBaoLuu: tha.size,
    khongCoSale: nha.filter((n) => !n.saleUserId).length,
  };
}
