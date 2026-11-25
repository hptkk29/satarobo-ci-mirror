// tests/finance/gan-payment-ghi-danh-db.test.ts — [GPD-DB-*] «gắn Payment.enrollmentId cho 9 khoản của 6 đơn sống» (PHASE B.2) trên Postgres THẬT: đọc → kế hoạch → cổng Wave 1 → ghi → kiểm sau ghi.
//
// Chạy:  pnpm test:finance-db   (hoặc `vitest run -c vitest.db.config.ts tests/finance/gan-payment-ghi-danh-db.test.ts`). `pnpm test:unit` trần SKIP — log «SKIP» nghĩa là CHƯA kiểm gì.
// Khoá EPHEMERAL sinh lúc chạy; môi trường `test`. Fixture tiền tố `GPD_`; KHÔNG `resetDb()`; mọi hàm DB nhận BẢNG = đúng 6 đơn / 9 khoản FIXTURE (không phải id thật).
// Fixture «hình dạng thật» (đo PROD 24/10/2026): 6 đơn đã qua PHASE A (đơn + dòng đơn + ghi danh) VÀ PHASE B.1 (giá đích), khoản CONFIRMED/RECORDED chia 2·1·1·1·1·3, mỗi khoản 1 giao dịch ngân hàng MATCHED
// + phân bổ, đơn #0 có hoá đơn điện tử DA_XAC_NHAN giữ 2 khoản, đơn #2 có 1 khoản đã xoá mềm.
//
// Ánh xạ yêu cầu của chủ dự án (24/10/2026) → ca:
//   đúng 9 khoản → 6 ghi danh, KHÔNG đổi amount/status/ngày/Order/Enrollment/bank/hoá đơn ⇒ [01]   |   nợ = 0 bằng hàm công nợ thật ⇒ [02]   |   idempotent ⇒ [03]
//   cổng ký (8 kiểu từ chối) + replay ⇒ [04] [10]   |   fail-closed (mọi điều kiện) ⇒ [05]   |   transaction toàn lô ⇒ [06]   |   drift ⇒ [07]   |   --expect / quyền ⇒ [08]
//   ghi lọt cột ngoài allowlist ⇒ [09]   |   kiểm sau ghi ⇒ [11]   |   khoá hàng ⇒ [12]   |   TƯƠNG ĐƯƠNG đường chuẩn (planner + executor) ⇒ [13]   |   không phát Receipt ⇒ [01]
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dungCongGhiThu, type TuyChinhCongGhi } from "@/tests/_helpers/cong-ghi-wave1";
import { CongGhiTuChoi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import type { ArtifactPheDuyet } from "@/lib/security/phe-duyet-ghi";
import {
  ACTOR_GAN_PAYMENT,
  anhChupBatBienGanPayment,
  chayPlannerChuan,
  docKeHoachGanPayment,
  ghiGanPayment,
  ghiGanPaymentTrongTx,
  kiemSauGhiGanPayment,
  type DauVaoGhiGanPayment,
} from "@/lib/nguon/gan-payment-ghi-danh-db";
import type { KeHoachGanPayment, MucGanPayment } from "@/lib/nguon/gan-payment-ghi-danh";
import { giaDichTuNiemYet } from "@/lib/nguon/sua-gia-ghi-danh";

if (!RUN_DB_TESTS) console.warn(`[GPD-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const P = "GPD_";
const CS1 = `${P}cs1`;
const CS2 = `${P}cs2`;
const KHOA3 = `${P}khoa3`;
const KHOA4 = `${P}khoa4`;
const LOP3 = `${P}lop3`;
const LOP4 = `${P}lop4`;
const MA = [0, 1, 2, 3, 4, 5].map((i) => `${P}ORD-${i}`);
const SO_KHOAN = [2, 1, 1, 1, 1, 3] as const;
const SCH = 4;
const id = (k: string, i: number) => `${P}${k}${i}`;
const idP = (i: number, k: number) => `${P}p${i}_${k}`;
const NIEM_YET = (i: number) => (i === SCH ? 11_520_000 : 10_560_000);
const DICH = (i: number) => giaDichTuNiemYet(NIEM_YET(i));
/** Chia giá đích thành SO_KHOAN[i] khoản; khoản cuối của đơn 0 và 5 là khoản nhỏ như PROD (180.000 / 9.000). */
const SO_TIEN = (i: number): number[] => {
  const g = DICH(i).finalPrice!;
  if (SO_KHOAN[i] === 1) return [g];
  if (i === 0) return [g - 180_000, 180_000];
  return [4_500_000, g - 4_500_000 - 9_000, 9_000];
};
// Bảng chỉ có SỐ ĐẾM + giá đích (như bảng cứng thật): id khoản / ghi danh / giao dịch ngân hàng do hàm DB ĐỌC từ fixture.
const BANG: Record<string, MucGanPayment> = Object.fromEntries(
  MA.map((m, i) => [m, { giaDich: DICH(i).finalPrice!, soKhoan: SO_KHOAN[i], soKhoanDaXoa: i === 2 ? 1 : 0, soKhoanTrongHoaDon: i === 0 ? 2 : 0 } satisfies MucGanPayment]),
);
const TONG_KHOAN = 9;
const MOC = new Date("2026-10-24T03:00:00.000Z");
const NGAY_THU = new Date("2026-08-20T03:00:00.000Z");
const LUOT = { batDauLuc: MOC, nguonChay: { actor: "a", triggeringActor: "b", runId: "9600001", runAttempt: "1" } } as const;
const nonceDaDung: string[] = [];

async function don() {
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: P } }, { id: { in: nonceDaDung.map((n) => `wg:${n}`) } }, { entityId: { startsWith: "luot:9600001" } }] } });
  for (const t of ["boom", "leak1", "leak2", "leak3"]) {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS gpd_${t}_trg ON "Payment"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS gpd_${t}()`);
  }
  await db.commissionLine.deleteMany({ where: { id: { startsWith: P } } });
  await db.receipt.deleteMany({ where: { id: { startsWith: P } } });
  await db.hoaDonKhoan.deleteMany({ where: { hoaDonId: { startsWith: P } } });
  await db.hoaDonDienTu.deleteMany({ where: { id: { startsWith: P } } });
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
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

