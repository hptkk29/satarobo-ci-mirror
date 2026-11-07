// lib/notifications/pending-sync.ts — nhận dạng dedupeKey do vòng ĐỒNG BỘ VIỆC TỒN sinh ra.
//
// VÌ SAO TỒN TẠI (BUG-1, đo 19/08/2026):
// `syncStaffNotifications` reconcile theo kiểu "cái gì không còn trong danh sách mong muốn
// thì đánh dấu ĐÃ ĐỌC". Danh sách mong muốn chỉ gồm khoá sinh từ `getPendingTasks`
// (`<loại>:pending` / `<loại>:overdue`), trong khi bảng `StaffNotification` còn nhận thông báo
// từ ~15 nguồn KHÁC (cron nhắc chốt buổi, dạy thay, điểm danh bị sửa hồi tố, SLA lead, sinh
// nhật, yêu cầu phụ huynh, tin nhắn phụ huynh…). Hệ quả: mở chuông là những thông báo đó bị
// dập `readAt` NGAY TRONG CHÍNH request đó — chúng chưa từng làm badge nhảy một lần nào.
//
// Cách vá: vòng reconcile chỉ được đụng vào đúng phạm vi nó quản lý. Mọi khoá không khớp mẫu
// dưới đây là thông báo do SỰ KIỆN sinh ra và chỉ người dùng mới được quyết định đã đọc.
//
// THUẦN — chỉ `import type` (bị xoá lúc biên dịch) nên Vitest nạp được mà không cần DB.

import type { PendingTaskType } from "@/lib/pending-tasks";

/** Hai hậu tố mà vòng đồng bộ việc tồn sinh ra cho mỗi loại việc. */
export const PENDING_SYNC_KINDS = ["pending", "overdue"] as const;
export type PendingSyncKind = (typeof PENDING_SYNC_KINDS)[number];

/**
 * Danh sách loại việc mà vòng đồng bộ SỞ HỮU. Phải khớp `PendingTaskType` cả hai chiều:
 *  - `satisfies` chặn chiều thừa/sai chính tả ở đây;
 *  - `MissingPendingSyncType` chặn chiều thiếu (thêm loại việc mới mà quên khai vào đây
 *    thì `pnpm typecheck` đỏ, chứ không âm thầm để loại đó thoát khỏi reconcile).
 */
export const PENDING_SYNC_TYPES = [
  "class_approval",
  "timesheet_adjust",
  "parent_request",
  "media_approval",
  "session_incomplete",
  "center_checklist",
  "lead_followup",
  "renewal",
  "student_risk",
  "student_care",
  "student_birthday",
  "class_no_teacher",
  "registered_stale",
  "report_card_milestone",
  // EL-06 — khoá đào tạo nội bộ tới hạn. Khai ở đây vì vòng đồng bộ SINH RA khoá
  // `elearning_due:pending`/`:overdue`; thiếu dòng này thì reconcile coi chúng là
  // thông báo của nguồn khác và không bao giờ dọn, để chuông đọng mãi.
  "elearning_due",
] as const satisfies readonly PendingTaskType[];

/** Rỗng = khai đủ. Còn phần tử = có loại việc chưa khai ở `PENDING_SYNC_TYPES`. */
export type MissingPendingSyncType = Exclude<
  PendingTaskType,
  (typeof PENDING_SYNC_TYPES)[number]
>;
type AssertNoMissing<T extends never> = T;
export type PendingSyncTypesAreExhaustive = AssertNoMissing<MissingPendingSyncType>;

const PENDING_SYNC_TYPE_SET: ReadonlySet<string> = new Set(PENDING_SYNC_TYPES);

/** Khoá gộp cho một loại việc tồn. Dùng ở cả nơi ghi lẫn nơi reconcile — đừng nối chuỗi tay. */
export function pendingSyncKey(type: PendingTaskType, kind: PendingSyncKind): string {
  return `${type}:${kind}`;
}

/**
 * `dedupeKey` này có thuộc quyền quản lý của vòng đồng bộ việc tồn không?
 *
 * Cắt ở dấu `:` CUỐI CÙNG chứ không phải dấu đầu tiên: khoá của các nguồn sự kiện có nhiều
 * đoạn (`sla:idle:<leadId>`, `attendance.edited:<sessionId>`) và cách cắt sai sẽ nhận nhầm.
 * Đằng nào phần đầu cũng phải nằm trong danh sách 14 loại thì mới tính.
 */
export function isPendingSyncKey(dedupeKey: string): boolean {
  const cut = dedupeKey.lastIndexOf(":");
  if (cut <= 0) return false;
  const kind = dedupeKey.slice(cut + 1);
  if (kind !== "pending" && kind !== "overdue") return false;
  return PENDING_SYNC_TYPE_SET.has(dedupeKey.slice(0, cut));
}
