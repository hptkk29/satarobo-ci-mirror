// tests/finance/sua-gia-ghi-danh-db.test.ts — [SGD-DB-*] «chuẩn hoá giá ghi danh cho 6 đơn sống» (PHASE B.1) trên Postgres THẬT: đọc → kế hoạch → cổng Wave 1 → ghi → kiểm sau ghi.
//
// Chạy:  pnpm test:finance-db   (hoặc `vitest run -c vitest.db.config.ts tests/finance/sua-gia-ghi-danh-db.test.ts`). `pnpm test:unit` trần SKIP — log «SKIP» nghĩa là CHƯA kiểm gì.
// Khoá EPHEMERAL sinh lúc chạy; môi trường `test`. Fixture tiền tố `SGD_`; KHÔNG `resetDb()`; mọi hàm DB nhận BẢNG = đúng 6 mã đơn fixture (không phải 6 mã thật).
// Fixture: 5 ghi danh Sata3 còn giá legacy (10.560.000, không giảm) + 1 ghi danh Sata4 mang SCHOLARSHIP / 0đ; mỗi đơn đã duyệt giảm 15%, có Payment tách đợt + phân bổ ngân hàng MATCHED.
//
// Ánh xạ yêu cầu của chủ dự án (24/10/2026) → ca:
//   ghi đúng 4 cột, KHÔNG đụng Order/Payment/BankTransaction/hoa hồng/cột khác của ghi danh ⇒ [01]   |   ca SCHOLARSHIP 000006 ⇒ [01] [02]   |   idempotent ⇒ [03]
//   cổng ký (5 kiểu từ chối) + nonce/replay + digest lệch ⇒ [04] [10]   |   transaction toàn lô ⇒ [06]   |   snapshot drift ⇒ [07]
//   sai Order total / Payment / bank allocation / discount chưa duyệt / ≠15 / Payment đã gắn / không ACTIVE ⇒ [05]   |   sửa thêm cột ngoài allowlist ⇒ [09]
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dungCongGhiThu, type TuyChinhCongGhi } from "@/tests/_helpers/cong-ghi-wave1";
import { CongGhiTuChoi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import type { ArtifactPheDuyet } from "@/lib/security/phe-duyet-ghi";
import {
  ACTOR_SUA_GIA,
  anhChupBatBienSuaGia,
  docKeHoachSuaGia,
  ghiSuaGia,
  ghiSuaGiaTrongTx,
  kiemSauGhiSuaGia,
  type DauVaoGhiSuaGia,
} from "@/lib/nguon/sua-gia-ghi-danh-db";
import { giaDichTuNiemYet, type KeHoachSuaGia, type MucTieuSuaGia } from "@/lib/nguon/sua-gia-ghi-danh";

if (!RUN_DB_TESTS) console.warn(`[SGD-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const P = "SGD_";
const CS1 = `${P}cs1`;
const CS2 = `${P}cs2`;
const KHOA3 = `${P}khoa3`;
const KHOA4 = `${P}khoa4`;
const LOP3 = `${P}lop3`;
const LOP4 = `${P}lop4`;
const MA = [0, 1, 2, 3, 4, 5].map((i) => `${P}ORD-${i}`);
const SCH = 4; // đơn mang SCHOLARSHIP (tương ứng ORD-260910-000006)
const id = (k: string, i: number) => `${P}${k}${i}`;
const NIEM_YET = (i: number) => (i === SCH ? 11_520_000 : 10_560_000);
const LEGACY = (i: number) =>
  i === SCH
    ? { listPrice: 11_520_000, discountType: "SCHOLARSHIP", discountAmount: 11_520_000, tuition: 0, finalPrice: 0 }
    : { listPrice: 10_560_000, discountType: null, discountAmount: 0, tuition: 10_560_000, finalPrice: 10_560_000 };
const BANG: Record<string, MucTieuSuaGia> = Object.fromEntries(MA.map((m, i) => [m, { listPrice: NIEM_YET(i), truoc: LEGACY(i) }]));
const DICH = (i: number) => giaDichTuNiemYet(NIEM_YET(i));
const MOC = new Date("2026-10-24T03:00:00.000Z");
const NGAY_THU = new Date("2026-08-20T03:00:00.000Z");
const LUOT = { batDauLuc: MOC, nguonChay: { actor: "a", triggeringActor: "b", runId: "9500001", runAttempt: "1" } } as const;
const nonceDaDung: string[] = [];

async function don() {
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: P } }, { id: { in: nonceDaDung.map((n) => `wg:${n}`) } }, { entityId: { startsWith: "luot:9500001" } }] } });
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS sgd_boom_trg ON "Enrollment"`);
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS sgd_leak_trg ON "Enrollment"`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS sgd_boom()`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS sgd_leak()`);
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { startsWith: P } } } });
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
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

/** Sáu đơn «hình dạng thật», ĐÃ qua PHASE A (đơn + dòng đơn trỏ học viên + ghi danh), giảm 15% đã duyệt, ghi danh còn giá legacy. */
async function dung() {
  await don();
  await db.center.create({ data: { id: CS1, name: "Cơ sở SGD 1", slug: `${P}cs-1`, address: "x" } });
  await db.center.create({ data: { id: CS2, name: "Cơ sở SGD 2", slug: `${P}cs-2`, address: "y" } });
  await db.course.create({ data: { id: KHOA3, name: "Sata3 SGD", slug: `${P}sata3`, totalSessions: 48 } });
  await db.course.create({ data: { id: KHOA4, name: "Sata4 SGD", slug: `${P}sata4`, totalSessions: 48 } });
  await db.class.create({ data: { id: LOP3, name: "Lớp 3 SGD", courseId: KHOA3 } });
  await db.class.create({ data: { id: LOP4, name: "Lớp 4 SGD", courseId: KHOA4 } });
  for (let i = 0; i < 6; i++) {
    const phone = `098200000${i}`;
    const khoa = i === SCH ? KHOA4 : KHOA3;
    const dich = DICH(i);
    await db.lead.create({ data: { id: id("l", i), parentName: `PH SGD ${i}`, phone, status: "DA_DANG_KY", centerId: CS1 } });
    await db.leadChild.create({ data: { id: id("be", i), leadId: id("l", i), fullName: `Bé SGD ${i}` } });
    await db.student.create({ data: { id: id("s", i), name: `Bé SGD ${i}`, leadId: id("l", i), leadChildId: id("be", i), centerId: CS1, parentPhone: phone } });
    const l = LEGACY(i);
    await db.enrollment.create({
      data: {
        id: id("e", i), studentId: id("s", i), classId: i === SCH ? LOP4 : LOP3, courseId: khoa, status: "ACTIVE", leadChildId: id("be", i), centerId: CS1,
        listPrice: l.listPrice, discountType: l.discountType, discountAmount: l.discountAmount, tuition: l.tuition, finalPrice: l.finalPrice, notes: `ghi chú ${i}`,
      },
    });
    await db.order.create({
      data: {
        id: id("o", i), code: MA[i]!, type: "COURSE", status: "COMPLETED", customerName: `PH SGD ${i}`, customerPhone: phone, subtotal: NIEM_YET(i), discountAmount: dich.discountAmount!,
        discountPercent: 15, discountApprovalStatus: "APPROVED", totalAmount: dich.finalPrice!, leadId: id("l", i), leadChildId: id("be", i), centerId: CS1, studentId: id("s", i),
      },
    });
    await db.orderItem.create({
      data: {
        id: id("it", i), orderId: id("o", i), type: "COURSE_ENROLLMENT", itemName: "Khoá SGD", quantity: 1, unitPrice: NIEM_YET(i), totalPrice: NIEM_YET(i), metadata: { courseId: khoa },
        studentId: id("s", i), enrollmentId: id("e", i),
      },
    });
    const nua = Math.floor(dich.finalPrice! / 2);
    for (const [k, so] of [["a", nua], ["b", dich.finalPrice! - nua]] as const) {
      await db.payment.create({
        data: { id: id(`p${k}`, i), orderId: id("o", i), orderItemId: id("it", i), amount: so, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1 },
      });
    }
    await db.paymentRequest.create({ data: { id: id("pr", i), orderId: id("o", i), centerId: CS1, installmentNo: 0, amountDue: dich.finalPrice! } });
    await db.bankTransaction.create({
      data: { id: id("bt", i), provider: "SEPAY", providerTxnId: `${P}txn${i}`, amount: dich.finalPrice!, transferredAt: NGAY_THU, status: "MATCHED", centerId: CS1 },
    });
    await db.paymentAllocation.create({ data: { bankTransactionId: id("bt", i), paymentRequestId: id("pr", i), amount: dich.finalPrice! } });
  }
}

let demNonce = 0;
const CG = (kh: KeHoachSuaGia, o: Partial<TuyChinhCongGhi> = {}): DauVaoCongGhi => {
  const nonce = o.nonce ?? `9d71${String(++demNonce).padStart(28, "0")}`;
  nonceDaDung.push(nonce);
  return dungCongGhiThu(WORKFLOW_WAVE1.suaGiaGhiDanh, kh.dongDauRa, { now: MOC, ...o, nonce }).cong;
};
const nhap = (kh: KeHoachSuaGia, congGhi: DauVaoCongGhi, o: Partial<DauVaoGhiSuaGia> = {}): DauVaoGhiSuaGia => ({
  bang: BANG, soDuyet: kh.ghi.length, ghiDuoc: true, actor: ACTOR_SUA_GIA, luotChay: LUOT, congGhi, ...o,
});
const kehoach = () => docKeHoachSuaGia(db, BANG);
const gia = async (i: number) => {
  const e = await db.enrollment.findUniqueOrThrow({ where: { id: id("e", i) } });
  return { listPrice: e.listPrice, discountType: e.discountType, discountAmount: e.discountAmount, tuition: e.tuition, finalPrice: e.finalPrice };
};
const khongGhiGi = async () => {
  for (let i = 0; i < 6; i++) expect(await gia(i), `ghi danh ${i}`).toEqual(LEGACY(i));
};
const soClaim = () => db.auditLog.count({ where: { id: { in: nonceDaDung.map((n) => `wg:${n}`) } } });
const soAudit = (action: string) => db.auditLog.count({ where: { action, OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9500001" } }] } });

describe.skipIf(!RUN_DB_TESTS)("[SGD-DB] chuẩn hoá giá 6 ghi danh — Postgres thật", () => {
  beforeEach(async () => {
    await dung();
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[SGD-DB-00] fixture đúng hình dạng: 6 ghi danh còn giá legacy, kế hoạch SẴN SÀNG GHI 6, không lỗi, nợ dự kiến 0 (đối chứng dương cho mọi ca dưới)", async () => {
    await khongGhiGi();
    const kh = await kehoach();
    expect(kh.loi).toEqual([]);
    expect(kh.ghi).toHaveLength(6);
    expect(kh.muc.every((m) => m.noDuKienSauGan === 0)).toBe(true);
    expect(await db.payment.count({ where: { orderId: { startsWith: P }, enrollmentId: { not: null } } })).toBe(0);
  });

  it("[SGD-DB-01] GHI: đúng 4 cột/ghi danh (PERCENT · giảm · final · tuition), finalPrice = list − giảm, tuition = final; SCHOLARSHIP của ca 000006 BIẾN MẤT; Order/Payment/bank/cột khác của ghi danh KHÔNG đổi; audit trước/sau + dấu vết lượt + claim", async () => {
    const truoc = await anhChupBatBienSuaGia(db, BANG);
    const orderTruoc = await db.order.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const payTruoc = await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } });
    const btTruoc = await db.bankTransaction.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const kh = await kehoach();
    const r = await ghiSuaGia(db, nhap(kh, CG(kh)));
    expect(r).toMatchObject({ daGhi: 6, daSuaHet: true, keHoachSha: kh.sha });

    for (let i = 0; i < 6; i++) {
      const g = await gia(i);
      expect(g, `ghi danh ${i}`).toEqual(DICH(i));
      expect(g.finalPrice).toBe(g.listPrice! - g.discountAmount!);
      expect(g.tuition).toBe(g.finalPrice);
      expect(g.discountType).toBe("PERCENT");
      const e = await db.enrollment.findUniqueOrThrow({ where: { id: id("e", i) } });
      expect(e.notes).toBe(`ghi chú ${i}`);
      expect(e.status).toBe("ACTIVE");
    }
    expect(await gia(SCH)).toEqual({ listPrice: 11_520_000, discountType: "PERCENT", discountAmount: 1_728_000, tuition: 9_792_000, finalPrice: 9_792_000 });
    expect(await gia(0)).toEqual({ listPrice: 10_560_000, discountType: "PERCENT", discountAmount: 1_584_000, tuition: 8_976_000, finalPrice: 8_976_000 });

    // bất biến: so từng dòng (không chỉ sha)
    expect(await db.order.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(orderTruoc);
    expect(await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(payTruoc);
    expect(await db.bankTransaction.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(btTruoc);
    expect(await anhChupBatBienSuaGia(db, BANG)).toBe(truoc);
    expect(await db.payment.count({ where: { orderId: { startsWith: P }, enrollmentId: { not: null } } })).toBe(0);
    expect(await db.receipt.count({ where: { enrollmentId: { startsWith: P } } })).toBe(0);

    expect(await soAudit("CHUAN_HOA_GIA_GHI_DANH")).toBe(6);
    expect(await soAudit("CHUAN_HOA_GIA_GHI_DANH_LUOT_CHAY")).toBe(1);
    expect(await soClaim()).toBe(1);
    const a = await db.auditLog.findFirstOrThrow({ where: { action: "CHUAN_HOA_GIA_GHI_DANH", entityId: id("e", SCH) } });
    expect(a.reason).toBe("Chuẩn hóa giá legacy theo đơn đã duyệt — đóng full khóa học giảm 15%");
    expect(a.oldValues).toMatchObject({ discountType: "SCHOLARSHIP", discountAmount: 11_520_000, tuition: 0, finalPrice: 0 });
    expect(a.newValues).toMatchObject({ discountType: "PERCENT", discountAmount: 1_728_000, tuition: 9_792_000, finalPrice: 9_792_000 });
    const luot = await db.auditLog.findFirstOrThrow({ where: { action: "CHUAN_HOA_GIA_GHI_DANH_LUOT_CHAY" } });
    expect(luot.newValues).toMatchObject({ expectedCount: 6, actualCount: 6, khop: true, keHoachSha: kh.sha, phanTramGiam: 15 });
  });

  it("[SGD-DB-02] SAU khi ghi, nếu sau này gắn Payment (PHASE B.2) thì công nợ = giá đích − Σ Payment = 0 ở CẢ 6 (đo bằng chính hàm công nợ, không phải phép trừ tay)", async () => {
    const kh = await kehoach();
    await ghiSuaGia(db, nhap(kh, CG(kh)));
    const { computeEnrollmentDebt } = await import("@/lib/finance/debt");
    for (let i = 0; i < 6; i++) {
      const g = await gia(i);
      const pays = await db.payment.findMany({ where: { orderId: id("o", i), deletedAt: null }, select: { amount: true, accountantStatus: true } });
      expect(computeEnrollmentDebt(g.finalPrice, pays, "ACTIVE"), `ghi danh ${i}`).toBe(0);
    }
  });

  it("[SGD-DB-03] IDEMPOTENT: chạy lại sau khi ghi ⇒ 0 dòng ghi, KHÔNG qua cổng, KHÔNG claim, KHÔNG audit thêm — kể cả khi không có artifact", async () => {
    const kh = await kehoach();
    await ghiSuaGia(db, nhap(kh, CG(kh)));
    const dem = () => db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9500001" } }] } });
    const truocAudit = await dem();
    const claim = await soClaim();
    const ky2 = await kehoach();
    expect(ky2.daSuaHet).toBe(true);
    expect(ky2.ghi).toEqual([]);
    const congRong: DauVaoCongGhi = { artifact: null, publicKeyPem: "", keyIdTinCay: "", moiTruong: "", ownerIdentities: null, now: MOC, runRef: "x" };
    const r = await ghiSuaGia(db, nhap(ky2, congRong, { soDuyet: 0 }));
    expect(r).toMatchObject({ daGhi: 0, daSuaHet: true });
    expect(await dem()).toBe(truocAudit);
    expect(await soClaim()).toBe(claim);
  });

  it("[SGD-DB-04] CỔNG KÝ: thiếu artifact / ký cho workflow khác / ký cho dòng khác (digest) / sai môi trường / chưa ghim khoá ⇒ từ chối TRƯỚC phép ghi, 0 ghi danh đổi, 0 claim", async () => {
    const kh = await kehoach();
    const cong0 = CG(kh);
    const CASES: Array<[string, DauVaoCongGhi, string]> = [
      ["thiếu artifact", { ...cong0, artifact: null }, "THIEU_ARTIFACT"],
      ["workflow khác", CG(kh, { workflowKy: WORKFLOW_WAVE1.ganDanhTinhDon }), "SAI_WORKFLOW"],
      ["dòng khác (plan digest)", CG(kh, { rowsKy: kh.dongDauRa.slice(0, 5) }), "LECH_DIGEST"],
      ["môi trường", CG(kh, { moiTruongKy: "prod" }), "SAI_MOI_TRUONG"],
      ["chưa ghim khoá", { ...cong0, keyIdTinCay: "" }, "KHOA_KHONG_KHOP"],
      // CHỮ KÝ SAI: nội dung artifact bị sửa SAU khi ký (đổi người ký) — chữ ký cũ không còn khớp ⇒ phải bị từ chối, KHÔNG được ghi.
      ["chữ ký sai (artifact bị sửa sau khi ký)", (() => {
        const a = cong0.artifact as ArtifactPheDuyet;
        return { ...cong0, artifact: { payload: { ...a.payload, ownerIdentity: "ke-gia-mao@satarobo.test" }, signature: a.signature } };
      })(), "SAI_CHU_KY"],
      ["artifact hết hạn", CG(kh, { nowCong: new Date(MOC.getTime() + 400 * 24 * 3600 * 1000) }), "HET_HAN"],
      ["owner không nằm trong danh sách chấp nhận", CG(kh, { ownerIdentities: ["nguoi-khac@satarobo.test"] }), "SAI_OWNER"],
    ];
    for (const [ten, cong, ma] of CASES) {
      const e = await ghiSuaGia(db, nhap(kh, cong)).then(() => null, (x: unknown) => x);
      expect(e, ten).toBeInstanceOf(CongGhiTuChoi);
      expect((e as CongGhiTuChoi).ma, ten).toBe(ma);
      await khongGhiGi();
    }
    expect(await soClaim()).toBe(0);
    expect(await soAudit("CHUAN_HOA_GIA_GHI_DANH")).toBe(0);
  });

  describe("[SGD-DB-05] FAIL-CLOSED: MỘT đơn lệch ⇒ không ghi danh nào trong 6 được sửa, không claim", () => {
    const CA: Array<[string, string, () => Promise<unknown>]> = [
      ["sai Order total", "TONG_DON_LECH", () => db.order.update({ where: { id: id("o", 3) }, data: { totalAmount: { increment: 1 } } })],
      ["sai Payment total", "TIEN_PAYMENT_LECH", () => db.payment.update({ where: { id: id("pb", 3) }, data: { amount: { decrement: 1 } } })],
      ["sai bank allocation", "TIEN_PHAN_BO_LECH", () => db.paymentAllocation.update({ where: { bankTransactionId_paymentRequestId: { bankTransactionId: id("bt", 3), paymentRequestId: id("pr", 3) } }, data: { amount: { decrement: 1 } } })],
      ["giao dịch ngân hàng không còn MATCHED", "TIEN_PHAN_BO_LECH", () => db.bankTransaction.update({ where: { id: id("bt", 3) }, data: { status: "UNMATCHED" } })],
      ["discount chưa APPROVED", "GIAM_GIA_CHUA_DUYET", () => db.order.update({ where: { id: id("o", 3) }, data: { discountApprovalStatus: "PENDING_APPROVAL" } })],
      ["discount bị REJECTED", "GIAM_GIA_CHUA_DUYET", () => db.order.update({ where: { id: id("o", 3) }, data: { discountApprovalStatus: "REJECTED" } })],
      ["discount ≠ 15%", "PHAN_TRAM_DON_LECH", () => db.order.update({ where: { id: id("o", 3) }, data: { discountPercent: 14 } })],
      ["Payment đã có enrollmentId", "PAYMENT_DA_GAN_GHI_DANH", () => db.payment.update({ where: { id: id("pa", 3) }, data: { enrollmentId: id("e", 3) } })],
      ["Enrollment không ACTIVE", "GHI_DANH_KHONG_ACTIVE", () => db.enrollment.update({ where: { id: id("e", 3) }, data: { status: "COMPLETED" } })],
      ["đơn đã xoá mềm", "DON_DA_XOA", () => db.order.update({ where: { id: id("o", 3) }, data: { deletedAt: new Date("2026-10-05T12:00:00Z") } })],
      ["chưa qua PHASE A", "DON_CHUA_GAN_DANH_TINH", () => db.orderItem.update({ where: { id: id("it", 3) }, data: { enrollmentId: null } })],
      ["có dòng hoa hồng liên quan", "CO_HOA_HONG_LIEN_QUAN", async () => {
        const st = await db.commissionStatement.upsert({ where: { period: "2099-07" }, create: { period: "2099-07", status: "DRAFT" }, update: {} });
        await db.commissionLine.create({ data: { id: id("hh", 3), statementId: st.id, recipientId: id("s", 3), tier: "SALE", amount: 1, leadId: id("l", 3) } as never });
      }],
    ];
    it.each(CA)("%s ⇒ %s", async (_ten, ma, lamLech) => {
      const kh = await kehoach();
      const cong = CG(kh);
      try {
        await lamLech();
        const e = await ghiSuaGia(db, nhap(kh, cong)).then(() => null, (x: unknown) => x);
        expect(String(e)).toMatch(/DỪNG/);
        expect(String(e)).toContain(ma);
        const nay = await docKeHoachSuaGia(db, BANG);
        expect(nay.ghi, "kế hoạch lệch ⇒ không dòng ghi nào").toEqual([]);
        for (let i = 0; i < 6; i++) {
          const g = await gia(i);
          expect(g.discountType === "PERCENT", `ghi danh ${i} không được sửa`).toBe(false);
        }
        expect(await soClaim()).toBe(0);
      } finally {
        await db.commissionLine.deleteMany({ where: { id: id("hh", 3) } });
        await db.commissionStatement.deleteMany({ where: { period: "2099-07", lines: { none: {} } } }).catch(() => undefined);
      }
    });
  });

  it("[SGD-DB-06] TRANSACTION TOÀN LÔ: lỗi ở ghi danh cuối (trigger ném khi UPDATE ghi danh #5) ⇒ 5 ghi danh đã sửa trước đó cũng LÙI; claim lùi theo", async () => {
    await db.$executeRawUnsafe(`CREATE FUNCTION sgd_boom() RETURNS trigger AS $f$ BEGIN RAISE EXCEPTION 'SGD_BOOM'; END $f$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER sgd_boom_trg BEFORE UPDATE ON "Enrollment" FOR EACH ROW WHEN (NEW.id = '${id("e", 5)}') EXECUTE FUNCTION sgd_boom()`);
    const kh = await kehoach();
    const e = await ghiSuaGia(db, nhap(kh, CG(kh))).then(() => null, (x: unknown) => x);
    expect(String(e)).toMatch(/SGD_BOOM/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
    expect(await soAudit("CHUAN_HOA_GIA_GHI_DANH")).toBe(0);
    expect(await soAudit("CHUAN_HOA_GIA_GHI_DANH_LUOT_CHAY")).toBe(0);
  });

  it("[SGD-DB-07] SNAPSHOT DRIFT giữa kế hoạch và ghi (có người vừa sửa giá một ghi danh) ⇒ cổng TRONG tx bắt (GIA_TROI), cả lô lùi", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await db.enrollment.update({ where: { id: id("e", 3) }, data: { finalPrice: 9_000_000, tuition: 9_000_000 } });
    const e = await db.$transaction((tx) => ghiSuaGiaTrongTx(tx, nhap(kh, cong))).then(() => null, (x: unknown) => x);
    expect(String(e)).toMatch(/GIA_TROI/);
    await db.enrollment.update({ where: { id: id("e", 3) }, data: { finalPrice: 10_560_000, tuition: 10_560_000 } });
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[SGD-DB-08] SAI --expect (5 thay vì 6) / thiếu quyền ghi / thiếu --expect ⇒ từ chối TRƯỚC khi mở transaction ghi", async () => {
    const kh = await kehoach();
    await expect(ghiSuaGia(db, nhap(kh, CG(kh), { soDuyet: 5 }))).rejects.toThrow(/≠ kế hoạch/);
    await expect(ghiSuaGia(db, nhap(kh, CG(kh), { soDuyet: null }))).rejects.toThrow(/đòi --expect/);
    await expect(ghiSuaGia(db, nhap(kh, CG(kh), { ghiDuoc: false }))).rejects.toThrow(/không có quyền UPDATE/);
    await expect(ghiSuaGia(db, nhap(kh, CG(kh), { ghiDuoc: null }))).rejects.toThrow(/Không kiểm được/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[SGD-DB-09] ALLOWLIST CỘT: nếu phép ghi VÔ TÌNH kéo theo đổi một cột NGOÀI allowlist (trigger đổi `notes` của ghi danh; trigger đổi Payment.enrollmentId) ⇒ ảnh chụp sau ≠ trước ⇒ throw, cả lô lùi", async () => {
    for (const [ten, thanTrigger] of [
      ["notes", `UPDATE "Enrollment" SET notes = 'bi-sua' WHERE id = NEW.id`],
      ["payment", `UPDATE "Payment" SET "enrollmentId" = NEW.id WHERE "orderId" IN (SELECT o.id FROM "Order" o JOIN "OrderItem" oi ON oi."orderId" = o.id WHERE oi."enrollmentId" = NEW.id)`],
    ] as const) {
      await dung();
      await db.$executeRawUnsafe(`CREATE FUNCTION sgd_leak() RETURNS trigger AS $f$ BEGIN IF pg_trigger_depth() < 2 THEN ${thanTrigger}; END IF; RETURN NEW; END $f$ LANGUAGE plpgsql`);
      await db.$executeRawUnsafe(`CREATE TRIGGER sgd_leak_trg AFTER UPDATE ON "Enrollment" FOR EACH ROW EXECUTE FUNCTION sgd_leak()`);
      const kh = await kehoach();
      const e = await ghiSuaGia(db, nhap(kh, CG(kh))).then(() => null, (x: unknown) => x);
      expect(String(e), ten).toMatch(/Ảnh chụp bất biến|PAYMENT_DA_GAN_GHI_DANH/);
      await khongGhiGi();
      expect(await db.payment.count({ where: { orderId: { startsWith: P }, enrollmentId: { not: null } } }), ten).toBe(0);
      expect(await soClaim(), ten).toBe(0);
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS sgd_leak_trg ON "Enrollment"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS sgd_leak()`);
    }
  });

  it("[SGD-DB-10] REPLAY: dùng lại ĐÚNG artifact đã dùng (đưa giá về legacy) ⇒ DA_DUNG, 0 ghi danh được sửa lần hai", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await ghiSuaGia(db, nhap(kh, cong));
    for (let i = 0; i < 6; i++) await db.enrollment.update({ where: { id: id("e", i) }, data: LEGACY(i) });
    const kh2 = await kehoach();
    expect(kh2.dongDauRa).toEqual(kh.dongDauRa);
    const e = await ghiSuaGia(db, nhap(kh2, cong)).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(CongGhiTuChoi);
    expect((e as CongGhiTuChoi).ma).toBe("DA_DUNG");
    await khongGhiGi();
  });

  it.each(["Order", "OrderItem", "Enrollment"] as const)(
    "[SGD-DB-12] KHOÁ HÀNG %s: lượt ghi PHẢI chờ khoá hàng (FOR UPDATE) — người khác đang giữ khoá ⇒ hết thời gian chờ, cả lô lùi, 0 claim",
    async (bang) => {
      const kh = await kehoach();
      const cong = CG(kh);
      const giu = bang === "Order" ? id("o", 2) : bang === "OrderItem" ? id("it", 2) : id("e", 2);
      let loi: unknown = null;
      await db.$transaction(
        async (tx1) => {
          await tx1.$queryRawUnsafe(`SELECT id FROM "${bang}" WHERE id = '${giu}' FOR UPDATE`);
          loi = await db
            .$transaction(async (tx2) => {
              await tx2.$executeRawUnsafe(`SET LOCAL lock_timeout = '1500ms'`);
              return ghiSuaGiaTrongTx(tx2, nhap(kh, cong));
            })
            .then(() => null, (e: unknown) => e);
        },
        { timeout: 30_000 },
      );
      expect(String(loi)).toMatch(/lock timeout|could not obtain lock|55P03/i);
      await khongGhiGi();
      expect(await soClaim()).toBe(0);
    },
  );

  it("[SGD-DB-11] KIỂM SAU GHI: trước ghi ⇒ chưa đạt; sau ghi ⇒ cả lô ở giá đích + Payment chưa gắn ghi danh = 0; nếu ai đó gắn Payment thì kiểm sau ghi THẤY", async () => {
    const truoc = await kiemSauGhiSuaGia(db, BANG);
    expect(truoc.keHoach.daSuaHet).toBe(false);
    const kh = await kehoach();
    await ghiSuaGia(db, nhap(kh, CG(kh)));
    const sau = await kiemSauGhiSuaGia(db, BANG);
    expect(sau.keHoach.dung).toBe(false);
    expect(sau.keHoach.daSuaHet).toBe(true);
    expect(sau.paymentDaGanGhiDanh).toBe(0);
    await db.payment.update({ where: { id: id("pa", 0) }, data: { enrollmentId: id("e", 0) } });
    expect((await kiemSauGhiSuaGia(db, BANG)).paymentDaGanGhiDanh).toBe(1);
  });
});
