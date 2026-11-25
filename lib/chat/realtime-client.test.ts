/**
 * `lib/chat/realtime-client.ts` — lớp mỏng trên SSE (tầng realtime duy nhất từ 28/09/2026).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sse: vi.fn(),
  unsubs: [] as Array<ReturnType<typeof vi.fn>>,
}));

vi.mock("@/lib/chat/sse-client", () => ({
  subscribeSseTopic: (...a: unknown[]) => {
    h.sse(...a);
    const unsubscribe = vi.fn();
    h.unsubs.push(unsubscribe);
    return { unsubscribe };
  },
}));

import { applyRealtimeAuth, subscribeConversation, subscribeUserTopic } from "./realtime-client";

const TICKET = { token: "sse", expiresAt: "2026-09-28T00:15:00.000Z", provider: "sse" as const };

beforeEach(() => {
  vi.clearAllMocks();
  h.unsubs.length = 0;
});

describe("realtime-client — chỉ SSE", () => {
  it("topic conv:/user: đi thẳng SSE với đúng handlers", () => {
    const handlers = {};
    subscribeConversation("c1", TICKET, handlers);
    subscribeUserTopic("u1", TICKET, handlers);
    expect(h.sse).toHaveBeenNthCalledWith(1, "conv:c1", handlers);
    expect(h.sse).toHaveBeenNthCalledWith(2, "user:u1", handlers);
  });

  it("vé thiếu `provider` vẫn đi SSE (không còn nhánh Supabase để rơi về)", () => {
    subscribeConversation("c1", { token: "x", expiresAt: TICKET.expiresAt }, {});
    expect(h.sse).toHaveBeenCalledWith("conv:c1", {});
  });

  it("gia hạn là no-op: trả mốc hết hạn của vé, không đụng kênh đang chạy", () => {
    const s = subscribeConversation("c1", TICKET, {});
    expect(applyRealtimeAuth({ ...TICKET, expiresAt: "2026-09-28T00:30:00.000Z" })).toBe(
      "2026-09-28T00:30:00.000Z",
    );
    expect(h.unsubs[0]).not.toHaveBeenCalled();
    s.unsubscribe();
    expect(h.unsubs[0]).toHaveBeenCalledTimes(1);
  });
});
