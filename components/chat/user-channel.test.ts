// components/chat/user-channel.test.ts — hub kênh `user:{id}`: refcount, resync, gia hạn token.
//
// Không chạm server realtime thật: transport + endpoint token đều bơm vào (DI), giống
// `use-chat-channel.test.ts`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createUserChannelHub,
  type UserChannelEvent,
  type UserChannelHandlers,
  type UserChannelTransport,
} from "./user-channel";

const ME = "user-me";
/** TTL thật của `/api/chat/realtime-token`. */
const TTL_MS = 5 * 60_000;
/** Trần backoff nối lại (`RECONNECT_MAX_MS` trong user-channel.ts). */
const RECONNECT_CAP_MS = 30_000;

function createFakeTransport() {
  const calls = {
    subscribe: [] as { userId: string; jwt: string }[],
    /** Vé đã giao cho chu kỳ gia hạn (`renewAuth`), theo thứ tự. */
    setAuth: [] as string[],
    unsubscribe: 0,
  };
  let handlers: UserChannelHandlers | null = null;

  const transport: UserChannelTransport = {
    subscribe(userId, auth, h) {
      calls.subscribe.push({ userId, jwt: auth.token });
      handlers = h;
      return {
        unsubscribe: () => {
          calls.unsubscribe += 1;
        },
      };
    },
    renewAuth(auth) {
      calls.setAuth.push(auth.token);
      return auth.expiresAt;
    },
  };

  return {
    transport,
    calls,
    get handlers(): UserChannelHandlers {
      if (!handlers) throw new Error("chưa subscribe");
      return handlers;
    },
  };
}

function setup(over: { fetchToken?: () => Promise<{ token: string; expiresAt: string }> } = {}) {
  const fake = createFakeTransport();
  let seq = 0;
  const fetchToken =
    over.fetchToken ??
    vi.fn(async () => ({
      token: `jwt-${++seq}`,
      expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
    }));
  const hub = createUserChannelHub({ transport: fake.transport, fetchToken });
  return { hub, fake, fetchToken };
}

async function flush(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
}

