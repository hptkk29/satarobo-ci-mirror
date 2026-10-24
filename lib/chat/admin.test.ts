// @vitest-environment node
/**
 * US-15 — quản trị hội thoại: tra cứu có lý do (F-AUDIT) + khoá/mở khoá (F-LOCK).
 *
 * Prisma + audit + broadcast đều mock ⇒ chạy được ở mọi máy. Nghiệm thu trên DB thật nằm
 * ở `tests/chat/permission-matrix.spec.ts` (TS-04.2a/2b/3, TS-03.4b, TS-03.7b).
 *
 * Điểm phải giữ bằng mọi giá:
 *  • Thiếu / toàn khoảng trắng / quá ngắn `reason` ⇒ VALIDATION và **không đọc một dòng
 *    tin nào** — modal UI không phải chốt chặn (AC1).
 *  • `writeAudit` chạy TRƯỚC truy vấn nội dung, và audit hỏng ⇒ KHÔNG trả nội dung.
 *  • Lý do lưu NGUYÊN VĂN vào `AuditLog.reason`.
 *  • Khoá/mở khoá phát `conversation.locked` xuống `conv:{id}`; broadcast hỏng KHÔNG
 *    rollback (NT1 — Postgres là nguồn sự thật).
 *  • LOCKED không đè được lên ARCHIVED (một cột `status`, đè là mất trạng thái).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    /** Hàng trả về cho `$queryRaw` của `loadAdminConversationMeta`. null ⇒ không tồn tại. */
    meta: {
      conversationId: "conv-1",
      type: "DM_TEACHER_PARENT",
      status: "ACTIVE",
      centerId: null,
      orgUnitId: null,
      subjectType: "NONE",
      subjectId: null,
      title: "Nhắn riêng",
      createdById: "gv-1",
      createdAt: new Date("2026-08-01T00:00:00Z"),
      lastMessageAt: new Date("2026-08-08T00:00:00Z"),
      archivedAt: null,
      className: null,
      centerName: null,
      participantCount: BigInt(2),
      messageCount: BigInt(3),
    } as Row | null,
    auditThrows: false,
    broadcastThrows: false,
    updateManyCount: 1,
    messages: [
      {
        id: "m-1",
        kind: "CHAT",
        senderId: "gv-1",
        body: "Nội dung riêng tư",
        createdAt: new Date("2026-08-08T01:00:00Z"),
        deletedAt: null,
        deletedReason: null,
        _count: { attachments: 0 },
      },
    ] as Row[],
    lockUpdates: [] as Row[],
    broadcasts: [] as unknown[],
    /** Hàng trả về cho `conversation.findMany` của `listAdminConversations`. */
    convRows: [] as Row[],
  };

  const writeAudit = vi.fn(async (_params: Row) => {
    if (state.auditThrows) throw new Error("DB audit down");
    return { id: "audit-1" };
  });

  const broadcastMessages = vi.fn(async (msgs: unknown[]) => {
    if (state.broadcastThrows) throw new Error("realtime down");
    state.broadcasts.push(...msgs);
    return true;
  });

  const mockDb = {
    $queryRaw: vi.fn(async () => (state.meta ? [state.meta] : [])),
    message: { findMany: vi.fn(async () => state.messages) },
    user: { findMany: vi.fn(async () => [{ id: "gv-1", name: "Cô Lan" }]) },
    class: { findMany: vi.fn(async () => []) },
    center: { findMany: vi.fn(async () => []) },
    conversation: {
      findMany: vi.fn(async () => state.convRows),
      updateMany: vi.fn(async (args: Row) => {
        state.lockUpdates.push(args);
        return { count: state.updateManyCount };
      }),
    },
    $extends: () => mockDb,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
  } as unknown as Record<string, never>;

  return { state, mockDb, writeAudit, broadcastMessages };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.writeAudit }));
// `lib/chat/broadcast.ts` có `import "server-only"` → không import được ngoài Next.
vi.mock("@/lib/chat/broadcast", () => ({
  broadcastMessages: h.broadcastMessages,
  conversationBroadcast: (
    conversationId: string,
    event: string,
    payload: Record<string, unknown>,
  ) => ({ topic: `conv:${conversationId}`, event, payload, private: true }),
}));

import type { Actor } from "@/lib/auth/actor";
import {
  ADMIN_REASON_MIN_LENGTH,
  adminLookupConversationAsActor,
  listAdminConversations,
  setConversationLockAsActor,
} from "@/lib/chat/admin";

