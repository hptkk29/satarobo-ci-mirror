// components/chat/bump-scheduler.ts — nhịp cho tín hiệu `conversation.bumped`.
//
// THUẦN: không React, không mạng. Nhận N tín hiệu rời rạc và quyết định gọi `run()` bao
// nhiêu lần, lúc nào. Tách ra khỏi hook để test bằng fake timer mà không cần render gì.
//
// Vì sao phải có nhịp (chứ không gọi thẳng mỗi bump):
//   - Một nhóm lớp đang sôi động bắn hàng chục bump/phút. Mỗi bump mà kéo theo một lượt
//     `GET /api/chat/unread` (2 truy vấn) hoặc một `router.refresh()` (chạy lại RSC thật vì
//     3 trang chat đều `force-dynamic`) là tự bắn vào chân server.
//   - Gom cụm TRAILING: bấm gửi liên tiếp 5 tin trong 1 giây ⇒ đúng MỘT lượt hỏi lại.
//
// ⚠️ Tab ẩn: trình duyệt bóp timer (và rAF) tới mức 1 lần/phút — bám SỰ KIỆN
// `visibilitychange`/`focus` chứ đừng bám timer. Đây là vết đã đốt ở `use-chat-channel.ts`
// (AC5): tab ẩn thì chỉ ĐÁNH DẤU "bẩn", quay lại mới chạy đúng một lần cho cả cụm.

export type BumpScheduler = {
  /** Có tín hiệu mới — có thể gọi liên tục, scheduler tự gom. */
  ping: () => void;
  /** Gỡ timer + listener DOM. BẮT BUỘC gọi khi unmount. */
  dispose: () => void;
};

export type BumpSchedulerOptions = {
  /** Gom cụm: chờ ngần này kể từ tín hiệu CUỐI rồi mới chạy (trailing debounce). */
  debounceMs: number;
  /** Trần tần suất: hai lần chạy không bao giờ gần nhau hơn ngần này. */
  minIntervalMs: number;
  run: () => void;
  /** DI cho test; mặc định đọc `document.visibilityState`. */
  isForeground?: () => boolean;
};

function defaultIsForeground(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

export function createBumpScheduler(options: BumpSchedulerOptions): BumpScheduler {
  const { debounceMs, minIntervalMs, run } = options;
  const isForeground = options.isForeground ?? defaultIsForeground;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let deadline = Number.POSITIVE_INFINITY;
  let dirty = false;
  let lastRunAt = Number.NEGATIVE_INFINITY;
  let disposed = false;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    deadline = Number.POSITIVE_INFINITY;
  };

  const fire = () => {
    timer = null;
    deadline = Number.POSITIVE_INFINITY;
    if (disposed || !dirty) return;
    // Tab vừa ẩn đúng lúc timer nổ ⇒ giữ nguyên cờ bẩn, chờ người dùng quay lại.
    if (!isForeground()) return;
    dirty = false;
    lastRunAt = Date.now();
    run();
  };

  /**
   * Hẹn giờ chạy, GIỮ mốc sớm nhất.
   *
   * ⚠️ CỐ Ý không phải debounce "mỗi tín hiệu đẩy lùi mốc" — nhóm lớp đang sôi động bắn
   * tín hiệu liên tục thì mốc bị đẩy lùi mãi và badge KHÔNG BAO GIỜ cập nhật (chết đói).
   * Ở đây tín hiệu đầu tiên chốt mốc, các tín hiệu sau trong cùng cửa sổ bị gộp vào — nên
   * "bắn không ngừng" vẫn cho ra nhịp đều đặn `minIntervalMs`.
   */
  const schedule = (minWait: number) => {
    if (disposed) return;
    const now = Date.now();
    const wait = Math.max(minWait, minIntervalMs - (now - lastRunAt), 0);
    const next = now + wait;
    if (timer !== null && deadline <= next) return; // đã có mốc sớm hơn hoặc bằng
    clear();
    deadline = next;
    timer = setTimeout(fire, wait);
  };

  const ping = () => {
    if (disposed) return;
    dirty = true;
    // Tab ẩn ⇒ chỉ đánh dấu; `wake` sẽ lo khi quay lại (timer lúc này không đáng tin).
    if (!isForeground()) return;
    schedule(debounceMs);
  };

  // Quay lại tab: chạy NGAY cụm đang nợ (vẫn tôn trọng trần tần suất).
  const wake = () => {
    if (disposed || !dirty || !isForeground()) return;
    schedule(0);
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
  }

  return {
    ping,
    dispose: () => {
      disposed = true;
      clear();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", wake);
        window.removeEventListener("focus", wake);
      }
    },
  };
}
