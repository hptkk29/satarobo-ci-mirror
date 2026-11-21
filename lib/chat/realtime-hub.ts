import "server-only";
import { Client } from "pg";
import { CHAT_REALTIME_CHANNEL, type RealtimeEnvelope } from "@/lib/chat/realtime-notify";
import type { TopicAuthorizer } from "@/lib/chat/realtime-authz";

/**
 * HUB realtime mỗi tiến trình Node (VPS) — tầng realtime duy nhất từ 28/09/2026.
 *
 *   Server Action ──pg_notify──▶ Postgres ──LISTEN (1 kết nối/tiến trình)──▶ hub
 *     ──kiểm quyền TỪNG phong bì──▶ các kết nối SSE `/api/chat/stream` của tiến trình này
 *
 * ⚠️ Thiết kế cho MỘT container app (docker compose trên VPS). Chạy nhiều bản app thì vẫn
 * đúng — mỗi bản có hub + LISTEN riêng, NOTIFY tới mọi bản — nhưng KHÔNG chạy được trên
 * serverless (Vercel): hàm chết sau mỗi request, không giữ nổi kết nối LISTEN.
 *
 * Mất kết nối LISTEN = hub MÙ: mọi NOTIFY trong lúc đó mất. Không có event log để phát lại,
 * nên hub ĐÓNG mọi kết nối SSE ⇒ trình duyệt tự nối lại ⇒ `SUBSCRIBED` ⇒ reconcile bù tin qua
 * đường đã kiểm quyền (US-07 AC2). Route SSE chờ `ready()` trước khi mở stream, nên client
 * không "SUBSCRIBED" vào một hub còn mù.
 */

/** Phần của `pg.Client` mà hub dùng — tách ra để test bơm bản giả. */
export type ListenClient = {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<unknown>;
  on(event: "notification", listener: (msg: { channel: string; payload?: string }) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  on(event: "end", listener: () => void): unknown;
};

/** Một kết nối SSE đang mở. */
export type HubSubscriber = {
  userId: string;
  /** Hội thoại kết nối này xin nghe (topic `conv:{id}`); topic `user:{userId}` luôn có. */
  conversationIds: ReadonlySet<string>;
  /** Cổng quyền của CHÍNH kết nối này — hỏi ở mỗi phong bì (`realtime-authz.ts`). */
  authorize: TopicAuthorizer;
  send(envelope: RealtimeEnvelope): void;
  /** Hub mất LISTEN ⇒ route đóng stream để client nối lại + reconcile. */
  close(): void;
};

export type RealtimeHub = {
  /** Đăng ký; trả hàm huỷ. Người nghe đầu tiên làm hub nối LISTEN (lười). */
  subscribe(subscriber: HubSubscriber): () => void;
  /** Chờ LISTEN sẵn sàng tối đa `timeoutMs`. false = chưa sẵn sàng (route trả 503). */
  ready(timeoutMs: number): Promise<boolean>;
  /** Số kết nối đang mở — của một người, hoặc tổng. */
  subscriberCount(userId?: string): number;
};

type SubscriberState = { sub: HubSubscriber; chain: Promise<void> };

function parseEnvelope(raw: string | undefined): RealtimeEnvelope | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.topic !== "string" || typeof o.event !== "string") return null;
  if (typeof o.payload !== "object" || o.payload === null || Array.isArray(o.payload)) return null;
  return { topic: o.topic, event: o.event, payload: o.payload as Record<string, unknown> };
}

