// tests/finance/online-tien-ve-don-het-nhan.test.ts — TIỀN VỀ ĐÚNG LÚC / SAU KHI đơn Online hết nhận tiền (huỷ/hoàn). Postgres THẬT.
//
// Chạy: pnpm test:finance-db (CI có chạy bộ này; `tests/mobile-api` thì không). `pnpm test:unit` trần ⇒ SKIP.
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố.
//
// LỖ ĐÃ ĐO (review L5 PR #1284 §2.3): tra đích chạy TRƯỚC khi lượt huỷ commit, phần rót chạy SAU ⇒ mọi phiếu đã VOID ⇒ cả số tiền thành
// `CreditBalance` không chủ (parentUserId/studentId/centerId đều NULL), giao dịch MATCHED (rời hàng «Cần xử lý»; không có phân bổ nên không gỡ/gắn lại được).
//
// LUẬT: đơn ONLINE không còn nhận tiền tự động ⇒ giao dịch ở nguyên hàng chờ `UNMATCHED` kèm ghi chú nêu đơn; KHÔNG phân bổ / tiền dư / `Payment`.
// Đơn KHÔNG phải Online: đường rót dùng chung giữ Y NGUYÊN (ca [TVDH-OFF-*] xanh cả trước lẫn sau bản vá).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { allocateToOrder, ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { transferContentPartsForOrder, VIETQR_ADDINFO_MAX } from "@/lib/payments/vietqr";

