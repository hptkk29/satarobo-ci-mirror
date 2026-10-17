// @vitest-environment node
/**
 * US-16 AC2 — SỔ GHI mốc đồng ý quy định sử dụng chat (`ChatPolicyAcceptance`).
 *
 * Đây là tầng dưới cùng của cổng chặn: mọi lớp gác phía trên (layout segment, 4 page RSC,
 * route cấp vé realtime) đều hỏi đúng một câu qua `hasAcceptedChatPolicy`. Sai ở đây là
 * sai ở tất cả, nên các bất biến được pin thẳng vào payload gửi xuống Prisma chứ không
 * chỉ pin giá trị trả về.
 *
 * Bất biến pin ở file này:
 *  • Câu hỏi luôn kèm `version` ĐANG PHÁT HÀNH. Bỏ `version` đi thì phụ huynh đã bấm đồng
 *    ý bản 2025 sẽ được coi là đã đồng ý bản mới — đúng thứ mà việc tăng version sinh ra
 *    để chống. (Có test đọc bản CŨ ⇒ vẫn phải hỏi lại.)
 *  • `recordChatPolicyAcceptance` idempotent và `acceptedAt` GIỮ LẦN ĐẦU. Mốc cần lưu là
 *    "lúc nào họ đồng ý", không phải "lần bấm gần nhất" — bấm lại F5 không được dời bằng
 *    chứng. `update` rỗng là thứ giữ điều đó, nên payload `update` được kiểm trực tiếp.
 *  • `userId` rỗng ⇒ false và KHÔNG chạm DB (fail-closed, không bắn query rác).
 *  • Cấu trúc bảng: UNIQUE (userId, version) — chống ghi đôi khi bấm 2 tab — và
 *    `ENABLE ROW LEVEL SECURITY` (luật E-bis #3). Hai thứ này chỉ sống trong file SQL nên
 *    không một test hành vi nào bắt được; đọc thẳng migration là cách duy nhất.
 *
 * Prisma được thay bằng một bản giả CÓ HÀNH VI (tôn trọng khoá unique, `update` rỗng thì
 * không đổi hàng) — bản giả chỉ ghi nhận lời gọi sẽ xanh cả khi `upsert` ghi đè `acceptedAt`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; userId: string; version: string; acceptedAt: Date };

const h = vi.hoisted(() => {
  const state = {
    rows: [] as { id: string; userId: string; version: string; acceptedAt: Date }[],
    /** Đồng hồ giả: mỗi lần ghi nhích 1 phút để "giữ lần đầu" phân biệt được với "ghi đè". */
    tick: 0,
  };
  const nextNow = () => new Date(Date.UTC(2026, 7, 10, 3, state.tick++));

  const findUnique = vi.fn(
    async (args: { where: { userId_version: { userId: string; version: string } } }) => {
      const { userId, version } = args.where.userId_version;
      return (
        state.rows.find((r) => r.userId === userId && r.version === version) ?? null
      );
    },
  );

  const findMany = vi.fn(
    async (args: { where: { userId: { in: string[] }; version: string } }) => {
      const ids = new Set(args.where.userId.in);
      return state.rows.filter((r) => ids.has(r.userId) && r.version === args.where.version);
    },
  );

  /** Mô phỏng đúng ngữ nghĩa Prisma: trúng unique → áp `update`; trượt → `create`. */
  const upsert = vi.fn(
    async (args: {
      where: { userId_version: { userId: string; version: string } };
      create: { userId: string; version: string; acceptedAt?: Date };
      update: Record<string, unknown>;
    }) => {
      const { userId, version } = args.where.userId_version;
      const existing = state.rows.find((r) => r.userId === userId && r.version === version);
      if (existing) {
        Object.assign(existing, args.update); // `update` rỗng ⇒ hàng không đổi
        return existing;
      }
      const row = {
        id: `acc-${state.rows.length + 1}`,
        userId: args.create.userId,
        version: args.create.version,
        acceptedAt: args.create.acceptedAt ?? nextNow(), // DEFAULT CURRENT_TIMESTAMP
      };
      state.rows.push(row);
      return row;
    },
  );

  return {
    state,
    db: { chatPolicyAcceptance: { findUnique, findMany, upsert } },
    findUnique,
    findMany,
    upsert,
  };
});

vi.mock("@/lib/db", () => ({ db: h.db }));

import {
  hasAcceptedChatPolicy,
  recordChatPolicyAcceptance,
  getChatPolicyAcceptedUserIds,
} from "./policy";
import { CHAT_POLICY_VERSION } from "./policy-content";

const V = CHAT_POLICY_VERSION;
const rows = () => h.state.rows as Row[];

beforeEach(() => {
  h.state.rows.length = 0;
  h.state.tick = 0;
  h.findUnique.mockClear();
  h.findMany.mockClear();
  h.upsert.mockClear();
});

// ─── Chưa đồng ý ⇒ cổng đóng ────────────────────────────────────────────────

