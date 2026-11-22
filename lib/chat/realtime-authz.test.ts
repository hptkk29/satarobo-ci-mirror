// @vitest-environment node
/**
 * Phương án B — ma trận quyền nhận tin realtime qua SSE, kiểm ở MỖI LẦN GIAO.
 *
 * Thay cho RLS `participant_can_receive_conversation_broadcast` / `user_can_receive_own_user_broadcast`
 * trên `realtime.messages` (Supabase). Khác biệt có chủ đích: RLS chỉ chạy LÚC JOIN (lỗ rò đã đo,
 * xem `lib/chat/realtime-token.ts`), còn ở đây mỗi phong bì đều qua cổng — người bị gỡ ngừng nhận
 * sau tối đa một TTL cache.
 */
import { describe, expect, it, vi } from "vitest";
import {
  MAX_STREAM_CONVERSATIONS,
  PARTICIPANT_CACHE_TTL_MS,
  createTopicAuthorizer,
  parseStreamConversationIds,
} from "./realtime-authz";

function setup(members: Record<string, string[]>) {
  let now = 1_000_000;
  const state = { members };
  const isParticipant = vi.fn(async (conversationId: string, userId: string) =>
    (state.members[conversationId] ?? []).includes(userId),
  );
  const forUser = (userId: string) =>
    createTopicAuthorizer({ userId, isParticipant, now: () => now });
  return {
    state,
    isParticipant,
    forUser,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

describe("topic user:{id} — chỉ đúng chính chủ", () => {
  it("nhận topic của mình, không nhận của người khác", async () => {
    const { forUser, isParticipant } = setup({});
    const a = forUser("u-a");
    expect(await a("user:u-a")).toBe(true);
    expect(await a("user:u-b")).toBe(false);
    // So khớp trọn chuỗi — tiền tố không được lọt.
    expect(await a("user:u-a-extra")).toBe(false);
    expect(await a("user:")).toBe(false);
    // Topic user không bao giờ tốn truy vấn DB.
    expect(isParticipant).not.toHaveBeenCalled();
  });
});

describe("topic conv:{id} — participant còn hiệu lực", () => {
  it("participant nhận, người ngoài không nhận", async () => {
    const { forUser } = setup({ c1: ["u-gv", "u-ph"] });
    expect(await forUser("u-ph")("conv:c1")).toBe(true);
    expect(await forUser("u-gv")("conv:c1")).toBe(true);
    expect(await forUser("u-la")("conv:c1")).toBe(false);
    expect(await forUser("u-ph")("conv:c-khac")).toBe(false);
  });

  it("bị gỡ giữa phiên ⇒ ngừng nhận khi cache hết hạn (không phải khi nối lại)", async () => {
    const { forUser, state, tick } = setup({ c1: ["u-ph"] });
    const ph = forUser("u-ph");
    expect(await ph("conv:c1")).toBe(true);

    state.members.c1 = []; // gỡ khỏi lớp (leftAt được set)
    // Trong TTL vẫn dùng kết quả cache — đây là cận trên CÓ CHỦ ĐÍCH của cửa sổ rò.
    tick(PARTICIPANT_CACHE_TTL_MS - 1);
    expect(await ph("conv:c1")).toBe(true);
    tick(1);
    expect(await ph("conv:c1")).toBe(false);
  });

  it("cache theo TỪNG hội thoại và TỪNG kết nối, không lẫn giữa người", async () => {
    const { forUser, isParticipant } = setup({ c1: ["u-a"], c2: ["u-b"] });
    const a = forUser("u-a");
    const b = forUser("u-b");
    expect(await a("conv:c1")).toBe(true);
    expect(await a("conv:c1")).toBe(true);
    expect(await b("conv:c1")).toBe(false);
    expect(await a("conv:c2")).toBe(false);
    // a/c1 hỏi 1 lần (lần 2 ăn cache), b/c1 1 lần, a/c2 1 lần.
    expect(isParticipant).toHaveBeenCalledTimes(3);
  });

  it("nhiều phong bì đồng thời chỉ tốn MỘT truy vấn", async () => {
    const { forUser, isParticipant } = setup({ c1: ["u-a"] });
    const a = forUser("u-a");
    const results = await Promise.all([a("conv:c1"), a("conv:c1"), a("conv:c1")]);
    expect(results).toEqual([true, true, true]);
    expect(isParticipant).toHaveBeenCalledTimes(1);
  });

  it("DB lỗi ⇒ KHÔNG giao (fail-closed) và không cache lỗi", async () => {
    const { forUser, isParticipant } = setup({ c1: ["u-a"] });
    isParticipant.mockRejectedValueOnce(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = forUser("u-a");
    expect(await a("conv:c1")).toBe(false);
    expect(await a("conv:c1")).toBe(true); // lần sau hỏi lại thật
    warn.mockRestore();
  });

  it("topic lạ / rỗng ⇒ từ chối", async () => {
    const { forUser } = setup({ c1: ["u-a"] });
    const a = forUser("u-a");
    expect(await a("conv:")).toBe(false);
    expect(await a("broadcast:c1")).toBe(false);
    expect(await a("")).toBe(false);
  });
});

describe("parseStreamConversationIds — tham số `conv` của /api/chat/stream", () => {
  it("nhận cả lặp tham số lẫn danh sách phẩy, khử trùng", () => {
    expect(parseStreamConversationIds(["c1,c2", "c2", "c3"])).toEqual(["c1", "c2", "c3"]);
  });

  it("bỏ giá trị dị dạng (ký tự lạ, quá dài, rỗng)", () => {
    expect(parseStreamConversationIds(["ok_1", "a b", "x".repeat(65), "", "c:1", "../x"])).toEqual([
      "ok_1",
    ]);
  });

  it(`cắt ở trần ${MAX_STREAM_CONVERSATIONS} hội thoại`, () => {
    const many = Array.from({ length: MAX_STREAM_CONVERSATIONS + 5 }, (_, i) => `c${i}`);
    expect(parseStreamConversationIds(many)).toHaveLength(MAX_STREAM_CONVERSATIONS);
  });
});
