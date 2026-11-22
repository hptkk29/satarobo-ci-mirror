// @vitest-environment node
/**
 * US-14 — LƯỚI CHẶN cho `sendChatZnsNotifications` (tầng có DB + provider).
 *
 * Luật thuần đã có lưới riêng ở `zns-notify-rules.test.ts`; file này soi **đường ống**:
 * ai lọt vào tập ứng viên, giành chỗ trong sổ gửi ra sao, trạng thái ghi lại là gì.
 *
 * Vì sao phải mock đến mức "DB giả LỌC THẬT theo `where`" thay vì trả mảng cứng: mọi
 * cổng chặn của story này nằm TRONG mệnh đề `where` (`type: "CLASS_GROUP"`,
 * `status: "ACTIVE"`, cửa sổ chống bão). Mock trả mảng cứng thì xoá thẳng
 * `type: "CLASS_GROUP"` khỏi truy vấn test vẫn xanh — mà đó đúng là lỗi tốn tiền + lộ
 * việc riêng: ZNS bắn cho hội thoại 1-1 GV↔PH.
 *
 * Mỗi tin ZNS là 400đ, KHÔNG thu hồi được, và gửi ngoài khung 06:00–22:00 thì Zalo trả
 * `-133`. Nên các bất biến dưới đây phải đỏ ngay khi ai đó nới một dòng:
 *   • DM / hội thoại đã lưu trữ  → KHÔNG BAO GIỜ gửi
 *   • tin của phụ huynh khác     → không kích hoạt
 *   • chưa quá ngưỡng / đã đọc   → không gửi
 *   • khung cấm giờ VN           → HOÃN (lượt sau gửi), không mất, không gửi
 *   • chạy hai lượt              → đúng một tin
 *   • cờ tắt / mẫu rỗng / DB cấu hình lỗi / thiếu credential → im lặng, KHÔNG ném lỗi
 *   • ZNS mô phỏng               → ghi SIMULATED, tuyệt đối không ghi SENT
 *   • params                     → đúng 3 khoá, KHÔNG mang nội dung tin (BR-30)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hình dạng dữ liệu của "DB giả" ─────────────────────────────────────────
interface ConvRow {
  id: string;
  type: string;
  status: string;
  title: string | null;
  subjectType: string | null;
  subjectId: string | null;
  lastMessageAt: Date;
}
interface PartRow {
  conversationId: string;
  userId: string;
  leftAt: Date | null;
  unreadCount: number;
  lastReadAt: Date | null;
  muted: boolean;
  derivedFrom: string | null;
}
interface MsgRow {
  id: string;
  conversationId: string;
  senderId: string | null;
  kind: string;
  /** Nội dung THẬT — cố tình có mặt trong DB giả để bắt được ai đó đem nó vào params. */
  body: string;
  createdAt: Date;
  deletedAt: Date | null;
}
interface UserRow {
  id: string;
  name: string | null;
  role: string;
  roles: string[];
  phone: string | null;
}
interface LedgerRow {
  id: string;
  conversationId: string;
  userId: string;
  messageId: string;
  messageKind: string;
  status: string;
  znsLogId: string | null;
  errorMessage: string | null;
  sentAt: Date | null;
  createdAt: Date;
}
interface ZaloCall {
  toPhone: string;
  templateKey?: string | null;
  params?: Record<string, string | number>;
  fallbackEmail?: unknown;
}

