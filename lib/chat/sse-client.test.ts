/**
 * Phương án B — tầng kết nối SSE phía trình duyệt (`lib/chat/sse-client.ts`).
 *
 * Bất biến khoá ở đây (hợp đồng handlers mà hai consumer dựa vào — kế thừa từ tầng Supabase cũ):
 *  • MỘT EventSource cho cả tab, dù có kênh `conv:` + kênh `user:` + nhiều badge.
 *  • `SUBSCRIBED` bắn cho mỗi người giữ khi kết nối mở, và BẮN LẠI sau mỗi lần nối lại ⇒
 *    `useChatChannel` reconcile, hub `user:` resync (US-07 AC2 — chốt chặn mất tin).
 *  • Đứt tạm (EventSource tự nối) ⇒ `CHANNEL_ERROR` (người giữ KHÔNG tự nối chồng);
 *    đứt hẳn (401/403/503 — readyState CLOSED) ⇒ `CLOSED` (người giữ nối lại có backoff).
 *  • Thêm hội thoại mới ⇒ mở kết nối mới TRƯỚC rồi mới đóng cái cũ (không có khe hở cho kênh
 *    đang chạy, và kênh đang chạy không bị reconcile thừa).
 *  • Chỉ giao phong bì đúng topic; phong bì dị dạng bị bỏ.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event("open"));
  }
  message(data: unknown) {
    this.onmessage?.(
      new MessageEvent("message", { data: typeof data === "string" ? data : JSON.stringify(data) }),
    );
  }
  /** Đứt tạm — trình duyệt sẽ tự nối lại. */
  drop() {
    this.readyState = FakeEventSource.CONNECTING;
    this.onerror?.(new Event("error"));
  }
  /** Đứt hẳn (server trả 401/503…) — trình duyệt KHÔNG tự nối. */
  fail() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.(new Event("error"));
  }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
}

