// tests/finance/wave-c-gan-payment-ghi-danh-db.test.ts — [WCC-DB-*] «PHASE C-C · gắn Payment.enrollmentId cho khoản thu của đơn nhóm C» trên Postgres THẬT: đọc → kế hoạch → cổng Wave 1 → ghi → kiểm sau ghi.
//
// Chạy:  pnpm test:finance-db   (hoặc `vitest run -c vitest.db.config.ts tests/finance/wave-c-gan-payment-ghi-danh-db.test.ts`). `pnpm test:unit` trần SKIP — log «SKIP» nghĩa là CHƯA kiểm gì.
// Khoá EPHEMERAL sinh lúc chạy; môi trường `test`. Fixture tiền tố `WCC_`; KHÔNG `resetDb()`; mọi hàm DB nhận BẢNG = đúng 2 đơn / 3 khoản FIXTURE (không phải id thật).
// Fixture «hình dạng thật» (đo PROD 26/10/2026): 2 đơn nhóm C đã qua C-A (danh tính) VÀ C-B (giá đích PERCENT). Đơn #0: 1 khoản. Đơn #1: 2 khoản sống (9.424.000 + 2.000.000) + 1 khoản PENDING 2.000.000 ĐÃ XOÁ MỀM,
// hai phiếu yêu cầu theo đợt, giao dịch ngân hàng 9.424.000 CHIA MỘT PHẦN cho hai phiếu (2.000.000 + 7.424.000) + giao dịch 2.000.000 — hình dạng khó nhất của đơn thật.
//
// Ánh xạ yêu cầu owner (25/10/2026, WAVE C-C) → ca:
//   chỉ ghi Payment.enrollmentId ⇒ [01]   |   khoản sống + CONFIRMED + enrollmentId NULL, đúng 1 bank MATCHED, đúng số tiền ⇒ [00] [04]   |   khoản xoá mềm bị bỏ qua ⇒ [01]   |   không Receipt ⇒ [01]
//   ghi danh đúng Student/Order/Course ⇒ [04]   |   Payment ngoài bất thường ⇒ [04]   |   một transaction, fail-closed ⇒ [04] [05]   |   chữ ký riêng (workflow C-C) ⇒ [03] [09]   |   chỉ sau C-A + C-B ⇒ [04]
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dungCongGhiThu, type TuyChinhCongGhi } from "@/tests/_helpers/cong-ghi-wave1";
import { CongGhiTuChoi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import {
  ACTOR_WAVE_C_C,
  docKeHoachWaveCC,
  ghiWaveCC,
  ghiWaveCCTrongTx,
  kiemSauGhiWaveCC,
  type DauVaoGhiWaveCC,
} from "@/lib/nguon/wave-c-gan-payment-ghi-danh-db";
import { anhChupBatBienGanPayment } from "@/lib/nguon/gan-payment-ghi-danh-db";
import type { KeHoachGanPayment, MucGanPayment } from "@/lib/nguon/gan-payment-ghi-danh";
import { giaDichWaveCB } from "@/lib/nguon/wave-c-sua-gia-ghi-danh";

if (!RUN_DB_TESTS) console.warn(`[WCC-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const P = "WCC_";
const CS1 = `${P}cs1`;
const KHOA4 = `${P}khoa4`;
const KHOA6 = `${P}khoa6`;
const LOP4 = `${P}lop4`;
const LOP6 = `${P}lop6`;
const MA = [`${P}ORD-0`, `${P}ORD-1`];
const id = (k: string, i: number) => `${P}${k}${i}`;
const NIEM_YET = [11_520_000, 13_440_000];
const PT = [25, 15];
const DICH = NIEM_YET.map((l, i) => giaDichWaveCB(l, PT[i]!));
/** Khoản sống của từng đơn: đơn #0 một khoản; đơn #1 hai khoản (9.424.000 + 2.000.000). */
const SO_TIEN: number[][] = [[DICH[0]!.finalPrice!], [9_424_000, 2_000_000]];
const BANG: Record<string, MucGanPayment> = {
  [MA[0]!]: { giaDich: DICH[0]!.finalPrice!, soKhoan: 1, soKhoanDaXoa: 0, soKhoanTrongHoaDon: 0 },
  [MA[1]!]: { giaDich: DICH[1]!.finalPrice!, soKhoan: 2, soKhoanDaXoa: 1, soKhoanTrongHoaDon: 0 },
};
const TONG_KHOAN = 3;
const MOC = new Date("2026-10-26T03:00:00.000Z");
const NGAY_THU = new Date("2026-09-10T03:00:00.000Z");
const LUOT = { batDauLuc: MOC, nguonChay: { actor: "a", triggeringActor: "b", runId: "9820001", runAttempt: "1" } } as const;
const nonceDaDung: string[] = [];

async function don() {
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: P } }, { id: { in: nonceDaDung.map((n) => `wg:${n}`) } }, { entityId: { startsWith: "luot:9820001" } }] } });
  for (const t of ["boom", "leak"]) {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS wcc_${t}_trg ON "Payment"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS wcc_${t}()`);
  }
  await db.receipt.deleteMany({ where: { id: { startsWith: P } } });
  await db.paymentAllocation.deleteMany({ where: { OR: [{ paymentRequest: { orderId: { startsWith: P } } }, { bankTransactionId: { startsWith: P } }] } });
  await db.bankTransaction.deleteMany({ where: { id: { startsWith: P } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { startsWith: P } } });
  await db.payment.deleteMany({ where: { orderId: { startsWith: P } } });
  await db.orderItem.deleteMany({ where: { orderId: { startsWith: P } } });
  await db.order.deleteMany({ where: { id: { startsWith: P } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: P } } });
  await db.student.deleteMany({ where: { id: { startsWith: P } } });
  await db.leadChild.deleteMany({ where: { id: { startsWith: P } } });
  await db.lead.deleteMany({ where: { id: { startsWith: P } } });
  await db.class.deleteMany({ where: { id: { in: [LOP4, LOP6] } } });
  await db.course.deleteMany({ where: { id: { in: [KHOA4, KHOA6] } } });
  await db.center.deleteMany({ where: { id: CS1 } });
}

