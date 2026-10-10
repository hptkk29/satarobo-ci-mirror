"use client";

// components/chat/read-signal.ts — "vừa có một hội thoại được đánh dấu ĐÃ ĐỌC".
//
// Vì sao phải có tín hiệu riêng, không dùng chung kênh `user:{id}`:
//   Kênh user chỉ mang `bump` (= CÓ TIN MỚI) và `resync`. Việc ĐỌC tin không sinh bump nào
//   — nó chỉ là một UPDATE `ConversationParticipant.unreadCount = 0`. Nếu badge tổng ở
//   thanh nav chỉ nghe kênh user thì nó chỉ biết TĂNG: đọc hết tin xong badge vẫn treo số
//   cũ tới khi F5, vì layout RSC (nơi tính `countChatUnreadForUser`) KHÔNG render lại khi
//   điều hướng client-side trong cùng một layout.
//
// Vì sao KHÔNG dùng `router.refresh()` cho việc này: badge chỉ cần MỘT con số, còn refresh
// chạy lại toàn bộ RSC của trang đang mở (cả ba trang chat đều `force-dynamic`) — nặng hơn
// nhiều lần một `GET /api/chat/unread`, và trên portal là trang mobile.
//
// Cố ý là biến module (không React Context) — cùng lý lẽ đã ghi ở `active-conversation.ts`:
// badge nằm trong layout, luồng chat nằm trong page; bọc Context từ layout xuống sẽ biến
// layout của cả ba site thành client component.
//
// Đây KHÔNG phải nguồn sự thật của con số nào: người nghe chỉ việc đi HỎI LẠI server.
// Sai lệch tệ nhất khi phát thừa: một lượt GET đếm.

type ReadListener = () => void;

const listeners = new Set<ReadListener>();

/** Badge đăng ký để biết lúc nào cần hỏi lại tổng chưa đọc. Trả về hàm huỷ đăng ký. */
export function subscribeConversationRead(listener: ReadListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Luồng chat gọi SAU KHI `markConversationRead` đã ghi xong (không gọi trước — badge sẽ
 * hỏi lại và nhận đúng con số cũ).
 *
 * Nuốt lỗi của từng người nghe: bên gọi là nhánh `then` của `markConversationRead`, một
 * listener hỏng không được phép làm hỏng việc ghi mốc đã đọc.
 */
export function notifyConversationRead(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // Người nghe hỏng là việc của người nghe.
    }
  }
}
