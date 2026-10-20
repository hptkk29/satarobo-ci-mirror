"use client";

// components/chat/user-channel.ts — HUB kênh realtime mức NGƯỜI DÙNG (`user:{User.id}`).
//
// Món nợ Đợt 1: chỉ tồn tại kênh mức HỘI THOẠI (`conv:{id}`) và client chỉ join kênh của
// hội thoại ĐANG MỞ ⇒ tin đến ở hội thoại khác không có tín hiệu nào tới trình duyệt, nên
// badge chưa đọc lẫn danh sách hội thoại đều đứng yên tới khi người dùng bấm đi bấm lại.
// Kênh này chở các event NHẸ, thuần TÍN HIỆU (không body, không PII — BR-30):
//   • `conversation.bumped`  — có tin mới ở một hội thoại của tôi;
//   • `notification.bumped`  — chuông nhân sự của tôi có mục mới (khỏi chờ vòng poll 60s).
// Kênh vốn đã mở sẵn cho mọi trang có badge, nên chở thêm tín hiệu chuông KHÔNG tốn thêm
// kết nối, thêm topic, hay thêm cổng quyền nào (cổng chỉ so topic, không lọc theo tên event).
//
// VÌ SAO LÀ HUB REFCOUNT chứ không phải "mỗi component một hook":
// trên site GV, `SidebarContent` được render Ở HAI NƠI (sidebar desktop + drawer mobile,
// cả hai luôn mounted), cộng thêm màn danh sách ⇒ ≥3 nơi cùng muốn nghe. Gộp về MỘT người
// giữ topic `user:X` trên kết nối SSE của tab: người nghe đầu tiên mở, người cuối cùng rời
// thì đóng.
//
// Hub có bộ hẹn giờ gia hạn vé RIÊNG, song song với bộ của `useChatChannel`. Với SSE, gia
// hạn vé không đụng kết nối (`applyRealtimeAuth` chỉ trả mốc hết hạn) nên hai bộ không dẫm
// chân nhau.
//
// ⚠️ Realtime KHÔNG đảm bảo delivery ⇒ khi kênh về lại `SUBSCRIBED` SAU MỘT LẦN ĐỨT hub phát
// `{ type: "resync" }` để người nghe hỏi lại nguồn sự thật. Đây là chốt chặn, không phải tối
// ưu — cùng luật với `useChatChannel`. Kênh về `CLOSED` ngoài ý muốn thì hub tự nối lại (backoff).

import { parseConversationBumped, type ConversationBump } from "./chat-store";

/** Xin token mới khi đã tiêu 80% TTL — trùng chính sách của `use-chat-channel.ts`. */
const TOKEN_RENEW_RATIO = 0.8;
const MIN_RENEW_DELAY_MS = 5_000;
/** Không đọc được `expiresAt` → 3' xin lại (ngắn hơn TTL vé 15'). */
const FALLBACK_RENEW_MS = 3 * 60_000;
const TOKEN_RENEW_RETRY_MS = 30_000;
/** Mở kênh hỏng (mạng chớp lúc tải trang) → thử lại; hub sống suốt phiên nên đáng thử. */
const START_RETRY_MS = 30_000;
/** Kênh đóng ngoài ý muốn → nối lại, nhân đôi mỗi lần, kịch 30s (trùng `use-chat-channel.ts`). */
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

export type UserChannelEvent =
  /** Có tin mới ở một hội thoại nào đó của tôi. */
  | { type: "bump"; bump: ConversationBump }
  /**
   * Chuông nhân sự của tôi vừa có gì đó mới. Chỉ có MỐC THỜI GIAN, không tiêu đề/`href`
   * (BR-30) — người nghe phải đi hỏi lại server rồi mới vẽ.
   */
  | { type: "noti"; at: Date }
  /** Kênh vừa (re)kết nối — hãy hỏi lại server, có thể đã lỡ bump lúc mất mạng. */
  | { type: "resync" };

export type UserChannelListener = (event: UserChannelEvent) => void;

/**
 * Payload `notification.bumped` → mốc thời gian; `null` nếu dị dạng.
 *
 * Nghiêm ngặt có chủ đích, đúng nếp `parseConversationBumped`: thà BỎ một tín hiệu hỏng còn
 * hơn đoán bừa (`new Date(undefined)` ra Invalid Date, để lọt là người nghe cầm rác). Bỏ
 * cũng không mất gì: lần `SUBSCRIBED` kế tiếp phát `resync`, người nghe hỏi lại server là bù đủ.
 */
