// @vitest-environment node
/**
 * US-06 — `sendChatMessage`: gửi tin CHAT (F-SEND).
 *
 * Hai tầng, đúng khuôn `lib/actions/factory.ts`:
 *  • THUẦN — `checkConversationSendable` / `checkReplyTarget` / schema zod: quyết
 *    định mã lỗi từ dữ liệu đã đọc, không chạm DB.
 *  • PIPELINE — gọi `sendChatMessageAsActor(actor, name, input)` (lõi của Server
 *    Action, nhận Actor đã resolve ⇒ test không cần HTTP/next-auth). DB được mock
 *    ở mức Prisma client nên chạy được ở MỌI máy, kể cả không có Postgres local
 *    (nghiệm thu DB thật nằm ở scripts/_zztest-chat-us06.ts).
 *
 * Điểm phải giữ bằng mọi giá:
 *  • ARCHIVED và "không phải thành viên" là HAI mã lỗi KHÁC NHAU (AC1 / TS-03.7a)
 *    — client cần phân biệt "lớp đã kết thúc" với "bạn không còn trong nhóm".
 *  • Broadcast hỏng KHÔNG được làm hỏng việc gửi tin (AC3 / TS-12).
 *  • Gửi lại cùng `clientMsgId` = trả tin cũ, KHÔNG tạo tin thứ hai và KHÔNG tăng
 *    unreadCount lần nữa (AC4 / TS-10.4).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock hạ tầng (hoisted — vi.mock chạy trước mọi import) ──────────────────
const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    ctxRow: null as Row | null,
    existing: null as Row | null,
    reply: null as Row | null,
    seq: 0,
    attSeq: 0,
    created: [] as Row[],
    attachments: [] as Row[],
    convUpdates: [] as Row[],
    unreadUpdates: [] as Row[],
    recipientQueries: [] as Row[],
    /** Thành viên hội thoại — nguồn dữ liệu THẬT cho `conversationParticipant.findMany`. */
    participants: [] as { userId: string; leftAt: Date | null }[],
    txOptions: null as Row | null,
    txCalls: 0,
    /** true trong lúc callback của `$transaction` đang chạy — dùng để chứng minh
     *  `MessageAttachment` được ghi TRONG tx, không phải sau khi tx đã đóng. */
    insideTx: false,
  };
  const mockDb: Record<string, unknown> = {
    $extends: () => mockDb,
    $queryRaw: vi.fn(async () => (state.ctxRow ? [state.ctxRow] : [])),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>, opts?: Row) => {
      state.txCalls += 1;
      state.txOptions = opts ?? null;
      state.insideTx = true;
      try {
        return await fn(mockDb);
      } finally {
        state.insideTx = false;
      }
    }),
    messageAttachment: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        state.attSeq += 1;
        const row = { id: `att-${state.attSeq}`, insideTx: state.insideTx, ...data };
        state.attachments.push(row);
        return {
          id: row.id,
          fileName: data.fileName,
          mimeType: data.mimeType,
          sizeBytes: data.sizeBytes,
        };
      }),
      findMany: vi.fn(async () => []),
    },
    message: {
      findFirst: vi.fn(async () => state.existing),
      findUnique: vi.fn(async () => state.reply),
      create: vi.fn(async ({ data }: { data: Row }) => {
        state.seq += 1;
        const row = {
          id: `msg-${state.seq}`,
          createdAt: new Date("2026-08-09T03:00:00.000Z"),
          replyToId: null,
          ...data,
        };
        state.created.push(row);
        return row;
      }),
    },
    conversation: {
      update: vi.fn(async (args: Row) => {
        state.convUpdates.push(args);
        return {};
      }),
    },
    conversationParticipant: {
      updateMany: vi.fn(async (args: Row) => {
        state.unreadUpdates.push(args);
        return { count: 1 };
      }),
      // Người nhận `conversation.bumped` (topic `user:{id}`) — đọc TRONG cùng tx, ngay
      // sau `updateMany`, với đúng điều kiện `leftAt: null` + loại người gửi.
      // Mock LỌC THẬT theo `where` (không trả mảng cứng): bỏ một điều kiện trong code là
      // người không đáng nhận lọt thẳng vào mảng broadcast — test đỏ vì HÀNH VI, không
      // phải vì hình dạng đối số.
      findMany: vi.fn(async (args: Row) => {
        state.recipientQueries.push({ ...args, insideTx: state.insideTx });
        const where = (args.where ?? {}) as { leftAt?: unknown; userId?: { not?: string } };
        return state.participants
          .filter((p) => (where.leftAt === null ? p.leftAt === null : true))
          .filter((p) => (where.userId?.not ? p.userId !== where.userId.not : true))
          .map((p) => ({ userId: p.userId }));
      }),
    },
  };
  return {
    state,
    mockDb,
    broadcast: vi.fn(async () => true),
    writeAudit: vi.fn(async () => ({})),
  };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.writeAudit }));
