// components/chat/staff/types.ts — kiểu dữ liệu đi qua biên RSC → Client của màn chat
// nhân viên (site admin + site giáo viên).
//
// VÌ SAO KHAI LẠI THAY VÌ IMPORT TỪ `lib/chat/queries.ts`: file đó import `@/lib/db`
// (Prisma). `import type` bị xoá lúc biên dịch nên về lý thuyết an toàn, nhưng chỉ cần
// một lần ai đó đổi `import type` thành `import` (vd để lấy hằng `DELETED_MESSAGE_TEXT`)
// là kéo cả Prisma vào bundle client. Khai lại ở đây = biên rõ ràng, đúng tiền lệ
// `components/chat/chat-store.ts` (khối đầu file đó).
//
// `createdAt` để kiểu `Date`: React Server Components serialize Date qua biên RSC nguyên
// vẹn, và `useChatChannel`/`chat-store` nhận cả `Date` lẫn chuỗi ISO.

export type StaffChatKind = "CHAT" | "ANNOUNCEMENT" | "SYSTEM";

/** Một tin trong luồng — đúng hình dạng `ChatMessageView` của `lib/chat/queries.ts`. */
export type StaffChatMessage = {
  id: string;
  conversationId: string;
  kind: StaffChatKind;
  senderId: string | null;
  body: string;
  deleted: boolean;
  replyToId: string | null;
  clientMsgId: string | null;
  createdAt: Date;
};

/**
 * Thành viên hội thoại — đúng 3 mẩu luồng chat cần để gắn tên vào bong bóng tin.
 *
 * ⚠️ CỐ Ý KHÔNG CÓ `contact` (gỡ 09/08): kiểu này được truyền vào `ChatThread`
 * (Client Component) nên MỌI khoá của nó đi xuống trình duyệt trong payload RSC, kể cả
 * khoá không component nào render. Liên hệ chỉ xuất hiện ở màn "Thành viên" — nơi
 * `getConversationMembers` quyết định ai được thấy (BR-30).
 */
export type StaffChatMember = {
  userId: string;
  displayName: string;
  roleLabel: string;
};

/** Một dòng trong danh sách hội thoại (M1). */
export type StaffConversationItem = {
  conversationId: string;
  type: string;
  displayName: string;
  /** US-08 AC4 — nhóm này xếp dưới khối ACTIVE. */
  isArchived: boolean;
  statusLabel: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
  preview: string | null;
};

/**
 * Quyền của người đang xem TRÊN CHÍNH hội thoại đang mở — tính bằng `checkPermission`
 * ở SERVER (US-10 AC1: "assert cả UI lẫn server"). UI chỉ dùng để ẩn/hiện nút; mọi
 * Server Action vẫn tự kiểm quyền lần nữa qua `runAction` → `can()`.
 */
export type StaffChatCapabilities = {
  canSend: boolean;
  canAnnounce: boolean;
  canModerate: boolean;
};

/** US-10 AC4 — "đã đọc 12/30" + ai chưa đọc. */
export type StaffAnnouncementStats = {
  messageId: string;
  readCount: number;
  totalRecipients: number;
  unreadMembers: { userId: string; displayName: string }[];
};

/** Cùng hợp đồng với `ActionResult` của `lib/actions/factory.ts` (mã EN + thông điệp VI). */
export type StaffActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; field?: string } };
