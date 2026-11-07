import { z } from "zod";
import type { LeadChildStatus } from "@prisma/client";

/**
 * C-06 — RỚT: trạng thái theo TỪNG CON, lý do theo PHỤ HUYNH.
 *
 * Chủ dự án chốt 24/08/2026 hai điều đi kèm nhau:
 *  · B5    — ô lý do rớt (`Lead.lostNote` + `Lead.lostAt`) đặt ở CẤP PHỤ HUYNH, còn
 *            trạng thái rớt vẫn ở `LeadChild.status = LOST` (cấp con).
 *  · 12(b) — KHÔNG có danh mục lý do rớt; chỉ một ô ghi chú TỰ DO và BẮT BUỘC.
 *            Đánh đổi đã chấp nhận: không nhóm/đếm được "top lý do rớt".
 *
 * Hai tầng lệch nhau sinh ra một bẫy mất dữ liệu mà chỗ này là nơi duy nhất canh:
 * phiếu hai con cùng rớt, gỡ một đứa ra mà xoá luôn `lostNote` thì LÝ DO CỦA ĐỨA CÒN
 * LẠI biến mất. Vì vậy quyết định "ghi / xoá / để yên" tách hẳn thành hàm thuần, kiểm
 * được không cần DB, thay vì nằm rải trong Server Action.
 */

export const LOST_CHILD_STATUS = "LOST" as const;

// Nhãn/màu ở file riêng để phía client lấy được mà không kéo theo zod.
export { LEAD_CHILD_STATUS_LABEL, LEAD_CHILD_STATUS_BADGE } from "./lost-status-labels";

/**
 * Các trạng thái được phép GỠ VỀ khi bỏ đánh dấu rớt — cố ý KHÔNG có `LOST`.
 *
 * Để `LOST` lọt vào đây là mở một đường đánh dấu rớt đi vòng qua ô lý do bắt buộc,
 * tức vô hiệu hoá đúng điều kiện mà C-06 sinh ra để bảo đảm.
 */
export const REVIVE_CHILD_STATUSES = [
  "NEW",
  "CONSULTING",
  "TRIAL_SCHEDULED",
  "TRIAL_ATTENDED",
  "ENROLLED",
] as const satisfies readonly Exclude<LeadChildStatus, "LOST">[];

export const lostNoteSchema = z
  .string()
  .trim()
  .min(1, "Bắt buộc nhập lý do rớt")
  .max(2000, "Lý do rớt tối đa 2000 ký tự");

export const markChildLostSchema = z.object({
  leadChildId: z.string().min(1, "Thiếu học sinh"),
  lostNote: lostNoteSchema,
});

export const unmarkChildLostSchema = z.object({
  leadChildId: z.string().min(1, "Thiếu học sinh"),
  status: z.enum(REVIVE_CHILD_STATUSES),
});

/**
 * `null` = KHÔNG đụng gì tới phiếu (khác hẳn `{ lostNote: null }` = XOÁ).
 * Phân biệt được hai thứ đó chính là nội dung của bẫy (b).
 */
export type LeadLostPatch =
  | { lostNote: string; lostAt: Date }
  | { lostNote: null; lostAt: null }
  | null;

/**
 * Quyết định phần ghi ở CẤP PHỤ HUYNH cho một lượt đổi trạng thái rớt của MỘT con.
 *
 * @param lostChildCount số con của phiếu còn đang RỚT **sau** lượt cập nhật này —
 *   phải đếm trong cùng transaction, sau khi đã ghi trạng thái con.
 */
export function decideLeadLostFields(args: {
  intent: "mark" | "unmark";
  lostChildCount: number;
  lostNote?: string | null;
  now: Date;
}): LeadLostPatch {
  if (!Number.isInteger(args.lostChildCount) || args.lostChildCount < 0) {
    // Đếm hỏng mà vẫn chạy tiếp thì nhánh "xoá" là nhánh mặc định — đúng hướng mất
    // dữ liệu. Thà dừng cả giao dịch.
    throw new Error("Số con đang rớt không hợp lệ");
  }

  if (args.intent === "mark") {
    const note = (args.lostNote ?? "").trim();
    if (!note) throw new Error("Bắt buộc nhập lý do rớt");
    // Con rớt sau ĐÈ ghi chú của con trước — hệ quả đã biết và đã chấp nhận của B5.
    // Lý do của từng con lần ra ở AuditLog + LeadActivity, nơi mỗi lượt đánh dấu ghi
    // kèm `leadChildId` và tên con.
    return { lostNote: note, lostAt: args.now };
  }

  // Gỡ rớt: chỉ được xoá lý do khi KHÔNG CÒN con nào rớt.
  if (args.lostChildCount > 0) return null;
  return { lostNote: null, lostAt: null };
}
