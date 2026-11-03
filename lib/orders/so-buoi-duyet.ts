import "server-only";
import type { Prisma, SoBuoiApprovalStatus } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import type { DiscountApprovalActor } from "@/lib/orders/discount";

// =============================================================================
// DUYỆT SỐ BUỔI — thân việc đặt cột + ghi nhật ký, nhận sẵn `tx`.
//
// Chủ dự án chốt 25/09/2026: *"khi sale tạo đơn, nếu buổi học khác 12 24 36 48 tức 1 học
// phần, 2 học phần, 3 học phần, 4 học phần thì phải qua quản lý duyệt"* — chỉ áp cho khoá
// đủ 4 học phần (48 buổi). Phép XÉT ở `lib/orders/so-buoi-hoc-phan.ts` (thuần); tệp này
// chỉ lo phần GHI.
//
// ⚠️ KHUÔN CHÉP TỪ `lib/orders/discount.ts` CÓ CHỦ ĐÍCH, không phải lười.
// Ba nhóm cột duyệt trên `Order` phải đặt được trong CÙNG MỘT transaction (quản lý bấm
// MỘT nút duyệt cả đơn — `lib/orders/approval.ts`). Lệch khuôn ở đây là đẻ ra một ngoại
// lệ phải nhớ ở mọi chỗ gọi, trong khi cái cần là ba việc giống hệt nhau.
//
// TÊN HÀNH ĐỘNG NHẬT KÝ: `SESSION_COUNT_APPROVED` / `SESSION_COUNT_REJECTED`. Cố ý KHÔNG
// dùng lại `DISCOUNT_APPROVED` — báo cáo và lịch sử đơn đọc theo tên, và gộp tên là biến
// một dòng nhật ký thành câu nói dối về lý do người ta ký.
// =============================================================================

/** Phần đơn mà việc duyệt số buổi cần đọc. */
export type SoBuoiApprovalOrder = {
  id: string;
  centerId: string | null;
  soBuoiApprovalStatus: SoBuoiApprovalStatus | null;
};

/** Đặt cột duyệt số buổi + ghi nhật ký. Caller lo assertCan và kiểm trạng thái. */
export async function applySoBuoiApproval(
  tx: Prisma.TransactionClient,
  params: {
    order: SoBuoiApprovalOrder;
    actor: DiscountApprovalActor;
    reason?: string;
  },
): Promise<void> {
  const { order, actor } = params;
  await tx.order.update({
    where: { id: order.id },
    data: {
      soBuoiApprovalStatus: "APPROVED",
      soBuoiApprovedById: actor.id,
      soBuoiApprovedAt: new Date(),
      soBuoiRejectReason: null,
    },
  });
  await writeAudit({
    actor: { id: actor.id, name: actor.name },
    module: "finance",
    entityType: "Order",
    entityId: order.id,
    action: "SESSION_COUNT_APPROVED",
    oldValues: { soBuoiApprovalStatus: order.soBuoiApprovalStatus },
    newValues: { soBuoiApprovalStatus: "APPROVED" },
    reason: params.reason?.trim() || undefined,
    orgUnitId: order.centerId,
    tx,
  });
}

/** Đặt cột từ chối số buổi + ghi nhật ký. Caller lo assertCan và kiểm `reason`. */
export async function applySoBuoiRejection(
  tx: Prisma.TransactionClient,
  params: {
    order: SoBuoiApprovalOrder;
    actor: DiscountApprovalActor;
    reason: string;
  },
): Promise<void> {
  const { order, actor } = params;
  const reason = params.reason.trim();
  await tx.order.update({
    where: { id: order.id },
    data: {
      soBuoiApprovalStatus: "REJECTED",
      soBuoiApprovedById: actor.id,
      soBuoiApprovedAt: new Date(),
      soBuoiRejectReason: reason,
    },
  });
  await writeAudit({
    actor: { id: actor.id, name: actor.name },
    module: "finance",
    entityType: "Order",
    entityId: order.id,
    action: "SESSION_COUNT_REJECTED",
    oldValues: { soBuoiApprovalStatus: order.soBuoiApprovalStatus },
    newValues: { soBuoiApprovalStatus: "REJECTED" },
    reason,
    orgUnitId: order.centerId,
    tx,
  });
}
