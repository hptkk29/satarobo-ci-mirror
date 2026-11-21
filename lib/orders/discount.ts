import "server-only";
import type { DiscountApprovalStatus, Prisma, Role } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";

// =============================================================================
// BGĐ 31/07 — GIẢM GIÁ nhập tay: giá gốc → giảm (% hoặc số tiền) → tổng →
// giải trình → Quản lý cơ sở duyệt → mới được xác nhận đơn.
//
// 03/08 — hệ MÃ KHUYẾN MÃI đã gỡ theo chốt chủ dự án (giảm theo %/số tiền linh
// động hơn, khỏi tạo mã cho từng đợt) ⇒ nay MỌI giảm giá đều đi luồng này.
//
// Cùng khuôn với duyệt trả góp (lib/orders/installments.ts): lib nhận actor thuần
// + assertCan (lớp phòng thủ); gate CHÍNH theo cờ RBAC nằm ở server action wrapper.
// =============================================================================

// ⚠️ `discountFromPercent` ĐÃ DỜI [15/09/2026] → `lib/orders/giam-gia-dong.ts`.
//
// Tệp này mở đầu bằng `import "server-only"`, mà từ khi giảm giá khai theo TỪNG DÒNG,
// form tạo đơn (client component) cũng phải tính ra đúng con số ấy để hiện cho người
// bán xem. Hai bản cài đặt = hai con số, và con số trên màn hình sẽ khác con số vào sổ.
// Nhập lại để mọi chỗ gọi cũ không phải đổi đường dẫn.
export { discountFromPercent } from "@/lib/orders/giam-gia-dong";

// ⚠️ ĐÃ XOÁ [14/09/2026] — `needsDiscountApproval`.
//
// Nó là CỔNG DUYỆT ("có giảm giá ⇒ phải duyệt"), mà cơ chế duyệt đã bỏ. Giữ lại một
// hàm tên "cần duyệt không" trong repo không còn khâu duyệt là để người sau nối lại
// nhầm. Chỗ tạo đơn nay hỏi thẳng `data.discountAmount > 0` để biết CÓ GIẢM GIÁ —
// dùng cho việc bắt GIẢI TRÌNH, việc đó vẫn còn và cố ý còn.

export type DiscountApprovalActor = {
  id: string;
  name: string;
  role?: Role | string | null;
  roles?: (Role | string)[] | null;
};

/** Phần đơn mà việc duyệt giảm giá cần đọc — dùng chung cho luồng lẻ và luồng gộp. */
export type DiscountApprovalOrder = {
  id: string;
  centerId: string | null;
  discountApprovalStatus: DiscountApprovalStatus | null;
};

// -----------------------------------------------------------------------------
// THÂN của việc duyệt/từ chối giảm giá, nhận sẵn `tx`.
//
// VÌ SAO TÁCH RA. Từ 20/08 quản lý cơ sở duyệt CẢ ĐƠN bằng MỘT nút (giảm giá +
// kế hoạch thanh toán cùng lúc — xem lib/orders/approval.ts). Hai việc đó phải nằm
// trong CÙNG một transaction, nếu không sẽ có đơn "duyệt xong một nửa" khi lệnh
// hỏng giữa chừng. Chép lại thân hàm sang chỗ mới là cách chắc chắn để hai bản
// trôi khác nhau sau vài lần sửa, nên chỗ duy nhất biết cách đặt cột + ghi nhật ký
// vẫn là đây; luồng gộp chỉ mượn lại.
// -----------------------------------------------------------------------------

/** Đặt cột duyệt giảm giá + ghi nhật ký. Caller lo assertCan và kiểm trạng thái. */
export async function applyDiscountApproval(
  tx: Prisma.TransactionClient,
  params: { order: DiscountApprovalOrder; actor: DiscountApprovalActor; reason?: string },
): Promise<void> {
  const { order, actor } = params;
  await tx.order.update({
    where: { id: order.id },
    data: {
      discountApprovalStatus: "APPROVED",
      discountApprovedById: actor.id,
      discountApprovedAt: new Date(),
      discountRejectReason: null,
    },
  });
  await writeAudit({
    actor: { id: actor.id, name: actor.name },
    module: "finance",
    entityType: "Order",
    entityId: order.id,
    action: "DISCOUNT_APPROVED",
    oldValues: { discountApprovalStatus: order.discountApprovalStatus },
    newValues: { discountApprovalStatus: "APPROVED" },
    reason: params.reason?.trim() || undefined,
    orgUnitId: order.centerId,
    tx,
  });
}

/** Đặt cột từ chối giảm giá + ghi nhật ký. Caller lo assertCan và kiểm `reason`. */
export async function applyDiscountRejection(
  tx: Prisma.TransactionClient,
  params: { order: DiscountApprovalOrder; actor: DiscountApprovalActor; reason: string },
): Promise<void> {
  const { order, actor } = params;
  const reason = params.reason.trim();
  await tx.order.update({
    where: { id: order.id },
    data: {
      discountApprovalStatus: "REJECTED",
      discountApprovedById: actor.id,
      discountApprovedAt: new Date(),
      discountRejectReason: reason,
    },
  });
  await writeAudit({
    actor: { id: actor.id, name: actor.name },
    module: "finance",
    entityType: "Order",
    entityId: order.id,
    action: "DISCOUNT_REJECTED",
    oldValues: { discountApprovalStatus: order.discountApprovalStatus },
    newValues: { discountApprovalStatus: "REJECTED" },
    reason,
    orgUnitId: order.centerId,
    tx,
  });
}

// ⚠️ ĐÃ XOÁ [14/09/2026] — `approveOrderDiscount` + `rejectOrderDiscount`.
//
// Chúng là MÃ CHẾT trước cả lúc gỡ duyệt: grep toàn repo ra 0 chỗ gọi, kể cả test —
// đường duyệt thật đã dời sang `lib/orders/approval.ts` từ 20/08, và file đó nay cũng
// đã xoá cùng cơ chế duyệt. Hai hàm `applyDiscountApproval` / `applyDiscountRejection`
// BÊN DƯỚI giữ lại: chúng là phần ĐẶT CỘT trong transaction, còn dùng cho dữ liệu cũ.
