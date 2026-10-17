"use server";

// lib/chat/_actions.ts — CỬA DUY NHẤT cho Client Component gọi vào module chat.
//
// ⚠️ LUẬT E-bis #1 (docs/chat-realtime/00-dieu-chinh-cho-repo.md): file `"use server"`
// CHỈ được export **async function**. Server-actions loader sinh export VALUE cho MỌI
// tên được export — một `export type` / `export const` ở đây làm cả module ném
// `ReferenceError` lúc eval ⇒ chết TOÀN BỘ action trong file. Vì vậy:
//   - KHÔNG `export type`, KHÔNG `export const`, KHÔNG re-export `export { x } from`.
//   - Cần type ở nơi khác → import thẳng từ file định nghĩa (`lib/chat/queries.ts`, …).
//
// Vì sao có file này thay vì gọi thẳng: các hàm trong `lib/chat/queries.ts` /
// `announcements.ts` nhận `userId` TƯỜNG MINH (test được không cần phiên). Ở biên
// HTTP thì `userId` KHÔNG BAO GIỜ được nhận từ client — mọi hàm dưới đây tự `auth()`
// rồi mới truyền xuống. `sendChatMessage`/`recallOwnMessage` đã tự `auth()` bên trong
// nên chỉ bọc mỏng để client có một chỗ import duy nhất.

import { auth } from "@/lib/auth";
import { isParentOnly } from "@/lib/auth/permissions";
import { hasAcceptedChatPolicy } from "@/lib/chat/policy";
import { listChatAttachments, sendChatMessage } from "@/lib/chat/messages";
import { resolveActor } from "@/lib/auth/actor";
import { openDmAsActor } from "@/lib/chat/dm";
import {
  adminLookupConversationAsActor,
  setConversationLockAsActor,
} from "@/lib/chat/admin";
import { recallOwnMessage } from "@/lib/chat/moderation";
import { markAnnouncementRead } from "@/lib/chat/announcements";
import {
  fetchMessagesSince,
  getMessagesPage,
  markConversationRead,
  type MessagePage,
  type MessagesSincePage,
} from "@/lib/chat/queries";
import type { ActionResult } from "@/lib/actions/factory";
import type { ChatAttachmentRef, SentChatMessage } from "@/lib/chat/messages";
import type { DeletedChatMessage } from "@/lib/chat/moderation";
import type { OpenedDm } from "@/lib/chat/dm";
import type {
  AdminConversationTranscript,
  ConversationLockResult,
} from "@/lib/chat/admin";

/** Lớp lỗi nghiệp vụ của module chat — thông điệp đã viết SẴN cho người dùng cuối. */
const DOMAIN_ERROR_NAMES = new Set(["ChatQueryError", "ChatAnnouncementError"]);

/**
 * US-16 AC2 — CỬA THỨ BA của cổng chính sách.
 *
 * Cổng đó có ĐÚNG ba cửa vào nội dung chat, và chặn hai cửa là chưa chặn:
 *   1. HTML   — `app/(portal)/portal/tin-nhan/layout.tsx` + 4 page RSC.
 *   2. Realtime — `app/api/chat/realtime-token/route.ts` (không vé thì không nghe được kênh).
 *   3. **Server Action — chính file này.** Server Action là endpoint HTTP thật: biết id hội
 *      thoại là gọi thẳng được, không đi qua layout nào. Bỏ trống cửa này thì phụ huynh chưa
 *      bấm đồng ý vẫn `getMessagesPageAction(convId, null)` ra nguyên lịch sử — tức AC2 chỉ
 *      là một tấm màn che, không phải cổng.
 *
 * CHỈ áp cho tài khoản THUẦN phụ huynh: giáo viên/quản lý không bao giờ thấy màn chính sách
 * nên chặn họ ở đây là tắt chat của nhân viên. Lỗi đọc DB ⇒ coi như CHƯA đồng ý (fail-closed
 * — đây là cổng nội dung, hỏng thì phải đóng chứ không phải mở).
 *
 * Trả `null` nghĩa là ĐI TIẾP ĐƯỢC.
 */
async function chatPolicyBlock(
  user: { id: string; role?: string | null; roles?: string[] | null },
): Promise<{ ok: false; error: { code: string; message: string } } | null> {
  if (!isParentOnly(user)) return null;
  const accepted = await hasAcceptedChatPolicy(user.id).catch(() => false);
  if (accepted) return null;
  return {
    ok: false,
    error: {
      code: "CHAT_POLICY_REQUIRED",
      message: "Vui lòng đồng ý quy định sử dụng tin nhắn trước khi vào chat.",
    },
  };
}

