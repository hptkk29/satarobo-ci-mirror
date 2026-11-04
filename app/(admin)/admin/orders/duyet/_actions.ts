"use server";

// Chốt 20/08/2026 — MỘT NÚT DUYỆT CHO CẢ ĐƠN (giảm giá + kế hoạch thanh toán).
//
// Khuôn: auth → checkAnyPermission (cổng thô) → resolveActor → scopedDb tra đơn
// (chống IDOR chéo cơ sở) → checkPermission theo centerId → gọi lib → revalidatePath.
// Gate CHÍNH là `checkPermission` ở đây (nó theo cờ RBAC v2 và sinh shadow-diff);
// `assertCan` trong `lib/orders/approval.ts` là lớp phòng thủ cho caller gọi thẳng
// lib (e2e).
//
// ⚠️ ĐÂY LÀ ĐƯỜNG DUYỆT DUY NHẤT (20/08). Hai file bridge cũ
// `_components/_discount-approval-actions.ts` và `_components/_installment-approval-actions.ts`
// đã bị XOÁ: mọi export của file "use server" là một endpoint HTTP, nên để chúng nằm
// đó là còn nguyên đường POST duyệt LẺ từng phần — thứ mà bất biến "tất cả hoặc
// không" của `lib/orders/approval.ts` cấm. Đừng dựng lại chúng.
//
// Đặt ở thư mục trang duyệt vì trang này và khối duyệt trong chi tiết đơn dùng CHUNG
// một cặp action — hai chỗ bấm, một hành vi.

import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { checkPermission, checkAnyPermission } from "@/lib/auth/check-permission";
import { thuHoiBaoChoDuyet } from "@/lib/orders/bao-cho-duyet";
import { QUYEN_DUYET_DON } from "@/lib/orders/cho-duyet";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import {
  approveOrder,
  rejectOrder,
  pendingApprovalParts,
  missingApprovalPermissions,
  describeMissingPermissions,
  APPROVAL_PART_PERMISSION,
  NOTHING_TO_APPROVE,
  type ApprovalPart,
  type OrderApprovalActor,
} from "@/lib/orders/approval";

type ActionResult = { ok: boolean; error?: string };
/**
 * Kết quả duyệt/từ chối — kèm câu báo phiếu gộp của cả nhà vừa bị huỷ/đóng (rà vòng 4, luật 12).
 * `null` khi không phiếu nào bị đụng.
 */
type KetQuaDuyet = ActionResult & { thongDiepPhieu?: string | null };

/**
 * Tra đơn TRONG TẦM NHÌN của actor + tính sẵn phần đang chờ duyệt.
 *
 * `scopedDb.findUnique` lọc hậu kỳ theo scope: đơn của cơ sở khác trả null ⇒ quản lý
 * cơ sở 1 không duyệt được đơn cơ sở 2 dù đoán đúng id.
 */
async function loadScopedPendingOrder(orderId: string) {
  const session = await auth();
  if (!session?.user) return { error: "Chưa đăng nhập" as const };

  // Cổng quyền THÔ đặt TRƯỚC khi tra đơn.
  //
  // VÌ SAO: người không có quyền duyệt nào phải nhận CÙNG MỘT câu trả lời cho mọi id.
  // Nếu tra đơn trước rồi mới kiểm quyền (như bản đầu), thông điệp lỗi tự khai:
  // "Không tìm thấy đơn hàng" = id sai hoặc đơn của cơ sở khác, còn "không có nội dung
  // nào đang chờ duyệt" = đơn CÓ THẬT và nằm trong cơ sở của người gọi. Ai có
  // `orders:view` cũng dò được sự tồn tại + trạng thái duyệt của đơn bằng cách gọi thẳng
  // action.
  //
  // Gọi KHÔNG kèm target (chưa có centerId để truyền) — cùng lý do đã ghi ở
  // duyet/page.tsx. Vòng kiểm chặt theo `centerId` vẫn chạy đủ ở `assertCanApproveAll`
  // sau khi đã có đơn, nên cổng thô này chỉ thêm lớp chặn, không nới lỏng gì.
  if (!(await checkAnyPermission(QUYEN_DUYET_DON))) {
    return { error: "Không có quyền duyệt đơn hàng" as const };
  }

  const actor = await resolveActor(session.user.id);
  const order = await scopedDb(actor).order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      centerId: true,
      leadId: true,
      discountApprovalStatus: true,
      installmentApprovalStatus: true,
      soBuoiApprovalStatus: true,
    },
  });
  if (!order) return { error: "Không tìm thấy đơn hàng" as const };

  const parts = pendingApprovalParts(order);
  if (parts.length === 0) return { error: NOTHING_TO_APPROVE };
  return { session, order, parts } as const;
}

