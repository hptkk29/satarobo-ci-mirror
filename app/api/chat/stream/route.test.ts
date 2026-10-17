// @vitest-environment node
/**
 * `GET /api/chat/stream` (SSE) — tầng realtime duy nhất từ 28/09/2026. Đây là CỬA THỨ HAI vào
 * nội dung chat, nên giữ đủ các cổng của `/api/chat/realtime-token`:
 *  • chưa đăng nhập 401; phiên đã thu hồi (tokenVersion) 401;
 *  • PH thuần chưa đồng ý quy định chat ⇒ 403 (US-16 AC2), không mở stream;
 *  • rate limit trước cổng chính sách; trần số kết nối/người;
 *  • hub chưa LISTEN được ⇒ 503 (không để client "SUBSCRIBED" vào hub mù).
 * Và các bất biến của stream: header chống buffer, người nghe mang ĐÚNG userId của phiên +
 * cổng quyền kiểm participant, dọn sạch khi trình duyệt ngắt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HubSubscriber } from "@/lib/chat/realtime-hub";

const h = vi.hoisted(() => ({
  RealtimeTokenError: class RealtimeTokenError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  auth: vi.fn(
    async () =>
      null as {
        user?: { id: string; role?: string; roles?: string[]; tokenVersion?: number };
      } | null,
  ),
  hasAcceptedChatPolicy: vi.fn(async (_userId: string) => true),
  assertRealtimeUserValid: vi.fn(async (_u: unknown) => {}),
  rateLimit: vi.fn(async (_a: { key: string; max: number; windowMs: number }) => ({
    success: true,
    remaining: 29,
    resetAt: Date.now() + 60_000,
  })),
  isActiveChatParticipant: vi.fn(async (_c: string, _u: string) => true),
  subs: [] as HubSubscriber[],
  unsubscribe: vi.fn(),
  ready: vi.fn(async (_ms: number) => true),
  count: vi.fn((_u?: string) => 0),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/chat/policy", () => ({ hasAcceptedChatPolicy: h.hasAcceptedChatPolicy }));
vi.mock("@/lib/chat/realtime-token", () => ({
  assertRealtimeUserValid: h.assertRealtimeUserValid,
  RealtimeTokenError: h.RealtimeTokenError,
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/lib/chat/queries", () => ({ isActiveChatParticipant: h.isActiveChatParticipant }));
vi.mock("@/lib/chat/realtime-hub", () => ({
  getRealtimeHub: () => ({
    subscribe: (s: HubSubscriber) => {
      h.subs.push(s);
      return h.unsubscribe;
    },
    ready: h.ready,
    subscriberCount: h.count,
  }),
}));

import { GET } from "./route";

const PARENT = { id: "ph-1", role: "PARENT", roles: ["PARENT"], tokenVersion: 1 };
const TEACHER = { id: "gv-1", role: "TEACHER", roles: ["TEACHER"], tokenVersion: 1 };

function req(query = "", signal?: AbortSignal) {
  return new Request(`http://localhost/api/chat/stream${query}`, { signal });
}

async function readSome(res: Response, until: (text: string) => boolean): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  for (let i = 0; i < 20 && !until(text); i++) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value);
  }
  reader.releaseLock();
  return text;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.subs.length = 0;
  h.auth.mockResolvedValue({ user: TEACHER });
  h.hasAcceptedChatPolicy.mockResolvedValue(true);
  h.assertRealtimeUserValid.mockResolvedValue(undefined);
  h.rateLimit.mockResolvedValue({ success: true, remaining: 29, resetAt: Date.now() + 60_000 });
  h.ready.mockResolvedValue(true);
  h.count.mockReturnValue(0);
});

describe("cổng trước khi mở stream", () => {
  it("chưa đăng nhập ⇒ 401", async () => {
    h.auth.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    expect(h.subs).toHaveLength(0);
  });

  it("rate limit ⇒ 429 và KHÔNG tốn truy vấn chính sách", async () => {
    h.auth.mockResolvedValue({ user: PARENT });
    h.rateLimit.mockResolvedValue({ success: false, remaining: 0, resetAt: Date.now() });
    expect((await GET(req())).status).toBe(429);
    expect(h.hasAcceptedChatPolicy).not.toHaveBeenCalled();
    expect(h.rateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "chat:stream:ph-1" }),
    );
  });

  it("PH thuần chưa đồng ý quy định ⇒ 403 CHAT_POLICY_REQUIRED, không mở stream", async () => {
    h.auth.mockResolvedValue({ user: PARENT });
    h.hasAcceptedChatPolicy.mockResolvedValue(false);
    const res = await GET(req());
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: { code: "CHAT_POLICY_REQUIRED" } });
    expect(h.subs).toHaveLength(0);
  });

  it("đọc sổ đồng ý lỗi ⇒ coi như chưa đồng ý (fail-closed)", async () => {
    h.auth.mockResolvedValue({ user: PARENT });
    h.hasAcceptedChatPolicy.mockRejectedValue(new Error("db"));
    expect((await GET(req())).status).toBe(403);
  });

  it("phiên đã bị thu hồi (tokenVersion lệch) ⇒ 401", async () => {
    h.assertRealtimeUserValid.mockRejectedValue(new h.RealtimeTokenError("TOKEN_VERSION_MISMATCH"));
    expect((await GET(req())).status).toBe(401);
    expect(h.subs).toHaveLength(0);
  });

  it("quá trần kết nối/người ⇒ 429", async () => {
    h.count.mockReturnValue(8);
    expect((await GET(req())).status).toBe(429);
    expect(h.subs).toHaveLength(0);
  });

  it("hub chưa LISTEN được ⇒ 503", async () => {
    h.ready.mockResolvedValue(false);
    expect((await GET(req())).status).toBe(503);
    expect(h.subs).toHaveLength(0);
  });
});

describe("stream đã mở", () => {
  it("header SSE chống buffer + người nghe mang userId của PHIÊN và đúng danh sách hội thoại", async () => {
    const res = await GET(req("?conv=c1,c2&conv=c1&conv=bad%20id"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");

    expect(h.subs).toHaveLength(1);
    const sub = h.subs[0];
    expect(sub.userId).toBe("gv-1");
    expect([...sub.conversationIds]).toEqual(["c1", "c2"]);

    const head = await readSome(res, (t) => t.includes("\n\n"));
    expect(head).toContain("retry:");
  });

  it("cổng quyền của kết nối: user khác bị từ chối, conv hỏi participant bằng userId phiên", async () => {
    await GET(req("?conv=c1"));
    const sub = h.subs[0];
    expect(await sub.authorize("user:gv-1")).toBe(true);
    expect(await sub.authorize("user:ph-9")).toBe(false);
    h.isActiveChatParticipant.mockResolvedValueOnce(false);
    expect(await sub.authorize("conv:c1")).toBe(false);
    expect(h.isActiveChatParticipant).toHaveBeenCalledWith("c1", "gv-1");
  });

  it("phong bì được viết thành `data: <json>`", async () => {
    const res = await GET(req("?conv=c1"));
    h.subs[0].send({ topic: "conv:c1", event: "message.created", payload: { id: "m1" } });
    const text = await readSome(res, (t) => t.includes("message.created"));
    expect(text).toContain(
      `data: ${JSON.stringify({ topic: "conv:c1", event: "message.created", payload: { id: "m1" } })}\n\n`,
    );
  });

  it("trình duyệt ngắt (abort) ⇒ huỷ đăng ký khỏi hub", async () => {
    const ac = new AbortController();
    await GET(req("", ac.signal));
    expect(h.unsubscribe).not.toHaveBeenCalled();
    ac.abort();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("hub đóng (mất LISTEN) ⇒ stream kết thúc để client nối lại", async () => {
    const res = await GET(req());
    h.subs[0].close();
    const reader = res.body!.getReader();
    let done = false;
    for (let i = 0; i < 5 && !done; i++) done = (await reader.read()).done;
    expect(done).toBe(true);
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
