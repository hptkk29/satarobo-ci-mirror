// @vitest-environment jsdom
// components/chat/use-chat-unread.test.ts — badge tổng chưa đọc: seed từ server, nhảy theo bump.
//
// Bất biến quan trọng nhất: hook KHÔNG BAO GIỜ tự cộng ở client. Nó chỉ hỏi lại server.
// Tự cộng sẽ lệch với BR-04 (ARCHIVED > 90 ngày) và với lọc `leftAt IS NULL`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChatUnread } from "./use-chat-unread";
import { setActiveConversation } from "./active-conversation";
import { notifyConversationRead } from "./read-signal";
import type { UserChannelEvent, UserChannelHub } from "./user-channel";

const ME = "user-me";
const CONV = "conv-1";

function createFakeHub() {
  const listeners = new Set<(e: UserChannelEvent) => void>();
  const hub: UserChannelHub = {
    subscribe(_userId, listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    hub,
    get size() {
      return listeners.size;
    },
    emit(event: UserChannelEvent) {
      for (const l of [...listeners]) l(event);
    },
  };
}

function bump(conversationId = CONV): UserChannelEvent {
  return {
    type: "bump",
    bump: {
      conversationId,
      messageId: `msg-${Math.random()}`,
      kind: "CHAT",
      at: new Date(),
    },
  };
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Ép `document.visibilityState` trong jsdom (thuộc tính chỉ-đọc trên prototype). */
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-09T10:00:00.000Z"));
  setActiveConversation(null);
  setVisibility("visible");
});

afterEach(() => {
  vi.useRealTimers();
  setActiveConversation(null);
  setVisibility("visible");
});

describe("useChatUnread", () => {
  it("số ban đầu = số server, KHÔNG fetch lúc mount", async () => {
    const fake = createFakeHub();
    const fetchTotal = vi.fn(async () => 99);
    const { result } = renderHook(() => useChatUnread(ME, 3, { hub: fake.hub, fetchTotal }));

    await flush(10_000);
    expect(result.current).toBe(3);
    expect(fetchTotal).not.toHaveBeenCalled();
  });

  it("1 bump ⇒ hỏi lại server ĐÚNG 1 lần và lấy con số của server (không tự cộng)", async () => {
    const fake = createFakeHub();
    const fetchTotal = vi.fn(async () => 7);
    const { result } = renderHook(() => useChatUnread(ME, 2, { hub: fake.hub, fetchTotal }));

    act(() => {
      fake.emit(bump());
      fake.emit(bump());
      fake.emit(bump());
    });
    await flush(1_000);

    expect(fetchTotal).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(7); // KHÔNG phải 2 + 3
  });

  it("bump của hội thoại ĐANG MỞ (tab đang hiện) ⇒ KHÔNG hỏi lại, badge đứng yên (AC5)", async () => {
    const fake = createFakeHub();
    const fetchTotal = vi.fn(async () => 42);
    const { result } = renderHook(() => useChatUnread(ME, 0, { hub: fake.hub, fetchTotal }));

    setActiveConversation(CONV);
    act(() => fake.emit(bump(CONV)));
    await flush(5_000);

    expect(fetchTotal).not.toHaveBeenCalled();
    expect(result.current).toBe(0);
  });

  it("bump của hội thoại KHÁC vẫn hỏi lại dù đang mở một hội thoại", async () => {
    const fake = createFakeHub();
    const fetchTotal = vi.fn(async () => 5);
    const { result } = renderHook(() => useChatUnread(ME, 0, { hub: fake.hub, fetchTotal }));

    setActiveConversation(CONV);
    act(() => fake.emit(bump("conv-khac")));
    await flush(1_000);

    expect(fetchTotal).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(5);
  });

  it("`resync` (kênh vừa kết nối lại) cũng hỏi lại server", async () => {
    const fake = createFakeHub();
    const fetchTotal = vi.fn(async () => 4);
    const { result } = renderHook(() => useChatUnread(ME, 1, { hub: fake.hub, fetchTotal }));

    act(() => fake.emit({ type: "resync" }));
    await flush(1_000);

    expect(fetchTotal).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(4);
  });

  it("prop đổi (điều hướng ⇒ RSC tính lại) ⇒ badge bám số mới, không cần fetch", async () => {
    const fake = createFakeHub();
    const fetchTotal = vi.fn(async () => 0);
    const { result, rerender } = renderHook(
      ({ n }: { n: number }) => useChatUnread(ME, n, { hub: fake.hub, fetchTotal }),
      { initialProps: { n: 2 } },
    );
    expect(result.current).toBe(2);

    rerender({ n: 6 });
    await flush();
    expect(result.current).toBe(6);
    expect(fetchTotal).not.toHaveBeenCalled();
  });

  it("hỏi lại server hỏng ⇒ giữ số cũ, không văng lỗi", async () => {
    const fake = createFakeHub();
    const fetchTotal = vi.fn(async () => {
      throw new Error("mạng chớp");
    });
    const { result } = renderHook(() => useChatUnread(ME, 3, { hub: fake.hub, fetchTotal }));

    act(() => fake.emit(bump()));
    await flush(1_000);

    expect(result.current).toBe(3);
  });

  it("hội thoại đang mở NHƯNG tab ẩn ⇒ vẫn phải hỏi lại khi quay lại tab (markRead chưa chạy)", async () => {
    const fake = createFakeHub();
    const fetchTotal = vi.fn(async () => 8);
    const { result } = renderHook(() => useChatUnread(ME, 0, { hub: fake.hub, fetchTotal }));

    setActiveConversation(CONV);
    setVisibility("hidden");
    act(() => fake.emit(bump(CONV)));
    await flush(10_000);
    // Tab ẩn: timer bị bóp, và nhịp cố ý chỉ đánh dấu "bẩn".
    expect(fetchTotal).not.toHaveBeenCalled();

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(fetchTotal).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(8);
  });

  it("unmount ⇒ nhả người nghe (không rò listener qua các trang)", async () => {
    const fake = createFakeHub();
    const { unmount } = renderHook(() =>
      useChatUnread(ME, 0, { hub: fake.hub, fetchTotal: async () => 0 }),
    );
    expect(fake.size).toBe(1);
    unmount();
    expect(fake.size).toBe(0);
  });
});

