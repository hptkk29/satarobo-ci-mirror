// @vitest-environment node
/**
 * US-10 — ANNOUNCEMENT: gửi (F-ANN) + đánh dấu đã đọc + thống kê đã-đọc.
 *
 * Hai tầng, đúng khuôn `lib/chat/messages.test.ts`:
 *  • THUẦN — `vnDayWindow` / `checkAnnouncementQuota` / `isAnnouncementRecipient` /
 *    `buildReadStats`: quyết định từ dữ liệu đã đọc, không chạm DB, không phụ thuộc
 *    timezone của tiến trình.
 *  • PIPELINE — `sendAnnouncementAsActor(actor, name, input)` với Actor seed; DB mock
 *    ở mức Prisma client nên chạy được ở MỌI máy (nghiệm thu DB thật:
 *    scripts/_zztest-chat-us10.ts).
 *
 * Điểm phải giữ bằng mọi giá:
 *  • PH KHÔNG gửi được ANNOUNCEMENT — PERMISSION_DENIED [TS-03.1b], GV/QLCS gửi được.
 *  • Quota 10/ngày/LỚP đếm theo **ngày VN**: máy chạy UTC (Vercel) và máy dev (+07)
 *    phải cho CÙNG một cửa sổ. Đây là bẫy TZ đã burn ở lịch buổi học (lib/time/vn.ts).
 *  • Danh sách "chưa đọc" KHÔNG BAO GIỜ mang SĐT/email (BR-30) — kể cả khi SĐT nằm
 *    ngay trong `User.name` (tài khoản sinh từ lead cũ hay có dạng "PH 0905123456").
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock hạ tầng (hoisted — vi.mock chạy trước mọi import) ──────────────────
const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    ctxRow: null as Row | null,
    sentToday: 0,
    seq: 0,
    created: [] as Row[],
    convUpdates: [] as Row[],
    unreadUpdates: [] as Row[],
    recipientQueries: [] as Row[],
    /** Thành viên hội thoại — nguồn dữ liệu THẬT cho `conversationParticipant.findMany`. */
    participants: [] as { userId: string; leftAt: Date | null }[],
    txOptions: null as Row | null,
    txCalls: 0,
    rateCalls: [] as { key: string; max: number; windowMs: number }[],
  };
  const mockDb: Record<string, unknown> = {
    $extends: () => mockDb,
    $queryRaw: vi.fn(async () => (state.ctxRow ? [state.ctxRow] : [])),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>, opts?: Row) => {
      state.txCalls += 1;
      state.txOptions = opts ?? null;
      return fn(mockDb);
    }),
    message: {
      count: vi.fn(async () => state.sentToday),
      create: vi.fn(async ({ data }: { data: Row }) => {
        state.seq += 1;
        const row = {
          id: `ann-${state.seq}`,
          createdAt: new Date("2026-08-09T03:00:00.000Z"),
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
      // người không đáng nhận lọt thẳng vào mảng broadcast.
      findMany: vi.fn(async (args: Row) => {
        state.recipientQueries.push(args);
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
    publishEvent: vi.fn(async () => ({ id: "evt-1" })),
    writeAudit: vi.fn(async () => ({})),
    // Rate limit (F-ANN kế thừa F-SEND bước 4) — mock để test không phụ thuộc bộ đếm
    // in-memory dùng chung giữa các `it` (20 lượt/phút sẽ cạn giữa chừng và biến cả
    // file thành flake theo THỨ TỰ chạy). Mặc định luôn cho qua; test nào cần chặn thì
    // tự `mockResolvedValueOnce`.
    rateLimit: vi.fn(async (args: { key: string; max: number; windowMs: number }) => {
      state.rateCalls.push(args);
      return { success: true, remaining: args.max - 1, resetAt: Date.now() + args.windowMs };
    }),
  };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.writeAudit }));
// `broadcastMessages` = primitive DUY NHẤT gọi HTTP (1 POST cho cả `conv:` lẫn N `user:`);
// hai builder còn lại là hàm THUẦN, dựng lại y hệt bản thật để soi hình dạng mảng.
vi.mock("@/lib/chat/broadcast", () => ({
  broadcastMessages: h.broadcast,
  broadcastToConversation: h.broadcast,
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
vi.mock("@/lib/events/publish", () => ({ publishEvent: h.publishEvent }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: h.rateLimit }));
// Không kéo next-auth vào test node (lõi nhận Actor seed, không cần phiên thật).
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import { buildActor, type UserOrgRoleRow } from "@/lib/auth/actor";
import type { OrgUnitNode } from "@/lib/org/types";
import { ROLE_SEED } from "../../prisma/seed-roles";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_DAILY_QUOTA,
  ANNOUNCEMENT_RATE_MAX,
  ANNOUNCEMENT_RATE_WINDOW_MS,
  announcementRateKey,
  buildReadStats,
  checkAnnouncementQuota,
  isAnnouncementRecipient,
  sendAnnouncementAsActor,
  sendAnnouncementSchema,
  vnDayWindow,
} from "./announcements";

// ═════════════════════════════════════════════════════════════════════════════
// TẦNG THUẦN — ranh giới ngày VN
// ═════════════════════════════════════════════════════════════════════════════

describe("[US-10][AC2] vnDayWindow — cửa sổ 'hôm nay' theo giờ VN, độc lập TZ tiến trình", () => {
  // Mọi mốc dưới đây ghi bằng UTC tuyệt đối: test cho CÙNG kết quả trên máy dev
  // (+07) và trên Vercel/CI (UTC). Nếu ai đó thay bằng new Date(y,m,d) trần thì
  // bộ này đỏ NGAY trên CI — đúng chỗ bug lịch buổi học từng lọt.
  it("giữa trưa VN 09/08 → cửa sổ [08/08 17:00Z, 09/08 17:00Z)", () => {
    const w = vnDayWindow(new Date("2026-08-09T05:00:00.000Z")); // 12:00 VN 09/08
    expect(w.start.toISOString()).toBe("2026-08-08T17:00:00.000Z");
    expect(w.endExclusive.toISOString()).toBe("2026-08-09T17:00:00.000Z");
  });

  it("23:59:59.999 VN 09/08 (16:59:59.999Z) VẪN thuộc ngày 09/08", () => {
    const w = vnDayWindow(new Date("2026-08-09T16:59:59.999Z"));
    expect(w.start.toISOString()).toBe("2026-08-08T17:00:00.000Z");
    expect(w.endExclusive.toISOString()).toBe("2026-08-09T17:00:00.000Z");
  });

  it("ĐÚNG 00:00 VN 10/08 (17:00:00Z) → đã SANG ngày mới, quota reset", () => {
    const w = vnDayWindow(new Date("2026-08-09T17:00:00.000Z"));
    expect(w.start.toISOString()).toBe("2026-08-09T17:00:00.000Z");
    expect(w.endExclusive.toISOString()).toBe("2026-08-10T17:00:00.000Z");
  });

  it("00:30 giờ MÁY-UTC (07:30 VN cùng ngày) không bị tính sang hôm qua", () => {
    // Bẫy cũ: `new Date(y, m, d)` trên máy UTC lấy ngày UTC ⇒ 07:30 VN 09/08 rơi vào
    // cửa sổ "08/08" vì UTC vẫn là 00:30 ngày 09 — sai lệch nửa ngày cho quota.
    const w = vnDayWindow(new Date("2026-08-09T00:30:00.000Z"));
    expect(w.start.toISOString()).toBe("2026-08-08T17:00:00.000Z");
    expect(w.endExclusive.toISOString()).toBe("2026-08-09T17:00:00.000Z");
  });

  it("cửa sổ luôn dài đúng 24 giờ (VN không có DST)", () => {
    for (const iso of ["2026-01-01T00:00:00.000Z", "2026-06-15T12:00:00.000Z", "2026-12-31T23:59:59.999Z"]) {
      const w = vnDayWindow(new Date(iso));
      expect(w.endExclusive.getTime() - w.start.getTime()).toBe(24 * 60 * 60_000);
      expect(w.start.getTime()).toBeLessThanOrEqual(new Date(iso).getTime());
      expect(w.endExclusive.getTime()).toBeGreaterThan(new Date(iso).getTime());
    }
  });
});

describe("[US-10][AC2] checkAnnouncementQuota — 10/ngày/lớp, vượt kèm gợi ý gộp", () => {
  const NOW = new Date("2026-08-09T05:00:00.000Z"); // 12:00 VN 09/08

  it("0..9 thông báo trong ngày → còn gửi được", () => {
    for (let n = 0; n < ANNOUNCEMENT_DAILY_QUOTA; n++) {
      expect(checkAnnouncementQuota(n, NOW)).toBeNull();
    }
  });

  it(`đủ ${ANNOUNCEMENT_DAILY_QUOTA} → ANNOUNCEMENT_QUOTA_EXCEEDED`, () => {
    const err = checkAnnouncementQuota(ANNOUNCEMENT_DAILY_QUOTA, NOW);
    expect(err?.code).toBe("ANNOUNCEMENT_QUOTA_EXCEEDED");
  });

  it("thông điệp có gợi ý GỘP nội dung + nêu đúng ngày VN (09/08/2026, không phải 08/08)", () => {
    const err = checkAnnouncementQuota(ANNOUNCEMENT_DAILY_QUOTA, new Date("2026-08-09T16:30:00.000Z"));
    expect(err?.message).toMatch(/gộp/i);
    expect(err?.message).toContain("09/08/2026");
  });

  it("vượt hẳn (11, 20) vẫn cùng mã lỗi — không có đường lách", () => {
    expect(checkAnnouncementQuota(11, NOW)?.code).toBe("ANNOUNCEMENT_QUOTA_EXCEEDED");
    expect(checkAnnouncementQuota(20, NOW)?.code).toBe("ANNOUNCEMENT_QUOTA_EXCEEDED");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TẦNG THUẦN — ai là NGƯỜI NHẬN + thống kê đã đọc (AC4 + BR-30)
// ═════════════════════════════════════════════════════════════════════════════

describe("[US-10][AC4] isAnnouncementRecipient — mẫu số 'đã đọc x/N' chỉ đếm PH", () => {
  it("PH của học viên trong lớp → là người nhận", () => {
    expect(isAnnouncementRecipient({ derivedFrom: "CLASS_STUDENT_PARENT" })).toBe(true);
  });

  it("GV và QLCS KHÔNG vào mẫu số (họ là người gửi, không phải người nhận)", () => {
    expect(isAnnouncementRecipient({ derivedFrom: "CLASS_TEACHER" })).toBe(false);
    expect(isAnnouncementRecipient({ derivedFrom: "CENTER_MANAGER" })).toBe(false);
  });

  it("participant thêm TAY (derivedFrom null) — quyết theo vai tài khoản", () => {
    // Không có dòng này thì nhóm dựng bằng tay ra "đã đọc 0/0" — con số vô nghĩa.
    expect(isAnnouncementRecipient({ derivedFrom: null, role: "PARENT" })).toBe(true);
    expect(isAnnouncementRecipient({ derivedFrom: null, roles: ["PARENT"] })).toBe(true);
    expect(isAnnouncementRecipient({ derivedFrom: null, role: "TEACHER" })).toBe(false);
    expect(isAnnouncementRecipient({ derivedFrom: null })).toBe(false); // không rõ → không đếm
  });

  it("derivedFrom THẮNG vai tài khoản: GV kiêm PH đứng trong nhóm với tư cách GV → không đếm", () => {
    expect(
      isAnnouncementRecipient({ derivedFrom: "CLASS_TEACHER", role: "PARENT", roles: ["PARENT", "TEACHER"] }),
    ).toBe(false);
  });
});

describe("[US-10][AC4][BR-30] buildReadStats — 'đã đọc x/N' + danh sách chưa đọc", () => {
  const recipients = [
    { userId: "ph1", name: "Nguyễn Văn A" },
    { userId: "ph2", name: "Trần Thị B" },
    { userId: "ph3", name: "Lê Văn C" },
  ];

  it("readCount / totalRecipients / unreadMembers khớp nhau", () => {
    const s = buildReadStats({ messageId: "m1", recipients, readUserIds: ["ph1"] });
    expect(s.readCount).toBe(1);
    expect(s.totalRecipients).toBe(3);
    expect(s.unreadMembers.map((m) => m.userId).sort()).toEqual(["ph2", "ph3"]);
  });

  it("người ĐÃ ĐỌC mà KHÔNG phải người nhận (GV bấm xem) không làm phồng readCount", () => {
    const s = buildReadStats({ messageId: "m1", recipients, readUserIds: ["ph1", "gv1", "ql1"] });
    expect(s.readCount).toBe(1); // chỉ ph1 — gv1/ql1 không nằm trong mẫu số
    expect(s.readCount).toBeLessThanOrEqual(s.totalRecipients);
  });

  it("tất cả đã đọc → unreadMembers rỗng; chưa ai đọc → đủ danh sách", () => {
    expect(buildReadStats({ messageId: "m1", recipients, readUserIds: ["ph1", "ph2", "ph3"] }).unreadMembers).toEqual([]);
    expect(buildReadStats({ messageId: "m1", recipients, readUserIds: [] }).unreadMembers).toHaveLength(3);
  });

  it("đọc TRÙNG (2 bản ghi cùng user) chỉ đếm 1 lần", () => {
    const s = buildReadStats({ messageId: "m1", recipients, readUserIds: ["ph1", "ph1"] });
    expect(s.readCount).toBe(1);
  });

  it("[BR-30] SĐT nằm trong TÊN hiển thị bị che — không rò qua đường tên", () => {
    const s = buildReadStats({
      messageId: "m1",
      recipients: [{ userId: "ph9", name: "PH Hai 0900008822" }],
      readUserIds: [],
    });
    expect(s.unreadMembers[0]?.displayName).toBe("PH Hai •••");
    expect(s.unreadMembers[0]?.displayName).not.toContain("0900008822");
  });

  it("[BR-30] email trong tên cũng bị che", () => {
    const s = buildReadStats({
      messageId: "m1",
      recipients: [{ userId: "ph9", name: "phhai@example.com" }],
      readUserIds: [],
    });
    expect(s.unreadMembers[0]?.displayName).not.toContain("@example.com");
  });

  it("[BR-30] payload chỉ có userId + displayName — KHÔNG khoá liên hệ nào (duyệt sâu)", () => {
    const s = buildReadStats({
      messageId: "m1",
      recipients: [{ userId: "ph9", name: "Nguyễn Văn A" }],
      readUserIds: [],
    });
    expect(Object.keys(s.unreadMembers[0] ?? {}).sort()).toEqual(["displayName", "userId"]);
    const json = JSON.stringify(s.unreadMembers);
    expect(json).not.toMatch(/phone|email|sdt|address/i);
    expect(json).not.toMatch(/(?<![0-9])(?:\+?84|0)(?:3|5|7|8|9)[0-9]{8}(?![0-9])/);
  });

  it("tên rỗng/null → 'Thành viên', KHÔNG rơi về SĐT/email làm tên", () => {
    const s = buildReadStats({
      messageId: "m1",
      recipients: [
        { userId: "ph9", name: null },
        { userId: "ph8", name: "   " },
      ],
      readUserIds: [],
    });
    expect(s.unreadMembers.every((m) => m.displayName === "Thành viên")).toBe(true);
  });

  it("thứ tự chưa-đọc tất định (theo tên) — danh sách không nhảy giữa 2 lần tải", () => {
    const a = buildReadStats({ messageId: "m1", recipients, readUserIds: [] });
    const b = buildReadStats({
      messageId: "m1",
      recipients: [...recipients].reverse(),
      readUserIds: [],
    });
    expect(a.unreadMembers).toEqual(b.unreadMembers);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TẦNG PIPELINE — runAction qua sendAnnouncementAsActor (Actor seed, không HTTP)
// ═════════════════════════════════════════════════════════════════════════════

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

function input(over: Record<string, unknown> = {}) {
  return { conversationId: CONV, body: "Thứ 7 này lớp nghỉ, bù vào Chủ nhật.", ...over };
}

/** Một phần tử trong mảng `messages` của lời gọi `broadcastMessages`. */
type BroadcastCall = { topic: string; event: string; payload: Record<string, unknown> };

/** Mảng gửi đi ở lời gọi broadcast thứ `n` (mặc định lời gọi đầu). */
function sentBroadcasts(n = 0): BroadcastCall[] {
  return (h.broadcast.mock.calls[n] as unknown as [BroadcastCall[]])[0];
}

beforeEach(() => {
  h.state.ctxRow = ctxRow();
  h.state.sentToday = 0;
  h.state.seq = 0;
  h.state.created = [];
  h.state.convUpdates = [];
  h.state.unreadUpdates = [];
  h.state.recipientQueries = [];
  h.state.participants = [
    { userId: "ph-khac", leftAt: null },
    { userId: "gv-khac", leftAt: null },
  ];
  h.state.txOptions = null;
  h.state.txCalls = 0;
  h.state.rateCalls = [];
  h.rateLimit.mockClear();
  h.broadcast.mockClear();
  h.broadcast.mockImplementation(async () => true);
  h.publishEvent.mockClear();
  h.writeAudit.mockClear();
});

describe("[US-10][AC1] cổng vai — chỉ GV/QLCS/Admin gửi được ANNOUNCEMENT", () => {
  it("[TS-03.1b] PH gửi ANNOUNCEMENT → PERMISSION_DENIED, KHÔNG ghi tin nào", async () => {
    const actor = actorOf("PARENT", "cs1", "ph-ann");
    const res = await sendAnnouncementAsActor(actor, "PH Test", input());

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("PERMISSION_DENIED");
    expect(h.state.created).toHaveLength(0);
    expect(h.state.txCalls).toBe(0);
    expect(h.broadcast).not.toHaveBeenCalled();
  });

  it("[TS-03.2a] GV lớp mình dạy → ok, kind=ANNOUNCEMENT", async () => {
    const actor = actorOf("TEACHER", "cs1", "gv-ann", ["lopA"]);
    const res = await sendAnnouncementAsActor(actor, "GV Test", input());

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.kind).toBe("ANNOUNCEMENT");
    expect(res.data.senderId).toBe("gv-ann");
    expect(h.state.created[0]).toMatchObject({ kind: "ANNOUNCEMENT", senderId: "gv-ann" });
  });

  it("[TS-03.2b] GV lớp KHÔNG dạy → PERMISSION_DENIED (scope ASSIGNED trượt)", async () => {
    const actor = actorOf("TEACHER", "cs1", "gv-khac", ["lopKhac"]);
    const res = await sendAnnouncementAsActor(actor, "GV Test", input());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("PERMISSION_DENIED");
  });

  it("[TS-03.3a] QLCS lớp cơ sở mình → ok", async () => {
    const actor = actorOf("CENTER_MANAGER", "cs1", "ql-ann");
    const res = await sendAnnouncementAsActor(actor, "QLCS Test", input());
    expect(res.ok).toBe(true);
  });

  it("[TS-03.3b] QLCS sang lớp cơ sở KHÁC → PERMISSION_DENIED", async () => {
    h.state.ctxRow = ctxRow({ centerId: "c2" });
    const actor = actorOf("CENTER_MANAGER", "cs1", "ql-cheo");
    const res = await sendAnnouncementAsActor(actor, "QLCS Test", input());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("PERMISSION_DENIED");
  });

  it("[TS-01.6] Sale → PERMISSION_DENIED", async () => {
    const actor = actorOf("CENTER_SALES_CSM", "cs1", "sale-ann");
    const res = await sendAnnouncementAsActor(actor, "Sale Test", input());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("PERMISSION_DENIED");
  });
});

describe("[US-10] ghi tin như tin thường: lastMessageAt + unreadCount + transaction", () => {
  it("unreadCount +1 cho MỌI thành viên còn hiệu lực TRỪ người gửi", async () => {
    const actor = actorOf("TEACHER", "cs1", "gv-unread", ["lopA"]);
    await sendAnnouncementAsActor(actor, "GV Test", input());

    expect(h.state.convUpdates).toHaveLength(1);
    expect(h.state.unreadUpdates).toHaveLength(1);
    const where = (h.state.unreadUpdates[0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ conversationId: CONV, leftAt: null });
    expect(where.userId).toEqual({ not: "gv-unread" });
    const data = (h.state.unreadUpdates[0] as { data: Record<string, unknown> }).data;
    expect(data).toEqual({ unreadCount: { increment: 1 } });
  });

  it("transaction đặt timeout 30s / maxWait 10s (luật E-bis #2)", async () => {
    const actor = actorOf("TEACHER", "cs1", "gv-tx", ["lopA"]);
    await sendAnnouncementAsActor(actor, "GV Test", input());
    expect(h.state.txOptions).toEqual({ timeout: 30_000, maxWait: 10_000 });
  });

  it("ghi AuditLog module=chat/entityType=Message/action=CREATE, KHÔNG kèm nội dung", async () => {
    const actor = actorOf("TEACHER", "cs1", "gv-audit", ["lopA"]);
    await sendAnnouncementAsActor(actor, "GV Test", input());

    expect(h.writeAudit).toHaveBeenCalledTimes(1);
    const arg = (h.writeAudit.mock.calls as unknown as Record<string, unknown>[][])[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(arg).toMatchObject({ module: "chat", entityType: "Message", action: "CREATE" });
    expect(JSON.stringify(arg.newValues)).not.toContain("Chủ nhật");
  });
});

describe("[US-10][AC2] quota 10 ANNOUNCEMENT/ngày/lớp", () => {
  it(`đã có ${ANNOUNCEMENT_DAILY_QUOTA} thông báo hôm nay → cái thứ ${ANNOUNCEMENT_DAILY_QUOTA + 1} bị chặn, không ghi gì`, async () => {
    h.state.sentToday = ANNOUNCEMENT_DAILY_QUOTA;
    const actor = actorOf("TEACHER", "cs1", "gv-quota", ["lopA"]);
    const res = await sendAnnouncementAsActor(actor, "GV Test", input());

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("ANNOUNCEMENT_QUOTA_EXCEEDED");
    expect(res.error.message).toMatch(/gộp/i);
    expect(h.state.created).toHaveLength(0);
    expect(h.state.convUpdates).toHaveLength(0);
    expect(h.broadcast).not.toHaveBeenCalled();
  });

  it(`cái thứ ${ANNOUNCEMENT_DAILY_QUOTA} (đã có ${ANNOUNCEMENT_DAILY_QUOTA - 1}) vẫn qua — biên không lệch 1`, async () => {
    h.state.sentToday = ANNOUNCEMENT_DAILY_QUOTA - 1;
    const actor = actorOf("TEACHER", "cs1", "gv-quota-bien", ["lopA"]);
    const res = await sendAnnouncementAsActor(actor, "GV Test", input());
    expect(res.ok).toBe(true);
  });

  it("đếm quota theo cửa sổ ngày VN của CHÍNH hội thoại đó (where có conversationId + kind + khoảng ngày)", async () => {
    const actor = actorOf("TEACHER", "cs1", "gv-quota-where", ["lopA"]);
    await sendAnnouncementAsActor(actor, "GV Test", input());

    const countFn = (h.mockDb.message as { count: { mock: { calls: unknown[][] } } }).count;
    const arg = countFn.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(arg.where.conversationId).toBe(CONV);
    expect(arg.where.kind).toBe("ANNOUNCEMENT");
    const createdAt = arg.where.createdAt as { gte: Date; lt: Date };
    expect(createdAt.lt.getTime() - createdAt.gte.getTime()).toBe(24 * 60 * 60_000);
    // Mốc phải rơi đúng 17:00Z (= 00:00 VN) — nếu ai dùng UTC ngày trần thì là 00:00Z.
    expect(createdAt.gte.getUTCHours()).toBe(17);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-ANN kế thừa **bước 4 của F-SEND**: rate limit 20/phút/NGƯỜI (vá 09/08/2026).
//
// Trước đó `sendAnnouncement` không gọi `rateLimit` lần nào. Quota 10/ngày/lớp KHÔNG
// bịt được khe này: quota đếm theo HỘI THOẠI, nên một GV dạy 10 lớp bắn 10 thông báo
// trong 2 giây vẫn hợp quota — 10 lượt ghi + 10 broadcast + 10 DomainEvent tức thì.
// ─────────────────────────────────────────────────────────────────────────────
describe("[US-10] rate limit 20 thông báo/phút/người (F-SEND bước 4)", () => {
  it("khoá bộ đếm là chat:announce:<userId> — RIÊNG, không dùng chung với chat:send", () => {
    expect(announcementRateKey("u-1")).toBe("chat:announce:u-1");
    expect(announcementRateKey("u-1")).not.toContain("chat:send");
  });

  it("gửi hợp lệ → có gọi rateLimit đúng khoá/ngưỡng/cửa sổ của CHÍNH người gửi", async () => {
    const actor = actorOf("TEACHER", "cs1", "gv-rate", ["lopA"]);
    const res = await sendAnnouncementAsActor(actor, "GV Test", input());

    expect(res.ok).toBe(true);
    expect(h.state.rateCalls).toEqual([
      {
        key: "chat:announce:gv-rate",
        max: ANNOUNCEMENT_RATE_MAX,
        windowMs: ANNOUNCEMENT_RATE_WINDOW_MS,
      },
    ]);
    expect(ANNOUNCEMENT_RATE_MAX).toBe(20);
    expect(ANNOUNCEMENT_RATE_WINDOW_MS).toBe(60_000);
  });

  it("hết lượt → RATE_LIMITED, KHÔNG mở transaction, KHÔNG ghi tin, KHÔNG broadcast/event", async () => {
    h.rateLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      resetAt: Date.now() + 42_000,
    });
    const actor = actorOf("TEACHER", "cs1", "gv-rate", ["lopA"]);
    const res = await sendAnnouncementAsActor(actor, "GV Test", input());

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("RATE_LIMITED");
    expect(res.error.message).toContain("thử lại sau"); // nói rõ chờ bao lâu
    expect(h.state.txCalls).toBe(0);
    expect(h.state.created).toHaveLength(0);
    expect(h.broadcast).not.toHaveBeenCalled();
    expect(h.publishEvent).not.toHaveBeenCalled();
  });

  it("rate limit chạy TRƯỚC quota — quota đã cạn vẫn báo RATE_LIMITED, và không mở tx để đếm", async () => {
    // Quota cũng đã cạn: nếu thứ tự đảo, mã lỗi sẽ là ANNOUNCEMENT_QUOTA_EXCEEDED.
    h.state.sentToday = ANNOUNCEMENT_DAILY_QUOTA;
    h.rateLimit.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: Date.now() + 1_000 });
    const actor = actorOf("CENTER_MANAGER", "cs1", "ql-rate");
    const res = await sendAnnouncementAsActor(actor, "QLCS Test", input());

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("RATE_LIMITED");
    // Quota đếm BÊN TRONG transaction ⇒ không mở tx nghĩa là chưa hề đụng tới quota.
    expect(h.state.txCalls).toBe(0);
  });

  it("bị chặn ở cổng VAI (PH/Sale) thì KHÔNG tiêu lượt của ai — rate limit nằm sau can()", async () => {
    const res = await sendAnnouncementAsActor(
      actorOf("PARENT", "cs1", "ph-rate"),
      "PH Test",
      input(),
    );
    expect(res.ok).toBe(false);
    expect(h.rateLimit).not.toHaveBeenCalled();
  });

  it("bộ đếm theo NGƯỜI: 2 người gửi vào CÙNG hội thoại → 2 khoá khác nhau", async () => {
    await sendAnnouncementAsActor(actorOf("TEACHER", "cs1", "gv-a", ["lopA"]), "A", input());
    await sendAnnouncementAsActor(actorOf("TEACHER", "cs1", "gv-b", ["lopA"]), "B", input());
    expect(h.state.rateCalls.map((c) => c.key)).toEqual([
      "chat:announce:gv-a",
      "chat:announce:gv-b",
    ]);
  });
});

describe("[US-10] guard F-SEND dùng lại nguyên vẹn (mã lỗi PHÂN BIỆT)", () => {
  it("GV đã rời nhóm → NOT_PARTICIPANT (không phải PERMISSION_DENIED)", async () => {
    h.state.ctxRow = ctxRow({ participantLeftAt: new Date() });
    const actor = actorOf("TEACHER", "cs1", "gv-left", ["lopA"]);
    const res = await sendAnnouncementAsActor(actor, "GV Test", input());

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_PARTICIPANT");
    expect(h.state.created).toHaveLength(0);
  });

  it("hội thoại ARCHIVED → CONVERSATION_ARCHIVED", async () => {
    h.state.ctxRow = ctxRow({ status: "ARCHIVED" });
    const actor = actorOf("TEACHER", "cs1", "gv-arch", ["lopA"]);
    const res = await sendAnnouncementAsActor(actor, "GV Test", input());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("CONVERSATION_ARCHIVED");
  });

  it("hội thoại LOCKED → CONVERSATION_LOCKED, kể cả GV", async () => {
    h.state.ctxRow = ctxRow({ status: "LOCKED" });
    const actor = actorOf("TEACHER", "cs1", "gv-lock", ["lopA"]);
    const res = await sendAnnouncementAsActor(actor, "GV Test", input());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("CONVERSATION_LOCKED");
  });
});

describe("[US-10] schema", () => {
  it("body rỗng/toàn khoảng trắng → VALIDATION", () => {
    expect(sendAnnouncementSchema.safeParse(input({ body: "   " })).success).toBe(false);
  });

  it(`body > ${ANNOUNCEMENT_BODY_MAX} ký tự → VALIDATION ở field body`, () => {
    const res = sendAnnouncementSchema.safeParse(input({ body: "a".repeat(ANNOUNCEMENT_BODY_MAX + 1) }));
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path.join(".")).toBe("body");
  });

  it("body được trim trước khi ghi", () => {
    const res = sendAnnouncementSchema.safeParse(input({ body: "  nghỉ lễ  " }));
    expect(res.data?.body).toBe("nghỉ lễ");
  });
});

describe("[US-10][AC3][AC5] broadcast + điểm móc push (US-14 Đợt 2)", () => {
  it("broadcast SAU commit, event announcement.created, payload không rỗng", async () => {
    const actor = actorOf("TEACHER", "cs1", "gv-bc", ["lopA"]);
    await sendAnnouncementAsActor(actor, "GV Test", input());

    expect(h.broadcast).toHaveBeenCalledTimes(1);
    const conv = sentBroadcasts()[0] as BroadcastCall;
    expect(conv.topic).toBe(`conv:${CONV}`);
    expect(conv.event).toBe("announcement.created");
    expect(conv.payload.kind).toBe("ANNOUNCEMENT");
    expect(conv.payload.id).toBe("ann-1");
  });

  it("MỘT POST duy nhất: kèm N phần tử user:{id} event conversation.bumped, KHÔNG kèm nội dung (BR-30)", async () => {
    const actor = actorOf("TEACHER", "cs1", "gv-bump", ["lopA"]);
    await sendAnnouncementAsActor(actor, "GV Test", input());

    expect(h.broadcast).toHaveBeenCalledTimes(1);
    const bumps = sentBroadcasts().filter((m) => m.topic.startsWith("user:"));
    expect(bumps.map((m) => m.topic)).toEqual(["user:ph-khac", "user:gv-khac"]);
    for (const b of bumps) {
      expect(b.event).toBe("conversation.bumped");
      expect(Object.keys(b.payload).sort()).toEqual(["at", "conversationId", "kind", "messageId"]);
      expect(b.payload.kind).toBe("ANNOUNCEMENT");
      expect(JSON.stringify(b.payload)).not.toContain("lớp nghỉ");
    }
  });

  it("người nhận bump đọc TRONG tx, đúng điều kiện leftAt=null + loại người gửi", async () => {
    const actor = actorOf("TEACHER", "cs1", "gv-recip", ["lopA"]);
    await sendAnnouncementAsActor(actor, "GV Test", input());

    expect(h.state.recipientQueries).toHaveLength(1);
    const where = (h.state.recipientQueries[0] as { where: Record<string, unknown> }).where;
    expect(where.conversationId).toBe(CONV);
    expect(where.leftAt).toBeNull();
    expect(where.userId).toEqual({ not: "gv-recip" });
  });

  it("người ĐÃ RỜI nhóm và CHÍNH người gửi KHÔNG nhận bump (lọc thật, không chỉ soi đối số)", async () => {
    h.state.participants = [
      { userId: "ph-khac", leftAt: null },
      { userId: "gv-khac", leftAt: null },
      // PH chuyển lớp giữa kỳ — thông báo của lớp cũ không được đánh thức máy họ nữa.
      { userId: "ph-da-roi", leftAt: new Date("2026-07-01T00:00:00.000Z") },
      { userId: "gv-loc", leftAt: null },
    ];

    const actor = actorOf("TEACHER", "cs1", "gv-loc", ["lopA"]);
    await sendAnnouncementAsActor(actor, "GV Test", input());

    const topics = sentBroadcasts()
      .filter((m) => m.topic.startsWith("user:"))
      .map((m) => m.topic);
    expect(topics).toEqual(["user:ph-khac", "user:gv-khac"]);
    expect(topics).not.toContain("user:ph-da-roi");
    expect(topics).not.toContain("user:gv-loc");
  });

  it("broadcast NÉM lỗi → thông báo VẪN ghi, action VẪN ok (AC3/TS-12)", async () => {
    h.broadcast.mockImplementation(async () => {
      throw new Error("realtime sập");
    });
    const actor = actorOf("TEACHER", "cs1", "gv-bc-throw", ["lopA"]);
    const res = await sendAnnouncementAsActor(actor, "GV Test", input());
    expect(res.ok).toBe(true);
    expect(h.state.created).toHaveLength(1);
  });

  it("[AC5] publishEvent 'chat.announcement_created' TRONG tx — điểm móc cho US-14, KHÔNG tự gửi push ở đây", async () => {
    const actor = actorOf("TEACHER", "cs1", "gv-evt", ["lopA"]);
    await sendAnnouncementAsActor(actor, "GV Test", input());

    expect(h.publishEvent).toHaveBeenCalledTimes(1);
    const [type, payload, opts] = h.publishEvent.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(type).toBe("chat.announcement_created");
    expect(payload.messageId).toBe("ann-1");
    expect(payload.conversationId).toBe(CONV);
    expect(opts.tx).toBeDefined(); // atomic: rollback tin ⇒ không còn event
    expect(opts.dedupeKey).toContain("ann-1");
  });

  it("quota chặn → KHÔNG publishEvent (không có thông báo thì không có push)", async () => {
    h.state.sentToday = ANNOUNCEMENT_DAILY_QUOTA;
    const actor = actorOf("TEACHER", "cs1", "gv-evt-quota", ["lopA"]);
    await sendAnnouncementAsActor(actor, "GV Test", input());
    expect(h.publishEvent).not.toHaveBeenCalled();
  });
});
