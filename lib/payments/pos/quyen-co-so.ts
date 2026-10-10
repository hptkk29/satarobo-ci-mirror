// lib/payments/pos/quyen-co-so.ts — "người này có QUYỀN ĐÓ ở cơ sở giữ đơn không" cho các cổng thu thẻ POS. THUẦN (không DB).
//
// Vì sao cần [rà đối kháng bản ghép Việc 3 + Việc 4, 10/10/2026 — HAI người rà độc lập cùng ra]:
//   · `checkPermission("payments:pos-check")` gọi TRẦN (không target): ở v2 nhánh GLOBAL của `can()` trả true nếu BẤT KỲ vai nào của người đó
//     có quyền, ở BẤT KỲ cơ sở nào;
//   · `passesScope("Order", order, actor)` đo tầm nhìn cơ sở theo TIỀN TỐ model — là phép HỢP của mọi vai (`orders:` …).
//   AND của hai vế KHÔNG cắt gì cho người có vai ở HAI cơ sở: sale@CS1 + kế toán@CS2 qua nửa đầu nhờ vai sale, qua nửa sau nhờ vai kế toán ⇒
//   huỷ / kiểm tra / tìm-gửi sai mã phiếu thẻ của đơn CS2, nơi họ CHỈ là kế toán (vai mà quyết định T16 cố ý KHÔNG cấp `payments:pos-check`).
//   Cùng gốc ở cổng duyệt (`payments:manage`): kế toán@CS1 + sale@CS2 duyệt yêu cầu của CS2.
// Tiền lệ: `lib/finance/hoa-don/quyen.ts` (`coQuyenKeToanTaiCoSo`) — cùng bệnh, cùng thuốc: tập cơ sở của ĐÚNG quyền ấy,
// suy từ NƠI NEO VAI (`centerScope` trong `lib/auth/actor.ts`), không từ tầm nhìn model.
//
// ⚠️ Người gọi VẪN phải `checkPermission(<quyền>)` (trần) và `passesScope` TRƯỚC — hàm này CHỈ THU HẸP, và đọc `actor.permissions` (dữ liệu v2).
// ⚠️ CHỈ ÁP Ở V2 (PROD). Ở v1 (mặc định local/CI, và là trạng thái khi rollback `RBAC_V2_ENABLED=false`) quyền là ma trận tĩnh KHÔNG có khái niệm
//    "quyền ở cơ sở nào" — thu hẹp theo dữ liệu v2 ở đó sẽ tước POS của kế toán cơ sở (v1 cho `payments:pos-check`, R-14) ngay lúc rollback.
//    Nền Hệ thống luật cứng 2: đường cũ không đổi hành vi. `isRbacV2Enabled()` đọc env MỖI LẦN gọi nên test đổi được giữa các ca.
// ⚠️ Đặt ở đây chứ không so inline trong action: lint `no-restricted-syntax` cấm `.centerId ===` trong tệp action và luật cứng #1 cấm điều kiện quyền inline.
import { isRbacV2Enabled } from "@/lib/flags";
import { actionCenterScope, type ActionScopeActor } from "@/lib/lms/report-card-core";

/** Mở phiếu · kiểm tra · báo admin · huỷ phiếu thẻ · tìm/gửi "nhập sai mã" (sale cơ sở · quản lý cơ sở · kế toán HO — KHÔNG kế toán cơ sở, T16). */
export const QUYEN_THU_THE_POS = "payments:pos-check" as const;
/** Duyệt / từ chối yêu cầu "nhập sai mã" (kế toán — TẬP CON của "được gắn tay", V58). */
export const QUYEN_KE_TOAN_SAI_MA = "payments:manage" as const;

/**
 * `true` khi quyền `action` của người này phủ cơ sở `centerId` của đơn (hoặc phủ mọi cơ sở). Fail-closed: đơn không có cơ sở ⇒ chỉ phạm vi `ALL` mới qua.
 * Ở v1 luôn `true` (không đổi hành vi đường cũ — xem đầu tệp).
 */
export function quyenTaiCoSoCuaDon(actor: ActionScopeActor, action: typeof QUYEN_THU_THE_POS | typeof QUYEN_KE_TOAN_SAI_MA, centerId: string | null): boolean {
  if (!isRbacV2Enabled()) return true;
  const tap = actionCenterScope(actor, action);
  return tap === "ALL" || (centerId !== null && tap.includes(centerId));
}
