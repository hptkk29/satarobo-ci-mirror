// @vitest-environment node
/**
 * `isActiveChatParticipant` — cổng mà SSE hỏi ở mỗi lần giao tin `conv:{id}`. Phải trùng
 * NGỮ NGHĨA với cổng đọc `assertActiveParticipant` (leftAt IS NULL + BR-04), vì kênh realtime
 * là cửa thứ hai vào đúng nội dung đó.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findUnique: vi.fn(async (_args: unknown) => null as unknown),
}));

vi.mock("@/lib/db", () => ({
  db: { conversationParticipant: { findUnique: h.findUnique } },
}));

import { isActiveChatParticipant } from "./queries";

const ACTIVE = {
  id: "p1",
  role: "PARENT",
  derivedFrom: "CLASS_STUDENT_PARENT",
  leftAt: null,
  unreadCount: 0,
  lastReadMessageId: null,
  conversation: { status: "ACTIVE", archivedAt: null },
};

beforeEach(() => {
  h.findUnique.mockReset();
});

describe("isActiveChatParticipant", () => {
  it("participant còn hiệu lực ⇒ true", async () => {
    h.findUnique.mockResolvedValueOnce(ACTIVE);
    await expect(isActiveChatParticipant("c1", "u1")).resolves.toBe(true);
  });

  it("không phải thành viên ⇒ false", async () => {
    h.findUnique.mockResolvedValueOnce(null);
    await expect(isActiveChatParticipant("c1", "u1")).resolves.toBe(false);
  });

  it("đã rời (leftAt set) ⇒ false", async () => {
    h.findUnique.mockResolvedValueOnce({ ...ACTIVE, leftAt: new Date("2026-09-01T00:00:00Z") });
    await expect(isActiveChatParticipant("c1", "u1")).resolves.toBe(false);
  });

  it("lỗi DB ⇒ ném tiếp (phía gọi fail-closed, không cache)", async () => {
    h.findUnique.mockRejectedValueOnce(new Error("db down"));
    await expect(isActiveChatParticipant("c1", "u1")).rejects.toThrow("db down");
  });
});
