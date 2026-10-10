// @vitest-environment node
/**
 * US-13 — `openDm`: mở (hoặc mở lại) hội thoại riêng GV↔PH.
 *
 * Hai tầng như khuôn `lib/chat/messages.test.ts`:
 *  • THUẦN — `dmKeyOf` (BR-06) và `openDmTargetOf` (target cho can()): không chạm DB.
 *  • PIPELINE — `openDmAsActor(actor, name, input)` với Prisma mock ⇒ chạy được ở mọi
 *    máy. Nghiệm thu trên DB thật nằm ở `tests/chat/permission-matrix.spec.ts`.
 *
 * Điểm phải giữ bằng mọi giá:
 *  • `dmKeyOf(a,b) === dmKeyOf(b,a)` — mất tính đối xứng là mất luôn chốt chống trùng.
 *  • Quan hệ dạy học hết hiệu lực → KHÔNG tạo mới, và hội thoại cũ chuyển ARCHIVED (AC3).
 *  • Hội thoại cũ đã lưu trữ → MỞ LẠI đúng nó, không tạo hội thoại thứ hai (AC2).
 *  • Đua tạo cùng lúc → P2002 → đọc lại, vẫn MỘT hội thoại (AC5).
 *  • DM luôn `centerId = null` — cơ chế deny QLCS.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    /** Lớp làm chứng trả về cho `findTeachingClassIds` (raw query). */
    teachingClassIds: [] as string[],
    /** Hướng quan hệ: "actorIsTeacher" | "actorIsParent" | "none". */
    relationDirection: "actorIsTeacher" as "actorIsTeacher" | "actorIsParent" | "none",
    peer: { id: "peer-1", name: "Người kia" } as Row | null,
    existingConversation: null as Row | null,
    /** Bật để `conversation.create` ném P2002 (mô phỏng đua 2 người bấm cùng lúc). */
    createThrowsP2002: false,
    /** Số lần `conversation.create` ĐƯỢC GỌI (kể cả lần ném P2002) — xem test AC5. */
    createAttempts: 0,
    /**
     * Hàng đợi kết quả cho `conversation.findUnique`, tiêu thụ THEO THỨ TỰ GỌI THẬT.
     * Rỗng → dùng `existingConversation`.
     *
     * ⚠️ Có BA lần gọi trên đường tạo mới, đếm nhầm là test xanh giả (đã dính 09/08):
     *   1) `loadOpenDmContext` đọc `existing` (trước cả `runAction`);
     *   2) `findOrCreateDm` đọc lại trước khi tạo;
     *   3) chỉ khi create ném P2002 — đọc lại lần nữa để lấy bản người kia vừa tạo.
     * Nạp thiếu một phần tử thì phần tử "bản của người kia" bị tiêu ở bước 2 ⇒ luồng đi
     * nhánh dùng lại và KHÔNG BAO GIỜ chạm nhánh P2002 mà test vẫn xanh.
     */
    findUniqueQueue: [] as (Row | null)[],
    created: [] as Row[],
    participantsCreated: [] as Row[],
    participantsReopened: [] as Row[],
    existingParticipants: [] as Row[],
    conversationUpdates: [] as Row[],
    archiveCalls: [] as Row[],
    rawCalls: [] as unknown[][],
  };

  const writeAudit = vi.fn(async (_params: Record<string, unknown>) => ({ id: "audit-1" }));

  const mockDb = {
    // `findTeachingClassIds` — tham số thứ 2 và 3 của template là teacher/parent id.
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ...args: unknown[]) => {
      state.rawCalls.push(args);
      const teacherArg = args[0];
      const isActorAsTeacher = teacherArg === "actor-1";
      if (state.relationDirection === "none") return [];
      if (state.relationDirection === "actorIsTeacher" && !isActorAsTeacher) return [];
      if (state.relationDirection === "actorIsParent" && isActorAsTeacher) return [];
      return state.teachingClassIds.map((id) => ({ id }));
    }),
    user: {
      findFirst: vi.fn(async () => state.peer),
    },
    conversation: {
      findUnique: vi.fn(async () =>
        state.findUniqueQueue.length > 0
          ? (state.findUniqueQueue.shift() ?? null)
          : state.existingConversation,
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        state.createAttempts += 1;
        if (state.createThrowsP2002) {
          const err = new Error("Unique constraint failed") as Error & { code: string };
          err.code = "P2002";
          throw err;
        }
        state.created.push(data);
        return { id: "conv-new", status: "ACTIVE" };
      }),
      update: vi.fn(async (args: Row) => {
        state.conversationUpdates.push(args);
        return { id: "conv-1" };
      }),
      updateMany: vi.fn(async (args: Row) => {
        state.archiveCalls.push(args);
        return { count: 1 };
      }),
    },
    conversationParticipant: {
      findMany: vi.fn(async () => state.existingParticipants),
      create: vi.fn(async ({ data }: { data: Row }) => {
        state.participantsCreated.push(data);
        return { id: `p-${state.participantsCreated.length}` };
      }),
      update: vi.fn(async (args: Row) => {
        state.participantsReopened.push(args);
        return { id: "p-x" };
      }),
    },
    message: { create: vi.fn(async () => ({ id: "msg-1" })) },
    // `runAction` gọi `scopedDb(actor)` → `db.$extends(...)`; DM không dùng tới client
    // scoped đó (mọi truy vấn của dm.ts đi `db` trần), nên trả về chính mock là đủ.
    $extends: () => mockDb,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
  } as unknown as Record<string, never>;

  return { state, mockDb, writeAudit };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.writeAudit }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import type { Actor } from "@/lib/auth/actor";