function buildActor(session: Session): OrderApprovalActor {
  const { actorId, actorName } = getAuditActor(session);
  return {
    id: actorId ?? "",
    name: actorName,
    role: session.user.role,
    roles: session.user.roles,
  };
}

/**
 * Đủ quyền cho MỌI nội dung đang chờ mới được bấm — thiếu một phần là chặn cả lệnh.
 * Trả về câu nói rõ thiếu quyền gì thay vì "Không có quyền" chung chung.
 */
async function assertCanApproveAll(
  parts: readonly ApprovalPart[],
  centerId: string | null,
): Promise<string | null> {
  const granted: Partial<Record<ApprovalPart, boolean>> = {};
  for (const part of parts) {
    // GIỮ MỘT quyền trong danh sách của phần đó là đủ. Phần "số buổi" mang CẢ HAI quyền
    // (chủ dự án 25/09: *"ai duyệt được đơn là duyệt được"*), nên `checkAnyPermission`
    // chứ không `checkPermission` — xem `APPROVAL_PART_PERMISSION`.
    granted[part] = await checkAnyPermission(APPROVAL_PART_PERMISSION[part], { centerId });
  }
  const missing = missingApprovalPermissions(parts, granted);
  return missing.length > 0 ? describeMissingPermissions(missing) : null;
}

function revalidate(orderId: string, leadId: string | null) {
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  // Đơn vừa duyệt phải rời hàng chờ ngay, nếu không quản lý sẽ bấm lại lần hai.
  revalidatePath("/orders/duyet");
  if (leadId) {
    revalidatePath(`/leads/${leadId}`);
    revalidatePath(`/leads/${leadId}/convert`);
  }
}

/** Quản lý cơ sở duyệt cả đơn: giảm giá + kế hoạch thanh toán trong một lệnh. */
export async function approveOrderAction(
  orderId: string,
  reason?: string,
): Promise<KetQuaDuyet> {
  const ctx = await loadScopedPendingOrder(orderId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const denied = await assertCanApproveAll(ctx.parts, ctx.order.centerId);
  if (denied) return { ok: false, error: denied };

  const res = await approveOrder({ orderId, actor: buildActor(ctx.session), reason });
  if (res.ok) {
    // ⚠️ THU HỒI TIN TRONG CHUÔNG — vế dễ quên nhất của cả tính năng [25/09/2026].
    // Gửi tin thì ai cũng nhớ; thu hồi khi việc đã xong thì không. Quên nó là chuông
    // đọng lại một việc đã làm, người ta bấm vào thấy màn duyệt trống, vài lần như thế
    // là thôi tin cái chuông — và một thông báo sai phá giá TẤT CẢ thông báo khác.
    await thuHoiBaoChoDuyet({ orderId, centerId: ctx.order.centerId });
    revalidate(orderId, ctx.order.leadId);
  }
  return { ok: res.ok, error: res.error, thongDiepPhieu: res.thongDiepPhieu ?? null };
}

/** Quản lý cơ sở từ chối cả đơn (lý do bắt buộc). */
export async function rejectOrderAction(
  orderId: string,
  reason: string,
): Promise<KetQuaDuyet> {
  const ctx = await loadScopedPendingOrder(orderId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const denied = await assertCanApproveAll(ctx.parts, ctx.order.centerId);
  if (denied) return { ok: false, error: denied };

  const res = await rejectOrder({ orderId, actor: buildActor(ctx.session), reason });
  if (res.ok) {
    // Thu hồi ở CẢ đường từ chối, không chỉ đường duyệt: đơn bị từ chối cũng thôi chờ.
    // Để tin lại là người duyệt mở ra và không hiểu vì sao đơn không còn trong danh sách.
    await thuHoiBaoChoDuyet({ orderId, centerId: ctx.order.centerId });
    revalidate(orderId, ctx.order.leadId);
  }
  return { ok: res.ok, error: res.error, thongDiepPhieu: res.thongDiepPhieu ?? null };
}
