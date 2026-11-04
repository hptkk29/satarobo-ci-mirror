/**
 * SEPAY-LEDGER — SePay nuôi SỔ THU THEO ĐỢT.
 *
 * payOS còn chờ xác thực doanh nghiệp, nên SePay là cổng ĐANG CHẠY THẬT. Nếu nó
 * không nuôi được sổ mới thì toàn bộ cơ chế phiếu thu chỉ là code chết — và bug
 * gốc ("khách đóng đợt 1 bị xếp trả thiếu") vẫn còn nguyên trên thực tế.
 *
 * Test ở tầng ingest (không dựng HTTP): route chỉ là vỏ verify + gọi hàm này.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { ingestPayosWebhook } from "../../../lib/payments/payos-ingest";

test.describe("[SEPAY-LEDGER] SePay → sổ thu theo đợt", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  let seq = 0;
  const uniq = () => `${Date.now().toString(36)}-${seq++}`;

  /** Đơn 5tr + 2 phiếu thu đã duyệt: đợt 1 = 3tr, đợt 2 = 2tr. */
  async function seedOrderWithTwoRequests(opts?: { discountPending?: boolean }) {
    const center = await db.center.create({
      data: { code: `CS${seq}`, name: "CS test", slug: `cs-${uniq()}`, address: "x" },
    });
    const code = `ORD-260803-${String(1000 + seq).padStart(6, "0")}`;
    const order = await db.order.create({
      data: {
        code,
        type: "COURSE",
        status: "PENDING_PAYMENT",
        customerName: "PH Test",
        customerPhone: "0905000777",
        centerId: center.id,
        subtotal: 5_000_000,
        totalAmount: 5_000_000,
        installmentApprovalStatus: "APPROVED",
        ...(opts?.discountPending ? { discountApprovalStatus: "PENDING_APPROVAL" as const } : {}),
      },
      select: { id: true, code: true, centerId: true },
    });
    const bare = code.replace(/-/g, "");
    const d1 = await db.paymentRequest.create({
      data: {
        orderId: order.id,
        centerId: center.id,
        installmentNo: 1,
        amountDue: 3_000_000,
        matchKey: `${bare}D1`,
        sortOrder: 1,
      },
      select: { id: true, matchKey: true },
    });
    const d2 = await db.paymentRequest.create({
      data: {
        orderId: order.id,
        centerId: center.id,
        installmentNo: 2,
        amountDue: 2_000_000,
        matchKey: `${bare}D2`,
        sortOrder: 2,
      },
      select: { id: true, matchKey: true },
    });
    return { order, d1, d2, bare };
  }

  /** Payload SePay đã map sang shape ingest (đúng như route đang làm). */
  const sepayPayload = (memo: string, amount: number, txn: string) => ({
    orderCode: txn,
    reference: txn,
    description: memo,
    amount,
    accountNumber: "0123456789",
    paymentLinkId: txn,
  });

  test("[SEPAY-LEDGER-01] nội dung CK mang mã ĐỢT 1 → phiếu đợt 1 PAID, đợt 2 còn PENDING", async () => {
    const { d1, d2 } = await seedOrderWithTwoRequests();

    const res = await ingestPayosWebhook(sepayPayload(d1.matchKey!, 3_000_000, `TXN${uniq()}`), "SEPAY");
    expect(res.status).toBe("MATCHED");

    const after1 = await db.paymentRequest.findUniqueOrThrow({ where: { id: d1.id } });
    const after2 = await db.paymentRequest.findUniqueOrThrow({ where: { id: d2.id } });
    expect(after1.status).toBe("PAID");
    expect(after2.status).toBe("PENDING");

    // Giao dịch ghi đúng provider để đối soát tách được nguồn.
    const txn = await db.bankTransaction.findFirstOrThrow({ where: { provider: "SEPAY" } });
    expect(txn.status).toBe("MATCHED");
  });

  test("[SEPAY-LEDGER-02] nội dung CK chỉ có MÃ ĐƠN (khách gõ tay) → vẫn rơi đúng đợt chưa đóng sớm nhất", async () => {
    const { d1, bare } = await seedOrderWithTwoRequests();

    // Không có hậu tố D1/D2 — đây là ca khách tự nhập nội dung hoặc QR cũ.
    const res = await ingestPayosWebhook(sepayPayload(`CK ${bare} hoc phi`, 3_000_000, `TXN${uniq()}`), "SEPAY");
    expect(res.status).toBe("MATCHED");
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: d1.id } })).status).toBe("PAID");
  });

  test("[SEPAY-LEDGER-03] ghi SONG SONG sổ cũ — công nợ hiện hành vẫn thấy tiền (trước cutover)", async () => {
    const { order, d1 } = await seedOrderWithTwoRequests();
    const txnId = `TXN${uniq()}`;

    await ingestPayosWebhook(sepayPayload(d1.matchKey!, 3_000_000, txnId), "SEPAY");

    const legacy = await db.payment.findFirst({
      where: { orderId: order.id, deletedAt: null },
      select: { amount: true, note: true, method: true },
    });
    expect(legacy).not.toBeNull();
    expect(legacy!.amount).toBe(3_000_000);
    expect(legacy!.note ?? "").toContain(`[auto:sepay:${txnId}]`);
  });

  test("[SEPAY-LEDGER-04] webhook gọi lại cùng giao dịch → đúng 1 BankTransaction, không cộng đôi sổ cũ", async () => {
    const { order, d1 } = await seedOrderWithTwoRequests();
    const txnId = `TXN${uniq()}`;
    const payload = sepayPayload(d1.matchKey!, 3_000_000, txnId);

    for (let i = 0; i < 5; i++) await ingestPayosWebhook(payload, "SEPAY");

    expect(await db.bankTransaction.count({ where: { provider: "SEPAY" } })).toBe(1);
    expect(await db.paymentAllocation.count()).toBe(1);
    const legacySum = await db.payment.aggregate({
      where: { orderId: order.id, deletedAt: null },
      _sum: { amount: true },
    });
    expect(legacySum._sum.amount).toBe(3_000_000);
  });

  test("[SEPAY-LEDGER-05] đóng đủ CẢ 2 đợt → đơn tự CONFIRMED", async () => {
    const { order, d1 } = await seedOrderWithTwoRequests();

    await ingestPayosWebhook(sepayPayload(d1.matchKey!, 5_000_000, `TXN${uniq()}`), "SEPAY");

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("CONFIRMED");
  });

  test("[SEPAY-LEDGER-06] cột giảm giá còn PENDING_APPROVAL cũ → tiền ghi đủ VÀ đơn tự chốt", async () => {
    // Bất biến còn giữ: "không từ chối vì lệch" nói về việc NHẬN tiền — tiền luôn vào sổ.
    // Vế "quét QR không được thành đường lách duyệt giảm giá" đã hết nghĩa từ 14/09/2026:
    // không còn khâu duyệt nào để lách.
    const { order, d1, d2 } = await seedOrderWithTwoRequests({ discountPending: true });

    const res = await ingestPayosWebhook(sepayPayload(d1.matchKey!, 5_000_000, `TXN${uniq()}`), "SEPAY");
    expect(res.status).toBe("MATCHED");

    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: d1.id } })).status).toBe("PAID");
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: d2.id } })).status).toBe("PAID");
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    // ⚠️ ĐẢO 14/09/2026 — ca này TRƯỚC ĐÂY kỳ vọng `PENDING_APPROVAL` giữ đơn ở
    // `PENDING_PAYMENT` ("chờ QLCS duyệt giảm giá"). Cổng đó ĐÃ GỠ cùng cơ chế duyệt đơn
    // hàng: `payos-ingest.ts` không còn lọc `discountApprovalStatus` và `sepay.ts` không
    // còn trả `MANUAL` vì giảm giá. Tiền về đủ ⇒ đơn TỰ CHỐT, kể cả khi cột giảm giá còn
    // mang giá trị cũ `PENDING_APPROVAL` của dữ liệu trước đây.
    //
    // ⚠️ BÀI HỌC KÈM: ở lượt chạy LOCAL cả bộ R7 trên MỘT database, ca này XANH và tôi đã
    // kết luận nhầm rằng nó xanh vì `isOrderSettled` chưa đạt. CI chia R7 thành 2 shard,
    // mỗi shard một Postgres riêng, và ở đó nó ĐỎ với `Received: "CONFIRMED"`. Chạy cả bộ
    // trên một DB là cấu hình CI KHÔNG dùng — kết luận từ lượt chạy đó không đáng tin.
    expect(after.status).toBe("CONFIRMED");
  });

  test("[SEPAY-LEDGER-07] không map được phiếu nào → UNMATCHED, tiền KHÔNG mất", async () => {
    const res = await ingestPayosWebhook(
      sepayPayload("CK khong co ma don", 1_000_000, `TXN${uniq()}`),
      "SEPAY",
    );
    expect(res.status).toBe("UNMATCHED");
    const txn = await db.bankTransaction.findFirstOrThrow({ where: { provider: "SEPAY" } });
    expect(txn.status).toBe("UNMATCHED");
    expect(txn.amount).toBe(1_000_000);
  });
});
