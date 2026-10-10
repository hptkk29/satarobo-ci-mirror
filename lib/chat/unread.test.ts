// @vitest-environment node
/**
 * `countChatUnreadForUser` — TỔNG chưa đọc nuôi badge "Tin nhắn" trên nav của cả 3 site.
 *
 * Bất biến pin ở đây:
 *  • Con số = TỔNG `unreadCount` của đúng danh sách hội thoại mà `listConversationsForUser`
 *    trả về — KHÔNG phải "số hội thoại có tin chưa đọc". Badge và màn danh sách phải đọc
 *    CÙNG một định nghĩa "hội thoại của tôi"; hai định nghĩa = hai con số lệch nhau (đúng
 *    vết `countUnreadForParent` cũ).
 *  • Đếm cho CHÍNH `userId` được truyền vào — không bao giờ đếm hộ người khác.
 *  • KHÔNG đi qua `scopedDb` (luật E-bis #5): dẫn xuất thành viên là thao tác mức hệ
 *    thống, bọc scope vào đây thì GV dạy chéo cơ sở mất sạch hội thoại một cách im lặng.
 *
 * `listConversationsForUser` được mock: nó đã có bộ test riêng (`queries.test.ts`) cho
 * phần lọc `leftAt IS NULL` + BR-04; ở đây chỉ đo phép cộng và đường truyền `userId`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listConversationsForUser: vi.fn(
    async (_userId: string, _opts?: { limit?: number; withPreview?: boolean }) =>
      [] as { unreadCount: number }[],
  ),
  scopedDb: vi.fn(() => {
    throw new Error(
      "lib/chat/unread.ts KHÔNG được đi qua scopedDb (luật E-bis #5 — GV dạy chéo cơ sở sẽ mất hết hội thoại)",
    );
  }),
}));

vi.mock("@/lib/chat/queries", () => ({
  listConversationsForUser: h.listConversationsForUser,
  MAX_CONVERSATION_LIMIT: 500,
}));
// Bẫy: ai lỡ tay bọc scopedDb vào đường đếm này thì test đỏ ngay, không im lặng.
vi.mock("@/lib/db-scope", () => ({ scopedDb: h.scopedDb }));

import { countChatUnreadForUser } from "./unread";

/** Chỉ `unreadCount` là dữ kiện hàm này dùng — phần còn lại của item không liên quan. */
function conv(unreadCount: number) {
  return { unreadCount };
}

beforeEach(() => {
  h.listConversationsForUser.mockReset();
  h.listConversationsForUser.mockResolvedValue([]);
  h.scopedDb.mockClear();
});

describe("countChatUnreadForUser", () => {
  it("cộng TỔNG unreadCount của mọi hội thoại (không phải đếm số hội thoại)", async () => {
    h.listConversationsForUser.mockResolvedValue([conv(5), conv(0), conv(7)]);

    // 5 + 0 + 7 = 12. Nếu ai đó đổi thành "đếm hội thoại có tin mới" thì ra 2.
    await expect(countChatUnreadForUser("u-1")).resolves.toBe(12);
  });

  it("không có hội thoại nào → 0 (badge ẩn, không phải hiện số ma)", async () => {
    h.listConversationsForUser.mockResolvedValue([]);
    await expect(countChatUnreadForUser("u-1")).resolves.toBe(0);
  });

  it("mọi hội thoại đã đọc hết → 0", async () => {
    h.listConversationsForUser.mockResolvedValue([conv(0), conv(0)]);
    await expect(countChatUnreadForUser("u-1")).resolves.toBe(0);
  });

  it("đếm cho ĐÚNG userId được truyền vào — không đếm hộ người khác", async () => {
    h.listConversationsForUser.mockResolvedValue([conv(3)]);

    await countChatUnreadForUser("u-chinh-chu");

    expect(h.listConversationsForUser).toHaveBeenCalledTimes(1);
    expect(h.listConversationsForUser.mock.calls[0]?.[0]).toBe("u-chinh-chu");
  });

  it("KHÔNG dựng preview — badge chỉ cần con số, dựng rồi vứt là truy vấn thừa", async () => {
    h.listConversationsForUser.mockResolvedValue([conv(1)]);

    await countChatUnreadForUser("u-1");

    // Bỏ `withPreview: false` ⇒ mỗi lượt gọi (layout 3 site + mỗi lần bump) lại quét
    // DISTINCT ON trên Message của tới 500 hội thoại rồi `.reduce()` bỏ đi toàn bộ.
    expect(h.listConversationsForUser).toHaveBeenCalledWith(
      "u-1",
      expect.objectContaining({ withPreview: false }),
    );
  });

  it("đếm ĐỦ tới trần tối đa — quản lý cơ sở nhiều nhóm không bị đếm thiếu", async () => {
    h.listConversationsForUser.mockResolvedValue([conv(1)]);

    await countChatUnreadForUser("qlcs-nhieu-lop");

    // Mặc định của `listConversationsForUser` là 100. Để mặc định ⇒ người có hơn 100 nhóm
    // lớp bị đếm thiếu, mà đếm thiếu thì không ai phát hiện được bằng mắt.
    expect(h.listConversationsForUser).toHaveBeenCalledWith(
      "qlcs-nhieu-lop",
      expect.objectContaining({ limit: 500 }),
    );
  });

  it("KHÔNG đi qua scopedDb (luật E-bis #5)", async () => {
    h.listConversationsForUser.mockResolvedValue([conv(1)]);

    await expect(countChatUnreadForUser("gv-day-cheo-co-so")).resolves.toBe(1);
    expect(h.scopedDb).not.toHaveBeenCalled();
  });
});
