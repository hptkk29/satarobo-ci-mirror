// R7-04 — payment 2 tầng: kiểm thử các guard fail-fast (return TRƯỚC khi chạm DB):
// amount > 0; reject/adjust/refund BẮT BUỘC reason. Phần chạm DB (record/confirm flow)
// phủ ở e2e (tests/e2e/r7) — ở đây chỉ test nhánh validate thuần.
import { describe, it, expect } from "vitest";
import {
  recordPayment,
  rejectPayment,
  adjustPayment,
  refundPayment,
  STALE_WRITE,
} from "@/lib/finance/payment";

describe("[R7-04] recordPayment guard (AC1)", () => {
  it("amount ≤ 0 → fail trước khi ghi DB", async () => {
    const r0 = await recordPayment({
      orderId: "o1",
      amount: 0,
      method: "CASH",
      paidDate: new Date(),
      recordedById: "u1",
      centerId: null,
    });
    expect(r0.ok).toBe(false);
    if (!r0.ok) expect(r0.error).toMatch(/lớn hơn 0/);

    const rNeg = await recordPayment({
      orderId: "o1",
      amount: -5,
      method: "CASH",
      paidDate: new Date(),
      recordedById: "u1",
      centerId: null,
    });
    expect(rNeg.ok).toBe(false);
  });
});

describe("[R7-04] reject/adjust/refund yêu cầu reason (AC3 / C3)", () => {
  it("rejectPayment reason rỗng → fail", async () => {
    const r = await rejectPayment({ paymentId: "p1", confirmedById: "u1", reason: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Lý do/);
  });

  it("adjustPayment reason rỗng → fail", async () => {
    const r = await adjustPayment({
      paymentId: "p1",
      correctAmount: 1_000_000,
      reason: "",
      actorId: "u1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Lý do/);
  });

  it("refundPayment reason rỗng → fail", async () => {
    const r = await refundPayment({ paymentId: "p1", confirmedById: "u1", reason: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Lý do/);
  });
});

// FIX-H9 — guard reason vẫn fail-fast TRƯỚC khi chạm DB kể cả khi truyền expectedUpdatedAt
// (param mới là additive, không phá guard cũ). STALE_WRITE export đúng cho FE map.
describe("[FIX-H9] optimistic lock — additive param không phá guard", () => {
  it("STALE_WRITE là 'STALE_WRITE' (FE map error.code)", () => {
    expect(STALE_WRITE).toBe("STALE_WRITE");
  });

  it("rejectPayment vẫn fail reason rỗng dù có expectedUpdatedAt", async () => {
    const r = await rejectPayment({
      paymentId: "p1",
      confirmedById: "u1",
      reason: "",
      expectedUpdatedAt: new Date().toISOString(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Lý do/);
  });

  it("adjustPayment vẫn fail reason rỗng dù có expectedUpdatedAt", async () => {
    const r = await adjustPayment({
      paymentId: "p1",
      correctAmount: 1_000_000,
      reason: "",
      actorId: "u1",
      expectedUpdatedAt: new Date(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Lý do/);
  });
});

// NOTE — đường đi idempotency (FIX-H8 confirmPayment) và optimistic-lock thực sự
// (updateMany count===0 → STALE_WRITE) đều CHẠM DB → phủ ở e2e (tests/e2e/r7), không
// test thuần ở đây. Kịch bản e2e: (H8) confirm 2 lần cùng idempotencyKey → 1 Receipt;
// (H9) 2 actor reject/adjust/refund/changeStatus trên cùng updatedAt cũ → request sau STALE_WRITE.
