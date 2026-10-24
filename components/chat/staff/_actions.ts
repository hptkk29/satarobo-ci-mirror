"use server";

// components/chat/staff/_actions.ts — 3 Server Action CHỈ NHÂN VIÊN dùng, bổ sung cho
// `lib/chat/_actions.ts` (cửa chung: gửi CHAT, thu hồi, mark-read, phân trang, reconcile).
//
// Vì sao tách làm hai file thay vì dồn hết vào `lib/chat/_actions.ts`: 3 hàm dưới đây
// KHÔNG BAO GIỜ được gọi từ bề mặt phụ huynh (gửi thông báo, gỡ tin người khác, xem ai
// đã đọc — permissions.md đều là ô ❌ của PH). Để chúng ở cạnh màn hình nhân viên thì
// đọc code là thấy ngay ai gọi cái gì. Cửa chung vẫn là `lib/chat/_actions.ts` —
// KHÔNG chép lại hàm nào của nó ở đây.
//
// ⚠️ LUẬT E-bis #1 — module `"use server"` CHỈ được export async function. Không
// `export type`, không hằng, không re-export. Kiểu dùng chung nằm ở `./types.ts`.
//
// ⚠️ KHÔNG kiểm quyền ở đây: mỗi hàm lõi tự đi qua `runAction` → `can()` với target đọc
// từ DB (lớp/cơ sở của hội thoại). Thêm một tầng kiểm ở đây là tạo nguồn sự thật thứ hai.
import { auth } from "@/lib/auth";
import { sendAnnouncement, getAnnouncementReadStats } from "@/lib/chat/announcements";
import { deleteMessageAsModerator } from "@/lib/chat/moderation";
import type { StaffActionResult, StaffAnnouncementStats } from "./types";

/** F-ANN — gửi ANNOUNCEMENT (US-10 AC1/AC2: quyền `chat:announce` + quota 10/ngày/lớp). */
export async function sendStaffAnnouncement(input: unknown) {
  return sendAnnouncement(input);
}

/**
 * US-12 AC2 — gỡ tin NGƯỜI KHÁC, bắt buộc lý do.
 * Thiếu lý do KHÔNG chặn ở client: zod trong lõi trả VALIDATION + `field: "reason"` để
 * UI gắn lỗi đúng ô nhập (TS-03.6b đòi 400, không phải 403).
 */
export async function deleteStaffMessage(input: unknown) {
  return deleteMessageAsModerator(input);
}

/**
 * US-10 AC4 — "đã đọc 12/30" + danh sách ai chưa đọc.
 *
 * Quyền `chat:announce` được kiểm TRONG lõi (`getAnnouncementReadStats`) với target đọc
 * từ DB: PH nằm trong nhóm gọi thẳng action này vẫn nhận PERMISSION_DENIED.
 * Lỗi được đổi thành `ActionResult` chứ không ném ra: Next che nội dung exception của
 * Server Action trên production, người dùng sẽ chỉ thấy "an error occurred" thay vì
 * thông điệp tiếng Việt đã soạn sẵn.
 */
export async function loadStaffAnnouncementStats(
  messageId: string,
): Promise<StaffActionResult<StaffAnnouncementStats>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: { code: "AUTH", message: "Chưa đăng nhập" } };
  }
  try {
    const stats = await getAnnouncementReadStats(messageId, session.user.id);
    return { ok: true, data: stats };
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: unknown }).code)
        : "INTERNAL";
    const message =
      err instanceof Error ? err.message : "Không lấy được thống kê đã đọc — vui lòng thử lại";
    return { ok: false, error: { code, message } };
  }
}
