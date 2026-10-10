// lib/lead/sla-clock.ts — S-9: AI ĐƯỢC LÀM MỚI ĐỒNG HỒ CHĂM SÓC của một phiếu.
//
// ─────────────────────────────────────────────────────────────────────────────
// Chốt của chủ dự án (27/08/2026): **chỉ chủ phiếu và cấp quản lý mới tắt được
// đồng hồ**. Người khác VẪN GHI CHÚ ĐƯỢC — ghi chú của họ chỉ không làm mới mốc
// SLA.
//
// Đây là ĐẢO CHIỀU có chủ đích so với S-6 (đợt 1, cùng ngày). Lần đó lỗ hổng
// "đồng nghiệp tắt hộ đồng hồ" được bịt bằng cách CẤM LUÔN việc ghi chú. Cách đó
// đóng được lỗ, nhưng đóng cả một việc hợp lệ: người trực máy nhận cuộc gọi nhỡ,
// Sale Hội sở vừa nhập phiếu, đồng nghiệp nghe máy hộ — họ vẫn cần ghi lại điều
// khách vừa nói, và ghi lại một câu nói thì không nguy hiểm.
//
// Thứ nguy hiểm là HỆ QUẢ ĐI KÈM mà không ai nhìn thấy. `recordLeadActivity`
// (đường ghi duy nhất) còn làm hai việc nữa:
//   · bump `Lead.lastActivityAt`  → tắt SLA-4 + cột "số ngày chưa tiếp cận lại";
//   · đóng `Lead.firstContactAt`  → tắt SLA-3 **vĩnh viễn** (mốc chỉ ghi một
//     lần, `updateMany where firstContactAt: null`, không có đường undo).
//
// Nên luật đúng là tách hai thứ ra: dòng nhật ký cứ lưu, đồng hồ thì không.
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️ Module THUẦN — cố ý KHÔNG import `@/lib/auth/check-permission`. Chỗ gọi tự
// hỏi quyền rồi truyền kết quả vào (`coQuyenDieuPhoi`). Hai lý do:
//   · hỏi quyền là việc chạm session + DB, kéo vào đây là biến mọi test của luật
//     này thành test cần mock next-auth — và luật thì đáng được kiểm thẳng;
//   · chỗ gọi mới biết `centerId` của phiếu để truyền vào `target` (scope CENTER
//     của RBAC v2), còn hàm này không nên phải biết hình dạng bản ghi Lead.
import type { Action } from "@/lib/auth/permissions";

/**
 * Quyền dùng để trả lời "người này có phải CẤP QUẢN LÝ của phiếu không".
 *
 * `leads:assign` = điều phối lead (Super Admin + Quản lý cơ sở), đúng nghĩa
 * "người có thẩm quyền trên phiếu của cả tổ". Tiền lệ: `toggleLeadShareAction`
 * đã hỏi đúng quyền này cho việc bật/tắt dùng chung.
 *
 * ⚠️ CỐ Ý KHÔNG dùng `leads:view-all`. Đó là quyền ĐỌC và nó đang được cấp cho
 * cả MARKETING (`lib/auth/permissions.ts`) — lấy nó làm cửa tắt đồng hồ nghĩa là
 * Marketing tắt được SLA trên khách của Sale, đúng loại hỏng mà chốt này sinh ra
 * để dẹp. Cổng SỬA lead (`actorMayMutateLead`) vẫn dùng `leads:view-all` như cũ;
 * hai câu hỏi khác nhau thì hỏi hai quyền khác nhau.
 */
export const QUYEN_DIEU_PHOI_LEAD: Action = "leads:assign";

export type QuyetDinhDongHo = {
  /** Người đang thao tác. */
  userId: string;
  /** Người PHỤ TRÁCH phiếu (`Lead.assignedToId`). `null` = phiếu chưa giao. */
  assignedToId: string | null;
  /** Kết quả `can()` cho `QUYEN_DIEU_PHOI_LEAD` trên cơ sở của phiếu. */
  coQuyenDieuPhoi: boolean;
};

/**
 * Lượt ghi này có được làm mới đồng hồ chăm sóc của phiếu không. THUẦN.
 *
 * ⚠️ Chủ phiếu ở đây là NGƯỜI PHỤ TRÁCH (`assignedToId`), KHÔNG phải người nhập.
 * "Khách của tôi" (được xem) rộng hơn "tôi phải gọi ai" (đồng hồ SLA): phiếu
 * Sale Hội sở nhập được chia về Sale cơ sở, nên mốc SLA thuộc về Sale cơ sở.
 * Cùng ranh giới với `leadPhuTrachWhere` — xem `lib/lead/ownership.ts`.
 *
 * ⚠️ Phiếu CHƯA GIAO (`assignedToId === null`) thì không ai là chủ: chỉ cấp quản
 * lý làm mới được. Cho người đầu tiên đi ngang qua đóng mốc "đã liên hệ lần đầu"
 * là tắt chuông của một phiếu chưa ai nhấc máy — đúng thứ SLA-3 sinh ra để kêu.
 */
export function duocLamMoiDongHoChamSoc(input: QuyetDinhDongHo): boolean {
  if (input.assignedToId !== null && input.assignedToId === input.userId) return true;
  return input.coQuyenDieuPhoi;
}