describe("hasAcceptedChatPolicy", () => {
  it("chưa có bản ghi nào → false (cổng ĐÓNG mặc định)", async () => {
    await expect(hasAcceptedChatPolicy("ph-1")).resolves.toBe(false);
  });

  it("đã đồng ý bản đang phát hành → true, và KHÔNG hỏi lại lần sau", async () => {
    await recordChatPolicyAcceptance("ph-1");

    await expect(hasAcceptedChatPolicy("ph-1")).resolves.toBe(true);
    // Phiên sau (request khác): sổ vẫn còn ⇒ vẫn true, không bắt bấm lại.
    await expect(hasAcceptedChatPolicy("ph-1")).resolves.toBe(true);
  });

  it("hỏi ĐÚNG version đang phát hành — người đồng ý bản CŨ phải bấm lại", async () => {
    // Sổ chỉ có bản cũ. Nếu `where` quên `version`, hàng này sẽ bị nhận nhầm là hợp lệ.
    rows().push({
      id: "acc-cu",
      userId: "ph-1",
      version: "2000-01-01",
      acceptedAt: new Date("2000-01-01T00:00:00.000Z"),
    });

    await expect(hasAcceptedChatPolicy("ph-1")).resolves.toBe(false);
    expect(h.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_version: { userId: "ph-1", version: V } },
      }),
    );
  });

  it("đồng ý của NGƯỜI KHÁC không mở cổng cho mình", async () => {
    await recordChatPolicyAcceptance("ph-1");

    await expect(hasAcceptedChatPolicy("ph-2")).resolves.toBe(false);
  });

  it("userId rỗng → false và KHÔNG bắn truy vấn nào", async () => {
    await expect(hasAcceptedChatPolicy("")).resolves.toBe(false);
    expect(h.findUnique).not.toHaveBeenCalled();
  });
});

// ─── Mốc đồng ý được lưu ────────────────────────────────────────────────────

describe("recordChatPolicyAcceptance — mốc đồng ý", () => {
  it("ghi 1 dòng: đúng người, đúng version, có mốc thời điểm", async () => {
    await recordChatPolicyAcceptance("ph-1");

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ userId: "ph-1", version: V });
    expect(rows()[0].acceptedAt).toBeInstanceOf(Date);
  });

  it("bấm 2 lần (2 tab đua nhau) → vẫn 1 dòng, acceptedAt GIỮ LẦN ĐẦU", async () => {
    await recordChatPolicyAcceptance("ph-1");
    const first = rows()[0].acceptedAt;

    await recordChatPolicyAcceptance("ph-1");
    await recordChatPolicyAcceptance("ph-1");

    expect(rows()).toHaveLength(1);
    expect(rows()[0].acceptedAt.getTime()).toBe(first.getTime());
    // Chốt chặn trực tiếp: `update` phải RỖNG. Thêm `acceptedAt: new Date()` vào đó là
    // mất bằng chứng "lúc đó họ đồng ý", và bản giả ở trên sẽ đổi hàng ⇒ test trên đỏ.
    for (const call of h.upsert.mock.calls) {
      expect((call[0] as { update: Record<string, unknown> }).update).toEqual({});
    }
  });

  it("đồng ý bản mới KHÔNG xoá bản ghi của version cũ (giữ bằng chứng)", async () => {
    rows().push({
      id: "acc-cu",
      userId: "ph-1",
      version: "2000-01-01",
      acceptedAt: new Date("2000-01-01T00:00:00.000Z"),
    });

    await recordChatPolicyAcceptance("ph-1");

    expect(rows()).toHaveLength(2);
    expect(rows().map((r) => r.version).sort()).toEqual(["2000-01-01", V].sort());
  });
});

// ─── Tập đã đồng ý (dashboard pilot) ────────────────────────────────────────

describe("getChatPolicyAcceptedUserIds", () => {
  it("danh sách rỗng → Set rỗng, KHÔNG chạm DB", async () => {
    await expect(getChatPolicyAcceptedUserIds([])).resolves.toEqual(new Set());
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it("chỉ trả người đã đồng ý bản HIỆN HÀNH, trong đúng danh sách hỏi", async () => {
    await recordChatPolicyAcceptance("ph-1");
    await recordChatPolicyAcceptance("ph-3"); // không nằm trong câu hỏi
    rows().push({
      id: "acc-cu",
      userId: "ph-2",
      version: "2000-01-01", // bản cũ ⇒ không tính
      acceptedAt: new Date("2000-01-01T00:00:00.000Z"),
    });

    const set = await getChatPolicyAcceptedUserIds(["ph-1", "ph-2"]);

    expect([...set]).toEqual(["ph-1"]);
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ version: V }),
      }),
    );
  });
});

// ─── Cấu trúc bảng (chỉ sống trong SQL) ─────────────────────────────────────

describe("migration ChatPolicyAcceptance", () => {
  const sql = readFileSync(
    path.join(
      process.cwd(),
      "prisma/migrations/20260810100000_chat_policy_acceptance/migration.sql",
    ),
    "utf8",
  );

  it("có cột acceptedAt mặc định thời điểm ghi (mốc đồng ý không phụ thuộc tầng app)", () => {
    expect(sql).toMatch(/"acceptedAt"\s+TIMESTAMP\(3\)\s+NOT NULL\s+DEFAULT CURRENT_TIMESTAMP/);
  });

  it("UNIQUE (userId, version) — 2 tab bấm cùng lúc không đẻ 2 dòng", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*"ChatPolicyAcceptance"\("userId",\s*"version"\)/);
  });

  it("[E-bis #3] bảng mới trong public PHẢI bật RLS", () => {
    expect(sql).toMatch(/ALTER TABLE "ChatPolicyAcceptance" ENABLE ROW LEVEL SECURITY/);
  });
});