if (!RUN_DB_TESTS) console.warn(`[TVDH] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-tvdh-";
const PROVIDER = "SEPAY";
const CENTER = `${T}center`;
const TIEN = 500_000;
const TAI_KHOAN = "0011004123456";
/** SĐT giả của "phụ huynh" — dùng cho ca không được đoán sang đơn khác. */
const SDT_PH = "0905000321";

type LoaiDon = "ONLINE" | "COURSE";
const ONL = { id: `${T}onl`, code: "INV-ONL-TVDH-0001", khoa: "SRINVONLTVDH0001D0" };
const OFF = { id: `${T}off`, code: "INV-CS1-TVDH-0002", khoa: "TVDHOFFKEY002" };
/** Đơn KHÁC đang chờ thu của cùng SĐT. */
const KHAC = { id: `${T}khac`, code: "INV-ONL-TVDH-0003", khoa: "SRINVONLTVDH0003D0" };
const MOI_DON = [ONL.id, OFF.id, KHAC.id];

let soTxn = 0;
const maTxn = () => `${T}ref-${Date.now()}-${++soTxn}`;

async function don() {
  const gd = await db.bankTransaction.findMany({ where: { providerTxnId: { startsWith: T } }, select: { id: true } });
  await db.creditBalance.deleteMany({ where: { OR: [{ orderId: { in: MOI_DON } }, { bankTransactionId: { in: gd.map((g) => g.id) } }] } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: MOI_DON } } } });
  await db.payment.deleteMany({ where: { orderId: { in: MOI_DON } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: MOI_DON } } });
  await db.bankTransaction.deleteMany({ where: { providerTxnId: { startsWith: T } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: MOI_DON } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: MOI_DON } } });
  await db.order.deleteMany({ where: { id: { in: MOI_DON } } });
  await db.center.deleteMany({ where: { id: CENTER } });
}

async function dungDon(d: { id: string; code: string; khoa: string }, loai: LoaiDon, trangThai: "PENDING_PAYMENT" | "CANCELLED" | "REFUNDED", phieu: "PENDING" | "VOID", ten = "Phụ huynh fixture TVDH", tenHang = "Khoá fixture TVDH", sdt = SDT_PH) {
  const centerId = loai === "ONLINE" ? null : CENTER;
  await db.order.create({ data: { id: d.id, code: d.code, type: loai, status: trangThai, customerName: ten, customerPhone: sdt, totalAmount: TIEN, centerId } });
  await db.orderItem.create({ data: { id: `${d.id}-item`, orderId: d.id, type: loai === "ONLINE" ? "ONLINE_COURSE" : "COURSE_ENROLLMENT", itemName: tenHang, quantity: 1, unitPrice: TIEN, totalPrice: TIEN } });
  await db.paymentRequest.create({ data: { id: `${d.id}-phieu`, orderId: d.id, installmentNo: 0, amountDue: TIEN, status: phieu, sortOrder: 0, matchKey: d.khoa, centerId } });
}

async function dungNen() {
  await don();
  await db.center.create({ data: { id: CENTER, name: "TVDH cơ sở", slug: `${T}slug`, address: "không có thật" } });
}

const noiDung = (khoa: string) => `${khoa} HOC PHI`;

/** Tiền về qua ĐÚNG cửa SePay đi. */
const tienVe = (khoa: string, ref: string, them = "") =>
  ingestPayosWebhook({ reference: ref, description: `${noiDung(khoa)}${them}`, amount: TIEN, accountNumber: TAI_KHOAN, transactionDateTime: "2026-11-20 12:00:00" }, PROVIDER);

/**
 * Xen kẽ ĐUA ở mức dữ liệu: bước tra đích (ngoài giao dịch) đã ra phiếu khi đơn còn sống, phần rót chạy sau khi lượt huỷ commit — tức `allocateToOrder` nhận ảnh chụp đơn CŨ
 * (`status: PENDING_PAYMENT`) trong khi DB đã `CANCELLED`/`VOID`. Đua thật (hai kết nối) đã có ở `tests/mobile-api/online-huy-hoan-dua.spec.ts`.
 */
async function rotSauKhiHetNhan(d: { id: string; code: string; khoa: string }, via: "matchKey" | "manual" = "matchKey") {
  const ref = maTxn();
  const txn = await db.bankTransaction.create({
    data: { provider: PROVIDER, providerTxnId: ref, amount: TIEN, transferredAt: new Date("2026-11-20T05:00:00Z"), accountNumber: TAI_KHOAN, referenceCode: ref, content: noiDung(d.khoa), rawPayload: { reference: ref } },
  });
  const o = await db.order.findUniqueOrThrow({ where: { id: d.id }, select: { id: true, code: true, centerId: true, orgUnitId: true, studentId: true, leadId: true } });
  const kq = await allocateToOrder({
    bankTransactionId: txn.id,
    order: { ...o, status: "PENDING_PAYMENT", student: null },
    amount: TIEN,
    provider: PROVIDER,
    providerTxnId: ref,
    target: { paymentRequestId: `${d.id}-phieu`, orderId: d.id, via },
    data: { reference: ref, description: noiDung(d.khoa), amount: TIEN },
  });
  return { kq, ref, txnId: txn.id };
}

async function so(txnId: string, orderId: string) {
  const [gd, phanBo, du, thu] = await Promise.all([
    db.bankTransaction.findUniqueOrThrow({ where: { id: txnId } }),
    db.paymentAllocation.count({ where: { bankTransactionId: txnId } }),
    db.creditBalance.findMany({ where: { OR: [{ bankTransactionId: txnId }, { orderId }] } }),
    db.payment.count({ where: { orderId } }),
  ]);
  return { gd, phanBo, du, thu };
}

describe.skipIf(!RUN_DB_TESTS)("[TVDH] tiền về khi đơn hết nhận tiền", () => {
  beforeEach(dungNen, 60_000);
  afterAll(don, 60_000);

  for (const trangThai of ["CANCELLED", "REFUNDED"] as const) {
    it(`[TVDH-01 ${trangThai}] ĐUA, đơn ONLINE: giữ UNMATCHED nêu đơn; không phân bổ / tiền dư / Payment; giao dịch gốc còn nguyên`, async () => {
      await dungDon(ONL, "ONLINE", trangThai, "VOID");
      const { kq, ref, txnId } = await rotSauKhiHetNhan(ONL);
      expect(kq).toMatchObject({ status: "UNMATCHED", bankTransactionId: txnId });
      const s = await so(txnId, ONL.id);
      expect([s.phanBo, s.du.length, s.thu]).toEqual([0, 0, 0]);
      expect(s.gd).toMatchObject({ status: "UNMATCHED", amount: TIEN, referenceCode: ref, providerTxnId: ref, accountNumber: TAI_KHOAN, content: noiDung(ONL.khoa) });
      expect(s.gd.transferredAt.toISOString()).toBe("2026-11-20T05:00:00.000Z");
      expect(s.gd.unmatchedNote).toContain(ONL.code);
      expect((await db.order.findUniqueOrThrow({ where: { id: ONL.id } })).status).toBe(trangThai);
    }, 30_000);
  }

  it("[TVDH-02] SAU, đơn ONLINE: UNMATCHED nêu đơn; gửi lại hai lần ⇒ vẫn MỘT giao dịch, ghi chú y nguyên", async () => {
    await dungDon(ONL, "ONLINE", "CANCELLED", "VOID");
    const ref = maTxn();
    const lan1 = await tienVe(ONL.khoa, ref);
    expect(lan1.status).toBe("UNMATCHED");
    const dau = await db.bankTransaction.findFirstOrThrow({ where: { providerTxnId: ref } });
    expect(dau.unmatchedNote).toContain(ONL.code);
    for (let i = 0; i < 2; i++) expect(await tienVe(ONL.khoa, ref)).toMatchObject({ status: "UNMATCHED", bankTransactionId: dau.id });
    expect(await db.bankTransaction.count({ where: { providerTxnId: ref } })).toBe(1);
    const s = await so(dau.id, ONL.id);
    expect([s.phanBo, s.du.length, s.thu]).toEqual([0, 0, 0]);
    expect(s.gd).toMatchObject({ status: "UNMATCHED", unmatchedNote: dau.unmatchedNote, amount: TIEN, referenceCode: ref, accountNumber: TAI_KHOAN });
  }, 30_000);

  it("[TVDH-03] ĐUA rồi cổng gửi lại cùng giao dịch ⇒ không rót, không mất dấu: ghi chú y nguyên", async () => {
    await dungDon(ONL, "ONLINE", "CANCELLED", "VOID");
    const { ref, txnId } = await rotSauKhiHetNhan(ONL);
    const ghiChuDua = (await db.bankTransaction.findUniqueOrThrow({ where: { id: txnId } })).unmatchedNote;
    expect(ghiChuDua).toContain(ONL.code);
    for (let i = 0; i < 2; i++) expect(await tienVe(ONL.khoa, ref)).toMatchObject({ status: "UNMATCHED", bankTransactionId: txnId });
    const s = await so(txnId, ONL.id);
    expect([s.phanBo, s.du.length, s.thu]).toEqual([0, 0, 0]);
    expect(s.gd.unmatchedNote).toBe(ghiChuDua);
  }, 30_000);

  it("[TVDH-04] nội dung mang mã đơn ONLINE đã huỷ + SĐT + bằng chứng của đơn KHÁC đang chờ ⇒ KHÔNG đoán sang đơn khác", async () => {
    await dungDon(ONL, "ONLINE", "CANCELLED", "VOID");
    await dungDon(KHAC, "ONLINE", "PENDING_PAYMENT", "PENDING", "Tran Thi Binh", "Lap trinh Scratch", SDT_PH);
    const bangChung = transferContentPartsForOrder({ studentName: null, customerName: "Tran Thi Binh", customerPhone: SDT_PH, courseName: "Lap trinh Scratch" }, VIETQR_ADDINFO_MAX).content;
    const ref = maTxn();
    const kq = await tienVe(ONL.khoa, ref, ` ${SDT_PH} ${bangChung}`);
    expect(kq.status).toBe("UNMATCHED");
    expect(await db.paymentAllocation.count({ where: { paymentRequest: { orderId: KHAC.id } } })).toBe(0);
    expect(await db.payment.count({ where: { orderId: KHAC.id } })).toBe(0);
    expect((await db.bankTransaction.findFirstOrThrow({ where: { providerTxnId: ref } })).unmatchedNote).toContain(ONL.code);
  }, 30_000);

  it("[TVDH-04b] đối chứng: cùng nội dung nhưng KHÔNG mang mã đơn đã huỷ ⇒ đường đoán theo SĐT chạy như cũ", async () => {
    await dungDon(KHAC, "ONLINE", "PENDING_PAYMENT", "PENDING", "Tran Thi Binh", "Lap trinh Scratch", SDT_PH);
    const bangChung = transferContentPartsForOrder({ studentName: null, customerName: "Tran Thi Binh", customerPhone: SDT_PH, courseName: "Lap trinh Scratch" }, VIETQR_ADDINFO_MAX).content;
    const kq = await ingestPayosWebhook({ reference: maTxn(), description: bangChung, amount: TIEN - 100_000, accountNumber: TAI_KHOAN }, PROVIDER);
    expect(kq).toMatchObject({ status: "MATCHED", orderId: KHAC.id });
  }, 30_000);

  it("[TVDH-05] đối soát TAY (via manual) không đổi: kế toán chủ động gắn vào đơn ONLINE còn phiếu mở thì vẫn rót như cũ", async () => {
    await dungDon(ONL, "ONLINE", "CANCELLED", "PENDING");
    const { kq, txnId } = await rotSauKhiHetNhan(ONL, "manual");
    expect(kq).toMatchObject({ status: "MATCHED", allocated: TIEN, credit: 0 });
    expect((await so(txnId, ONL.id)).phanBo).toBe(1);
  }, 30_000);

  it("[TVDH-06] đơn ONLINE còn sống nhận tiền như cũ (đối chứng dương cho cổng dưới khoá)", async () => {
    await dungDon(ONL, "ONLINE", "PENDING_PAYMENT", "PENDING", "Phụ huynh fixture TVDH", "Khoá fixture TVDH", "");
    const kq = await ingestPayosWebhook({ reference: maTxn(), description: noiDung(ONL.khoa), amount: TIEN - 100_000, accountNumber: TAI_KHOAN }, PROVIDER);
    expect(kq).toMatchObject({ status: "MATCHED", allocated: TIEN - 100_000, credit: 0 });
  }, 30_000);

  // ── ĐƯỜNG DÙNG CHUNG VỚI OFFLINE PHẢI Y NGUYÊN — xanh cả trên mã cũ lẫn mã mới ────────────────────
  for (const trangThai of ["CANCELLED", "REFUNDED"] as const) {
    it(`[TVDH-OFF-01 ${trangThai}] ĐUA, đơn OFFLINE: y như cũ — MATCHED, cả số tiền thành CreditBalance đúng hình cũ`, async () => {
      await dungDon(OFF, "COURSE", trangThai, "VOID");
      const { kq, ref, txnId } = await rotSauKhiHetNhan(OFF);
      expect(kq).toEqual({ status: "MATCHED", bankTransactionId: txnId, orderId: OFF.id, paymentRequestId: `${OFF.id}-phieu`, allocated: 0, credit: TIEN, waived: 0, settled: false, orderConfirmed: false });
      const s = await so(txnId, OFF.id);
      expect([s.phanBo, s.thu]).toEqual([0, 0]);
      expect(s.gd).toMatchObject({ status: "MATCHED", centerId: CENTER, unmatchedNote: null });
      expect(s.du).toHaveLength(1);
      expect(s.du[0]).toMatchObject({ parentUserId: null, studentId: null, orderId: OFF.id, bankTransactionId: txnId, centerId: CENTER, amount: TIEN, settledAt: null, note: `Tiền dư từ giao dịch ${PROVIDER} ${ref} (đơn ${OFF.code})` });
    }, 30_000);
  }

  it("[TVDH-OFF-02] SAU, đơn OFFLINE đã huỷ: ghi chú «không tra ra phiếu thu» y nguyên từng chữ", async () => {
    await dungDon(OFF, "COURSE", "CANCELLED", "VOID", "Phụ huynh fixture TVDH", "Khoá fixture TVDH", "");
    const ref = maTxn();
    const kq = await ingestPayosWebhook({ reference: ref, description: noiDung(OFF.khoa), amount: TIEN, accountNumber: TAI_KHOAN }, PROVIDER);
    const ghiChu = `Không tra ra phiếu thu. orderCode=-, VA=-, ref=${ref}, nội dung="${noiDung(OFF.khoa)}"`;
    expect(kq).toMatchObject({ status: "UNMATCHED", reason: ghiChu });
    expect((await db.bankTransaction.findFirstOrThrow({ where: { providerTxnId: ref } })).unmatchedNote).toBe(ghiChu);
    expect(await db.creditBalance.count({ where: { orderId: OFF.id } })).toBe(0);
  }, 30_000);
});