/**
 * `mockDb` khai kiểu `Record<string, never>` (đúng khuôn `dm.test.ts` — nó chỉ cần đi lọt
 * chỗ `vi.mock`), nên phải mở lại kiểu ở đây để `expect` đọc được spy.
 */
type SpyLike = ((...args: unknown[]) => unknown) & {
  mock: { calls: unknown[][]; invocationCallOrder: number[] };
};
const dbMock = h.mockDb as unknown as {
  message: { findMany: SpyLike };
  conversation: { findMany: SpyLike };
};

const CONV_ID = "11111111-2222-4333-8444-555555555555";
const REASON = "Xử lý khiếu nại số 128 của phụ huynh lớp Sata 3";

function actorWith(actions: { action: string; scopeType: string }[]): Actor {
  return {
    userId: "admin-1",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: actions.map((a) => ({
      action: a.action,
      scopeType: a.scopeType as never,
      orgUnitId: "org-1",
      roleCode: "R",
      centerScope: null,
    })),
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  };
}

/** Admin HO: `chat:admin` scope GLOBAL (đúng `prisma/seed-roles.ts`). */
const adminActor = () => actorWith([{ action: "chat:admin", scopeType: "GLOBAL" }]);
/** QLCS: có chat:read/send scope CENTER nhưng KHÔNG có chat:admin (AC5). */
const centerManagerActor = () =>
  actorWith([
    { action: "chat:read", scopeType: "CENTER" },
    { action: "chat:send", scopeType: "CENTER" },
  ]);

beforeEach(() => {
  vi.clearAllMocks();
  h.state.auditThrows = false;
  h.state.broadcastThrows = false;
  h.state.updateManyCount = 1;
  h.state.lockUpdates = [];
  h.state.broadcasts = [];
  h.state.convRows = [];
  h.state.meta = {
    conversationId: "conv-1",
    type: "DM_TEACHER_PARENT",
    status: "ACTIVE",
    centerId: null,
    orgUnitId: null,
    subjectType: "NONE",
    subjectId: null,
    title: "Nhắn riêng",
    createdById: "gv-1",
    createdAt: new Date("2026-08-01T00:00:00Z"),
    lastMessageAt: new Date("2026-08-08T00:00:00Z"),
    archivedAt: null,
    className: null,
    centerName: null,
    participantCount: BigInt(2),
    messageCount: BigInt(3),
  };
});

// ─── Danh sách metadata: cổng THỨ HAI của route ─────────────────────────────

describe("listAdminConversations — cổng quyền nằm trong HÀM, không chỉ ở page.tsx", () => {
  it("[AC5] QLCS gọi thẳng hàm (bỏ qua gate của trang) → PERMISSION_DENIED, KHÔNG truy vấn hội thoại nào", async () => {
    await expect(listAdminConversations(centerManagerActor(), {})).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    // Không rò cả DANH SÁCH: tên lớp + số tin của cơ sở khác cũng là thứ QLCS không
    // được thấy ở màn này. Gate của `page.tsx` là cửa thứ nhất; hàm này là cửa còn lại.
    expect(dbMock.conversation.findMany).not.toHaveBeenCalled();
  });

  it("[AC1] Admin → trả metadata và KHÔNG có một chữ nội dung nào (không cả preview)", async () => {
    h.state.convRows = [
      {
        id: "conv-1",
        type: "CLASS_GROUP",
        status: "ACTIVE",
        title: "Nhóm lớp Sata 3",
        centerId: null,
        subjectType: "CLASS",
        subjectId: null,
        lastMessageAt: new Date("2026-08-08T00:00:00Z"),
        _count: { participants: 12, messages: 340 },
      },
    ];
    const rows = await listAdminConversations(adminActor(), {});

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ conversationId: "conv-1", messageCount: 340 });
    // Preview của hội thoại mình không thuộc về CŨNG là nội dung — nội dung chỉ mở qua
    // đường có lý do + audit. Kiểm bằng khoá trả về, không bằng mắt nhìn UI.
    for (const forbidden of ["body", "preview", "lastMessage", "lastMessageBody", "snippet"]) {
      expect(Object.keys(rows[0])).not.toContain(forbidden);
    }
    // Bảng `Message` không hề bị đọc ở màn danh sách.
    expect(dbMock.message.findMany).not.toHaveBeenCalled();
  });
});

// ─── F-AUDIT: tra cứu có lý do ──────────────────────────────────────────────

