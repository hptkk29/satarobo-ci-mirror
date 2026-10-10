// components/chat/chat-store.test.ts — TS-10 (khử trùng optimistic) + US-06 AC6 + US-07 AC4/AC5.
//
// Toàn bộ là hàm thuần ⇒ test chạy không cần DB, không cần mạng, không cần fake timer.
import { describe, it, expect } from "vitest";
import {
  DELETED_MESSAGE_TEXT,
  MAX_AUTO_RETRIES,
  SEND_RETRY_BACKOFF_MS,
  applyMessageDeleted,
  compareMessages,
  computeUnreadReset,
  createOptimisticMessage,
  isOptimistic,
  lastSeenMessageId,
  mergeMessages,
  nextSendState,
  normalizeIncomingMessage,
  optimisticIdFor,
  parseBroadcastMessage,
  parseConversationBumped,
  parseMessageDeleted,
  parseParticipantRemoved,
  startSend,
  type ChatMessage,
  type IncomingMessage,
} from "./chat-store";

const CONV = "conv-1";
const ME = "user-me";
const OTHER = "user-other";
const CLIENT_MSG_ID = "9f1a2b3c-0000-4000-8000-000000000001";

/** Tin "như server trả về" (Server Action / reconcile): `createdAt` là Date thật. */
function serverMessage(over: Partial<IncomingMessage> & { id: string }): IncomingMessage {
  return {
    conversationId: CONV,
    kind: "CHAT",
    senderId: OTHER,
    body: "xin chào",
    clientMsgId: null,
    createdAt: new Date("2026-08-09T10:00:00.000Z"),
    ...over,
  };
}

/** Payload broadcast thật của `lib/chat/messages.ts` — `createdAt` là chuỗi ISO. */
function broadcastPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "msg-server-1",
    conversationId: CONV,
    senderId: ME,
    kind: "CHAT",
    body: "chào cả nhà",
    replyToId: null,
    clientMsgId: CLIENT_MSG_ID,
    createdAt: "2026-08-09T10:00:05.000Z",
    ...over,
  };
}

describe("normalizeIncomingMessage", () => {
  it("nhận cả Date lẫn chuỗi ISO cho createdAt", () => {
    const fromDate = normalizeIncomingMessage(serverMessage({ id: "a" }));
    const fromIso = normalizeIncomingMessage(
      serverMessage({ id: "a", createdAt: "2026-08-09T10:00:00.000Z" }),
    );
    expect(fromDate.createdAt.getTime()).toBe(fromIso.createdAt.getTime());
  });

  it("tin đã gỡ không bao giờ mang body gốc", () => {
    const m = normalizeIncomingMessage(
      serverMessage({ id: "a", body: "nội dung nhạy cảm", deletedAt: new Date() }),
    );
    expect(m.deleted).toBe(true);
    expect(m.body).toBe(DELETED_MESSAGE_TEXT);
  });
});

