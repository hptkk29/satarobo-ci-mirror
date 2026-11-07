// components/chat/portal/types.ts — hình dạng dữ liệu RSC → Client Component.
//
// Khai lại thay vì import `ChatMessageView`/`ConversationMemberView` từ
// `lib/chat/queries.ts`: file đó import `@/lib/db` (Prisma), chạm vào nó từ Client
// Component là kéo Prisma vào bundle. Các type dưới đây là SUBSET tương thích cấu
// trúc — RSC gán thẳng kết quả query vào là hợp lệ, không cần map tay.

/** Trùng `MessageKind` trong prisma/schema.prisma. */
export type PortalChatKind = "CHAT" | "ANNOUNCEMENT" | "SYSTEM";

/** Một tin nhắn như `toMessageView()` trả về (tin đã gỡ: `body` đã là text thay thế). */
export type PortalChatMessage = {
  id: string;
  conversationId: string;
  kind: PortalChatKind;
  senderId: string | null;
  body: string;
  deleted: boolean;
  replyToId: string | null;
  clientMsgId: string | null;
  createdAt: Date;
};

/**
 * Thành viên như `getConversationMembers()` trả về — CHỈ những khoá dùng để hiển thị
 * tên người gửi. Khoá `contact` cố ý KHÔNG có mặt ở đây: luồng chat không hiện liên hệ,
 * và việc ẩn liên hệ (BR-30) đã quyết định ở tầng query, UI không lọc lại.
 */
export type PortalChatMember = {
  userId: string;
  displayName: string;
  roleLabel: string;
};