export function createRealtimeHub(deps: {
  createClient: () => ListenClient;
  baseDelayMs?: number;
  maxDelayMs?: number;
}): RealtimeHub {
  const baseDelayMs = deps.baseDelayMs ?? 1_000;
  const maxDelayMs = deps.maxDelayMs ?? 30_000;

  const subscribers = new Set<SubscriberState>();
  let state: "idle" | "connecting" | "ready" | "waiting" = "idle";
  let client: ListenClient | null = null;
  let attempt = 0;
  let waiters: Array<() => void> = [];

  const wakeWaiters = () => {
    const w = waiters;
    waiters = [];
    for (const fn of w) fn();
  };

  const deliver = (envelope: RealtimeEnvelope) => {
    const { topic } = envelope;
    let targets: SubscriberState[];
    if (topic.startsWith("user:")) {
      const userId = topic.slice("user:".length);
      targets = [...subscribers].filter((s) => s.sub.userId === userId);
    } else if (topic.startsWith("conv:")) {
      const conversationId = topic.slice("conv:".length);
      targets = [...subscribers].filter((s) => s.sub.conversationIds.has(conversationId));
    } else {
      return;
    }
    for (const s of targets) {
      // Nối vào chuỗi RIÊNG của người nghe ⇒ kiểm quyền bất đồng bộ không làm đảo thứ tự tin.
      s.chain = s.chain
        .then(async () => {
          if (!subscribers.has(s)) return;
          if (await s.sub.authorize(topic)) {
            if (subscribers.has(s)) s.sub.send(envelope);
          }
        })
        .catch((e: unknown) => {
          console.warn("[chat/realtime-hub] Giao phong bì hỏng — bỏ qua.", e);
        });
    }
  };

  const onLost = (lost: ListenClient, err?: unknown) => {
    if (client !== lost) return; // sự cố thứ hai của cùng một kết nối — đã xử lý rồi
    client = null;
    state = "waiting";
    console.warn(
      `[chat/realtime-hub] Mất kết nối LISTEN — đóng ${subscribers.size} kết nối SSE để client nối lại + reconcile.`,
      err,
    );
    void lost.end().catch(() => {});
    const all = [...subscribers];
    subscribers.clear();
    for (const s of all) {
      try {
        s.sub.close();
      } catch {
        // Đóng một stream hỏng không được chặn việc đóng những cái còn lại.
      }
    }
    const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
    attempt += 1;
    setTimeout(() => void connect(), delay);
  };

  const connect = async () => {
    if (state === "connecting" || state === "ready") return;
    state = "connecting";
    const c = deps.createClient();
    client = c;
    c.on("notification", (msg) => {
      if (client !== c || msg.channel !== CHAT_REALTIME_CHANNEL) return;
      const envelope = parseEnvelope(msg.payload);
      if (envelope) deliver(envelope);
    });
    c.on("error", (e) => onLost(c, e));
    c.on("end", () => onLost(c));
    try {
      await c.connect();
      await c.query(`LISTEN ${CHAT_REALTIME_CHANNEL}`);
      if (client !== c) return;
      state = "ready";
      attempt = 0;
      wakeWaiters();
    } catch (e) {
      onLost(c, e);
    }
  };

  const ensureStarted = () => {
    if (state === "idle") void connect();
  };

  return {
    subscribe(sub) {
      const s: SubscriberState = { sub, chain: Promise.resolve() };
      subscribers.add(s);
      ensureStarted();
      return () => {
        subscribers.delete(s);
      };
    },

    ready(timeoutMs) {
      ensureStarted();
      if (state === "ready") return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        let settled = false;
        const done = (v: boolean) => {
          if (settled) return;
          settled = true;
          resolve(v);
        };
        const timer = setTimeout(() => {
          waiters = waiters.filter((w) => w !== onReady);
          done(false);
        }, timeoutMs);
        const onReady = () => {
          clearTimeout(timer);
          done(true);
        };
        waiters.push(onReady);
      });
    },

    subscriberCount(userId) {
      if (userId === undefined) return subscribers.size;
      let n = 0;
      for (const s of subscribers) if (s.sub.userId === userId) n += 1;
      return n;
    },
  };
}

/**
 * Chuỗi kết nối cho LISTEN. Trên VPS là Postgres thường ⇒ `DATABASE_URL` dùng được.
 * `DIRECT_URL` đứng trước vì nếu còn chạy qua pooler Supabase thì transaction pooler (6543)
 * KHÔNG giữ được LISTEN, còn session pooler / kết nối thẳng thì giữ được.
 */
function listenConnectionString(): string | undefined {
  return process.env.DIRECT_URL || process.env.DATABASE_URL;
}

const HUB_KEY = Symbol.for("satarobo.chat.realtimeHub");
type GlobalWithHub = typeof globalThis & { [HUB_KEY]?: RealtimeHub };

/**
 * Hub dùng thật — MỘT bản cho cả tiến trình (giữ qua HMR ở dev bằng `globalThis`), nên cũng
 * chỉ MỘT kết nối LISTEN dù có bao nhiêu tab đang mở.
 */
export function getRealtimeHub(): RealtimeHub {
  const g = globalThis as GlobalWithHub;
  if (!g[HUB_KEY]) {
    g[HUB_KEY] = createRealtimeHub({
      createClient: () =>
        new Client({
          connectionString: listenConnectionString(),
          keepAlive: true,
          application_name: "satarobo-chat-realtime",
        }),
    });
  }
  return g[HUB_KEY];
}
