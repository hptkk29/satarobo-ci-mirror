"use client";

// components/chat/active-conversation.ts — "hội thoại nào đang mở trên màn hình này".
//
// US-07 AC5: hội thoại đang mở ở tab đang hiện thì tin mới được đánh dấu ĐÃ ĐỌC ngay
// (`markConversationRead`), nên badge tổng KHÔNG được cộng thêm cho nó. Badge lại nằm ở
// thanh nav — cách luồng chat vài tầng component và có khi ở layout khác hẳn — nên hai
// bên cần một mẩu trạng thái chung.
//
// Cố ý KHÔNG dùng React Context: badge của site GV nằm trong `AppShell` (layout), luồng
// chat nằm trong `page` — Context phải bọc từ layout xuống, kéo theo việc biến layout của
// cả ba site thành client component. Một biến module trong cùng bundle trình duyệt là đủ:
// mỗi tab có đúng một luồng chat mở tại một thời điểm.
//
// Đây KHÔNG phải nguồn sự thật của bất kỳ con số nào — chỉ là bộ lọc "bump này có phải của
// hội thoại tôi đang nhìn không". Sai lệch tệ nhất: hỏi lại server thừa một lần.

let activeConversationId: string | null = null;

/** Luồng chat gọi khi mở (`id`) và khi rời (`null`). */
export function setActiveConversation(id: string | null): void {
  activeConversationId = id;
}

/** Nhả quyền chỉ khi CHÍNH mình đang giữ — tránh luồng cũ unmount sau luồng mới mount. */
export function clearActiveConversation(id: string): void {
  if (activeConversationId === id) activeConversationId = null;
}

export function getActiveConversation(): string | null {
  return activeConversationId;
}

/**
 * Bump này có thuộc hội thoại đang mở TRƯỚC MẮT người dùng không?
 * Tab ẩn ⇒ `false`: lúc đó `markConversationRead` không chạy, unread server CÓ tăng thật.
 */
export function isBumpOfOpenConversation(
  conversationId: string,
  isForeground: () => boolean = defaultIsForeground,
): boolean {
  return activeConversationId === conversationId && isForeground();
}

function defaultIsForeground(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}
