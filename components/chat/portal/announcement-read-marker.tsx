"use client";

// US-10 AC3 — ghi `AnnouncementRead` khi thông báo VÀO VIEWPORT, KHÔNG phải khi mở app.
//
// Vì sao không đánh dấu lúc tải trang: GV cần biết PH có THỰC SỰ nhìn thấy thông báo hay
// không. Thông báo nằm dưới màn hình (hoặc trong danh sách "Xem tất cả" chưa cuộn tới)
// mà đã tính là "đã đọc" thì con số "Đã đọc 12/30" mất hết ý nghĩa.
//
// `useEffect` ở đây KHÔNG phải để fetch dữ liệu (RSC lo phần đó) — nó gắn
// IntersectionObserver, đúng phần việc bắt buộc phải ở client.

import { useEffect, useRef } from "react";
import { markAnnouncementReadAction } from "@/lib/chat/_actions";

/** Bản optimistic (`tmp:`) chưa có id server — không có gì để ghi mốc đọc. */
const OPTIMISTIC_PREFIX = "tmp:";
/** Phải thấy được nửa khối thông báo mới tính là "đã nhìn thấy". */
const VISIBLE_RATIO = 0.5;

export function AnnouncementReadMarker({
  messageId,
  /** Đã có mốc đọc từ trước → khỏi gắn observer (idempotent, nhưng đỡ 1 vòng mạng). */
  alreadyRead = false,
  children,
}: {
  messageId: string;
  alreadyRead?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Một lần/đời component: cuộn qua cuộn lại không bắn lại action.
  const sentRef = useRef(false);

  useEffect(() => {
    if (alreadyRead || sentRef.current) return;
    if (messageId.startsWith(OPTIMISTIC_PREFIX)) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < VISIBLE_RATIO) continue;
          if (sentRef.current) return;
          sentRef.current = true;
          observer.disconnect();
          // Fail-and-forget: mốc đọc hỏng KHÔNG được làm vỡ màn hình của phụ huynh;
          // lần mở sau sẽ ghi lại (action idempotent).
          void markAnnouncementReadAction(messageId).catch(() => {
            sentRef.current = false;
          });
          return;
        }
      },
      { threshold: [VISIBLE_RATIO] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [messageId, alreadyRead]);

  return <div ref={ref}>{children}</div>;
}
