// lib/orders/create-guard.ts — G-A (biên bản chốt 4 cổng, 21/08/2026).
//
// `orders:create` là quyền HẸP cấp cho SALES_CSM để mở trục chốt đơn
// (Order → recordPayment → đủ điều kiện convert). Người có `orders:manage`
// (SUPER_ADMIN / CENTER_MANAGER / ACCOUNTANT) giữ nguyên toàn quyền như cũ.
//
// VÌ SAO TÁCH RA HÀM THUẦN: quy tắc "chỉ đơn gắn lead của mình" là chỗ dễ sai và
// dễ bị bỏ quên khi refactor. Tách ra để có test chạy trong CI (Vitest, không DB)
// thay vì chỉ dựa vào e2e — hợp với luật cứng #5 (test trước) và với thực tế
// `scopedDb` KHÔNG che đường GHI (mọi write phải tự guard).
//
// Tầng gọi có trách nhiệm nạp `lead` bằng `scopedDb(actor)` — nhờ vậy lead ngoài
// cơ sở của actor trả về `null` và rơi vào nhánh LEAD_NOT_FOUND ở đây.

export type OrderCreateGuardInput = {
  /** Actor có `orders:manage` (toàn quyền đơn hàng) hay không. */
  canManageAll: boolean;
  /** `leadId` người dùng gửi lên (có thể rỗng/thiếu). */
  leadId: string | null | undefined;
  /** Lead đọc được qua `scopedDb(actor)`; `null` = không tồn tại HOẶC ngoài tầm nhìn. */
  lead: { id: string; assignedToId: string | null; centerId?: string | null } | null;
  /** `session.user.id` của người đang thao tác. */
  actorUserId: string;
};

export type OrderCreateGuardResult =
  | {
      ok: true;
      /**
       * Có giá trị KHI VÀ CHỈ KHI ownership được áp (người không có
       * `orders:manage`): cơ sở của đơn phải lấy theo lead, **không** theo giá
       * trị client gửi lên. Form cho phép để trống cơ sở, mà `passesScope` chỉ
       * chạy khi `centerId` khác null ⇒ tin client thì Sale tạo được đơn "không
       * cơ sở", vô hình với chính cơ sở mình và lọt khỏi báo cáo theo cơ sở.
       */
      enforcedCenterId?: string | null;
    }
  | {
      ok: false;
      code: "LEAD_REQUIRED" | "LEAD_NOT_FOUND" | "NOT_LEAD_OWNER";
      message: string;
    };

/**
 * Trả về `{ ok: true }` nếu actor được phép tạo đơn với `leadId` đã cho.
 *
 * Quy tắc:
 * 1. Có `orders:manage` ⇒ như cũ, không ràng buộc gì thêm (kể cả đơn vãng lai).
 * 2. Chỉ có `orders:create` ⇒ **bắt buộc** gắn lead, và lead đó phải do chính
 *    mình phụ trách. Lead vô chủ cũng bị từ chối — nhận lead phải đi qua đường
 *    phân công, không được tự nhận bằng cách tạo một cái đơn.
 */
export function checkOrderCreateOwnership(
  input: OrderCreateGuardInput,
): OrderCreateGuardResult {
  if (input.canManageAll) return { ok: true };

  const leadId = input.leadId?.trim();
  if (!leadId) {
    return {
      ok: false,
      code: "LEAD_REQUIRED",
      message:
        "Bạn chỉ tạo được đơn gắn với khách của mình. Mở khách trong danh sách rồi bấm tạo đơn từ đó.",
    };
  }

  if (!input.lead) {
    return {
      ok: false,
      code: "LEAD_NOT_FOUND",
      message: "Không tìm thấy khách này trong danh sách của bạn.",
    };
  }

  if (input.lead.assignedToId !== input.actorUserId) {
    // Cố ý KHÔNG nêu tên người đang phụ trách: tránh lộ danh sách khách của đồng
    // nghiệp và tránh tranh chấp "lead này của ai".
    return {
      ok: false,
      code: "NOT_LEAD_OWNER",
      message: "Khách này không do bạn phụ trách nên bạn không tạo đơn cho khách được.",
    };
  }

  return { ok: true, enforcedCenterId: input.lead.centerId ?? null };
}