// Badge phải biết TỤT, không chỉ biết TĂNG. Đọc tin KHÔNG sinh bump nào trên kênh
// `user:{id}`, và layout RSC (nơi tính số ban đầu) không render lại khi điều hướng
// client-side ⇒ `read-signal` là đường duy nhất. Bỏ đăng ký này = badge treo số cũ cả phiên.
describe("badge tụt sau khi đọc (read-signal)", () => {
  it("đánh dấu đã đọc xong ⇒ hỏi lại server và badge về số mới", async () => {
    const fake = createFakeHub();
    const fetchTotal = vi.fn(async () => 0);
    const { result } = renderHook(() => useChatUnread(ME, 5, { hub: fake.hub, fetchTotal }));
    expect(result.current).toBe(5);

    act(() => notifyConversationRead());
    await flush(1_000);

    expect(fetchTotal).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(0);
  });

  it("tín hiệu đọc của hội thoại ĐANG MỞ vẫn phải hỏi lại (khác luật lọc bump AC5)", async () => {
    const fake = createFakeHub();
    const fetchTotal = vi.fn(async () => 0);
    const { result } = renderHook(() => useChatUnread(ME, 3, { hub: fake.hub, fetchTotal }));

    // Đúng cảnh của PH đứng TRONG hội thoại: bump của chính nó bị AC5 lọc...
    setActiveConversation(CONV);
    act(() => fake.emit(bump(CONV)));
    await flush(5_000);
    expect(fetchTotal).not.toHaveBeenCalled();
    expect(result.current).toBe(3);

    // ...nên chỉ còn tín hiệu ĐÃ ĐỌC mới kéo con số về đúng.
    act(() => notifyConversationRead());
    await flush(5_000);
    expect(fetchTotal).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(0);
  });

  it("unmount ⇒ nhả cả người nghe tín hiệu đọc (không fetch cho trang đã đóng)", async () => {
    const fake = createFakeHub();
    const fetchTotal = vi.fn(async () => 0);
    const { unmount } = renderHook(() => useChatUnread(ME, 2, { hub: fake.hub, fetchTotal }));

    unmount();
    act(() => notifyConversationRead());
    await flush(5_000);

    expect(fetchTotal).not.toHaveBeenCalled();
  });
});
