/**
 * R7-04 (P0 gap fix) — Portal "Học phí" đọc Payment 2 tầng, KHÔNG còn đọc Order cũ.
 * Postgres LOCAL (.env.test). Spec service-level (R7_SKIP_WEBSERVER) — gọi
 * getParentBilling TRỰC TIẾP, không drive UI.
 *   - Học phí = Σ finalPrice (ghi danh đã chốt giá)
 *   - Đã trả   = Σ amount(Payment accountantStatus=CONFIRMED) — khoản PENDING KHÔNG tính (AC1)
 *   - Còn nợ   = Σ max(0, finalPrice − confirmedPaid)
 *   - Biên lai = Receipt ACTIVE của Payment CONFIRMED
 *   - Cách ly sở hữu: chỉ con của parentUserId
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import { getParentBilling } from "../../../lib/portal/billing";

const CENTER = "CS1";

async function seedCenter(): Promise<void> {
  await db.center.upsert({
    where: { id: CENTER },
    create: { id: CENTER, name: CENTER, code: CENTER, slug: CENTER.toLowerCase(), address: "test" },
    update: {},
  });
}

async function seedEnrollment(opts: {
  slug: string;
  parentUserId: string;
  finalPrice: number | null;
}): Promise<{ studentId: string; enrollmentId: string }> {
  const course = await db.course.create({
    data: { name: `Khoá ${opts.slug}`, slug: opts.slug },
    select: { id: true },
  });
  const cls = await db.class.create({
    data: { name: `Lớp ${opts.slug}`, courseId: course.id, centerId: CENTER, status: "ACTIVE" },
    select: { id: true },
  });
  const student = await db.student.create({
    data: { name: `HV ${opts.slug}`, centerId: CENTER, parentUserId: opts.parentUserId },
    select: { id: true },
  });
  const enr = await db.enrollment.create({
    data: {
      studentId: student.id,
      classId: cls.id,
      courseId: course.id,
      status: "STUDYING",
      finalPrice: opts.finalPrice,
    },
    select: { id: true },
  });
  return { studentId: student.id, enrollmentId: enr.id };
}

let orderSeq = 0;
async function addPayment(opts: {
  enrollmentId: string;
  amount: number;
  accountantStatus: "PENDING" | "CONFIRMED";
  withReceipt?: boolean;
}): Promise<void> {
  orderSeq += 1;
  const order = await db.order.create({
    data: {
      code: `ORD-TEST-${orderSeq}`,
      type: "COURSE",
      customerName: "PH Test",
      customerPhone: "0900000000",
      centerId: CENTER,
    },
    select: { id: true },
  });
  const payment = await db.payment.create({
    data: {
      orderId: order.id,
      enrollmentId: opts.enrollmentId,
      amount: opts.amount,
      method: "CASH",
      paidDate: new Date("2026-06-01T00:00:00.000Z"),
      accountantStatus: opts.accountantStatus,
      centerId: CENTER,
    },
    select: { id: true },
  });
  if (opts.withReceipt && opts.accountantStatus === "CONFIRMED") {
    await db.receipt.create({
      data: {
        code: `RCP-TEST-${orderSeq}`,
        enrollmentId: opts.enrollmentId,
        paymentId: payment.id,
        status: "ACTIVE",
      },
    });
  }
}

test.describe("R7-04 portal billing (Payment 2 tầng)", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("BILL-1: totals = finalPrice / CONFIRMED only / outstanding; PENDING không tính", async () => {
    await seedCenter();
    const parent = await seedUser({ email: "bill1@test.local", role: "PARENT" });
    const { enrollmentId } = await seedEnrollment({
      slug: "bill1",
      parentUserId: parent.id,
      finalPrice: 1_000_000,
    });
    await addPayment({ enrollmentId, amount: 400_000, accountantStatus: "CONFIRMED", withReceipt: true });
    await addPayment({ enrollmentId, amount: 600_000, accountantStatus: "PENDING" }); // chưa duyệt

    const billing = await getParentBilling(parent.id);

    expect(billing.totals.tuition).toBe(1_000_000);
    expect(billing.totals.paid).toBe(400_000); // PENDING bị loại
    expect(billing.totals.outstanding).toBe(600_000);
    expect(billing.enrollments).toHaveLength(1);
    expect(billing.enrollments[0]?.confirmedPaid).toBe(400_000);
    expect(billing.enrollments[0]?.outstanding).toBe(600_000);
    expect(billing.receipts).toHaveLength(1); // chỉ Payment CONFIRMED sinh receipt
    expect(billing.receipts[0]?.receiptCode).toBe("RCP-TEST-1");
  });

  test("BILL-2: ghi danh chưa chốt giá (finalPrice null) không vào danh sách", async () => {
    await seedCenter();
    const parent = await seedUser({ email: "bill2@test.local", role: "PARENT" });
    await seedEnrollment({ slug: "bill2", parentUserId: parent.id, finalPrice: null });

    const billing = await getParentBilling(parent.id);
    expect(billing.enrollments).toHaveLength(0);
    expect(billing.totals.tuition).toBe(0);
  });

  test("BILL-3: cách ly sở hữu — không thấy học phí con của phụ huynh khác", async () => {
    await seedCenter();
    const parentA = await seedUser({ email: "bill3a@test.local", role: "PARENT" });
    const parentB = await seedUser({ email: "bill3b@test.local", role: "PARENT" });
    const a = await seedEnrollment({ slug: "bill3a", parentUserId: parentA.id, finalPrice: 500_000 });
    await addPayment({ enrollmentId: a.enrollmentId, amount: 500_000, accountantStatus: "CONFIRMED", withReceipt: true });

    const billingB = await getParentBilling(parentB.id);
    expect(billingB.enrollments).toHaveLength(0);
    expect(billingB.receipts).toHaveLength(0);
    expect(billingB.totals.tuition).toBe(0);
  });

  test("BILL-4: đóng thừa → outstanding của tổng clamp ≥ 0 (không trừ âm)", async () => {
    await seedCenter();
    const parent = await seedUser({ email: "bill4@test.local", role: "PARENT" });
    const { enrollmentId } = await seedEnrollment({
      slug: "bill4",
      parentUserId: parent.id,
      finalPrice: 500_000,
    });
    await addPayment({ enrollmentId, amount: 700_000, accountantStatus: "CONFIRMED", withReceipt: true });

    const billing = await getParentBilling(parent.id);
    expect(billing.enrollments[0]?.outstanding).toBe(-200_000); // raw per-row có thể âm
    expect(billing.totals.outstanding).toBe(0); // tổng clamp ≥ 0
    expect(billing.totals.paid).toBe(700_000);
  });
});
