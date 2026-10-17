// FIX-C5 — chống trùng mã đơn. Test: format thuần + counter atomic (không trùng
// khi nhiều mã sinh "song song") + withUniqueRetry (retry P2002, rethrow khác).
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  orderCodeYymmdd,
  formatOrderCode,
  generateOrderCode,
  withUniqueRetry,
} from "@/lib/orders/code";

// ─── Mock counter client ──────────────────────────────────────────────
// Mô phỏng Postgres atomic upsert (`Counter`): read-modify-write ĐỒNG BỘ
// (không await giữa đọc và ghi) → đúng ngữ nghĩa row-lock atomic của DB thật.
function makeCounterClient() {
  const store = new Map<string, number>();
  const client = {
    counter: {
      upsert: async (args: {
        where: { key: string };
        create: { key: string; lastValue: number };
      }) => {
        const cur = store.get(args.where.key);
        const next = cur == null ? args.create.lastValue : cur + 1;
        store.set(args.where.key, next);
        return { lastValue: next };
      },
    },
  };
  return { client, store };
}

type GenClient = Parameters<typeof generateOrderCode>[0];

describe("[FIX-C5] order code — pure helpers", () => {
  it("orderCodeYymmdd → YYMMDD theo local date", () => {
    // 2026-05-21 (tháng 0-index = 4)
    expect(orderCodeYymmdd(new Date(2026, 4, 21))).toBe("260521");
    // 2026-01-09 → pad tháng/ngày
    expect(orderCodeYymmdd(new Date(2026, 0, 9))).toBe("260109");
  });

  it("formatOrderCode → ORD-YYMMDD-NNNNNN (pad 6)", () => {
    expect(formatOrderCode("260521", 1)).toBe("ORD-260521-000001");
    expect(formatOrderCode("260521", 42)).toBe("ORD-260521-000042");
    expect(formatOrderCode("260521", 123456)).toBe("ORD-260521-123456");
  });
});

describe("[FIX-C5] generateOrderCode — counter atomic", () => {
  it("seq tuần tự bắt đầu từ 1 trong cùng ngày", async () => {
    const { client } = makeCounterClient();
    const c = client as unknown as GenClient;
    const date = new Date(2026, 4, 21);
    expect(await generateOrderCode(c, date)).toBe("ORD-260521-000001");
    expect(await generateOrderCode(c, date)).toBe("ORD-260521-000002");
    expect(await generateOrderCode(c, date)).toBe("ORD-260521-000003");
  });

  it("seq reset theo ngày (key gồm yymmdd)", async () => {
    const { client } = makeCounterClient();
    const c = client as unknown as GenClient;
    expect(await generateOrderCode(c, new Date(2026, 4, 21))).toBe(
      "ORD-260521-000001",
    );
    // sang ngày khác → key khác → seq lại từ 1
    expect(await generateOrderCode(c, new Date(2026, 4, 22))).toBe(
      "ORD-260522-000001",
    );
    // quay lại ngày cũ → tiếp tục seq cũ
    expect(await generateOrderCode(c, new Date(2026, 4, 21))).toBe(
      "ORD-260521-000002",
    );
  });

  it("1000 mã sinh song song → 0 trùng", async () => {
    const { client } = makeCounterClient();
    const c = client as unknown as GenClient;
    const date = new Date(2026, 4, 21);
    const codes = await Promise.all(
      Array.from({ length: 1000 }, () => generateOrderCode(c, date)),
    );
    const unique = new Set(codes);
    expect(unique.size).toBe(1000);
    for (const code of codes) {
      expect(code).toMatch(/^ORD-260521-\d{6}$/);
    }
  });
});

describe("[FIX-C5] withUniqueRetry", () => {
  const p2002 = () =>
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });

  it("trả kết quả ngay nếu không lỗi", async () => {
    let calls = 0;
    const r = await withUniqueRetry(async () => {
      calls++;
      return "ok";
    });
    expect(r).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retry khi P2002 rồi thành công", async () => {
    let calls = 0;
    const r = await withUniqueRetry(async () => {
      calls++;
      if (calls < 3) throw p2002();
      return "ok";
    });
    expect(r).toBe("ok");
    expect(calls).toBe(3);
  });

  it("ném ngay với lỗi khác P2002 (không retry)", async () => {
    let calls = 0;
    await expect(
      withUniqueRetry(async () => {
        calls++;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(calls).toBe(1);
  });

  it("ném P2002 sau khi vượt maxRetries", async () => {
    let calls = 0;
    await expect(
      withUniqueRetry(async () => {
        calls++;
        throw p2002();
      }, 2),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    // attempt 0,1,2 → 3 lần
    expect(calls).toBe(3);
  });
});