/**
 * Lỗi tầng đọc → cùng hình dạng `ActionResult` với các action ghi (client chỉ xử 1 kiểu).
 *
 * CHỈ lỗi nghiệp vụ mới được đi nguyên văn ra client. Lỗi khác (Prisma, mạng…) trả
 * thông điệp chung — `PrismaClientKnownRequestError` cũng có thuộc tính `code`, lọc
 * theo `code` là đủ để rò tên bảng/ràng buộc ra màn hình phụ huynh.
 */
function readFail(err: unknown): { ok: false; error: { code: string; message: string } } {
  if (err instanceof Error && DOMAIN_ERROR_NAMES.has(err.name)) {
    const code =
      "code" in err && typeof (err as { code: unknown }).code === "string"
        ? (err as { code: string }).code
        : "FORBIDDEN";
    return { ok: false, error: { code, message: err.message } };
  }
  console.error("[chat/_actions] lỗi không lường trước:", err);
  return {
    ok: false,
    error: { code: "INTERNAL", message: "Không tải được tin nhắn — vui lòng thử lại" },
  };
}

// ─── Ghi ────────────────────────────────────────────────────────────────────

/** F-SEND — gửi tin CHAT. `sendChatMessage` tự `auth()` + rate limit + broadcast. */
export async function sendChatMessageAction(
  input: unknown,
): Promise<ActionResult<SentChatMessage>> {
  // Cổng chính sách áp cho cả đường GHI: chưa đồng ý quy định mà đã nhắn được vào nhóm có
  // giáo viên và phụ huynh khác thì "bấm đồng ý mới vào" (AC2) không còn nghĩa gì.
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: { code: "AUTH", message: "Chưa đăng nhập" } };
  const blocked = await chatPolicyBlock(session.user);
  if (blocked) return blocked;
  return sendChatMessage(input);
}

/** US-12 AC1 — tác giả tự thu hồi tin ≤15'. Server là chốt chặn, không phải nút UI. */
export async function recallOwnMessageAction(
  input: unknown,
): Promise<ActionResult<DeletedChatMessage>> {
  return recallOwnMessage(input);
}

/**
 * US-13 — "Nhắn riêng": mở (hoặc mở lại) hội thoại 1-1 GV↔PH rồi trả `conversationId`
 * để client điều hướng.
 *
 * Phần ghép phiên nằm ở ĐÂY chứ không trong `lib/chat/dm.ts`: file đó phải chạy được
 * ngoài Next (vitest node của bộ ma trận quyền, cron, script) nên không được import
 * `next-auth`. Quyền + quan hệ dạy học vẫn do `openDmAsActor` kiểm — nút trên UI KHÔNG
 * phải chốt chặn. Không `revalidatePath`: người bấm được điều hướng thẳng sang hội thoại.
 */
export async function openDmAction(input: unknown): Promise<ActionResult<OpenedDm>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: { code: "AUTH", message: "Chưa đăng nhập" } };
  }
  const actor = await resolveActor(session.user.id);
  const actorName = session.user.name ?? session.user.email ?? session.user.id;
  return openDmAsActor(actor, actorName, input);
}

/**
 * US-15 AC1/AC2 (F-AUDIT) — Admin mở nội dung hội thoại mình KHÔNG thuộc về.
 *
 * Modal nhập lý do ở UI chỉ là trải nghiệm: `adminLookupConversationAsActor` tự kiểm zod
 * (thiếu/ngắn lý do → VALIDATION), `can("chat:admin")` (QLCS → PERMISSION_DENIED, AC5) và
 * ghi AuditLog TRƯỚC khi đọc một dòng tin nào. Gọi thẳng action này không kèm `reason`
 * cũng không lấy được gì (AC1 "không route/API nào vòng qua được").
 */
export async function adminLookupConversationAction(
  input: unknown,
): Promise<ActionResult<AdminConversationTranscript>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: { code: "AUTH", message: "Chưa đăng nhập" } };
  }
  const actor = await resolveActor(session.user.id);
  const actorName = session.user.name ?? session.user.email ?? session.user.id;
  return adminLookupConversationAsActor(actor, actorName, input);
}

