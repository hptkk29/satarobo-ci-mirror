// tests/finance/wave-c-gan-danh-tinh-db.test.ts — [WCA-DB-*] «PHASE C-A · gắn danh tính đơn khoá học legacy» trên Postgres THẬT: đọc → kế hoạch → cổng Wave 1 → ghi → kiểm sau ghi.
//
// Chạy:  pnpm test:finance-db   (hoặc `vitest run -c vitest.db.config.ts tests/finance/wave-c-gan-danh-tinh-db.test.ts`). `pnpm test:unit` trần SKIP — log «SKIP» nghĩa là CHƯA kiểm gì.
// Khoá EPHEMERAL sinh lúc chạy; môi trường `test`. Fixture tiền tố `WCA_`; KHÔNG `resetDb()`; mọi hàm DB nhận PHẠM VI = đúng 6 mã đơn fixture (không phải 18 mã thật).
// Fixture «hình dạng thật» (đo PROD 26/10/2026): đơn COMPLETED đã đóng đủ, ba cột NULL; hai đơn đầu là ANH EM của CÙNG MỘT phụ huynh (cùng lead, cùng SĐT, cùng khoá) — bẫy gắn chéo; đơn thứ 6 có dòng đơn
// ĐÃ gắn đúng (chỉ thiếu Order.studentId, ghi danh không mang leadChildId); đơn thứ 2 thiếu Order.leadChildId (khoá bé chỉ có ở metadata).
//
// Ánh xạ yêu cầu owner (25/10/2026, WAVE C-A) → ca:
//   hard scope + runtime-resolved IDs ⇒ [00] [01]   |   chỉ ghi ba cột, Payment/Enrollment/giá y nguyên ⇒ [01]   |   anh em KHÔNG gắn chéo ⇒ [01] [11]   |   đa con KHÔNG gắn ⇒ [12]
//   duplicate student / enrollment / sai cơ sở / sai khoá / enrollment của đơn khác / trôi trường đích / đơn xoá ⇒ [04]   |   idempotent ⇒ [02]   |   rollback cả lô ⇒ [05]
//   workflow sai / chữ ký sai / sai --expect / plan SHA lệch / replay nonce / sai môi trường ⇒ [03] [07] [09]   |   drift trong tx ⇒ [06]   |   kiểm sau ghi ⇒ [10]
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dungCongGhiThu, type TuyChinhCongGhi } from "@/tests/_helpers/cong-ghi-wave1";
import { CongGhiTuChoi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import {
  ACTOR_WAVE_C_A,
  anhChupBatBienWaveCA,
  docKeHoachWaveCA,
  ghiWaveCA,
  ghiWaveCATrongTx,
  kiemSauGhiWaveCA,
  type DauVaoGhiWaveCA,
} from "@/lib/nguon/wave-c-gan-danh-tinh-db";
import type { KeHoachWaveCA, MucWaveCA } from "@/lib/nguon/wave-c-gan-danh-tinh";

if (!RUN_DB_TESTS) console.warn(`[WCA-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const P = "WCA_";
const CS1 = `${P}cs1`;
const CS2 = `${P}cs2`;
const KHOA = `${P}khoa`;
const KHOA_KHAC = `${P}khoa2`;
const LOP = `${P}lop`;
const LOP_B = `${P}lopb`;
const N = 6;
const DONG_DA_GAN = 5; // chỉ số đơn «dòng đơn đã gắn đúng»
const MA = Array.from({ length: N }, (_, i) => `${P}ORD-${i}`);
const BANG: Record<string, MucWaveCA> = Object.fromEntries(MA.map((m, i) => [m, { tongDon: 8_976_000, truoc: i === DONG_DA_GAN ? "DONG_DA_GAN" : "CHUA_GAN" } satisfies MucWaveCA]));
const id = (k: string, i: number) => `${P}${k}${i}`;
const MOC = new Date("2026-10-26T03:00:00.000Z");
const NGAY_THU = new Date("2026-09-20T03:00:00.000Z");
const TONG = 8_976_000;
const LUOT = { batDauLuc: MOC, nguonChay: { actor: "a", triggeringActor: "b", runId: "9800001", runAttempt: "1" } } as const;
const nonceDaDung: string[] = [];

async function don() {
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: P } }, { id: { in: nonceDaDung.map((n) => `wg:${n}`) } }, { entityId: { startsWith: "luot:9800001" } }] } });
  for (const t of ["boom", "leak"]) {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS wca_${t}_trg ON "OrderItem"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS wca_${t}()`);
  }
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
  await db.class.deleteMany({ where: { id: { in: [LOP, LOP_B] } } });
  await db.course.deleteMany({ where: { id: { in: [KHOA, KHOA_KHAC] } } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

/** Lead của đơn i: đơn 0 và 1 CHUNG lead (anh em); còn lại mỗi đơn một lead. */
const leadCua = (i: number) => (i === 1 ? 0 : i);

async function dung() {
  await don();
  await db.center.create({ data: { id: CS1, name: "Cơ sở WCA 1", slug: `${P}cs-1`, address: "x" } });
  await db.center.create({ data: { id: CS2, name: "Cơ sở WCA 2", slug: `${P}cs-2`, address: "y" } });
  await db.course.create({ data: { id: KHOA, name: "Sata3 WCA", slug: `${P}sata3`, totalSessions: 48 } });
  await db.course.create({ data: { id: KHOA_KHAC, name: "Sata4 WCA", slug: `${P}sata4`, totalSessions: 48 } });
  await db.class.create({ data: { id: LOP, name: "Lớp WCA", courseId: KHOA } });
  for (let i = 0; i < N; i++) {
    const L = leadCua(i);
    const phone = `098500000${L}`;
    if (i !== 1) await db.lead.create({ data: { id: id("l", L), parentName: `PH WCA ${L}`, phone, status: "DA_DANG_KY", centerId: CS1 } });
    await db.leadChild.create({ data: { id: id("be", i), leadId: id("l", L), fullName: `Bé WCA ${i}` } });
    await db.student.create({ data: { id: id("s", i), name: `Bé WCA ${i}`, leadId: id("l", L), leadChildId: id("be", i), centerId: CS1, parentPhone: phone } });
    await db.enrollment.create({
      data: {
        id: id("e", i), studentId: id("s", i), classId: LOP, courseId: KHOA, status: i === DONG_DA_GAN ? "STUDYING" : "ACTIVE", listPrice: 10_560_000, tuition: 10_560_000, finalPrice: 10_560_000,
        leadChildId: i === DONG_DA_GAN ? null : id("be", i), centerId: CS1,
      },
    });
    const daGan = i === DONG_DA_GAN;
    await db.order.create({
      data: {
        id: id("o", i), code: MA[i]!, type: "COURSE", status: "COMPLETED", customerName: `PH WCA ${L}`, customerPhone: phone, subtotal: 10_560_000, discountAmount: 1_584_000, discountPercent: 15,
        discountApprovalStatus: "APPROVED", totalAmount: TONG, leadId: id("l", L), leadChildId: i === 1 ? null : id("be", i), centerId: CS1,
      },
    });
    await db.orderItem.create({
      data: {
        id: id("it", i), orderId: id("o", i), type: "COURSE_ENROLLMENT", itemName: "Sata3", quantity: 1, unitPrice: 10_560_000, totalPrice: 10_560_000,
        metadata: { courseId: KHOA, leadChildId: id("be", i) }, studentId: daGan ? id("s", i) : null, enrollmentId: daGan ? id("e", i) : null,
      },
    });
    await db.paymentRequest.create({ data: { id: id("pr", i), orderId: id("o", i), centerId: CS1, installmentNo: 0, amountDue: TONG } });
    await db.payment.create({
      data: { id: id("p", i), orderId: id("o", i), orderItemId: id("it", i), amount: TONG, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1, enrollmentId: i < 3 ? id("e", i) : null },
    });
    await db.bankTransaction.create({ data: { id: id("bt", i), provider: "SEPAY", providerTxnId: `${P}txn${i}`, amount: TONG, transferredAt: NGAY_THU, status: "MATCHED", centerId: CS1 } });
    await db.paymentAllocation.create({ data: { bankTransactionId: id("bt", i), paymentRequestId: id("pr", i), amount: TONG } });
  }
}

let demNonce = 0;
const CG = (kh: KeHoachWaveCA, o: Partial<TuyChinhCongGhi> = {}): DauVaoCongGhi => {
  const nonce = o.nonce ?? `9c70${String(++demNonce).padStart(28, "0")}`;
  nonceDaDung.push(nonce);
  return dungCongGhiThu(WORKFLOW_WAVE1.waveCGanDanhTinh, kh.dongDauRa, { now: MOC, ...o, nonce }).cong;
};
const nhap = (kh: KeHoachWaveCA, congGhi: DauVaoCongGhi, o: Partial<DauVaoGhiWaveCA> = {}): DauVaoGhiWaveCA => ({
  bang: BANG, soDuyet: kh.ghi.length, ghiDuoc: true, actor: ACTOR_WAVE_C_A, luotChay: LUOT, congGhi, ...o,
});
const kehoach = () => docKeHoachWaveCA(db, BANG);
const lienKet = async () => ({
  order: await db.order.count({ where: { id: { startsWith: P }, studentId: { not: null } } }),
  dongStudent: await db.orderItem.count({ where: { orderId: { startsWith: P }, studentId: { not: null } } }),
  dongEnrollment: await db.orderItem.count({ where: { orderId: { startsWith: P }, enrollmentId: { not: null } } }),
});
/** Trạng thái xuất phát: 0 đơn có Order.studentId; chỉ dòng đơn của đơn «đã gắn» có hai cột kia. */
const khongGhiGi = async () => expect(await lienKet()).toEqual({ order: 0, dongStudent: 1, dongEnrollment: 1 });
const soClaim = () => db.auditLog.count({ where: { id: { in: nonceDaDung.map((n) => `wg:${n}`) } } });
const soAudit = (action: string) => db.auditLog.count({ where: { action, OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9800001" } }] } });
const thuLoi = (p: Promise<unknown>) => p.then(() => null, (x: unknown) => x);

describe.skipIf(!RUN_DB_TESTS)("[WCA-DB] gắn danh tính đơn khoá học legacy — Postgres thật", () => {
  beforeEach(async () => {
    await dung();
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[WCA-DB-00] fixture đúng hình dạng: kế hoạch SẴN SÀNG GHI 6 (5 đơn 3 cột + 1 đơn 1 cột), không lỗi; id học viên/ghi danh do DB ĐỌC ra (đối chứng dương cho mọi ca dưới)", async () => {
    await khongGhiGi();
    const kh = await kehoach();
    expect(kh.loi).toEqual([]);
    expect(kh.ghi).toHaveLength(N);
    expect(kh.ghi.map((g) => g.code)).toEqual(MA);
    expect(kh.ghi.filter((g) => g.che === "3COT")).toHaveLength(5);
    expect(kh.ghi.find((g) => g.che === "1COT")?.code).toBe(MA[DONG_DA_GAN]);
    for (let i = 0; i < N; i++) expect(kh.ghi[i]).toMatchObject({ orderItemId: id("it", i), studentId: id("s", i), enrollmentId: id("e", i) });
  });

  it("[WCA-DB-01] GHI: ba cột đúng; ANH EM cùng phụ huynh/SĐT/khoá KHÔNG gắn chéo; Payment, ghi danh, tổng đơn, leadId KHÔNG đổi; audit từng đơn + lượt + claim", async () => {
    const payTruoc = await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } });
    const gdTruoc = await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const svTruoc = await db.student.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const anhTruoc = await anhChupBatBienWaveCA(db, BANG);
    const kh = await kehoach();
    const r = await ghiWaveCA(db, nhap(kh, CG(kh)));
    expect(r).toMatchObject({ daGhi: N, daGanHet: true, keHoachSha: kh.sha });

    for (let i = 0; i < N; i++) {
      const o = await db.order.findUniqueOrThrow({ where: { id: id("o", i) }, include: { items: true } });
      expect(o.studentId, `đơn ${i}`).toBe(id("s", i));
      expect(o.items[0], `đơn ${i}`).toMatchObject({ studentId: id("s", i), enrollmentId: id("e", i) });
      expect(o.totalAmount).toBe(TONG);
      expect(o.leadId).toBe(id("l", leadCua(i)));
    }
    // anh em: đơn 0 và 1 cùng lead nhưng mỗi đơn về ĐÚNG bé của mình
    const a = await db.orderItem.findUniqueOrThrow({ where: { id: id("it", 0) } });
    const b = await db.orderItem.findUniqueOrThrow({ where: { id: id("it", 1) } });
    expect([a.studentId, a.enrollmentId, b.studentId, b.enrollmentId]).toEqual([id("s", 0), id("e", 0), id("s", 1), id("e", 1)]);

    expect(await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(payTruoc);
    expect(await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(gdTruoc);
    expect(await db.student.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(svTruoc);
    expect(await anhChupBatBienWaveCA(db, BANG)).toBe(anhTruoc);

    expect(await soAudit("GAN_DANH_TINH_DON_WAVE_C")).toBe(N);
    expect(await soAudit("GAN_DANH_TINH_DON_WAVE_C_LUOT_CHAY")).toBe(1);
    expect(await soClaim()).toBe(1);
    const a1 = await db.auditLog.findFirstOrThrow({ where: { action: "GAN_DANH_TINH_DON_WAVE_C", entityId: id("o", 2) } });
    expect(a1.oldValues).toMatchObject({ studentId: null, orderItemStudentId: null, orderItemEnrollmentId: null });
    expect(a1.newValues).toMatchObject({ studentId: id("s", 2), orderItemStudentId: id("s", 2), orderItemEnrollmentId: id("e", 2), che: "3COT" });
    const a2 = await db.auditLog.findFirstOrThrow({ where: { action: "GAN_DANH_TINH_DON_WAVE_C", entityId: id("o", DONG_DA_GAN) } });
    expect(a2.newValues).toMatchObject({ che: "1COT" });
    expect(a2.changedFields).toEqual(["Order.studentId"]);
    const luot = await db.auditLog.findFirstOrThrow({ where: { action: "GAN_DANH_TINH_DON_WAVE_C_LUOT_CHAY" } });
    expect(luot.newValues).toMatchObject({ expectedCount: N, actualCount: N, khop: true, keHoachSha: kh.sha, che3Cot: 5, che1Cot: 1 });
  });

  it("[WCA-DB-02] IDEMPOTENT: chạy lại sau khi ghi ⇒ 0 dòng ghi, KHÔNG qua cổng, KHÔNG claim, KHÔNG audit thêm — kể cả khi không có artifact", async () => {
    const kh = await kehoach();
    await ghiWaveCA(db, nhap(kh, CG(kh)));
    const truocAudit = await db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9800001" } }] } });
    const claim = await soClaim();
    const ky2 = await kehoach();
    expect(ky2.daGanHet).toBe(true);
    expect(ky2.ghi).toEqual([]);
    const congRong: DauVaoCongGhi = { artifact: null, publicKeyPem: "", keyIdTinCay: "", moiTruong: "", ownerIdentities: null, now: MOC, runRef: "x" };
    const r = await ghiWaveCA(db, nhap(ky2, congRong, { soDuyet: 0 }));
    expect(r).toMatchObject({ daGhi: 0, daGanHet: true });
    expect(await db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9800001" } }] } })).toBe(truocAudit);
    expect(await soClaim()).toBe(claim);
  });

  it("[WCA-DB-03] CỔNG KÝ: thiếu artifact / ký cho workflow KHÁC (kể cả workflow B.2 và C-B) / ký cho dòng khác / sai môi trường / khoá không ghim ⇒ từ chối TRƯỚC phép ghi đầu tiên, không ghi gì, 0 claim", async () => {
    const kh = await kehoach();
    const cong0 = CG(kh);
    const CASES: Array<[string, DauVaoCongGhi, string]> = [
      ["thiếu artifact", { ...cong0, artifact: null }, "THIEU_ARTIFACT"],
      ["workflow PHASE A", CG(kh, { workflowKy: WORKFLOW_WAVE1.ganDanhTinhDon }), "SAI_WORKFLOW"],
      ["workflow C-B", CG(kh, { workflowKy: WORKFLOW_WAVE1.waveCSuaGia }), "SAI_WORKFLOW"],
      ["workflow C-C", CG(kh, { workflowKy: WORKFLOW_WAVE1.waveCGanPayment }), "SAI_WORKFLOW"],
      ["dòng khác (thiếu một dòng ký — plan SHA lệch)", CG(kh, { rowsKy: kh.dongDauRa.slice(0, N - 1) }), "LECH_DIGEST"],
      ["môi trường", CG(kh, { moiTruongKy: "prod" }), "SAI_MOI_TRUONG"],
      ["chưa ghim khoá", { ...cong0, keyIdTinCay: "" }, "KHOA_KHONG_KHOP"],
    ];
    for (const [ten, cong, ma] of CASES) {
      const e = await thuLoi(ghiWaveCA(db, nhap(kh, cong)));
      expect(e, ten).toBeInstanceOf(CongGhiTuChoi);
      expect((e as CongGhiTuChoi).ma, ten).toBe(ma);
      await khongGhiGi();
    }
    expect(await soClaim()).toBe(0);
    expect(await soAudit("GAN_DANH_TINH_DON_WAVE_C")).toBe(0);
  });

  it.each([
    ["HAI học viên cùng khoá bé", async () => { await db.student.create({ data: { id: id("sx", 3), name: "Bé trùng", leadId: id("l", 3), leadChildId: id("be", 3), centerId: CS1 } }); }, "NHIEU_HOC_VIEN"],
    ["HAI ghi danh còn hiệu lực cùng khoá+cơ sở", async () => { await db.class.create({ data: { id: LOP_B, name: "Lớp B WCA", courseId: KHOA } }); await db.enrollment.create({ data: { id: id("ex", 3), studentId: id("s", 3), classId: LOP_B, courseId: KHOA, status: "ACTIVE", listPrice: 1, tuition: 1, finalPrice: 1, leadChildId: id("be", 3), centerId: CS1 } }); }, "NHIEU_GHI_DANH"],
    ["ghi danh SAI CƠ SỞ", async () => { await db.enrollment.update({ where: { id: id("e", 3) }, data: { centerId: CS2 } }); }, "KHONG_CO_GHI_DANH"],
    ["ghi danh SAI KHOÁ", async () => { await db.enrollment.update({ where: { id: id("e", 3) }, data: { courseId: KHOA_KHAC } }); }, "KHONG_CO_GHI_DANH"],
    ["ghi danh đã thuộc dòng đơn của ĐƠN KHÁC", async () => { await db.orderItem.create({ data: { id: `${P}it-khac`, orderId: id("o", 2), type: "COURSE_ENROLLMENT", itemName: "dòng lạ", quantity: 1, unitPrice: 1, totalPrice: 1, enrollmentId: id("e", 3) } }); }, "GHI_DANH_DA_BI_DUNG"],
    ["đơn đã XOÁ MỀM", async () => { await db.order.update({ where: { id: id("o", 3) }, data: { deletedAt: new Date() } }); }, "DON_DA_XOA"],
    ["metadata.leadChildId ≠ Order.leadChildId", async () => { await db.orderItem.update({ where: { id: id("it", 3) }, data: { metadata: { courseId: KHOA, leadChildId: id("be", 4) } } }); }, "XUNG_DOT_BE"],
    ["bé KHÔNG thuộc lead của đơn", async () => { await db.leadChild.update({ where: { id: id("be", 3) }, data: { leadId: id("l", 4) } }); }, "BE_KHONG_THUOC_LEAD"],
    ["TRÔI trường đích (Order.studentId đã trỏ học viên khác)", async () => { await db.order.update({ where: { id: id("o", 3) }, data: { studentId: id("s", 4) } }); }, "TRANG_THAI_GAN_LECH"],
    ["TRÔI tổng đơn", async () => { await db.order.update({ where: { id: id("o", 3) }, data: { totalAmount: TONG + 1 } }); }, "TONG_DON_LECH"],
    ["dòng đơn của đơn «đã gắn» trỏ SAI ghi danh", async () => { await db.orderItem.update({ where: { id: id("it", DONG_DA_GAN) }, data: { enrollmentId: id("e", 4) } }); }, "DONG_DON_TRO_SAI"],
    ["bảng khai «chưa gắn» nhưng dòng đơn đã gắn đúng (đơn đã trôi so với audit)", async () => { await db.orderItem.update({ where: { id: id("it", 2) }, data: { studentId: id("s", 2), enrollmentId: id("e", 2) } }); }, "TRUOC_LECH_BANG"],
  ])("[WCA-DB-04] FAIL-CLOSED: %s ⇒ KHÔNG đơn nào trong lô được gắn, không claim", async (_ten, lamHong, ma) => {
    const kh0 = await kehoach();
    const cong = CG(kh0);
    await lamHong();
    const lkTruoc = await lienKet();
    const kh = await kehoach();
    expect(kh.dung).toBe(true);
    expect(kh.loi.map((x) => x.ma)).toContain(ma);
    expect(kh.ghi).toEqual([]);
    const e = await thuLoi(ghiWaveCA(db, nhap(kh0, cong)));
    expect(String(e)).toMatch(/DỪNG/);
    expect(String(e)).toContain(ma);
    // Lệnh này không ghi thêm gì: liên kết y nguyên trạng thái ngay sau khi dựng ca hỏng.
    expect(await lienKet()).toEqual(lkTruoc);
    expect(await soClaim()).toBe(0);
    expect(await soAudit("GAN_DANH_TINH_DON_WAVE_C")).toBe(0);
  });

  it("[WCA-DB-05] TRANSACTION TOÀN LÔ: lỗi ở đơn cuối (trigger ném khi UPDATE dòng đơn #4) ⇒ các đơn đã ghi trước đó cũng LÙI; claim lùi theo", async () => {
    await db.$executeRawUnsafe(`CREATE FUNCTION wca_boom() RETURNS trigger AS $f$ BEGIN RAISE EXCEPTION 'WCA_BOOM'; END $f$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER wca_boom_trg BEFORE UPDATE ON "OrderItem" FOR EACH ROW WHEN (NEW.id = '${id("it", 4)}') EXECUTE FUNCTION wca_boom()`);
    const kh = await kehoach();
    const e = await thuLoi(ghiWaveCA(db, nhap(kh, CG(kh))));
    expect(String(e)).toMatch(/WCA_BOOM/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
    expect(await soAudit("GAN_DANH_TINH_DON_WAVE_C")).toBe(0);
    expect(await soAudit("GAN_DANH_TINH_DON_WAVE_C_LUOT_CHAY")).toBe(0);
  });

  it("[WCA-DB-06] TRÔI giữa kế hoạch và ghi (đơn #3 vừa bị gắn học viên khác sau khi đã ký) ⇒ cổng TRONG tx bắt, cả lô lùi, không claim", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await db.order.update({ where: { id: id("o", 3) }, data: { studentId: id("s", 0) } });
    const e = await thuLoi(db.$transaction((tx) => ghiWaveCATrongTx(tx, nhap(kh, cong))));
    expect(String(e)).toMatch(/TRANG_THAI_GAN_LECH/);
    await db.order.update({ where: { id: id("o", 3) }, data: { studentId: null } });
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[WCA-DB-07] SAI --expect (N−1) / thiếu --expect / thiếu quyền ghi / không kiểm được quyền ⇒ từ chối TRƯỚC khi mở transaction ghi", async () => {
    const kh = await kehoach();
    await expect(ghiWaveCA(db, nhap(kh, CG(kh), { soDuyet: N - 1 }))).rejects.toThrow(/≠ kế hoạch/);
    await expect(ghiWaveCA(db, nhap(kh, CG(kh), { soDuyet: null }))).rejects.toThrow(/đòi --expect/);
    await expect(ghiWaveCA(db, nhap(kh, CG(kh), { soDuyet: Number.NaN }))).rejects.toThrow(/số nguyên/);
    await expect(ghiWaveCA(db, nhap(kh, CG(kh), { ghiDuoc: false }))).rejects.toThrow(/không có quyền UPDATE/);
    await expect(ghiWaveCA(db, nhap(kh, CG(kh), { ghiDuoc: null }))).rejects.toThrow(/Không kiểm được/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[WCA-DB-08] BẤT BIẾN: nếu phép ghi VÔ TÌNH kéo theo đổi Payment.enrollmentId (trigger giả lập tác dụng phụ) ⇒ ảnh chụp sau ≠ trước ⇒ throw, cả lô lùi", async () => {
    await db.$executeRawUnsafe(
      `CREATE FUNCTION wca_leak() RETURNS trigger AS $f$ BEGIN UPDATE "Payment" SET "enrollmentId" = NEW."enrollmentId" WHERE "orderItemId" = NEW.id AND NEW."enrollmentId" IS NOT NULL; RETURN NEW; END $f$ LANGUAGE plpgsql`,
    );
    await db.$executeRawUnsafe(`CREATE TRIGGER wca_leak_trg AFTER UPDATE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION wca_leak()`);
    const kh = await kehoach();
    const e = await thuLoi(ghiWaveCA(db, nhap(kh, CG(kh))));
    expect(String(e)).toMatch(/Ảnh chụp bất biến/);
    await khongGhiGi();
    expect(await db.payment.count({ where: { orderId: { startsWith: P }, enrollmentId: { not: null } } })).toBe(3); // chỉ 3 khoản dựng sẵn gắn ghi danh từ fixture
    expect(await soClaim()).toBe(0);
  });

  it("[WCA-DB-09] REPLAY nonce: dùng lại ĐÚNG artifact đã dùng (đưa dữ liệu về xuất phát) ⇒ DA_DUNG, không gắn lần hai", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await ghiWaveCA(db, nhap(kh, cong));
    await db.orderItem.updateMany({ where: { orderId: { startsWith: P }, id: { not: id("it", DONG_DA_GAN) } }, data: { studentId: null, enrollmentId: null } });
    await db.order.updateMany({ where: { id: { startsWith: P } }, data: { studentId: null } });
    const kh2 = await kehoach();
    expect(kh2.dongDauRa).toEqual(kh.dongDauRa);
    const e = await thuLoi(ghiWaveCA(db, nhap(kh2, cong)));
    expect(e).toBeInstanceOf(CongGhiTuChoi);
    expect((e as CongGhiTuChoi).ma).toBe("DA_DUNG");
    await khongGhiGi();
  });

  it("[WCA-DB-10] KIỂM SAU GHI: trước ghi ⇒ chưa đạt (còn đơn thiếu cột); sau ghi ⇒ cả lô đúng + 0 đơn thiếu", async () => {
    const truoc = await kiemSauGhiWaveCA(db, BANG);
    expect(truoc.keHoach.daGanHet).toBe(false);
    expect(truoc.donConThieu).toBe(N);
    const kh = await kehoach();
    await ghiWaveCA(db, nhap(kh, CG(kh)));
    const sau = await kiemSauGhiWaveCA(db, BANG);
    expect(sau.keHoach.dung).toBe(false);
    expect(sau.keHoach.daGanHet).toBe(true);
    expect(sau.donConThieu).toBe(0);
  });

  it("[WCA-DB-11] ANH EM: nếu bé B mất ghi danh (huỷ) thì đơn của bé B KHÔNG được gắn sang ghi danh của bé A dù cùng phụ huynh/SĐT/khoá — cả lô dừng, đơn A cũng không ghi", async () => {
    await db.enrollment.update({ where: { id: id("e", 1) }, data: { status: "CANCELLED" } });
    const kh = await kehoach();
    expect(kh.dung).toBe(true);
    expect(kh.loi.map((x) => `${x.code}:${x.ma}`)).toContain(`${MA[1]}:KHONG_CO_GHI_DANH`);
    expect(kh.ghi).toEqual([]);
    expect(await soClaim()).toBe(0);
  });

  it("[WCA-DB-12] ĐƠN NHIỀU CON (hai dòng khoá học, hai bé) ⇒ SO_DONG_KHONG_DUNG, cả lô dừng, không gắn dòng nào", async () => {
    await db.orderItem.create({
      data: { id: `${P}it-be-thu-hai`, orderId: id("o", 3), type: "COURSE_ENROLLMENT", itemName: "Sata3 bé 2", quantity: 1, unitPrice: 1, totalPrice: 1, metadata: { courseId: KHOA, leadChildId: id("be", 4) } },
    });
    const kh = await kehoach();
    expect(kh.dung).toBe(true);
    expect(kh.loi.map((x) => `${x.code}:${x.ma}`)).toContain(`${MA[3]}:SO_DONG_KHONG_DUNG`);
    expect(kh.ghi).toEqual([]);
  });
});