// `broadcastMessages` là primitive DUY NHẤT gọi HTTP (1 POST mang cả topic `conv:` lẫn
// N topic `user:`); hai builder còn lại là hàm THUẦN nên dựng lại y hệt bản thật ở đây
// để test soi được hình dạng mảng gửi đi.
vi.mock("@/lib/chat/broadcast", () => ({
  broadcastMessages: h.broadcast,
  conversationBroadcast: (
    conversationId: string,
    event: string,
    payload: Record<string, unknown>,
  ) => ({ topic: `conv:${conversationId}`, event, payload, private: true }),
  userBumpBroadcasts: (userIds: readonly string[], payload: Record<string, unknown>) =>
    userIds.map((id) => ({
      topic: `user:${id}`,
      event: "conversation.bumped",
      payload,
      private: true,
    })),
}));
// Không kéo next-auth vào test node (lõi nhận Actor seed, không cần phiên thật).
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import { buildActor, type UserOrgRoleRow } from "@/lib/auth/actor";
import type { OrgUnitNode } from "@/lib/org/types";
import { ROLE_SEED } from "../../prisma/seed-roles";
import {
  chatAttachmentPrefix,
  checkAttachmentPaths,
  checkConversationSendable,
  checkReplyTarget,
  sendChatMessageAsActor,
  sendChatMessageSchema,
  CHAT_SEND_RATE_MAX,
} from "./messages";

// ─── Actor seed (cùng khuôn lib/auth/chat-permissions.test.ts) ───────────────
const ORG: OrgUnitNode[] = [
  { id: "root", code: "SATAROBO", type: "ROOT", parentId: null, centerId: null },
  { id: "ho", code: "HO", type: "HO", parentId: "root", centerId: null },
  { id: "cs1", code: "CS1", type: "CENTER", parentId: "root", centerId: "c1" },
  { id: "cs2", code: "CS2", type: "CENTER", parentId: "root", centerId: "c2" },
];
const PAST = new Date("2000-01-01");

function seedPermsOf(code: string): UserOrgRoleRow["role"]["permissions"] {
  const r = ROLE_SEED.find((x) => x.code === code);
  if (!r) throw new Error(`ROLE_SEED thiếu RoleDef ${code}`);
  return r.perms.map((p) => ({ action: p.action, scopeType: p.scopeType }));
}

/** userId RIÊNG cho mỗi test — rate limiter là Map theo user, dùng chung sẽ dính nhau. */
function actorOf(code: string, orgUnitId: string, userId: string, classes?: string[]) {
  return buildActor({
    userId,
    rows: [
      {
        orgUnitId,
        status: "ACTIVE",
        effectiveFrom: PAST,
        effectiveTo: null,
        role: { code, isActive: true, permissions: seedPermsOf(code) },
      },
    ],
    orgNodes: ORG,
    assignedClassIds: classes,
    now: new Date("2026-08-09"),
  });
}

const CONV = "11111111-1111-4111-8111-111111111111";
const CONV_KHAC = "22222222-2222-4222-8222-222222222222";
const MSG_KHAC = "33333333-3333-4333-8333-333333333333";
const cid = (n: number) => `44444444-4444-4444-8444-4444444444${String(n).padStart(2, "0")}`;

type CtxRow = Record<string, unknown>;
function ctxRow(over: CtxRow = {}): CtxRow {
  return {
    conversationId: CONV,
    status: "ACTIVE",
    centerId: "c1",
    orgUnitId: "cs1",
    subjectType: "CLASS",
    subjectId: "lopA",
    createdById: null,
    participantId: "part-1",
    participantLeftAt: null,
    ...over,
  };
}

/** Một phần tử trong mảng `messages` của lời gọi `broadcastMessages`. */
type BroadcastCall = { topic: string; event: string; payload: Record<string, unknown> };

/** Mảng gửi đi ở lời gọi broadcast thứ `n` (mặc định lời gọi đầu). */
function sentBroadcasts(n = 0): BroadcastCall[] {
  return (h.broadcast.mock.calls[n] as unknown as [BroadcastCall[]])[0];
}

function input(over: Record<string, unknown> = {}) {
  return {
    conversationId: CONV,
    body: "Chào cả nhà",
    clientMsgId: cid(1),
    ...over,
  };
}

