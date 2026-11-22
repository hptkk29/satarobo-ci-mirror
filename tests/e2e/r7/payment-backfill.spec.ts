/**
 * BACKFILL PHIẾU THU — dựng sổ mới (PaymentRequest ← PaymentAllocation ←
 * BankTransaction) từ đơn + khoản thu cũ. Postgres LOCAL (.env.test).
 *
 * Test service-level (mẫu bulk-convert.spec.ts): gọi thẳng `runBackfill()`, không
 * dựng HTTP. Chạy:
 *   $env:R7_SKIP_WEBSERVER='1'; pnpm test:e2e:r7 payment-backfill
 *
 * Phủ đúng 5 ca chốt: đơn không trả góp, đơn duyệt 2 đợt, đơn đã thu đợt 1 (marker
 * `[auto:order-installment:dot1]`), chạy lại 2 lần (idempotent), khoản đã soft-delete.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import {
  runBackfill,
  planRequests,
  requestMatchKey,
  markerInstallmentNo,
  backfillTxnId,
  BACKFILL_PROVIDER,
} from "../../../scripts/backfill-payment-requests";
// Nguồn CHÍNH THỨC của quy ước matchKey (đường chạy thật). Script backfill phải
// chép đúng nó — xem test [PAY-BF-00b].
import { paymentMatchKey, FULL_ORDER_INSTALLMENT_NO } from "../../../lib/payments/payment-request";

test.describe("[PAY-BF] Backfill phiếu thu từ sổ cũ", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  let seq = 0;
  const uniq = () => `${Date.now().toString(36)}-${seq++}`;

  async function seedCenter(code = "CS1") {
    return db.center.create({
      data: { code: `${code}-${uniq()}`, name: `Cơ sở ${code}`, slug: `cs-${uniq()}`, address: "x" },
    });
  }

  /** Mã đơn theo đúng dạng thật `ORD-YYMMDD-NNNNNN` để matchKey ra đúng. */
  function orderCode(n: number): string {
    return `ORD-260803-${String(n).padStart(6, "0")}`;
  }

  let codeSeq = 1;
  async function seedOrder(
    centerId: string,
    opts: { totalAmount: number; installmentApprovalStatus?: "APPROVED" | "PENDING_APPROVAL" | null },
  ) {
    return db.order.create({
      data: {
        code: orderCode(codeSeq++),
        type: "COURSE",
        status: "PENDING_PAYMENT",
        customerName: "PH Backfill",
        customerPhone: `84905${String(codeSeq).padStart(6, "0")}`,
        centerId,
        subtotal: opts.totalAmount,
        totalAmount: opts.totalAmount,
        installmentApprovalStatus: opts.installmentApprovalStatus ?? null,
      },
    });
  }

  async function seedInstallments(orderId: string, amounts: number[]) {
    for (let i = 0; i < amounts.length; i++) {
      await db.orderInstallment.create({
        data: { orderId, soDot: i + 1, amount: amounts[i], status: "PENDING" },
      });
    }
  }

  async function seedPayment(
    order: { id: string; centerId: string | null },
    opts: { amount: number; note?: string; paidDate?: Date; deletedAt?: Date },
  ) {
    return db.payment.create({
      data: {
        orderId: order.id,
        amount: opts.amount,
        method: "auto",
        paidDate: opts.paidDate ?? new Date("2026-08-01T03:00:00Z"),
        note: opts.note ?? null,
        saleStatus: "RECORDED",
        accountantStatus: "PENDING",
        centerId: order.centerId,
        deletedAt: opts.deletedAt ?? null,
      },
    });
  }

  async function requestsOf(orderId: string) {
    return db.paymentRequest.findMany({
      where: { orderId },
      orderBy: { installmentNo: "asc" },
      include: { allocations: true },
    });
  }

  // ── Hàm thuần (không cần DB) ────────────────────────────────────────────────

  test("[PAY-BF-00] matchKey + marker: quy ước khoá đối khớp đúng như chốt", () => {
    // Phiếu toàn đơn CŨNG có hậu tố `D0` — đây là dạng `paymentMatchKey()` sinh ra
    // ở đường chạy thật, và `collectMatchKeyCandidates` dò khớp CHÍNH XÁC chuỗi.
    expect(requestMatchKey("ORD-260803-000012", 0)).toBe("ORD260803000012D0");
    expect(requestMatchKey("ORD-260803-000012", 1)).toBe("ORD260803000012D1");
    expect(requestMatchKey("ORD-260803-000012", 2)).toBe("ORD260803000012D2");

    expect(markerInstallmentNo("Ghi nhận tự động đợt 1 [auto:order-installment:dot1]")).toBe(1);
    expect(markerInstallmentNo("Ghi nhận tự động đợt 2 [auto:order-installment:dot2]")).toBe(2);
    expect(markerInstallmentNo("Ghi nhận tự động (xác nhận đơn) [auto:order-confirm]")).toBeNull();
    expect(markerInstallmentNo(null)).toBeNull();

    // ⚠️ SỬA 17/09/2026 — ca này TRƯỚC ĐÂY khẳng định *"kế hoạch CHƯA duyệt → vẫn 1 phiếu
    // toàn đơn"*, và nó đã ĐỎ TRÊN CI. Mã đúng, TEST SAI: luật ấy bị đảo từ 13/09
    // (`00131d18`) — nay **chỉ `REJECTED`** làm kế hoạch mất hiệu lực, còn `PENDING_APPROVAL`
    // và `null` đều CÓ hiệu lực. `planRequests` đã sửa theo từ 14/09; ca này thì không, vì nó
    // nằm ở bộ R7 mà lượt sửa hôm ấy không chạy.
    //
    // Giữ nguyên ca cũ là ghim một luật đã chết: người sửa sau sẽ đọc nó như đặc tả và "sửa"
    // mã cho khớp — tức dựng lại đúng con bug đơn 8tr hoá 16tr phải thu (xem khối chú thích
    // của `planRequests`).
    expect(
      planRequests({
        code: "ORD-260803-000099",
        totalAmount: 6_000_000,
        installmentApprovalStatus: "PENDING_APPROVAL",
        installments: [
          { soDot: 1, amount: 3_000_000, dueDate: null },
          { soDot: 2, amount: 3_000_000, dueDate: null },
        ],
      }),
    ).toEqual([
      { installmentNo: 1, amountDue: 3_000_000, dueDate: null, sortOrder: 1, matchKey: "ORD260803000099D1" },
      { installmentNo: 2, amountDue: 3_000_000, dueDate: null, sortOrder: 2, matchKey: "ORD260803000099D2" },
    ]);

    // Và vế còn lại của luật mới, để ca này nói ĐỦ chứ không nửa vời: `REJECTED` vẫn rơi về
    // một phiếu toàn đơn.
    expect(
      planRequests({
        code: "ORD-260803-000099",
        totalAmount: 6_000_000,
        installmentApprovalStatus: "REJECTED",
        installments: [
          { soDot: 1, amount: 3_000_000, dueDate: null },
          { soDot: 2, amount: 3_000_000, dueDate: null },
        ],
      }),
    ).toEqual([
      {
        installmentNo: 0,
        amountDue: 6_000_000,
        dueDate: null,
        sortOrder: 0,
        matchKey: "ORD260803000099D0",
      },
    ]);
  });

  test("[PAY-BF-00b] matchKey của backfill TRÙNG TỪNG KÝ TỰ với paymentMatchKey() chính thức", () => {
    // Chống trôi: script CLI không import được `payment-request.ts` (server-only)
    // nên phải chép công thức. Test này là thứ duy nhất giữ hai bên dính nhau —
    // lệch 1 ký tự = tiền về không tra ra phiếu → rơi vào UNMATCHED.
    const codes = ["ORD-260803-000012", "ORD260803000012", "ORD_260803/000012", "ORD-999999-123456"];
    for (const code of codes) {
      for (const no of [FULL_ORDER_INSTALLMENT_NO, 1, 2, 3]) {
        expect(requestMatchKey(code, no), `${code} · đợt ${no}`).toBe(paymentMatchKey(code, no));
      }
    }
  });

  // ── 1. Đơn không trả góp ────────────────────────────────────────────────────

  test("[PAY-BF-01] đơn không trả góp → 1 phiếu toàn đơn đúng số tiền", async () => {
    const center = await seedCenter();
    const order = await seedOrder(center.id, { totalAmount: 5_000_000 });

    const dry = await runBackfill({ apply: false });
    expect(dry.requestsCreated).toBe(1);
    expect(await db.paymentRequest.count()).toBe(0); // DRY-RUN không ghi gì

    await runBackfill({ apply: true });

    const rows = await requestsOf(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].installmentNo).toBe(0);
    expect(rows[0].amountDue).toBe(5_000_000);
    expect(rows[0].sortOrder).toBe(0);
    expect(rows[0].matchKey).toBe(requestMatchKey(order.code, 0));
    expect(rows[0].centerId).toBe(center.id); // SCOPED_MODEL — không được để null
    expect(rows[0].status).toBe("PENDING"); // chưa thu đồng nào
  });

  // ── 2. Đơn đã duyệt kế hoạch 2 đợt ──────────────────────────────────────────

  test("[PAY-BF-02] đơn đã duyệt 2 đợt → 2 phiếu đúng kế hoạch", async () => {
    const center = await seedCenter();
    const order = await seedOrder(center.id, {
      totalAmount: 8_000_000,
      installmentApprovalStatus: "APPROVED",
    });
    await seedInstallments(order.id, [5_000_000, 3_000_000]);

    await runBackfill({ apply: true });

    const rows = await requestsOf(order.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.installmentNo)).toEqual([1, 2]);
    expect(rows.map((r) => r.amountDue)).toEqual([5_000_000, 3_000_000]);
    expect(rows.map((r) => r.sortOrder)).toEqual([1, 2]);
    expect(rows.map((r) => r.matchKey)).toEqual([
      requestMatchKey(order.code, 1),
      requestMatchKey(order.code, 2),
    ]);
    expect(rows.every((r) => r.status === "PENDING")).toBe(true);
  });

  // ── 3. Đơn đã thu đợt 1 ─────────────────────────────────────────────────────

  test("[PAY-BF-03] đã thu đợt 1 (marker dot1) → phiếu đợt 1 PAID, đợt 2 PENDING", async () => {
    const center = await seedCenter();
    const order = await seedOrder(center.id, {
      totalAmount: 8_000_000,
      installmentApprovalStatus: "APPROVED",
    });
    await seedInstallments(order.id, [5_000_000, 3_000_000]);
    const payment = await seedPayment(order, {
      amount: 5_000_000,
      note: "Ghi nhận tự động đợt 1 [auto:order-installment:dot1]",
    });

    await runBackfill({ apply: true });

    const rows = await requestsOf(order.id);
    expect(rows).toHaveLength(2);

    const dot1 = rows.find((r) => r.installmentNo === 1)!;
    const dot2 = rows.find((r) => r.installmentNo === 2)!;
    expect(dot1.status).toBe("PAID");
    expect(dot1.allocations.reduce((s, a) => s + a.amount, 0)).toBe(5_000_000);
    expect(dot2.status).toBe("PENDING");
    expect(dot2.allocations).toHaveLength(0);

    // Giao dịch tổng hợp neo đúng khoản Payment gốc + đã khớp.
    const txn = await db.bankTransaction.findUnique({
      where: {
        provider_providerTxnId: {
          provider: BACKFILL_PROVIDER,
          providerTxnId: backfillTxnId(payment.id),
        },
      },
    });
    expect(txn).not.toBeNull();
    expect(txn!.amount).toBe(5_000_000);
    expect(txn!.status).toBe("MATCHED");
    expect(txn!.centerId).toBe(center.id);
  });

  test("[PAY-BF-03b] khoản KHÔNG marker rót waterfall: đợt 1 trước, dư tràn sang đợt 2", async () => {
    const center = await seedCenter();
    const order = await seedOrder(center.id, {
      totalAmount: 8_000_000,
      installmentApprovalStatus: "APPROVED",
    });
    await seedInstallments(order.id, [5_000_000, 3_000_000]);
    await seedPayment(order, { amount: 6_000_000, note: "Thu tay tại quầy" });

    await runBackfill({ apply: true });

    const rows = await requestsOf(order.id);
    const dot1 = rows.find((r) => r.installmentNo === 1)!;
    const dot2 = rows.find((r) => r.installmentNo === 2)!;
    expect(dot1.status).toBe("PAID");
    expect(dot1.allocations.reduce((s, a) => s + a.amount, 0)).toBe(5_000_000);
    expect(dot2.status).toBe("PARTIAL");
    expect(dot2.allocations.reduce((s, a) => s + a.amount, 0)).toBe(1_000_000);
  });

  // ── 4. Idempotent ───────────────────────────────────────────────────────────

  test("[PAY-BF-04] chạy 2 lần → không nhân đôi phiếu, giao dịch, phân bổ", async () => {
    const center = await seedCenter();
    const order = await seedOrder(center.id, {
      totalAmount: 8_000_000,
      installmentApprovalStatus: "APPROVED",
    });
    await seedInstallments(order.id, [5_000_000, 3_000_000]);
    await seedPayment(order, {
      amount: 5_000_000,
      note: "Ghi nhận tự động đợt 1 [auto:order-installment:dot1]",
    });

    const first = await runBackfill({ apply: true });
    expect(first.requestsCreated).toBe(2);
    expect(first.allocationsCreated).toBe(1);

    const second = await runBackfill({ apply: true });
    expect(second.requestsCreated).toBe(0);
    expect(second.allocationsCreated).toBe(0);
    expect(second.paymentsSkipped).toBe(1); // khoản đã backfill → bỏ qua hẳn

    expect(await db.paymentRequest.count({ where: { orderId: order.id } })).toBe(2);
    expect(await db.bankTransaction.count()).toBe(1);
    expect(await db.paymentAllocation.count()).toBe(1);

    // Trạng thái không bị "trôi" sau lần chạy thứ 2.
    const rows = await requestsOf(order.id);
    expect(rows.find((r) => r.installmentNo === 1)!.status).toBe("PAID");
    expect(rows.find((r) => r.installmentNo === 2)!.status).toBe("PENDING");
  });

  // ── 5. Khoản đã soft-delete ─────────────────────────────────────────────────

  test("[PAY-BF-05] Payment đã soft-delete KHÔNG được tính vào phân bổ", async () => {
    const center = await seedCenter();
    const order = await seedOrder(center.id, { totalAmount: 5_000_000 });
    // Khoản hợp lệ 2tr + khoản đã xoá 3tr → chỉ 2tr được rót ⇒ phiếu PARTIAL.
    await seedPayment(order, { amount: 2_000_000, paidDate: new Date("2026-08-01T03:00:00Z") });
    const deleted = await seedPayment(order, {
      amount: 3_000_000,
      paidDate: new Date("2026-08-02T03:00:00Z"),
      deletedAt: new Date("2026-08-02T04:00:00Z"),
    });

    await runBackfill({ apply: true });

    const rows = await requestsOf(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PARTIAL");
    expect(rows[0].allocations.reduce((s, a) => s + a.amount, 0)).toBe(2_000_000);

    // Không dựng giao dịch tổng hợp cho khoản đã xoá.
    expect(await db.bankTransaction.count()).toBe(1);
    const ghost = await db.bankTransaction.findUnique({
      where: {
        provider_providerTxnId: {
          provider: BACKFILL_PROVIDER,
          providerTxnId: backfillTxnId(deleted.id),
        },
      },
    });
    expect(ghost).toBeNull();
  });

  // ── Dung sai làm tròn ───────────────────────────────────────────────────────

  test("[PAY-BF-07] chạy lại KHÔNG đẩy phiếu PAID-nhờ-dung-sai về PARTIAL", async () => {
    const center = await seedCenter();
    const order = await seedOrder(center.id, { totalAmount: 5_000_000 });
    await runBackfill({ apply: true });

    // Mô phỏng tiền THẬT về qua cổng: thiếu 2.000đ nhưng nằm trong dung sai →
    // phiếu PAID, phần thiếu ghi vào roundingWaived (đúng cách payos-ingest ghi).
    const req = (await requestsOf(order.id))[0];
    const txn = await db.bankTransaction.create({
      data: {
        provider: "PAYOS",
        providerTxnId: `live-${uniq()}`,
        amount: 4_998_000,
        transferredAt: new Date(),
        status: "MATCHED",
        centerId: center.id,
      },
    });
    await db.paymentAllocation.create({
      data: {
        bankTransactionId: txn.id,
        paymentRequestId: req.id,
        amount: 4_998_000,
        roundingWaived: 2_000,
        centerId: center.id,
      },
    });
    await db.paymentRequest.update({ where: { id: req.id }, data: { status: "PAID" } });

    await runBackfill({ apply: true });

    const after = (await requestsOf(order.id))[0];
    expect(after.status).toBe("PAID"); // KHÔNG được rớt về PARTIAL
  });

  // ── Fail-safe ───────────────────────────────────────────────────────────────

  test("[PAY-BF-06] --apply bị CHẶN khi DATABASE_URL không phải DB local/test", async () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://postgres.abc:pw@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres";
    try {
      await expect(runBackfill({ apply: true })).rejects.toThrow(/TỪ CHỐI GHI/);
      // Có --prod tường minh thì cho qua cổng chặn (chỉ kiểm tra cổng, không ghi thật:
      // Prisma client đã khởi tạo với URL test nên vẫn chạy trên DB test).
      await expect(runBackfill({ apply: true, allowRemote: true })).resolves.toBeTruthy();
    } finally {
      process.env.DATABASE_URL = original;
    }
  });
});
