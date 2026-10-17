"use client";

// components/chat/use-chat-unread.ts — số chưa đọc SỐNG cho badge "Tin nhắn" của nav.
//
// Hợp đồng với thanh nav (cả 3 site):
//   - SỐ BAN ĐẦU do SERVER đưa xuống (`countChatUnreadForUser` gọi trong layout RSC) và
//     truyền vào `initialCount`. Hook KHÔNG fetch lúc mount — không có `useEffect` đi lấy
//     dữ liệu đầu tiên, đúng luật của repo.
//   - Sau đó số nhảy theo HAI tín hiệu: kênh `user:{id}` báo có tin mới (số LÊN) và
//     `read-signal` báo vừa đánh dấu đã đọc xong (số XUỐNG). Mỗi lần như vậy hook hỏi lại
//     `GET /api/chat/unread` — KHÔNG tự cộng/trừ ở client: server là nguồn sự thật duy nhất,
//     tự tính sẽ lệch với BR-04 (ARCHIVED > 90 ngày rơi khỏi danh sách PH) và với lọc
//     `leftAt IS NULL` khi PH vừa bị gỡ khỏi lớp.
//     ⚠️ Thiếu tín hiệu thứ hai thì badge CHỈ TĂNG — đọc tin không sinh bump nào.
//
// Vì sao KHÔNG đụng cache RSC: toàn bộ việc cập nhật nằm trong state của component client
// + một `fetch` GET `no-store`. Không `router.refresh()`, không Server Action, không
// `revalidatePath` ⇒ người đang đứng ở `/teacher/lop/abc` thấy badge nhảy mà trang không
// render lại.
//
// AC5 — hội thoại ĐANG MỞ ở tab đang hiện thì KHÔNG hỏi lại: tin đó được đánh dấu đã đọc
// ngay, badge phải đứng yên (nếu hỏi lại đúng lúc `markConversationRead` chưa kịp ghi, badge
// sẽ nháy một số rồi tụt về 0 — nhìn như lỗi).

import { useEffect, useRef, useState } from "react";
import { isBumpOfOpenConversation } from "./active-conversation";
import { createBumpScheduler } from "./bump-scheduler";
import { subscribeConversationRead } from "./read-signal";
import { userChannelHub, type UserChannelHub } from "./user-channel";

/** Gom cụm tín hiệu: 5 tin trong 1 giây ⇒ một lượt hỏi lại. */
const BUMP_DEBOUNCE_MS = 800;
/** Trần tần suất hỏi lại (route có rate limit 60/phút/user — còn rất rộng). */
const BUMP_MIN_INTERVAL_MS = 3_000;

async function defaultFetchTotal(): Promise<number> {
  const res = await fetch("/api/chat/unread", { cache: "no-store" });
  if (!res.ok) throw new Error(`Không lấy được số tin chưa đọc (HTTP ${res.status})`);
  const data = (await res.json()) as { total?: unknown };
  return typeof data.total === "number" ? data.total : 0;
}

export type UseChatUnreadOptions = {
  /** DI cho test. */
  hub?: UserChannelHub;
  /** DI cho test. */
  fetchTotal?: () => Promise<number>;
};

/**
 * @param userId `User.id` người đang đăng nhập (topic realtime của chính họ).
 * @param initialCount số chưa đọc do layout RSC tính sẵn — hiển thị ngay ở lần render đầu.
 */
export function useChatUnread(
  userId: string,
  initialCount: number,
  options: UseChatUnreadOptions = {},
): number {
  const [count, setCount] = useState(initialCount);

  const hubRef = useRef(options.hub ?? userChannelHub);
  const fetchTotalRef = useRef(options.fetchTotal ?? defaultFetchTotal);
  fetchTotalRef.current = options.fetchTotal ?? defaultFetchTotal;

  // Điều hướng sang trang khác ⇒ layout RSC tính lại ⇒ prop đổi ⇒ số bám theo server.
  // Đây KHÔNG phải fetch: chỉ đồng bộ state với prop đã có sẵn.
  useEffect(() => {
    setCount(initialCount);
  }, [initialCount]);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    const scheduler = createBumpScheduler({
      debounceMs: BUMP_DEBOUNCE_MS,
      minIntervalMs: BUMP_MIN_INTERVAL_MS,
      run: () => {
        void fetchTotalRef
          .current()
          .then((total) => {
            if (!cancelled) setCount(total);
          })
          .catch(() => {
            // Mạng chớp ⇒ giữ số cũ. Bump sau (hoặc lần điều hướng kế) sẽ chỉnh lại.
          });
      },
    });

    const unsubscribeHub = hubRef.current.subscribe(userId, (event) => {
      if (event.type === "bump" && isBumpOfOpenConversation(event.bump.conversationId)) return;
      scheduler.ping();
    });

    // Đường DUY NHẤT làm badge TỤT trong cùng một phiên. Kênh `user:{id}` chỉ báo "có tin
    // mới", còn đọc tin thì im lặng; layout RSC (nơi tính số ban đầu) lại không render lại
    // khi điều hướng client-side. Thiếu đăng ký này, GV đọc hết tin xong badge vẫn treo số cũ
    // cho tới lúc F5 hoặc tới khi tình cờ có tin mới ở một hội thoại KHÁC.
    const unsubscribeRead = subscribeConversationRead(() => scheduler.ping());

    return () => {
      cancelled = true;
      unsubscribeHub();
      unsubscribeRead();
      scheduler.dispose();
    };
  }, [userId]);

  return count;
}
