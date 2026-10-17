// @vitest-environment node
/**
 * US-12 — hiệu ứng phụ SAU khi gỡ tin: `broadcastDeleted` (phần PIPELINE, chạm DB mock).
 *
 * `moderation.test.ts` chỉ phủ phần THUẦN (cửa sổ 15', thứ tự guard, mã lỗi) và mock `db`
 * bằng `{}`; file này để riêng vì nó cần một Prisma client giả đủ dùng, và trộn vào đó
 * sẽ làm hỏng ý đồ "file kia không chạm DB".
 *
 * Bất biến pin ở đây — đúng những chỗ đã trả giá ở đường gửi tin:
 *  • MỘT lời gọi HTTP duy nhất mang cả `conv:{id}` lẫn N topic `user:{id}` (endpoint REST
 *    của Realtime nhận MẢNG). Lặp N lời gọi = N × trần chờ 5s trong đường gỡ tin.
 *  • Người ĐÃ RỜI nhóm (`leftAt != null`) và CHÍNH người gỡ KHÔNG nhận bump. Ở đây mock
 *    `findMany` LỌC THẬT theo `where`, nên bỏ điều kiện lọc trong code là test đỏ — khác
 *    hẳn kiểu chỉ soi lại đối số truyền vào.
 *  • Payload bump KHÔNG mang nội dung/PII (BR-30): đúng 4 khoá, `kind = "DELETED"`.
 *  • Broadcast hỏng KHÔNG được biến việc gỡ ĐÃ commit thành lỗi đỏ (fail-and-forget).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  type Participant = { userId: string; leftAt: Date | null };
  const state = {
    ctxRow: null as Row | null,
    /** Thành viên hội thoại — mock `findMany` lọc THẬT trên danh sách này. */
    participants: [] as Participant[],
    recipientQueries: [] as Row[],
    deleteUpdates: [] as Row[],
    /** Câu UPDATE khoá dòng participant chạy TRƯỚC khi đọc (xem `lockAndReadRecipients`). */
    participantLocks: [] as Row[],
    /** Nhật ký thao tác theo thứ tự — dùng để chứng minh "khoá rồi mới đọc", "đọc trong tx". */
    trace: [] as string[],
    /** Đang ở trong `$transaction` hay không — bắt lỗi đọc người nhận ngoài tx. */
    inTransaction: false,
  };
  const mockDb: Record<string, unknown> = {
    $extends: () => mockDb,
    $queryRaw: vi.fn(async () => (state.ctxRow ? [state.ctxRow] : [])),
    $transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>, opts?: Record<string, unknown>) => {
        state.trace.push(`tx:start(timeout=${String(opts?.timeout)},maxWait=${String(opts?.maxWait)})`);
        state.inTransaction = true;
        try {
          return await fn(mockDb);
        } finally {
          state.inTransaction = false;
          state.trace.push("tx:end");
        }
      },
    ),
    message: {
      updateMany: vi.fn(async (args: Row) => {
        state.deleteUpdates.push(args);
        state.trace.push(`message.updateMany(inTx=${state.inTransaction})`);
        return { count: 1 };
      }),
      create: vi.fn(async () => {
        state.trace.push(`message.create(inTx=${state.inTransaction})`);
        return { id: "sys-1" };
      }),
    },
    conversation: {
      update: vi.fn(async () => {
        state.trace.push(`conversation.update(inTx=${state.inTransaction})`);
        return {};
      }),
    },
    conversationParticipant: {
      updateMany: vi.fn(async (args: Row) => {
        state.participantLocks.push(args);
        state.trace.push(`participant.lock(inTx=${state.inTransaction})`);
        return { count: 0 };
      }),
      // Lọc THẬT theo `where` (leftAt / userId.not) — đây là điều làm test có răng:
      // gỡ một điều kiện trong đường đọc là người không đáng nhận lọt vào mảng.
      findMany: vi.fn(async (args: Row) => {
        state.recipientQueries.push(args);
        state.trace.push(`participant.read(inTx=${state.inTransaction})`);
        const where = (args.where ?? {}) as {
          leftAt?: unknown;
          userId?: { not?: string };
        };
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
// `broadcastMessages` là primitive DUY NHẤT gọi HTTP; hai builder còn lại THUẦN nên dựng
// lại y hệt bản thật để soi được hình dạng mảng gửi đi.
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
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import { buildActor, type UserOrgRoleRow } from "@/lib/auth/actor";
import type { OrgUnitNode } from "@/lib/org/types";
import { ROLE_SEED } from "../../prisma/seed-roles";
import { deleteMessageAsModeratorAsActor, recallOwnMessageAsActor } from "./moderation";

const ORG: OrgUnitNode[] = [
  { id: "root", code: "SATAROBO", type: "ROOT", parentId: null, centerId: null },
  { id: "cs1", code: "CS1", type: "CENTER", parentId: "root", centerId: "c1" },
];
const PAST = new Date("2000-01-01");

function seedPermsOf(code: string): UserOrgRoleRow["role"]["permissions"] {
  const r = ROLE_SEED.find((x) => x.code === code);
  if (!r) throw new Error(`ROLE_SEED thiếu RoleDef ${code}`);
  return r.perms.map((p) => ({ action: p.action, scopeType: p.scopeType }));
}

function actorOf(code: string, userId: string, classes?: string[]) {
  return buildActor({
    userId,
    rows: [
      {
        orgUnitId: "cs1",
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

const MSG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
/** Tác giả = người bấm thu hồi (đường F-DEL nhánh 1). */
const TAC_GIA = "ph-go-tin";

function ctxRow(over: Record<string, unknown> = {}) {
  return {
    messageId: MSG,
    conversationId: CONV,
    senderId: TAC_GIA,
    kind: "CHAT",
    // Trong cửa sổ 15' — dùng mốc tương đối để test không hết hạn theo thời gian thực.
    createdAt: new Date(Date.now() - 60_000),
    deletedAt: null,
    status: "ACTIVE",
    centerId: "c1",
    orgUnitId: "cs1",
    subjectType: "CLASS",
    subjectId: "lopA",
    participantId: "part-1",
    participantLeftAt: null,
    ...over,
  };
}

type BroadcastCall = { topic: string; event: string; payload: Record<string, unknown> };

/** Mảng gửi đi ở lời gọi broadcast thứ `n` (mặc định lời gọi đầu). */
function sentBroadcasts(n = 0): BroadcastCall[] {
  return (h.broadcast.mock.calls[n] as unknown as [BroadcastCall[]])[0];
}

beforeEach(() => {
  h.state.ctxRow = ctxRow();
  h.state.participants = [
    { userId: "ph-khac", leftAt: null },
    { userId: "gv-lopA", leftAt: null },
    // Đã chuyển lớp / bị gỡ phân công — KHÔNG được nhận tín hiệu nào nữa.
    { userId: "ph-da-roi", leftAt: new Date("2026-07-01T00:00:00.000Z") },
    // Chính người bấm gỡ — client của họ đã tự biết, bump lại là thừa.
    { userId: TAC_GIA, leftAt: null },
  ];
  h.state.recipientQueries = [];
  h.state.deleteUpdates = [];
  h.state.participantLocks = [];
  h.state.trace = [];
  h.state.inTransaction = false;
  h.broadcast.mockClear();
  h.broadcast.mockImplementation(async () => true);
  h.writeAudit.mockClear();
});

describe("[US-12] broadcastDeleted — fan-out bump khi gỡ tin", () => {
  it("MỘT POST duy nhất: 1 phần tử conv: message.deleted + N phần tử user:{id} conversation.bumped", async () => {
    const actor = actorOf("PARENT", TAC_GIA);
    const res = await recallOwnMessageAsActor(actor, "PH Test", { messageId: MSG });

    expect(res.ok).toBe(true);
    // Đúng 1 lời gọi HTTP dù có N người nhận — không lặp N call.
    expect(h.broadcast).toHaveBeenCalledTimes(1);

    const all = sentBroadcasts();
    const conv = all.filter((m) => m.topic.startsWith("conv:"));
    const bumps = all.filter((m) => m.topic.startsWith("user:"));
    expect(conv).toHaveLength(1);
    expect(conv[0]?.topic).toBe(`conv:${CONV}`);
    expect(conv[0]?.event).toBe("message.deleted");
    expect(bumps).toHaveLength(2);
    expect(all).toHaveLength(3);
  });

  it("người ĐÃ RỜI nhóm và CHÍNH người gỡ đều KHÔNG nhận bump", async () => {
    const actor = actorOf("PARENT", TAC_GIA);
    await recallOwnMessageAsActor(actor, "PH Test", { messageId: MSG });

    const topics = sentBroadcasts()
      .filter((m) => m.topic.startsWith("user:"))
      .map((m) => m.topic);

    expect(topics).toEqual(["user:ph-khac", "user:gv-lopA"]);
    expect(topics).not.toContain("user:ph-da-roi");
    expect(topics).not.toContain(`user:${TAC_GIA}`);
  });

  it("payload bump: đúng 4 khoá, kind=DELETED, KHÔNG mang nội dung/PII (BR-30)", async () => {
    const actor = actorOf("PARENT", TAC_GIA);
    await recallOwnMessageAsActor(actor, "PH Test", { messageId: MSG });

    const bumps = sentBroadcasts().filter((m) => m.topic.startsWith("user:"));
    expect(bumps.length).toBeGreaterThan(0);
    for (const b of bumps) {
      expect(b.event).toBe("conversation.bumped");
      expect(Object.keys(b.payload).sort()).toEqual([
        "at",
        "conversationId",
        "kind",
        "messageId",
      ]);
      expect(b.payload.kind).toBe("DELETED");
      expect(b.payload.conversationId).toBe(CONV);
      expect(b.payload.messageId).toBe(MSG);
    }
  });

  it("broadcast NÉM lỗi (vi phạm hợp đồng) → việc gỡ VẪN ok, không lỗi đỏ trước mặt người dùng", async () => {
    h.broadcast.mockImplementation(async () => {
      throw new Error("Realtime chết");
    });

    const actor = actorOf("PARENT", TAC_GIA);
    const res = await recallOwnMessageAsActor(actor, "PH Test", { messageId: MSG });

    expect(res.ok).toBe(true);
    // Soft delete vẫn đi qua: DB là nguồn sự thật, realtime chỉ là lớp thông báo.
    expect(h.state.deleteUpdates).toHaveLength(1);
  });

  // Lỗi đã tái hiện TẤT ĐỊNH trước khi vá: đọc người nhận bằng `db` TRẦN ngoài transaction
  // ⇒ người đang bị gỡ (tx set `leftAt` chưa commit) vẫn nhận bump DELETED. Cùng kịch bản ở
  // đường GỬI tin thì không, vì bên đó đọc trong tx SAU một `updateMany` khoá dòng.
  it("đọc người nhận NẰM TRONG transaction gỡ tin, và SAU câu khoá dòng participant", async () => {
    const actor = actorOf("PARENT", TAC_GIA);
    await recallOwnMessageAsActor(actor, "PH Test", { messageId: MSG });

    expect(h.state.trace).toEqual([
      "tx:start(timeout=30000,maxWait=10000)",
      "message.updateMany(inTx=true)",
      "participant.lock(inTx=true)",
      "participant.read(inTx=true)",
      "tx:end",
    ]);
    // Câu khoá phải nhắm ĐÚNG tập sắp đọc, nếu không thì khoá nhầm dòng = vô tác dụng.
    expect(h.state.participantLocks[0]?.where).toEqual(h.state.recipientQueries[0]?.where);
  });

  /**
   * Đường KIỂM DUYỆT (GV gỡ tin của người khác) có thêm tin SYSTEM + `conversation.update`.
   * Hai bất biến chồng lên nhau ở đây:
   *  • người nhận vẫn phải đọc TRONG tx, SAU câu khoá — y như đường thu hồi;
   *  • THỨ TỰ KHOÁ phải là Message → Conversation → ConversationParticipant, trùng đường
   *    gửi tin (`lib/chat/messages.ts`). Khoá participant TRƯỚC `conversation.update` là
   *    dựng ngược thứ tự ⇒ deadlock giữa "gửi tin" và "gỡ tin" trên cùng hội thoại — thứ
   *    chỉ hiện ra dưới tải thật, không bao giờ hiện ở máy dev.
   */
  it("đường kiểm duyệt: đọc người nhận trong tx, và khoá participant SAU conversation.update", async () => {
    const actor = actorOf("TEACHER", "gv-lopA", ["lopA"]);
    const res = await deleteMessageAsModeratorAsActor(actor, "GV Test", {
      messageId: MSG,
      reason: "Nội dung không phù hợp với nhóm lớp",
    });

    expect(res.ok).toBe(true);
    expect(h.state.trace).toEqual([
      "tx:start(timeout=30000,maxWait=10000)",
      "message.updateMany(inTx=true)",
      "message.create(inTx=true)",
      "conversation.update(inTx=true)",
      "participant.lock(inTx=true)",
      "participant.read(inTx=true)",
      "tx:end",
    ]);
    expect(h.state.participantLocks[0]?.where).toEqual(h.state.recipientQueries[0]?.where);

    // Và fan-out vẫn đúng tập người: người đã rời + chính người gỡ đứng ngoài.
    const topics = sentBroadcasts()
      .filter((m) => m.topic.startsWith("user:"))
      .map((m) => m.topic);
    expect(topics).toEqual(["user:ph-khac", `user:${TAC_GIA}`]);
  });

  it("không còn ai trong nhóm → chỉ còn phần tử conv:, không có bump rỗng", async () => {
    h.state.participants = [{ userId: TAC_GIA, leftAt: null }];

    const actor = actorOf("PARENT", TAC_GIA);
    await recallOwnMessageAsActor(actor, "PH Test", { messageId: MSG });

    const all = sentBroadcasts();
    expect(all).toHaveLength(1);
    expect(all[0]?.topic).toBe(`conv:${CONV}`);
  });
});
