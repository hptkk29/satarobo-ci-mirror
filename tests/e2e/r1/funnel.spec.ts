/**
 * R1-08 — getFunnelCounts (C8.1) + metrics. PG LOCAL.
 * B-02 · quyết định B3 (24/08/2026): `revenue` (mẫu số ROAS) là THỰC THU trên `Payment`,
 * KHÔNG còn là Σ `Order.totalAmount`. Ba tình huống phải đúng: thu thường · có hoàn ·
 * có điều chỉnh giảm.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { assertTestDb } from "../../e2e/_helpers/seed";
import { getFunnelCounts } from "../../../lib/crm/funnel-query";
import { computeFunnelMetrics } from "../../../lib/crm/marketing-metrics";

/** Tạo 1 đơn tối thiểu để treo bút toán Payment (Payment.orderId là FK bắt buộc). */
async function taoDon(code: string, phone: string, totalAmount: number) {
  return db.order.create({
    data: { code, type: "COURSE", customerName: code, customerPhone: phone, status: "CONFIRMED", totalAmount },
  });
}

test.describe("[R1-08] Funnel dashboard", () => {
  test.beforeEach(async () => {
    assertTestDb();
    await db.messengerConversation.deleteMany({});
    await db.lead.deleteMany({});
    await db.adsInsightDaily.deleteMany({});
    // Payment tham chiếu Order với onDelete: Restrict → phải xoá trước Order.
    await db.payment.deleteMany({});
    await db.order.deleteMany({});
  });

  test("[R1-08-C8.1] đếm funnel L1/L2/L3 + spend đúng số seed", async () => {
    // L1 = 3 hội thoại
    for (const psid of ["a", "b", "c"]) {
      await db.messengerConversation.create({ data: { pageId: "P", psid, firstMessageAt: new Date() } });
    }
    // L2 = 2 lead qualified (1 trong đó converted = L3)
    await db.lead.create({ data: { parentName: "A", phone: "0900000001", qualifiedAt: new Date() } });
    await db.lead.create({ data: { parentName: "B", phone: "0900000002", qualifiedAt: new Date(), convertedAt: new Date() } });
    // 1 lead chưa qualified (không tính L2)
    await db.lead.create({ data: { parentName: "C", phone: "0900000003" } });
    // spend
    await db.adsInsightDaily.create({ data: { date: new Date("2026-06-01"), channel: "facebook", spend: 1_000_000 } });

    // ── Doanh thu = THỰC THU (không phải giá trị hợp đồng) ────────────────────
    const paidDate = new Date("2026-06-10");
    const o1 = await taoDon("ORD-1", "0900000001", 2_000_000);
    const o2 = await taoDon("ORD-2", "0900000002", 1_000_000);
    const o3 = await taoDon("ORD-3", "0900000003", 3_000_000);
    // Đơn có giá trị hợp đồng to nhưng CHƯA thu đồng nào — công thức cũ vẫn cộng nó vào.
    await taoDon("ORD-4", "0900000004", 9_000_000);

    // (1) thu thường → +2tr
    await db.payment.create({
      data: { orderId: o1.id, amount: 2_000_000, method: "cash", paidDate, accountantStatus: "CONFIRMED" },
    });
    // (2) có hoàn: thu 1tr rồi hoàn hết (bút toán ÂM, không xoá gốc) → 0
    const p2 = await db.payment.create({
      data: { orderId: o2.id, amount: 1_000_000, method: "cash", paidDate, accountantStatus: "CONFIRMED" },
    });
    await db.payment.create({
      data: {
        orderId: o2.id, amount: -1_000_000, method: "cash", paidDate,
        accountantStatus: "REFUNDED", adjustmentOfId: p2.id,
      },
    });
    // (3) có điều chỉnh giảm: thu 3tr, kế toán sửa xuống 1tr ⇒ dòng điều chỉnh mang
    //     DELTA −2tr. Cộng CẢ HAI ra 1tr.
    //
    // 🔴 Đổi mô hình 07/09/2026 (`payment_type_tach_khoi_status`), áp khi hợp nhất
    // `main` → `test` 16/09. TRƯỚC: dòng điều chỉnh mang trạng thái `ADJUSTED` và SỐ
    // ĐÚNG (1tr), thay thế bản gốc ⇒ phải loại gốc. NAY: `ADJUSTED` đã bị bỏ khỏi
    // `PaymentAccountantStatus`; dòng điều chỉnh là `CONFIRMED` + `paymentType`
    // ADJUSTMENT, mang PHẦN CHÊNH LỆCH, và bản gốc VẪN được cộng.
    // Tổng của ca này không đổi (1tr) — chỉ cách ghi sổ đổi.
    const p3 = await db.payment.create({
      data: { orderId: o3.id, amount: 3_000_000, method: "cash", paidDate, accountantStatus: "CONFIRMED" },
    });
    await db.payment.create({
      data: {
        orderId: o3.id, amount: -2_000_000, method: "cash", paidDate,
        accountantStatus: "CONFIRMED", adjustmentOfId: p3.id,
      },
    });
    // (4) khoản Sale mới ghi nhận, kế toán chưa duyệt → không phải tiền thật
    await db.payment.create({
      data: { orderId: o3.id, amount: 5_000_000, method: "cash", paidDate, accountantStatus: "PENDING" },
    });

    const counts = await getFunnelCounts();
    expect(counts.l1).toBe(3);
    expect(counts.l2).toBe(2);
    expect(counts.l3).toBe(1);
    expect(counts.spend).toBe(1_000_000);
    // 2tr + 0 (đã hoàn hết) + 1tr (3tr gốc + delta −2tr) = 3tr.
    // Công thức cũ (Σ Order.totalAmount của đơn CONFIRMED) cho 15tr — phồng 5 lần.
    expect(counts.revenue).toBe(3_000_000);

    const m = computeFunnelMetrics(counts);
    expect(m.cpl).toBe(500_000); // 1tr/2
    expect(m.crL2L3).toBe(0.5); // 1/2
    expect(m.roas).toBe(3); // 3tr/1tr
  });

  test.afterEach(async () => {
    await db.payment.deleteMany({});
    await db.order.deleteMany({});
  });
});