async function load() {
  vi.resetModules();
  return import("./sse-client");
}

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function recorder() {
  const statuses: string[] = [];
  const events: Array<[string, Record<string, unknown>]> = [];
  return {
    statuses,
    events,
    handlers: {
      onStatus: (s: string) => statuses.push(s),
      onBroadcast: (e: string, p: Record<string, unknown>) => events.push([e, p]),
    },
  };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("một kết nối cho cả tab", () => {
  it("user: + conv: dùng chung MỘT EventSource, URL mang danh sách hội thoại", async () => {
    const { subscribeSseTopic } = await load();
    subscribeSseTopic("user:u1", {});
    subscribeSseTopic("conv:c1", {});
    await settle();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/chat/stream?conv=c1");
  });

  it("chỉ có kênh user: ⇒ không tham số conv", async () => {
    const { subscribeSseTopic } = await load();
    subscribeSseTopic("user:u1", {});
    await settle();
    expect(FakeEventSource.instances[0].url).toBe("/api/chat/stream");
  });

  it("người giữ cuối cùng rời ⇒ đóng kết nối", async () => {
    const { subscribeSseTopic } = await load();
    const a = subscribeSseTopic("user:u1", {});
    const b = subscribeSseTopic("conv:c1", {});
    await settle();
    a.unsubscribe();
    await settle();
    expect(FakeEventSource.instances[0].closed).toBe(false);
    b.unsubscribe();
    await settle();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});

describe("trạng thái + catch-up khi nối lại", () => {
  it("mở ⇒ SUBSCRIBED cho mọi người giữ", async () => {
    const { subscribeSseTopic } = await load();
    const u = recorder();
    const c = recorder();
    subscribeSseTopic("user:u1", u.handlers);
    subscribeSseTopic("conv:c1", c.handlers);
    await settle();
    FakeEventSource.instances[0].open();
    expect(u.statuses).toEqual(["SUBSCRIBED"]);
    expect(c.statuses).toEqual(["SUBSCRIBED"]);
  });

  it("đứt tạm rồi tự nối lại ⇒ CHANNEL_ERROR rồi SUBSCRIBED LẠI (kích reconcile/resync)", async () => {
    const { subscribeSseTopic } = await load();
    const c = recorder();
    subscribeSseTopic("conv:c1", c.handlers);
    await settle();
    const es = FakeEventSource.instances[0];
    es.open();
    es.drop();
    es.open(); // trình duyệt tự nối lại
    expect(c.statuses).toEqual(["SUBSCRIBED", "CHANNEL_ERROR", "SUBSCRIBED"]);
    // Không mở kết nối thứ hai — việc nối lại là của EventSource.
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("đứt hẳn (server từ chối) ⇒ CLOSED để người giữ nối lại theo backoff của họ", async () => {
    const { subscribeSseTopic } = await load();
    const c = recorder();
    const sub = subscribeSseTopic("conv:c1", c.handlers);
    await settle();
    FakeEventSource.instances[0].open();
    FakeEventSource.instances[0].fail();
    expect(c.statuses).toEqual(["SUBSCRIBED", "CLOSED"]);

    // Người giữ nối lại: rời + đăng ký mới ⇒ kết nối mới ⇒ SUBSCRIBED ⇒ reconcile.
    sub.unsubscribe();
    const c2 = recorder();
    subscribeSseTopic("conv:c1", c2.handlers);
    await settle();
    expect(FakeEventSource.instances).toHaveLength(2);
    FakeEventSource.instances[1].open();
    expect(c2.statuses).toEqual(["SUBSCRIBED"]);
  });

  it("người giữ mới gia nhập kết nối ĐANG mở ⇒ nhận SUBSCRIBED ngay, không mở kết nối mới", async () => {
    const { subscribeSseTopic } = await load();
    subscribeSseTopic("conv:c1", {});
    await settle();
    FakeEventSource.instances[0].open();
    const u = recorder();
    subscribeSseTopic("user:u1", u.handlers);
    await settle();
    expect(u.statuses).toEqual(["SUBSCRIBED"]);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("không có EventSource (trình duyệt quá cũ) ⇒ CLOSED, không ném", async () => {
    vi.stubGlobal("EventSource", undefined);
    const { subscribeSseTopic } = await load();
    const c = recorder();
    expect(() => subscribeSseTopic("conv:c1", c.handlers)).not.toThrow();
    await settle();
    expect(c.statuses).toEqual(["CLOSED"]);
  });
});

describe("thêm hội thoại: mở mới trước, đóng cũ sau", () => {
  it("kênh đang chạy không bị SUBSCRIBED lại; kênh mới nhận SUBSCRIBED khi kết nối mới mở", async () => {
    const { subscribeSseTopic } = await load();
    const u = recorder();
    subscribeSseTopic("user:u1", u.handlers);
    await settle();
    const first = FakeEventSource.instances[0];
    first.open();

    const c = recorder();
    subscribeSseTopic("conv:c1", c.handlers);
    await settle();
    expect(FakeEventSource.instances).toHaveLength(2);
    const second = FakeEventSource.instances[1];
    expect(second.url).toBe("/api/chat/stream?conv=c1");
    // Trong lúc kết nối mới chưa mở, kết nối cũ vẫn giao cho kênh user:.
    expect(first.closed).toBe(false);
    first.message({ topic: "user:u1", event: "conversation.bumped", payload: { a: 1 } });
    expect(u.events).toHaveLength(1);

    second.open();
    expect(first.closed).toBe(true);
    expect(u.statuses).toEqual(["SUBSCRIBED"]); // không bị bắn lại
    expect(c.statuses).toEqual(["SUBSCRIBED"]);

    // Phong bì muộn từ kết nối cũ bị bỏ (tránh giao đôi).
    first.message({ topic: "user:u1", event: "conversation.bumped", payload: { a: 2 } });
    expect(u.events).toHaveLength(1);
  });

  it("rời hội thoại KHÔNG mở lại kết nối (topic thừa vô hại vì server kiểm quyền từng phong bì)", async () => {
    const { subscribeSseTopic } = await load();
    subscribeSseTopic("user:u1", {});
    const c = subscribeSseTopic("conv:c1", {});
    await settle();
    FakeEventSource.instances[0].open();
    c.unsubscribe();
    await settle();
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});

describe("giao phong bì", () => {
  it("chỉ đúng topic nhận; dị dạng bị bỏ", async () => {
    const { subscribeSseTopic } = await load();
    const c1 = recorder();
    const c2 = recorder();
    subscribeSseTopic("conv:c1", c1.handlers);
    subscribeSseTopic("conv:c2", c2.handlers);
    await settle();
    const es = FakeEventSource.instances[0];
    es.open();
    es.message({ topic: "conv:c1", event: "message.created", payload: { id: "m1" } });
    es.message("{hỏng");
    es.message({ topic: "conv:c1", event: 5, payload: {} });
    es.message({ topic: "conv:c2", event: "message.deleted", payload: null });
    expect(c1.events).toEqual([["message.created", { id: "m1" }]]);
    expect(c2.events).toEqual([]);
  });

  it("người giữ đã rời ⇒ không nhận nữa", async () => {
    const { subscribeSseTopic } = await load();
    const keep = recorder();
    const gone = recorder();
    subscribeSseTopic("conv:c1", keep.handlers);
    const sub = subscribeSseTopic("conv:c1", gone.handlers);
    await settle();
    FakeEventSource.instances[0].open();
    sub.unsubscribe();
    FakeEventSource.instances[0].message({ topic: "conv:c1", event: "message.created", payload: {} });
    expect(keep.events).toHaveLength(1);
    expect(gone.events).toHaveLength(0);
  });
});
