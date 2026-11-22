import "server-only";
// lib/entitlements/xac-nhan-truoc.ts — "KHOẢN NÀY ĐƯỢC XÁC NHẬN TRƯỚC KHI CÓ GHI DANH KHÔNG?" Quyết ở MỘT chỗ, NGOÀI mọi transaction.
//
// Chủ dự án chốt 11/10/2026 (deadlock CHUA_GHI_DANH): cho kế toán xác nhận tiền TRƯỚC ở trạng thái "đã thu, chờ ghi danh/chuyển
// đổi" — KHÔNG thêm lớp, KHÔNG tiêu thụ buổi, KHÔNG quyền học active cho tới khi có học viên hợp lệ. Cổng `thieuGhiDanh`
// (`lib/finance/can-ghi-danh.ts`) chặn mọi khoản COURSE chưa gắn ghi danh; khách mới chưa Chuyển đổi chưa thể có ghi danh nên
// không bao giờ qua cổng ⇒ không có tiền xác nhận ⇒ không có quyền học (deadlock).
//
// ⚠️ NỚI HẸP, đúng MỘT điều kiện: đơn có dấu SCOPE (`laDonPhamVi`) VÀ cờ `billing.scopePurchaseEnabled` BẬT cho cơ sở của đơn.
//    Cờ TẮT / đơn thường / đơn đã huỷ / cơ sở chưa ánh xạ OrgUnit ⇒ `false` ⇒ cổng giữ NGUYÊN CHỮ.
//
// ⚠️ Đọc cờ bằng `db` ⇒ chỉ được gọi NGOÀI transaction ([DVU-PIN-07]); chỗ gọi truyền KẾT QUẢ (boolean) vào lõi xác nhận như tham
//    số BẮT BUỘC (luật 7) — lõi không tự đọc cờ trong tx.
//
// ⛔ ĐỪNG bật cờ ở prod khi chưa giải quyết hệ quả đã ĐO (`xac-nhan-truoc-ghi-danh.do.test.ts`, `[NOI-DL-*]`): khoản CONFIRMED chưa
//    ghi danh vào THỰC THU, HOA HỒNG KỲ (tầng gia hạn + người hưởng Sale lấy từ lead chưa convert) và HÀNG CHỜ HOÁ ĐƠN. Những chỗ
//    đó thuộc module khác (`lib/crm/commission*`, hoá đơn) và KHÔNG được sửa ở đây.
import { db } from "@/lib/db";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { laDonPhamVi } from "@/lib/orders/pham-vi/doc-dong";
import { laThuHocPhiTheoPhamViBat } from "./feature";

const DON_DA_HUY = ["CANCELLED", "REFUNDED"] as const;

/**
 * Trong `orderIds`, những đơn mà khoản chưa gắn ghi danh được phép xác nhận trước (SCOPE + cờ BẬT cho cơ sở của đơn).
 * MỘT câu đọc đơn cho cả lô; cờ hỏi một lần cho mỗi cơ sở.
 */
export async function donChoXacNhanTruocGhiDanh(orderIds: readonly string[]): Promise<ReadonlySet<string>> {
  const ids = [...new Set(orderIds.filter((x) => x.length > 0))];
  if (ids.length === 0) return new Set();
  const don = await db.order.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, status: true, centerId: true, items: { select: { metadata: true } } },
  });
  const coSoBat = new Map<string, boolean>();
  const ra = new Set<string>();
  for (const o of don) {
    if ((DON_DA_HUY as readonly string[]).includes(o.status) || !o.centerId || !laDonPhamVi(o.items)) continue;
    let bat = coSoBat.get(o.centerId);
    if (bat === undefined) {
      const orgUnitId = await orgUnitIdForCenter(o.centerId);
      bat = orgUnitId ? await laThuHocPhiTheoPhamViBat(orgUnitId) : false;
      coSoBat.set(o.centerId, bat);
    }
    if (bat) ra.add(o.id);
  }
  return ra;
}

/** Một đơn: khoản của đơn này có được xác nhận trước khi có ghi danh không. Đơn rỗng/không tồn tại ⇒ `false`. */
export async function choPhepXacNhanTruocGhiDanh(orderId: string | null): Promise<boolean> {
  if (!orderId) return false;
  return (await donChoXacNhanTruocGhiDanh([orderId])).has(orderId);
}
