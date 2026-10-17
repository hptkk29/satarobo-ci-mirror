/**
 * R7 P2 — remindOverdueInstallments: nhắc nợ đợt trả góp (OrderInstallment) qua emailQueue.
 * Postgres LOCAL (.env.test). Spec service-level — gọi remindOverdueInstallments TRỰC TIẾP,
 * không drive UI. enqueueDebtReminder ghi emailQueue contextType="DEBT_REMINDER_ORDER".
 *   - Đợt đến hạn + có email → sent, lastReminderAt set, có emailQueue row.
 *   - Đã nhắc hôm nay (lastReminderAt cùng ngày UTC) → skipped, không thêm email.
 *   - Không có email → skipped.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { remindOverdueInstallments } from "../../../lib/finance/debt";

const NOW = new Date("2026-06-17T08:00:00.000Z");
const OVERDUE = new Date("2026-06-10T00:00:00.000Z"); // quá hạn → đến mốc nhắc với default 14

let seq = 0;
async function seedInstallment(opts: {
  customerEmail?: string | null;
  lastReminderAt?: Date | null;
  amount?: number;
}): Promise<{ orderId: string; orderCode: string; installmentId: string }> {
  seq += 1;
  const code = `ORD-INST-${seq}`;
  const order = await db.order.create({
    data: {
      code,
      type: "COURSE",
      customerName: "PH Test",
      customerPhone: "0900000000",
      customerEmail: opts.customerEmail ?? null,
    },
    select: { id: true, code: true },
  });
  const inst = await db.orderInstallment.create({
    data: {
      orderId: order.id,
      soDot: 2,
      amount: opts.amount ?? 3_000_000,
      status: "PENDING",
      dueDate: OVERDUE,
      lastReminderAt: opts.lastReminderAt ?? null,
    },
    select: { id: true },
  });
  return { orderId: order.id, orderCode: order.code, installmentId: inst.id };
}

async function debtEmailCount(orderId: string): Promise<number> {
  return db.emailQueue.count({
    where: { contextType: "DEBT_REMINDER_ORDER", contextId: orderId },
  });
}

test.describe("R7 P2 remindOverdueInstallments", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("INST-1: đợt đến hạn + có email → sent, lastReminderAt set, email enqueued", async () => {
    const { orderId, installmentId } = await seedInstallment({ customerEmail: "due@test.local" });

    const res = await remindOverdueInstallments({ now: NOW });

    expect(res.found).toBe(1);
    expect(res.sent).toBe(1);
    expect(res.skipped).toBe(0);

    const inst = await db.orderInstallment.findUnique({
      where: { id: installmentId },
      select: { lastReminderAt: true },
    });
    expect(inst?.lastReminderAt?.toISOString()).toBe(NOW.toISOString());
    expect(await debtEmailCount(orderId)).toBe(1);
  });

  test("INST-2: đã nhắc hôm nay (cùng ngày UTC) → skipped, không thêm email", async () => {
    const { orderId } = await seedInstallment({
      customerEmail: "today@test.local",
      lastReminderAt: new Date("2026-06-17T01:00:00.000Z"), // cùng ngày UTC với NOW
    });

    const res = await remindOverdueInstallments({ now: NOW });

    expect(res.found).toBe(1);
    expect(res.sent).toBe(0);
    expect(res.skipped).toBe(1);
    expect(await debtEmailCount(orderId)).toBe(0);
  });

  test("INST-3: không có email → skipped", async () => {
    const { orderId, installmentId } = await seedInstallment({ customerEmail: null });

    const res = await remindOverdueInstallments({ now: NOW });

    expect(res.found).toBe(1);
    expect(res.sent).toBe(0);
    expect(res.skipped).toBe(1);
    expect(await debtEmailCount(orderId)).toBe(0);

    const inst = await db.orderInstallment.findUnique({
      where: { id: installmentId },
      select: { lastReminderAt: true },
    });
    expect(inst?.lastReminderAt).toBeNull(); // không gửi → không set
  });
});
