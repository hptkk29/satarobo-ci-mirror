// tests/finance/wave-c-sua-gia-ghi-danh-db.test.ts — [WCB-DB-*] «PHASE C-B · chuẩn hoá giá ghi danh đơn khoá học legacy» trên Postgres THẬT: đọc → kế hoạch → cổng Wave 1 → ghi → kiểm sau ghi.
//
// Chạy:  pnpm test:finance-db   (hoặc `vitest run -c vitest.db.config.ts tests/finance/wave-c-sua-gia-ghi-danh-db.test.ts`). `pnpm test:unit` trần SKIP — log «SKIP» nghĩa là CHƯA kiểm gì.
// Khoá EPHEMERAL sinh lúc chạy; môi trường `test`. Fixture tiền tố `WCB_`; KHÔNG `resetDb()`; mọi hàm DB nhận BẢNG = đúng 4 đơn FIXTURE (không phải 16 mã thật).
// Fixture «hình dạng thật» (đo PROD 26/10/2026): 4 đơn đã qua C-A (đơn + dòng đơn + ghi danh), đóng ĐỦ giá giảm, ghi danh còn giá niêm yết:
//   #0 nguồn ORDER (15% APPROVED), khoản đã gắn ghi danh · #1 nguồn ITEM (bản ghi PHAN_TRAM, Order không duyệt), khoản đã gắn · #2 nhóm C (25%, Sata4), khoản CHƯA gắn ·
//   #3 ngoại lệ ghiListPrice: ghi danh STUDYING mang CẢ NĂM cột giá NULL; Course.price = giá, Course.updatedAt TRƯỚC đơn. #0 có một dòng hoa hồng cũ (phải đứng yên).
//
// Ánh xạ yêu cầu owner (25/10/2026, WAVE C-B) → ca:
//   snapshot hiện tại = audit, drift ⇒ dừng ⇒ [04] [06]   |   bằng chứng giảm giá HIGH ⇒ [04]   |   Order tổng = giá đích, Payment CONFIRMED = final, bank MATCHED ⇒ [04]   |   không học bổng ⇒ [04]
//   listPrice chỉ đọc, ngoại lệ có guard riêng ⇒ [01] [04]   |   hoa hồng cũ KHÔNG đổi ⇒ [01] [08]   |   idempotent ⇒ [02]   |   cổng ký / replay ⇒ [03] [09]   |   rollback ⇒ [05]   |   FAKE_DEBT ⇒ [01] [10]
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dungCongGhiThu, type TuyChinhCongGhi } from "@/tests/_helpers/cong-ghi-wave1";
import { CongGhiTuChoi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import {
  ACTOR_WAVE_C_B,
  anhChupBatBienWaveCB,
  docKeHoachWaveCB,
  ghiWaveCB,
  ghiWaveCBTrongTx,
  kiemSauGhiWaveCB,
  type DauVaoGhiWaveCB,
} from "@/lib/nguon/wave-c-sua-gia-ghi-danh-db";
import { giaDichWaveCB, type KeHoachWaveCB, type MucWaveCB } from "@/lib/nguon/wave-c-sua-gia-ghi-danh";

if (!RUN_DB_TESTS) console.warn(`[WCB-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const P = "WCB_";
const CS1 = `${P}cs1`;
const KHOA3 = `${P}khoa3`;
const KHOA4 = `${P}khoa4`;
const LOP3 = `${P}lop3`;
const LOP4 = `${P}lop4`;
const N = 4;
const DAC_BIET = 3;
const NHOM_C = 2;
const MA = Array.from({ length: N }, (_, i) => `${P}ORD-${i}`);
const id = (k: string, i: number) => `${P}${k}${i}`;
const NIEM_YET = [10_560_000, 10_560_000, 11_520_000, 10_560_000];
const PT = [15, 15, 25, 15];
const DICH = NIEM_YET.map((l, i) => giaDichWaveCB(l, PT[i]!));
const LEGACY = (l: number) => ({ listPrice: l, discountType: null, discountAmount: 0, tuition: l, finalPrice: l });
const TRONG = { listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null };
const BANG: Record<string, MucWaveCB> = Object.fromEntries(
  MA.map((m, i) => [m, { listPrice: NIEM_YET[i]!, phanTram: PT[i]!, nguon: i === 0 || i === NHOM_C ? "ORDER" : "ITEM", tongDon: DICH[i]!.finalPrice!, truoc: i === DAC_BIET ? TRONG : LEGACY(NIEM_YET[i]!), ...(i === DAC_BIET ? { ghiListPrice: true as const } : {}) } satisfies MucWaveCB]),
);
const MOC = new Date("2026-10-26T03:00:00.000Z");
const NGAY_THU = new Date("2026-09-20T03:00:00.000Z");
const NGAY_DON = new Date("2026-10-10T03:00:00.000Z");
const NGAY_GIA = new Date("2026-08-04T03:00:00.000Z");
const LUOT = { batDauLuc: MOC, nguonChay: { actor: "a", triggeringActor: "b", runId: "9810001", runAttempt: "1" } } as const;
const nonceDaDung: string[] = [];

async function don() {
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: P } }, { id: { in: nonceDaDung.map((n) => `wg:${n}`) } }, { entityId: { startsWith: "luot:9810001" } }] } });
  for (const t of ["boom", "leak"]) {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS wcb_${t}_trg ON "Enrollment"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS wcb_${t}()`);
  }
  await db.commissionLine.deleteMany({ where: { id: { startsWith: P } } });
  await db.commissionStatement.deleteMany({ where: { id: { startsWith: P } } });
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
  await db.class.deleteMany({ where: { id: { in: [LOP3, LOP4] } } });
  await db.course.deleteMany({ where: { id: { in: [KHOA3, KHOA4] } } });
  await db.center.deleteMany({ where: { id: CS1 } });
}

