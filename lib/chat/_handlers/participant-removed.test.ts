// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const broadcastMock = vi.fn(async () => true);
vi.mock("@/lib/chat/broadcast", () => ({
  broadcastToConversation: (...args: unknown[]) => broadcastMock(...(args as [])),
}));

import { clearHandlers, getHandlers, type DomainEventLite } from "@/lib/events/registry";
import {
  CHAT_PARTICIPANT_REMOVED,
  registerChatParticipantRemovedHandlers,
} from "@/lib/chat/_handlers/participant-removed";

/**
 * Bắn qua ĐÚNG hình dạng dispatcher đưa vào — object event đầy đủ, KHÔNG phải payload
 * trần. Bản test đầu tiên truyền payload trần nên che mất bug đọc nhầm một tầng
 * (handler khi đó im lặng không làm gì mà dispatcher vẫn đánh DONE).
 */
async function fire(payload: Record<string, unknown>) {
  const event: DomainEventLite = { id: "evt-1", type: CHAT_PARTICIPANT_REMOVED, payload };
  for (const h of getHandlers(CHAT_PARTICIPANT_REMOVED)) await h(event);
}

describe("chat.participant_removed → broadcast participant.removed (F-KICK bước 3)", () => {
  beforeEach(() => {
    clearHandlers();
    broadcastMock.mockClear();
    registerChatParticipantRemovedHandlers();
  });
  afterEach(() => clearHandlers());

  it("bắn đúng topic + đúng khoá payload mà client đang đọc", async () => {
    await fire({ conversationId: "conv-1", userId: "user-9" });
    expect(broadcastMock).toHaveBeenCalledTimes(1);
    // Hợp đồng với components/chat/chat-store.ts → parseParticipantRemoved đọc `userId`.
    expect(broadcastMock).toHaveBeenCalledWith("conv-1", "participant.removed", {
      userId: "user-9",
    });
  });

  it("payload hỏng → bỏ qua, KHÔNG bắn (tránh đá nhầm cả phòng)", async () => {
    await fire({ conversationId: "conv-1" });
    await fire({ userId: "user-9" });
    await fire({});
    await fire({ conversationId: 1, userId: 2 });
    expect(broadcastMock).not.toHaveBeenCalled();
  });

  it("broadcast lỗi KHÔNG ném ra ngoài — dispatcher không được coi là fail vì kênh đẩy", async () => {
    broadcastMock.mockResolvedValueOnce(false);
    await expect(fire({ conversationId: "c", userId: "u" })).resolves.toBeUndefined();
  });
});