// ─── Mock hạ tầng (hoisted — chạy trước mọi import) ──────────────────────────
const h = vi.hoisted(() => {
  const state = {
    /** Đồng hồ của DB giả (`createdAt` của sổ gửi) — phải trùng mốc chạy cron. */
    now: new Date(0),
    conversations: [] as ConvRow[],
    participants: [] as PartRow[],
    messages: [] as MsgRow[],
    users: [] as UserRow[],
    classes: [] as { id: string; name: string }[],
    ledger: [] as LedgerRow[],
    zaloCalls: [] as ZaloCall[],
    zaloLogs: {} as Record<string, { providerMessageId: string | null }>,
    /** Provider trả gì cho lượt gửi kế tiếp (SENT thật / SENT mô phỏng / SKIPPED / FAILED). */
    zaloPlan: { status: "SENT", providerMessageId: "zns-that-1" } as {
      status: "SENT" | "SKIPPED" | "FAILED";
      providerMessageId: string | null;
    },
    settings: {} as Record<string, unknown>,
    /** Bật lên = mọi lượt đọc cấu hình đều ném (DB cấu hình chết giữa đêm). */
    settingsThrow: false,
    seq: 0,
  };

  const cmp = (x: unknown, y: unknown): number => {
    const nx = x instanceof Date ? x.getTime() : x;
    const ny = y instanceof Date ? y.getTime() : y;
    if (typeof nx === "number" && typeof ny === "number") return nx - ny;
    return String(nx).localeCompare(String(ny));
  };

  function applyOrderBy<T extends Record<string, unknown>>(rows: T[], orderBy: unknown): T[] {
    const specs = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<
      string,
      "asc" | "desc"
    >[];
    if (specs.length === 0) return rows;
    return rows.slice().sort((a, b) => {
      for (const spec of specs) {
        for (const [field, dir] of Object.entries(spec)) {
          const d = cmp(a[field], b[field]);
          if (d !== 0) return dir === "desc" ? -d : d;
        }
      }
      return 0;
    });
  }

  const convById = (id: string) => state.conversations.find((c) => c.id === id) ?? null;

  type DateFilter = { gte?: Date; gt?: Date; lte?: Date };
  const inWindow = (value: Date, f: DateFilter | undefined): boolean => {
    if (!f) return true;
    if (f.gte && value.getTime() < f.gte.getTime()) return false;
    if (f.gt && value.getTime() <= f.gt.getTime()) return false;
    if (f.lte && value.getTime() > f.lte.getTime()) return false;
    return true;
  };

  const mockDb: Record<string, unknown> = {
    conversationParticipant: {
      // Lọc THẬT theo `where`: bỏ một điều kiện trong code thật = hàng không đáng có
      // lọt vào tập ứng viên và test đỏ ngay.
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as {
          leftAt?: Date | null;
          unreadCount?: { gt?: number };
          OR?: { lastReadAt?: null | { lte?: Date } }[];
          conversationId?: { in?: string[] };
          conversation?: {
            type?: string;
            status?: string;
            lastMessageAt?: DateFilter;
          };
        };
        let rows = state.participants.slice();
        if ("leftAt" in where) rows = rows.filter((p) => p.leftAt === where.leftAt);
        if (where.unreadCount?.gt !== undefined) {
          const gt = where.unreadCount.gt;
          rows = rows.filter((p) => p.unreadCount > gt);
        }
        if (where.OR) {
          const or = where.OR;
          rows = rows.filter((p) =>
            or.some((cond) => {
              if (!("lastReadAt" in cond)) return false;
              const c = cond.lastReadAt;
              if (c === null) return p.lastReadAt === null;
              if (c?.lte) return p.lastReadAt !== null && p.lastReadAt.getTime() <= c.lte.getTime();
              return false;
            }),
          );
        }
        if (where.conversationId?.in) {
          const ids = where.conversationId.in;
          rows = rows.filter((p) => ids.includes(p.conversationId));
        }
        if (where.conversation) {
          const c = where.conversation;
          rows = rows.filter((p) => {
            const conv = convById(p.conversationId);
            if (!conv) return false;
            if (c.type !== undefined && conv.type !== c.type) return false;
            if (c.status !== undefined && conv.status !== c.status) return false;
            return inWindow(conv.lastMessageAt, c.lastMessageAt);
          });
        }
        rows = applyOrderBy(rows as unknown as Record<string, unknown>[], args.orderBy) as unknown as PartRow[];
        // `skip` là chốt của bản vá 09/08: code thật phân TRANG chứ không cắt cụt danh
        // sách ứng viên. Mock bỏ qua `skip` = trang nào cũng trả về đầu danh sách ⇒ test
        // "cặp thứ 501" sẽ xanh giả.
        const skip = typeof args.skip === "number" ? args.skip : 0;
        if (skip > 0) rows = rows.slice(skip);
        const take = typeof args.take === "number" ? args.take : undefined;
        if (take !== undefined) rows = rows.slice(0, take);
        return rows.map((p) => ({ ...p, conversation: convById(p.conversationId) }));
      }),
    },
    message: {
      // Truy vấn tin mốc của bản vá hỏi RIÊNG từng cặp và đẩy cả 3 cổng xuống `where`
      // (`senderId in`, `OR` theo loại tin + ngưỡng riêng, `gt: lastReadAt`). Mock phải
      // hiểu đủ các mệnh đề đó, nếu không thì gỡ một cổng khỏi code thật vẫn xanh.
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as {
          conversationId?: string | { in?: string[] };
          senderId?: { in?: string[] };
          deletedAt?: Date | null;
          kind?: { in?: string[] };
          createdAt?: DateFilter;
          OR?: { kind?: string; createdAt?: DateFilter }[];
        };
        let rows = state.messages.slice();
        if (typeof where.conversationId === "string") {
          const id = where.conversationId;
          rows = rows.filter((m) => m.conversationId === id);
        } else if (where.conversationId?.in) {
          const ids = where.conversationId.in;
          rows = rows.filter((m) => ids.includes(m.conversationId));
        }
        if (where.senderId?.in) {
          const ids = where.senderId.in;
          rows = rows.filter((m) => m.senderId !== null && ids.includes(m.senderId));
        }
        if ("deletedAt" in where) rows = rows.filter((m) => m.deletedAt === where.deletedAt);
        if (where.kind?.in) {
          const kinds = where.kind.in;
          rows = rows.filter((m) => kinds.includes(m.kind));
        }
        rows = rows.filter((m) => inWindow(m.createdAt, where.createdAt));
        if (where.OR) {
          const or = where.OR;
          rows = rows.filter((m) =>
            or.some(
              (cond) =>
                (cond.kind === undefined || cond.kind === m.kind) &&
                inWindow(m.createdAt, cond.createdAt),
            ),
          );
        }
        rows = applyOrderBy(rows as unknown as Record<string, unknown>[], args.orderBy) as unknown as MsgRow[];
        const take = typeof args.take === "number" ? args.take : undefined;
        return take === undefined ? rows : rows.slice(0, take);
      }),
    },
    chatZnsNotification: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as {
          conversationId?: { in?: string[] };
          createdAt?: DateFilter;
        };
        let rows = state.ledger.slice();
        if (where.conversationId?.in) {
          const ids = where.conversationId.in;
          rows = rows.filter((r) => ids.includes(r.conversationId));
        }
        return rows.filter((r) => inWindow(r.createdAt, where.createdAt));
      }),
      // UNIQUE (conversationId, userId, messageId) — đúng chỉ mục của migration
      // 20260810090000. Đây là chốt chống gửi đôi khi hai lượt cron chồng nhau.
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const d = args.data as unknown as {
          conversationId: string;
          userId: string;
          messageId: string;
          messageKind: string;
        };
        const dup = state.ledger.some(
          (r) =>
            r.conversationId === d.conversationId &&
            r.userId === d.userId &&
            r.messageId === d.messageId,
        );
        if (dup) {
          const { Prisma } = await import("@prisma/client");
          throw new Prisma.PrismaClientKnownRequestError(
            "Unique constraint failed on the fields: (`conversationId`,`userId`,`messageId`)",
            {
              code: "P2002",
              clientVersion: "5.22.0",
              meta: { target: ["conversationId", "userId", "messageId"] },
            },
          );
        }
        state.seq += 1;
        const row: LedgerRow = {
          id: `zns-${state.seq}`,
          conversationId: d.conversationId,
          userId: d.userId,
          messageId: d.messageId,
          messageKind: d.messageKind,
          status: "PENDING",
          znsLogId: null,
          errorMessage: null,
          sentAt: null,
          createdAt: state.now,
        };
        state.ledger.push(row);
        return { id: row.id };
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.ledger.find((r) => r.id === args.where.id);
        if (!row) throw new Error(`Không có dòng sổ gửi ${args.where.id}`);
        Object.assign(row, args.data);
        return row;
      }),
    },
    user: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as { id?: { in?: string[] } };
        const ids = where.id?.in;
        return ids ? state.users.filter((u) => ids.includes(u.id)) : state.users.slice();
      }),
    },
    class: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as { id?: { in?: string[] } };
        const ids = where.id?.in;
        return ids ? state.classes.filter((c) => ids.includes(c.id)) : state.classes.slice();
      }),
    },
    zaloMessageLog: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => state.zaloLogs[args.where.id] ?? null),
    },
  };

  return {
    state,
    mockDb,
    getSetting: vi.fn(async (key: string) => {
      if (state.settingsThrow) throw new Error("Bảng cấu hình không đọc được");
      if (!(key in state.settings)) throw new Error(`Unknown setting key: ${key}`);
      return state.settings[key];
    }),
    sendZaloNotification: vi.fn(async (input: ZaloCall) => {
      state.zaloCalls.push(input);
      const logId = `log-${state.zaloCalls.length}`;
      state.zaloLogs[logId] = { providerMessageId: state.zaloPlan.providerMessageId };
      return {
        ok: state.zaloPlan.status !== "FAILED",
        status: state.zaloPlan.status,
        fallbackEmailed: false,
        logId,
      };
    }),
  };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/settings/service", () => ({ getSetting: h.getSetting }));
