// @vitest-environment node
/**
 * [NHH-W9e] `setStatementLines` ghi dòng bảng kê VÀ dòng audit chứa MANIFEST trong CÙNG MỘT transaction (04 §3.1, PR5c).
 *
 * Vì sao: manifest — thứ quyết định khoản nào thuộc engine CŨ và khoản nào là LATE_ARRIVAL của engine mới — chỉ sống trong dòng audit
 * "UPDATE" mới nhất của bảng kê (`docManifestCuaBangKe`). Ghi audit SAU và NGOÀI transaction nghĩa là audit hỏng sau khi dòng đã commit
 * ⇒ manifest "mới nhất" là của lần chốt TRƯỚC ⇒ khoản có trong bảng kê đã duyệt mà thiếu trong manifest bị xếp MOI ⇒ trả LẦN HAI.
 *
 * Test thuần (mock `db`): khẳng định HÀNH VI — audit nhận đúng `tx` của transaction đang mở, và lỗi audit làm CẢ transaction reject.
 * (Rollback thật là việc của Prisma khi callback ném; ở đây chứng minh callback CÓ ném.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Tx = { __tx: true; commissionLine: { deleteMany: ReturnType<typeof vi.fn>; createMany: ReturnType<typeof vi.fn> } };

const m = vi.hoisted(() => ({
  tx: null as unknown as Tx,
  txTrongCallback: [] as unknown[],
  ketQuaTransaction: [] as Array<"resolved" | "rejected">,
  writeAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const db = {
    commissionStatement: {
      findUnique: vi.fn(async () => ({ id: "st1", period: "2026-09", status: "DRAFT" })),
      create: vi.fn(),
    },
    // Bản gốc (ngoài transaction) — để mã CŨ chạy được và test đỏ vì ĐÚNG lý do (audit ngoài tx), không vì thiếu mock.
    commissionLine: { deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg !== "function") return Promise.all(arg as Promise<unknown>[]); // dạng mảng (cũ): không có `tx`
      m.txTrongCallback.push(m.tx);
      try {
        const r = await (arg as (tx: Tx) => Promise<unknown>)(m.tx);
        m.ketQuaTransaction.push("resolved");
        return r;
      } catch (e) {
        m.ketQuaTransaction.push("rejected");
        throw e;
      }
    }),
  };
  return { db };
});
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: m.writeAudit }));
vi.mock("@/lib/crm/commission-cutover-gate", () => ({ chanThangThuocSoMoi: vi.fn(async () => undefined), chanMoLaiKyCu: vi.fn(async () => undefined) }));

import { setStatementLines } from "./commission-statement";

const ACTOR = { id: "u1", name: "Kế toán" };
const DONG = [{ recipientId: "u2", tier: "SALE", amount: 100_000 }] as never;

beforeEach(() => {
  m.tx = { __tx: true, commissionLine: { deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 1 })) } };
  m.txTrongCallback.length = 0;
  m.ketQuaTransaction.length = 0;
  m.writeAudit.mockReset();
});

describe("[NHH-W9e] setStatementLines: dòng bảng kê + audit manifest nguyên tử", () => {
  it("audit nhận ĐÚNG `tx` của transaction đang mở và mang đủ manifest; dòng được ghi qua chính tx đó", async () => {
    m.writeAudit.mockResolvedValue({});
    await setStatementLines(ACTOR, { period: "2026-09", lines: DONG, manifest: { paymentIds: ["p2", "p1"], napLuc: new Date("2026-10-01T00:00:00Z") } });
    expect(m.writeAudit).toHaveBeenCalledTimes(1);
    const arg = m.writeAudit.mock.calls[0]![0] as { tx?: unknown; newValues?: { paymentIds?: string[] } };
    expect(arg.tx).toBe(m.tx);
    expect(arg.newValues?.paymentIds).toEqual(["p1", "p2"]);
    expect(m.tx.commissionLine.deleteMany).toHaveBeenCalledTimes(1);
    expect(m.tx.commissionLine.createMany).toHaveBeenCalledTimes(1);
    expect(m.ketQuaTransaction).toEqual(["resolved"]);
  });

  it("audit ném ⇒ CẢ transaction reject (không còn trạng thái 'dòng đã commit, manifest chưa ghi')", async () => {
    m.writeAudit.mockRejectedValue(new Error("audit hỏng"));
    await expect(setStatementLines(ACTOR, { period: "2026-09", lines: DONG, manifest: { paymentIds: ["p1"], napLuc: new Date("2026-10-01T00:00:00Z") } })).rejects.toThrow("audit hỏng");
    expect(m.ketQuaTransaction).toEqual(["rejected"]);
  });
});
