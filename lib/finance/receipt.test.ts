// #15 (câu 25) — phiếu thu ĐÁNH SỐ ĐỘC LẬP TỪNG CƠ SỞ. issueReceipt sinh seq qua
// Counter với KEY chứa mã cơ sở (`receipt:{CC}:{YY}`) → chuỗi CS1 và CS2 tăng riêng,
// KHÔNG trùng / KHÔNG nhảy chéo. Test THUẦN: mock TransactionClient in-memory.
// ⚠️ PHẠM VI: các test dưới verify LOGIC PHÂN VÙNG KEY per-center (tách chuỗi theo cơ
// sở), KHÔNG khẳng định atomicity/race của DB. Mock read-modify-write là ĐỒNG BỘ nên
// không tái hiện được race thật; atomicity + race (kể cả phiếu ĐẦU TIÊN của năm — do
// pattern nextSeq/Counter.upsert của DB lo) được phủ ở e2e chạm Postgres thật.
import { describe, it, expect } from "vitest";
import type { Prisma } from "@prisma/client";
import { issueReceipt } from "@/lib/finance/receipt";

type UpsertArgs = {
  where: { key: string };
  create: { key: string; lastValue: number };
  update: { lastValue: { increment: number } };
};

/** Mock tx: counter.upsert (atomic theo key) + receipt.create (gán id giả). */
function makeMockTx() {
  const counters = new Map<string, number>();
  let seq = 0;
  const created: Array<{ id: string; code: string; enrollmentId: string }> = [];
  const tx = {
    counter: {
      upsert: async (args: UpsertArgs) => {
        const key = args.where.key;
        // Read-modify-write đồng bộ trong 1 lần gọi = atomic per key (mô phỏng DB).
        const next = counters.has(key)
          ? counters.get(key)! + args.update.lastValue.increment
          : args.create.lastValue;
        counters.set(key, next);
        return { lastValue: next };
      },
    },
    receipt: {
      create: async (args: { data: Record<string, unknown> }) => {
        const row = { id: `rcp_${++seq}`, ...(args.data as Record<string, unknown>) };
        created.push(row as unknown as { id: string; code: string; enrollmentId: string });
        return row;
      },
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, created };
}

const NOW = new Date(2026, 5, 15); // 15/06/2026 → YY = "26"

async function issue(tx: Prisma.TransactionClient, centerCode: string, n: number) {
  return issueReceipt({
    enrollmentId: `enr_${n}`,
    paymentId: `pay_${n}`,
    centerCode,
    tx,
    now: NOW,
  });
}

describe("[#15] phiếu thu đánh số độc lập từng cơ sở (câu 25)", () => {
  it("CS1 tăng tuần tự 0001,0002,0003", async () => {
    const { tx } = makeMockTx();
    const r1 = await issue(tx, "CS1", 1);
    const r2 = await issue(tx, "CS1", 2);
    const r3 = await issue(tx, "CS1", 3);
    expect(r1.code).toBe("RCP-CS1-26-0001");
    expect(r2.code).toBe("RCP-CS1-26-0002");
    expect(r3.code).toBe("RCP-CS1-26-0003");
  });

  it("CS2 có chuỗi RIÊNG, KHÔNG tiếp nối CS1 (không nhảy chéo)", async () => {
    const { tx } = makeMockTx();
    // Sinh vài phiếu CS1 trước để counter CS1 đã ở mức cao.
    await issue(tx, "CS1", 1);
    await issue(tx, "CS1", 2);
    await issue(tx, "CS1", 3);
    // CS2 vẫn bắt đầu từ 0001.
    const c1 = await issue(tx, "CS2", 4);
    const c2 = await issue(tx, "CS2", 5);
    expect(c1.code).toBe("RCP-CS2-26-0001");
    expect(c2.code).toBe("RCP-CS2-26-0002");
  });

  it("KEY phân vùng theo cơ sở (receipt:CC:YY): 2 cơ sở đan xen → mỗi cơ sở 1..N liên tục, KHÔNG lẫn (logic phân vùng, KHÔNG phải atomicity DB)", async () => {
    const { tx } = makeMockTx();
    const N = 25;
    // Đan xen CS1 & CS2 trong cùng Promise.all để CHỨNG MINH KEY tách theo cơ sở →
    // chuỗi không lẫn/không nhảy chéo. Đây KHÔNG phải test race/atomicity (mock đồng bộ).
    const jobs: Promise<{ code: string }>[] = [];
    for (let i = 0; i < N; i++) {
      jobs.push(issue(tx, "CS1", i));
      jobs.push(issue(tx, "CS2", i));
    }
    const results = await Promise.all(jobs);
    const codes = results.map((r) => r.code);

    // Không trùng mã trên toàn bộ (kể cả xen kẽ 2 cơ sở).
    expect(new Set(codes).size).toBe(codes.length);

    const cs1 = codes.filter((c) => c.startsWith("RCP-CS1-26-")).sort();
    const cs2 = codes.filter((c) => c.startsWith("RCP-CS2-26-")).sort();
    const expected = (cc: string) =>
      Array.from({ length: N }, (_, i) => `RCP-${cc}-26-${String(i + 1).padStart(4, "0")}`).sort();

    // Mỗi cơ sở đúng N phiếu, seq 0001..00N liên tục (không gap, không nhảy chéo).
    expect(cs1).toEqual(expected("CS1"));
    expect(cs2).toEqual(expected("CS2"));
  });

  it("sanitize mã cơ sở: 'cs_1' → 'CS1' trong mã phiếu", async () => {
    const { tx } = makeMockTx();
    const r = await issue(tx, "cs_1", 1);
    expect(r.code).toBe("RCP-CS1-26-0001");
  });
});
