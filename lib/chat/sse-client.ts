"use client";

/**
 * Tầng kết nối realtime phía TRÌNH DUYỆT — tầng DUY NHẤT từ 28/09/2026 (Supabase đã gỡ).
 *
 * Giữ ĐÚNG hợp đồng của tầng Supabase cũ (handlers
 * `onBroadcast` / `onStatus` với các trạng thái SUBSCRIBED · CHANNEL_ERROR · CLOSED), nên
 * `useChatChannel` và hub `user-channel` không phải biết mình đang chạy trên gì.
 *
 * MỘT `EventSource` cho cả tab tới `/api/chat/stream`: topic `user:{id}` server tự gắn theo
 * phiên, các `conv:{id}` đi qua `?conv=`. Không có vé/JWT — cookie phiên Auth.js đi kèm
 * request, quyền kiểm ở server TỪNG phong bì.
 *
 * Ánh xạ trạng thái (khớp với cách hai consumer vốn xử lý):
 *   • mở / mở lại            → `SUBSCRIBED` cho mọi người giữ chưa "sống" ⇒ reconcile / resync
 *   • đứt tạm (tự nối lại)   → `CHANNEL_ERROR` — consumer KHÔNG tự nối chồng, chỉ đánh dấu
 *   • đứt hẳn (401/403/503…) → `CLOSED` — consumer tự nối lại theo backoff của họ
 *
 * Thêm hội thoại ⇒ URL đổi ⇒ phải mở kết nối mới. Làm theo kiểu "mở mới trước, đóng cũ sau":
 * kết nối cũ vẫn giao cho tới khi kết nối mới mở, rồi mới đóng — kênh đang chạy không có khe
 * hở và không bị reconcile thừa. Rời hội thoại thì KHÔNG mở lại: topic thừa vô hại (server
 * kiểm quyền từng phong bì, client bỏ phong bì không có người giữ).
 */

export type SseHandlers = {
  onBroadcast?: (event: string, payload: Record<string, unknown>) => void;
  onStatus?: (status: string, err?: Error) => void;
};

export type SseSubscription = { unsubscribe: () => void };

export const SSE_STREAM_PATH = "/api/chat/stream";

type Entry = {
  topic: string;
  handlers: SseHandlers;
  released: boolean;
  /** Đã nhận `SUBSCRIBED` trên kết nối hiện tại và chưa bị báo đứt kể từ đó. */
  live: boolean;
};

type Conn = {
  es: EventSource;
  convs: ReadonlySet<string>;
};

/** readyState CLOSED theo chuẩn — không đọc `EventSource.CLOSED` để chạy được với bản giả. */
const READY_STATE_CLOSED = 2;

const entries = new Set<Entry>();
/** Kết nối đang GIAO phong bì. */
let current: Conn | null = null;
/** Kết nối mới đang chờ mở để thay `current` (khi cần thêm hội thoại). */
let pending: Conn | null = null;
let rebuildQueued = false;

function convOf(topic: string): string | null {
  return topic.startsWith("conv:") ? topic.slice("conv:".length) : null;
}

function wantedConvs(): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    const c = convOf(e.topic);
    if (c) out.add(c);
  }
  return out;
}

function covers(conn: Conn | null, wanted: ReadonlySet<string>): conn is Conn {
  if (!conn || conn.es.readyState === READY_STATE_CLOSED) return false;
  for (const c of wanted) if (!conn.convs.has(c)) return false;
  return true;
}

function safeStatus(entry: Entry, status: string, err?: Error) {
  if (entry.released) return;
  try {
    entry.handlers.onStatus?.(status, err);
  } catch {
    // Một người giữ hỏng không được kéo người khác xuống.
  }
}

function announceSubscribed() {
  for (const e of [...entries]) {
    if (e.live || e.released) continue;
    e.live = true;
    safeStatus(e, "SUBSCRIBED");
  }
}

function closeConn(conn: Conn | null) {
  if (!conn) return;
  conn.es.onopen = null;
  conn.es.onmessage = null;
  conn.es.onerror = null;
  conn.es.close();
}

function parseEnvelope(
  data: unknown,
): { topic: string; event: string; payload: Record<string, unknown> } | null {
  if (typeof data !== "string") return null;
  let o: unknown;
  try {
    o = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof o !== "object" || o === null) return null;
  const r = o as Record<string, unknown>;
  if (typeof r.topic !== "string" || typeof r.event !== "string") return null;
  if (typeof r.payload !== "object" || r.payload === null || Array.isArray(r.payload)) return null;
  return { topic: r.topic, event: r.event, payload: r.payload as Record<string, unknown> };
}