beforeEach(() => {
  h.state.ctxRow = ctxRow();
  h.state.existing = null;
  h.state.reply = null;
  h.state.seq = 0;
  h.state.attSeq = 0;
  h.state.created = [];
  h.state.attachments = [];
  h.state.convUpdates = [];
  h.state.unreadUpdates = [];
  h.state.recipientQueries = [];
  h.state.participants = [
    { userId: "ph-khac", leftAt: null },
    { userId: "gv-lopA", leftAt: null },
  ];
  h.state.txOptions = null;
  h.state.txCalls = 0;
  h.state.insideTx = false;
  h.broadcast.mockClear();
  h.broadcast.mockImplementation(async () => true);
  h.writeAudit.mockClear();
  // Ép rate limiter về nhánh in-memory (không bắn HTTP tới Upstash trong unit test).
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

// ═════════════════════════════════════════════════════════════════════════════
// TẦNG THUẦN
// ═════════════════════════════════════════════════════════════════════════════

describe("[US-06] schema — chặn nội dung sai từ server (AC5)", () => {
  it("body > 4000 ký tự → VALIDATION (AC5: chặn ở CẢ server, không tin client)", () => {
    const res = sendChatMessageSchema.safeParse(input({ body: "a".repeat(4001) }));
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path.join(".")).toBe("body");
  });

  it("body đúng 4000 ký tự → hợp lệ (biên không bị lệch 1)", () => {
    expect(sendChatMessageSchema.safeParse(input({ body: "a".repeat(4000) })).success).toBe(true);
  });

  it("body toàn khoảng trắng → VALIDATION (trim trước khi đo độ dài)", () => {
    expect(sendChatMessageSchema.safeParse(input({ body: "   \n\t  " })).success).toBe(false);
  });

  it("body được trim trước khi ghi (không lưu khoảng trắng thừa)", () => {
    const res = sendChatMessageSchema.safeParse(input({ body: "  xin chào  " }));
    expect(res.success).toBe(true);
    expect(res.data?.body).toBe("xin chào");
  });

  it("clientMsgId không phải UUID → VALIDATION (idempotency dựa trên khoá này)", () => {
    expect(sendChatMessageSchema.safeParse(input({ clientMsgId: "abc" })).success).toBe(false);
  });
});

describe("[US-06] checkConversationSendable — mã lỗi PHÂN BIỆT (AC1 / TS-03.7)", () => {
  it("không phải thành viên (không có bản ghi participant) → NOT_PARTICIPANT", () => {
    expect(
      checkConversationSendable(ctxRow({ participantId: null }) as never)?.code,
    ).toBe("NOT_PARTICIPANT");
  });

  it("đã rời nhóm (leftAt đã set) → NOT_PARTICIPANT, không có ân hạn", () => {
    expect(
      checkConversationSendable(ctxRow({ participantLeftAt: new Date() }) as never)?.code,
    ).toBe("NOT_PARTICIPANT");
  });

  it("hội thoại không tồn tại → NOT_PARTICIPANT (không lộ hội thoại có tồn tại hay không)", () => {
    expect(checkConversationSendable(null)?.code).toBe("NOT_PARTICIPANT");
  });

  it("ARCHIVED → CONVERSATION_ARCHIVED, KHÁC mã 'không phải thành viên' [TS-03.7a]", () => {
    const err = checkConversationSendable(ctxRow({ status: "ARCHIVED" }) as never);
    expect(err?.code).toBe("CONVERSATION_ARCHIVED");
    expect(err?.code).not.toBe("NOT_PARTICIPANT");
    expect(err?.message).toMatch(/kết thúc|lưu trữ/i);
  });

  it("LOCKED → CONVERSATION_LOCKED [TS-03.7b]", () => {
    expect(checkConversationSendable(ctxRow({ status: "LOCKED" }) as never)?.code).toBe(
      "CONVERSATION_LOCKED",
    );
  });

  it("ACTIVE + thành viên hiệu lực → không lỗi", () => {
    expect(checkConversationSendable(ctxRow() as never)).toBeNull();
  });

  it("đã rời VÀ hội thoại ARCHIVED → ưu tiên NOT_PARTICIPANT (thứ tự F-SEND bước 2 trước bước 3)", () => {
    expect(
      checkConversationSendable(
        ctxRow({ participantLeftAt: new Date(), status: "ARCHIVED" }) as never,
      )?.code,
    ).toBe("NOT_PARTICIPANT");
  });
});

describe("[US-06] checkReplyTarget — reply 1 cấp, không xuyên hội thoại", () => {
  it("tin gốc cùng hội thoại → hợp lệ", () => {
    expect(checkReplyTarget(CONV, { conversationId: CONV })).toBeNull();
  });

  it("tin gốc thuộc hội thoại KHÁC → REPLY_NOT_IN_CONVERSATION (chống trích dẫn xuyên nhóm)", () => {
    expect(checkReplyTarget(CONV, { conversationId: CONV_KHAC })?.code).toBe(
      "REPLY_NOT_IN_CONVERSATION",
    );
  });

  it("tin gốc không tồn tại → REPLY_NOT_IN_CONVERSATION", () => {
    expect(checkReplyTarget(CONV, null)?.code).toBe("REPLY_NOT_IN_CONVERSATION");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// US-11 — ĐÍNH KÈM ẢNH (tầng thuần)
// ═════════════════════════════════════════════════════════════════════════════

/** Key R2 hợp lệ của MỘT hội thoại — cùng khuôn `buildChatAttachmentKey` sinh ra. */
const keyOf = (conv: string, n = 1) => `chat-attachments/${conv}/2026-08/anh-${n}.jpg`;

function att(over: Record<string, unknown> = {}) {
  return {
    storagePath: keyOf(CONV),
    fileName: "buoi-hoc.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 123_456,
    ...over,
  };
}

describe("[US-11] chatAttachmentPrefix — suy tiền tố từ chính hàm dựng key", () => {
  it("trả đúng tiền tố của hội thoại đang gửi", () => {
    expect(chatAttachmentPrefix(CONV)).toBe(`chat-attachments/${CONV}/`);
  });

  it("hai hội thoại khác nhau ⇒ hai tiền tố khác nhau (nền của mọi kiểm tra bên dưới)", () => {
    expect(chatAttachmentPrefix(CONV)).not.toBe(chatAttachmentPrefix(CONV_KHAC));
  });

  it("conversationId dị dạng (có dấu /) → null ⇒ caller phải TỪ CHỐI, không đoán bừa", () => {
    expect(chatAttachmentPrefix("../../etc")).toBeNull();
  });
});

describe("[US-11][AC1] checkAttachmentPaths — chống gán ảnh của hội thoại KHÁC", () => {
  it("không có ảnh → không lỗi (đường thường của mọi tin chữ)", () => {
    expect(checkAttachmentPaths(CONV, [])).toBeNull();
  });

  it("key đúng tiền tố hội thoại đang gửi → hợp lệ", () => {
    expect(checkAttachmentPaths(CONV, [att(), att({ storagePath: keyOf(CONV, 2) })])).toBeNull();
  });

  it("⭐ key của hội thoại KHÁC → ATTACHMENT_PATH_MISMATCH (chống đọc chéo ảnh)", () => {
    const err = checkAttachmentPaths(CONV, [att({ storagePath: keyOf(CONV_KHAC) })]);
    expect(err?.code).toBe("ATTACHMENT_PATH_MISMATCH");
  });

  it("⭐ một ảnh hợp lệ + một ảnh của hội thoại khác → vẫn chặn CẢ tin", () => {
    expect(
      checkAttachmentPaths(CONV, [att(), att({ storagePath: keyOf(CONV_KHAC, 9) })])?.code,
    ).toBe("ATTACHMENT_PATH_MISMATCH");
  });

  it("key chui ra ngoài bằng '..' → ATTACHMENT_PATH_MISMATCH", () => {
    expect(
      checkAttachmentPaths(CONV, [
        att({ storagePath: `chat-attachments/${CONV}/../${CONV_KHAC}/2026-08/x.jpg` }),
      ])?.code,
    ).toBe("ATTACHMENT_PATH_MISMATCH");
  });

  it("tiền tố chỉ TRÙNG MỘT PHẦN (id hội thoại khác bắt đầu bằng id này) → vẫn chặn", () => {
    expect(
      checkAttachmentPaths(CONV, [att({ storagePath: `chat-attachments/${CONV}x/2026-08/x.jpg` }),
      ])?.code,
    ).toBe("ATTACHMENT_PATH_MISMATCH");
  });

  it("mime ngoài gói cắt (pdf/heic) → ATTACHMENT_UNSUPPORTED_TYPE, mã KHÁC path mismatch", () => {
    const err = checkAttachmentPaths(CONV, [att({ mimeType: "application/pdf" })]);
    expect(err?.code).toBe("ATTACHMENT_UNSUPPORTED_TYPE");
    expect(err?.code).not.toBe("ATTACHMENT_PATH_MISMATCH");
  });
});

describe("[US-11][AC1] schema — trần 5 ảnh + tin chỉ có ảnh", () => {
  it("6 ảnh → VALIDATION (trần 5 ảnh/tin, khớp CHAT_IMAGE_RULES)", () => {
    const res = sendChatMessageSchema.safeParse(
      input({ attachments: Array.from({ length: 6 }, (_, i) => att({ storagePath: keyOf(CONV, i) })) }),
    );
    expect(res.success).toBe(false);
  });

  it("5 ảnh → hợp lệ (biên không lệch 1)", () => {
    const res = sendChatMessageSchema.safeParse(
      input({ attachments: Array.from({ length: 5 }, (_, i) => att({ storagePath: keyOf(CONV, i) })) }),
    );
    expect(res.success).toBe(true);
  });

  it("QUYẾT ĐỊNH US-11: body rỗng + ≥1 ảnh → HỢP LỆ (gửi ảnh không kèm chữ)", () => {
    const res = sendChatMessageSchema.safeParse(input({ body: "   ", attachments: [att()] }));
    expect(res.success).toBe(true);
    expect(res.data?.body).toBe("");
  });

  it("body rỗng + KHÔNG ảnh → VALIDATION ở field body (không đẻ tin rỗng)", () => {
    const res = sendChatMessageSchema.safeParse(input({ body: "   ", attachments: [] }));
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path.join(".")).toBe("body");
  });

  it("ảnh vượt 10MB → VALIDATION (client sửa số cũng không lách được)", () => {
    expect(
      sendChatMessageSchema.safeParse(
        input({ attachments: [att({ sizeBytes: 10 * 1024 * 1024 + 1 })] }),
      ).success,
    ).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TẦNG PIPELINE — runAction qua sendChatMessageAsActor (Actor seed, không HTTP)
// ═════════════════════════════════════════════════════════════════════════════

describe("[US-06] đường thành công (AC2 + AC3)", () => {
  it("PH gửi tin: 1 Message CHAT + lastMessageAt + unreadCount +1 cho MỌI người trừ người gửi", async () => {
    const actor = actorOf("PARENT", "cs1", "ph-ok");
    const res = await sendChatMessageAsActor(actor, "PH Test", input());

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.body).toBe("Chào cả nhà");
    expect(res.data.kind).toBe("CHAT");
    expect(res.data.senderId).toBe("ph-ok");
    expect(res.data.clientMsgId).toBe(cid(1));

    // Ghi đúng 1 tin, kind=CHAT, senderId = người gửi.
    expect(h.state.created).toHaveLength(1);
    expect(h.state.created[0]).toMatchObject({ kind: "CHAT", senderId: "ph-ok" });

    // lastMessageAt cập nhật theo đúng thời điểm tin.
    expect(h.state.convUpdates).toHaveLength(1);

    // unreadCount: +1, loại trừ người gửi + người đã rời.
    expect(h.state.unreadUpdates).toHaveLength(1);
    const where = (h.state.unreadUpdates[0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ conversationId: CONV, leftAt: null });
    expect(where.userId).toEqual({ not: "ph-ok" });
    const data = (h.state.unreadUpdates[0] as { data: Record<string, unknown> }).data;
    expect(data).toEqual({ unreadCount: { increment: 1 } });
  });

  it("transaction đặt timeout 30s / maxWait 10s (luật E-bis #2 — trần 5s mặc định đứt giữa chừng)", async () => {
    const actor = actorOf("PARENT", "cs1", "ph-tx");
    await sendChatMessageAsActor(actor, "PH Test", input());
    expect(h.state.txOptions).toEqual({ timeout: 30_000, maxWait: 10_000 });
  });

  it("broadcast SAU commit, event message.created, payload có clientMsgId để client khử trùng (AC4)", async () => {
    const actor = actorOf("PARENT", "cs1", "ph-bc");
    await sendChatMessageAsActor(actor, "PH Test", input());

    expect(h.broadcast).toHaveBeenCalledTimes(1);
    const conv = sentBroadcasts()[0] as BroadcastCall;
    expect(conv.topic).toBe(`conv:${CONV}`);
    expect(conv.event).toBe("message.created");
    expect(conv.payload.clientMsgId).toBe(cid(1));
    expect(conv.payload.id).toBe("msg-1");
  });

  it("người nhận bump đọc TRONG tx, đúng điều kiện leftAt=null + loại người gửi", async () => {
    const actor = actorOf("PARENT", "cs1", "ph-recip");
    await sendChatMessageAsActor(actor, "PH Test", input());

    expect(h.state.recipientQueries).toHaveLength(1);
    const where = (h.state.recipientQueries[0] as { where: Record<string, unknown> }).where;
    expect(where.conversationId).toBe(CONV);
    expect(where.leftAt).toBeNull();
    expect(where.userId).toEqual({ not: "ph-recip" });
  });

  it("danh sách người nhận đọc TRONG transaction — không có cửa sổ đua với `leftAt`", async () => {
    // `updateMany` ngay trước đó đã khoá đúng các dòng này; một tx khác đang set `leftAt`
    // phải chờ ta commit. Đọc SAU khi tx đóng là mở lại đúng cửa sổ đua đó.
    const actor = actorOf("PARENT", "cs1", "ph-intx");
    await sendChatMessageAsActor(actor, "PH Test", input());

    expect(h.state.recipientQueries).toHaveLength(1);
    expect((h.state.recipientQueries[0] as { insideTx: boolean }).insideTx).toBe(true);
  });

  it("MỘT POST duy nhất: 1 phần tử conv: + N phần tử user:{id} event conversation.bumped, KHÔNG kèm nội dung tin (BR-30)", async () => {
    const actor = actorOf("PARENT", "cs1", "ph-bump");
    await sendChatMessageAsActor(actor, "PH Test", input());

    // Đúng 1 lời gọi HTTP dù có N người nhận — không lặp N call.
    expect(h.broadcast).toHaveBeenCalledTimes(1);
    const all = sentBroadcasts();
    expect(all).toHaveLength(3); // 1 conv + 2 người nhận (mock findMany)
    const bumps = all.filter((m) => m.topic.startsWith("user:"));
    expect(bumps.map((m) => m.topic)).toEqual(["user:ph-khac", "user:gv-lopA"]);
    for (const b of bumps) {
      expect(b.event).toBe("conversation.bumped");
      expect(Object.keys(b.payload).sort()).toEqual(["at", "conversationId", "kind", "messageId"]);
      expect(b.payload.kind).toBe("CHAT");
      expect(JSON.stringify(b.payload)).not.toContain("Chào cả nhà");
    }
  });

  it("người ĐÃ RỜI nhóm và CHÍNH người gửi KHÔNG nhận bump (lọc thật, không chỉ soi đối số)", async () => {
    h.state.participants = [
      { userId: "ph-khac", leftAt: null },
      { userId: "gv-lopA", leftAt: null },
      // Chuyển lớp / gỡ phân công — kênh `user:{id}` của họ không được kêu nữa.
      { userId: "ph-da-roi", leftAt: new Date("2026-07-01T00:00:00.000Z") },
      // Người gửi: client của họ đã có tin (optimistic + kênh `conv:`), bump lại là thừa.
      { userId: "ph-loc", leftAt: null },
    ];

    const actor = actorOf("PARENT", "cs1", "ph-loc");
    await sendChatMessageAsActor(actor, "PH Test", input());

    const topics = sentBroadcasts()
      .filter((m) => m.topic.startsWith("user:"))
      .map((m) => m.topic);
    expect(topics).toEqual(["user:ph-khac", "user:gv-lopA"]);
    expect(topics).not.toContain("user:ph-da-roi");
    expect(topics).not.toContain("user:ph-loc");
  });

  it("không còn ai khác trong nhóm → chỉ 1 phần tử conv:, không có bump rỗng", async () => {
    h.state.participants = [{ userId: "ph-mot-minh", leftAt: null }];

    const actor = actorOf("PARENT", "cs1", "ph-mot-minh");
    await sendChatMessageAsActor(actor, "PH Test", input());

    const all = sentBroadcasts();
    expect(all).toHaveLength(1);
    expect(all[0]?.topic).toBe(`conv:${CONV}`);
  });

  it("ghi AuditLog module=chat / entityType=Message / action=CREATE, KHÔNG kèm nội dung tin", async () => {
    const actor = actorOf("PARENT", "cs1", "ph-audit");
    await sendChatMessageAsActor(actor, "PH Test", input());

    expect(h.writeAudit).toHaveBeenCalledTimes(1);
    const arg = (h.writeAudit.mock.calls as unknown as Record<string, unknown>[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(arg).toMatchObject({ module: "chat", entityType: "Message", action: "CREATE" });
    expect(JSON.stringify(arg.newValues)).not.toContain("Chào cả nhà");
  });

  it("GV lớp mình dạy gửi được (scope ASSIGNED)", async () => {
    const actor = actorOf("TEACHER", "cs1", "gv-ok", ["lopA"]);
    const res = await sendChatMessageAsActor(actor, "GV Test", input());
    expect(res.ok).toBe(true);
  });

  /**
   * F5 (mở phạm vi 10/08/2026) VIẾT LẠI CA NÀY. Bản cũ pin "Sale → 403 ở MỌI endpoint
   * chat", đúng với phạm vi cũ khi Sale không giữ action chat nào. Nay Sale có
   * `chat:read`/`chat:send` scope **OWN** cho kênh 1-1 với phụ huynh mình phụ trách, nên
   * điều cần ghim đổi thành: **Sale KHÔNG gửi được vào NHÓM LỚP**.
   *
   * ⚠️ Fixture phải để `participantId: null` mới phản ánh đời thật: Sale KHÔNG BAO GIỜ là
   * thành viên nhóm lớp (`computeDerivedMembership` chỉ dẫn xuất GV/trợ giảng/PH/QLCS).
   * Bản cũ để `participantId: "part-1"` — tức giả định Sale đã là thành viên, tình huống
   * không tồn tại — và chính giả định đó làm `sendTargetOf` gán `createdById = chính
   * mình` khiến scope OWN khớp. Ghim sai fixture thì test đo một thế giới không có thật.
   */
  it("[TS-01.6][F5] Sale KHÔNG gửi được vào nhóm lớp → PERMISSION_DENIED, không ghi tin nào", async () => {
    h.state.ctxRow = ctxRow({ participantId: null, createdById: "nguoi-tao-nhom" });
    const actor = actorOf("CENTER_SALES_CSM", "cs1", "sale-1");
    const res = await sendChatMessageAsActor(actor, "Sale Test", input());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("PERMISSION_DENIED");
    expect(h.state.created).toHaveLength(0);
  });
});

describe("[US-06] guard qua pipeline — đúng mã lỗi, không ghi gì vào DB", () => {
  it("người đã rời nhóm → NOT_PARTICIPANT [TS-03.8]", async () => {
    h.state.ctxRow = ctxRow({ participantLeftAt: new Date() });
    const actor = actorOf("PARENT", "cs1", "ph-left");
    const res = await sendChatMessageAsActor(actor, "PH Test", input());

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_PARTICIPANT");
    expect(h.state.created).toHaveLength(0);
    expect(h.state.txCalls).toBe(0);
    expect(h.broadcast).not.toHaveBeenCalled();
  });

  it("hội thoại ARCHIVED → CONVERSATION_ARCHIVED [TS-03.7a]", async () => {
    h.state.ctxRow = ctxRow({ status: "ARCHIVED" });
    const actor = actorOf("PARENT", "cs1", "ph-arch");
    const res = await sendChatMessageAsActor(actor, "PH Test", input());

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("CONVERSATION_ARCHIVED");
    expect(h.state.created).toHaveLength(0);
  });

  it("hội thoại LOCKED → CONVERSATION_LOCKED, kể cả GV [TS-03.7b]", async () => {
    h.state.ctxRow = ctxRow({ status: "LOCKED" });
    const actor = actorOf("TEACHER", "cs1", "gv-lock", ["lopA"]);
    const res = await sendChatMessageAsActor(actor, "GV Test", input());

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("CONVERSATION_LOCKED");
  });

  it("replyToId thuộc hội thoại khác → REPLY_NOT_IN_CONVERSATION, không ghi tin", async () => {
    h.state.reply = { id: MSG_KHAC, conversationId: CONV_KHAC };
    const actor = actorOf("PARENT", "cs1", "ph-reply");
    const res = await sendChatMessageAsActor(actor, "PH Test", input({ replyToId: MSG_KHAC }));

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("REPLY_NOT_IN_CONVERSATION");
    expect(h.state.created).toHaveLength(0);
  });

  it("body quá 4000 ký tự qua pipeline → VALIDATION ở field body (AC5)", async () => {
    const actor = actorOf("PARENT", "cs1", "ph-long");
    const res = await sendChatMessageAsActor(actor, "PH Test", input({ body: "a".repeat(4001) }));

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION");
    expect(res.error.field).toBe("body");
    expect(h.state.created).toHaveLength(0);
  });
});

describe("[US-06][AC1] rate limit 20 tin/phút/user", () => {
  it(`tin thứ ${CHAT_SEND_RATE_MAX + 1} trong 1 phút → RATE_LIMITED, thông điệp tiếng Việt`, async () => {
    const actor = actorOf("PARENT", "cs1", "ph-rate");
    for (let i = 0; i < CHAT_SEND_RATE_MAX; i++) {
      const res = await sendChatMessageAsActor(actor, "PH Test", input({ clientMsgId: cid(i) }));
      expect(res.ok).toBe(true);
    }
    const res = await sendChatMessageAsActor(
      actor,
      "PH Test",
      input({ clientMsgId: cid(90) }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("RATE_LIMITED");
    expect(res.error.message).toMatch(/quá nhanh|thử lại/i);
    expect(h.state.created).toHaveLength(CHAT_SEND_RATE_MAX); // tin thứ 21 KHÔNG vào DB
  });
});

describe("[US-06][AC4] idempotency theo clientMsgId (TS-10.4)", () => {
  it("gửi lại cùng clientMsgId → trả CHÍNH tin cũ, không tạo tin thứ hai, unreadCount không tăng lần nữa", async () => {
    h.state.existing = {
      id: "msg-cu",
      conversationId: CONV,
      senderId: "ph-idem",
      kind: "CHAT",
      body: "Chào cả nhà",
      replyToId: null,
      clientMsgId: cid(1),
      createdAt: new Date("2026-08-09T02:00:00.000Z"),
    };
    const actor = actorOf("PARENT", "cs1", "ph-idem");
    const res = await sendChatMessageAsActor(actor, "PH Test", input());

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.id).toBe("msg-cu");
    expect(h.state.created).toHaveLength(0); // KHÔNG tạo tin mới
    expect(h.state.unreadUpdates).toHaveLength(0); // KHÔNG tăng unread lần 2
    expect(h.state.convUpdates).toHaveLength(0);
    expect(h.state.txCalls).toBe(0);
  });
});

describe("[US-11] gửi tin kèm ảnh qua pipeline", () => {
  it("2 ảnh → 2 MessageAttachment gắn ĐÚNG messageId, ghi TRONG CHÍNH transaction gửi tin", async () => {
    const actor = actorOf("PARENT", "cs1", "ph-att");
    const res = await sendChatMessageAsActor(
      actor,
      "PH Test",
      input({ attachments: [att(), att({ storagePath: keyOf(CONV, 2), fileName: "b.png", mimeType: "image/png" })] }),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(h.state.created).toHaveLength(1);
    expect(h.state.attachments).toHaveLength(2);

    const msgId = (h.state.created[0] as { id: string }).id;
    for (const a of h.state.attachments) {
      expect((a as { messageId: string }).messageId).toBe(msgId);
      // ⭐ Bất biến sống còn: attachment KHÔNG được ghi ngoài transaction — tin rollback
      // mà attachment còn lại là rác trỏ vào messageId không tồn tại.
      expect((a as { insideTx: boolean }).insideTx).toBe(true);
    }

    // Action trả về id ảnh để client đổi lấy signed GET URL (bước 3 F-FILE).
    expect(res.data.attachments.map((a) => a.id)).toEqual(["att-1", "att-2"]);
    expect(res.data.attachments[0]?.mimeType).toBe("image/jpeg");
    expect(res.data.attachments[1]?.mimeType).toBe("image/png");
  });

  it("tin CHỈ CÓ ẢNH (body rỗng) gửi được — quyết định US-11", async () => {
    const actor = actorOf("PARENT", "cs1", "ph-att-only");
    const res = await sendChatMessageAsActor(actor, "PH Test", input({ body: "", attachments: [att()] }));

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.body).toBe("");
    expect(h.state.attachments).toHaveLength(1);
  });

  it("⭐ storagePath của hội thoại KHÁC → ATTACHMENT_PATH_MISMATCH, KHÔNG mở tx, KHÔNG ghi gì", async () => {
    const actor = actorOf("PARENT", "cs1", "ph-att-x");
    const res = await sendChatMessageAsActor(
      actor,
      "PH Test",
      input({ attachments: [att({ storagePath: keyOf(CONV_KHAC) })] }),
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("ATTACHMENT_PATH_MISMATCH");
    expect(h.state.created).toHaveLength(0);
    expect(h.state.attachments).toHaveLength(0);
    expect(h.state.txCalls).toBe(0);
    expect(h.broadcast).not.toHaveBeenCalled();
  });

  it("broadcast mang theo danh sách ảnh nhưng KHÔNG mang URL đã ký", async () => {
    const actor = actorOf("PARENT", "cs1", "ph-att-bc");
    await sendChatMessageAsActor(actor, "PH Test", input({ attachments: [att()] }));

    const payload = sentBroadcasts()[0]!.payload;
    expect(payload.attachments).toEqual([
      { id: "att-1", fileName: "buoi-hoc.jpg", mimeType: "image/jpeg", sizeBytes: 123_456 },
    ]);
    // URL đã ký sống 5 phút và ai nghe được topic cũng dùng được ⇒ không bao giờ broadcast.
    expect(JSON.stringify(payload)).not.toContain("http");
    expect(JSON.stringify(payload)).not.toContain("storagePath");
  });

  it("AuditLog ghi SỐ LƯỢNG ảnh, không ghi key kho ảnh", async () => {
    const actor = actorOf("PARENT", "cs1", "ph-att-audit");
    await sendChatMessageAsActor(actor, "PH Test", input({ attachments: [att(), att({ storagePath: keyOf(CONV, 2) })] }));

    const arg = (h.writeAudit.mock.calls as unknown as Record<string, unknown>[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect((arg.newValues as Record<string, unknown>).attachmentCount).toBe(2);
    expect(JSON.stringify(arg.newValues)).not.toContain("chat-attachments/");
  });
});

describe("[US-06][AC3][TS-12] broadcast hỏng KHÔNG làm hỏng việc gửi tin", () => {
  it("broadcast trả false (Realtime chết/401) → tin vẫn ghi, action vẫn ok", async () => {
    h.broadcast.mockImplementation(async () => false);
    const actor = actorOf("PARENT", "cs1", "ph-bc-false");
    const res = await sendChatMessageAsActor(actor, "PH Test", input());

    expect(res.ok).toBe(true);
    expect(h.state.created).toHaveLength(1);
  });

  it("broadcast NÉM lỗi (vi phạm hợp đồng) → vẫn ok, tin vẫn còn (phòng thủ 2 lớp)", async () => {
    h.broadcast.mockImplementation(async () => {
      throw new Error("realtime sập");
    });
    const actor = actorOf("PARENT", "cs1", "ph-bc-throw");
    const res = await sendChatMessageAsActor(actor, "PH Test", input());

    expect(res.ok).toBe(true);
    expect(h.state.created).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// US-15 AC4 — "Admin HO chỉ ĐỌC hội thoại mình không thuộc về".
//
// Vì sao phải pin ở TẦNG NÀY chứ không ở `can()`: `can()` v2 trả `true` ngay dòng đầu
// cho SUPER_ADMIN (`lib/auth/can.ts` — `if (actor.isSuperAdmin) return true`), và seed
// còn cấp thẳng `chat:send` GLOBAL cho vai đó. Nghĩa là cổng QUYỀN không chặn nổi một
// chữ nào ở đây; chốt chặn DUY NHẤT là `checkConversationSendable` trong chính action.
// Ai gỡ nó đi thì mọi test quyền vẫn xanh — nên bốn ô dưới đây là nơi duy nhất bắt được.
//
// Nghiệm thu trên DB thật: tests/chat/permission-matrix.spec.ts (TS-03.4b, TS-03.7b).
// ─────────────────────────────────────────────────────────────────────────────
describe("[US-15 AC4] Admin HO gửi tin — quyền cao nhất KHÔNG mở được cửa", () => {
  it("hội thoại mình KHÔNG thuộc về → NOT_PARTICIPANT, 0 tin / 0 transaction / 0 broadcast [TS-03.4b]", async () => {
    h.state.ctxRow = ctxRow({ participantId: null });
    const admin = actorOf("SUPER_ADMIN", "ho", "admin-ngoai-nhom");
    const res = await sendChatMessageAsActor(admin, "Admin HO", input());

    expect(res.ok).toBe(false);
    if (res.ok) return;
    // KHÔNG phải PERMISSION_DENIED: vai này có quyền, cái sai là không ở trong nhóm.
    expect(res.error.code).toBe("NOT_PARTICIPANT");
    expect(h.state.created).toHaveLength(0);
    expect(h.state.txCalls).toBe(0);
    expect(h.broadcast).not.toHaveBeenCalled();
  });

  it("Admin ĐÃ RỜI nhóm → NOT_PARTICIPANT (không có ân hạn riêng cho Admin)", async () => {
    h.state.ctxRow = ctxRow({ participantLeftAt: new Date("2026-08-01T00:00:00Z") });
    const admin = actorOf("SUPER_ADMIN", "ho", "admin-da-roi");
    const res = await sendChatMessageAsActor(admin, "Admin HO", input());

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_PARTICIPANT");
    expect(h.state.created).toHaveLength(0);
  });

  it("hội thoại LOCKED → CONVERSATION_LOCKED với MỌI vai KỂ CẢ người ĐANG LÀ thành viên [TS-03.7b]", async () => {
    // `ctxRow()` mặc định có `participantId` ⇒ cả ba người dưới đây đều LÀ thành viên
    // còn hiệu lực. Nếu chỉ thử người ngoài nhóm thì test này chỉ đang chứng minh lại
    // NOT_PARTICIPANT, chứ không chứng minh cái khoá có tác dụng.
    for (const [code, uid] of [
      ["PARENT", "ph-locked-member"],
      ["TEACHER", "gv-locked-member"],
      ["SUPER_ADMIN", "admin-locked-member"],
    ] as const) {
      h.state.ctxRow = ctxRow({ status: "LOCKED" });
      const actor = actorOf(code, code === "SUPER_ADMIN" ? "ho" : "cs1", uid, ["lopA"]);
      const res = await sendChatMessageAsActor(actor, code, input({ clientMsgId: cid(1) }));

      expect(res.ok, `${code} không được gửi vào hội thoại đang khoá`).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe("CONVERSATION_LOCKED");
    }
    expect(h.state.created).toHaveLength(0);
  });

  it("Admin LÀ thành viên nhưng hội thoại ARCHIVED → CONVERSATION_ARCHIVED (mã KHÁC 'đang khoá')", async () => {
    h.state.ctxRow = ctxRow({ status: "ARCHIVED" });
    const admin = actorOf("SUPER_ADMIN", "ho", "admin-archived");
    const res = await sendChatMessageAsActor(admin, "Admin HO", input());

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("CONVERSATION_ARCHIVED");
    expect(h.state.created).toHaveLength(0);
  });
});
