"use client";

// components/notifications/use-notification-summary.ts — nguồn số liệu DUY NHẤT của chuông.
//
// Chuông, số trong tiêu đề tab và chấm favicon đều đọc từ đây, và cái này đọc từ
// `/api/notifications/summary` — nơi BACKEND đã tính sẵn `badge.label`. Không chỗ nào tự tính lại,
// nếu không sẽ có ngày badge là 8 mà tiêu đề là (9) và không ai biết bên nào đúng.
//
// Ba đường làm số đổi, theo thứ tự tin cậy giảm dần:
//   1. tín hiệu realtime `notification.bumped` trên kênh `user:{id}` đã có sẵn (≤ 3 giây);
//   2. `resync` — kênh vừa (re)kết nối, có thể đã lỡ tín hiệu lúc chập mạng;
//   3. vòng hỏi lại định kỳ + lúc quay lại tab: lưới cuối khi realtime chết câm.
// Broadcast KHÔNG đảm bảo giao tới nơi, nên (2) và (3) là bắt buộc chứ không phải tối ưu.

import { useCallback, useEffect, useRef, useState } from "react";
import { createBumpScheduler } from "@/components/chat/bump-scheduler";
import { userChannelHub, type UserChannelHub } from "@/components/chat/user-channel";
import type { NotificationSummary } from "@/lib/notifications/service";

/** Gom cụm: nhiều thông báo tới trong vài giây ⇒ đúng một lượt hỏi lại. */
const DEBOUNCE_MS = 600;
/** Trần tần suất hỏi lại. */
const MIN_INTERVAL_MS = 3_000;
/** Lưới cuối khi realtime chết câm. Thưa hơn nhịp 60s cũ vì `/summary` nay là đường đọc rẻ. */
const POLL_MS = 300_000;
/** Quay lại tab mà số liệu cũ hơn ngần này thì hỏi lại ngay (PRD §7.10). */
const STALE_MS = 30_000;

const RONG: NotificationSummary = {
  totalUnread: 0,
  hasPriority1: false,
  badge: { showDot: false, label: "", hasPriority1: false, ariaLabel: "Thông báo, không có mục chưa đọc" },
  groups: [],
  generatedAt: "",
};

async function tai(): Promise<NotificationSummary> {
  const res = await fetch("/api/notifications/summary", { cache: "no-store" });
  if (!res.ok) throw new Error(`Không lấy được số thông báo (HTTP ${res.status})`);
  return (await res.json()) as NotificationSummary;
}

export interface UseNotificationSummaryResult {
  summary: NotificationSummary;
  /** Hỏi lại ngay — dùng sau khi đánh dấu đã đọc để badge tụt đúng. */
  refresh: () => void;
}

export function useNotificationSummary(
  userId: string,
  options: { hub?: UserChannelHub; fetchSummary?: () => Promise<NotificationSummary> } = {},
): UseNotificationSummaryResult {
  const [summary, setSummary] = useState<NotificationSummary>(RONG);

  const hubRef = useRef(options.hub ?? userChannelHub);
  const taiRef = useRef(options.fetchSummary ?? tai);
  taiRef.current = options.fetchSummary ?? tai;

  const layLucRef = useRef(0);
  const pingRef = useRef<() => void>(() => {});

  const refresh = useCallback(() => pingRef.current(), []);

  useEffect(() => {
    if (!userId) return;

    let huy = false;
    const scheduler = createBumpScheduler({
      debounceMs: DEBOUNCE_MS,
      minIntervalMs: MIN_INTERVAL_MS,
      // ⚠️ ÉP "luôn coi là đang hiện" — KHÁC badge chat, và khác một cách bắt buộc.
      // Mặc định scheduler hoãn mọi việc khi tab ẩn (`document.visibilityState !== "visible"`),
      // chỉ đánh dấu bẩn rồi chờ người dùng quay lại. Với badge chat thì đúng: nó chỉ nhìn
      // thấy được khi đang Ở TRONG tab. Nhưng số này còn nuôi tiêu đề tab `(N)` và chấm đỏ
      // favicon — thứ tồn tại ĐÚNG ĐỂ nhìn khi tab đang ẩn. Giữ mặc định là con số không bao
      // giờ xuất hiện trong đúng tình huống nó sinh ra để phục vụ (đo thật 19/08: tab nền ⇒
      // `/summary` không được gọi lần nào, tiêu đề tab đứng yên).
      // Tải thêm vẫn bị chặn bởi `minIntervalMs` ở trên, và trình duyệt còn tự bóp timer của
      // tab nền xuống ~1 lần/phút.
      isForeground: () => true,
      run: () => {
        void taiRef
          .current()
          .then((data) => {
            if (huy) return;
            layLucRef.current = Date.now();
            setSummary(data);
          })
          .catch(() => {
            // Mạng chớp ⇒ GIỮ số cũ, không đưa badge về 0. Badge tụt oan còn tệ hơn badge cũ:
            // người dùng tin là đã hết việc.
          });
      },
    });
    pingRef.current = () => scheduler.ping();

    scheduler.ping();

    // `noti` = có thông báo mới. `resync` = kênh vừa nối lại, có thể đã lỡ tín hiệu.
    // `bump` (tin nhắn chat) KHÔNG tính: tin nhắn nào cần vào chuông thì đã tự sinh thông báo
    // và bắn `noti` riêng — nghe cả `bump` là hỏi lại thừa mỗi lần có người chat.
    const boNghe = hubRef.current.subscribe(userId, (event) => {
      if (event.type === "noti" || event.type === "resync") scheduler.ping();
    });

    const dinhKy = setInterval(() => scheduler.ping(), POLL_MS);

    const khiQuayLai = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - layLucRef.current > STALE_MS) scheduler.ping();
    };
    document.addEventListener("visibilitychange", khiQuayLai);
    window.addEventListener("focus", khiQuayLai);

    return () => {
      huy = true;
      boNghe();
      scheduler.dispose();
      clearInterval(dinhKy);
      document.removeEventListener("visibilitychange", khiQuayLai);
      window.removeEventListener("focus", khiQuayLai);
      pingRef.current = () => {};
    };
  }, [userId]);

  return { summary, refresh };
}
