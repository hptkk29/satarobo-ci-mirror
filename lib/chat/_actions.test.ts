// @vitest-environment node
/**
 * US-15 — BIÊN HTTP của trang quản trị: `adminLookupConversationAction` /
 * `setConversationLockAction` trong `lib/chat/_actions.ts`.
 *
 * Vì sao có file này khi `lib/chat/admin.test.ts` đã phủ phần lõi: hai file kiểm hai
 * điều KHÁC NHAU.
 *   • `admin.test.ts` gọi `*AsActor` — chứng minh LÕI từ chối khi thiếu lý do.
 *   • File này gọi ĐÚNG hàm mà Client Component import — tức là đường mà kẻ bỏ qua modal
 *     sẽ đi. AC1 nói "không route/API nào vòng qua được"; chỗ duy nhất chứng minh được
 *     điều đó là ở đây, vì đây là bề mặt duy nhất client chạm tới.
 *
 * Bất biến pin ở đây:
 *  • Chưa đăng nhập → `AUTH`, và KHÔNG một truy vấn nội dung / audit nào chạy.
 *  • `userId` LẤY TỪ PHIÊN. Input có nhét `userId`/`actorName` thì cũng bị bỏ qua —
 *    đây là đường "tra cứu hộ danh nghĩa người khác" gần nhất mà module chat có.
 *  • Thiếu / rỗng / quá ngắn lý do → từ chối NGAY Ở SERVER (VALIDATION, field=reason),
 *    trước khi chạm tới `Message` và trước khi ghi audit.
 *  • Không có `chat:admin` (QLCS) → PERMISSION_DENIED kể cả khi lý do rất tử tế (AC5).
 *
 * Lõi CHẠY THẬT (chỉ Prisma/audit/broadcast là mock) — nếu chỉ mock luôn cả
 * `@/lib/chat/admin` thì file này chỉ đang kiểm "action có gọi hàm không", tức là xanh
 * cả khi lõi bị gỡ hết cổng.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
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
    lockUpdates: [] as Row[],
  };

  const writeAudit = vi.fn(async (_p: Row) => ({ id: "audit-1" }));
  const messageFindMany = vi.fn(async () => [] as Row[]);

  const mockDb = {
    $queryRaw: vi.fn(async () => (state.meta ? [state.meta] : [])),
    message: { findMany: messageFindMany },
    user: { findMany: vi.fn(async () => []) },
    class: { findMany: vi.fn(async () => []) },
    center: { findMany: vi.fn(async () => []) },
    conversation: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async (args: Row) => {
        state.lockUpdates.push(args);
        return { count: 1 };
      }),
    },
    $extends: () => mockDb,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
  } as unknown as Record<string, never>;

  return {
    state,
    mockDb,
    writeAudit,
    messageFindMany,
    auth: vi.fn(async () => null as { user?: { id: string; name?: string } } | null),
    resolveActor: vi.fn(async (_userId: string) => null as unknown),
  };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.writeAudit }));
// `next-auth` không import được trong vitest node ("Cannot find module .../next/server").
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/chat/broadcast", () => ({
  broadcastMessages: vi.fn(async () => true),
  conversationBroadcast: (
    conversationId: string,
    event: string,
    payload: Record<string, unknown>,
  ) => ({ topic: `conv:${conversationId}`, event, payload, private: true }),
  userBumpBroadcasts: () => [],
}));
// Chỉ thay `resolveActor` (nó đọc DB + cache theo request); `buildActor`/type còn lại
// giữ bản thật vì các module khác trong `_actions.ts` dùng tới.
vi.mock("@/lib/auth/actor", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveActor: h.resolveActor,
}));

import type { Actor } from "@/lib/auth/actor";
import {
  adminLookupConversationAction,
  setConversationLockAction,
} from "@/lib/chat/_actions";

const CONV_ID = "11111111-2222-4333-8444-555555555555";
const REASON = "Xử lý khiếu nại số 128 của phụ huynh lớp Sata 3";

function actorWith(
  userId: string,
  actions: { action: string; scopeType: string }[],
): Actor {
  return {
    userId,
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

/** Admin HO — `chat:admin` scope GLOBAL, đúng `prisma/seed-roles.ts`. */
const ADMIN = actorWith("admin-1", [{ action: "chat:admin", scopeType: "GLOBAL" }]);
/** QLCS — có chat:read/send CENTER, KHÔNG có chat:admin (AC5). */
const QLCS = actorWith("ql-1", [
  { action: "chat:read", scopeType: "CENTER" },
  { action: "chat:send", scopeType: "CENTER" },
]);

/** Đăng nhập bằng ai: gắn cả phiên lẫn actor mà `resolveActor` sẽ trả về. */
function loginAs(actor: Actor, name = "Admin HO") {
  h.auth.mockResolvedValue({ user: { id: actor.userId, name } });
  h.resolveActor.mockResolvedValue(actor);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.lockUpdates = [];
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
  h.auth.mockResolvedValue(null);
  h.resolveActor.mockResolvedValue(ADMIN);
});

