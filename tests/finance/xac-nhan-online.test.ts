// Ca [KTO-*] — khoản của đơn ONLINE (Order.type ONLINE) xác nhận được KHÔNG cần ghi danh Offline, trên Postgres THẬT. Owner chốt V8.18: «Online Order · Payment · Receipt = SataRobo, không Enrollment Offline giả».
//   · ONLINE ⇒ CONFIRMED + đúng MỘT phiếu thu `enrollmentId = null`, mã `RCP-SR-…` (đơn không có cơ sở), gắn đúng Payment; bấm đôi / xác nhận SONG SONG vẫn một
//   · đối chứng: đơn COURSE (cùng hình dạng: không cơ sở, không ghi danh) ⇒ VẪN bị chặn — miễn trừ chỉ có ONLINE
//   · phiếu thu KHÔNG đẻ ghi danh Offline nào
// Bộ này KHÔNG gọi `resetDb()`: tự dựng, tự dọn theo tiền tố.
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { KHOAN_DA_XAC_NHAN } from "@/lib/finance/debt";
import { SALE_STATUS_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { confirmPayment } from "@/lib/finance/payment";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";

if (!RUN_DB_TESTS) console.warn(`[KTO] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-kto-";
const DON = `${T}don`;
const P = `${T}p`;
const KT = `${T}ke-toan`;
const DA_XAC_NHAN = KHOAN_DA_XAC_NHAN.accountantStatus;
const DA_GHI_NHAN = SALE_STATUS_DA_GHI_NHAN[0]!;

async function don() {
  await db.receipt.deleteMany({ where: { paymentId: { startsWith: T } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { contains: T } } });
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.notification.deleteMany({ where: { dedupeKey: { contains: T } } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
}

async function dungFixture(type: "ONLINE" | "COURSE") {
  await don();
  await db.order.create({ data: { id: DON, code: "INV-ONL-2699-0001", type, status: "CONFIRMED", customerName: "PH KTO", customerPhone: "0999000888", totalAmount: 1_500_000, centerId: null } });
  await db.orderItem.create({ data: { orderId: DON, type: type === "ONLINE" ? "ONLINE_COURSE" : "COURSE_ENROLLMENT", itemName: "Khoá thử", unitPrice: 1_500_000, totalPrice: 1_500_000 } });
  // Khoản KHÔNG gắn ghi danh, KHÔNG có cơ sở — đúng hình dạng khoản Online thật.
  await db.payment.create({ data: { id: P, orderId: DON, amount: 1_500_000, method: "BANK_TRANSFER", paidDate: new Date("2699-09-28T03:00:00Z"), saleStatus: DA_GHI_NHAN, accountantStatus: "PENDING", enrollmentId: null, recordedById: `${T}sale`, centerId: null } });
}

describe.skipIf(!RUN_DB_TESTS)("[KTO] xác nhận khoản đơn ONLINE không cần ghi danh — Postgres thật", () => {
  afterAll(don);

  it("[KTO-01] confirmPayment ⇒ đã xác nhận + đúng MỘT phiếu thu enrollmentId=null mã RCP-SR-…; bấm đôi vẫn một; không đẻ ghi danh Offline", async () => {
    await dungFixture("ONLINE");
    const truocGhiDanh = await db.enrollment.count();
    const kq = await confirmPayment({ paymentId: P, confirmedById: KT });
    expect(kq).toMatchObject({ ok: true, alreadyConfirmed: false });
    const p = await db.payment.findUniqueOrThrow({ where: { id: P } });
    expect(p.accountantStatus).toBe(DA_XAC_NHAN);
    const phieu = await db.receipt.findMany({ where: { paymentId: P } });
    expect(phieu).toHaveLength(1);
    expect(phieu[0]).toMatchObject({ enrollmentId: null, paymentId: P, status: "ACTIVE" });
    expect(phieu[0]!.code).toMatch(/^RCP-SR-\d{2}-\d{4}$/);
    expect(await confirmPayment({ paymentId: P, confirmedById: KT })).toMatchObject({ ok: true, alreadyConfirmed: true });
    expect(await db.receipt.count({ where: { paymentId: P } })).toBe(1);
    expect(await db.enrollment.count()).toBe(truocGhiDanh); // KHÔNG tạo ghi danh Offline giả
  });

  it("[KTO-02] hai lượt xác nhận SONG SONG ⇒ vẫn đúng MỘT phiếu thu", async () => {
    await dungFixture("ONLINE");
    const kq = await Promise.all([confirmPayment({ paymentId: P, confirmedById: KT }), confirmPayment({ paymentId: P, confirmedById: KT })]);
    expect(kq.every((x) => x.ok)).toBe(true);
    expect(await db.receipt.count({ where: { paymentId: P } })).toBe(1);
  });

  it("[KTO-03] đối chứng: đơn COURSE cùng hình dạng (không cơ sở, không ghi danh) ⇒ VẪN bị chặn, không phiếu", async () => {
    await dungFixture("COURSE");
    const kq = await confirmPayment({ paymentId: P, confirmedById: KT });
    expect(kq.ok).toBe(false);
    expect(await db.receipt.count({ where: { paymentId: P } })).toBe(0);
    expect((await db.payment.findUniqueOrThrow({ where: { id: P } })).accountantStatus).toBe("PENDING");
  });
});
