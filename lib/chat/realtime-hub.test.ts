// @vitest-environment node
/**
 * Phương án B — hub LISTEN/NOTIFY mỗi tiến trình: MỘT kết nối `LISTEN`, rải phong bì xuống
 * các kết nối SSE sau khi kiểm quyền TỪNG phong bì.
 *
 * Bất biến khoá ở đây:
 *  • Chỉ đúng người nghe đúng topic nhận được, và chỉ khi `authorize(topic)` đồng ý tại
 *    THỜI ĐIỂM GIAO (người bị gỡ giữa phiên không nhận nữa).
 *  • Mất kết nối LISTEN ⇒ đóng MỌI kết nối SSE (client nối lại → reconcile bù tin lỡ trong
 *    lúc hub mù), rồi tự nối lại có backoff.
 *  • Phong bì dị dạng / sai kênh ⇒ bỏ im lặng, không làm sập hub.
 *  • Thứ tự giao giữ nguyên theo từng người nghe dù kiểm quyền là bất đồng bộ.
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRealtimeHub, type HubSubscriber, type ListenClient } from "./realtime-hub";
import { CHAT_REALTIME_CHANNEL, type RealtimeEnvelope } from "./realtime-notify";

vi.mock("@/lib/db", () => ({ db: {} }));

class FakeClient extends EventEmitter implements ListenClient {
  queries: string[] = [];
  ended = false;
  failConnect = false;
  async connect() {
    if (this.failConnect) throw new Error("ECONNREFUSED");
  }
  async query(sql: string) {
    this.queries.push(sql);
    return {};
  }
  async end() {
    this.ended = true;
  }
  notify(env: RealtimeEnvelope | string, channel = CHAT_REALTIME_CHANNEL) {
    this.emit("notification", {
      channel,
      payload: typeof env === "string" ? env : JSON.stringify(env),
    });
  }
}

function makeSub(
  userId: string,
  convs: string[],
  authorize: (topic: string) => Promise<boolean> = async () => true,
) {
  const got: RealtimeEnvelope[] = [];
  const close = vi.fn();
  const sub: HubSubscriber = {
    userId,
    conversationIds: new Set(convs),
    authorize,
    send: (env) => got.push(env),
    close,
  };
  return { sub, got, close };
}

/** Đợi mọi chuỗi promise (kiểm quyền → giao) chạy xong. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

let clients: FakeClient[];
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clients = [];
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  vi.useRealTimers();
});

function hub(opts: { failFirst?: boolean } = {}) {
  return createRealtimeHub({
    createClient: () => {
      const c = new FakeClient();
      if (opts.failFirst && clients.length === 0) c.failConnect = true;
      clients.push(c);
      return c;
    },
    baseDelayMs: 10,
    maxDelayMs: 40,
  });
}

describe("rải phong bì theo topic + quyền tại lúc giao", () => {
  it("LISTEN đúng kênh, lười: chỉ nối khi có người nghe đầu tiên", async () => {
    const h = hub();
    expect(clients).toHaveLength(0);
    h.subscribe(makeSub("u1", []).sub);
    await expect(h.ready(1000)).resolves.toBe(true);
    expect(clients).toHaveLength(1);
    expect(clients[0].queries).toEqual([`LISTEN ${CHAT_REALTIME_CHANNEL}`]);
  });

  it("conv:{id} chỉ tới người nghe hội thoại đó; user:{id} chỉ tới chính chủ", async () => {
    const h = hub();
    const a = makeSub("u-a", ["c1"]);
    const b = makeSub("u-b", ["c2"]);
    h.subscribe(a.sub);
    h.subscribe(b.sub);
    await h.ready(1000);

    clients[0].notify({ topic: "conv:c1", event: "message.created", payload: { id: "m1" } });
    clients[0].notify({ topic: "user:u-b", event: "conversation.bumped", payload: { at: "x" } });
    await flush();

    expect(a.got.map((e) => e.topic)).toEqual(["conv:c1"]);
    expect(b.got.map((e) => e.topic)).toEqual(["user:u-b"]);
  });

  it("authorize từ chối (đã bị gỡ) ⇒ KHÔNG giao, dù vẫn đang nghe topic", async () => {
    const h = hub();
    let member = true;
    const ph = makeSub("u-ph", ["c1"], async (topic) => topic === "conv:c1" && member);
    h.subscribe(ph.sub);
    await h.ready(1000);

    clients[0].notify({ topic: "conv:c1", event: "message.created", payload: { id: "m1" } });
    await flush();
    member = false; // gỡ khỏi lớp giữa phiên
    clients[0].notify({ topic: "conv:c1", event: "message.created", payload: { id: "m2" } });
    await flush();

    expect(ph.got.map((e) => e.payload.id)).toEqual(["m1"]);
  });

  it("thứ tự giao giữ nguyên dù lần kiểm quyền đầu chậm hơn các lần sau", async () => {
    const h = hub();
    let first = true;
    const s = makeSub("u1", ["c1"], async () => {
      if (first) {
        first = false;
        await new Promise((r) => setTimeout(r, 20));
      }
      return true;
    });
    h.subscribe(s.sub);
    await h.ready(1000);
    for (const id of ["m1", "m2", "m3"]) {
      clients[0].notify({ topic: "conv:c1", event: "message.created", payload: { id } });
    }
    await new Promise((r) => setTimeout(r, 40));
    await flush();
    expect(s.got.map((e) => e.payload.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("phong bì dị dạng / kênh khác ⇒ bỏ, hub vẫn sống", async () => {
    const h = hub();
    const s = makeSub("u1", ["c1"]);
    h.subscribe(s.sub);
    await h.ready(1000);
    clients[0].notify("{không phải json");
    clients[0].notify(JSON.stringify({ topic: 1, event: "x", payload: {} }));
    clients[0].notify({ topic: "conv:c1", event: "message.created", payload: { id: "m1" } }, "kenh_khac");
    clients[0].notify({ topic: "conv:c1", event: "message.created", payload: { id: "ok" } });
    await flush();
    expect(s.got.map((e) => e.payload.id)).toEqual(["ok"]);
  });

  it("người nghe đã huỷ ⇒ không nhận nữa", async () => {
    const h = hub();
    const s = makeSub("u1", ["c1"]);
    const off = h.subscribe(s.sub);
    await h.ready(1000);
    off();
    clients[0].notify({ topic: "conv:c1", event: "message.created", payload: { id: "m1" } });
    await flush();
    expect(s.got).toHaveLength(0);
    expect(h.subscriberCount()).toBe(0);
  });

  it("đếm kết nối theo người dùng (để route chặn mở quá nhiều)", () => {
    const h = hub();
    h.subscribe(makeSub("u1", []).sub);
    h.subscribe(makeSub("u1", []).sub);
    h.subscribe(makeSub("u2", []).sub);
    expect(h.subscriberCount("u1")).toBe(2);
    expect(h.subscriberCount()).toBe(3);
  });
});

describe("mất kết nối LISTEN ⇒ đóng SSE + tự nối lại có backoff", () => {
  it("lỗi kết nối ⇒ mọi người nghe bị đóng (để client nối lại + reconcile), rồi LISTEN lại", async () => {
    const h = hub();
    const a = makeSub("u-a", ["c1"]);
    const b = makeSub("u-b", []);
    h.subscribe(a.sub);
    h.subscribe(b.sub);
    await h.ready(1000);

    clients[0].emit("error", new Error("terminating connection due to administrator command"));
    expect(a.close).toHaveBeenCalledTimes(1);
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(h.subscriberCount()).toBe(0);
    expect(clients[0].ended).toBe(true);

    // Chưa sẵn sàng ngay — đang chờ backoff.
    await expect(h.ready(1000)).resolves.toBe(true);
    expect(clients).toHaveLength(2);
    expect(clients[1].queries).toEqual([`LISTEN ${CHAT_REALTIME_CHANNEL}`]);

    // Người nghe mới sau khi nối lại nhận bình thường; kết nối cũ không còn giao gì.
    const c = makeSub("u-c", ["c1"]);
    h.subscribe(c.sub);
    clients[0].notify({ topic: "conv:c1", event: "message.created", payload: { id: "cu" } });
    clients[1].notify({ topic: "conv:c1", event: "message.created", payload: { id: "moi" } });
    await flush();
    expect(c.got.map((e) => e.payload.id)).toEqual(["moi"]);
  });

  it("'end' cũng tính là mất kết nối, và một sự cố không đóng người nghe hai lần", async () => {
    const h = hub();
    const a = makeSub("u-a", []);
    h.subscribe(a.sub);
    await h.ready(1000);
    clients[0].emit("error", new Error("x"));
    clients[0].emit("end");
    expect(a.close).toHaveBeenCalledTimes(1);
  });

  it("nối lần đầu hỏng ⇒ thử lại theo backoff; ready() hết hạn thì trả false", async () => {
    const h = hub({ failFirst: true });
    h.subscribe(makeSub("u1", []).sub);
    await expect(h.ready(1)).resolves.toBe(false);
    await expect(h.ready(1000)).resolves.toBe(true);
    expect(clients.length).toBeGreaterThanOrEqual(2);
  });
});
