"use client";

// components/chat/chat-list-refresher.tsx — làm DANH SÁCH hội thoại tự cập nhật.
//
// Món nợ Đợt 1 #B: danh sách chỉ đổi khi điều hướng, nên tin mới ở nhóm khác không đẩy
// nhóm đó lên đầu, không đổi dòng preview / giờ / badge.
//
// Cách vá: nghe kênh `user:{id}`, mỗi cụm tín hiệu gọi ĐÚNG MỘT `router.refresh()`.
// Cả ba trang chat đều `export const dynamic = "force-dynamic"` ⇒ refresh chạy lại RSC
// thật (`listConversationsForUser`), nên thứ tự, preview, giờ và badge từng dòng đều do
// SERVER dựng — không có bản sao logic nào ở client để trôi lệch.
//
// Vì sao KHÔNG merge tại chỗ ở client:
//   1. `ConversationList` (staff) cố ý là component THUẦN không tốn một byte JS — biến nó
//      thành client component là vứt một lựa chọn thiết kế đã ghi chú.
//   2. Preview được dựng ở SERVER SAU KHI đã lọc tin bị gỡ. Tự dựng preview từ payload
//      broadcast là đi vòng qua đúng chỗ đang lọc — mà payload bump cố ý KHÔNG mang nội
//      dung tin (BR-30), nên cũng không dựng được.
//
// `router.refresh()` giữ nguyên state của component client đang mở: luồng chat
// (`useChatChannel`) chỉ dùng `initialMessages` làm mầm state, nên tin optimistic đang gửi
// KHÔNG bị đè.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createBumpScheduler } from "./bump-scheduler";
import { userChannelHub, type UserChannelHub } from "./user-channel";

/** Gom cụm dài hơn badge một chút: refresh nặng hơn nhiều so với một GET đếm. */
const REFRESH_DEBOUNCE_MS = 1_000;
const REFRESH_MIN_INTERVAL_MS = 4_000;

export function ChatListRefresher({
  userId,
  hub,
}: {
  userId: string;
  /** DI cho test. */
  hub?: UserChannelHub;
}) {
  const router = useRouter();
  const hubRef = useRef(hub ?? userChannelHub);
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    if (!userId) return;

    const scheduler = createBumpScheduler({
      debounceMs: REFRESH_DEBOUNCE_MS,
      minIntervalMs: REFRESH_MIN_INTERVAL_MS,
      run: () => routerRef.current.refresh(),
    });

    // Cả `bump` lẫn `resync` đều refresh: hội thoại ĐANG MỞ cũng cần đổi preview + giờ +
    // thứ tự trong danh sách (khác badge tổng — chỗ đó mới phải bỏ qua hội thoại đang mở).
    const unsubscribe = hubRef.current.subscribe(userId, () => scheduler.ping());

    return () => {
      unsubscribe();
      scheduler.dispose();
    };
  }, [userId]);

  return null;
}