async function dung() {
  await don();
  await db.center.create({ data: { id: CS1, name: "Cơ sở WCB 1", slug: `${P}cs-1`, address: "x" } });
  await db.course.create({ data: { id: KHOA3, name: "Sata3 WCB", slug: `${P}sata3`, totalSessions: 48, price: 10_560_000, updatedAt: NGAY_GIA } });
  await db.course.create({ data: { id: KHOA4, name: "Sata4 WCB", slug: `${P}sata4`, totalSessions: 48, price: 11_520_000, updatedAt: NGAY_GIA } });
  await db.class.create({ data: { id: LOP3, name: "Lớp 3 WCB", courseId: KHOA3 } });
  await db.class.create({ data: { id: LOP4, name: "Lớp 4 WCB", courseId: KHOA4 } });
  for (let i = 0; i < N; i++) {
    const phone = `098600000${i}`;
    const khoa = i === NHOM_C ? KHOA4 : KHOA3;
    const dich = DICH[i]!;
    const final = dich.finalPrice!;
    const gia = i === DAC_BIET ? TRONG : LEGACY(NIEM_YET[i]!);
    await db.lead.create({ data: { id: id("l", i), parentName: `PH WCB ${i}`, phone, status: "DA_DANG_KY", centerId: CS1 } });
    await db.leadChild.create({ data: { id: id("be", i), leadId: id("l", i), fullName: `Bé WCB ${i}` } });
    await db.student.create({ data: { id: id("s", i), name: `Bé WCB ${i}`, leadId: id("l", i), leadChildId: id("be", i), centerId: CS1, parentPhone: phone } });
    await db.enrollment.create({
      data: {
        id: id("e", i), studentId: id("s", i), classId: i === NHOM_C ? LOP4 : LOP3, courseId: khoa, status: i === DAC_BIET ? "STUDYING" : "ACTIVE", leadChildId: id("be", i), centerId: CS1,
        listPrice: gia.listPrice, discountType: gia.discountType, discountAmount: gia.discountAmount, tuition: gia.tuition, finalPrice: gia.finalPrice, notes: `ghi chú ${i}`,
      },
    });
    const ordKieu = i === 0 || i === NHOM_C;
    await db.order.create({
      data: {
        id: id("o", i), code: MA[i]!, type: "COURSE", status: "COMPLETED", customerName: `PH WCB ${i}`, customerPhone: phone, subtotal: NIEM_YET[i]!, discountAmount: dich.discountAmount!,
        discountPercent: ordKieu ? PT[i]! : null, discountApprovalStatus: ordKieu ? "APPROVED" : null, totalAmount: final, leadId: id("l", i), leadChildId: id("be", i), centerId: CS1,
        studentId: id("s", i), createdAt: NGAY_DON,
      },
    });
    await db.orderItem.create({
      data: {
        id: id("it", i), orderId: id("o", i), type: "COURSE_ENROLLMENT", itemName: "Khoá WCB", quantity: 1, unitPrice: NIEM_YET[i]!, totalPrice: NIEM_YET[i]!, metadata: { courseId: khoa, leadChildId: id("be", i) },
        studentId: id("s", i), enrollmentId: id("e", i),
        ...(ordKieu ? {} : { discountAmount: dich.discountAmount!, discountPercent: PT[i]!, discounts: [{ kieu: "PHAN_TRAM", phanTram: PT[i]!, giam: dich.discountAmount!, vuotTran: false, lyDo: "CS đóng full" }] }),
      },
    });
    await db.paymentRequest.create({ data: { id: id("pr", i), orderId: id("o", i), centerId: CS1, installmentNo: 0, amountDue: final } });
    await db.payment.create({
      data: {
        id: id("p", i), orderId: id("o", i), orderItemId: id("it", i), amount: final, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1,
        enrollmentId: i === NHOM_C ? null : id("e", i),
      },
    });
    await db.bankTransaction.create({ data: { id: id("bt", i), provider: "SEPAY", providerTxnId: `${P}txn${i}`, amount: final, transferredAt: NGAY_THU, status: "MATCHED", centerId: CS1 } });
    await db.paymentAllocation.create({ data: { bankTransactionId: id("bt", i), paymentRequestId: id("pr", i), amount: final } });
  }
  // Một dòng hoa hồng cũ của lead #0 — PHẢI đứng yên.
  await db.commissionStatement.create({ data: { id: id("st", 0), period: `${P}2026-10` } });
  await db.commissionLine.create({ data: { id: id("cl", 0), statementId: id("st", 0), recipientId: `${P}nguoi`, tier: "SALE", amount: 123_456, leadId: id("l", 0) } });
}

