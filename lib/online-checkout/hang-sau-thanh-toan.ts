import type { PrismaClient } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";
import { tieuThuGiuKho } from "@/lib/inventory/giu-kho";

import { donOnlineDaThuDu } from "./cap-quyen-sau-thanh-toan";

/**
 * V8.43 — CẦU NỐI "ĐƠN ONLINE ĐÃ THU ĐỦ → HỌC CỤ" (Commerce v2 · P0). Song song với `cap-quyen-sau-thanh-toan.ts` (khoá → quyền học);
 * file này lo phần HÀNG: tiêu thụ giữ kho (trừ tồn + ghi `ProductMovement`) rồi chuyển fulfillment `AWAITING_PAYMENT → PAID`.
 *
 * Luật (mỗi cái có ca `[DHH-*]`):
 *  1. Chỉ chạy khi đơn ONLINE đã THU ĐỦ (cùng `donOnlineDaThuDu` với cấp quyền — một chỗ hỏi) và chưa huỷ.
 *  2. MỖI dòng một giao dịch riêng (một dòng hỏng không kéo cả đơn); idempotent theo trạng thái fulfillment + `tieuThuGiuKho` (webhook lặp ⇒ không trừ tồn hai lần).
 *  3. Thanh toán đến MUỘN (giữ kho đã hết hạn): còn hàng ⇒ vẫn bán; hết hàng ⇒ dòng sang `NEEDS_STAFF` kèm ghi chú — TIỀN GIỮ NGUYÊN, nhân viên xử lý (hoàn/chờ nhập).
 *     Tuyệt đối KHÔNG làm hỏng phép ghi tiền: hàm này không ném ra caller.
 *  4. Dòng đã qua `AWAITING_PAYMENT` (PAID/PACKING/…/CANCELLED/NEEDS_STAFF) không bị đụng — không giẫm lên việc kho đang làm.
 */
type Db = PrismaClient;

export type KetQuaHangDong = { orderItemId: string; ketQua: "DA_THANH_TOAN" | "CAN_NHAN_VIEN_XU_LY" | "BO_QUA" | "LOI_HA_TANG"; ma?: string };
export type KetQuaHangDon = { coHang: boolean; daThuDu: boolean; dong: KetQuaHangDong[] };

export async function hoanTatHangSauThanhToan(db: Db, orderId: string, now: Date): Promise<KetQuaHangDon> {
  const cho = await db.orderItemFulfillment.findMany({
    where: { status: "AWAITING_PAYMENT", orderItem: { orderId, type: "PRODUCT", order: { type: "ONLINE", deletedAt: null } } },
    select: { orderItemId: true },
    orderBy: { createdAt: "asc" },
  });
  if (cho.length === 0) return { coHang: false, daThuDu: false, dong: [] };
  if (!(await donOnlineDaThuDu(db, orderId))) return { coHang: true, daThuDu: false, dong: cho.map((c) => ({ orderItemId: c.orderItemId, ketQua: "BO_QUA" as const, ma: "CHO_THANH_TOAN" })) };

  const dong: KetQuaHangDong[] = [];
  for (const c of cho) {
    try {
      dong.push(await db.$transaction(async (tx) => {
        // Khoá dòng fulfillment: hai lượt (webhook + cron/nút thử lại) xếp hàng, lượt sau thấy trạng thái đã đổi.
        await tx.$queryRaw`SELECT "id" FROM "OrderItemFulfillment" WHERE "orderItemId" = ${c.orderItemId} FOR UPDATE`;
        const f = await tx.orderItemFulfillment.findUnique({ where: { orderItemId: c.orderItemId }, select: { status: true } });
        if (!f || f.status !== "AWAITING_PAYMENT") return { orderItemId: c.orderItemId, ketQua: "BO_QUA" as const, ma: "DA_XU_LY" };
        const t = await tieuThuGiuKho(tx, { orderItemId: c.orderItemId, now, nguoi: { id: null, ten: "Hệ thống (thanh toán)" } });
        if (t.ok) {
          await tx.orderItemFulfillment.update({ where: { orderItemId: c.orderItemId }, data: { status: "PAID", paidAt: now } });
          return { orderItemId: c.orderItemId, ketQua: "DA_THANH_TOAN" as const };
        }
        await tx.orderItemFulfillment.update({ where: { orderItemId: c.orderItemId }, data: { status: "NEEDS_STAFF", paidAt: now, note: `Đã thu tiền nhưng ${t.thongBao}` } });
        await writeAudit({ tx, actor: { id: null, name: "Hệ thống (thanh toán)" }, module: "online-checkout", entityType: "OrderItem", entityId: c.orderItemId, action: "FULFILLMENT_NEEDS_STAFF", newValues: { ma: t.ma, thongBao: t.thongBao, orderId } });
        return { orderItemId: c.orderItemId, ketQua: "CAN_NHAN_VIEN_XU_LY" as const, ma: t.ma };
      }));
    } catch (err) {
      console.error(`[hang-online] đơn ${orderId} dòng ${c.orderItemId}: lỗi hạ tầng khi tiêu thụ giữ kho`, err);
      dong.push({ orderItemId: c.orderItemId, ketQua: "LOI_HA_TANG" });
    }
  }
  return { coHang: true, daThuDu: true, dong };
}
