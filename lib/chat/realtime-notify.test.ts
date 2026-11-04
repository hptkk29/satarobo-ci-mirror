// @vitest-environment node
/**
 * Đường PHÁT realtime phía server (Postgres NOTIFY) — đường duy nhất từ 28/09/2026.
 *
 * Bất biến khoá ở đây:
 *  • Hình dạng phong bì `{topic, event, payload}` giữ NGUYÊN payload của các builder trong
 *    `broadcast.ts` (client dùng lại đúng parser cũ).
 *  • Trần 8000 byte của `NOTIFY`: phong bì quá cỡ ⇒ chỉ còn id + tên event gốc, đổi tên
 *    event thành `realtime.resync` để client tự đi hỏi lại server (không bao giờ cắt cụt JSON).
 *  • Phát hỏng ⇒ trả false + log, KHÔNG throw (NT1: Postgres là nguồn sự thật).
 *  • `broadcastMessages` luôn đi NOTIFY, không gọi HTTP nào (Supabase Realtime đã gỡ).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  executeRaw: vi.fn(async (..._args: unknown[]) => 1),
}));

vi.mock("@/lib/db", () => ({
  db: { $executeRaw: h.executeRaw },
}));

import {
  CHAT_REALTIME_CHANNEL,
  NOTIFY_MAX_BYTES,
  RESYNC_EVENT,
  encodeEnvelope,
  publishViaPgNotify,
} from "./realtime-notify";
import { conversationBroadcast, userBumpBroadcasts } from "./broadcast";

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.executeRaw.mockReset();
  h.executeRaw.mockImplementation(async () => 1);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("encodeEnvelope — hình dạng + trần 8000 byte", () => {
  it("payload nhỏ ⇒ giữ nguyên topic/event/payload", () => {
    const msg = conversationBroadcast("c1", "message.created", { id: "m1", body: "chào" });
    const decoded = JSON.parse(encodeEnvelope(msg));
    expect(decoded).toEqual({
      topic: "conv:c1",
      event: "message.created",
      payload: { id: "m1", body: "chào" },
    });
  });

  it("payload quá cỡ ⇒ chỉ còn id, event đổi thành realtime.resync (client tự hỏi lại)", () => {
    // Tiếng Việt có dấu = 2–3 byte/ký tự: 4000 ký tự "ệ" ≈ 12 kB, vượt trần dù `length` < 8000.
    const body = "ệ".repeat(4000);
    const msg = conversationBroadcast("c1", "message.created", {
      id: "m1",
      conversationId: "c1",
      senderId: "u-secret",
      body,
    });
    const raw = encodeEnvelope(msg);
    expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(NOTIFY_MAX_BYTES);
    const decoded = JSON.parse(raw);
    expect(decoded.topic).toBe("conv:c1");
    expect(decoded.event).toBe(RESYNC_EVENT);
    expect(decoded.payload).toEqual({ event: "message.created", id: "m1", conversationId: "c1" });
    // Không mang nội dung / người gửi — chỉ id để đi hỏi lại qua đường đã kiểm quyền.
    expect(raw).not.toContain("u-secret");
    expect(raw).not.toContain("ệệ");
  });

  it("đúng biên: vừa khít trần vẫn đi nguyên, vượt 1 byte thì rơi về resync", () => {
    const base = conversationBroadcast("c1", "message.created", { id: "m1", body: "" });
    const overhead = Buffer.byteLength(encodeEnvelope(base), "utf8");
    const fit = conversationBroadcast("c1", "message.created", {
      id: "m1",
      body: "a".repeat(NOTIFY_MAX_BYTES - overhead),
    });
    expect(JSON.parse(encodeEnvelope(fit)).event).toBe("message.created");
    const over = conversationBroadcast("c1", "message.created", {
      id: "m1",
      body: "a".repeat(NOTIFY_MAX_BYTES - overhead + 1),
    });
    expect(JSON.parse(encodeEnvelope(over)).event).toBe(RESYNC_EVENT);
  });
});

describe("publishViaPgNotify — một câu SQL cho cả lô, lỗi thì nuốt", () => {
  it("gửi MỘT lời gọi $executeRaw mang mọi phong bì (conv + N user)", async () => {
    const msgs = [
      conversationBroadcast("c1", "message.created", { id: "m1" }),
      ...userBumpBroadcasts(["u1", "u2"], {
        conversationId: "c1",
        messageId: "m1",
        kind: "CHAT",
        at: "2026-09-27T00:00:00.000Z",
      }),
    ];
    await expect(publishViaPgNotify(msgs)).resolves.toBe(true);
    expect(h.executeRaw).toHaveBeenCalledTimes(1);
    // Tagged template: (strings, channel, payloads[])
    const [strings, channel, payloads] = h.executeRaw.mock.calls[0] as [
      TemplateStringsArray,
      string,
      string[],
    ];
    expect(strings.join("?")).toContain("pg_notify");
    expect(channel).toBe(CHAT_REALTIME_CHANNEL);
    expect(payloads.map((p) => JSON.parse(p).topic)).toEqual(["conv:c1", "user:u1", "user:u2"]);
  });

  it("lô lớn được chia nhiều câu, không phần tử nào rơi", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `u${i}`);
    const msgs = userBumpBroadcasts(ids, {
      conversationId: "c1",
      messageId: "m1",
      kind: "CHAT",
      at: "2026-09-27T00:00:00.000Z",
    });
    await publishViaPgNotify(msgs);
    const sent = h.executeRaw.mock.calls.flatMap((c) => (c as unknown as [unknown, unknown, string[]])[2]);
    expect(sent).toHaveLength(250);
    expect(h.executeRaw.mock.calls.length).toBeGreaterThan(1);
  });

  it("DB lỗi ⇒ trả false + warn, KHÔNG throw (tin đã commit không được thành lỗi đỏ)", async () => {
    h.executeRaw.mockRejectedValueOnce(new Error("connection terminated"));
    await expect(
      publishViaPgNotify([conversationBroadcast("c1", "message.created", { id: "m1" })]),
    ).resolves.toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("mảng rỗng ⇒ không chạm DB", async () => {
    await expect(publishViaPgNotify([])).resolves.toBe(true);
    expect(h.executeRaw).not.toHaveBeenCalled();
  });
});

describe("broadcastMessages — luôn đi NOTIFY", () => {
  it("đi NOTIFY, không gọi HTTP nào", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { broadcastMessages } = await import("./broadcast");
    await expect(
      broadcastMessages([conversationBroadcast("c1", "message.created", { id: "m1" })]),
    ).resolves.toBe(true);
    expect(h.executeRaw).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("DB lỗi ⇒ trả false, KHÔNG throw", async () => {
    h.executeRaw.mockRejectedValueOnce(new Error("boom"));
    const { broadcastMessages } = await import("./broadcast");
    await expect(
      broadcastMessages([conversationBroadcast("c1", "message.created", { id: "m1" })]),
    ).resolves.toBe(false);
  });
});
