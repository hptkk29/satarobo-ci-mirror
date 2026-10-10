// @vitest-environment jsdom
// components/chat/use-chat-channel.test.ts — US-07 AC2/AC3/AC4/AC5 + gia hạn token + dọn dẹp.
//
// Không chạm server realtime thật: transport và endpoint token đều được bơm vào (DI). Fake timer
// để lái mốc gia hạn token mà không phải chờ 12 phút thật.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useChatChannel,
  type ChatChannelHandlers,
  type ChatChannelTransport,
  type ReconcilePage,
} from "./use-chat-channel";
import type { IncomingMessage } from "./chat-store";
import { getActiveConversation, setActiveConversation } from "./active-conversation";
import { subscribeConversationRead } from "./read-signal";

const CONV = "conv-1";
const ME = "user-me";
const OTHER = "user-other";
/** TTL thật của `/api/chat/realtime-token` (lib/chat/realtime-token.ts). */
const TTL_MS = 5 * 60_000;
/** Trần backoff nối lại (`RECONNECT_MAX_MS` trong use-chat-channel.ts). */
const RECONNECT_CAP_MS = 30_000;

function row(id: string, over: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id,
    conversationId: CONV,
    kind: "CHAT",
    senderId: OTHER,
    body: `tin ${id}`,
    clientMsgId: null,
    createdAt: new Date(Date.parse("2026-08-09T10:00:00.000Z") + Number(id.replace(/\D/g, "")) * 1000),
    ...over,
  };
}

function page(messages: IncomingMessage[], over: Partial<ReconcilePage> = {}): ReconcilePage {
  return { messages, hasMore: false, nextSinceMessageId: messages[messages.length - 1]?.id ?? null, ...over };
}

