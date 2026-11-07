// lib/chat/_handlers/participant-removed.ts — F-KICK bước 3 (docs/chat-realtime/flows.md).
//
// VÌ SAO CẦN: quyền nghe realtime được cache theo kết nối (BA mục 7.3). Hồi Supabase,
// RLS chỉ chạy MỘT LẦN lúc join; nay tầng SSE kiểm ở mỗi lần giao nhưng vẫn cache ≤ 15s
// (`lib/chat/realtime-authz.ts`) — người vừa bị gỡ khỏi lớp vẫn có thể nhận trong cửa sổ đó. API đọc lịch sử đã chặn
// ngay lập tức (guard participant trong lib/chat/queries.ts), nên rò rỉ tối đa là
// các tin phát sinh trong cửa sổ đó của một phiên đang mở. Mitigation đã ghi trong
// thiết kế: server chủ động bắn `participant.removed` xuống chính topic đó để client
// tự unsubscribe + rời màn hình (client đã sẵn sàng — components/chat/use-chat-channel.ts).
//
// VÌ SAO ĐI QUA DomainEvent CHỨ KHÔNG BROADCAST THẲNG TRONG `syncConversationMembership`:
//  • Việc set `leftAt` nằm TRONG transaction nghiệp vụ (chuyển lớp, gỡ phân công GV…).
//    Broadcast là side-effect KHÔNG-atomic — bắn trong tx thì transaction rollback vẫn
//    đã đá người ta ra khỏi kênh (CLAUDE.md: side-effect không-atomic đi qua DomainEvent).
//  • Sync được gọi từ 14+ call-site và từ cron đối soát; nhét broadcast vào từng nơi là
//    đường chắc chắn sót. Publish trong tx + handler chạy sau commit phủ mọi đường.
//  • Đánh đổi: dispatcher chạy mỗi phút (vercel.json) ⇒ độ trễ tới ~60s. Nằm trong mức
//    "vài phút" mà tài liệu bảo mật đã ghi là rủi ro chấp nhận (architecture.md).
import { on, type DomainEventLite } from "@/lib/events/registry";
import { broadcastToConversation } from "@/lib/chat/broadcast";
import { CHAT_PARTICIPANT_REMOVED } from "@/lib/chat/events";

export { CHAT_PARTICIPANT_REMOVED };

/**
 * ⚠️ Handler nhận CẢ object event `{ id, type, payload }` — KHÔNG phải payload trần
 * (xem `EventHandler` trong lib/events/registry.ts và tiền lệ
 * lib/_handlers/conversation-notif.ts). Đọc nhầm một tầng thì hàm im lặng không làm
 * gì và không ai biết, vì dispatcher vẫn đánh event là DONE.
 */
export async function onChatParticipantRemoved(event: DomainEventLite): Promise<void> {
  const conversationId = event.payload?.conversationId;
  const userId = event.payload?.userId;
  if (typeof conversationId !== "string" || typeof userId !== "string") return;
  // Khoá payload phải khớp hợp đồng client: components/chat/chat-store.ts
  // (`parseParticipantRemoved` đọc `userId`).
  await broadcastToConversation(conversationId, "participant.removed", { userId });
}

export function registerChatParticipantRemovedHandlers(): void {
  on(CHAT_PARTICIPANT_REMOVED, onChatParticipantRemoved);
}
