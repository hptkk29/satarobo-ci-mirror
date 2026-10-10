"use client";

import { subscribeSseTopic, type SseHandlers } from "@/lib/chat/sse-client";

/**
 * Cổng realtime DUY NHẤT mà consumer phía trình duyệt import
 * (`components/chat/use-chat-channel.ts`, `components/chat/user-channel.ts`).
 *
 * Từ 28/09/2026 chỉ còn một tầng: SSE (`lib/chat/sse-client.ts` → `/api/chat/stream`).
 * Đường Supabase Realtime (và việc chọn provider theo trường `provider` của vé) đã GỠ sau
 * khi prod dời sang VPS. File này giữ lại làm lớp mỏng để hai consumer không phải đổi
 * hợp đồng `subscribe` / `renewAuth` của mình.
 */

/** Vé từ `/api/chat/realtime-token`. `provider` chỉ còn để tương thích bundle cũ. */
export type RealtimeAuth = { token: string; expiresAt: string; provider?: "sse" };

export type RealtimeHandlers = SseHandlers;

export type RealtimeSubscription = { unsubscribe: () => void };

export function subscribeConversation(
  conversationId: string,
  _auth: RealtimeAuth,
  handlers: RealtimeHandlers = {},
): RealtimeSubscription {
  return subscribeSseTopic(`conv:${conversationId}`, handlers);
}

export function subscribeUserTopic(
  userId: string,
  _auth: RealtimeAuth,
  handlers: RealtimeHandlers = {},
): RealtimeSubscription {
  return subscribeSseTopic(`user:${userId}`, handlers);
}

/**
 * Gia hạn vé. SSE không có gì để đổi ở mức kết nối — xác thực bằng cookie phiên, quyền kiểm
 * ở mỗi lần giao — nên chỉ trả thẳng mốc hết hạn của vé cho bộ hẹn giờ của consumer.
 */
export function applyRealtimeAuth(auth: RealtimeAuth): string {
  return auth.expiresAt;
}
