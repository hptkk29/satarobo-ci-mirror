// @vitest-environment node
/**
 * Phương án B — đầu-cuối phía server trên POSTGRES THẬT (cục bộ):
 *   publishViaPgNotify (Prisma `pg_notify`) → Postgres → hub `LISTEN` (pg) →
 *   cổng quyền `isActiveChatParticipant` trên fixture chat chuẩn → người nghe.
 *
 * Unit test đã phủ từng mảnh bằng bản giả; bộ này chứng minh các mảnh KHỚP NHAU với DB thật:
 * câu `unnest(...::text[])` chạy được, phong bì qua được trần NOTIFY, và ma trận quyền đọc
 * đúng `ConversationParticipant` (leftAt) — tức đúng thứ RLS Supabase từng làm.
 *
 * Chỉ chạy với `pnpm test:chat-db` trên Postgres cục bộ (cổng `tests/_helpers/db-gate.ts`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { disconnectDb } from "../e2e/_helpers/seed";
import { isActiveChatParticipant } from "../../lib/chat/queries";
import { createTopicAuthorizer, PARTICIPANT_CACHE_TTL_MS } from "../../lib/chat/realtime-authz";
import { getRealtimeHub, type HubSubscriber } from "../../lib/chat/realtime-hub";
import { publishViaPgNotify, RESYNC_EVENT, type RealtimeEnvelope } from "../../lib/chat/realtime-notify";
import { conversationBroadcast, userBumpBroadcasts } from "../../lib/chat/broadcast";
import { seedChatFixture, type ChatFixture } from "./_helpers/seed-chat";
import { DB_URL_CHE, LY_DO_BO_QUA, RUN_DB_TESTS } from "../_helpers/db-gate";

const HOOK_TIMEOUT = 180_000;

if (!RUN_DB_TESTS) {
  describe("Chat · realtime SSE trên Postgres thật", () => {
    it.skip(`SKIP — ${LY_DO_BO_QUA} (DB=${DB_URL_CHE})`, () => {});
  });
}

async function waitFor(cond: () => boolean, ms = 3_000) {
  const until = Date.now() + ms;
  while (!cond() && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
}

describe.skipIf(!RUN_DB_TESTS)("Chat · realtime SSE trên Postgres thật", () => {
  let fx: ChatFixture;
  let clock = Date.now();
  const offs: Array<() => void> = [];

  function listen(userId: string, convs: string[]) {
    const got: RealtimeEnvelope[] = [];
    const sub: HubSubscriber = {
      userId,
      conversationIds: new Set(convs),
      authorize: createTopicAuthorizer({
        userId,
        isParticipant: (c, u) => isActiveChatParticipant(c, u),
        now: () => clock,
      }),
      send: (e) => got.push(e),
      close: () => {},
    };
    offs.push(getRealtimeHub().subscribe(sub));
    return got;
  }

  beforeAll(async () => {
    fx = await seedChatFixture();
    await expect(getRealtimeHub().ready(10_000)).resolves.toBe(true);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const off of offs) off();
    await db.conversationParticipant.updateMany({
      where: { conversationId: fx.conversations.lopA, userId: fx.users.ph1 },
      data: { leftAt: null },
    });
    await disconnectDb();
  });

  it("ma trận: participant nhận, người ngoài + người đã rời không nhận; user: chỉ chính chủ", async () => {
    const convA = fx.conversations.lopA;
    const ph1 = listen(fx.users.ph1, [convA]); // participant LopA
    const ph3 = listen(fx.users.ph3, [convA]); // không thuộc LopA — cố xin nghe
    const ph4 = listen(fx.users.ph4, [convA]); // đã rời LopA (leftAt set)

    const ok = await publishViaPgNotify([
      conversationBroadcast(convA, "message.created", { id: "m-sse-1", conversationId: convA }),
      ...userBumpBroadcasts([fx.users.ph3], {
        conversationId: fx.conversations.lopB,
        messageId: "m-sse-b",
        kind: "CHAT",
        at: new Date().toISOString(),
      }),
    ]);
    expect(ok).toBe(true);

    await waitFor(() => ph1.length > 0 && ph3.length > 0);
    await new Promise((r) => setTimeout(r, 200)); // cho kẻ không được phép "cơ hội" nhận nhầm

    expect(ph1.map((e) => e.topic)).toEqual([`conv:${convA}`]);
    expect(ph3.map((e) => e.topic)).toEqual([`user:${fx.users.ph3}`]);
    expect(ph4).toEqual([]);
  });

  it("bị gỡ giữa phiên ⇒ ngừng nhận sau TTL cache, kết nối vẫn mở", async () => {
    const convA = fx.conversations.lopA;
    const ph1 = listen(fx.users.ph1, [convA]);

    await publishViaPgNotify([conversationBroadcast(convA, "message.created", { id: "truoc" })]);
    await waitFor(() => ph1.length === 1);
    expect(ph1.map((e) => e.payload.id)).toEqual(["truoc"]);

    await db.conversationParticipant.updateMany({
      where: { conversationId: convA, userId: fx.users.ph1 },
      data: { leftAt: new Date() },
    });
    clock += PARTICIPANT_CACHE_TTL_MS; // hết hạn cache ⇒ lần giao kế hỏi lại DB

    await publishViaPgNotify([conversationBroadcast(convA, "message.created", { id: "sau" })]);
    await new Promise((r) => setTimeout(r, 400));
    expect(ph1.map((e) => e.payload.id)).toEqual(["truoc"]);
  });

  it("phong bì quá trần NOTIFY đi qua được Postgres dưới dạng realtime.resync", async () => {
    const convB = fx.conversations.lopB;
    const ph2 = listen(fx.users.ph2, [convB]); // participant LopB
    const ok = await publishViaPgNotify([
      conversationBroadcast(convB, "message.created", {
        id: "m-to",
        conversationId: convB,
        body: "ệ".repeat(5000), // ~15 kB UTF-8 — NOTIFY trần sẽ báo lỗi "payload string too long"
      }),
    ]);
    expect(ok).toBe(true);
    await waitFor(() => ph2.length > 0);
    expect(ph2[0]).toEqual({
      topic: `conv:${convB}`,
      event: RESYNC_EVENT,
      payload: { event: "message.created", id: "m-to", conversationId: convB },
    });
  });
});