/** Sáu đơn «hình dạng thật», ĐÃ qua PHASE A + B.1; khoản CONFIRMED chưa gắn ghi danh; giao dịch ngân hàng MATCHED. */
async function dung() {
  await don();
  await db.center.create({ data: { id: CS1, name: "Cơ sở GPD 1", slug: `${P}cs-1`, address: "x" } });
  await db.center.create({ data: { id: CS2, name: "Cơ sở GPD 2", slug: `${P}cs-2`, address: "y" } });
  await db.course.create({ data: { id: KHOA3, name: "Sata3 GPD", slug: `${P}sata3`, totalSessions: 48 } });
  await db.course.create({ data: { id: KHOA4, name: "Sata4 GPD", slug: `${P}sata4`, totalSessions: 48 } });
  await db.class.create({ data: { id: LOP3, name: "Lớp 3 GPD", courseId: KHOA3 } });
  await db.class.create({ data: { id: LOP4, name: "Lớp 4 GPD", courseId: KHOA4 } });
  for (let i = 0; i < 6; i++) {
    const phone = `098300000${i}`;
    const khoa = i === SCH ? KHOA4 : KHOA3;
    const dich = DICH(i);
    await db.lead.create({ data: { id: id("l", i), parentName: `PH GPD ${i}`, phone, status: "DA_DANG_KY", centerId: CS1 } });
    await db.leadChild.create({ data: { id: id("be", i), leadId: id("l", i), fullName: `Bé GPD ${i}` } });
    await db.student.create({ data: { id: id("s", i), name: `Bé GPD ${i}`, leadId: id("l", i), leadChildId: id("be", i), centerId: CS1, parentPhone: phone } });
    await db.enrollment.create({
      data: {
        id: id("e", i), studentId: id("s", i), classId: i === SCH ? LOP4 : LOP3, courseId: khoa, status: "ACTIVE", leadChildId: id("be", i), centerId: CS1,
        listPrice: dich.listPrice, discountType: dich.discountType, discountAmount: dich.discountAmount, tuition: dich.tuition, finalPrice: dich.finalPrice, notes: `ghi chú ${i}`,
      },
    });
    await db.order.create({
      data: {
        id: id("o", i), code: MA[i]!, type: "COURSE", status: "COMPLETED", customerName: `PH GPD ${i}`, customerPhone: phone, subtotal: NIEM_YET(i), discountAmount: dich.discountAmount!,
        discountPercent: 15, discountApprovalStatus: "APPROVED", totalAmount: dich.finalPrice!, leadId: id("l", i), leadChildId: id("be", i), centerId: CS1, studentId: id("s", i),
      },
    });
    await db.orderItem.create({
      data: {
        id: id("it", i), orderId: id("o", i), type: "COURSE_ENROLLMENT", itemName: "Khoá GPD", quantity: 1, unitPrice: NIEM_YET(i), totalPrice: NIEM_YET(i), metadata: { courseId: khoa },
        studentId: id("s", i), enrollmentId: id("e", i),
      },
    });
    await db.paymentRequest.create({ data: { id: id("pr", i), orderId: id("o", i), centerId: CS1, installmentNo: 0, amountDue: dich.finalPrice! } });
    for (const [k, so] of SO_TIEN(i).entries()) {
      const txn = `${P}txn${i}_${k}`;
      await db.payment.create({
        data: {
          id: idP(i, k), orderId: id("o", i), orderItemId: id("it", i), amount: so, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1,
          note: `Tiền về qua SEPAY ${txn} [auto:sepay:${txn}]`,
        },
      });
      await db.bankTransaction.create({ data: { id: id(`bt${k}_`, i), provider: "SEPAY", providerTxnId: txn, amount: so, transferredAt: NGAY_THU, status: "MATCHED", centerId: CS1 } });
      await db.paymentAllocation.create({ data: { bankTransactionId: id(`bt${k}_`, i), paymentRequestId: id("pr", i), amount: so } });
    }
  }
  // Khoản đã xoá mềm của đơn #2 (bản ghi nhận tự động trùng tiền, PENDING) — PHẢI GIỮ xoá, không gắn.
  await db.payment.create({
    data: {
      id: id("pxoa", 2), orderId: id("o", 2), orderItemId: id("it", 2), amount: DICH(2).finalPrice!, method: "auto", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "PENDING",
      centerId: CS1, deletedAt: new Date("2026-10-04T00:00:00Z"), note: "Ghi nhận tự động (xác nhận đơn) [auto:order-confirm]",
    },
  });
  // Hoá đơn điện tử đã xác nhận giữ 2 khoản của đơn #0.
  await db.hoaDonDienTu.create({ data: { id: id("hd", 0), orderId: id("o", 0), centerId: CS1, trangThai: "DA_XAC_NHAN", tongTien: DICH(0).finalPrice!, taoBoiId: `${P}nguoi` } });
  for (const k of [0, 1]) await db.hoaDonKhoan.create({ data: { hoaDonId: id("hd", 0), paymentId: idP(0, k), soTien: SO_TIEN(0)[k]!, hieuLuc: true } });
}