function bumpPayload(over: Record<string, unknown> = {}) {
  return {
    conversationId: "conv-1",
    messageId: "msg-1",
    kind: "CHAT",
    at: "2026-08-09T10:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-09T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createUserChannelHub", () => {
  it("3 người nghe cùng một userId ⇒ MỞ ĐÚNG MỘT kênh, topic `user:{id}`", async () => {
    const { hub, fake } = setup();
    const offs = [vi.fn(), vi.fn(), vi.fn()].map((l) => hub.subscribe(ME, l));
    await flush();

    expect(fake.calls.subscribe).toHaveLength(1);
    expect(fake.calls.subscribe[0].userId).toBe(ME);
    offs.forEach((off) => off());
  });

  it("người nghe cuối cùng rời mới đóng kênh", async () => {
    const { hub, fake } = setup();
    const off1 = hub.subscribe(ME, vi.fn());
    const off2 = hub.subscribe(ME, vi.fn());
    await flush();

    off1();
    expect(fake.calls.unsubscribe).toBe(0);
    off2();
    expect(fake.calls.unsubscribe).toBe(1);
  });

  // Sự cố egress 05/09/2026: bản cũ `resync` ở MỌI lần SUBSCRIBED ⇒ mỗi lần gia hạn vé (4') là
  // mọi tab gọi lại summary + unread. Nay chỉ `resync` sau khi kênh ĐỨT rồi nối lại được.
  it("`resync` CHỈ phát ở lần SUBSCRIBED sau khi kênh đứt — không ở lần join đầu", async () => {
    const { hub, fake } = setup();
    const events: UserChannelEvent[] = [];
    const off = hub.subscribe(ME, (e) => events.push(e));
    await flush();

    fake.handlers.onStatus("SUBSCRIBED");
    expect(events.filter((e) => e.type === "resync")).toHaveLength(0);

    fake.handlers.onStatus("CHANNEL_ERROR", new Error("rớt mạng"));
    fake.handlers.onStatus("SUBSCRIBED");
    expect(events.filter((e) => e.type === "resync")).toHaveLength(1);

    // Join lại do gia hạn vé không đi qua trạng thái đứt ⇒ không resync thêm.
    fake.handlers.onStatus("SUBSCRIBED");
    expect(events.filter((e) => e.type === "resync")).toHaveLength(1);
    off();
  });

  it("broadcast `conversation.bumped` → event bump đã chuẩn hoá", async () => {
    const { hub, fake } = setup();
    const events: UserChannelEvent[] = [];
    const off = hub.subscribe(ME, (e) => events.push(e));
    await flush();

    fake.handlers.onBroadcast("conversation.bumped", bumpPayload());

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "bump" });
    if (events[0].type === "bump") {
      expect(events[0].bump.conversationId).toBe("conv-1");
      expect(events[0].bump.messageId).toBe("msg-1");
    }
    off();
  });

  // Chuông nhân sự đi nhờ ĐÚNG kênh này (không dựng SSE, không mở topic mới). Cửa chặn nằm
  // ở `handleBroadcast`: nó lọc theo TÊN event, nên tên mới mà quên mở là bị nuốt CÂM —
  // không log, không lỗi, badge chuông vẫn đứng chờ vòng poll 60s như chưa có gì xảy ra.
  it("broadcast `notification.bumped` → event noti kèm mốc thời gian đã chuẩn hoá", async () => {
    const { hub, fake } = setup();
    const events: UserChannelEvent[] = [];
    const off = hub.subscribe(ME, (e) => events.push(e));
    await flush();

    fake.handlers.onBroadcast("notification.bumped", { at: "2026-08-19T03:04:05.000Z" });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "noti" });
    if (events[0].type === "noti") {
      expect(events[0].at.toISOString()).toBe("2026-08-19T03:04:05.000Z");
    }
    off();
  });

  // Cùng luật với bump: thà bỏ tín hiệu hỏng còn hơn giao `Invalid Date` cho người nghe.
  it("payload `notification.bumped` dị dạng ⇒ KHÔNG gọi người nghe", async () => {
    const { hub, fake } = setup();
    const listener = vi.fn();
    const off = hub.subscribe(ME, listener);
    await flush();

    fake.handlers.onBroadcast("notification.bumped", {});
    fake.handlers.onBroadcast("notification.bumped", { at: "không-phải-ngày" });
    fake.handlers.onBroadcast("notification.bumped", { at: null });
    // Đúng loại bẫy BR-30 mà server phải chặn: kể cả có nội dung kèm theo, thiếu `at` hợp lệ
    // thì vẫn là tín hiệu hỏng — không được "vớt" bằng cách lấy giờ máy client.
    fake.handlers.onBroadcast("notification.bumped", { title: "Có nhận xét mới" });

    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it("payload dị dạng hoặc event lạ ⇒ KHÔNG gọi người nghe", async () => {
    const { hub, fake } = setup();
    const listener = vi.fn();
    const off = hub.subscribe(ME, listener);
    await flush();

    fake.handlers.onBroadcast("conversation.bumped", bumpPayload({ messageId: undefined }));
    fake.handlers.onBroadcast("conversation.bumped", bumpPayload({ at: "không-phải-ngày" }));
    // "message.created" chỉ chạy trên topic `conv:{id}`, KHÔNG bao giờ trên `user:{id}` ⇒
    // vẫn là tên lạ thật sự với hub này. Đừng thay bằng một tên hub CÓ nhận (vd
    // `notification.bumped`) — bài test sẽ xanh giả và không còn khoá được gì.
    fake.handlers.onBroadcast("message.created", { id: "m1" });

    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it("một người nghe ném lỗi KHÔNG chặn những người còn lại", async () => {
    const { hub, fake } = setup();
    const good = vi.fn();
    const off1 = hub.subscribe(ME, () => {
      throw new Error("hỏng");
    });
    const off2 = hub.subscribe(ME, good);
    await flush();

    fake.handlers.onBroadcast("conversation.bumped", bumpPayload());
    expect(good).toHaveBeenCalledTimes(1);
    off1();
    off2();
  });

  it("tới ~80% TTL thì xin token mới và setAuth (kênh không rớt)", async () => {
    const { hub, fake, fetchToken } = setup();
    const off = hub.subscribe(ME, vi.fn());
    await flush();
    expect(fetchToken).toHaveBeenCalledTimes(1);

    await flush(TTL_MS * 0.8 + 10);
    expect(fetchToken).toHaveBeenCalledTimes(2);
    expect(fake.calls.setAuth).toEqual(["jwt-2"]);
    expect(fake.calls.unsubscribe).toBe(0);
    off();
  });

  it("xin token hỏng ⇒ thử lại sau 30s, KHÔNG đóng kênh", async () => {
    let n = 0;
    const fetchToken = vi.fn(async () => {
      n += 1;
      if (n === 2) throw new Error("mạng chớp");
      return { token: `jwt-${n}`, expiresAt: new Date(Date.now() + TTL_MS).toISOString() };
    });
    const { hub, fake } = setup({ fetchToken });
    const off = hub.subscribe(ME, vi.fn());
    await flush();

    await flush(TTL_MS * 0.8 + 10); // lần gia hạn hỏng
    expect(fake.calls.setAuth).toHaveLength(0);
    expect(fake.calls.unsubscribe).toBe(0);

    await flush(30_000 + 10); // thử lại
    expect(fake.calls.setAuth).toEqual(["jwt-3"]);
    off();
  });

  it("mở kênh hỏng ⇒ thử lại sau 30s (hub sống suốt phiên)", async () => {
    let n = 0;
    const fetchToken = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("mạng chớp lúc tải trang");
      return { token: `jwt-${n}`, expiresAt: new Date(Date.now() + TTL_MS).toISOString() };
    });
    const { hub, fake } = setup({ fetchToken });
    const off = hub.subscribe(ME, vi.fn());
    await flush();
    expect(fake.calls.subscribe).toHaveLength(0);

    await flush(30_000 + 10);
    expect(fake.calls.subscribe).toHaveLength(1);
    off();
  });

  it("huỷ trước khi token về ⇒ không mở kênh mồ côi", async () => {
    const { hub, fake } = setup();
    const off = hub.subscribe(ME, vi.fn());
    off();
    await flush();
    expect(fake.calls.subscribe).toHaveLength(0);
  });

  it("người nghe đăng ký SAU khi kênh đã mở vẫn nhận bump (không chỉ người mở kênh)", async () => {
    const { hub, fake } = setup();
    const off1 = hub.subscribe(ME, vi.fn());
    await flush();
    const late = vi.fn();
    const off2 = hub.subscribe(ME, late);
    await flush();

    // Vẫn đúng MỘT kênh — người tới sau ghé nhờ kênh sẵn có.
    expect(fake.calls.subscribe).toHaveLength(1);
    fake.handlers.onBroadcast("conversation.bumped", bumpPayload());
    expect(late).toHaveBeenCalledTimes(1);
    off1();
    off2();
  });

  it("mở lại kênh (badge mount lại sau khi rời chat) ⇒ xin vé MỚI, không xài lại vé cũ", async () => {
    const { hub, fake, fetchToken } = setup();
    const off = hub.subscribe(ME, vi.fn());
    await flush();

    // Đã đi qua một lần gia hạn ⇒ vé jwt-1 trong tay hub là vé CŨ.
    await flush(TTL_MS * 0.8 + 10);
    expect(fake.calls.setAuth).toEqual(["jwt-2"]);

    off(); // người nghe cuối rời ⇒ kênh đóng
    expect(fake.calls.unsubscribe).toBe(1);

    const off2 = hub.subscribe(ME, vi.fn());
    await flush();

    // Vé cũ có thể đã hết TTL 15' ⇒ join bằng nó là kênh câm không báo lỗi.
    expect(fetchToken).toHaveBeenCalledTimes(3);
    expect(fake.calls.subscribe).toHaveLength(2);
    expect(fake.calls.subscribe[1].jwt).toBe("jwt-3");
    off2();
  });

  it("đổi người dùng trong cùng tab ⇒ đóng kênh cũ, mở kênh của người MỚI", async () => {
    const { hub, fake } = setup();
    const off1 = hub.subscribe(ME, vi.fn());
    await flush();

    const off2 = hub.subscribe("user-khac", vi.fn());
    await flush();

    expect(fake.calls.unsubscribe).toBe(1);
    expect(fake.calls.subscribe.map((c) => c.userId)).toEqual([ME, "user-khac"]);
    off1();
    off2();
  });

  // Đo thật (LỖ 3): kênh đã CLOSED thì KHÔNG tự hồi. Hub sống suốt phiên nên "đóng rồi
  // thôi" = badge chưa đọc đứng im tới khi người dùng F5 — không lỗi, không dấu hiệu.
  it("CLOSED ngoài ý muốn ⇒ nối lại bằng vé MỚI sau backoff", async () => {
    const { hub, fake, fetchToken } = setup();
    const off = hub.subscribe(ME, vi.fn());
    await flush();
    fake.handlers.onStatus("SUBSCRIBED");

    fake.handlers.onStatus("CLOSED");
    expect(fake.calls.subscribe).toHaveLength(1); // chưa nối ngay

    await flush(2_000 + 10);
    expect(fake.calls.subscribe).toHaveLength(2);
    expect(fetchToken).toHaveBeenCalledTimes(2);
    expect(fake.calls.subscribe[1].jwt).toBe("jwt-2");
    off();
  });

  it("không còn người nghe ⇒ CLOSED KHÔNG nối lại (kênh do chính ta đóng)", async () => {
    const { hub, fake } = setup();
    const off = hub.subscribe(ME, vi.fn());
    await flush();
    const stale = fake.handlers;

    off();
    expect(fake.calls.unsubscribe).toBe(1);
    stale.onStatus("CLOSED");
    await flush(RECONNECT_CAP_MS * 3);

    expect(fake.calls.subscribe).toHaveLength(1);
  });

  it("rớt liên tiếp ⇒ backoff nhân đôi, không nối dồn (trần vé 30 lượt/phút)", async () => {
    const { hub, fake } = setup();
    const off = hub.subscribe(ME, vi.fn());
    await flush();

    fake.handlers.onStatus("CLOSED");
    await flush(2_000 + 10);
    expect(fake.calls.subscribe).toHaveLength(2);

    fake.handlers.onStatus("CLOSED");
    await flush(2_000 + 10);
    expect(fake.calls.subscribe).toHaveLength(2); // lần 2 phải chờ 4s
    await flush(2_000 + 10);
    expect(fake.calls.subscribe).toHaveLength(3);
    off();
  });

  // Vòng lặp nóng = mỗi lượt nối lại là một lần xin vé (`/api/chat/realtime-token`, trần
  // 30 lượt/phút/user). Rớt liên tục mà không có trần backoff là tự khoá chính mình.
  it("rớt liên tục ⇒ backoff kịch 30s, KHÔNG vòng lặp nóng", async () => {
    const { hub, fake } = setup();
    const off = hub.subscribe(ME, vi.fn());
    await flush();

    // Đẩy backoff lên kịch trần.
    for (let i = 0; i < 8; i++) {
      fake.handlers.onStatus("CLOSED");
      await flush(RECONNECT_CAP_MS + 10);
    }
    const before = fake.calls.subscribe.length;

    // Rớt lại rồi để trôi 3 lần trần: nhiều nhất 3 lượt nối lại, không phải hàng chục.
    fake.handlers.onStatus("CLOSED");
    await flush(RECONNECT_CAP_MS * 3);
    expect(fake.calls.subscribe.length - before).toBeLessThanOrEqual(3);
    off();
  });

  /**
   * Hai bộ hẹn giờ SỐNG CHUNG: gia hạn vé và nối lại. Một lần gia hạn thành công KHÔNG
   * được nuốt mất lượt nối lại đang chờ — nếu nuốt thì kênh đã CLOSED nằm chết im lặng
   * vĩnh viễn (badge chưa đọc đứng số cũ tới khi F5), đúng cái bug đang vá nhưng ở dạng
   * khó thấy hơn vì nó chỉ xảy ra khi backoff dài hơn nhịp gia hạn.
   */
  it("gia hạn vé GIỮA lúc chờ nối lại ⇒ KHÔNG huỷ mất lượt nối lại", async () => {
    // Vé rất ngắn để nhịp gia hạn (80% ⇒ 10s) rơi vào giữa cửa sổ backoff 16s.
    const SHORT_TTL_MS = 12_500;
    let seq = 0;
    const fetchToken = vi.fn(async () => ({
      token: `jwt-${++seq}`,
      expiresAt: new Date(Date.now() + SHORT_TTL_MS).toISOString(),
    }));
    const { hub, fake } = setup({ fetchToken });
    const off = hub.subscribe(ME, vi.fn());
    await flush();

    // Đẩy backoff lên 16s: mỗi lần CLOSED ngay sau khi vừa nối lại ⇒ 2s, 4s, 8s.
    for (const delay of [2_000, 4_000, 8_000]) {
      fake.handlers.onStatus("CLOSED");
      await flush(delay + 10);
    }
    expect(fake.calls.subscribe).toHaveLength(4);

    fake.handlers.onStatus("CLOSED"); // lượt kế: chờ 16s
    const setAuthBefore = fake.calls.setAuth.length;

    await flush(10_000 + 10); // nhịp gia hạn vé rơi vào đây
    expect(fake.calls.setAuth.length).toBeGreaterThan(setAuthBefore);
    expect(fake.calls.subscribe).toHaveLength(4); // chưa tới hạn nối lại

    await flush(6_000 + 10); // qua mốc 16s
    expect(fake.calls.subscribe).toHaveLength(5);
    off();
  });

  // Người nghe cuối rời (điều hướng khỏi trang) ĐÚNG LÚC vé đang trên đường về: không được
  // giao nó cho tầng kết nối của một kênh vừa bị đóng.
  it("rời hết người nghe GIỮA lúc gia hạn ⇒ KHÔNG giao vé cho tầng kết nối", async () => {
    type TokenRes = { token: string; expiresAt: string };
    // Giữ trong object: `let` bị TS thu hẹp về `never` vì phép gán nằm trong callback.
    const pending: { resolve: ((t: TokenRes) => void) | null } = { resolve: null };
    let n = 0;
    const fetchToken = vi.fn(async () => {
      n += 1;
      if (n === 1) return { token: "jwt-1", expiresAt: new Date(Date.now() + TTL_MS).toISOString() };
      return new Promise<TokenRes>((resolve) => {
        pending.resolve = resolve;
      });
    });
    const { hub, fake } = setup({ fetchToken });
    const off = hub.subscribe(ME, vi.fn());
    await flush();

    await flush(TTL_MS * 0.8 + 10); // đã xin vé mới, đang chờ mạng
    expect(fetchToken).toHaveBeenCalledTimes(2);

    off(); // người nghe cuối rời ⇒ kênh đóng
    pending.resolve?.({ token: "jwt-2", expiresAt: new Date(Date.now() + TTL_MS).toISOString() });
    await flush(10);

    expect(fake.calls.setAuth).toHaveLength(0);
    expect(fake.calls.unsubscribe).toBe(1);
    await flush(TTL_MS * 2);
    expect(fake.calls.subscribe).toHaveLength(1);
  });

  it("kênh CŨ bắn muộn sau khi đã dựng lại ⇒ KHÔNG lọt vào người nghe (chặn theo generation)", async () => {
    const { hub, fake } = setup();
    const listener = vi.fn();
    const off1 = hub.subscribe(ME, listener);
    await flush();
    const stale = fake.handlers; // handlers của kênh người dùng CŨ

    // Đổi người dùng ⇒ kênh cũ bị đóng, nhưng `listener` vẫn còn trong danh sách.
    const off2 = hub.subscribe("user-khac", vi.fn());
    await flush();

    stale.onBroadcast("conversation.bumped", bumpPayload());
    stale.onStatus("SUBSCRIBED");

    expect(listener).not.toHaveBeenCalled();
    off1();
    off2();
  });

  it("Phương án B — `realtime.resync` (phong bì quá cỡ) ⇒ phát resync cho người nghe", async () => {
    const { hub, fake } = setup();
    const events: UserChannelEvent[] = [];
    const off = hub.subscribe(ME, (e) => events.push(e));
    await flush();
    fake.handlers.onStatus("SUBSCRIBED");
    fake.handlers.onBroadcast("realtime.resync", { event: "conversation.bumped" });
    expect(events).toEqual([{ type: "resync" }]);
    off();
  });
});