let demNonce = 0;
const CG = (kh: KeHoachWaveCB, o: Partial<TuyChinhCongGhi> = {}): DauVaoCongGhi => {
  const nonce = o.nonce ?? `9c71${String(++demNonce).padStart(28, "0")}`;
  nonceDaDung.push(nonce);
  return dungCongGhiThu(WORKFLOW_WAVE1.waveCSuaGia, kh.dongDauRa, { now: MOC, ...o, nonce }).cong;
};
const nhap = (kh: KeHoachWaveCB, congGhi: DauVaoCongGhi, o: Partial<DauVaoGhiWaveCB> = {}): DauVaoGhiWaveCB => ({
  bang: BANG, soDuyet: kh.ghi.length, ghiDuoc: true, actor: ACTOR_WAVE_C_B, luotChay: LUOT, congGhi, ...o,
});
const kehoach = () => docKeHoachWaveCB(db, BANG);
const giaHienTai = async (i: number) => {
  const e = await db.enrollment.findUniqueOrThrow({ where: { id: id("e", i) }, select: { listPrice: true, discountType: true, discountAmount: true, tuition: true, finalPrice: true } });
  return e;
};
const khongGhiGi = async () => {
  for (let i = 0; i < N; i++) expect(await giaHienTai(i), `ghi danh ${i}`).toEqual(i === DAC_BIET ? TRONG : LEGACY(NIEM_YET[i]!));
};
const soClaim = () => db.auditLog.count({ where: { id: { in: nonceDaDung.map((n) => `wg:${n}`) } } });
const soAudit = (action: string) => db.auditLog.count({ where: { action, OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9810001" } }] } });
const thuLoi = (p: Promise<unknown>) => p.then(() => null, (x: unknown) => x);

describe.skipIf(!RUN_DB_TESTS)("[WCB-DB] chuẩn hoá giá ghi danh đơn khoá học legacy — Postgres thật", () => {
  beforeEach(async () => {
    await dung();
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[WCB-DB-00] fixture đúng hình dạng: kế hoạch SẴN SÀNG GHI 4, không lỗi; FAKE_DEBT trước = 2 × 1.584.000 (đã gắn) + cả học phí đơn nhóm C; nợ dự kiến nếu gắn đủ = 0 (đối chứng dương)", async () => {
    await khongGhiGi();
    const kh = await kehoach();
    expect(kh.loi).toEqual([]);
    expect(kh.ghi).toHaveLength(N);
    expect(kh.ghi.find((g) => g.ghiListPrice)?.code).toBe(MA[DAC_BIET]);
    expect(kh.muc.every((m) => m.noDuKien === 0)).toBe(true);
    expect(kh.noGiaTruoc).toBe(1_584_000 * 2 + NIEM_YET[NHOM_C]! + 0);
    expect(kh.noGiaSau).toBe(DICH[NHOM_C]!.finalPrice!);
  });

  it("[WCB-DB-01] GHI: ĐÚNG 4 cột Enrollment/ghi danh (5 cột cho ngoại lệ listPrice); listPrice của 3 đơn còn lại KHÔNG đổi; Order, dòng đơn, Payment, bank, hoa hồng cũ y nguyên; audit từng ghi danh + lượt + claim", async () => {
    const orderTruoc = await db.order.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } });
    const payTruoc = await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } });
    const btTruoc = await db.bankTransaction.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const hhTruoc = await db.commissionLine.findMany({ where: { id: { startsWith: P } } });
    const enrTruoc = await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const kh = await kehoach();
    const r = await ghiWaveCB(db, nhap(kh, CG(kh)));
    expect(r).toMatchObject({ daGhi: N, daSuaHet: true, keHoachSha: kh.sha });

    for (let i = 0; i < N; i++) expect(await giaHienTai(i), `ghi danh ${i}`).toEqual(DICH[i]);
    // Cột KHÔNG phải giá của ghi danh y nguyên (notes, status, studentId, classId, …).
    const enrNay = await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const bo = (r2: Record<string, unknown>) => Object.fromEntries(Object.entries(r2).filter(([k]) => !["discountType", "discountAmount", "finalPrice", "tuition", "updatedAt", "listPrice"].includes(k)));
    expect(enrNay.map(bo)).toEqual(enrTruoc.map(bo));
    // listPrice: chỉ ghi danh ngoại lệ đổi (NULL → giá); ba ghi danh kia KHÔNG đổi.
    expect(enrNay.map((e) => e.listPrice)).toEqual(enrTruoc.map((e, i) => (i === DAC_BIET ? NIEM_YET[i] : e.listPrice)));
    expect(await db.order.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } })).toEqual(orderTruoc);
    expect(await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(payTruoc);
    expect(await db.bankTransaction.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(btTruoc);
    expect(await db.commissionLine.findMany({ where: { id: { startsWith: P } } })).toEqual(hhTruoc);
    expect(await db.commissionTransaction.count({ where: { orderId: { startsWith: P } } })).toBe(0);
    expect(await db.receipt.count({ where: { paymentId: { startsWith: P } } })).toBe(0);

    expect(await soAudit("CHUAN_HOA_GIA_GHI_DANH_WAVE_C")).toBe(N);
    expect(await soAudit("CHUAN_HOA_GIA_GHI_DANH_WAVE_C_LUOT_CHAY")).toBe(1);
    expect(await soClaim()).toBe(1);
    const a = await db.auditLog.findFirstOrThrow({ where: { action: "CHUAN_HOA_GIA_GHI_DANH_WAVE_C", entityId: id("e", DAC_BIET) } });
    expect(a.oldValues).toEqual(TRONG);
    expect(a.changedFields).toEqual(["listPrice", "discountType", "discountAmount", "finalPrice", "tuition"]);
    const b = await db.auditLog.findFirstOrThrow({ where: { action: "CHUAN_HOA_GIA_GHI_DANH_WAVE_C", entityId: id("e", 0) } });
    expect(b.changedFields).toEqual(["discountType", "discountAmount", "finalPrice", "tuition"]);
    const luot = await db.auditLog.findFirstOrThrow({ where: { action: "CHUAN_HOA_GIA_GHI_DANH_WAVE_C_LUOT_CHAY" } });
    expect(luot.newValues).toMatchObject({ expectedCount: N, actualCount: N, khop: true, keHoachSha: kh.sha, soGhiListPrice: 1 });
  });

  it("[WCB-DB-02] IDEMPOTENT: chạy lại sau khi ghi ⇒ 0 dòng ghi, KHÔNG qua cổng, KHÔNG claim, KHÔNG audit thêm — kể cả khi không có artifact", async () => {
    const kh = await kehoach();
    await ghiWaveCB(db, nhap(kh, CG(kh)));
    const truocAudit = await db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9810001" } }] } });
    const claim = await soClaim();
    const ky2 = await kehoach();
    expect(ky2.daSuaHet).toBe(true);
    expect(ky2.ghi).toEqual([]);
    const congRong: DauVaoCongGhi = { artifact: null, publicKeyPem: "", keyIdTinCay: "", moiTruong: "", ownerIdentities: null, now: MOC, runRef: "x" };
    const r = await ghiWaveCB(db, nhap(ky2, congRong, { soDuyet: 0 }));
    expect(r).toMatchObject({ daGhi: 0, daSuaHet: true });
    expect(await db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9810001" } }] } })).toBe(truocAudit);
    expect(await soClaim()).toBe(claim);
  });

  it("[WCB-DB-03] CỔNG KÝ: thiếu artifact / ký cho workflow KHÁC (C-A · C-C · PHASE B.1) / dòng khác / sai môi trường / khoá không ghim ⇒ từ chối TRƯỚC phép ghi đầu tiên, giá không đổi, 0 claim", async () => {
    const kh = await kehoach();
    const cong0 = CG(kh);
    const CASES: Array<[string, DauVaoCongGhi, string]> = [
      ["thiếu artifact", { ...cong0, artifact: null }, "THIEU_ARTIFACT"],
      ["workflow C-A", CG(kh, { workflowKy: WORKFLOW_WAVE1.waveCGanDanhTinh }), "SAI_WORKFLOW"],
      ["workflow C-C", CG(kh, { workflowKy: WORKFLOW_WAVE1.waveCGanPayment }), "SAI_WORKFLOW"],
      ["workflow B.1", CG(kh, { workflowKy: WORKFLOW_WAVE1.suaGiaGhiDanh }), "SAI_WORKFLOW"],
      ["dòng khác (plan SHA lệch)", CG(kh, { rowsKy: kh.dongDauRa.slice(0, N - 1) }), "LECH_DIGEST"],
      ["môi trường", CG(kh, { moiTruongKy: "prod" }), "SAI_MOI_TRUONG"],
      ["chưa ghim khoá", { ...cong0, keyIdTinCay: "" }, "KHOA_KHONG_KHOP"],
    ];
    for (const [ten, cong, ma] of CASES) {
      const e = await thuLoi(ghiWaveCB(db, nhap(kh, cong)));
      expect(e, ten).toBeInstanceOf(CongGhiTuChoi);
      expect((e as CongGhiTuChoi).ma, ten).toBe(ma);
      await khongGhiGi();
    }
    expect(await soClaim()).toBe(0);
    expect(await soAudit("CHUAN_HOA_GIA_GHI_DANH_WAVE_C")).toBe(0);
  });

  it.each([
    ["C-A CHƯA XONG (dòng đơn chưa gắn ghi danh)", async () => { await db.orderItem.update({ where: { id: id("it", 1) }, data: { studentId: null, enrollmentId: null } }); }, "DON_CHUA_GAN_DANH_TINH"],
    ["HỌC BỔNG: ghi danh đang mang SCHOLARSHIP", async () => { await db.enrollment.update({ where: { id: id("e", 0) }, data: { discountType: "SCHOLARSHIP", discountAmount: NIEM_YET[0]!, tuition: 0, finalPrice: 0 } }); }, "GIA_TROI"],
    ["giá ghi danh bị chỉnh tay (finalPrice −1)", async () => { await db.enrollment.update({ where: { id: id("e", 1) }, data: { finalPrice: NIEM_YET[1]! - 1 } }); }, "GIA_TROI"],
    ["listPrice ghi danh KHÁC giá niêm yết (đơn thường — listPrice chỉ đọc)", async () => { await db.enrollment.update({ where: { id: id("e", 1) }, data: { listPrice: NIEM_YET[1]! + 1 } }); }, "GIA_TROI"],
    ["đơn thường mà ghi danh có listPrice NULL (ngoại lệ KHÔNG lan sang)", async () => { await db.enrollment.update({ where: { id: id("e", 1) }, data: { listPrice: null } }); }, "GIA_TROI"],
    ["Payment thiếu 1đ (chưa đóng đủ)", async () => { await db.payment.update({ where: { id: id("p", 0) }, data: { amount: DICH[0]!.finalPrice! - 1 } }); }, "TIEN_PAYMENT_LECH"],
    ["Payment chưa CONFIRMED", async () => { await db.payment.update({ where: { id: id("p", 1) }, data: { accountantStatus: "PENDING" } }); }, "PAYMENT_KHONG_HOP_LE"],
    ["Payment gắn ghi danh của HỌC VIÊN KHÁC", async () => { await db.payment.update({ where: { id: id("p", 0) }, data: { enrollmentId: id("e", 1) } }); }, "PAYMENT_GAN_SAI_GHI_DANH"],
    ["phân bổ ngân hàng bị gỡ (bank không còn khớp đơn)", async () => { await db.paymentAllocation.deleteMany({ where: { bankTransactionId: id("bt", 1) } }); }, "TIEN_PHAN_BO_LECH"],
    ["giao dịch ngân hàng không còn MATCHED", async () => { await db.bankTransaction.update({ where: { id: id("bt", 0) }, data: { status: "UNMATCHED" } }); }, "TIEN_PHAN_BO_LECH"],
    ["Order.discountPercent sai (nguồn ORDER)", async () => { await db.order.update({ where: { id: id("o", 0) }, data: { discountPercent: 14 } }); }, "PHAN_TRAM_DON_LECH"],
    ["giảm giá nguồn ORDER chưa APPROVED", async () => { await db.order.update({ where: { id: id("o", NHOM_C) }, data: { discountApprovalStatus: "PENDING_APPROVAL" } }); }, "GIAM_GIA_CHUA_DUYET"],
    ["bản ghi OrderItem.discounts sai % (nguồn ITEM)", async () => { await db.orderItem.update({ where: { id: id("it", 1) }, data: { discounts: [{ kieu: "PHAN_TRAM", phanTram: 14, giam: DICH[1]!.discountAmount, vuotTran: false }] } }); }, "BANG_CHUNG_ITEM_LECH"],
    ["tổng đơn trôi", async () => { await db.order.update({ where: { id: id("o", 0) }, data: { totalAmount: DICH[0]!.finalPrice! + 1 } }); }, "TONG_DON_LECH"],
    ["NGOẠI LỆ: Course.price đổi (khoá có thể đã đổi giá)", async () => { await db.course.update({ where: { id: KHOA3 }, data: { price: 10_560_001, updatedAt: NGAY_GIA } }); }, "NGUON_NIEM_YET_KHONG_DU"],
    ["NGOẠI LỆ: Course.updatedAt SAU khi tạo đơn", async () => { await db.course.update({ where: { id: KHOA3 }, data: { updatedAt: new Date("2026-10-11T00:00:00Z") } }); }, "NGUON_NIEM_YET_KHONG_DU"],
    ["NGOẠI LỆ: OrderItem.unitPrice ≠ giá niêm yết", async () => { await db.orderItem.update({ where: { id: id("it", DAC_BIET) }, data: { unitPrice: 10_000_000 } }); }, "NGUON_NIEM_YET_KHONG_DU"],
    ["ghi danh bị huỷ (CANCELLED)", async () => { await db.enrollment.update({ where: { id: id("e", 0) }, data: { status: "CANCELLED" } }); }, "GHI_DANH_KHONG_HIEU_LUC"],
    ["đơn đã xoá mềm", async () => { await db.order.update({ where: { id: id("o", 1) }, data: { deletedAt: new Date() } }); }, "DON_DA_XOA"],
  ])("[WCB-DB-04] FAIL-CLOSED: %s ⇒ KHÔNG ghi danh nào trong lô được sửa, không claim", async (_ten, lamHong, ma) => {
    const kh0 = await kehoach();
    const cong = CG(kh0);
    await lamHong();
    const truoc = await Promise.all([0, 1, 2, 3].map((i) => giaHienTai(i)));
    const kh = await kehoach();
    expect(kh.dung).toBe(true);
    expect(kh.loi.map((x) => x.ma)).toContain(ma);
    expect(kh.ghi).toEqual([]);
    const e = await thuLoi(ghiWaveCB(db, nhap(kh0, cong)));
    expect(String(e)).toMatch(/DỪNG/);
    expect(String(e)).toContain(ma);
    expect(await Promise.all([0, 1, 2, 3].map((i) => giaHienTai(i)))).toEqual(truoc);
    expect(await soClaim()).toBe(0);
    expect(await soAudit("CHUAN_HOA_GIA_GHI_DANH_WAVE_C")).toBe(0);
  });

  it("[WCB-DB-05] TRANSACTION TOÀN LÔ: lỗi ở ghi danh cuối (trigger ném khi UPDATE ghi danh #3) ⇒ ba ghi danh đã ghi trước đó cũng LÙI; claim lùi theo", async () => {
    await db.$executeRawUnsafe(`CREATE FUNCTION wcb_boom() RETURNS trigger AS $f$ BEGIN RAISE EXCEPTION 'WCB_BOOM'; END $f$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER wcb_boom_trg BEFORE UPDATE ON "Enrollment" FOR EACH ROW WHEN (NEW.id = '${id("e", 3)}') EXECUTE FUNCTION wcb_boom()`);
    const kh = await kehoach();
    const e = await thuLoi(ghiWaveCB(db, nhap(kh, CG(kh))));
    expect(String(e)).toMatch(/WCB_BOOM/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
    expect(await soAudit("CHUAN_HOA_GIA_GHI_DANH_WAVE_C")).toBe(0);
    expect(await soAudit("CHUAN_HOA_GIA_GHI_DANH_WAVE_C_LUOT_CHAY")).toBe(0);
  });

  it("[WCB-DB-06] TRÔI giữa kế hoạch và ghi (ai đó vừa sửa giá ghi danh #1 sau khi đã ký) ⇒ cổng TRONG tx bắt, cả lô lùi, không claim", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await db.enrollment.update({ where: { id: id("e", 1) }, data: { finalPrice: NIEM_YET[1]! - 1000 } });
    const e = await thuLoi(db.$transaction((tx) => ghiWaveCBTrongTx(tx, nhap(kh, cong))));
    expect(String(e)).toMatch(/GIA_TROI/);
    await db.enrollment.update({ where: { id: id("e", 1) }, data: { finalPrice: NIEM_YET[1]! } });
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[WCB-DB-07] SAI --expect / thiếu --expect / thiếu quyền ghi ⇒ từ chối TRƯỚC khi mở transaction ghi", async () => {
    const kh = await kehoach();
    await expect(ghiWaveCB(db, nhap(kh, CG(kh), { soDuyet: N - 1 }))).rejects.toThrow(/≠ kế hoạch/);
    await expect(ghiWaveCB(db, nhap(kh, CG(kh), { soDuyet: null }))).rejects.toThrow(/đòi --expect/);
    await expect(ghiWaveCB(db, nhap(kh, CG(kh), { ghiDuoc: false }))).rejects.toThrow(/không có quyền UPDATE/);
    await expect(ghiWaveCB(db, nhap(kh, CG(kh), { ghiDuoc: null }))).rejects.toThrow(/Không kiểm được/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[WCB-DB-08] BẤT BIẾN: nếu phép ghi VÔ TÌNH kéo theo (a) đổi một cột Payment mà kế hoạch không nhìn (ghi chú) hoặc (b) đổi dòng hoa hồng cũ ⇒ ảnh chụp sau ≠ trước ⇒ throw, cả lô lùi", async () => {
    for (const [ten, thaan] of [
      ["Payment.note", `UPDATE "Payment" SET note = COALESCE(note, '') || ' sửa' WHERE id = '${id("p", 0)}'`],
      ["CommissionLine.amount", `UPDATE "CommissionLine" SET amount = amount + 1 WHERE id = '${id("cl", 0)}'`],
    ] as const) {
      await db.$executeRawUnsafe(`CREATE FUNCTION wcb_leak() RETURNS trigger AS $f$ BEGIN ${thaan}; RETURN NEW; END $f$ LANGUAGE plpgsql`);
      await db.$executeRawUnsafe(`CREATE TRIGGER wcb_leak_trg AFTER UPDATE ON "Enrollment" FOR EACH ROW EXECUTE FUNCTION wcb_leak()`);
      const kh = await kehoach();
      const e = await thuLoi(ghiWaveCB(db, nhap(kh, CG(kh))));
      expect(String(e), ten).toMatch(/Ảnh chụp bất biến/);
      await khongGhiGi();
      expect(await soClaim(), ten).toBe(0);
      await db.$executeRawUnsafe(`DROP TRIGGER wcb_leak_trg ON "Enrollment"`);
      await db.$executeRawUnsafe(`DROP FUNCTION wcb_leak()`);
    }
    expect((await db.commissionLine.findUniqueOrThrow({ where: { id: id("cl", 0) } })).amount).toBe(123_456);
  });

  it("[WCB-DB-09] REPLAY nonce: dùng lại ĐÚNG artifact đã dùng (đưa giá về xuất phát) ⇒ DA_DUNG, không sửa lần hai", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await ghiWaveCB(db, nhap(kh, cong));
    for (let i = 0; i < N; i++) await db.enrollment.update({ where: { id: id("e", i) }, data: i === DAC_BIET ? TRONG : LEGACY(NIEM_YET[i]!) });
    const kh2 = await kehoach();
    expect(kh2.dongDauRa).toEqual(kh.dongDauRa);
    const e = await thuLoi(ghiWaveCB(db, nhap(kh2, cong)));
    expect(e).toBeInstanceOf(CongGhiTuChoi);
    expect((e as CongGhiTuChoi).ma).toBe("DA_DUNG");
    await khongGhiGi();
  });

  it("[WCB-DB-10] KIỂM SAU GHI: trước ghi ⇒ chưa đạt; sau ghi ⇒ 4/4 ở giá đích; nợ giả đã gắn = 0; khoản nhóm C còn NULL ghi danh (việc của C-C) được báo, KHÔNG làm FAIL", async () => {
    const truoc = await kiemSauGhiWaveCB(db, BANG);
    expect(truoc.keHoach.daSuaHet).toBe(false);
    expect(truoc.soGhiDanhDungGia).toBe(0);
    const kh = await kehoach();
    await ghiWaveCB(db, nhap(kh, CG(kh)));
    const sau = await kiemSauGhiWaveCB(db, BANG);
    expect(sau.keHoach.dung).toBe(false);
    expect(sau.keHoach.daSuaHet).toBe(true);
    expect(sau.soGhiDanhDungGia).toBe(N);
    expect(sau.khoanChuaGanGhiDanh).toBe(1);
    expect(sau.keHoach.noGiaTruoc).toBe(0 + DICH[NHOM_C]!.finalPrice! + 0);
    expect(sau.keHoach.noGiaSau).toBe(DICH[NHOM_C]!.finalPrice!);
  });

  it("[WCB-DB-11] ẢNH CHỤP BẤT BIẾN nhạy: đổi một byte ngoài các cột được ghi (Enrollment.notes) làm đổi ảnh chụp; đổi đúng các cột được ghi thì KHÔNG", async () => {
    const a = await anhChupBatBienWaveCB(db, BANG);
    await db.enrollment.update({ where: { id: id("e", 1) }, data: { finalPrice: 1, tuition: 2, discountAmount: 3, discountType: "X" } });
    expect(await anhChupBatBienWaveCB(db, BANG)).toBe(a);
    await db.enrollment.update({ where: { id: id("e", 1) }, data: { notes: "đã bị sửa" } });
    expect(await anhChupBatBienWaveCB(db, BANG)).not.toBe(a);
  });

  it("[WCB-DB-12] `listPrice` CHỈ ĐỌC: đổi listPrice của ghi danh THƯỜNG làm đổi ảnh chụp (nên phép ghi vô tình đổi nó bị bắt); chỉ listPrice của ghi danh NGOẠI LỆ được miễn", async () => {
    const a = await anhChupBatBienWaveCB(db, BANG);
    await db.enrollment.update({ where: { id: id("e", 0) }, data: { listPrice: NIEM_YET[0]! + 1 } });
    expect(await anhChupBatBienWaveCB(db, BANG), "listPrice của ghi danh thường nằm TRONG ảnh chụp").not.toBe(a);
    await db.enrollment.update({ where: { id: id("e", 0) }, data: { listPrice: NIEM_YET[0]! } });
    expect(await anhChupBatBienWaveCB(db, BANG)).toBe(a);
    await db.enrollment.update({ where: { id: id("e", DAC_BIET) }, data: { listPrice: NIEM_YET[DAC_BIET]! } });
    expect(await anhChupBatBienWaveCB(db, BANG), "listPrice của ghi danh ngoại lệ được miễn").toBe(a);
  });
});