async function dung() {
  await don();
  await db.center.create({ data: { id: CS1, name: "Cơ sở WCC 1", slug: `${P}cs-1`, address: "x" } });
  await db.course.create({ data: { id: KHOA4, name: "Sata4 WCC", slug: `${P}sata4`, totalSessions: 48 } });
  await db.course.create({ data: { id: KHOA6, name: "Sata6 WCC", slug: `${P}sata6`, totalSessions: 48 } });
  await db.class.create({ data: { id: LOP4, name: "Lớp 4 WCC", courseId: KHOA4 } });
  await db.class.create({ data: { id: LOP6, name: "Lớp 6 WCC", courseId: KHOA6 } });
  for (let i = 0; i < 2; i++) {
    const phone = `098700000${i}`;
    const dich = DICH[i]!;
    const final = dich.finalPrice!;
    await db.lead.create({ data: { id: id("l", i), parentName: `PH WCC ${i}`, phone, status: "DA_DANG_KY", centerId: CS1 } });
    await db.leadChild.create({ data: { id: id("be", i), leadId: id("l", i), fullName: `Bé WCC ${i}` } });
    await db.student.create({ data: { id: id("s", i), name: `Bé WCC ${i}`, leadId: id("l", i), leadChildId: id("be", i), centerId: CS1, parentPhone: phone } });
    await db.enrollment.create({
      data: {
        id: id("e", i), studentId: id("s", i), classId: i === 0 ? LOP4 : LOP6, courseId: i === 0 ? KHOA4 : KHOA6, status: "ACTIVE", leadChildId: id("be", i), centerId: CS1,
        listPrice: dich.listPrice, discountType: dich.discountType, discountAmount: dich.discountAmount, tuition: dich.tuition, finalPrice: dich.finalPrice,
      },
    });
    await db.order.create({
      data: {
        id: id("o", i), code: MA[i]!, type: "COURSE", status: "COMPLETED", customerName: `PH WCC ${i}`, customerPhone: phone, subtotal: NIEM_YET[i]!, discountAmount: dich.discountAmount!,
        discountPercent: PT[i]!, discountApprovalStatus: "APPROVED", totalAmount: final, leadId: id("l", i), leadChildId: id("be", i), centerId: CS1, studentId: id("s", i),
      },
    });
    await db.orderItem.create({
      data: { id: id("it", i), orderId: id("o", i), type: "COURSE_ENROLLMENT", itemName: "Khoá WCC", quantity: 1, unitPrice: NIEM_YET[i]!, totalPrice: NIEM_YET[i]!, metadata: { courseId: i === 0 ? KHOA4 : KHOA6 }, studentId: id("s", i), enrollmentId: id("e", i) },
    });
  }
  // Đơn #0: một khoản = một phiếu = một giao dịch.
  await db.paymentRequest.create({ data: { id: id("pr", 0), orderId: id("o", 0), centerId: CS1, installmentNo: 0, amountDue: DICH[0]!.finalPrice! } });
  await db.payment.create({
    data: { id: `${P}p0_0`, orderId: id("o", 0), orderItemId: id("it", 0), amount: SO_TIEN[0]![0]!, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1, note: `[auto:sepay:${P}txn0]` },
  });
  await db.bankTransaction.create({ data: { id: id("bt", 0), provider: "SEPAY", providerTxnId: `${P}txn0`, amount: SO_TIEN[0]![0]!, transferredAt: NGAY_THU, status: "MATCHED", centerId: CS1 } });
  await db.paymentAllocation.create({ data: { bankTransactionId: id("bt", 0), paymentRequestId: id("pr", 0), amount: SO_TIEN[0]![0]! } });
  // Đơn #1: hai phiếu theo đợt; giao dịch A (9.424.000) CHIA 2.000.000 + 7.424.000 cho hai phiếu; giao dịch B (2.000.000) vào phiếu 2.
  await db.paymentRequest.create({ data: { id: id("pr", 1), orderId: id("o", 1), centerId: CS1, installmentNo: 1, amountDue: 2_000_000 } });
  await db.paymentRequest.create({ data: { id: `${P}pr1b`, orderId: id("o", 1), centerId: CS1, installmentNo: 2, amountDue: 9_424_000 } });
  await db.bankTransaction.create({ data: { id: `${P}btA`, provider: "SEPAY", providerTxnId: `${P}txnA`, amount: 9_424_000, transferredAt: NGAY_THU, status: "MATCHED", centerId: CS1 } });
  await db.bankTransaction.create({ data: { id: `${P}btB`, provider: "SEPAY", providerTxnId: `${P}txnB`, amount: 2_000_000, transferredAt: NGAY_THU, status: "MATCHED", centerId: CS1 } });
  await db.paymentAllocation.create({ data: { bankTransactionId: `${P}btA`, paymentRequestId: id("pr", 1), amount: 2_000_000 } });
  await db.paymentAllocation.create({ data: { bankTransactionId: `${P}btA`, paymentRequestId: `${P}pr1b`, amount: 7_424_000 } });
  await db.paymentAllocation.create({ data: { bankTransactionId: `${P}btB`, paymentRequestId: `${P}pr1b`, amount: 2_000_000 } });
  await db.payment.create({
    data: { id: `${P}p1_0`, orderId: id("o", 1), orderItemId: id("it", 1), amount: 9_424_000, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1, note: `[auto:sepay:${P}txnA]` },
  });
  await db.payment.create({
    data: { id: `${P}p1_1`, orderId: id("o", 1), orderItemId: id("it", 1), amount: 2_000_000, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1, note: `[auto:sepay:${P}txnB]` },
  });
  // Khoản PENDING 2.000.000 đã xoá mềm của đơn #1 — PHẢI GIỮ xoá, không gắn.
  await db.payment.create({
    data: { id: `${P}pxoa`, orderId: id("o", 1), orderItemId: id("it", 1), amount: 2_000_000, method: "auto", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "PENDING", centerId: CS1, deletedAt: new Date("2026-09-11T00:00:00Z"), note: "Ghi nhận tự động [auto:order-confirm]" },
  });
}