let demNonce = 0;
const CG = (kh: KeHoachGanPayment, o: Partial<TuyChinhCongGhi> = {}): DauVaoCongGhi => {
  const nonce = o.nonce ?? `9e71${String(++demNonce).padStart(28, "0")}`;
  nonceDaDung.push(nonce);
  return dungCongGhiThu(WORKFLOW_WAVE1.ganPaymentGhiDanh, kh.dongDauRa, { now: MOC, ...o, nonce }).cong;
};
const nhap = (kh: KeHoachGanPayment, congGhi: DauVaoCongGhi, o: Partial<DauVaoGhiGanPayment> = {}): DauVaoGhiGanPayment => ({
  bang: BANG, soDuyet: kh.ghi.length, ghiDuoc: true, actor: ACTOR_GAN_PAYMENT, luotChay: LUOT, congGhi, ...o,
});
const kehoach = () => docKeHoachGanPayment(db, BANG);
const tatCaPayment = () => db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } });
const khongGhiGi = async () => {
  const gan = await db.payment.count({ where: { orderId: { startsWith: P }, enrollmentId: { not: null } } });
  expect(gan, "không khoản nào được gắn").toBe(0);
};
const soClaim = () => db.auditLog.count({ where: { id: { in: nonceDaDung.map((n) => `wg:${n}`) } } });
const soAudit = (action: string) => db.auditLog.count({ where: { action, OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9600001" } }] } });
const bo = <T extends Record<string, unknown>>(r: T, ...k: string[]) => Object.fromEntries(Object.entries(r).filter(([x]) => !k.includes(x)));

describe.skipIf(!RUN_DB_TESTS)("[GPD-DB] gắn 9 khoản vào 6 ghi danh — Postgres thật", () => {
  beforeEach(async () => {
    await dung();
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[GPD-DB-00] fixture đúng hình dạng: 9 khoản chưa gắn, kế hoạch SẴN SÀNG GHI 9, không lỗi, nợ dự kiến 0, 2 khoản trong hoá đơn, khoản xoá mềm vẫn chưa gắn (đối chứng dương cho mọi ca dưới)", async () => {
    await khongGhiGi();
    const kh = await kehoach();
    expect(kh.loi).toEqual([]);
    expect(kh.ghi).toHaveLength(TONG_KHOAN);
    expect(kh.muc.every((m) => m.noDuKien === 0 && m.trangThai === "CHUA_GAN")).toBe(true);
    expect(kh.ghi.filter((g) => g.hoaDonId !== null)).toHaveLength(2);
    expect(kh.ghi.map((g) => g.paymentId)).not.toContain(id("pxoa", 2));
  });

  it("[GPD-DB-01] GHI: đúng 9 khoản đổi ĐÚNG MỘT cột `enrollmentId`; amount/status/ngày/ghi chú/dòng đơn KHÔNG đổi; không tách tiền; Order/OrderItem/Enrollment/bank/hoá đơn y nguyên; KHÔNG Receipt; audit từng khoản + lượt + claim", async () => {
    const payTruoc = await tatCaPayment();
    const orderTruoc = await db.order.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } });
    const enrTruoc = await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const btTruoc = await db.bankTransaction.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const hdTruoc = await db.hoaDonDienTu.findMany({ where: { id: { startsWith: P } } });
    const hdkTruoc = await db.hoaDonKhoan.findMany({ where: { hoaDonId: { startsWith: P } }, orderBy: { paymentId: "asc" } });
    const anhTruoc = await anhChupBatBienGanPayment(db, BANG);
    const kh = await kehoach();
    const r = await ghiGanPayment(db, nhap(kh, CG(kh)));
    expect(r).toMatchObject({ daGhi: 9, daGanHet: true, keHoachSha: kh.sha });

    const payNay = await tatCaPayment();
    expect(payNay).toHaveLength(payTruoc.length); // không tách, không tạo khoản mới
    for (const p of payNay) {
      const cu = payTruoc.find((x) => x.id === p.id)!;
      expect(bo(p, "enrollmentId", "updatedAt"), p.id).toEqual(bo(cu, "enrollmentId", "updatedAt"));
      const dich = MA.findIndex((_m, i) => p.orderId === id("o", i));
      const laXoa = p.id === id("pxoa", 2);
      expect(p.enrollmentId, p.id).toBe(laXoa ? null : id("e", dich));
    }
    expect(await db.order.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } })).toEqual(orderTruoc);
    expect(await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(enrTruoc);
    expect(await db.bankTransaction.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(btTruoc);
    expect(await db.hoaDonDienTu.findMany({ where: { id: { startsWith: P } } })).toEqual(hdTruoc);
    expect(await db.hoaDonKhoan.findMany({ where: { hoaDonId: { startsWith: P } }, orderBy: { paymentId: "asc" } })).toEqual(hdkTruoc);
    expect(await anhChupBatBienGanPayment(db, BANG)).toBe(anhTruoc);
    expect(await db.receipt.count({ where: { payment: { orderId: { startsWith: P } } } }), "KHÔNG phát Receipt").toBe(0);

    expect(await soAudit("UPDATE")).toBe(9);
    expect(await soAudit("GAN_PAYMENT_GHI_DANH_LUOT_CHAY")).toBe(1);
    expect(await soClaim()).toBe(1);
    const a = await db.auditLog.findFirstOrThrow({ where: { action: "UPDATE", entityId: idP(5, 2) } });
    expect(a.reason).toBe("Gắn khoản thu vào ghi danh theo đơn đã duyệt — chỉ đổi Payment.enrollmentId, không đổi số tiền / trạng thái / ngày thu");
    expect(a.oldValues).toEqual({ enrollmentId: null });
    expect(a.newValues).toMatchObject({ enrollmentId: id("e", 5), soTien: 9_000, maDon: MA[5], source: "wave1-gan-payment-ghi-danh" });
    expect(a.entityType).toBe("Payment");
    expect(a.module).toBe("finance");
    const luot = await db.auditLog.findFirstOrThrow({ where: { action: "GAN_PAYMENT_GHI_DANH_LUOT_CHAY" } });
    expect(luot.newValues).toMatchObject({ expectedCount: 9, actualCount: 9, khop: true, keHoachSha: kh.sha });
  });

  it("[GPD-DB-02] SAU khi gắn, công nợ = finalPrice − Σ khoản đã xác nhận gắn ghi danh = 0 ở CẢ 6 (đo bằng CHÍNH hàm công nợ + hàm thực thu của repo); TRƯỚC khi gắn thì nợ = finalPrice", async () => {
    const { computeEnrollmentDebt } = await import("@/lib/finance/debt");
    const noCuaGhiDanh = async (i: number) => {
      const e = await db.enrollment.findUniqueOrThrow({ where: { id: id("e", i) } });
      const pays = await db.payment.findMany({ where: { enrollmentId: id("e", i), deletedAt: null }, select: { amount: true, accountantStatus: true } });
      return computeEnrollmentDebt(e.finalPrice, pays, e.status);
    };
    for (let i = 0; i < 6; i++) expect(await noCuaGhiDanh(i), `trước · ghi danh ${i}`).toBe(DICH(i).finalPrice);
    const kh = await kehoach();
    await ghiGanPayment(db, nhap(kh, CG(kh)));
    for (let i = 0; i < 6; i++) expect(await noCuaGhiDanh(i), `sau · ghi danh ${i}`).toBe(0);
  });

  it("[GPD-DB-03] IDEMPOTENT: chạy lại sau khi ghi ⇒ 0 dòng ghi, KHÔNG qua cổng, KHÔNG claim, KHÔNG audit thêm — kể cả khi không có artifact", async () => {
    const kh = await kehoach();
    await ghiGanPayment(db, nhap(kh, CG(kh)));
    const dem = () => db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9600001" } }] } });
    const truocAudit = await dem();
    const claim = await soClaim();
    const ky2 = await kehoach();
    expect(ky2.daGanHet).toBe(true);
    expect(ky2.ghi).toEqual([]);
    const congRong: DauVaoCongGhi = { artifact: null, publicKeyPem: "", keyIdTinCay: "", moiTruong: "", ownerIdentities: null, now: MOC, runRef: "x" };
    const r = await ghiGanPayment(db, nhap(ky2, congRong, { soDuyet: 0 }));
    expect(r).toMatchObject({ daGhi: 0, daGanHet: true });
    expect(await dem()).toBe(truocAudit);
    expect(await soClaim()).toBe(claim);
  });

  it("[GPD-DB-04] CỔNG KÝ: thiếu artifact / ký cho workflow khác / ký cho dòng khác (digest) / sai môi trường / chưa ghim khoá / chữ ký sai / hết hạn / sai owner ⇒ từ chối TRƯỚC phép ghi, 0 khoản gắn, 0 claim", async () => {
    const kh = await kehoach();
    const cong0 = CG(kh);
    const CASES: Array<[string, DauVaoCongGhi, string]> = [
      ["thiếu artifact", { ...cong0, artifact: null }, "THIEU_ARTIFACT"],
      ["workflow khác", CG(kh, { workflowKy: WORKFLOW_WAVE1.suaGiaGhiDanh }), "SAI_WORKFLOW"],
      ["dòng khác (plan digest)", CG(kh, { rowsKy: kh.dongDauRa.slice(0, 8) }), "LECH_DIGEST"],
      ["môi trường", CG(kh, { moiTruongKy: "prod" }), "SAI_MOI_TRUONG"],
      ["chưa ghim khoá", { ...cong0, keyIdTinCay: "" }, "KHOA_KHONG_KHOP"],
      ["chữ ký sai (artifact bị sửa sau khi ký)", (() => {
        const a = cong0.artifact as ArtifactPheDuyet;
        return { ...cong0, artifact: { payload: { ...a.payload, ownerIdentity: "ke-gia-mao@satarobo.test" }, signature: a.signature } };
      })(), "SAI_CHU_KY"],
      ["artifact hết hạn", CG(kh, { nowCong: new Date(MOC.getTime() + 400 * 24 * 3600 * 1000) }), "HET_HAN"],
      ["owner không nằm trong danh sách chấp nhận", CG(kh, { ownerIdentities: ["nguoi-khac@satarobo.test"] }), "SAI_OWNER"],
    ];
    for (const [ten, cong, ma] of CASES) {
      const e = await ghiGanPayment(db, nhap(kh, cong)).then(() => null, (x: unknown) => x);
      expect(e, ten).toBeInstanceOf(CongGhiTuChoi);
      expect((e as CongGhiTuChoi).ma, ten).toBe(ma);
      await khongGhiGi();
    }
    expect(await soClaim()).toBe(0);
    expect(await soAudit("UPDATE")).toBe(0);
  });

  describe("[GPD-DB-05] FAIL-CLOSED: MỘT thứ lệch ⇒ không khoản nào trong 9 được gắn, không claim", () => {
    const CA: Array<[string, string, () => Promise<unknown>]> = [
      ["sai Order total", "TONG_DON_LECH", () => db.order.update({ where: { id: id("o", 3) }, data: { totalAmount: { increment: 1 } } })],
      ["sai số tiền một khoản (Σ ≠ giá đích)", "TIEN_PAYMENT_LECH", () => db.payment.update({ where: { id: idP(3, 0) }, data: { amount: { decrement: 1 } } })],
      ["sai số tiền một khoản (không khớp giao dịch)", "GIAO_DICH_LECH_SO_TIEN", () => db.payment.update({ where: { id: idP(3, 0) }, data: { amount: { decrement: 1 } } })],
      ["giao dịch ngân hàng lệch số tiền so với khoản", "GIAO_DICH_LECH_SO_TIEN", () => db.bankTransaction.update({ where: { id: id("bt0_", 3) }, data: { amount: { increment: 1 } } })],
      ["sai phân bổ ngân hàng (Σ phân bổ của đơn)", "TIEN_PHAN_BO_LECH", () => db.paymentAllocation.update({ where: { bankTransactionId_paymentRequestId: { bankTransactionId: id("bt0_", 3), paymentRequestId: id("pr", 3) } }, data: { amount: { decrement: 1 } } })],
      ["sai phân bổ ngân hàng (phân bổ ≠ số tiền giao dịch)", "GIAO_DICH_PHAN_BO_LECH", () => db.paymentAllocation.update({ where: { bankTransactionId_paymentRequestId: { bankTransactionId: id("bt0_", 3), paymentRequestId: id("pr", 3) } }, data: { amount: { decrement: 1 } } })],
      ["giao dịch ngân hàng không còn MATCHED", "GIAO_DICH_KHONG_MATCHED", () => db.bankTransaction.update({ where: { id: id("bt1_", 5) }, data: { status: "UNMATCHED" } })],
      ["giao dịch còn phân bổ sang ĐƠN KHÁC (tổng phân bổ > phần vào đơn này)", "GIAO_DICH_PHAN_BO_LECH", () => db.paymentAllocation.create({ data: { bankTransactionId: id("bt0_", 4), paymentRequestId: id("pr", 0), amount: 1 } })],
      ["0 ứng viên: giao dịch của khoản không còn phân bổ vào đơn", "GIAO_DICH_KHONG_UNG_VIEN", () => db.paymentAllocation.deleteMany({ where: { bankTransactionId: id("bt0_", 4) } })],
      [">1 ứng viên: thêm giao dịch MATCHED thứ hai cùng số tiền, cùng phân bổ vào đơn", "GIAO_DICH_NHIEU_UNG_VIEN", async () => {
        await db.bankTransaction.create({ data: { id: id("btdup", 1), provider: "SEPAY", providerTxnId: `${P}txn_dup`, amount: SO_TIEN(1)[0]!, transferredAt: NGAY_THU, status: "MATCHED", centerId: CS1 } });
        await db.paymentAllocation.create({ data: { bankTransactionId: id("btdup", 1), paymentRequestId: id("pr", 1), amount: SO_TIEN(1)[0]! } });
      }],
      ["giao dịch thừa: MATCHED, có phân bổ vào đơn, nhưng không khớp khoản nào", "GIAO_DICH_THUA", async () => {
        await db.bankTransaction.create({ data: { id: id("btdup", 2), provider: "SEPAY", providerTxnId: `${P}txn_thua`, amount: 12_345, transferredAt: NGAY_THU, status: "MATCHED", centerId: CS1 } });
        await db.paymentAllocation.create({ data: { bankTransactionId: id("btdup", 2), paymentRequestId: id("pr", 1), amount: 12_345 } });
      }],
      ["giao dịch khác cơ sở với khoản", "GIAO_DICH_LECH_CO_SO", () => db.bankTransaction.update({ where: { id: id("bt0_", 1) }, data: { centerId: CS2 } })],
      ["ghi chú khoản khai MỘT mã giao dịch khác ứng viên duy nhất (tín hiệu phụ không khớp)", "GIAO_DICH_GHI_CHU_LECH", () => db.payment.update({ where: { id: idP(2, 0) }, data: { note: "Tiền về qua SEPAY [auto:sepay:GPD_ma_khac]" } })],
      ["khoản chưa được kế toán xác nhận", "PAYMENT_KHONG_XAC_NHAN", () => db.payment.update({ where: { id: idP(4, 0) }, data: { accountantStatus: "PENDING" } })],
      ["khoản là bút toán điều chỉnh", "PAYMENT_KHONG_PHAI_THU", () => db.payment.update({ where: { id: idP(4, 0) }, data: { paymentType: "ADJUSTMENT" } })],
      ["khoản đã gắn SAI ghi danh", "PAYMENT_GAN_SAI_GHI_DANH", () => db.payment.update({ where: { id: idP(3, 0) }, data: { enrollmentId: id("e", 2) } })],
      ["lô lai: một khoản đã gắn đúng, khoản kia chưa", "LO_HON_HOP", () => db.payment.update({ where: { id: idP(5, 0) }, data: { enrollmentId: id("e", 5) } })],
      ["khoản đã có enrollmentId của ghi danh KHÁC", "PAYMENT_GAN_SAI_GHI_DANH", () => db.payment.update({ where: { id: idP(1, 0) }, data: { enrollmentId: id("e", 4) } })],
      ["khoản không còn trỏ dòng đơn", "PAYMENT_LECH_DONG_DON", () => db.payment.update({ where: { id: idP(1, 0) }, data: { orderItemId: null } })],
      ["khoản khác cơ sở với đơn", "PAYMENT_LECH_CO_SO", () => db.payment.update({ where: { id: idP(1, 0) }, data: { centerId: CS2 } })],
      ["thêm một khoản sống ngoài bảng", "TAP_PAYMENT_LECH", () => db.payment.create({ data: { id: id("pla", 1), orderId: id("o", 1), orderItemId: id("it", 1), amount: 1, method: "x", paidDate: NGAY_THU, centerId: CS1 } })],
      ["khoản đã xoá mềm bị khôi phục", "TAP_PAYMENT_LECH", () => db.payment.update({ where: { id: id("pxoa", 2) }, data: { deletedAt: null } })],
      ["khoản đã xoá mềm bị gắn ghi danh", "PAYMENT_XOA_LECH", () => db.payment.update({ where: { id: id("pxoa", 2) }, data: { enrollmentId: id("e", 2) } })],
      ["giá ghi danh chưa chuẩn (PHASE B.1 chưa chạy)", "GIA_GHI_DANH_CHUA_CHUAN", () => db.enrollment.update({ where: { id: id("e", 3) }, data: { finalPrice: 10_560_000, tuition: 10_560_000, discountType: null, discountAmount: 0 } })],
      ["ghi danh không ACTIVE", "GHI_DANH_KHONG_ACTIVE", () => db.enrollment.update({ where: { id: id("e", 3) }, data: { status: "COMPLETED" } })],
      ["chưa qua PHASE A", "DON_CHUA_GAN_DANH_TINH", () => db.orderItem.update({ where: { id: id("it", 3) }, data: { enrollmentId: null } })],
      ["đơn đã xoá mềm", "DON_DA_XOA", () => db.order.update({ where: { id: id("o", 3) }, data: { deletedAt: new Date("2026-10-05T12:00:00Z") } })],
      ["hoá đơn nhả một khoản", "HOA_DON_LECH", () => db.hoaDonKhoan.deleteMany({ where: { hoaDonId: id("hd", 0), paymentId: idP(0, 1) } })],
      ["đã có Receipt cho khoản", "CO_TAC_DUNG_PHU", () => db.receipt.create({ data: { id: id("rc", 1), code: `${P}RCP-1`, paymentId: idP(1, 0) } })],
      ["có dòng hoa hồng liên quan", "CO_TAC_DUNG_PHU", async () => {
        const st = await db.commissionStatement.upsert({ where: { period: "2099-08" }, create: { period: "2099-08", status: "DRAFT" }, update: {} });
        await db.commissionLine.create({ data: { id: id("hh", 3), statementId: st.id, recipientId: id("s", 3), tier: "SALE", amount: 1, leadId: id("l", 3) } as never });
      }],
      ["Payment NGOÀI bảng đã gắn ghi danh đích", "GHI_DANH_CO_PAYMENT_NGOAI", async () => {
        await db.order.create({ data: { id: id("oX", 4), code: `${P}ORD-X`, type: "COURSE", status: "COMPLETED", customerName: "X", customerPhone: "0983999999", subtotal: 1, totalAmount: 1, centerId: CS1 } });
        await db.payment.create({ data: { id: id("pX", 4), orderId: id("oX", 4), amount: 1, method: "x", paidDate: NGAY_THU, centerId: CS1, enrollmentId: id("e", 4) } });
      }],
    ];
    it.each(CA)("%s ⇒ %s", async (_ten, ma, lamLech) => {
      const kh = await kehoach();
      const cong = CG(kh);
      try {
        await lamLech();
        const e = await ghiGanPayment(db, nhap(kh, cong)).then(() => null, (x: unknown) => x);
        expect(String(e)).toMatch(/DỪNG/);
        expect(String(e)).toContain(ma);
        const nay = await docKeHoachGanPayment(db, BANG);
        expect(nay.ghi, "kế hoạch lệch ⇒ không dòng ghi nào").toEqual([]);
        // Không khoản nào được gắn THÊM (ca "lô lai"/"gắn sai" chủ động đã gắn sẵn đúng 1 khoản).
        const gan = await db.payment.findMany({ where: { orderId: { startsWith: P }, enrollmentId: { not: null } }, select: { id: true } });
        expect(gan.length, "số khoản gắn không tăng").toBeLessThanOrEqual(ma === "LO_HON_HOP" || ma === "PAYMENT_GAN_SAI_GHI_DANH" || ma === "PAYMENT_XOA_LECH" || ma === "GHI_DANH_CO_PAYMENT_NGOAI" ? 1 : 0);
        expect(await soClaim()).toBe(0);
        expect(await soAudit("UPDATE")).toBe(0);
      } finally {
        await db.commissionLine.deleteMany({ where: { id: id("hh", 3) } });
        await db.commissionStatement.deleteMany({ where: { period: "2099-08", lines: { none: {} } } }).catch(() => undefined);
      }
    });
  });

  it("[GPD-DB-05b] ANH/CHỊ/EM cùng SĐT phụ huynh học CÙNG lớp/khoá/giá KHÔNG làm khoản rơi sang bé kia: planner chuẩn vẫn ra GAN một mảnh → ĐÚNG bé của dòng đơn, và lượt ghi gắn đúng ghi danh của bé đó", async () => {
    // Bé thứ hai cùng phụ huynh (cùng SĐT) của đơn #3, CÙNG lớp/khoá/finalPrice ⇒ planner thấy 2 ghi danh ứng viên. Dòng đơn mang `studentId` của bé thật nên chỉ ghi danh của bé đó được chọn.
    await db.student.create({ data: { id: id("sx", 3), name: "Anh/chị em GPD", centerId: CS1, parentPhone: "0983000003" } });
    await db.enrollment.create({ data: { id: id("ex", 3), studentId: id("sx", 3), classId: LOP3, courseId: KHOA3, status: "ACTIVE", centerId: CS1, listPrice: 10_560_000, tuition: 8_976_000, finalPrice: 8_976_000 } });
    // Đối chứng dương: planner THẤY cả hai học viên (nếu không, ca này không chứng minh gì).
    expect(await db.student.count({ where: { parentPhone: "0983000003", deletedAt: null } })).toBe(2);
    expect(await db.enrollment.count({ where: { studentId: { in: [id("s", 3), id("sx", 3)] }, deletedAt: null } })).toBe(2);
    const chuan = await chayPlannerChuan(db, id("o", 3));
    expect(chuan.ketQua).toHaveLength(1);
    expect(chuan.ketQua[0]).toMatchObject({ ketQua: "GAN", soPhan: 1, enrollmentId: id("e", 3), giuNguyenTien: true });
    const kh = await kehoach();
    expect(kh.loi).toEqual([]);
    await ghiGanPayment(db, nhap(kh, CG(kh)));
    expect((await db.payment.findUniqueOrThrow({ where: { id: idP(3, 0) } })).enrollmentId).toBe(id("e", 3));
    expect(await db.payment.count({ where: { enrollmentId: id("ex", 3) } }), "không khoản nào rơi sang bé kia").toBe(0);
  });

  it("[GPD-DB-05d] Payment XOÁ MỀM của đơn KHÁC đang gắn ghi danh đích KHÔNG chặn lô (không vào công nợ); khoản SỐNG cùng hình dạng vẫn chặn (GHI_DANH_CO_PAYMENT_NGOAI)", async () => {
    // Hình dạng PROD đo 25/10: bút toán backfill cũ của đơn khác, đã xoá mềm, còn trỏ ghi danh đích.
    await db.order.create({ data: { id: id("oX", 5), code: `${P}ORD-XD`, type: "COURSE", status: "COMPLETED", customerName: "X", customerPhone: "0983999998", subtotal: 1, totalAmount: 1, centerId: CS1 } });
    await db.payment.create({ data: { id: id("pX", 5), orderId: id("oX", 5), amount: 1, method: "x", paidDate: NGAY_THU, centerId: CS1, enrollmentId: id("e", 4), deletedAt: new Date("2026-10-05T12:00:00Z") } });
    // Đối chứng dương: khoản xoá mềm ấy CÓ thật và CÓ trỏ ghi danh đích (nếu không, ca này không chứng minh gì).
    expect(await db.payment.count({ where: { id: id("pX", 5), enrollmentId: id("e", 4), deletedAt: { not: null } } })).toBe(1);
    const kh = await kehoach();
    expect(kh.loi).toEqual([]);
    expect(kh.ghi.length).toBeGreaterThan(0);
    await ghiGanPayment(db, nhap(kh, CG(kh)));
    expect((await db.payment.findUniqueOrThrow({ where: { id: id("pX", 5) } })).deletedAt, "khoản xoá mềm của đơn khác không bị đụng").not.toBeNull();
    // Khoản SỐNG cùng hình dạng vẫn chặn: ca «Payment NGOÀI bảng đã gắn ghi danh đích» trong bảng CA phía trên.
    expect((await db.payment.findUniqueOrThrow({ where: { id: id("pX", 5) } })).enrollmentId).toBe(id("e", 4));
  });

  it("[GPD-DB-05c] ứng viên giao dịch ngân hàng suy từ DỮ LIỆU: dòng ký mang mã giao dịch ĐỌC từ DB; ghi chú KHÔNG khai mã (null) vẫn hợp lệ (tín hiệu phụ), và đổi mã trong DB làm dòng ký đổi theo", async () => {
    const kh0 = await kehoach();
    expect(kh0.loi).toEqual([]);
    expect(kh0.ghi.find((g) => g.paymentId === idP(3, 0))!.providerTxnId).toBe(`${P}txn3_0`);
    await db.payment.update({ where: { id: idP(3, 0) }, data: { note: null } });
    await db.bankTransaction.update({ where: { id: id("bt0_", 3) }, data: { providerTxnId: `${P}txn_doi` } });
    const kh = await kehoach();
    expect(kh.loi, "ghi chú vắng ⇒ không phải căn cứ dừng").toEqual([]);
    expect(kh.ghi.find((g) => g.paymentId === idP(3, 0))!.providerTxnId).toBe(`${P}txn_doi`);
    expect(kh.sha).not.toBe(kh0.sha);
    await ghiGanPayment(db, nhap(kh, CG(kh)));
    expect((await db.payment.findUniqueOrThrow({ where: { id: idP(3, 0) } })).enrollmentId).toBe(id("e", 3));
  });

  it("[GPD-DB-06] TRANSACTION TOÀN LÔ: lỗi ở khoản cuối (trigger ném khi UPDATE khoản #9) ⇒ 8 khoản đã gắn trước đó cũng LÙI; claim lùi theo", async () => {
    await db.$executeRawUnsafe(`CREATE FUNCTION gpd_boom() RETURNS trigger AS $f$ BEGIN RAISE EXCEPTION 'GPD_BOOM'; END $f$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER gpd_boom_trg BEFORE UPDATE ON "Payment" FOR EACH ROW WHEN (NEW.id = '${idP(5, 2)}') EXECUTE FUNCTION gpd_boom()`);
    const kh = await kehoach();
    const e = await ghiGanPayment(db, nhap(kh, CG(kh))).then(() => null, (x: unknown) => x);
    expect(String(e)).toMatch(/GPD_BOOM/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
    expect(await soAudit("UPDATE")).toBe(0);
    expect(await soAudit("GAN_PAYMENT_GHI_DANH_LUOT_CHAY")).toBe(0);
  });

  it("[GPD-DB-07] DRIFT giữa kế hoạch và ghi (có người vừa sửa số tiền một khoản) ⇒ cổng TRONG tx bắt (TIEN_PAYMENT_LECH + GIAO_DICH_LECH_SO_TIEN), cả lô lùi", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await db.payment.update({ where: { id: idP(3, 0) }, data: { amount: { increment: 1 } } });
    const e = await db.$transaction((tx) => ghiGanPaymentTrongTx(tx, nhap(kh, cong))).then(() => null, (x: unknown) => x);
    expect(String(e)).toMatch(/TIEN_PAYMENT_LECH/);
    expect(String(e)).toMatch(/GIAO_DICH_LECH_SO_TIEN/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[GPD-DB-08] SAI --expect (8 thay vì 9) / thiếu quyền ghi / thiếu --expect ⇒ từ chối TRƯỚC khi mở transaction ghi", async () => {
    const kh = await kehoach();
    await expect(ghiGanPayment(db, nhap(kh, CG(kh), { soDuyet: 8 }))).rejects.toThrow(/≠ kế hoạch/);
    await expect(ghiGanPayment(db, nhap(kh, CG(kh), { soDuyet: null }))).rejects.toThrow(/đòi --expect/);
    await expect(ghiGanPayment(db, nhap(kh, CG(kh), { ghiDuoc: false }))).rejects.toThrow(/không có quyền UPDATE/);
    await expect(ghiGanPayment(db, nhap(kh, CG(kh), { ghiDuoc: null }))).rejects.toThrow(/Không kiểm được/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[GPD-DB-09] ALLOWLIST CỘT: nếu phép ghi VÔ TÌNH kéo theo đổi thứ NGOÀI allowlist (trigger đổi `note`/`amount` của chính khoản; đổi `notes` của ghi danh; đổi ghi chú giao dịch ngân hàng) ⇒ ảnh chụp sau ≠ trước ⇒ throw, cả lô lùi", async () => {
    const CASES = [
      ["note khoản", `UPDATE "Payment" SET note = 'bi-sua' WHERE id = NEW.id`],
      ["amount khoản", `UPDATE "Payment" SET amount = amount + 1 WHERE id = NEW.id`],
      ["notes ghi danh", `UPDATE "Enrollment" SET notes = 'bi-sua' WHERE id = NEW."enrollmentId"`],
      ["ghi chú bank", `UPDATE "BankTransaction" SET "unmatchedNote" = 'bi-sua' WHERE "providerTxnId" LIKE '${P}txn%'`],
      ["tên khách trên Order", `UPDATE "Order" SET "customerName" = 'bi-sua' WHERE id = NEW."orderId"`],
      ["dòng đơn", `UPDATE "OrderItem" SET "itemName" = 'bi-sua' WHERE id = NEW."orderItemId"`],
      ["phiếu yêu cầu", `UPDATE "PaymentRequest" SET "amountDue" = "amountDue" + 1 WHERE "orderId" = NEW."orderId"`],
      ["phân bổ (cột ngoài số tiền)", `UPDATE "PaymentAllocation" SET "roundingWaived" = 1 WHERE "paymentRequestId" IN (SELECT id FROM "PaymentRequest" WHERE "orderId" = NEW."orderId")`],
      ["hoá đơn", `UPDATE "HoaDonDienTu" SET "tongTien" = "tongTien" + 1 WHERE "orderId" = NEW."orderId"`],
      ["dòng nối hoá đơn", `UPDATE "HoaDonKhoan" SET "soTien" = "soTien" + 1 WHERE "paymentId" = NEW.id`],
    ] as const;
    for (const [ten, than] of CASES) {
      await dung();
      await db.$executeRawUnsafe(`CREATE FUNCTION gpd_leak1() RETURNS trigger AS $f$ BEGIN IF pg_trigger_depth() < 2 THEN ${than}; END IF; RETURN NEW; END $f$ LANGUAGE plpgsql`);
      await db.$executeRawUnsafe(`CREATE TRIGGER gpd_leak1_trg AFTER UPDATE ON "Payment" FOR EACH ROW EXECUTE FUNCTION gpd_leak1()`);
      const kh = await kehoach();
      const e = await ghiGanPayment(db, nhap(kh, CG(kh))).then(() => null, (x: unknown) => x);
      expect(String(e), ten).toMatch(/Ảnh chụp bất biến|không ra «cả lô đã gắn đúng»/);
      await khongGhiGi();
      expect(await soClaim(), ten).toBe(0);
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS gpd_leak1_trg ON "Payment"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS gpd_leak1()`);
    }
    // 10 kiểu rò × (dựng lại fixture + một lượt ghi bị lùi) vượt trần 5 giây mặc định khi ba bộ Postgres chạy song song; trần riêng, không đổi cấu hình chung.
  }, 120_000);

  it("[GPD-DB-10] REPLAY: dùng lại ĐÚNG artifact đã dùng (đưa khoản về chưa gắn) ⇒ DA_DUNG, 0 khoản được gắn lần hai", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await ghiGanPayment(db, nhap(kh, cong));
    await db.payment.updateMany({ where: { orderId: { startsWith: P } }, data: { enrollmentId: null } });
    const kh2 = await kehoach();
    expect(kh2.dongDauRa).toEqual(kh.dongDauRa);
    const e = await ghiGanPayment(db, nhap(kh2, cong)).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(CongGhiTuChoi);
    expect((e as CongGhiTuChoi).ma).toBe("DA_DUNG");
    await khongGhiGi();
  });

  it("[GPD-DB-11] KIỂM SAU GHI: trước ghi ⇒ chưa đạt; sau ghi ⇒ 9/9 gắn đúng, khoản xoá mềm chưa gắn; gắn nhầm khoản xoá mềm thì kiểm sau ghi THẤY", async () => {
    const truoc = await kiemSauGhiGanPayment(db, BANG);
    expect(truoc.keHoach.daGanHet).toBe(false);
    expect(truoc.paymentDaGan).toBe(0);
    const kh = await kehoach();
    await ghiGanPayment(db, nhap(kh, CG(kh)));
    const sau = await kiemSauGhiGanPayment(db, BANG);
    expect(sau.keHoach.dung).toBe(false);
    expect(sau.keHoach.daGanHet).toBe(true);
    expect(sau.paymentDaGan).toBe(TONG_KHOAN);
    expect(sau.tongKhoanBang).toBe(TONG_KHOAN);
    expect(sau.xoaMemDaGan).toBe(0);
    await db.payment.update({ where: { id: id("pxoa", 2) }, data: { enrollmentId: id("e", 2) } });
    const lech = await kiemSauGhiGanPayment(db, BANG);
    expect(lech.xoaMemDaGan).toBe(1);
    expect(lech.keHoach.dung).toBe(true);
  });

  it.each(["Order", "OrderItem", "Enrollment", "Payment"] as const)(
    "[GPD-DB-12] KHOÁ HÀNG %s: lượt ghi PHẢI chờ khoá hàng (FOR UPDATE) — người khác đang giữ khoá ⇒ hết thời gian chờ, cả lô lùi, 0 claim",
    async (bang) => {
      const kh = await kehoach();
      const cong = CG(kh);
      const giu = bang === "Order" ? id("o", 2) : bang === "OrderItem" ? id("it", 2) : bang === "Enrollment" ? id("e", 2) : idP(2, 0);
      let loi: unknown = null;
      await db.$transaction(
        async (tx1) => {
          await tx1.$queryRawUnsafe(`SELECT id FROM "${bang}" WHERE id = '${giu}' FOR UPDATE`);
          loi = await db
            .$transaction(async (tx2) => {
              await tx2.$executeRawUnsafe(`SET LOCAL lock_timeout = '1500ms'`);
              return ghiGanPaymentTrongTx(tx2, nhap(kh, cong));
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

  it("[GPD-DB-13] TƯƠNG ĐƯƠNG ĐƯỜNG CHUẨN: (a) planner của tầng DB cho CÙNG kết quả với `napGanGhiDanhCuaDon` + `lapKeHoachGanGhiDanh` thật ở cả 6 đơn; (b) khoản gắn bằng script có CÙNG trạng thái cuối và CÙNG khoá audit với `thucHienKeHoachGan` thật", async () => {
    const { napGanGhiDanhCuaDon, thucHienKeHoachGan } = await import("@/lib/finance/payment");
    const { lapKeHoachGanGhiDanh } = await import("@/lib/finance/ke-hoach-gan-ghi-danh");
    const thatCuaDon = async (c: PrismaClient | Parameters<typeof napGanGhiDanhCuaDon>[0], i: number) => {
      const du = (await napGanGhiDanhCuaDon(c as never, id("o", i)))!;
      const kh = lapKeHoachGanGhiDanh({ khoan: du.khoan, dongDon: du.dongDon, ghiDanh: du.ghiDanh, coHocVien: du.coHocVien, daKhoa: du.daKhoa, trongTam: () => true });
      return { du, kh };
    };
    // (a) planner
    for (let i = 0; i < 6; i++) {
      const that = await thatCuaDon(db, i);
      const minh = await chayPlannerChuan(db, id("o", i));
      const chuanHoaThat = that.kh.dong.map((d) => (d.ketQua === "BO_QUA" ? { id: d.paymentId, k: "BO_QUA", e: null, a: null } : { id: d.paymentId, k: d.ketQua, e: d.phan[0]?.enrollmentId ?? null, a: d.phan[0]?.amount ?? null })).sort((x, y) => x.id.localeCompare(y.id));
      const chuanHoaMinh = minh.ketQua.map((r) => ({ id: r.paymentId, k: r.ketQua, e: r.enrollmentId, a: r.amount })).sort((x, y) => x.id.localeCompare(y.id));
      expect(chuanHoaMinh, `đơn ${i}`).toEqual(chuanHoaThat);
      expect(chuanHoaThat.every((r) => r.k === "GAN"), `đơn ${i} planner thật ra GAN`).toBe(true);
    }
    // (b) executor thật trên đơn #1 (một khoản), trong transaction RỒI LÙI — chụp trạng thái cuối + audit.
    const ROLLBACK = "GPD_ROLLBACK_PARITY";
    const luu: { v: { payment: Record<string, unknown>; audit: Array<Record<string, unknown>> } | null } = { v: null };
    await db
      .$transaction(async (tx) => {
        const { du, kh } = await thatCuaDon(tx as never, 1);
        const kq = await thucHienKeHoachGan(tx as never, du, kh, ACTOR_GAN_PAYMENT as never, "parity-chuan");
        expect(kq).toMatchObject({ linked: 1, splitCreated: 0, doi: [] });
        const p = await tx.payment.findUniqueOrThrow({ where: { id: idP(1, 0) } });
        const au = await tx.auditLog.findMany({ where: { entityType: "Payment", entityId: idP(1, 0) } });
        luu.v = { payment: p as never, audit: au as never };
        throw new Error(ROLLBACK);
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error) || e.message !== ROLLBACK) throw e;
      });
    await khongGhiGi(); // executor thật đã lùi
    expect(luu.v).not.toBeNull();
    const kh = await kehoach();
    await ghiGanPayment(db, nhap(kh, CG(kh)));
    const minh = await db.payment.findUniqueOrThrow({ where: { id: idP(1, 0) } });
    const auMinh = await db.auditLog.findMany({ where: { entityType: "Payment", entityId: idP(1, 0) } });
    const t = luu.v!;
    expect(bo(minh as never, "updatedAt"), "cùng trạng thái cuối của khoản (trừ updatedAt)").toEqual(bo(t.payment, "updatedAt"));
    expect(auMinh).toHaveLength(t.audit.length);
    expect(auMinh[0]).toMatchObject({ module: t.audit[0]!.module, entityType: t.audit[0]!.entityType, action: t.audit[0]!.action });
    expect((auMinh[0]!.newValues as Record<string, unknown>).enrollmentId).toBe((t.audit[0]!.newValues as Record<string, unknown>).enrollmentId);
    expect((auMinh[0]!.oldValues as Record<string, unknown>).enrollmentId).toBe((t.audit[0]!.oldValues as Record<string, unknown>).enrollmentId);
  });
});