vi.mock("@/lib/zalo/service", () => ({ sendZaloNotification: h.sendZaloNotification }));
// `announcements.ts` (nguồn của `isAnnouncementRecipient`) kéo theo hạ tầng nặng — mock
// đúng bộ như `announcements.test.ts` để test chạy được ở mọi máy, không cần DB/mạng.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: vi.fn(async () => ({})) }));
vi.mock("@/lib/events/publish", () => ({ publishEvent: vi.fn(async () => ({ id: "evt-1" })) }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ success: true, remaining: 99, resetAt: Date.now() + 60_000 })),
}));
vi.mock("@/lib/chat/broadcast", () => ({
  broadcastMessages: vi.fn(async () => true),
  broadcastToConversation: vi.fn(async () => true),
  conversationBroadcast: () => ({}),
  userBumpBroadcasts: () => [],
}));

import { sendChatZnsNotifications } from "./zns-notify";

// ─── Mốc thời gian & thế giới mẫu ───────────────────────────────────────────
const H = 3_600_000;
/** 2026-08-10T03:00:00Z = **10:00 giờ VN** — ngoài khung cấm 22:00–06:00. */
const NOW = new Date("2026-08-10T03:00:00.000Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * H);
const later = (hours: number) => new Date(NOW.getTime() + hours * H);

const GV = "gv-1";
const PH1 = "ph-1";
const CLASS_CONV = "conv-lop";
const DM_CONV = "conv-rieng";
const ARCHIVED_CONV = "conv-luutru";
const BODY = "Mai lớp mình kiểm tra giữa kỳ, phụ huynh nhắc con ôn bài nhé";

function staffMessage(id: string, conversationId: string, hoursAgo: number, kind = "CHAT"): MsgRow {
  return {
    id,
    conversationId,
    senderId: GV,
    kind,
    body: BODY,
    createdAt: ago(hoursAgo),
    deletedAt: null,
  };
}

function seedWorld(): void {
  h.state.conversations = [
    {
      id: CLASS_CONV,
      type: "CLASS_GROUP",
      status: "ACTIVE",
      title: "Nhóm lớp (tên hội thoại tự đặt)",
      subjectType: "CLASS",
      subjectId: "cls-1",
      lastMessageAt: ago(1),
    },
    {
      id: DM_CONV,
      type: "DM",
      status: "ACTIVE",
      title: "Cô Lan ↔ Chị Hoa",
      subjectType: null,
      subjectId: null,
      lastMessageAt: ago(1),
    },
    {
      id: ARCHIVED_CONV,
      type: "CLASS_GROUP",
      status: "ARCHIVED",
      title: "Nhóm lớp khoá cũ",
      subjectType: "CLASS",
      subjectId: "cls-1",
      lastMessageAt: ago(1),
    },
  ];
  h.state.participants = [
    // Giáo viên cũng có tin chưa đọc — nhưng ZNS chỉ dành cho PHỤ HUYNH.
    {
      conversationId: CLASS_CONV,
      userId: GV,
      leftAt: null,
      unreadCount: 3,
      lastReadAt: null,
      muted: false,
      derivedFrom: "CLASS_TEACHER",
    },
    {
      conversationId: CLASS_CONV,
      userId: PH1,
      leftAt: null,
      unreadCount: 2,
      lastReadAt: null,
      muted: false,
      derivedFrom: "CLASS_STUDENT_PARENT",
    },
  ];
  h.state.messages = [staffMessage("m-cu", CLASS_CONV, 9)];
  h.state.users = [
    { id: GV, name: "Cô Lan", role: "TEACHER", roles: ["TEACHER"], phone: "0905000001" },
    { id: PH1, name: "Chị Hoa", role: "PARENT", roles: ["PARENT"], phone: "0905123456" },
  ];
  h.state.classes = [{ id: "cls-1", name: "Sata 4 — T3/T5" }];
}

/** Thêm phụ huynh + hội thoại riêng (DM) đang có tin GV chưa đọc 9 tiếng. */
function seedDmTraffic(): void {
  h.state.participants.push({
    conversationId: DM_CONV,
    userId: PH1,
    leftAt: null,
    unreadCount: 4,
    lastReadAt: null,
    muted: false,
    derivedFrom: "CLASS_STUDENT_PARENT",
  });
  h.state.messages.push(staffMessage("m-dm", DM_CONV, 9));
}

async function run(now: Date = NOW) {
  h.state.now = now;
  return sendChatZnsNotifications(now);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.ledger = [];
  h.state.zaloCalls = [];
  h.state.zaloLogs = {};
  h.state.zaloPlan = { status: "SENT", providerMessageId: "zns-that-1" };
  h.state.settingsThrow = false;
  h.state.seq = 0;
  h.state.now = NOW;
  h.state.settings = {
    "chat.znsNotifyEnabled": true,
    "chat.znsTemplateNewMessage": "616999",
    "chat.znsUnreadMinutes": 360,
    "chat.znsAnnouncementUnreadMinutes": 360,
    "chat.znsCooldownMinutes": 360,
    "chat.znsMaxPerRun": 100,
  };
  seedWorld();
});