describe("adminLookupConversationAction — bề mặt client gọi tới", () => {
  it("chưa đăng nhập → AUTH, không audit, không đọc một dòng tin nào", async () => {
    const res = await adminLookupConversationAction({
      conversationId: CONV_ID,
      reason: REASON,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("AUTH");
    expect(h.resolveActor).not.toHaveBeenCalled();
    expect(h.writeAudit).not.toHaveBeenCalled();
    expect(h.messageFindMany).not.toHaveBeenCalled();
  });

  it("[AC1] gọi THẲNG action, bỏ qua modal, KHÔNG kèm reason → VALIDATION(field=reason) ngay ở server", async () => {
    loginAs(ADMIN);

    const res = await adminLookupConversationAction({ conversationId: CONV_ID });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("VALIDATION");
      expect(res.error.field).toBe("reason");
    }
    // Không nội dung, không vết — đúng nghĩa "không vòng qua được".
    expect(res).not.toHaveProperty("data");
    expect(h.writeAudit).not.toHaveBeenCalled();
    expect(h.messageFindMany).not.toHaveBeenCalled();
  });

  it("[AC1] reason rỗng / toàn khoảng trắng / quá ngắn qua action → từ chối, không đọc tin", async () => {
    loginAs(ADMIN);

    // Chuỗi 12 khoảng trắng nằm đây có chủ đích: nó DÀI hơn ngưỡng tối thiểu, nên chỉ
    // `.trim()` chạy TRƯỚC `.min()` mới loại được. Bỏ `.trim()` đi là ô này đỏ.
    for (const reason of ["", "   ", "\t\n  ", "            ", "ok", "xem thử"]) {
      const res = await adminLookupConversationAction({ conversationId: CONV_ID, reason });
      expect(res.ok, `reason=${JSON.stringify(reason)} phải bị từ chối`).toBe(false);
    }
    expect(h.writeAudit).not.toHaveBeenCalled();
    expect(h.messageFindMany).not.toHaveBeenCalled();
  });

  it("[AC5] QLCS đăng nhập, lý do tử tế → PERMISSION_DENIED, không audit, không đọc tin", async () => {
    loginAs(QLCS, "Chị Quản lý CS1");

    const res = await adminLookupConversationAction({
      conversationId: CONV_ID,
      reason: REASON,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PERMISSION_DENIED");
    expect(h.writeAudit).not.toHaveBeenCalled();
    expect(h.messageFindMany).not.toHaveBeenCalled();
  });

  it("Admin + lý do hợp lệ → ok, và audit ghi ĐÚNG NGƯỜI TRONG PHIÊN dù input khai tên khác", async () => {
    loginAs(ADMIN, "Admin HO");

    const res = await adminLookupConversationAction({
      conversationId: CONV_ID,
      reason: REASON,
      // Lời khai của client — phải bị bỏ qua hoàn toàn.
      userId: "ke-mao-danh",
      actorId: "ke-mao-danh",
      actorName: "Cô Lan",
    });

    expect(res.ok).toBe(true);
    // `resolveActor` gọi bằng id CỦA PHIÊN, không phải id trong input.
    expect(h.resolveActor).toHaveBeenCalledWith("admin-1");
    const params = h.writeAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(params.actor).toMatchObject({ id: "admin-1", name: "Admin HO" });
    expect(params.reason).toBe(REASON);
  });
});

describe("setConversationLockAction — bề mặt client gọi tới", () => {
  it("chưa đăng nhập → AUTH, KHÔNG đổi trạng thái hội thoại", async () => {
    const res = await setConversationLockAction({
      conversationId: CONV_ID,
      locked: true,
      reason: REASON,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("AUTH");
    expect(h.state.lockUpdates).toHaveLength(0);
  });

  it("thiếu lý do → VALIDATION, KHÔNG đổi trạng thái (nút UI không phải chốt chặn)", async () => {
    loginAs(ADMIN);

    const res = await setConversationLockAction({ conversationId: CONV_ID, locked: true });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION");
    expect(h.state.lockUpdates).toHaveLength(0);
  });

  it("[AC5] QLCS khoá hội thoại → PERMISSION_DENIED, KHÔNG đổi trạng thái", async () => {
    loginAs(QLCS, "Chị Quản lý CS1");

    const res = await setConversationLockAction({
      conversationId: CONV_ID,
      locked: true,
      reason: REASON,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PERMISSION_DENIED");
    expect(h.state.lockUpdates).toHaveLength(0);
  });

  it("[AC3] Admin + lý do → khoá thật, audit mang lý do nguyên văn", async () => {
    loginAs(ADMIN);

    const res = await setConversationLockAction({
      conversationId: CONV_ID,
      locked: true,
      reason: "Tạm khoá do tranh cãi trong nhóm, chờ ban giám hiệu làm việc",
    });

    expect(res.ok).toBe(true);
    expect(h.state.lockUpdates).toHaveLength(1);
    const params = h.writeAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(params.reason).toBe("Tạm khoá do tranh cãi trong nhóm, chờ ban giám hiệu làm việc");
  });
});