function onOpen(conn: Conn) {
  if (conn === pending) {
    const old = current;
    current = conn;
    pending = null;
    closeConn(old);
  }
  if (conn !== current) return;
  announceSubscribed();
}

function onMessage(conn: Conn, ev: MessageEvent) {
  // Phong bì muộn của kết nối vừa bị thay ⇒ bỏ (kết nối mới đã giao rồi — tránh giao đôi).
  if (conn !== current) return;
  const env = parseEnvelope(ev.data);
  if (!env) return;
  for (const e of [...entries]) {
    if (e.released || e.topic !== env.topic) continue;
    try {
      e.handlers.onBroadcast?.(env.event, env.payload);
    } catch {
      // Như trên.
    }
  }
}

function onError(conn: Conn) {
  const fatal = conn.es.readyState === READY_STATE_CLOSED;

  if (conn === pending) {
    if (!fatal) return; // trình duyệt đang tự thử lại kết nối mới — chờ
    pending = null;
    closeConn(conn);
    // Những người giữ đang CHỜ kết nối mới không có kênh ⇒ báo CLOSED để họ nối lại có backoff.
    // Người đang sống trên `current` giữ nguyên.
    for (const e of [...entries]) if (!e.live) safeStatus(e, "CLOSED");
    return;
  }
  if (conn !== current) return;

  if (fatal) {
    current = null;
    closeConn(conn);
    for (const e of [...entries]) {
      e.live = false;
      safeStatus(e, "CLOSED");
    }
    return;
  }
  // Đứt tạm: EventSource tự nối lại; lần `open` kế tiếp bắn SUBSCRIBED lại ⇒ catch-up.
  for (const e of [...entries]) {
    if (!e.live) continue;
    e.live = false;
    safeStatus(e, "CHANNEL_ERROR");
  }
}

function openConn(convs: ReadonlySet<string>): Conn | null {
  const Ctor = (globalThis as { EventSource?: typeof EventSource }).EventSource;
  if (typeof Ctor !== "function") return null;
  const list = [...convs].sort();
  const url =
    list.length > 0
      ? `${SSE_STREAM_PATH}?conv=${list.map((c) => encodeURIComponent(c)).join(",")}`
      : SSE_STREAM_PATH;
  const conn: Conn = { es: new Ctor(url), convs: new Set(list) };
  conn.es.onopen = () => onOpen(conn);
  conn.es.onmessage = (ev) => onMessage(conn, ev);
  conn.es.onerror = () => onError(conn);
  return conn;
}

function rebuild() {
  if (entries.size === 0) {
    closeConn(pending);
    closeConn(current);
    pending = null;
    current = null;
    return;
  }
  const wanted = wantedConvs();

  if (covers(pending, wanted)) return; // kết nối mới đang mở sẽ báo SUBSCRIBED khi xong
  if (!pending && covers(current, wanted)) {
    // Kết nối đang dùng đã chở đủ topic. Nếu nó ĐANG MỞ thì người giữ mới sống ngay;
    // nếu đang nối (lần đầu / tự nối lại) thì lần `open` sẽ báo hộ.
    if (current.es.readyState === 1) announceSubscribed();
    return;
  }

  closeConn(pending);
  pending = openConn(wanted);
  if (!pending) {
    for (const e of [...entries]) if (!e.live) safeStatus(e, "CLOSED");
  }
}

function scheduleRebuild() {
  if (rebuildQueued) return;
  rebuildQueued = true;
  // Gộp các lần đăng ký/huỷ trong cùng một nhịp (vd `user:` + `conv:` lúc tải trang) thành
  // MỘT kết nối. Microtask ⇒ người gọi đã cầm `SseSubscription` trước khi có status nào.
  queueMicrotask(() => {
    rebuildQueued = false;
    rebuild();
  });
}

/**
 * Đăng ký nghe một topic (`conv:{id}` hoặc `user:{id}`) trên kết nối SSE dùng chung của tab.
 * KHÔNG BAO GIỜ ném — hỏng thì báo `CLOSED` qua `onStatus`, đúng hợp đồng consumer đang dựa vào.
 */
export function subscribeSseTopic(topic: string, handlers: SseHandlers = {}): SseSubscription {
  const entry: Entry = { topic, handlers, released: false, live: false };
  entries.add(entry);
  scheduleRebuild();
  return {
    unsubscribe: () => {
      if (entry.released) return;
      entry.released = true;
      entries.delete(entry);
      scheduleRebuild();
    },
  };
}