// ═════════════════════════════════════════════════════════════════════════════
// Đường thuận — có gửi thì phải gửi đúng người
// ═════════════════════════════════════════════════════════════════════════════

describe("[US-14] đường thuận", () => {
  it("nhóm lớp có tin GV chưa đọc quá 6 tiếng → nhắc PHỤ HUYNH, KHÔNG nhắc giáo viên", async () => {
    const res = await run();

    expect(res.reason).toBeUndefined();
    expect(res.due).toBe(1);
    expect(res.sent).toBe(1);
    // Giáo viên trong nhóm cũng "chưa đọc 3 tin" nhưng KHÔNG được tính — ZNS là kênh
    // dành cho phụ huynh; nhắc nhân sự bằng tin trả phí là đốt tiền vô ích.
    expect(h.state.zaloCalls).toHaveLength(1);
    expect(h.state.zaloCalls[0].toPhone).toBe("0905123456");
    expect(h.state.zaloCalls[0].templateKey).toBe("616999");

    expect(h.state.ledger).toHaveLength(1);
    expect(h.state.ledger[0]).toMatchObject({
      conversationId: CLASS_CONV,
      userId: PH1,
      messageId: "m-cu",
      messageKind: "CHAT",
      status: "SENT",
      znsLogId: "log-1",
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cổng 1 — hội thoại nào được phép sinh ZNS
// ═════════════════════════════════════════════════════════════════════════════

describe("[US-14][AC1] chỉ nhóm lớp mới sinh ZNS", () => {
  it("NHẮN RIÊNG (DM) KHÔNG BAO GIỜ gửi — kể cả khi PH bỏ mặc 9 tiếng", async () => {
    // Phụ huynh đã đọc hết nhóm lớp; thứ duy nhất còn chưa đọc là hội thoại 1-1 với GV.
    h.state.participants = h.state.participants.filter((p) => p.userId !== PH1);
    seedDmTraffic();

    const res = await run();

    expect(res.due).toBe(0);
    expect(res.sent).toBe(0);
    // Không một dòng sổ nào được tạo: DM bị chặn từ tầng truy vấn, không có nhánh nào
    // phía sau "lỡ tay" gửi. Đây là ranh giới riêng tư — tin 1-1 GV↔PH không được
    // biến thành thông báo ra ngoài hệ thống.
    expect(h.state.ledger).toHaveLength(0);
    expect(h.state.zaloCalls).toHaveLength(0);
  });

  it("nhóm lớp ĐÃ LƯU TRỮ cũng không sinh ZNS", async () => {
    h.state.participants = [
      {
        conversationId: ARCHIVED_CONV,
        userId: PH1,
        leftAt: null,
        unreadCount: 5,
        lastReadAt: null,
        muted: false,
        derivedFrom: "CLASS_STUDENT_PARENT",
      },
    ];
    h.state.messages = [staffMessage("m-cu-luutru", ARCHIVED_CONV, 9)];

    const res = await run();

    expect(res.due).toBe(0);
    expect(h.state.zaloCalls).toHaveLength(0);
  });

  it("người đã RỜI nhóm không còn được nhắc", async () => {
    const ph = h.state.participants.find((p) => p.userId === PH1);
    if (!ph) throw new Error("fixture hỏng");
    ph.leftAt = ago(2);

    expect((await run()).sent).toBe(0);
    expect(h.state.zaloCalls).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cổng 2 — ai nhắn thì đáng nhắc
// ═════════════════════════════════════════════════════════════════════════════

describe("[US-14][AC1] chỉ tin của GV/QLCS mới kích hoạt", () => {
  it("tin của PHỤ HUYNH KHÁC trong nhóm KHÔNG kích hoạt ZNS cho cả lớp", async () => {
    const ph2: UserRow = {
      id: "ph-2",
      name: "Anh Nam",
      role: "PARENT",
      roles: ["PARENT"],
      phone: "0905123457",
    };
    h.state.users.push(ph2);
    h.state.participants.push({
      conversationId: CLASS_CONV,
      userId: ph2.id,
      leftAt: null,
      unreadCount: 0,
      lastReadAt: ago(8),
      muted: false,
      derivedFrom: "CLASS_STUDENT_PARENT",
    });
    // Trong nhóm CHỈ có tin của phụ huynh khác: "dạ vâng ạ", "cảm ơn cô".
    h.state.messages = [
      { ...staffMessage("m-ph", CLASS_CONV, 9), senderId: ph2.id },
      { ...staffMessage("m-ph-2", CLASS_CONV, 8), senderId: ph2.id },
    ];

    const res = await run();

    expect(res.due).toBe(0);
    expect(res.sent).toBe(0);
    expect(h.state.zaloCalls).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cổng 3 — ngưỡng chưa đọc
// ═════════════════════════════════════════════════════════════════════════════

describe("[US-14][AC1] ngưỡng chưa đọc", () => {
  it("chưa đủ 6 tiếng thì KHÔNG gửi — dù tin đã lọt cửa sổ quét của THÔNG BÁO", async () => {
    // Ngưỡng THÔNG BÁO hạ xuống 30 phút (đúng kịch bản vận hành cho phép) nên cửa sổ
    // quét nới ra theo ngưỡng NHỎ NHẤT. Tin thường 1 tiếng vì thế nằm TRONG tập đọc lên
    // nhưng vẫn phải rớt ở luật ngưỡng — nếu không, "6 tiếng" chỉ còn là chữ trong tài liệu.
    h.state.settings["chat.znsAnnouncementUnreadMinutes"] = 30;
    h.state.messages = [staffMessage("m-moi", CLASS_CONV, 1)];

    expect((await run()).sent).toBe(0);
    expect(h.state.zaloCalls).toHaveLength(0);

    // Đối chứng: cùng mốc thời gian, đổi sang THÔNG BÁO thì ngưỡng RIÊNG 30 phút cho qua.
    h.state.messages = [staffMessage("m-thongbao", CLASS_CONV, 1, "ANNOUNCEMENT")];
    expect((await run()).sent).toBe(1);
  });

  it("PHỤ HUYNH ĐÃ ĐỌC thì lời nhắc TỰ HUỶ — không gửi, không tốn tiền", async () => {
    const ph = h.state.participants.find((p) => p.userId === PH1);
    if (!ph) throw new Error("fixture hỏng");
    // Tin từ 9 tiếng trước, phụ huynh mở hội thoại lúc 7 tiếng trước ⇒ đã đọc.
    // (`unreadCount` cố tình để lệch: đó là bộ đếm, `lastReadAt` mới là sự thật.)
    ph.lastReadAt = ago(7);

    const res = await run();

    expect(res.due).toBe(0);
    expect(res.sent).toBe(0);
    expect(h.state.ledger).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Khung cấm giờ VN
// ═════════════════════════════════════════════════════════════════════════════

describe("[US-14] khung cấm 22:00–06:00 giờ VN (Zalo -133)", () => {
  it("22:30 giờ VN → HOÃN cả lượt: không gửi, không ghi sổ, không mất tin", async () => {
    const quiet = new Date("2026-08-10T15:30:00.000Z"); // 22:30 VN

    const res = await run(quiet);

    expect(res.reason).toBe("QUIET_HOURS");
    expect(res.sent).toBe(0);
    expect(h.state.zaloCalls).toHaveLength(0);
    // KHÔNG ghi sổ: ghi vào là cửa sổ chống bão nuốt mất lời nhắc, sáng hôm sau
    // phụ huynh không được nhắc nữa dù vẫn chưa đọc.
    expect(h.state.ledger).toHaveLength(0);
  });

  it("hoãn chứ KHÔNG mất: 06:30 giờ VN hôm sau vẫn nhắc đúng tin đó", async () => {
    await run(new Date("2026-08-10T15:30:00.000Z")); // 22:30 VN — hoãn
    const res = await run(new Date("2026-08-10T23:30:00.000Z")); // 06:30 VN hôm sau

    expect(res.sent).toBe(1);
    expect(h.state.ledger[0].messageId).toBe("m-cu");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Chống gửi đôi
// ═════════════════════════════════════════════════════════════════════════════

describe("[US-14] chạy cron nhiều lượt vẫn đúng MỘT tin", () => {
  it("hai lượt cách nhau 7 tiếng (đã hết cửa sổ chống bão) — mốc tin TẤT ĐỊNH nên sổ vẫn chặn", async () => {
    // Giữa hai lượt có thêm tin mới của GV. Nếu mốc nhắc bám tin MỚI NHẤT thì mỗi lượt
    // sinh một khoá khác nhau, UNIQUE của sổ hết tác dụng và phụ huynh bị bắn tin lặp.
    h.state.messages.push(staffMessage("m-giua", CLASS_CONV, 6.5));

    const first = await run();
    expect(first.sent).toBe(1);

    h.state.messages.push({ ...staffMessage("m-sau", CLASS_CONV, 0), createdAt: later(0.5) });
    const second = await run(later(7));

    expect(second.due).toBe(1); // vẫn còn tin chưa đọc…
    expect(second.sent).toBe(0); // …nhưng đã nhắc rồi thì thôi.
    expect(h.state.zaloCalls).toHaveLength(1);
    expect(h.state.ledger).toHaveLength(1);
  });

  it("cửa sổ chống bão chặn lượt thứ hai khi tin mốc bị GỠ giữa chừng", async () => {
    h.state.messages.push(staffMessage("m-sau-cu", CLASS_CONV, 8));

    expect((await run()).sent).toBe(1);
    expect(h.state.ledger[0].messageId).toBe("m-cu");

    // GV gỡ tin vừa được lấy làm mốc ⇒ lượt sau mốc rơi sang tin kế tiếp, khoá UNIQUE
    // không còn trùng. Chỉ còn cửa sổ chống bão đứng giữa phụ huynh và cú ZNS thứ hai
    // trong vòng nửa tiếng.
    const anchor = h.state.messages.find((m) => m.id === "m-cu");
    if (!anchor) throw new Error("fixture hỏng");
    anchor.deletedAt = later(0.2);

    const second = await run(later(0.5));

    expect(second.sent).toBe(0);
    expect(h.state.zaloCalls).toHaveLength(1);
    expect(h.state.ledger).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Tắt an toàn — không tầng nào được ném lỗi
// ═════════════════════════════════════════════════════════════════════════════

describe("[US-14] tắt an toàn: không tầng nào ném lỗi", () => {
  it("cờ tổng TẮT → đứng im, không đọc tiếp, không gửi", async () => {
    h.state.settings["chat.znsNotifyEnabled"] = false;

    const res = await run();

    expect(res.reason).toBe("DISABLED");
    expect(res.sent).toBe(0);
    expect(h.state.zaloCalls).toHaveLength(0);
    expect(h.state.ledger).toHaveLength(0);
  });

  it("MẪU ZNS còn rỗng (chưa được Zalo duyệt) → SKIP cả lượt, không gọi provider", async () => {
    // Gửi với templateKey rỗng thì Zalo từ chối nhưng luồng gọi vẫn báo "thành công" —
    // đúng vết bug PR #77. Chặn ngay từ đây thay vì để im lặng hỏng.
    h.state.settings["chat.znsTemplateNewMessage"] = "   ";

    const res = await run();

    expect(res.reason).toBe("NO_TEMPLATE");
    expect(h.state.zaloCalls).toHaveLength(0);
  });

  it("BẢNG CẤU HÌNH đọc lỗi → rơi về mặc định an toàn, KHÔNG ném lỗi làm chết cron", async () => {
    h.state.settingsThrow = true;

    // `await expect(...).resolves` chứ không try/catch: cron ném lỗi là cả job đỏ trên
    // Vercel, và các job bơm khác trong cùng vòng cũng không chạy.
    await expect(run()).resolves.toMatchObject({ reason: "DISABLED", sent: 0 });
    expect(h.state.zaloCalls).toHaveLength(0);
  });

  it("THIẾU CREDENTIAL Zalo → ghi SKIPPED, không ném lỗi, không đếm nhầm là đã gửi", async () => {
    h.state.zaloPlan = { status: "SKIPPED", providerMessageId: null };

    const res = await run();

    expect(res.sent).toBe(0);
    expect(res.skipped).toBe(1);
    expect(h.state.ledger[0].status).toBe("SKIPPED");
  });

  it("PHỤ HUYNH chưa có SĐT → ghi SKIPPED kèm lý do, KHÔNG gọi provider", async () => {
    const ph = h.state.users.find((u) => u.id === PH1);
    if (!ph) throw new Error("fixture hỏng");
    ph.phone = null;

    const res = await run();

    expect(res.skipped).toBe(1);
    expect(h.state.zaloCalls).toHaveLength(0);
    expect(h.state.ledger[0].status).toBe("SKIPPED");
    expect(String(h.state.ledger[0].errorMessage)).toContain("số điện thoại");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SIMULATED ≠ SENT
// ═════════════════════════════════════════════════════════════════════════════

describe("[US-14] ZNS mô phỏng không được ghi thành ĐÃ GỬI", () => {
  it("provider trả SENT nhưng log là SIMULATED- → sổ ghi SIMULATED", async () => {
    // Trên `test.satarobo.vn` mọi tin đều mô phỏng (creds Zalo chỉ ở Production). Ghi
    // nhầm thành SENT nghĩa là "đã nhắc rồi" — sổ chống trùng sẽ chặn cú nhắc THẬT về sau.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.state.zaloPlan = { status: "SENT", providerMessageId: "SIMULATED-1754800000000" };

    const res = await run();

    expect(res.simulated).toBe(1);
    expect(res.sent).toBe(0);
    expect(h.state.ledger[0].status).toBe("SIMULATED");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("log có providerMessageId thật → mới được ghi SENT", async () => {
    h.state.zaloPlan = { status: "SENT", providerMessageId: "3b1f0c9e-zalo" };

    const res = await run();

    expect(res.sent).toBe(1);
    expect(res.simulated).toBe(0);
    expect(h.state.ledger[0].status).toBe("SENT");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Nội dung tin gửi đi (BR-30)
// ═════════════════════════════════════════════════════════════════════════════

describe("[US-14][BR-30] params gửi sang Zalo", () => {
  it("đúng 3 khoá mẫu khai và TUYỆT ĐỐI không mang nội dung tin nhắn", async () => {
    await run();

    const params = h.state.zaloCalls[0].params ?? {};
    expect(Object.keys(params).sort()).toEqual(["className", "senderName", "time"]);
    // ZNS rời khỏi hệ thống: không thu hồi được, không kiểm soát được ai đọc trên máy
    // phụ huynh. Nội dung trao đổi của lớp phải ở lại portal, nơi quyền đọc kiểm một chỗ.
    expect(JSON.stringify(params)).not.toContain(BODY);
    expect(JSON.stringify(params)).not.toContain("kiểm tra giữa kỳ");
  });

  it("tên lớp lấy từ LỚP, không lấy tên hội thoại tự đặt; giờ là giờ VIỆT NAM của tin", async () => {
    await run();

    const params = h.state.zaloCalls[0].params ?? {};
    expect(params.className).toBe("Sata 4 — T3/T5");
    // m-cu tạo lúc NOW-9h = 2026-08-09T18:00Z = 01:00 ngày 10/08 giờ VN.
    expect(params.time).toBe("01:00 10/08/2026");
  });

  it("SĐT lẫn trong tên người gửi bị CHE trước khi rời hệ thống", async () => {
    // Tài khoản sinh từ lead cũ hay mang tên dạng "PH 0905123456" — bỏ cột phone khỏi
    // select là chưa đủ, số vẫn đi lọt qua đường tên hiển thị.
    const gv = h.state.users.find((u) => u.id === GV);
    if (!gv) throw new Error("fixture hỏng");
    gv.name = "Cô Lan 0905000001";

    await run();

    const params = h.state.zaloCalls[0].params ?? {};
    expect(String(params.senderName)).not.toContain("0905000001");
    expect(params.senderName).toBe("Cô Lan •••");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TRẦN KỸ THUẬT — hai lỗi "chết câm" của bản đầu (nghiệm thu đối kháng 09/08/2026)
//
// Cả hai đều KHÔNG ném lỗi, KHÔNG ghi log, và `ChatZnsRunResult` vẫn trông lành lặn.
// Người vận hành không có tín hiệu nào để phát hiện — nên lưới chặn phải nằm ở đây.
// ═════════════════════════════════════════════════════════════════════════════

/** Dựng thêm một nhóm lớp ACTIVE có GV (không phải ứng viên) + đúng 1 phụ huynh chưa đọc. */
function seedClassGroup(convId: string, parentId: string, className: string): void {
  h.state.conversations.push({
    id: convId,
    type: "CLASS_GROUP",
    status: "ACTIVE",
    title: className,
    subjectType: "CLASS",
    subjectId: `cls-${convId}`,
    lastMessageAt: ago(1),
  });
  h.state.classes.push({ id: `cls-${convId}`, name: className });
  // GV: `unreadCount = 0` ⇒ KHÔNG lọt vào tập ứng viên, nhưng vẫn là thành viên nhóm
  // (nguồn để biết "tin này do nhân sự gửi").
  h.state.participants.push({
    conversationId: convId,
    userId: GV,
    leftAt: null,
    unreadCount: 0,
    lastReadAt: null,
    muted: false,
    derivedFrom: "CLASS_TEACHER",
  });
  h.state.participants.push({
    conversationId: convId,
    userId: parentId,
    leftAt: null,
    unreadCount: 1,
    lastReadAt: null,
    muted: false,
    derivedFrom: "CLASS_STUDENT_PARENT",
  });
  h.state.users.push({
    id: parentId,
    name: `PH ${parentId}`,
    role: "PARENT",
    roles: ["PARENT"],
    phone: `09051${parentId.replace(/\D/g, "").padStart(5, "0").slice(-5)}`,
  });
}

describe("[US-14] trần kỹ thuật không được BỎ ĐÓI lớp nào", () => {
  it("vài lớp nhắn RẤT nhiều KHÔNG được nuốt mất lời nhắc của lớp nhắn ít", async () => {
    // Bản đầu đọc tin bằng MỘT truy vấn gộp `orderBy createdAt asc, take 2000` cho toàn
    // bộ hội thoại của lượt quét. Ba lớp dưới đây có 2400 tin CŨ HƠN ⇒ chiếm trọn hạn
    // ngạch, và lớp thứ tư (tin mới hơn nên xếp sau) không còn phần tử nào trong bản đồ
    // tin ⇒ `pickAnchorMessage` trả null ⇒ phụ huynh lớp đó KHÔNG BAO GIỜ được nhắc,
    // trong khi job vẫn báo ok. Ở nhịp 100 tin/ngày/lớp thì 2000 tin ≈ 3 lớp × 7 ngày.
    h.state.participants = [];
    h.state.messages = [];
    h.state.conversations = [];
    h.state.classes = [];
    h.state.users = h.state.users.filter((u) => u.id === GV);

    let seq = 0;
    for (const conv of ["conv-a", "conv-b", "conv-c"]) {
      seedClassGroup(conv, `ph-${conv}`, `Lớp đông tin ${conv}`);
      for (let i = 0; i < 800; i += 1) {
        seq += 1;
        // ago(150) → ago(70.1): CŨ hơn tin của lớp thứ tư, tất cả vẫn trong cửa sổ 7 ngày.
        h.state.messages.push({
          ...staffMessage(`m-${seq}`, conv, 150 - i * 0.1),
        });
      }
    }
    // Lớp thứ tư: đúng 1 tin GV chưa đọc 9 tiếng — điều kiện phải gửi, không bàn cãi.
    seedClassGroup("conv-z", "ph-z", "Lớp ít tin");
    h.state.messages.push(staffMessage("m-lop-it-tin", "conv-z", 9));

    const res = await run();

    // Lớp ít tin PHẢI được nhắc — đây là dòng đỏ nếu quay lại trần gộp 2000 tin.
    expect(h.state.ledger.map((r) => r.userId)).toContain("ph-z");
    expect(h.state.ledger.find((r) => r.userId === "ph-z")?.messageId).toBe("m-lop-it-tin");
    // …và ba lớp đông tin vẫn được nhắc như thường (bản vá không đánh đổi cái này).
    expect(res.due).toBe(4);
    expect(res.sent).toBe(4);
  });

  it("cặp thứ 501 vẫn được nhắc — tập ứng viên phải PHÂN TRANG, không cắt cụt", async () => {
    // Bản đầu lấy 500 hàng đầu theo `orderBy` TẤT ĐỊNH (conversationId, userId). Hàng đã
    // nhắc rồi KHÔNG rời truy vấn (phụ huynh vẫn chưa đọc ⇒ `unreadCount` vẫn > 0), nên
    // cửa sổ 500 không bao giờ trôi: cặp thứ 501 trở đi chết câm vĩnh viễn trong khi
    // `due` báo về "không còn ai đến hạn". 500 ≈ 20 nhóm lớp × 25 PH — chạm ngay ở pilot.
    h.state.participants = [];
    h.state.messages = [];
    h.state.conversations = [];
    h.state.classes = [];
    h.state.users = h.state.users.filter((u) => u.id === GV);
    // Trần gửi/lượt nới rộng để thứ DUY NHẤT có thể chặn cặp thứ 501 là trần quét.
    h.state.settings["chat.znsMaxPerRun"] = 600;

    const TOTAL = 501;
    for (let i = 0; i < TOTAL; i += 1) {
      const n = String(i).padStart(3, "0"); // sắp xếp chuỗi trùng thứ tự số
      seedClassGroup(`conv-${n}`, `ph-${n}`, `Lớp ${n}`);
      h.state.messages.push(staffMessage(`m-${n}`, `conv-${n}`, 9));
    }

    const res = await run();

    expect(res.sent).toBe(TOTAL);
    // Cặp cuối cùng — thứ 501 theo đúng thứ tự truy vấn. Bản cũ: không có dòng nào.
    expect(h.state.ledger.map((r) => r.userId)).toContain("ph-500");
    expect(res.cappedAtMax).toBe(false);
  });
});
