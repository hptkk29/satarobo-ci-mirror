// @vitest-environment node
/**
 * US-16 AC4 — `getChatPilotStats`: đường đi TỪ DB tới bảng số của cổng Đợt 2.
 *
 * `pilot-stats.test.ts` phủ phần thuần (`buildPilotClassStats`). File này phủ phần mà một
 * hàm thuần không bao giờ bắt được:
 *
 *  • **Cách ly cơ sở.** `Conversation` nằm trong `SCOPE_EXEMPT` (DM có `centerId=null`)
 *    nên `scopedDb` KHÔNG cắt hộ — việc cắt là filter TAY theo `getVisibleCenterIds`. Xoá
 *    một dòng filter đó là quản lý CS1 đọc được số của CS2, và không có ESLint hay kiểu dữ
 *    liệu nào kêu. Test này là chốt chặn duy nhất.
 *  • **`?center=` nhét tay.** Tham số lọc trên URL phải bị GIAO nhau với tầm nhìn, không
 *    phải dùng thay tầm nhìn.
 *  • **Biên 48h + mẫu số 0 phụ huynh** đi qua đúng dữ liệu hình dạng DB (`AnnouncementRead`
 *    của thông báo thứ hai, lượt đọc của giáo viên, lớp chỉ có giáo viên…).
 *
 * Prisma giả ở đây **tôn trọng mệnh đề `where`** (lọc theo `centerId in`, `id in`,
 * `leftAt: null`). Bản giả chỉ trả sẵn một mảng cố định sẽ xanh y hệt khi code quên lọc —
 * tức là test không chứng minh gì cả.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Conv = {
  id: string;
  status: string;
  subjectId: string | null;
  centerId: string | null;
  type: string;
  subjectType: string;
  createdAt: Date;
  lastMessageAt: Date | null;
};
type Part = {
  conversationId: string;
  userId: string;
  derivedFrom: string | null;
  leftAt: Date | null;
};
type Usr = {
  id: string;
  role: string;
  roles: string[];
  accountStatus: string;
  lastLoginAt: Date | null;
  name?: string;
  phone?: string;
};
type Ann = { conversationId: string; id: string; createdAt: Date; deletedAt: Date | null };
type Read = { messageId: string; userId: string; readAt: Date };

const h = vi.hoisted(() => {
  const state = {
    conversations: [] as Conv[],
    classes: [] as { id: string; name: string; classCode: string }[],
    centers: [] as { id: string; name: string }[],
    participants: [] as Part[],
    users: [] as Usr[],
    announcements: [] as Ann[],
    reads: [] as Read[],
    accepted: [] as { userId: string; version: string }[],
    /** Ghi lại mọi `where` đã gửi xuống Prisma — để pin CHÍNH mệnh đề lọc cơ sở. */
    calls: [] as { model: string; where: unknown; select?: unknown }[],
  };

  const inList = (clause: unknown): string[] | null => {
    if (clause && typeof clause === "object" && "in" in (clause as Record<string, unknown>)) {
      return (clause as { in: string[] }).in;
    }
    return null;
  };

  const db = {
    conversation: {
      findMany: vi.fn(async (args: { where: Record<string, unknown>; select?: unknown }) => {
        state.calls.push({ model: "conversation", where: args.where, select: args.select });
        const centerIds = inList(args.where.centerId);
        return state.conversations.filter(
          (c) =>
            c.type === args.where.type &&
            c.subjectType === args.where.subjectType &&
            // `in` của Prisma KHÔNG khớp NULL — mô phỏng đúng, vì đó chính là cơ chế
            // khiến nhóm chưa gán cơ sở bị bỏ (fail-closed).
            (centerIds === null || (c.centerId !== null && centerIds.includes(c.centerId))),
        );
      }),
    },
    class: {
      findMany: vi.fn(async (args: { where: { id?: { in: string[] } } }) => {
        state.calls.push({ model: "class", where: args.where });
        const ids = inList(args.where.id) ?? [];
        return state.classes.filter((c) => ids.includes(c.id));
      }),
    },
    center: {
      findMany: vi.fn(async (args: { where: { id?: { in: string[] } } }) => {
        state.calls.push({ model: "center", where: args.where });
        const ids = inList(args.where.id) ?? [];
        return state.centers.filter((c) => ids.includes(c.id));
      }),
    },
    conversationParticipant: {
      findMany: vi.fn(
        async (args: {
          where: { conversationId?: { in: string[] }; leftAt?: Date | null };
        }) => {
          state.calls.push({ model: "conversationParticipant", where: args.where });
          const ids = inList(args.where.conversationId) ?? [];
          return state.participants.filter(
            (p) =>
              ids.includes(p.conversationId) &&
              (args.where.leftAt === null ? p.leftAt === null : true),
          );
        },
      ),
    },
    user: {
      findMany: vi.fn(async (args: { where: { id?: { in: string[] } }; select?: unknown }) => {
        state.calls.push({ model: "user", where: args.where, select: args.select });
        const ids = inList(args.where.id) ?? [];
        const sel = (args.select ?? {}) as Record<string, boolean>;
        return state.users
          .filter((u) => ids.includes(u.id))
          .map((u) =>
            Object.fromEntries(
              Object.entries(u).filter(([k]) => sel[k] === true),
            ) as unknown as Usr,
          );
      }),
    },
    announcementRead: {
      findMany: vi.fn(async (args: { where: { messageId?: { in: string[] } } }) => {
        state.calls.push({ model: "announcementRead", where: args.where });
        const ids = inList(args.where.messageId) ?? [];
        return state.reads.filter((r) => ids.includes(r.messageId));
      }),
    },
    chatPolicyAcceptance: {
      findMany: vi.fn(async (args: { where: { userId: { in: string[] }; version: string } }) => {
        const ids = new Set(args.where.userId.in);
        return state.accepted
          .filter((a) => ids.has(a.userId) && a.version === args.where.version)
          .map((a) => ({ userId: a.userId }));
      }),
    },
    /** `DISTINCT ON` — bản giả trả THÔNG BÁO ĐẦU (chưa gỡ) của mỗi hội thoại được hỏi. */
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const convIds = (values[0] as string[]) ?? [];
      const out: Ann[] = [];
      for (const cid of convIds) {
        const first = state.announcements
          .filter((a) => a.conversationId === cid && a.deletedAt === null)
          .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())[0];
        if (first) out.push(first);
      }
      return out;
    }),
  };

  return { state, db };
});

vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import { getChatPilotStats, pct, PILOT_READ_WINDOW_HOURS } from "./pilot-stats";
import { CHAT_POLICY_VERSION } from "./policy-content";
import type { Actor } from "@/lib/auth/actor";

const HOUR = 3_600_000;
const T0 = new Date("2026-08-10T02:00:00.000Z");
const NOW = new Date(T0.getTime() + 72 * HOUR);

const actorSeeing = (centerIds: string[]): Actor =>
  ({
    userId: "u-actor",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: centerIds,
    visibleOrgUnitIds: centerIds,
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) satisfies Actor;

const conv = (id: string, centerId: string | null, classId: string | null): Conv => ({
  id,
  status: "ACTIVE",
  subjectId: classId,
  centerId,
  type: "CLASS_GROUP",
  subjectType: "CLASS",
  createdAt: T0,
  lastMessageAt: T0,
});

const user = (id: string, over: Partial<Usr> = {}): Usr => ({
  id,
  role: "PARENT",
  roles: ["PARENT"],
  accountStatus: "ACTIVE",
  lastLoginAt: new Date("2026-08-09T00:00:00.000Z"),
  name: `Ten That ${id}`,
  phone: `090000${id}`,
  ...over,
});

const part = (conversationId: string, userId: string, derivedFrom = "CLASS_STUDENT_PARENT"): Part => ({
  conversationId,
  userId,
  derivedFrom,
  leftAt: null,
});

/**
 * Bối cảnh chuẩn: CS1 có lớp A (3 PH + 1 GV), CS2 có lớp B (2 PH).
 * Số của hai cơ sở cố tình KHÁC nhau để "lẫn cơ sở" lộ ra ở con số, không chỉ ở số dòng.
 */
function seedTwoCenters() {
  const s = h.state;
  s.centers = [
    { id: "cs1", name: "Cơ sở 1" },
    { id: "cs2", name: "Cơ sở 2" },
  ];
  s.classes = [
    { id: "lopA", name: "Sata 1 — CS1", classCode: "A" },
    { id: "lopB", name: "Sata 2 — CS2", classCode: "B" },
  ];
  s.conversations = [conv("convA", "cs1", "lopA"), conv("convB", "cs2", "lopB")];
  s.participants = [
    part("convA", "phA1"),
    part("convA", "phA2"),
    part("convA", "phA3"),
    part("convA", "gvA", "CLASS_TEACHER"),
    part("convB", "phB1"),
    part("convB", "phB2"),
  ];
  s.users = [
    user("phA1"),
    user("phA2", { accountStatus: "PENDING_ACTIVATION", lastLoginAt: null }),
    user("phA3", { lastLoginAt: null }),
    user("gvA", { role: "TEACHER", roles: ["TEACHER"] }),
    user("phB1"),
    user("phB2"),
  ];
  s.announcements = [
    { conversationId: "convA", id: "annA1", createdAt: T0, deletedAt: null },
    // Thông báo thứ hai của CÙNG lớp — lượt đọc của nó KHÔNG được tính vào KR2.
    { conversationId: "convA", id: "annA2", createdAt: new Date(T0.getTime() + 10 * HOUR), deletedAt: null },
    { conversationId: "convB", id: "annB1", createdAt: T0, deletedAt: null },
  ];
  s.reads = [
    { messageId: "annA1", userId: "phA1", readAt: new Date(T0.getTime() + HOUR) },
    // Đúng mốc 48h — biên ĐÓNG, phải tính.
    {
      messageId: "annA1",
      userId: "phA2",
      readAt: new Date(T0.getTime() + PILOT_READ_WINDOW_HOURS * HOUR),
    },
    // Quá 48h đúng 1 mili giây — KHÔNG tính vào KR2, vẫn tính "đã đọc".
    {
      messageId: "annA1",
      userId: "phA3",
      readAt: new Date(T0.getTime() + PILOT_READ_WINDOW_HOURS * HOUR + 1),
    },
    // Giáo viên mở thông báo cũng sinh AnnouncementRead — không được vào tử số.
    { messageId: "annA1", userId: "gvA", readAt: new Date(T0.getTime() + HOUR) },
    // Lượt đọc của thông báo THỨ HAI — không thuộc phép đo KR2.
    { messageId: "annA2", userId: "phA3", readAt: new Date(T0.getTime() + 11 * HOUR) },
    { messageId: "annB1", userId: "phB1", readAt: new Date(T0.getTime() + 2 * HOUR) },
    { messageId: "annB1", userId: "phB2", readAt: new Date(T0.getTime() + 3 * HOUR) },
  ];
  s.accepted = [
    { userId: "phA1", version: CHAT_POLICY_VERSION },
    { userId: "phA2", version: "2000-01-01" }, // bản cũ ⇒ không tính
    { userId: "phB1", version: CHAT_POLICY_VERSION },
    { userId: "phB2", version: CHAT_POLICY_VERSION },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.calls = [];
  seedTwoCenters();
});

// ─── Cách ly cơ sở ──────────────────────────────────────────────────────────

describe("cách ly cơ sở", () => {
  it("người CS1 KHÔNG thấy một con số nào của CS2", async () => {
    const rows = await getChatPilotStats(actorSeeing(["cs1"]), { now: NOW });

    expect(rows.map((r) => r.conversationId)).toEqual(["convA"]);
    expect(rows.map((r) => r.classId)).not.toContain("lopB");
    // Không chỉ thiếu dòng: mẫu số cũng không được cộng nhầm 2 PH của CS2 vào.
    expect(rows[0].parentCount).toBe(3);
    expect(JSON.stringify(rows)).not.toContain("cs2");
    expect(JSON.stringify(rows)).not.toContain("Cơ sở 2");
  });

  it("người CS2 chỉ thấy CS2 (đối xứng — không phải 'CS1 là mặc định')", async () => {
    const rows = await getChatPilotStats(actorSeeing(["cs2"]), { now: NOW });

    expect(rows.map((r) => r.conversationId)).toEqual(["convB"]);
    expect(rows[0].parentCount).toBe(2);
  });

  it("mệnh đề lọc cơ sở ĐI XUỐNG DB (không lọc sau khi đã kéo cả nước về)", async () => {
    await getChatPilotStats(actorSeeing(["cs1"]), { now: NOW });

    const call = h.state.calls.find((c) => c.model === "conversation");
    expect(call?.where).toMatchObject({ centerId: { in: ["cs1"] } });
  });

  it("[leo rào] ?center=cs2 của người chỉ thấy CS1 → rỗng, KHÔNG phải số của CS2", async () => {
    const rows = await getChatPilotStats(actorSeeing(["cs1"]), {
      centerId: "cs2",
      now: NOW,
    });

    expect(rows).toEqual([]);
  });

  it("?center=cs1 hợp lệ → giao nhau đúng 1 cơ sở", async () => {
    const rows = await getChatPilotStats(actorSeeing(["cs1", "cs2"]), {
      centerId: "cs1",
      now: NOW,
    });

    expect(rows.map((r) => r.conversationId)).toEqual(["convA"]);
  });

  it("actor thấy cả 2 cơ sở → cả 2 dòng (chứng minh test trên không rỗng vì lý do khác)", async () => {
    const rows = await getChatPilotStats(actorSeeing(["cs1", "cs2"]), { now: NOW });

    expect(rows.map((r) => r.conversationId).sort()).toEqual(["convA", "convB"]);
  });

  it("actor không có cơ sở nào → rỗng và KHÔNG chạm DB", async () => {
    const rows = await getChatPilotStats(actorSeeing([]), { now: NOW });

    expect(rows).toEqual([]);
    expect(h.db.conversation.findMany).not.toHaveBeenCalled();
  });

  it("nhóm chưa gán cơ sở (centerId NULL) bị BỎ — fail-closed", async () => {
    h.state.conversations.push(conv("convX", null, "lopX"));
    h.state.classes.push({ id: "lopX", name: "Lớp mồ côi", classCode: "X" });
    h.state.participants.push(part("convX", "phX1"));
    h.state.users.push(user("phX1"));

    const rows = await getChatPilotStats(actorSeeing(["cs1", "cs2"]), { now: NOW });

    expect(rows.map((r) => r.conversationId)).not.toContain("convX");
  });
});

// ─── % kích hoạt ────────────────────────────────────────────────────────────

describe("% kích hoạt (đi qua DB)", () => {
  it("PENDING_ACTIVATION không tính; 'đã kích hoạt' ≠ 'đã đăng nhập'", async () => {
    const [a] = await getChatPilotStats(actorSeeing(["cs1"]), { now: NOW });

    expect(a.parentCount).toBe(3); // giáo viên KHÔNG vào mẫu số
    expect(a.activatedCount).toBe(2); // phA1 + phA3
    expect(a.loggedInCount).toBe(1); // chỉ phA1 từng đăng nhập
    expect(pct(a.activatedCount, a.parentCount)).toBe(67);
    expect(pct(a.loggedInCount, a.parentCount)).toBe(33);
  });

  it("[0 phụ huynh] lớp chỉ có giáo viên → mẫu số 0, tỉ lệ là '—' chứ không phải 0% hay 100%", async () => {
    h.state.participants = [part("convA", "gvA", "CLASS_TEACHER")];

    const [a] = await getChatPilotStats(actorSeeing(["cs1"]), { now: NOW });

    expect(a.parentCount).toBe(0);
    expect(a.activatedCount).toBe(0);
    expect(a.readWithinWindowCount).toBe(0);
    expect(pct(a.activatedCount, a.parentCount)).toBeNull();
    expect(pct(a.readWithinWindowCount, a.parentCount)).toBeNull();
  });

  it("phụ huynh đã rời nhóm (leftAt) không còn trong mẫu số", async () => {
    h.state.participants = h.state.participants.map((p) =>
      p.userId === "phA3" ? { ...p, leftAt: new Date(T0.getTime() + HOUR) } : p,
    );

    const [a] = await getChatPilotStats(actorSeeing(["cs1"]), { now: NOW });

    expect(a.parentCount).toBe(2);
  });
});

// ─── % đọc thông báo đầu trong 48h ──────────────────────────────────────────

describe("% đọc thông báo đầu trong 48h (đi qua DB)", () => {
  it("biên: đúng 48h TÍNH, quá 48h 1ms KHÔNG tính (vẫn vào cột 'đã đọc')", async () => {
    const [a] = await getChatPilotStats(actorSeeing(["cs1"]), { now: NOW });

    expect(a.readWithinWindowCount).toBe(2); // phA1 (+1h) + phA2 (đúng 48h)
    expect(a.readTotalCount).toBe(3); // thêm phA3 (48h + 1ms)
    expect(pct(a.readWithinWindowCount, a.parentCount)).toBe(67);
  });

  it("chỉ đo thông báo ĐẦU: lượt đọc thông báo thứ hai không được cộng vào", async () => {
    const [a] = await getChatPilotStats(actorSeeing(["cs1"]), { now: NOW });

    // phA3 có đọc `annA2` trong 11h, nhưng KR2 hỏi về `annA1`.
    expect(a.readTotalCount).toBe(3);
    // Truy vấn lượt đọc CHỈ hỏi về thông báo đầu của các nhóm trong tầm nhìn.
    const readCall = h.state.calls.find((c) => c.model === "announcementRead");
    expect(readCall?.where).toMatchObject({ messageId: { in: ["annA1"] } });
  });

  it("giáo viên mở thông báo không vào tử số (chống 'đã đọc 4/3')", async () => {
    const [a] = await getChatPilotStats(actorSeeing(["cs1"]), { now: NOW });

    expect(a.readWithinWindowCount).toBeLessThanOrEqual(a.parentCount);
  });

  it("48h chưa trôi qua → windowClosed=false (số CÒN CHẠY, chưa dùng để chốt cổng)", async () => {
    const rows = await getChatPilotStats(actorSeeing(["cs1"]), {
      now: new Date(T0.getTime() + 5 * HOUR),
    });

    expect(rows[0].windowClosed).toBe(false);
  });

  it("lớp chưa có thông báo nào → firstAnnouncementAt null (không tự nhận 0%)", async () => {
    h.state.announcements = h.state.announcements.filter(
      (a) => a.conversationId !== "convA",
    );

    const [a] = await getChatPilotStats(actorSeeing(["cs1"]), { now: NOW });

    expect(a.firstAnnouncementAt).toBeNull();
    expect(a.readWithinWindowCount).toBe(0);
  });
});

// ─── Đồng ý chính sách + PII ────────────────────────────────────────────────

describe("cột đã đồng ý quy định", () => {
  it("chỉ đếm bản ĐANG PHÁT HÀNH (đồng ý bản cũ không tính)", async () => {
    const [a] = await getChatPilotStats(actorSeeing(["cs1"]), { now: NOW });

    expect(a.policyAcceptedCount).toBe(1); // phA1; phA2 chỉ đồng ý bản 2000-01-01
  });
});

describe("BR-30 — bảng SỐ không mang theo danh tính", () => {
  it("không select tên/SĐT/email của phụ huynh, và không có chuỗi nào lọt ra kết quả", async () => {
    const rows = await getChatPilotStats(actorSeeing(["cs1", "cs2"]), { now: NOW });

    const userCall = h.state.calls.find((c) => c.model === "user");
    const select = (userCall?.select ?? {}) as Record<string, boolean>;
    for (const forbidden of ["name", "phone", "email", "address"]) {
      expect(select[forbidden]).toBeUndefined();
    }
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain("Ten That");
    expect(dump).not.toContain("090000");
  });
});