function createFakeTransport() {
  const calls = {
    subscribe: [] as { conversationId: string; jwt: string }[],
    /** Vé đã gửi vào chu kỳ gia hạn (`renewAuth`), theo thứ tự. */
    setAuth: [] as string[],
    unsubscribe: 0,
  };
  let handlers: ChatChannelHandlers | null = null;

  const transport: ChatChannelTransport = {
    subscribe(conversationId, auth, h) {
      calls.subscribe.push({ conversationId, jwt: auth.token });
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
    get handlers(): ChatChannelHandlers {
      if (!handlers) throw new Error("chưa subscribe");
      return handlers;
    },
  };
}

/** Chạy hết microtask + đẩy đồng hồ giả. */
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function tokenResponse(name: string) {
  return { token: name, expiresAt: new Date(Date.now() + TTL_MS).toISOString() };
}

type Harness = ReturnType<typeof setup>;

function setup(over: Partial<Parameters<typeof useChatChannel>[0]> = {}) {
  const fake = createFakeTransport();
  let tokenSeq = 0;
  const fetchToken = vi.fn(async () => tokenResponse(`jwt-${++tokenSeq}`));
  const fetchSince = vi.fn(async (_lastSeenMessageId: string | null): Promise<ReconcilePage> =>
    page([]),
  );
  const markRead = vi.fn(async () => ({ unreadCount: 0 }));
  const onRemoved = vi.fn();

  const view = renderHook(() =>
    useChatChannel({
      conversationId: CONV,
      currentUserId: ME,
      fetchSince,
      markRead,
      onRemoved,
      transport: fake.transport,
      fetchToken,
      ...over,
    }),
  );

  return { fake, fetchToken, fetchSince, markRead, onRemoved, view };
}

async function connect(h: Harness) {
  await flush();
  act(() => h.fake.handlers.onStatus("SUBSCRIBED"));
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("kết nối kênh", () => {
  it("xin JWT rồi subscribe đúng hội thoại; SUBSCRIBED ⇒ status subscribed", async () => {
    const h = setup();
    await flush();

    expect(h.fetchToken).toHaveBeenCalledTimes(1);
    expect(h.fake.calls.subscribe).toEqual([{ conversationId: CONV, jwt: "jwt-1" }]);

    act(() => h.fake.handlers.onStatus("SUBSCRIBED"));
    await flush();
    expect(h.view.result.current.status).toBe("subscribed");
  });

  it("không lấy được vé ⇒ status error, không subscribe (không treo im lặng)", async () => {
    const h = setup({
      fetchToken: vi.fn(async () => {
        throw new Error("Realtime chưa được cấu hình");
      }),
    });
    await flush();

    expect(h.fake.calls.subscribe).toHaveLength(0);
    expect(h.view.result.current.status).toBe("error");
    expect(h.view.result.current.error).toBe("Realtime chưa được cấu hình");
  });

  it("CHANNEL_ERROR ⇒ báo mất kết nối nhưng KHÔNG xoá tin đang có", async () => {
    const h = setup({ initialMessages: [row("m1")] });
    await connect(h);

    act(() => h.fake.handlers.onStatus("CHANNEL_ERROR", new Error("boom")));
    await flush();

    expect(h.view.result.current.status).toBe("error");
    expect(h.view.result.current.messages.map((m) => m.id)).toEqual(["m1"]);
  });
});

describe("AC2 — reconcile bắt buộc mỗi lần SUBSCRIBED (TS-09)", () => {
  it("lần SUBSCRIBED đầu gọi fetchMessagesSince(null) đúng một lần", async () => {
    const h = setup();
    h.fetchSince.mockResolvedValueOnce(page([row("m1")]));
    await connect(h);

    expect(h.fetchSince).toHaveBeenCalledTimes(1);
    expect(h.fetchSince).toHaveBeenCalledWith(null);
    expect(h.view.result.current.messages.map((m) => m.id)).toEqual(["m1"]);
  });

  it("mất mạng rồi re-SUBSCRIBED ⇒ gọi lại đúng MỘT lần với mốc lastSeen, đủ 5 tin, không trùng", async () => {
    const h = setup();
    h.fetchSince.mockResolvedValueOnce(page([row("m1")]));
    await connect(h);

    // Rớt mạng 30s rồi kênh tự join lại (TS-09 bước 2–3).
    act(() => h.fake.handlers.onStatus("CHANNEL_ERROR"));
    await flush(30_000);
    h.fetchSince.mockResolvedValueOnce(
      // Server trả kèm cả m1 (client đã có) để chứng minh khử trùng theo id.
      page([row("m1"), row("m2"), row("m3"), row("m4"), row("m5"), row("m6")]),
    );
    act(() => h.fake.handlers.onStatus("SUBSCRIBED"));
    await flush();

    expect(h.fetchSince).toHaveBeenCalledTimes(2);
    expect(h.fetchSince).toHaveBeenLastCalledWith("m1");
    expect(h.view.result.current.messages.map((m) => m.id)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
    ]);
  });

  it("lỡ hơn một trang (TS-09.5) ⇒ cuốn hết hasMore trong CÙNG một lượt", async () => {
    const h = setup();
    h.fetchSince
      .mockResolvedValueOnce(page([row("m1"), row("m2")], { hasMore: true, nextSinceMessageId: "m2" }))
      .mockResolvedValueOnce(page([row("m3")]));
    await connect(h);

    expect(h.fetchSince.mock.calls.map((c) => c[0])).toEqual([null, "m2"]);
    expect(h.view.result.current.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(h.view.result.current.isReconciling).toBe(false);
  });

  it("reconcile hỏng ⇒ báo lỗi, không mất tin đang hiển thị", async () => {
    const h = setup({ initialMessages: [row("m1")] });
    h.fetchSince.mockRejectedValueOnce(new Error("Mạng lỗi"));
    await connect(h);

    expect(h.view.result.current.error).toBe("Mạng lỗi");
    expect(h.view.result.current.messages.map((m) => m.id)).toEqual(["m1"]);
  });

  it("tin nhận qua broadcast được hợp nhất và trở thành mốc reconcile kế tiếp", async () => {
    const h = setup();
    await connect(h);

    act(() =>
      h.fake.handlers.onBroadcast("message.created", {
        id: "m9",
        conversationId: CONV,
        senderId: OTHER,
        kind: "CHAT",
        body: "tin realtime",
        clientMsgId: null,
        createdAt: "2026-08-09T10:00:09.000Z",
      }),
    );
    await flush();
    expect(h.view.result.current.messages.map((m) => m.id)).toEqual(["m9"]);

    act(() => h.fake.handlers.onStatus("SUBSCRIBED"));
    await flush();
    expect(h.fetchSince).toHaveBeenLastCalledWith("m9");
  });

  // ⚠️ Test này sinh ra từ một lỗi ĐÃ LỌT RA MÔI TRƯỜNG TEST (nghiệm thu 10/08/2026):
  // `lib/chat/announcements.ts` phát `announcement.created`, còn hook chỉ nhận
  // `message.created` ⇒ thông báo bị nuốt im. Nó KHÔNG hiện thành lỗi đỏ vì mỗi lần
  // re-SUBSCRIBED đều reconcile đọc bù, nên chờ đủ lâu (gia hạn vé ~4') là tin "tự"
  // xuất hiện. Đột biến kiểm ngược: xoá nhánh `announcement.created` trong
  // use-chat-channel.ts ⇒ cả hai assertion dưới đây ĐỎ.
  it("THÔNG BÁO tới qua broadcast cũng vào luồng NGAY + báo cho khung ghim dựng lại", async () => {
    const onAnnouncement = vi.fn();
    const h = setup({ onAnnouncement });
    await connect(h);

    act(() =>
      h.fake.handlers.onBroadcast("announcement.created", {
        id: "a1",
        conversationId: CONV,
        senderId: OTHER,
        kind: "ANNOUNCEMENT",
        body: "Lớp nghỉ ngày 15/08, học bù ngày 22/08",
        createdAt: "2026-08-10T02:00:00.000Z",
      }),
    );
    await flush();

    expect(h.view.result.current.messages.map((m) => m.id)).toEqual(["a1"]);
    expect(h.view.result.current.messages[0]?.kind).toBe("ANNOUNCEMENT");
    expect(onAnnouncement).toHaveBeenCalledTimes(1);

    // Và nó cũng phải trở thành mốc reconcile như mọi tin khác.
    act(() => h.fake.handlers.onStatus("SUBSCRIBED"));
    await flush();
    expect(h.fetchSince).toHaveBeenLastCalledWith("a1");
  });
});

describe("Phương án B — phong bì quá cỡ (`realtime.resync`)", () => {
  it("resync ⇒ đi hỏi lại nguồn sự thật (reconcile), tin về qua fetchSince", async () => {
    const h = setup();
    await connect(h);
    const before = h.fetchSince.mock.calls.length;
    h.fetchSince.mockResolvedValueOnce(page([row("m9")]));

    act(() =>
      h.fake.handlers.onBroadcast("realtime.resync", {
        event: "message.created",
        id: "m9",
        conversationId: CONV,
      }),
    );
    await flush();

    expect(h.fetchSince.mock.calls.length).toBe(before + 1);
    expect(h.view.result.current.messages.map((m) => m.id)).toEqual(["m9"]);
  });

  it("resync của THÔNG BÁO ⇒ reconcile + nhờ khung ghim dựng lại", async () => {
    const onAnnouncement = vi.fn();
    const h = setup({ onAnnouncement });
    await connect(h);
    act(() =>
      h.fake.handlers.onBroadcast("realtime.resync", { event: "announcement.created", id: "a9" }),
    );
    await flush();
    expect(onAnnouncement).toHaveBeenCalledTimes(1);
  });
});

describe("AC3 — bị gỡ giữa phiên (TS-11 / F-KICK)", () => {
  it("participant.removed cho CHÍNH MÌNH ⇒ unsubscribe + onRemoved + status removed", async () => {
    const h = setup();
    await connect(h);

    act(() => h.fake.handlers.onBroadcast("participant.removed", { userId: ME }));
    await flush();

    expect(h.fake.calls.unsubscribe).toBe(1);
    expect(h.onRemoved).toHaveBeenCalledTimes(1);
    expect(h.view.result.current.status).toBe("removed");
  });

  it("sau khi bị gỡ, broadcast đến muộn không còn chèn tin vào luồng", async () => {
    const h = setup();
    await connect(h);

    act(() => h.fake.handlers.onBroadcast("participant.removed", { userId: ME }));
    act(() =>
      h.fake.handlers.onBroadcast("message.created", {
        id: "m-late",
        createdAt: "2026-08-09T10:00:20.000Z",
      }),
    );
    await flush();

    expect(h.view.result.current.messages).toHaveLength(0);
  });

  it("participant.removed của NGƯỜI KHÁC ⇒ không đụng gì (event phát cho cả topic)", async () => {
    const h = setup();
    await connect(h);

    act(() => h.fake.handlers.onBroadcast("participant.removed", { userId: OTHER }));
    await flush();

    expect(h.fake.calls.unsubscribe).toBe(0);
    expect(h.onRemoved).not.toHaveBeenCalled();
    expect(h.view.result.current.status).toBe("subscribed");
  });
});

describe("AC4 — message.deleted đổi tại chỗ", () => {
  it("tin đổi thành text đã gỡ, không gọi lại server (không reload luồng)", async () => {
    const h = setup({ initialMessages: [row("m1"), row("m2")] });
    await connect(h);
    const callsBefore = h.fetchSince.mock.calls.length;

    act(() => h.fake.handlers.onBroadcast("message.deleted", { messageId: "m2" }));
    await flush();

    const list = h.view.result.current.messages;
    expect(list.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(list[1].deleted).toBe(true);
    expect(list[1].body).toBe("Tin nhắn đã được gỡ");
    expect(h.fetchSince.mock.calls.length).toBe(callsBefore);
  });
});

describe("AC5 — mốc đã đọc theo foreground", () => {
  it("đang mở ở foreground ⇒ markConversationRead tới tin mới nhất, không gọi lặp", async () => {
    const h = setup();
    h.fetchSince.mockResolvedValueOnce(page([row("m1"), row("m2")]));
    await connect(h);

    expect(h.markRead).toHaveBeenCalledTimes(1);
    expect(h.markRead).toHaveBeenCalledWith("m2");

    // Không có tin mới ⇒ không bắn thêm request nào.
    act(() => h.fake.handlers.onStatus("SUBSCRIBED"));
    await flush();
    expect(h.markRead).toHaveBeenCalledTimes(1);

    act(() =>
      h.fake.handlers.onBroadcast("message.created", {
        id: "m3",
        senderId: OTHER,
        createdAt: "2026-08-09T10:00:30.000Z",
      }),
    );
    await flush();
    expect(h.markRead).toHaveBeenLastCalledWith("m3");
  });

  // Badge tổng ở thanh nav do LAYOUT RSC tính và layout KHÔNG render lại khi điều hướng
  // client-side; đọc tin lại không sinh `bump` nào. Nên đánh dấu đã đọc XONG mà không phát
  // tín hiệu ở đây = badge chỉ biết tăng, treo số cũ tới khi F5.
  it("markConversationRead ghi xong ⇒ phát tín hiệu cho badge nav hỏi lại", async () => {
    const heard = vi.fn();
    const unsubscribe = subscribeConversationRead(heard);
    try {
      const h = setup();
      h.fetchSince.mockResolvedValueOnce(page([row("m1")]));
      await connect(h);

      expect(h.markRead).toHaveBeenCalledWith("m1");
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it("markConversationRead HỎNG ⇒ KHÔNG phát tín hiệu (badge không được tụt khi DB chưa ghi)", async () => {
    const heard = vi.fn();
    const unsubscribe = subscribeConversationRead(heard);
    try {
      const h = setup({
        markRead: vi.fn(async () => {
          throw new Error("mạng chớp");
        }),
      });
      h.fetchSince.mockResolvedValueOnce(page([row("m1")]));
      await connect(h);
      await flush();

      expect(heard).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("tab ẩn ⇒ KHÔNG đánh dấu đã đọc; quay lại foreground mới đánh dấu", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const h = setup();
    h.fetchSince.mockResolvedValueOnce(page([row("m1")]));
    await connect(h);

    expect(h.markRead).not.toHaveBeenCalled();
    expect(h.view.result.current.unreadCount).toBe(1);

    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(h.markRead).toHaveBeenCalledWith("m1");
    expect(h.view.result.current.unreadCount).toBe(0);
  });
});

describe("gia hạn token trước khi hết hạn", () => {
  // Đổi vé là việc của TẦNG KẾT NỐI (`transport.renewAuth` — với SSE là no-op trả mốc hết
  // hạn). Hook chỉ giao vé; nó KHÔNG được tự gọi `transport.subscribe` lần nữa, nếu không
  // một topic có hai người giữ. (`setAuth` trong bản giả chỉ là tên bộ đếm lời gọi renewAuth.)
  it("tới ~80% TTL ⇒ xin vé mới + giao cho tầng kết nối, hook KHÔNG tự dựng kênh", async () => {
    const h = setup();
    await connect(h);
    expect(h.fetchToken).toHaveBeenCalledTimes(1);

    await flush(TTL_MS * 0.8 + 100);

    expect(h.fetchToken).toHaveBeenCalledTimes(2);
    expect(h.fake.calls.setAuth).toEqual(["jwt-2"]);
    expect(h.fake.calls.subscribe).toHaveLength(1);
    expect(h.fetchSince).toHaveBeenCalledTimes(1); // gia hạn KHÔNG kích hoạt reconcile
  });

  // `renewAuth` trả mốc hết hạn ĐANG có hiệu lực — có thể là vé của kênh `user:{id}` vừa
  // đổi hộ trên cùng kết nối. Hẹn giờ theo vé mình vừa xin (dài hơn) = tới lúc gia hạn
  // thì vé thật đã chết từ lâu ⇒ kênh câm.
  it("hẹn giờ theo mốc HIỆU LỰC do tầng kết nối trả về, không theo vé vừa xin", async () => {
    const h = setup();
    // Tầng kết nối giữ vé cũ: chỉ còn 60s nữa là hết hạn.
    h.fake.transport.renewAuth = (auth) => {
      h.fake.calls.setAuth.push(auth.token);
      return new Date(Date.now() + 60_000).toISOString();
    };
    await connect(h);

    await flush(TTL_MS * 0.8 + 100); // lần gia hạn 1 — nhận về mốc 60s
    expect(h.fetchToken).toHaveBeenCalledTimes(2);

    // Nếu hẹn theo vé vừa xin (5') thì mốc này chưa có gì xảy ra.
    await flush(60_000 * 0.8 + 100);
    expect(h.fetchToken).toHaveBeenCalledTimes(3);
  });

  it("gia hạn lặp lại được (token thứ 3) — không dừng sau lần đầu", async () => {
    const h = setup();
    await connect(h);

    await flush(TTL_MS * 0.8 + 100);
    await flush(TTL_MS * 0.8 + 100);

    expect(h.fake.calls.setAuth).toEqual(["jwt-2", "jwt-3"]);
  });

  // Vé về SAU khi component đã chết: không được giao nó cho tầng kết nối hay hẹn giờ gì
  // thêm cho một kênh không còn ai giữ.
  it("unmount GIỮA lúc gia hạn ⇒ không giao vé cho tầng kết nối, không dựng kênh mồ côi", async () => {
    let release: ((t: { token: string; expiresAt: string }) => void) | null = null;
    const fetchToken = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("jwt-1"))
      .mockImplementationOnce(
        () =>
          new Promise<{ token: string; expiresAt: string }>((resolve) => {
            release = resolve;
          }),
      );
    const h = setup({ fetchToken });
    await connect(h);

    await flush(TTL_MS * 0.8 + 100); // đã xin vé mới, đang chờ mạng trả về
    expect(fetchToken).toHaveBeenCalledTimes(2);

    act(() => h.view.unmount());
    await act(async () => {
      release?.(tokenResponse("jwt-2"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(h.fake.calls.setAuth).toHaveLength(0);
    expect(h.fake.calls.subscribe).toHaveLength(1);
    expect(h.fake.calls.unsubscribe).toBe(1);

    // Và không còn hẹn giờ nào sống sót để xin vé tiếp.
    await flush(TTL_MS * 2);
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("xin token hỏng ⇒ thử lại sau, không làm chết kênh", async () => {
    const fetchToken = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("jwt-1"))
      .mockRejectedValueOnce(new Error("mạng chớp"))
      .mockResolvedValueOnce(tokenResponse("jwt-3"));
    const h = setup({ fetchToken });
    await connect(h);

    await flush(TTL_MS * 0.8 + 100); // lần gia hạn hỏng
    expect(h.fake.calls.setAuth).toHaveLength(0);
    expect(h.view.result.current.status).toBe("subscribed");

    await flush(30_000 + 100); // lần thử lại
    expect(h.fake.calls.setAuth).toEqual(["jwt-3"]);
  });
});

// Kênh một khi đã CLOSED thì KHÔNG tự hồi (SSE: `sse-client.ts` chỉ báo CLOSED khi đứt HẲN —
// 401/403/503… — EventSource không tự nối lại nữa; hồi Supabase cũng đo được y vậy). Bản cũ chỉ
// `setStatus("closed")` rồi thôi ⇒ người mở chat lâu mất realtime âm thầm.
describe("tự nối lại khi kênh đóng ngoài ý muốn", () => {
  it("CLOSED ⇒ xin vé mới + dựng kênh mới sau backoff, và bỏ hẳn kênh cũ", async () => {
    const h = setup();
    await connect(h);
    expect(h.fake.calls.subscribe).toHaveLength(1);

    act(() => h.fake.handlers.onStatus("CLOSED"));
    await flush();
    expect(h.view.result.current.status).toBe("closed");
    expect(h.fake.calls.subscribe).toHaveLength(1); // chưa nối ngay — phải có backoff

    await flush(2_000 + 50);
    expect(h.fake.calls.subscribe).toHaveLength(2);
    expect(h.fake.calls.subscribe[1].jwt).toBe("jwt-2"); // vé MỚI, không xài lại vé cũ
    expect(h.fake.calls.unsubscribe).toBe(1);
  });

  it("nối lại hỏng liên tiếp ⇒ backoff nhân đôi rồi kịch 30s (không vòng lặp nóng)", async () => {
    const h = setup();
    await connect(h);

    const closeAndWait = async (delay: number) => {
      act(() => h.fake.handlers.onStatus("CLOSED"));
      await flush(delay);
    };

    // 2s → 4s → 8s: mỗi lần chỉ nối lại khi đã qua đúng mốc backoff.
    await closeAndWait(2_000 + 50);
    expect(h.fake.calls.subscribe).toHaveLength(2);
    await closeAndWait(2_000 + 50);
    expect(h.fake.calls.subscribe).toHaveLength(2); // chưa tới 4s
    await flush(2_000 + 50);
    expect(h.fake.calls.subscribe).toHaveLength(3);

    // Rất nhiều lần rớt liên tiếp vẫn không vượt trần 30s/lượt.
    for (let i = 0; i < 8; i++) await closeAndWait(RECONNECT_CAP_MS + 50);
    const callsAfter = h.fake.calls.subscribe.length;
    await flush(RECONNECT_CAP_MS * 3);
    expect(h.fake.calls.subscribe.length - callsAfter).toBeLessThanOrEqual(3);
  });

  it("SUBSCRIBED lại ⇒ backoff về mốc đầu (lần rớt sau không phải chờ 30s)", async () => {
    const h = setup();
    await connect(h);

    act(() => h.fake.handlers.onStatus("CLOSED"));
    await flush(2_000 + 50);
    expect(h.fake.calls.subscribe).toHaveLength(2);
    act(() => h.fake.handlers.onStatus("SUBSCRIBED"));
    await flush();

    act(() => h.fake.handlers.onStatus("CLOSED"));
    await flush(2_000 + 50);
    expect(h.fake.calls.subscribe).toHaveLength(3);
  });

  it("bị gỡ khỏi hội thoại ⇒ KHÔNG nối lại (CLOSED sau đó là do ta tự đóng)", async () => {
    const h = setup();
    await connect(h);

    act(() => h.fake.handlers.onBroadcast("participant.removed", { userId: ME }));
    await flush(RECONNECT_CAP_MS * 4);

    expect(h.fake.calls.subscribe).toHaveLength(1);
    expect(h.view.result.current.status).toBe("removed");
  });

  it("unmount giữa lúc chờ backoff ⇒ không nối lại (không rò timer)", async () => {
    const h = setup();
    await connect(h);

    act(() => h.fake.handlers.onStatus("CLOSED"));
    act(() => h.view.unmount());
    await flush(RECONNECT_CAP_MS * 4);

    expect(h.fake.calls.subscribe).toHaveLength(1);
  });
});

describe("dọn dẹp khi unmount", () => {
  it("unsubscribe + huỷ timer gia hạn + gỡ listener foreground", async () => {
    const removeDoc = vi.spyOn(document, "removeEventListener");
    const removeWin = vi.spyOn(window, "removeEventListener");
    const h = setup();
    await connect(h);

    act(() => h.view.unmount());

    expect(h.fake.calls.unsubscribe).toBe(1);
    expect(removeDoc).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(removeWin).toHaveBeenCalledWith("focus", expect.any(Function));

    await flush(TTL_MS * 2);
    expect(h.fetchToken).toHaveBeenCalledTimes(1); // không còn timer nào chạy
  });

  it("kết quả reconcile về sau khi unmount không gây cập nhật state (không rò)", async () => {
    const h = setup();
    let release: ((p: ReconcilePage) => void) | null = null;
    h.fetchSince.mockImplementationOnce(
      () =>
        new Promise<ReconcilePage>((resolve) => {
          release = resolve;
        }),
    );
    await flush();
    act(() => h.fake.handlers.onStatus("SUBSCRIBED"));
    await flush();

    act(() => h.view.unmount());
    await act(async () => {
      release?.(page([row("m1")]));
      await vi.advanceTimersByTimeAsync(0);
    });

    // Không ném, không cảnh báo "state update on unmounted" — luồng cuối vẫn rỗng.
    expect(h.view.result.current.messages).toHaveLength(0);
  });
});

describe("mergeLocal — cùng đường khử trùng với broadcast (TS-10.3)", () => {
  it("bản optimistic + broadcast + kết quả Server Action ⇒ vẫn một dòng", async () => {
    const h = setup();
    await connect(h);
    const clientMsgId = "9f1a2b3c-0000-4000-8000-000000000001";

    act(() =>
      h.view.result.current.mergeLocal({
        id: `tmp:${clientMsgId}`,
        conversationId: CONV,
        senderId: ME,
        body: "chào cả nhà",
        clientMsgId,
        createdAt: new Date("2026-08-09T10:00:40.000Z"),
      }),
    );
    act(() =>
      h.fake.handlers.onBroadcast("message.created", {
        id: "m-real",
        conversationId: CONV,
        senderId: ME,
        kind: "CHAT",
        body: "chào cả nhà",
        clientMsgId,
        createdAt: "2026-08-09T10:00:41.000Z",
      }),
    );
    act(() =>
      h.view.result.current.mergeLocal({
        id: "m-real",
        conversationId: CONV,
        senderId: ME,
        body: "chào cả nhà",
        clientMsgId,
        createdAt: new Date("2026-08-09T10:00:41.000Z"),
      }),
    );
    await flush();

    expect(h.view.result.current.messages.map((m) => m.id)).toEqual(["m-real"]);
  });
});

// AC5 — mẩu trạng thái nối luồng chat với BADGE ở thanh nav. Không có đăng ký này thì badge
// tổng cộng thêm cho chính hội thoại người dùng đang nhìn (tin đó đã được `markConversationRead`
// đánh dấu đọc), số nháy lên rồi tụt về 0 — nhìn như lỗi.
describe("đăng ký hội thoại ĐANG MỞ cho badge nav", () => {
  beforeEach(() => setActiveConversation(null));
  afterEach(() => setActiveConversation(null));

  it("mount ⇒ ghi nhận hội thoại đang mở; unmount ⇒ nhả ra", async () => {
    const h = setup();
    await connect(h);
    expect(getActiveConversation()).toBe(CONV);

    act(() => h.view.unmount());
    expect(getActiveConversation()).toBeNull();
  });

  it("enabled=false (chưa mở luồng nào) ⇒ KHÔNG chiếm chỗ của hội thoại khác", async () => {
    const h = setup({ enabled: false });
    await flush();
    expect(getActiveConversation()).toBeNull();
    act(() => h.view.unmount());
  });
});