let demNonce = 0;
const CG = (kh: KeHoachGanPayment, o: Partial<TuyChinhCongGhi> = {}): DauVaoCongGhi => {
  const nonce = o.nonce ?? `9c72${String(++demNonce).padStart(28, "0")}`;
  nonceDaDung.push(nonce);
  return dungCongGhiThu(WORKFLOW_WAVE1.waveCGanPayment, kh.dongDauRa, { now: MOC, ...o, nonce }).cong;
};
const nhap = (kh: KeHoachGanPayment, congGhi: DauVaoCongGhi, o: Partial<DauVaoGhiWaveCC> = {}): DauVaoGhiWaveCC => ({
  bang: BANG, soDuyet: kh.ghi.length, ghiDuoc: true, actor: ACTOR_WAVE_C_C, luotChay: LUOT, congGhi, ...o,
});
const kehoach = () => docKeHoachWaveCC(db, BANG);
const tatCaPayment = () => db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } });
const khongGhiGi = async () => expect(await db.payment.count({ where: { orderId: { startsWith: P }, enrollmentId: { not: null } } }), "không khoản nào được gắn").toBe(0);
const soClaim = () => db.auditLog.count({ where: { id: { in: nonceDaDung.map((n) => `wg:${n}`) } } });
const soAudit = (action: string) => db.auditLog.count({ where: { action, OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9820001" } }] } });
const thuLoi = (p: Promise<unknown>) => p.then(() => null, (x: unknown) => x);

describe.skipIf(!RUN_DB_TESTS)("[WCC-DB] gắn khoản thu của đơn nhóm C vào ghi danh — Postgres thật", () => {
  beforeEach(async () => {
    await dung();
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[WCC-DB-00] fixture đúng hình dạng: 3 khoản chưa gắn, kế hoạch SẴN SÀNG GHI 3, không lỗi, nợ dự kiến 0, khoản xoá mềm KHÔNG nằm trong kế hoạch, mã giao dịch do DB đọc ra (đối chứng dương)", async () => {
    await khongGhiGi();
    const kh = await kehoach();
    expect(kh.loi).toEqual([]);
    expect(kh.ghi).toHaveLength(TONG_KHOAN);
    expect(kh.muc.every((m) => m.noDuKien === 0 && m.trangThai === "CHUA_GAN")).toBe(true);
    expect(kh.ghi.map((g) => g.paymentId)).not.toContain(`${P}pxoa`);
    const theoKhoan = Object.fromEntries(kh.ghi.map((g) => [g.paymentId, g.providerTxnId]));
    expect(theoKhoan).toEqual({ [`${P}p0_0`]: `${P}txn0`, [`${P}p1_0`]: `${P}txnA`, [`${P}p1_1`]: `${P}txnB` });
  });

  it("[WCC-DB-01] GHI: đúng 3 khoản đổi ĐÚNG MỘT cột `enrollmentId`; amount/status/ngày/ghi chú KHÔNG đổi; khoản xoá mềm vẫn NULL; Order/Enrollment/bank y nguyên; KHÔNG Receipt; audit + lượt + claim", async () => {
    const payTruoc = await tatCaPayment();
    const orderTruoc = await db.order.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } });
    const enrTruoc = await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const btTruoc = await db.bankTransaction.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const anhTruoc = await anhChupBatBienGanPayment(db, BANG);
    const kh = await kehoach();
    const r = await ghiWaveCC(db, nhap(kh, CG(kh)));
    expect(r).toMatchObject({ daGhi: TONG_KHOAN, daGanHet: true, keHoachSha: kh.sha });

    const payNay = await tatCaPayment();
    expect(payNay).toHaveLength(payTruoc.length);
    const bo = <T extends Record<string, unknown>>(x: T) => Object.fromEntries(Object.entries(x).filter(([k]) => !["enrollmentId", "updatedAt"].includes(k)));
    expect(payNay.map(bo)).toEqual(payTruoc.map(bo));
    const dich = (p: { orderId: string | null }) => (p.orderId === id("o", 0) ? id("e", 0) : id("e", 1));
    for (const p of payNay) expect(p.enrollmentId, p.id).toBe(p.deletedAt === null ? dich(p) : null);
    expect(payNay.find((p) => p.id === `${P}pxoa`)!.enrollmentId).toBeNull();
    expect(await db.order.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } })).toEqual(orderTruoc);
    expect(await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(enrTruoc);
    expect(await db.bankTransaction.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(btTruoc);
    expect(await anhChupBatBienGanPayment(db, BANG)).toBe(anhTruoc);
    expect(await db.receipt.count({ where: { paymentId: { startsWith: P } } })).toBe(0);

    expect(await soAudit("UPDATE")).toBe(TONG_KHOAN);
    expect(await soAudit("WAVE_C_GAN_PAYMENT_LUOT_CHAY")).toBe(1);
    expect(await soClaim()).toBe(1);
    const a = await db.auditLog.findFirstOrThrow({ where: { action: "UPDATE", entityId: `${P}p1_0` } });
    expect(a.oldValues).toEqual({ enrollmentId: null });
    expect(a.newValues).toMatchObject({ enrollmentId: id("e", 1), maDon: MA[1], maGiaoDich: `${P}txnA`, source: "wave-c-gan-payment-ghi-danh" });
    const luot = await db.auditLog.findFirstOrThrow({ where: { action: "WAVE_C_GAN_PAYMENT_LUOT_CHAY" } });
    expect(luot.newValues).toMatchObject({ expectedCount: TONG_KHOAN, actualCount: TONG_KHOAN, khop: true, keHoachSha: kh.sha });
  });

  it("[WCC-DB-02] IDEMPOTENT: chạy lại sau khi ghi ⇒ 0 dòng ghi, KHÔNG qua cổng, KHÔNG claim, KHÔNG audit thêm — kể cả khi không có artifact", async () => {
    const kh = await kehoach();
    await ghiWaveCC(db, nhap(kh, CG(kh)));
    const truocAudit = await db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9820001" } }] } });
    const claim = await soClaim();
    const ky2 = await kehoach();
    expect(ky2.daGanHet).toBe(true);
    expect(ky2.ghi).toEqual([]);
    const congRong: DauVaoCongGhi = { artifact: null, publicKeyPem: "", keyIdTinCay: "", moiTruong: "", ownerIdentities: null, now: MOC, runRef: "x" };
    const r = await ghiWaveCC(db, nhap(ky2, congRong, { soDuyet: 0 }));
    expect(r).toMatchObject({ daGhi: 0, daGanHet: true });
    expect(await db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9820001" } }] } })).toBe(truocAudit);
    expect(await soClaim()).toBe(claim);
  });

  it("[WCC-DB-03] CỔNG KÝ: thiếu artifact / ký cho workflow KHÁC (PHASE B.2 · C-A · C-B) / dòng khác / sai môi trường / khoá không ghim ⇒ từ chối TRƯỚC phép ghi đầu tiên, không ghi gì, 0 claim", async () => {
    const kh = await kehoach();
    const cong0 = CG(kh);
    const CASES: Array<[string, DauVaoCongGhi, string]> = [
      ["thiếu artifact", { ...cong0, artifact: null }, "THIEU_ARTIFACT"],
      ["workflow PHASE B.2", CG(kh, { workflowKy: WORKFLOW_WAVE1.ganPaymentGhiDanh }), "SAI_WORKFLOW"],
      ["workflow C-A", CG(kh, { workflowKy: WORKFLOW_WAVE1.waveCGanDanhTinh }), "SAI_WORKFLOW"],
      ["workflow C-B", CG(kh, { workflowKy: WORKFLOW_WAVE1.waveCSuaGia }), "SAI_WORKFLOW"],
      ["dòng khác (plan SHA lệch)", CG(kh, { rowsKy: kh.dongDauRa.slice(0, TONG_KHOAN - 1) }), "LECH_DIGEST"],
      ["môi trường", CG(kh, { moiTruongKy: "prod" }), "SAI_MOI_TRUONG"],
      ["chưa ghim khoá", { ...cong0, keyIdTinCay: "" }, "KHOA_KHONG_KHOP"],
    ];
    for (const [ten, cong, ma] of CASES) {
      const e = await thuLoi(ghiWaveCC(db, nhap(kh, cong)));
      expect(e, ten).toBeInstanceOf(CongGhiTuChoi);
      expect((e as CongGhiTuChoi).ma, ten).toBe(ma);
      await khongGhiGi();
    }
    expect(await soClaim()).toBe(0);
    expect(await soAudit("UPDATE")).toBe(0);
  });

  it.each([
    ["C-B CHƯA XONG (ghi danh còn giá niêm yết legacy)", async () => { await db.enrollment.update({ where: { id: id("e", 0) }, data: { discountType: null, discountAmount: 0, tuition: NIEM_YET[0]!, finalPrice: NIEM_YET[0]! } }); }, "GIA_GHI_DANH_CHUA_CHUAN"],
    ["C-A CHƯA XONG (dòng đơn chưa gắn ghi danh)", async () => { await db.orderItem.update({ where: { id: id("it", 1) }, data: { studentId: null, enrollmentId: null } }); }, "DON_CHUA_GAN_DANH_TINH"],
    ["khoản CHƯA XÁC NHẬN (PENDING)", async () => { await db.payment.update({ where: { id: `${P}p1_1` }, data: { accountantStatus: "PENDING" } }); }, "PAYMENT_KHONG_XAC_NHAN"],
    ["khoản gắn SAI ghi danh (của đơn kia)", async () => { await db.payment.update({ where: { id: `${P}p0_0` }, data: { enrollmentId: id("e", 1) } }); }, "PAYMENT_GAN_SAI_GHI_DANH"],
    ["lô LAI (một khoản đã gắn đúng, khoản kia chưa)", async () => { await db.payment.update({ where: { id: `${P}p1_0` }, data: { enrollmentId: id("e", 1) } }); }, "LO_HON_HOP"],
    ["Payment SỐNG NGOÀI đơn đang gắn ghi danh đích (bất thường)", async () => { await db.payment.create({ data: { id: `${P}pngoai`, orderId: id("o", 0), orderItemId: id("it", 0), amount: 1, method: "cash", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1, enrollmentId: id("e", 1) } }); }, "GHI_DANH_CO_PAYMENT_NGOAI"],
    ["thêm một khoản SỐNG thứ ba cho đơn #0 (tập khoản lệch audit)", async () => { await db.payment.create({ data: { id: `${P}pthem`, orderId: id("o", 0), orderItemId: id("it", 0), amount: 1, method: "cash", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1 } }); }, "TAP_PAYMENT_LECH"],
    ["khoản xoá mềm bị KHÔI PHỤC (thành khoản sống)", async () => { await db.payment.update({ where: { id: `${P}pxoa` }, data: { deletedAt: null } }); }, "TAP_PAYMENT_LECH"],
    ["giao dịch ngân hàng không còn MATCHED", async () => { await db.bankTransaction.update({ where: { id: id("bt", 0) }, data: { status: "UNMATCHED" } }); }, "GIAO_DICH_KHONG_MATCHED"],
    ["HAI giao dịch MATCHED cùng số tiền cho một khoản (mơ hồ)", async () => {
      await db.bankTransaction.create({ data: { id: `${P}btDup`, provider: "SEPAY", providerTxnId: `${P}txnDup`, amount: SO_TIEN[0]![0]!, transferredAt: NGAY_THU, status: "MATCHED", centerId: CS1 } });
      await db.paymentAllocation.create({ data: { bankTransactionId: `${P}btDup`, paymentRequestId: id("pr", 0), amount: 1 } });
    }, "GIAO_DICH_NHIEU_UNG_VIEN"],
    ["ghi chú khai mã giao dịch KHÁC với ứng viên duy nhất", async () => { await db.payment.update({ where: { id: `${P}p0_0` }, data: { note: "[auto:sepay:MA-KHAC]" } }); }, "GIAO_DICH_GHI_CHU_LECH"],
    ["đã có Receipt (tác dụng phụ — C-C không đụng Receipt)", async () => { await db.receipt.create({ data: { id: id("rc", 0), code: `${P}RCP-0`, paymentId: `${P}p0_0` } }); }, "CO_TAC_DUNG_PHU"],
    ["ghi danh khác học viên so với đơn", async () => { await db.enrollment.update({ where: { id: id("e", 0) }, data: { studentId: id("s", 1) } }); }, "GHI_DANH_LECH_HOC_VIEN"],
    ["tổng đơn trôi", async () => { await db.order.update({ where: { id: id("o", 1) }, data: { totalAmount: DICH[1]!.finalPrice! + 1 } }); }, "TONG_DON_LECH"],
  ])("[WCC-DB-04] FAIL-CLOSED: %s ⇒ KHÔNG khoản nào của lô được gắn, không claim", async (_ten, lamHong, ma) => {
    const kh0 = await kehoach();
    const cong = CG(kh0);
    await lamHong();
    const truoc = await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } });
    const kh = await kehoach();
    expect(kh.dung).toBe(true);
    expect(kh.loi.map((x) => x.ma)).toContain(ma);
    expect(kh.ghi).toEqual([]);
    const e = await thuLoi(ghiWaveCC(db, nhap(kh0, cong)));
    expect(String(e)).toMatch(/DỪNG/);
    expect(String(e)).toContain(ma);
    expect(await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(truoc);
    expect(await soClaim()).toBe(0);
    expect(await soAudit("UPDATE")).toBe(0);
  });

  it("[WCC-DB-05] TRANSACTION TOÀN LÔ: lỗi ở khoản cuối (trigger ném khi UPDATE khoản #p1_1) ⇒ hai khoản đã ghi trước đó cũng LÙI; claim lùi theo", async () => {
    await db.$executeRawUnsafe(`CREATE FUNCTION wcc_boom() RETURNS trigger AS $f$ BEGIN RAISE EXCEPTION 'WCC_BOOM'; END $f$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER wcc_boom_trg BEFORE UPDATE ON "Payment" FOR EACH ROW WHEN (NEW.id = '${P}p1_1') EXECUTE FUNCTION wcc_boom()`);
    const kh = await kehoach();
    const e = await thuLoi(ghiWaveCC(db, nhap(kh, CG(kh))));
    expect(String(e)).toMatch(/WCC_BOOM/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
    expect(await soAudit("UPDATE")).toBe(0);
    expect(await soAudit("WAVE_C_GAN_PAYMENT_LUOT_CHAY")).toBe(0);
  });

  it("[WCC-DB-06] TRÔI giữa kế hoạch và ghi (khoản #p1_0 vừa bị gắn ghi danh sau khi đã ký) ⇒ cổng TRONG tx bắt, cả lô lùi, không claim", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await db.payment.update({ where: { id: `${P}p1_0` }, data: { enrollmentId: id("e", 1) } });
    const e = await thuLoi(db.$transaction((tx) => ghiWaveCCTrongTx(tx, nhap(kh, cong))));
    expect(String(e)).toMatch(/LO_HON_HOP|DỪNG/);
    await db.payment.update({ where: { id: `${P}p1_0` }, data: { enrollmentId: null } });
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[WCC-DB-07] SAI --expect / thiếu --expect / thiếu quyền ghi ⇒ từ chối TRƯỚC khi mở transaction ghi", async () => {
    const kh = await kehoach();
    await expect(ghiWaveCC(db, nhap(kh, CG(kh), { soDuyet: TONG_KHOAN - 1 }))).rejects.toThrow(/≠ kế hoạch/);
    await expect(ghiWaveCC(db, nhap(kh, CG(kh), { soDuyet: null }))).rejects.toThrow(/đòi --expect/);
    await expect(ghiWaveCC(db, nhap(kh, CG(kh), { ghiDuoc: false }))).rejects.toThrow(/không có quyền UPDATE/);
    await expect(ghiWaveCC(db, nhap(kh, CG(kh), { ghiDuoc: null }))).rejects.toThrow(/Không kiểm được/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[WCC-DB-08] BẤT BIẾN: nếu phép ghi VÔ TÌNH kéo theo đổi số tiền khoản (trigger giả lập tác dụng phụ) ⇒ ảnh chụp sau ≠ trước ⇒ throw, cả lô lùi", async () => {
    await db.$executeRawUnsafe(
      `CREATE FUNCTION wcc_leak() RETURNS trigger AS $f$ BEGIN IF NEW."enrollmentId" IS NOT NULL AND OLD."enrollmentId" IS NULL THEN NEW.note := COALESCE(NEW.note, '') || ' sửa'; END IF; RETURN NEW; END $f$ LANGUAGE plpgsql`,
    );
    await db.$executeRawUnsafe(`CREATE TRIGGER wcc_leak_trg BEFORE UPDATE ON "Payment" FOR EACH ROW EXECUTE FUNCTION wcc_leak()`);
    const kh = await kehoach();
    const e = await thuLoi(ghiWaveCC(db, nhap(kh, CG(kh))));
    expect(String(e)).toMatch(/Ảnh chụp bất biến/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[WCC-DB-09] REPLAY nonce: dùng lại ĐÚNG artifact đã dùng (đưa khoản về chưa gắn) ⇒ DA_DUNG, không gắn lần hai", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await ghiWaveCC(db, nhap(kh, cong));
    await db.payment.updateMany({ where: { orderId: { startsWith: P } }, data: { enrollmentId: null } });
    const kh2 = await kehoach();
    expect(kh2.dongDauRa).toEqual(kh.dongDauRa);
    const e = await thuLoi(ghiWaveCC(db, nhap(kh2, cong)));
    expect(e).toBeInstanceOf(CongGhiTuChoi);
    expect((e as CongGhiTuChoi).ma).toBe("DA_DUNG");
    await khongGhiGi();
  });

  it("[WCC-DB-10] KIỂM SAU GHI: trước ghi ⇒ chưa đạt; sau ghi ⇒ 3/3 khoản sống đã gắn, khoản xoá mềm vẫn chưa gắn", async () => {
    const truoc = await kiemSauGhiWaveCC(db, BANG);
    expect(truoc.keHoach.daGanHet).toBe(false);
    expect(truoc.paymentDaGan).toBe(0);
    const kh = await kehoach();
    await ghiWaveCC(db, nhap(kh, CG(kh)));
    const sau = await kiemSauGhiWaveCC(db, BANG);
    expect(sau.keHoach.dung).toBe(false);
    expect(sau.keHoach.daGanHet).toBe(true);
    expect(sau.paymentDaGan).toBe(sau.tongKhoanBang);
    expect(sau.tongKhoanBang).toBe(TONG_KHOAN);
    expect(sau.xoaMemDaGan).toBe(0);
  });
});