/**
 * US-15 AC3 (F-LOCK) — khoá / mở khoá hội thoại. Bắt buộc lý do, ghi audit cả hai chiều,
 * phát `conversation.locked` xuống `conv:{id}` để client đang mở đổi trạng thái ô nhập
 * ngay. Không `revalidatePath`: trang chi tiết tự làm mới phần của nó sau khi action trả.
 */
export async function setConversationLockAction(
  input: unknown,
): Promise<ActionResult<ConversationLockResult>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: { code: "AUTH", message: "Chưa đăng nhập" } };
  }
  const actor = await resolveActor(session.user.id);
  const actorName = session.user.name ?? session.user.email ?? session.user.id;
  return setConversationLockAsActor(actor, actorName, input);
}

/** US-07 AC5 — hội thoại đang mở ở foreground: `unreadCount` về 0. */
export async function markConversationReadAction(
  conversationId: string,
  lastReadMessageId: string | null,
): Promise<ActionResult<{ unreadCount: number }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: { code: "AUTH", message: "Chưa đăng nhập" } };
  try {
    const res = await markConversationRead(conversationId, session.user.id, lastReadMessageId);
    return { ok: true, data: { unreadCount: res.unreadCount } };
  } catch (err) {
    return readFail(err);
  }
}

/**
 * US-10 AC3 — ghi mốc PH đã đọc thông báo. UI gọi khi thông báo VÀO VIEWPORT
 * (IntersectionObserver), KHÔNG phải khi mở app: server không tự suy ra được điều đó.
 * Idempotent — gọi lại giữ nguyên `readAt`.
 */
export async function markAnnouncementReadAction(
  messageId: string,
): Promise<ActionResult<{ alreadyRead: boolean }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: { code: "AUTH", message: "Chưa đăng nhập" } };
  try {
    const res = await markAnnouncementRead(messageId, session.user.id);
    return { ok: true, data: { alreadyRead: res.alreadyRead } };
  } catch (err) {
    return readFail(err);
  }
}

// ─── Đọc (cho client — RSC gọi thẳng `lib/chat/queries.ts`) ─────────────────

/**
 * US-07 AC2 — đường BÙ TIN duy nhất khi kênh realtime rớt. `useChatChannel` gọi hàm
 * này ở MỌI lần channel về `SUBSCRIBED`.
 */
export async function fetchMessagesSinceAction(
  conversationId: string,
  lastSeenMessageId: string | null,
): Promise<ActionResult<MessagesSincePage>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: { code: "AUTH", message: "Chưa đăng nhập" } };
  const blocked = await chatPolicyBlock(session.user);
  if (blocked) return blocked;
  try {
    return { ok: true, data: await fetchMessagesSince(conversationId, session.user.id, lastSeenMessageId) };
  } catch (err) {
    return readFail(err);
  }
}

/**
 * US-11 — ảnh của một lô tin đang hiển thị.
 *
 * RSC lo dữ liệu BAN ĐẦU (30 tin đầu đã kèm ảnh); action này chỉ phục vụ những tin đến
 * SAU khi mở màn hình: tin realtime, tin tải thêm khi cuộn lên, tin bù sau khi mất mạng.
 * Không phải "useEffect fetch dữ liệu ban đầu".
 */
export async function listChatAttachmentsAction(
  conversationId: string,
  messageIds: string[],
): Promise<ActionResult<ChatAttachmentRef[]>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: { code: "AUTH", message: "Chưa đăng nhập" } };
  const blocked = await chatPolicyBlock(session.user);
  if (blocked) return blocked;
  try {
    return { ok: true, data: await listChatAttachments(conversationId, session.user.id, messageIds) };
  } catch (err) {
    return readFail(err);
  }
}

/** US-09 AC1 — cuộn lên tải tiếp 30 tin cũ hơn (cursor `(createdAt, id)`, không OFFSET). */
export async function getMessagesPageAction(
  conversationId: string,
  cursor: string | null,
): Promise<ActionResult<MessagePage>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: { code: "AUTH", message: "Chưa đăng nhập" } };
  const blocked = await chatPolicyBlock(session.user);
  if (blocked) return blocked;
  try {
    return { ok: true, data: await getMessagesPage(conversationId, session.user.id, { cursor }) };
  } catch (err) {
    return readFail(err);
  }
}
