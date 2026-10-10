// @vitest-environment node
/**
 * US-06 — `broadcast.ts`: builder phong bì + phát realtime FAIL-AND-FORGET.
 *
 * Bất biến được pin ở đây (AC3 + NT1 "Postgres là nguồn sự thật"):
 *  • Phát hỏng → TRẢ VỀ false, TUYỆT ĐỐI không throw. Một cú throw ở đây sẽ kéo đổ
 *    `sendChatMessage` sau khi tin ĐÃ commit ⇒ người gửi thấy "lỗi" trong khi tin nằm
 *    trong DB — đúng kiểu bug mất niềm tin nhất.
 *  • Đường phát DUY NHẤT là Postgres NOTIFY (`realtime-notify.ts`) — không HTTP nào
 *    (Supabase Realtime đã gỡ 28/09/2026).
 *  • Builder giữ BR-30: payload tín hiệu không mang body/tên/SĐT/preview.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  publish: vi.fn(async (_m: readonly unknown[]) => true),
}));

vi.mock("@/lib/chat/realtime-notify", () => ({ publishViaPgNotify: h.publish }));

async function loadModule() {
  vi.resetModules();
  return import("./broadcast");
}

beforeEach(() => {
  h.publish.mockReset();
  h.publish.mockImplementation(async () => true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("[US-06] broadcastToConversation", () => {
  it("phát đúng 1 phong bì topic conv:{id} qua NOTIFY", async () => {
    const { broadcastToConversation } = await loadModule();
    const ok = await broadcastToConversation("c1", "message.created", { id: "m1" });
    expect(ok).toBe(true);
    expect(h.publish).toHaveBeenCalledTimes(1);
    expect(h.publish.mock.calls[0]![0]).toEqual([
      { topic: "conv:c1", event: "message.created", payload: { id: "m1" } },
    ]);
  });
});

describe("[US-06][AC3] fail-and-forget — không bao giờ throw ra ngoài", () => {
  it("NOTIFY báo hỏng → false, KHÔNG throw", async () => {
    h.publish.mockResolvedValueOnce(false);
    const { broadcastToConversation } = await loadModule();
    await expect(broadcastToConversation("c1", "message.created", {})).resolves.toBe(false);
  });

  it("NOTIFY ném lỗi bất ngờ → false + warn, KHÔNG throw", async () => {
    h.publish.mockRejectedValueOnce(new Error("boom"));
    const { broadcastMessages, conversationBroadcast } = await loadModule();
    await expect(
      broadcastMessages([conversationBroadcast("c1", "message.created", {})]),
    ).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });

  it("mảng rỗng → không chạm NOTIFY, trả true", async () => {
    const { broadcastMessages } = await loadModule();
    await expect(broadcastMessages([])).resolves.toBe(true);
    expect(h.publish).not.toHaveBeenCalled();
  });

  it("nhiều người nhận đi trong MỘT lời gọi (không lặp N lượt trong đường gửi tin)", async () => {
    const { broadcastMessages, notificationBumpBroadcasts } = await loadModule();
    const ids = Array.from({ length: 130 }, (_, i) => `u${i}`);
    await broadcastMessages(notificationBumpBroadcasts(ids, { at: "2026-08-19T03:04:05.000Z" }));
    expect(h.publish).toHaveBeenCalledTimes(1);
    const sent = h.publish.mock.calls[0]![0] as Array<{ topic: string }>;
    expect(sent.map((m) => m.topic)).toEqual(ids.map((id) => `user:${id}`));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Topic mức NGƯỜI DÙNG `user:{id}` — vá món nợ badge/danh sách của Đợt 1.
// ═════════════════════════════════════════════════════════════════════════════
describe("[bump] userBumpBroadcasts — builder thuần", () => {
  it("mỗi userId một phần tử topic user:{id}, event conversation.bumped", async () => {
    const { userBumpBroadcasts } = await loadModule();
    const out = userBumpBroadcasts(["u1", "u2", "u3"], {
      conversationId: "c1",
      messageId: "m1",
      kind: "CHAT",
      at: "2026-08-09T00:00:00.000Z",
    });
    expect(out.map((m) => m.topic)).toEqual(["user:u1", "user:u2", "user:u3"]);
    expect(out.every((m) => m.event === "conversation.bumped")).toBe(true);
  });

  it("payload có ĐÚNG 4 khoá — không body/senderName/preview/unreadCount (BR-30)", async () => {
    const { userBumpBroadcasts } = await loadModule();
    const [one] = userBumpBroadcasts(["u1"], {
      conversationId: "c1",
      messageId: "m1",
      kind: "ANNOUNCEMENT",
      at: "2026-08-09T00:00:00.000Z",
    });
    expect(Object.keys(one!.payload).sort()).toEqual(["at", "conversationId", "kind", "messageId"]);
  });

  it("khử trùng userId + bỏ chuỗi rỗng (một người có mặt 2 lần chỉ nhận 1 bump)", async () => {
    const { userBumpBroadcasts } = await loadModule();
    const out = userBumpBroadcasts(["u1", "u1", "", "u2"], {
      conversationId: "c1",
      messageId: "m1",
      kind: "CHAT",
      at: "2026-08-09T00:00:00.000Z",
    });
    expect(out.map((m) => m.topic)).toEqual(["user:u1", "user:u2"]);
  });
});

/**
 * Chuông nhân sự đi nhờ ĐÚNG kênh `user:{id}` sẵn có — không topic mới, không migration
 * (cổng quyền SSE chỉ so topic, KHÔNG lọc tên event).
 * Bất biến đắt nhất ở đây là BR-30: payload chỉ được là TÍN HIỆU.
 */