import {
  DM_KEY_SEPARATOR,
  dmKeyOf,
  openDmAsActor,
  openDmTargetOf,
} from "@/lib/chat/dm";

const ACTOR_ID = "actor-1";
const PEER_ID = "peer-1";

function actorWith(perm: { action: string; scopeType: string }, extra?: Partial<Actor>): Actor {
  return {
    userId: ACTOR_ID,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [
      {
        action: perm.action,
        scopeType: perm.scopeType as never,
        orgUnitId: "org-1",
        roleCode: "R",
        centerScope: null,
      },
    ],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
    ...extra,
  };
}

/** GV: `chat:send` scope ASSIGNED — chỉ khớp khi target.classId nằm trong lớp được phân công. */
const teacherActor = () =>
  actorWith({ action: "chat:send", scopeType: "ASSIGNED" }, {
    assignedClassIds: new Set(["lop-a"]),
  });

/** PH: `chat:send` scope OWN — khớp khi target.createdById là chính mình. */
const parentActor = () => actorWith({ action: "chat:send", scopeType: "OWN" });

/** QLCS: `chat:send` scope CENTER — DM có centerId=null nên LUÔN trượt. */
const centerManagerActor = () =>
  actorWith({ action: "chat:send", scopeType: "CENTER" }, {
    permissions: [
      {
        action: "chat:send",
        scopeType: "CENTER" as never,
        orgUnitId: "org-1",
        roleCode: "CENTER_MANAGER",
        centerScope: "ALL",
      },
    ],
  });

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(h.state, {
    teachingClassIds: ["lop-a"],
    relationDirection: "actorIsTeacher",
    peer: { id: PEER_ID, name: "Người kia" },
    existingConversation: null,
    createThrowsP2002: false,
    createAttempts: 0,
    findUniqueQueue: [],
    created: [],
    participantsCreated: [],
    participantsReopened: [],
    existingParticipants: [],
    conversationUpdates: [],
    archiveCalls: [],
    rawCalls: [],
  });
});

// ─── PHẦN THUẦN ─────────────────────────────────────────────────────────────