describe("adminLookupConversation — lý do là ĐIỀU KIỆN, không phải trang trí", () => {
  it("[TS-04.3] KHÔNG kèm reason (gọi thẳng, bỏ qua modal) → VALIDATION, không đọc tin, không audit", async () => {
    const res = await adminLookupConversationAsActor(adminActor(), "admin", {
      conversationId: CONV_ID,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("VALIDATION");
      expect(res.error.field).toBe("reason");
    }
    expect(h.writeAudit).not.toHaveBeenCalled();
    expect(dbMock.message.findMany).not.toHaveBeenCalled();
  });

  it("reason toàn khoảng trắng → VALIDATION (trim chạy trước min)", async () => {
    const res = await adminLookupConversationAsActor(adminActor(), "admin", {
      conversationId: CONV_ID,
      reason: "          ",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe("reason");
    expect(dbMock.message.findMany).not.toHaveBeenCalled();
  });

  it(`reason ngắn hơn ${ADMIN_REASON_MIN_LENGTH} ký tự → VALIDATION`, async () => {
    const res = await adminLookupConversationAsActor(adminActor(), "admin", {
      conversationId: CONV_ID,
      reason: "xem",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION");
  });

  it("[AC5] QLCS (không có chat:admin) → PERMISSION_DENIED, không audit, không đọc tin", async () => {
    const res = await adminLookupConversationAsActor(centerManagerActor(), "ql1", {
      conversationId: CONV_ID,
      reason: REASON,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PERMISSION_DENIED");
    expect(h.writeAudit).not.toHaveBeenCalled();
    expect(dbMock.message.findMany).not.toHaveBeenCalled();
  });

  it("hội thoại không tồn tại → CONVERSATION_NOT_FOUND", async () => {
    h.state.meta = null;
    const res = await adminLookupConversationAsActor(adminActor(), "admin", {
      conversationId: CONV_ID,
      reason: REASON,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("CONVERSATION_NOT_FOUND");
  });

  it("[TS-04.2b] CÓ lý do → ok + AuditLog ghi TRƯỚC khi đọc nội dung (F-AUDIT)", async () => {
    const res = await adminLookupConversationAsActor(adminActor(), "Admin HO", {
      conversationId: CONV_ID,
      reason: REASON,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.messages).toHaveLength(1);
    expect(res.data.auditLogId).toBe("audit-1");

    // THỨ TỰ là điều cần kiểm, không phải "có gọi hay không": audit sau khi đọc thì
    // nội dung đã rời DB trước khi có vết.
    const auditOrder = h.writeAudit.mock.invocationCallOrder[0];
    const readOrder = dbMock.message.findMany.mock.invocationCallOrder[0];
    expect(auditOrder).toBeLessThan(readOrder);

    // AC2 — ai / khi nào / hội thoại nào / lý do.
    const params = h.writeAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(params.module).toBe("chat");
    expect(params.entityType).toBe("Conversation");
    expect(params.entityId).toBe("conv-1");
    expect(params.action).toBe("READ");
    expect(params.actor).toMatchObject({ id: "admin-1", name: "Admin HO" });
    expect(params.reason).toBe(REASON); // NGUYÊN VĂN
    // KHÔNG chép nội dung tin vào nhật ký.
    expect(JSON.stringify(params.newValues)).not.toContain("Nội dung riêng tư");
  });

  it("ghi AuditLog HỎNG → AUDIT_FAILED và KHÔNG truy vấn nội dung", async () => {
    h.state.auditThrows = true;
    const res = await adminLookupConversationAsActor(adminActor(), "admin", {
      conversationId: CONV_ID,
      reason: REASON,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("AUDIT_FAILED");
    expect(dbMock.message.findMany).not.toHaveBeenCalled();
  });

  it("tin đã gỡ vẫn trả NGUYÊN VĂN kèm cờ `deleted` (US-12 giữ body để đối chất)", async () => {
    h.state.messages = [
      {
        id: "m-9",
        kind: "CHAT",
        senderId: "gv-1",
        body: "Câu nói bị gỡ",
        createdAt: new Date("2026-08-08T02:00:00Z"),
        deletedAt: new Date("2026-08-08T02:05:00Z"),
        deletedReason: "Chứa SĐT phụ huynh khác",
        _count: { attachments: 2 },
      },
    ];
    const res = await adminLookupConversationAsActor(adminActor(), "admin", {
      conversationId: CONV_ID,
      reason: REASON,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.messages[0]).toMatchObject({
      body: "Câu nói bị gỡ",
      deleted: true,
      deletedReason: "Chứa SĐT phụ huynh khác",
      attachmentCount: 2,
      senderName: "Cô Lan",
    });
  });
});

// ─── F-LOCK: khoá / mở khoá ────────────────────────────────────────────────

describe("setConversationLock — F-LOCK", () => {
  it("thiếu lý do → VALIDATION, không đụng DB", async () => {
    const res = await setConversationLockAsActor(adminActor(), "admin", {
      conversationId: CONV_ID,
      locked: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION");
    expect(h.state.lockUpdates).toHaveLength(0);
  });

  it("[AC5] QLCS khoá hội thoại → PERMISSION_DENIED", async () => {
    const res = await setConversationLockAsActor(centerManagerActor(), "ql1", {
      conversationId: CONV_ID,
      locked: true,
      reason: REASON,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PERMISSION_DENIED");
    expect(h.state.lockUpdates).toHaveLength(0);
  });

  it("[AC3] khoá: ACTIVE → LOCKED + broadcast conversation.locked + audit có lý do", async () => {
    const res = await setConversationLockAsActor(adminActor(), "Admin HO", {
      conversationId: CONV_ID,
      locked: true,
      reason: REASON,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({ status: "LOCKED", locked: true, changed: true });

    // Chỉ đổi khi trạng thái vẫn là ACTIVE — chốt chống đua 2 tab.
    expect(h.state.lockUpdates[0]).toMatchObject({
      where: { id: "conv-1", status: "ACTIVE" },
      data: { status: "LOCKED" },
    });

    const ev = h.state.broadcasts[0] as {
      topic: string;
      event: string;
      payload: Record<string, unknown>;
    };
    expect(ev.topic).toBe("conv:conv-1");
    expect(ev.event).toBe("conversation.locked");
    expect(ev.payload).toMatchObject({ locked: true, status: "LOCKED" });
    // Lý do là dữ liệu quản trị — KHÔNG đẩy xuống nhóm.
    expect(ev.payload).not.toHaveProperty("reason");

    const params = h.writeAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(params.reason).toBe(REASON);
    expect(params.oldValues).toMatchObject({ status: "ACTIVE" });
    expect(params.newValues).toMatchObject({ status: "LOCKED" });
  });

  it("[AC3] mở khoá: LOCKED → ACTIVE + broadcast locked=false", async () => {
    (h.state.meta as Record<string, unknown>).status = "LOCKED";
    const res = await setConversationLockAsActor(adminActor(), "admin", {
      conversationId: CONV_ID,
      locked: false,
      reason: "Đã xử lý xong khiếu nại, mở lại cho lớp trao đổi",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({ status: "ACTIVE", locked: false, changed: true });
    const ev = h.state.broadcasts[0] as { payload: Record<string, unknown> };
    expect(ev.payload).toMatchObject({ locked: false, status: "ACTIVE" });
  });

  it("khoá hội thoại ĐÃ LƯU TRỮ → CONVERSATION_ARCHIVED, KHÔNG đè mất trạng thái", async () => {
    (h.state.meta as Record<string, unknown>).status = "ARCHIVED";
    const res = await setConversationLockAsActor(adminActor(), "admin", {
      conversationId: CONV_ID,
      locked: true,
      reason: REASON,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("CONVERSATION_ARCHIVED");
    expect(h.state.lockUpdates).toHaveLength(0);
  });

  it("khoá lại hội thoại VỐN ĐÃ khoá → ok nhưng changed=false, không broadcast", async () => {
    (h.state.meta as Record<string, unknown>).status = "LOCKED";
    const res = await setConversationLockAsActor(adminActor(), "admin", {
      conversationId: CONV_ID,
      locked: true,
      reason: REASON,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.changed).toBe(false);
    expect(h.state.broadcasts).toHaveLength(0);
  });

  it("hai người bấm cùng lúc (updateMany count=0) → CONVERSATION_STATE_CHANGED", async () => {
    h.state.updateManyCount = 0;
    const res = await setConversationLockAsActor(adminActor(), "admin", {
      conversationId: CONV_ID,
      locked: true,
      reason: REASON,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("CONVERSATION_STATE_CHANGED");
  });

  it("broadcast HỎNG → việc khoá vẫn thành công (NT1: Postgres là nguồn sự thật)", async () => {
    h.state.broadcastThrows = true;
    const res = await setConversationLockAsActor(adminActor(), "admin", {
      conversationId: CONV_ID,
      locked: true,
      reason: REASON,
    });
    expect(res.ok).toBe(true);
    expect(h.writeAudit).toHaveBeenCalled();
  });
});
