// @vitest-environment node
/**
 * `GET /api/chat/unread` — đường badge "Tin nhắn" gọi lại mỗi khi kênh `user:{id}` báo
 * `conversation.bumped`.
 *
 * Bất biến pin ở đây:
 *  • Chưa đăng nhập → 401 và KHÔNG chạm tới hàm đếm (không có oracle cho khách vãng lai).
 *  • `userId` LẤY TỪ PHIÊN. Route không nhận tham số nào; nếu mai ai đó thêm đường đọc
 *    `?userId=` thì test "đếm đúng người trong phiên" phải đỏ — đây là đường đếm hộ
 *    người khác gần nhất mà module chat có.
 *  • Có trần lượt gọi theo userId (`chat:unread:{id}`, 150/60s) — không thể để một tab
 *    hỏng bơm vô hạn. Con số 150 phải đủ cho nhiều tab: bộ gom cụm ở client là biến mức
 *    module nên mỗi tab một bộ riêng (20 lượt/phút/tab), hạ xuống 60 là 4 tab đã ăn 429
 *    và badge đóng băng câm lặng.
 *  • `Cache-Control: no-store` — con số này không được nằm lại trong bất kỳ tầng cache nào.
 *  • Payload đúng một khoá `total` (BR-30: không tên/SĐT/email, không cả conversationId).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(async () => null as { user?: { id: string } } | null),
  countChatUnreadForUser: vi.fn(async (_userId: string) => 0),
  rateLimit: vi.fn(async (_args: { key: string; max: number; windowMs: number }) => ({
    success: true,
    remaining: 59,
    resetAt: Date.now() + 60_000,
  })),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/chat/unread", () => ({ countChatUnreadForUser: h.countChatUnreadForUser }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: h.rateLimit }));

import { GET } from "./route";

beforeEach(() => {
  h.auth.mockReset();
  h.auth.mockResolvedValue({ user: { id: "u-chinh-chu" } });
  h.countChatUnreadForUser.mockReset();
  h.countChatUnreadForUser.mockResolvedValue(0);
  h.rateLimit.mockReset();
  h.rateLimit.mockResolvedValue({ success: true, remaining: 59, resetAt: Date.now() + 60_000 });
});

describe("GET /api/chat/unread", () => {
  it("chưa đăng nhập → 401 và KHÔNG gọi hàm đếm", async () => {
    h.auth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(h.countChatUnreadForUser).not.toHaveBeenCalled();
  });

  it("đăng nhập rồi → 200 { total } lấy từ hàm đếm", async () => {
    h.countChatUnreadForUser.mockResolvedValue(7);

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ total: 7 });
  });

  it("đếm cho CHÍNH người trong phiên (không nhận userId từ bên ngoài)", async () => {
    h.auth.mockResolvedValue({ user: { id: "u-chinh-chu" } });

    await GET();

    expect(h.countChatUnreadForUser).toHaveBeenCalledTimes(1);
    expect(h.countChatUnreadForUser).toHaveBeenCalledWith("u-chinh-chu");
  });

  it("trả Cache-Control: no-store (badge không được đóng băng trong cache)", async () => {
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("có trần lượt gọi khoá theo userId — vượt trần → 429, KHÔNG chạy truy vấn đếm", async () => {
    h.rateLimit.mockResolvedValue({ success: false, remaining: 0, resetAt: Date.now() + 1_000 });

    const res = await GET();

    expect(res.status).toBe(429);
    expect(h.countChatUnreadForUser).not.toHaveBeenCalled();
    expect(h.rateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "chat:unread:u-chinh-chu", max: 150, windowMs: 60_000 }),
    );
  });
});