describe("dmKeyOf — BR-06", () => {
  it("đối xứng: đổi chỗ 2 userId vẫn ra CÙNG một khoá (chốt chống trùng của AC5)", () => {
    expect(dmKeyOf("zzz", "aaa")).toBe(dmKeyOf("aaa", "zzz"));
  });

  it("sort rồi nối bằng dấu phân cách đã công bố, kèm tiền tố loại", () => {
    expect(dmKeyOf("b", "a")).toBe(`TP${DM_KEY_SEPARATOR}a${DM_KEY_SEPARATOR}b`);
  });

  // F5 — điều kiện đã có thật, không phải giả định: repo cho phép đa vai, nên một nhân sự
  // kiêm TEACHER + SALES_CSM với CÙNG một phụ huynh sẽ đụng một khoá nếu thiếu tiền tố.
  // Hậu quả: hai kênh chung một Conversation, job đối soát archive nó khi hết quan hệ dạy
  // học và cắt luôn kênh tư vấn còn hiệu lực.
  it("CÙNG một cặp user nhưng KHÁC loại DM ⇒ khoá KHÁC nhau", () => {
    expect(dmKeyOf("u1", "u2", "SALE_PARENT")).not.toBe(dmKeyOf("u1", "u2", "TEACHER_PARENT"));
    expect(dmKeyOf("u2", "u1", "SALE_PARENT")).toBe(dmKeyOf("u1", "u2", "SALE_PARENT"));
  });

  it("mặc định là TEACHER_PARENT — mọi điểm gọi cũ giữ nguyên hành vi", () => {
    expect(dmKeyOf("u1", "u2")).toBe(dmKeyOf("u1", "u2", "TEACHER_PARENT"));
  });

  it("loại lạ thì ném lỗi, không âm thầm sinh khoá không tiền tố", () => {
    expect(() => dmKeyOf("u1", "u2", "KHONG_CO" as never)).toThrow();
  });

  it("tất định: gọi nhiều lần cho cùng kết quả", () => {
    expect(dmKeyOf("u1", "u2")).toBe(dmKeyOf("u1", "u2"));
  });

  it("từ chối tự nhắn chính mình và userId rỗng", () => {
    expect(() => dmKeyOf("u1", "u1")).toThrow();
    expect(() => dmKeyOf("", "u2")).toThrow();
    expect(() => dmKeyOf("u1", "   ")).toThrow();
  });
});

describe("openDmTargetOf — target cho can()", () => {
  it("centerId LUÔN null (cơ chế deny QLCS: scope CENTER đòi target.centerId)", () => {
    const t = openDmTargetOf(
      { teacherUserId: "t", parentUserId: "p", classIds: ["lop-a"] },
      teacherActor(),
    );
    expect(t?.centerId).toBeNull();
  });

  it("classId = lớp làm chứng (GV scope ASSIGNED khớp); không quan hệ → null", () => {
    expect(
      openDmTargetOf({ teacherUserId: "t", parentUserId: "p", classIds: ["lop-a"] }, teacherActor())
        ?.classId,
    ).toBe("lop-a");
    expect(openDmTargetOf(null, teacherActor())?.classId).toBeNull();
  });

  it("createdById = chính actor — PH nào bấm cũng qua cổng vai OWN, không chỉ người mở trước", () => {
    expect(openDmTargetOf(null, parentActor())?.createdById).toBe(ACTOR_ID);
  });
});

// ─── PIPELINE ───────────────────────────────────────────────────────────────