function parseNotificationBumped(payload: Record<string, unknown>): Date | null {
  const at = payload.at;
  if (typeof at !== "string" && typeof at !== "number" && !(at instanceof Date)) return null;
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type UserChannelSubscription = { unsubscribe: () => void };

export type UserChannelHandlers = {
  onBroadcast: (event: string, payload: Record<string, unknown>) => void;
  onStatus: (status: string, err?: Error) => void;
};

export type RealtimeTokenResponse = {
  token: string;
  expiresAt: string;
  /** Luôn `sse` (Supabase đã gỡ) — không còn ai đọc, giữ cho khớp hình dạng phản hồi. */
  provider?: "sse";
};

/** Cổng ra Realtime — tách interface để test bơm bản giả (không cần server thật). */
export type UserChannelTransport = {
  subscribe(
    userId: string,
    auth: RealtimeTokenResponse,
    handlers: UserChannelHandlers,
  ): UserChannelSubscription;
  /** Gia hạn vé. Trả về mốc `expiresAt` (ISO) để hẹn lần gia hạn kế. */
  renewAuth(auth: RealtimeTokenResponse): string | Promise<string>;
};

export type UserChannelHub = {
  /** Đăng ký nghe; trả về hàm huỷ. Người nghe cuối cùng huỷ ⇒ kênh đóng. */
  subscribe(userId: string, listener: UserChannelListener): () => void;
};

/**
 * `@/lib/chat/realtime-client` (lớp mỏng trên SSE) được nạp ĐỘNG (không import tĩnh).
 *
 * Badge "Tin nhắn" nằm trong nav ⇒ hub này bị kéo vào bundle của MỌI trang admin / portal /
 * site GV. Hồi còn Supabase, nạp động là để né `@supabase/supabase-js` (~50 kB gzip) khỏi
 * chunk khởi động; tầng SSE nhỏ hơn nhiều nhưng vẫn giữ nạp động — không có lý do kéo tầng
 * kết nối vào chunk khởi động của trang không liên quan tới chat.
 */
const defaultTransport: UserChannelTransport = {
  subscribe(userId, auth, handlers) {
    let channel: { unsubscribe: () => unknown } | null = null;
    let cancelled = false;

    void import("@/lib/chat/realtime-client")
      .then((mod) => {
        if (cancelled) return;
        channel = mod.subscribeUserTopic(userId, auth, handlers);
      })
      .catch(() => {
        // Không tải được module realtime ⇒ badge đứng ở số server (xuống cấp êm).
      });

    return {
      unsubscribe: () => {
        cancelled = true;
        void channel?.unsubscribe();
        channel = null;
      },
    };
  },
  async renewAuth(auth) {
    const mod = await import("@/lib/chat/realtime-client");
    return mod.applyRealtimeAuth(auth);
  },
};

async function defaultFetchToken(signal: AbortSignal): Promise<RealtimeTokenResponse> {
  const res = await fetch("/api/chat/realtime-token", { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`Không lấy được vé realtime (HTTP ${res.status})`);
  return (await res.json()) as RealtimeTokenResponse;
}

export function createUserChannelHub(deps: {
  transport?: UserChannelTransport;
  fetchToken?: (signal: AbortSignal) => Promise<RealtimeTokenResponse>;
} = {}): UserChannelHub {
  const transport = deps.transport ?? defaultTransport;
  const fetchToken = deps.fetchToken ?? defaultFetchToken;

  const listeners = new Set<UserChannelListener>();
  let currentUserId: string | null = null;
  let subscription: UserChannelSubscription | null = null;
  let abort: AbortController | null = null;
  let renewTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Số lần nối lại liên tiếp — về 0 mỗi lần kênh SUBSCRIBED thật sự. */
  let reconnectAttempt = 0;
  /** Mọi callback bất đồng bộ so số này trước khi đụng state — chặn kết quả của lượt cũ. */
  let generation = 0;

  const emit = (event: UserChannelEvent) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // Một người nghe hỏng không được kéo những người còn lại xuống theo.
      }
    }
  };

  /**
   * Huỷ hẹn giờ của VÉ (gia hạn / thử lại). CỐ Ý không đụng `reconnectTimer`: một lần gia
   * hạn vé thành công không được nuốt mất lượt nối lại đang chờ, nếu không kênh đã CLOSED
   * sẽ nằm chết im lặng — đúng cái bug đang vá.
   */
  const clearTokenTimers = () => {
    if (renewTimer !== null) {
      clearTimeout(renewTimer);
      renewTimer = null;
    }
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  /** Huỷ MỌI hẹn giờ — chỉ dùng khi thật sự đóng kênh (`stop`). */
  const clearTimers = () => {
    clearTokenTimers();
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const stop = () => {
    generation += 1;
    clearTimers();
    abort?.abort();
    abort = null;
    subscription?.unsubscribe();
    subscription = null;
    currentUserId = null;
  };

  const start = (userId: string) => {
    const gen = ++generation;
    const controller = new AbortController();
    abort = controller;
    currentUserId = userId;

    const scheduleRenew = (expiresAt: string | undefined) => {
      if (gen !== generation) return;
      clearTokenTimers();
      const at = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
      const delay = Number.isNaN(at)
        ? FALLBACK_RENEW_MS
        : Math.max((at - Date.now()) * TOKEN_RENEW_RATIO, MIN_RENEW_DELAY_MS);
      renewTimer = setTimeout(() => void renew(), delay);
    };

    const renew = async () => {
      if (gen !== generation) return;
      try {
        const fresh = await fetchToken(controller.signal);
        if (gen !== generation) return;
        const effectiveExpiresAt = await transport.renewAuth(fresh);
        if (gen !== generation) return;
        scheduleRenew(effectiveExpiresAt);
      } catch {
        if (gen !== generation) return;
        clearTokenTimers();
        // Token CŨ còn hiệu lực ⇒ kênh chưa rớt, chỉ cần thử lại lát nữa.
        renewTimer = setTimeout(() => void renew(), TOKEN_RENEW_RETRY_MS);
      }
    };

    // Lọc theo TÊN event, không phải "nhận hết cho tiện": topic `user:{id}` là kênh dùng
    // chung, event lạ (hoặc event của phiên bản client cũ/mới hơn) phải rơi im lặng chứ
    // không được biến thành tín hiệu sai. Mỗi tên có parser riêng — payload dị dạng ⇒ bỏ,
    // `resync` ở lần SUBSCRIBED kế tiếp bù lại.
    const handleBroadcast = (event: string, payload: Record<string, unknown>) => {
      if (gen !== generation) return;
      if (event === "conversation.bumped") {
        const bump = parseConversationBumped(payload);
        if (bump) emit({ type: "bump", bump });
        return;
      }
      if (event === "notification.bumped") {
        const at = parseNotificationBumped(payload);
        if (at) emit({ type: "noti", at });
        return;
      }
      // Phương án B (SSE) — phong bì gốc quá trần NOTIFY nên chỉ còn id ⇒ hỏi lại server.
      if (event === "realtime.resync") emit({ type: "resync" });
    };

    /**
     * Kênh đóng ngoài ý muốn ⇒ dựng lại bằng vé MỚI. Hub sống suốt phiên nên không được
     * "đóng rồi thôi": badge chưa đọc sẽ đứng im tới khi người dùng F5. Backoff nhân đôi,
     * kịch 30s, và chỉ nối lại khi còn người nghe.
     */
    /** Kênh đã đứt ngoài ý muốn kể từ lần SUBSCRIBED gần nhất ⇒ lần SUBSCRIBED kế phải `resync`. */
    let daDut = false;

    const scheduleReconnect = () => {
      if (gen !== generation || reconnectTimer !== null || listeners.size === 0) return;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (gen !== generation || listeners.size === 0) return;
        stop(); // đóng kênh cũ + huỷ mọi timer (generation++) — listeners GIỮ NGUYÊN
        start(userId);
      }, delay);
    };

    const handleStatus = (status: string) => {
      if (gen !== generation) return;
      // Chốt chặn: broadcast có thể rơi TRONG LÚC kênh đứt ⇒ nối lại được thì hỏi lại server.
      // Chỉ sau khi ĐỨT (CLOSED/CHANNEL_ERROR/TIMED_OUT) — KHÔNG ở lần join đầu (số đã có từ
      // RSC) và KHÔNG ở lần mở lại có chủ đích (không mất tín hiệu nào).
      // Sự cố egress 05/09/2026: mỗi 4 phút gia hạn vé là mọi tab gọi lại summary + unread.
      if (status === "SUBSCRIBED") {
        reconnectAttempt = 0;
        if (daDut) {
          daDut = false;
          emit({ type: "resync" });
        }
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        // EventSource đang tự nối lại — chen vào là hai kết nối song song. Chỉ đánh dấu.
        daDut = true;
        return;
      }
      if (status === "CLOSED") {
        daDut = true;
        scheduleReconnect();
      }
    };

    void (async () => {
      try {
        const auth = await fetchToken(controller.signal);
        if (gen !== generation) return;
        subscription = transport.subscribe(userId, auth, {
          onBroadcast: handleBroadcast,
          onStatus: handleStatus,
        });
        scheduleRenew(auth.expiresAt);
      } catch {
        if (gen !== generation) return;
        clearTokenTimers();
        // Không có kênh = badge đứng ở số server dựng lúc tải trang (xuống cấp êm),
        // nhưng hub sống suốt phiên nên vẫn đáng thử lại thay vì bỏ hẳn realtime.
        retryTimer = setTimeout(() => {
          if (gen !== generation || listeners.size === 0) return;
          start(userId);
        }, START_RETRY_MS);
      }
    })();
  };

  return {
    subscribe(userId, listener) {
      // Đổi người dùng trong cùng một tab (đăng xuất/đăng nhập lại) — dựng lại kênh.
      if (currentUserId !== null && currentUserId !== userId) stop();

      listeners.add(listener);
      if (subscription === null && retryTimer === null && currentUserId !== userId) {
        start(userId);
      }

      let done = false;
      return () => {
        if (done) return;
        done = true;
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
  };
}

/** Bản dùng ở runtime — MỘT kênh `user:{id}` cho cả tab, dù có bao nhiêu badge/danh sách. */
export const userChannelHub: UserChannelHub = createUserChannelHub();
