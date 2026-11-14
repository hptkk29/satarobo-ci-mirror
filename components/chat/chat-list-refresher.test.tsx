// @vitest-environment jsdom
// components/chat/chat-list-refresher.test.tsx — DANH SÁCH hội thoại tự sắp xếp lại khi có tin.
//
// Đây là món nợ #B của Đợt 1: tin mới ở nhóm khác không đẩy nhóm đó lên đầu, không đổi
// preview/giờ/badge từng dòng cho tới khi người dùng bấm đi bấm lại.
//
// Bất biến được khoá ở đây:
//   • Thứ tự + preview + giờ do SERVER dựng ⇒ tín hiệu bump chỉ được kéo theo ĐÚNG MỘT
//     `router.refresh()` cho mỗi cụm (3 trang chat đều `force-dynamic` nên mỗi refresh là
//     một lượt RSC thật — refresh mỗi bump là tự bắn vào chân server).
//   • Hội thoại ĐANG MỞ vẫn phải refresh danh sách (khác hẳn badge tổng — chỗ đó mới bỏ
//     qua), vì dòng của nó cũng đổi preview/giờ/thứ tự.
//   • Unmount phải nhả người nghe: hub sống suốt phiên, rò listener là rò cả `router` cũ.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { ChatListRefresher } from "./chat-list-refresher";
import { setActiveConversation } from "./active-conversation";
import type { UserChannelEvent, UserChannelHub } from "./user-channel";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

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
      act(() => {
        for (const l of [...listeners]) l(event);
      });
    },
  };
}

function bump(conversationId = CONV): UserChannelEvent {
  return {
    type: "bump",
    bump: { conversationId, messageId: `msg-${conversationId}`, kind: "CHAT", at: new Date() },
  };
}

function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-09T10:00:00.000Z"));
  refresh.mockClear();
  setActiveConversation(null);
});

afterEach(() => {
  vi.useRealTimers();
  setActiveConversation(null);
});

describe("ChatListRefresher", () => {
  it("một bump ⇒ danh sách được dựng lại (router.refresh)", () => {
    const fake = createFakeHub();
    render(<ChatListRefresher userId={ME} hub={fake.hub} />);

    fake.emit(bump());
    expect(refresh).not.toHaveBeenCalled(); // còn trong cửa sổ gom cụm

    tick(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("5 bump trong một cụm ⇒ ĐÚNG MỘT refresh (không phải 5 lượt RSC)", () => {
    const fake = createFakeHub();
    render(<ChatListRefresher userId={ME} hub={fake.hub} />);

    for (let i = 0; i < 5; i++) {
      fake.emit(bump(`conv-${i}`));
      tick(100);
    }
    tick(1_000);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("nhóm bắn liên tục 20 giây vẫn giữ nhịp refresh thưa (≤ 5 lượt RSC)", () => {
    const fake = createFakeHub();
    render(<ChatListRefresher userId={ME} hub={fake.hub} />);

    for (let i = 0; i < 200; i++) {
      fake.emit(bump(`conv-${i % 3}`));
      tick(100);
    }

    expect(refresh.mock.calls.length).toBeLessThanOrEqual(5);
    expect(refresh.mock.calls.length).toBeGreaterThan(0);
  });

  it("bump của hội thoại ĐANG MỞ vẫn refresh danh sách (khác badge tổng)", () => {
    const fake = createFakeHub();
    render(<ChatListRefresher userId={ME} hub={fake.hub} />);

    setActiveConversation(CONV);
    fake.emit(bump(CONV));
    tick(1_000);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("`resync` (kênh vừa kết nối lại) cũng refresh — broadcast có thể đã rơi mất", () => {
    const fake = createFakeHub();
    render(<ChatListRefresher userId={ME} hub={fake.hub} />);

    fake.emit({ type: "resync" });
    tick(1_000);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("unmount ⇒ nhả người nghe VÀ không refresh cụm đang treo", () => {
    const fake = createFakeHub();
    const view = render(<ChatListRefresher userId={ME} hub={fake.hub} />);
    expect(fake.size).toBe(1);

    fake.emit(bump()); // đã hẹn giờ, chưa chạy
    view.unmount();

    expect(fake.size).toBe(0);
    tick(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("không có userId (chưa đăng nhập) ⇒ không đăng ký kênh nào", () => {
    const fake = createFakeHub();
    render(<ChatListRefresher userId="" hub={fake.hub} />);
    expect(fake.size).toBe(0);
  });

  it("không vẽ gì — `ConversationList` giữ nguyên 0 byte JS", () => {
    const fake = createFakeHub();
    const { container } = render(<ChatListRefresher userId={ME} hub={fake.hub} />);
    expect(container.innerHTML).toBe("");
  });
});