describe("openDm — pipeline", () => {
  it("GV mở với PH đang dạy con → tạo MỚI, type DM_TEACHER_PARENT, centerId null, 2 participant", async () => {
    const res = await openDmAsActor(teacherActor(), "GV A", { peerUserId: PEER_ID });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.created).toBe(true);
    expect(res.data.conversationId).toBe("conv-new");
    const data = h.state.created[0] as Record<string, unknown>;
    expect(data.type).toBe("DM_TEACHER_PARENT");
    expect(data.centerId).toBeNull();
    expect(data.dmKey).toBe(dmKeyOf(ACTOR_ID, PEER_ID));
    expect(h.state.participantsCreated).toHaveLength(2);
    expect(h.state.participantsCreated.map((p) => p.userId).sort()).toEqual(
      [ACTOR_ID, PEER_ID].sort(),
    );
  });

  it("PH mở với GV đang dạy con mình (chiều ngược lại) → ok", async () => {
    h.state.relationDirection = "actorIsParent";
    const res = await openDmAsActor(parentActor(), "PH A", { peerUserId: PEER_ID });
    expect(res.ok).toBe(true);
  });

  it("AC2 — hội thoại cũ ARCHIVED → MỞ LẠI đúng nó, KHÔNG tạo hội thoại thứ hai", async () => {
    h.state.existingConversation = { id: "conv-cu", status: "ARCHIVED" };
    const res = await openDmAsActor(teacherActor(), "GV A", { peerUserId: PEER_ID });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.conversationId).toBe("conv-cu");
    expect(res.data.created).toBe(false);
    expect(res.data.reopened).toBe(true);
    expect(res.data.status).toBe("ACTIVE");
    expect(h.state.created).toHaveLength(0);
    expect(h.state.conversationUpdates[0]).toMatchObject({
      data: { status: "ACTIVE", archivedAt: null },
    });
  });

  it("hội thoại đang LOCKED → KHÔNG tự mở khoá (khoá của Admin thắng)", async () => {
    h.state.existingConversation = { id: "conv-locked", status: "LOCKED" };
    const res = await openDmAsActor(teacherActor(), "GV A", { peerUserId: PEER_ID });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.status).toBe("LOCKED");
    expect(h.state.conversationUpdates).toHaveLength(0);
  });

  it("AC3 — hết quan hệ dạy học: từ chối PERMISSION_DENIED và ARCHIVE hội thoại cũ", async () => {
    h.state.relationDirection = "none";
    h.state.existingConversation = { id: "conv-cu", status: "ACTIVE" };
    // PH giữ scope OWN nên qua được cổng vai; chốt chặn là quan hệ trong handler.
    const res = await openDmAsActor(parentActor(), "PH A", { peerUserId: PEER_ID });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("PERMISSION_DENIED");
    expect(h.state.archiveCalls[0]).toMatchObject({
      where: { id: "conv-cu", status: "ACTIVE" },
      data: { status: "ARCHIVED" },
    });
    expect(h.state.created).toHaveLength(0);
  });

  it("GV không dạy con của PH → PERMISSION_DENIED ngay ở cổng vai (ASSIGNED không có classId)", async () => {
    h.state.relationDirection = "none";
    const res = await openDmAsActor(teacherActor(), "GV A", { peerUserId: PEER_ID });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("PERMISSION_DENIED");
    expect(h.state.created).toHaveLength(0);
  });

  it("QLCS (scope CENTER) → PERMISSION_DENIED vì DM có centerId = null", async () => {
    const res = await openDmAsActor(centerManagerActor(), "QLCS", { peerUserId: PEER_ID });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("PERMISSION_DENIED");
  });

  it("AC5 — đua: create ném P2002 → ĐỌC LẠI và trả CHÍNH hội thoại người kia vừa tạo", async () => {
    h.state.createThrowsP2002 = true;
    // 3 lần đọc, theo đúng thứ tự gọi thật (xem chú thích `findUniqueQueue`):
    // ctx → chưa có · trước khi tạo → vẫn chưa có · sau P2002 → bản của người kia.
    h.state.findUniqueQueue = [null, null, { id: "conv-cua-nguoi-kia", status: "ACTIVE" }];
    const res = await openDmAsActor(teacherActor(), "GV A", { peerUserId: PEER_ID });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.conversationId).toBe("conv-cua-nguoi-kia");
    expect(res.data.created).toBe(false);
    // Nhánh P2002 PHẢI thật sự chạy: create đã được gọi (và ném), không phải đi tắt
    // sang nhánh "dùng lại" vì mock trả sẵn hội thoại.
    expect(h.state.createAttempts).toBe(1);
    // Không có hội thoại thứ hai nào được ghi nhận.
    expect(h.state.created).toHaveLength(0);
  });

  it("tự nhắn chính mình → DM_SELF, không tạo gì", async () => {
    // Dùng actor PH (scope OWN, luôn qua cổng vai) để thấy ĐÚNG mã lỗi của handler —
    // với GV thì `target.classId` null nên đã rụng sớm hơn ở `can()`.
    const res = await openDmAsActor(parentActor(), "PH A", { peerUserId: ACTOR_ID });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("DM_SELF");
    expect(h.state.created).toHaveLength(0);
  });

  it("người nhận không tồn tại / đã khoá → PEER_NOT_FOUND", async () => {
    h.state.peer = null;
    // SUPER_ADMIN để chắc chắn không dừng ở cổng vai — cái ta muốn thấy là mã lỗi handler.
    const admin = { ...teacherActor(), isSuperAdmin: true };
    const res = await openDmAsActor(admin, "Admin", { peerUserId: PEER_ID });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("PEER_NOT_FOUND");
  });

  it("thiếu peerUserId → VALIDATION (zod), không chạm DB", async () => {
    const res = await openDmAsActor(teacherActor(), "GV A", {});
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION");
    expect(h.state.created).toHaveLength(0);
  });

  it("audit ghi 1 dòng module=chat, entityType=Conversation, KHÔNG chứa nội dung", async () => {
    await openDmAsActor(teacherActor(), "GV A", { peerUserId: PEER_ID });
    expect(h.writeAudit).toHaveBeenCalledTimes(1);
    const arg = h.writeAudit.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(arg.module).toBe("chat");
    expect(arg.entityType).toBe("Conversation");
    expect(arg.orgUnitId).toBeNull();
  });
});