describe("[noti] notificationBumpBroadcasts — builder thuần", () => {
  it("mỗi userId một phần tử topic user:{id}, event notification.bumped", async () => {
    const { notificationBumpBroadcasts } = await loadModule();
    const out = notificationBumpBroadcasts(["u1", "u2", "u3"], {
      at: "2026-08-19T03:04:05.000Z",
    });
    expect(out.map((m) => m.topic)).toEqual(["user:u1", "user:u2", "user:u3"]);
    expect(out.every((m) => m.event === "notification.bumped")).toBe(true);
  });

  it("payload có ĐÚNG khoá `at` — không tiêu đề/href/unreadCount (BR-30)", async () => {
    const { notificationBumpBroadcasts } = await loadModule();
    const [one] = notificationBumpBroadcasts(["u1"], { at: "2026-08-19T03:04:05.000Z" });
    expect(Object.keys(one!.payload)).toEqual(["at"]);
    expect(one!.payload.at).toBe("2026-08-19T03:04:05.000Z");
  });

  /**
   * Nơi gọi thật thường có nguyên object StaffNotification trong tay (title, href,
   * studentId…). Builder dựng lại từng khoá thay vì spread, nên dù người gọi có nhét thêm
   * gì thì cũng KHÔNG có đường nào rò ra kênh realtime — chỗ mà "đúng người" không đồng
   * nghĩa "đúng quyền xem nội dung".
   */
  it("người gọi nhét thêm khoá (title/href) ⇒ builder VẪN chỉ đẩy `at`", async () => {
    const { notificationBumpBroadcasts } = await loadModule();
    const smuggled = {
      at: "2026-08-19T03:04:05.000Z",
      title: "Nhận xét mới của HV Nguyễn Văn A",
      href: "/attendance?sessionId=abc",
      unreadCount: 7,
    };
    const [one] = notificationBumpBroadcasts(["u1"], smuggled);
    expect(Object.keys(one!.payload)).toEqual(["at"]);
  });

  it("khử trùng userId + bỏ chuỗi rỗng (một người nhận 2 thông báo chỉ cần 1 tín hiệu)", async () => {
    const { notificationBumpBroadcasts } = await loadModule();
    const out = notificationBumpBroadcasts(["u1", "u1", "", "u2"], {
      at: "2026-08-19T03:04:05.000Z",
    });
    expect(out.map((m) => m.topic)).toEqual(["user:u1", "user:u2"]);
  });
});
