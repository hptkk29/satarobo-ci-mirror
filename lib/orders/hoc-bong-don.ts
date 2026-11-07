import "server-only";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { canGrantFullScholarship, SCHOLARSHIP_FORBIDDEN } from "@/lib/crm/scholarship";

// lib/orders/hoc-bong-don.ts — HỌC BỔNG 100% ĐÁNH DẤU TRÊN ĐƠN [chủ dự án chốt 27/10/2026].
//
// *"phần học bổng 0đ thì để ở phần đơn hàng để admin thực hiện nếu có case có học bổng 100%"*. Màn chốt lead cũ (đã bỏ) từng cấp học bổng bằng cách đặt
// `Enrollment.finalPrice = 0`; nay đơn đã có sẵn nên Quản trị tối cao ĐÁNH DẤU đơn học bổng, và đơn đó qua cổng "đã có tiền" của màn Chuyển đổi
// (`lib/orders/cong-chuyen-doi.ts`) mà KHÔNG cần tiền về.
//
// ⚠️ KHÔNG tạo `Payment` / `PaymentAllocation` giả — nó làm sai công nợ, hoa hồng và đối soát. Phiếu thu đã có của đơn KHÔNG bị đụng (kế toán huỷ phiếu nếu cần).
// ⚠️ CHỈ Quản trị tối cao (`canGrantFullScholarship` — cùng luật với màn chốt lead cũ; không đẻ permission mới vì permission mới cần `seed-prod-roles.yml`).
// ⚠️ Cổng QUYỀN ở server action; hàm này vẫn tự kiểm `isSuperAdmin` (phòng thủ chiều sâu — hàm có thể bị gọi từ chỗ khác).

type Nguoi = { id: string | null; name: string };

const LY_DO_TOI_THIEU = 10;
const TRANG_THAI_KHONG_CAP = ["CANCELLED", "REFUNDED"] as const;

export type KetQuaHocBong = { ok: true } | { ok: false; error: string };

export async function capHocBong100(p: { orderId: string; lyDo: string; isSuperAdmin: boolean }, nguoi: Nguoi, bayGio: Date): Promise<KetQuaHocBong> {
  if (!canGrantFullScholarship({ isSuperAdmin: p.isSuperAdmin })) return { ok: false, error: SCHOLARSHIP_FORBIDDEN };
  const ly = p.lyDo.trim();
  if (ly.length < LY_DO_TOI_THIEU) return { ok: false, error: `Ghi lý do cấp học bổng ít nhất ${LY_DO_TOI_THIEU} ký tự` };

  return db.$transaction(async (tx): Promise<KetQuaHocBong> => {
    const o = await tx.order.findFirst({ where: { id: p.orderId, deletedAt: null }, select: { id: true, code: true, status: true, hocBong100: true } });
    if (!o) return { ok: false, error: "Không tìm thấy đơn" };
    if ((TRANG_THAI_KHONG_CAP as readonly string[]).includes(o.status)) return { ok: false, error: "Đơn đã huỷ / hoàn tiền — không cấp học bổng được" };
    if (o.hocBong100) return { ok: false, error: "Đơn này đã được cấp học bổng 100%" };
    // Cờ chống đua: chỉ đổi khi vẫn chưa có học bổng.
    const r = await tx.order.updateMany({
      where: { id: o.id, hocBong100: false },
      data: { hocBong100: true, hocBongById: nguoi.id, hocBongAt: bayGio, hocBongLyDo: ly },
    });
    if (r.count === 0) return { ok: false, error: "Đơn vừa được cấp học bổng ở nơi khác" };
    await writeAudit({
      tx,
      actor: nguoi,
      module: "orders",
      entityType: "Order",
      entityId: o.id,
      action: "HOC_BONG_100_CAP",
      newValues: { maDon: o.code, hocBong100: true },
      reason: ly,
    });
    return { ok: true };
  });
}

/** Thu hồi học bổng — CHỈ khi chưa dòng nào của đơn được chuyển đổi (đã có ghi danh thì học bổng đã được dùng, không thu hồi bằng một cú bấm). */
export async function thuHoiHocBong100(p: { orderId: string; lyDo: string; isSuperAdmin: boolean }, nguoi: Nguoi, bayGio: Date): Promise<KetQuaHocBong> {
  if (!canGrantFullScholarship({ isSuperAdmin: p.isSuperAdmin })) return { ok: false, error: SCHOLARSHIP_FORBIDDEN };
  const ly = p.lyDo.trim();
  if (ly.length < LY_DO_TOI_THIEU) return { ok: false, error: `Ghi lý do thu hồi ít nhất ${LY_DO_TOI_THIEU} ký tự` };

  return db.$transaction(async (tx): Promise<KetQuaHocBong> => {
    const o = await tx.order.findFirst({ where: { id: p.orderId, deletedAt: null }, select: { id: true, code: true, hocBong100: true } });
    if (!o) return { ok: false, error: "Không tìm thấy đơn" };
    if (!o.hocBong100) return { ok: false, error: "Đơn này chưa được cấp học bổng" };
    const daChuyen = await tx.orderItem.count({ where: { orderId: o.id, enrollmentId: { not: null } } });
    if (daChuyen > 0) return { ok: false, error: "Đơn đã có học viên được chuyển đổi — không thu hồi học bổng được" };
    const r = await tx.order.updateMany({ where: { id: o.id, hocBong100: true }, data: { hocBong100: false, hocBongById: null, hocBongAt: null, hocBongLyDo: null } });
    if (r.count === 0) return { ok: false, error: "Học bổng vừa được thu hồi ở nơi khác" };
    await writeAudit({
      tx,
      actor: nguoi,
      module: "orders",
      entityType: "Order",
      entityId: o.id,
      action: "HOC_BONG_100_THU_HOI",
      newValues: { maDon: o.code, hocBong100: false },
      reason: ly,
    });
    return { ok: true };
  });
}