describe("mergeMessages — thứ tự (createdAt, id)", () => {
  it("tin đến lộn xộn vẫn sắp CŨ → MỚI", () => {
    const merged = mergeMessages(
      [],
      [
        serverMessage({ id: "c", createdAt: new Date("2026-08-09T10:00:03.000Z") }),
        serverMessage({ id: "a", createdAt: new Date("2026-08-09T10:00:01.000Z") }),
        serverMessage({ id: "b", createdAt: new Date("2026-08-09T10:00:02.000Z") }),
      ],
    );
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("trùng createdAt tới mili-giây thì phân định bằng id (khớp ORDER BY của queries.ts)", () => {
    const at = new Date("2026-08-09T10:00:00.000Z");
    const merged = mergeMessages(
      [],
      [serverMessage({ id: "zz", createdAt: at }), serverMessage({ id: "aa", createdAt: at })],
    );
    expect(merged.map((m) => m.id)).toEqual(["aa", "zz"]);
    expect(compareMessages(merged[0], merged[1])).toBeLessThan(0);
  });

  it("incoming rỗng giữ nguyên tham chiếu (React không render thừa)", () => {
    const current = mergeMessages([], [serverMessage({ id: "a" })]);
    expect(mergeMessages(current, [])).toBe(current);
  });
});

describe("mergeMessages — khử trùng tầng 1 (theo id)", () => {
  it("cùng một tin tới hai đường (broadcast + reconcile) chỉ còn một dòng", () => {
    const first = mergeMessages([], [serverMessage({ id: "m1", body: "bản 1" })]);
    const second = mergeMessages(first, [serverMessage({ id: "m1", body: "bản 2" })]);
    expect(second).toHaveLength(1);
    expect(second[0].body).toBe("bản 2");
  });

  it("hai tin khác nhau cùng có clientMsgId null KHÔNG bị coi là trùng", () => {
    const merged = mergeMessages(
      [],
      [
        serverMessage({ id: "s1", kind: "SYSTEM", senderId: null, clientMsgId: null }),
        serverMessage({
          id: "s2",
          kind: "SYSTEM",
          senderId: null,
          clientMsgId: null,
          createdAt: new Date("2026-08-09T10:00:01.000Z"),
        }),
      ],
    );
    expect(merged.map((m) => m.id)).toEqual(["s1", "s2"]);
  });
});

describe("TS-10 — khử trùng optimistic (tầng 2 theo clientMsgId)", () => {
  const optimistic = () =>
    createOptimisticMessage({
      conversationId: CONV,
      clientMsgId: CLIENT_MSG_ID,
      senderId: ME,
      body: "chào cả nhà",
      now: new Date("2026-08-09T10:00:04.000Z"),
    });

  it("TS-10.1 — render optimistic ngay: một dòng, trạng thái đang gửi", () => {
    const list = mergeMessages([], [optimistic()]);
    expect(list).toHaveLength(1);
    expect(isOptimistic(list[0])).toBe(true);
    expect(list[0].id).toBe(optimisticIdFor(CLIENT_MSG_ID));
    expect(list[0].send?.status).toBe("sending");
    expect(list[0].body).toBe("chào cả nhà");
  });

  it("TS-10.2 — broadcast dội về thay thế bản optimistic, tổng số tin +1 đúng một", () => {
    const list = mergeMessages([], [optimistic()]);
    const payload = parseBroadcastMessage(broadcastPayload());
    expect(payload).not.toBeNull();
    const after = mergeMessages(list, [payload as IncomingMessage]);

    expect(after).toHaveLength(1);
    expect(after[0].id).toBe("msg-server-1");
    expect(isOptimistic(after[0])).toBe(false);
    expect(after[0].send).toBeUndefined();
  });

  it("TS-10.3a — broadcast về TRƯỚC khi Server Action trả về: vẫn một bản", () => {
    let list = mergeMessages([], [optimistic()]);
    // (1) broadcast tới trước
    list = mergeMessages(list, [parseBroadcastMessage(broadcastPayload()) as IncomingMessage]);
    // (2) Server Action trả về sau, cùng id + cùng clientMsgId
    list = mergeMessages(list, [
      serverMessage({
        id: "msg-server-1",
        senderId: ME,
        clientMsgId: CLIENT_MSG_ID,
        createdAt: new Date("2026-08-09T10:00:05.000Z"),
      }),
    ]);

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("msg-server-1");
  });

  it("TS-10.3b — broadcast tới TRƯỚC cả lúc UI kịp chèn optimistic: bản optimistic bị bỏ qua", () => {
    // Đây là nhánh chết người: nếu bản optimistic đè bản server, dòng đã gửi xong sẽ
    // tụt lại trạng thái "đang gửi" vĩnh viễn và id thật biến mất.
    const list = mergeMessages([], [parseBroadcastMessage(broadcastPayload()) as IncomingMessage]);
    const after = mergeMessages(list, [optimistic()]);

    expect(after).toHaveLength(1);
    expect(after[0].id).toBe("msg-server-1");
    expect(after[0].send).toBeUndefined();
    expect(after).toBe(list); // không đổi gì ⇒ giữ nguyên tham chiếu
  });

  it("TS-10.4 — gửi lại cùng clientMsgId (server idempotent) không tạo tin thứ hai", () => {
    let list = mergeMessages([], [optimistic()]);
    const serverRow = serverMessage({
      id: "msg-server-1",
      senderId: ME,
      clientMsgId: CLIENT_MSG_ID,
      createdAt: new Date("2026-08-09T10:00:05.000Z"),
    });
    list = mergeMessages(list, [serverRow]);
    list = mergeMessages(list, [serverRow]); // replay của lần gửi lại

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("msg-server-1");
  });

  it("giữ đúng thứ tự khi bản server có createdAt lệch với bản optimistic", () => {
    let list = mergeMessages([], [
      serverMessage({ id: "before", createdAt: new Date("2026-08-09T09:59:00.000Z") }),
      optimistic(),
      serverMessage({ id: "after", createdAt: new Date("2026-08-09T10:00:09.000Z") }),
    ]);
    list = mergeMessages(list, [parseBroadcastMessage(broadcastPayload()) as IncomingMessage]);

    expect(list.map((m) => m.id)).toEqual(["before", "msg-server-1", "after"]);
  });
});

describe("applyMessageDeleted — US-07 AC4", () => {
  const base = () =>
    mergeMessages([], [
      serverMessage({ id: "m1", body: "tin thường" }),
      serverMessage({ id: "m2", body: "tin sẽ bị gỡ", createdAt: new Date("2026-08-09T10:00:01.000Z") }),
    ]);

  it("đổi tại chỗ thành text thay thế, không đụng tin khác", () => {
    const after = applyMessageDeleted(base(), "m2");
    expect(after).toHaveLength(2);
    expect(after[1].deleted).toBe(true);
    expect(after[1].body).toBe(DELETED_MESSAGE_TEXT);
    expect(after[0].body).toBe("tin thường");
  });

  it("id không có trong luồng (nằm ở trang chưa tải) ⇒ giữ nguyên tham chiếu", () => {
    const list = base();
    expect(applyMessageDeleted(list, "khong-ton-tai")).toBe(list);
  });

  it("gỡ hai lần (broadcast trùng) ⇒ giữ nguyên tham chiếu", () => {
    const once = applyMessageDeleted(base(), "m2");
    expect(applyMessageDeleted(once, "m2")).toBe(once);
  });
});

describe("computeUnreadReset — US-07 AC5", () => {
  const messages: ChatMessage[] = mergeMessages([], [
    serverMessage({ id: "m1", senderId: OTHER, createdAt: new Date("2026-08-09T10:00:01.000Z") }),
    serverMessage({ id: "m2", senderId: ME, createdAt: new Date("2026-08-09T10:00:02.000Z") }),
    serverMessage({
      id: "m3",
      senderId: null,
      kind: "SYSTEM",
      createdAt: new Date("2026-08-09T10:00:03.000Z"),
    }),
    serverMessage({ id: "m4", senderId: OTHER, createdAt: new Date("2026-08-09T10:00:04.000Z") }),
  ]);

  it("foreground + có tin mới ⇒ đánh dấu đã đọc tới tin mới nhất", () => {
    const d = computeUnreadReset({
      messages,
      currentUserId: ME,
      lastMarkedMessageId: null,
      foreground: true,
    });
    expect(d).toEqual({ shouldMark: true, lastReadMessageId: "m4", unreadCount: 0 });
  });

  it("đã đánh dấu tới tin mới nhất ⇒ không gọi server nữa (idempotent)", () => {
    const d = computeUnreadReset({
      messages,
      currentUserId: ME,
      lastMarkedMessageId: "m4",
      foreground: true,
    });
    expect(d.shouldMark).toBe(false);
    expect(d.unreadCount).toBe(0);
  });

  it("tab ẩn ⇒ không đánh dấu; đếm chưa đọc bỏ tin của mình và tin SYSTEM", () => {
    const d = computeUnreadReset({
      messages,
      currentUserId: ME,
      lastMarkedMessageId: null,
      foreground: false,
    });
    expect(d.shouldMark).toBe(false);
    expect(d.lastReadMessageId).toBeNull();
    expect(d.unreadCount).toBe(2); // m1 + m4 (m2 của mình, m3 SYSTEM)
  });

  it("bản optimistic không bao giờ trở thành lastReadMessageId (id tạm không được ghi vào DB)", () => {
    const withPending = mergeMessages(messages, [
      createOptimisticMessage({
        conversationId: CONV,
        clientMsgId: CLIENT_MSG_ID,
        senderId: ME,
        body: "đang gửi",
        now: new Date("2026-08-09T10:00:09.000Z"),
      }),
    ]);
    const d = computeUnreadReset({
      messages: withPending,
      currentUserId: ME,
      lastMarkedMessageId: null,
      foreground: true,
    });
    expect(d.lastReadMessageId).toBe("m4");
  });

  it("luồng chưa có tin server nào ⇒ không gọi markConversationRead", () => {
    const d = computeUnreadReset({
      messages: [],
      currentUserId: ME,
      lastMarkedMessageId: null,
      foreground: true,
    });
    expect(d.shouldMark).toBe(false);
  });
});

describe("lastSeenMessageId — mốc reconcile (AC2)", () => {
  it("bỏ qua bản optimistic ở cuối luồng", () => {
    const list = mergeMessages([], [
      serverMessage({ id: "m1", createdAt: new Date("2026-08-09T10:00:01.000Z") }),
      createOptimisticMessage({
        conversationId: CONV,
        clientMsgId: CLIENT_MSG_ID,
        senderId: ME,
        body: "đang gửi",
        now: new Date("2026-08-09T10:00:02.000Z"),
      }),
    ]);
    expect(lastSeenMessageId(list)).toBe("m1");
  });

  it("luồng rỗng ⇒ null (fetchMessagesSince trả từ tin đầu tiên)", () => {
    expect(lastSeenMessageId([])).toBeNull();
  });
});

describe("nextSendState — US-06 AC6 (tự thử lại 3 lần rồi cho gửi tay)", () => {
  it("gửi được ⇒ sent, không hẹn thử lại", () => {
    expect(nextSendState(startSend(), "ok")).toEqual({
      status: "sent",
      attempts: 1,
      retryDelayMs: null,
    });
  });

  it("mất mạng ⇒ tự thử lại đúng 3 lần với backoff tăng dần, rồi mới failed", () => {
    let state = startSend();
    const delays: (number | null)[] = [];

    for (let i = 0; i < MAX_AUTO_RETRIES; i++) {
      state = nextSendState(state, "retry");
      expect(state.status).toBe("sending"); // vẫn "đang gửi", chưa báo lỗi cho người dùng
      delays.push(state.retryDelayMs);
    }
    expect(delays).toEqual([...SEND_RETRY_BACKOFF_MS]);
    expect(state.attempts).toBe(1 + MAX_AUTO_RETRIES);

    // Lần hỏng thứ 4 (hết lượt tự động) → failed, chờ người dùng bấm gửi lại.
    state = nextSendState(state, "retry");
    expect(state.status).toBe("failed");
    expect(state.retryDelayMs).toBeNull();
  });

  it("lỗi nghiệp vụ (403/429/quá dài) ⇒ failed ngay, không thử lại vô ích", () => {
    const state = nextSendState(startSend(), "fatal");
    expect(state).toEqual({ status: "failed", attempts: 1, retryDelayMs: null });
  });

  it("bấm gửi lại sau failed ⇒ lại có đủ 3 lượt tự động", () => {
    const resumed = startSend();
    expect(nextSendState(resumed, "retry").status).toBe("sending");
    expect(resumed.attempts).toBe(1);
  });

  it("nội dung đã gõ không mất khi gửi hỏng (body nằm trong chính ChatMessage)", () => {
    const optimistic = createOptimisticMessage({
      conversationId: CONV,
      clientMsgId: CLIENT_MSG_ID,
      senderId: ME,
      body: "câu đang gõ dở",
    });
    const failed: ChatMessage = { ...optimistic, send: nextSendState(optimistic.send!, "fatal") };
    const list = mergeMessages([optimistic], [failed]);

    expect(list).toHaveLength(1);
    expect(list[0].body).toBe("câu đang gõ dở");
    expect(list[0].send?.status).toBe("failed");
  });
});

describe("parse payload broadcast (không tin cấu trúc)", () => {
  it("đọc đúng payload message.created thật của lib/chat/messages.ts", () => {
    const parsed = parseBroadcastMessage(broadcastPayload());
    expect(parsed?.id).toBe("msg-server-1");
    expect(parsed?.clientMsgId).toBe(CLIENT_MSG_ID);
    expect(normalizeIncomingMessage(parsed as IncomingMessage).createdAt.toISOString()).toBe(
      "2026-08-09T10:00:05.000Z",
    );
  });

  it("payload dị dạng ⇒ null (bỏ qua, reconcile sẽ lấy lại từ DB)", () => {
    expect(parseBroadcastMessage({})).toBeNull();
    expect(parseBroadcastMessage(broadcastPayload({ id: 123 }))).toBeNull();
    expect(parseBroadcastMessage(broadcastPayload({ createdAt: "không-phải-ngày" }))).toBeNull();
  });

  it("message.deleted chấp cả messageId lẫn id", () => {
    expect(parseMessageDeleted({ messageId: "m9" })).toBe("m9");
    expect(parseMessageDeleted({ id: "m9" })).toBe("m9");
    expect(parseMessageDeleted({})).toBeNull();
  });

  it("participant.removed đọc userId", () => {
    expect(parseParticipantRemoved({ userId: ME })).toBe(ME);
    expect(parseParticipantRemoved({ userId: 5 })).toBeNull();
  });

  it("conversation.bumped: đọc đúng 4 khoá của hợp đồng server", () => {
    const parsed = parseConversationBumped({
      conversationId: "conv-1",
      messageId: "msg-9",
      kind: "ANNOUNCEMENT",
      at: "2026-08-09T10:00:05.000Z",
    });
    expect(parsed).toEqual({
      conversationId: "conv-1",
      messageId: "msg-9",
      kind: "ANNOUNCEMENT",
      at: new Date("2026-08-09T10:00:05.000Z"),
    });
  });

  it("conversation.bumped: nhận cả kind DELETED (đường gỡ tin cũng bump)", () => {
    expect(
      parseConversationBumped({
        conversationId: "c",
        messageId: "m",
        kind: "DELETED",
        at: "2026-08-09T10:00:05.000Z",
      })?.kind,
    ).toBe("DELETED");
  });

  it("conversation.bumped dị dạng ⇒ null (thà bỏ tín hiệu còn hơn đoán bừa)", () => {
    const ok = {
      conversationId: "c",
      messageId: "m",
      kind: "CHAT",
      at: "2026-08-09T10:00:05.000Z",
    };
    expect(parseConversationBumped({})).toBeNull();
    expect(parseConversationBumped({ ...ok, conversationId: undefined })).toBeNull();
    expect(parseConversationBumped({ ...ok, messageId: 7 })).toBeNull();
    expect(parseConversationBumped({ ...ok, at: "không-phải-ngày" })).toBeNull();
  });
});
