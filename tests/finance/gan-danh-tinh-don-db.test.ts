// tests/finance/gan-danh-tinh-don-db.test.ts — [GDD-DB-*] «gắn danh tính cho 6 đơn sống» trên Postgres THẬT: đọc → kế hoạch → cổng Wave 1 → ghi → kiểm sau ghi.
//
// Chạy:  pnpm test:finance-db   (hoặc `vitest run -c vitest.db.config.ts tests/finance/gan-danh-tinh-don-db.test.ts`). `pnpm test:unit` trần SKIP — log «SKIP» nghĩa là CHƯA kiểm gì.
// Khoá EPHEMERAL sinh lúc chạy; môi trường `test`. Fixture tiền tố `GDD_`; KHÔNG `resetDb()`; mọi hàm DB nhận PHẠM VI = đúng 6 mã đơn fixture (không phải 6 mã thật).
//
// Ánh xạ yêu cầu của chủ dự án (24/10/2026) → ca:
//   scope cứng · fail-closed · cả lô một transaction ⇒ [02] [05] [06] [07] [08] [09]   |   Order sống / studentId NULL / đúng 1 dòng / khớp lead·bé·cơ sở·khoá ⇒ [05]+unit [GDD-1x..3x]
//   Enrollment ACTIVE + chưa bị dòng khác dùng ⇒ [07] + unit   |   Σ Payment = tổng đơn = phân bổ ngân hàng ⇒ [05]   |   audit trước/sau ⇒ [01]
//   idempotent: chạy lại 0 dòng ghi ⇒ [03]   |   chữ ký/nonce/replay ⇒ [04] [10]   |   KHÔNG đụng Payment/giá/total/leadId ⇒ [01] [09]
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dungCongGhiThu, type TuyChinhCongGhi } from "@/tests/_helpers/cong-ghi-wave1";
import { CongGhiTuChoi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import {
  ACTOR_GAN_DANH_TINH,
  anhChupBatBien,
  docKeHoachGanDanhTinh,
  ghiGanDanhTinh,
  ghiGanDanhTinhTrongTx,
  kiemSauGhiGanDanhTinh,
  type DauVaoGhiGanDanhTinh,
} from "@/lib/nguon/gan-danh-tinh-don-db";
import type { KeHoachGanDanhTinh } from "@/lib/nguon/gan-danh-tinh-don";

if (!RUN_DB_TESTS) console.warn(`[GDD-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const P = "GDD_";
const CS1 = `${P}cs1`;
const CS2 = `${P}cs2`;
const KHOA = `${P}khoa`;
const LOP = `${P}lop`;
const MA = [0, 1, 2, 3, 4, 5].map((i) => `${P}ORD-${i}`);
const id = (k: string, i: number) => `${P}${k}${i}`;
const MOC = new Date("2026-10-24T03:00:00.000Z");
const NGAY_THU = new Date("2026-08-20T03:00:00.000Z");
const TONG = 8_976_000;
const LUOT = { batDauLuc: MOC, nguonChay: { actor: "a", triggeringActor: "b", runId: "9400001", runAttempt: "1" } } as const;
const nonceDaDung: string[] = [];

async function don() {
  const dongIds = { in: [0, 1, 2, 3, 4, 5].map((i) => id("it", i)) };
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: P } }, { id: { in: nonceDaDung.map((n) => `wg:${n}`) } }, { entityId: { startsWith: "luot:9400001" } }] } });
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS gdd_boom_trg ON "OrderItem"`);
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS gdd_leak_trg ON "OrderItem"`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS gdd_boom()`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS gdd_leak()`);
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { startsWith: P } } } });
  await db.bankTransaction.deleteMany({ where: { id: { startsWith: P } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { startsWith: P } } });
  await db.payment.deleteMany({ where: { orderId: { startsWith: P } } });
  await db.orderItem.deleteMany({ where: { id: dongIds } });
  await db.order.deleteMany({ where: { id: { startsWith: P } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: P } } });
  await db.student.deleteMany({ where: { id: { startsWith: P } } });
  await db.leadChild.deleteMany({ where: { id: { startsWith: P } } });
  await db.lead.deleteMany({ where: { id: { startsWith: P } } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

/** Sáu đơn «hình dạng thật»: đơn COMPLETED 8.976.000 (giảm 15% trên 10.560.000), chưa gắn gì; ghi danh ACTIVE giá 10.560.000; hai Payment sepay; phân bổ ngân hàng MATCHED. */
async function dung() {
  await don();
  await db.center.create({ data: { id: CS1, name: "Cơ sở GDT 1", slug: `${P}cs-1`, address: "x" } });
  await db.center.create({ data: { id: CS2, name: "Cơ sở GDT 2", slug: `${P}cs-2`, address: "y" } });
  await db.course.create({ data: { id: KHOA, name: "Sata3 GDT", slug: `${P}sata3`, totalSessions: 48 } });
  await db.class.create({ data: { id: LOP, name: "Lớp GDT", courseId: KHOA } });
  for (let i = 0; i < 6; i++) {
    const phone = `098100000${i}`;
    await db.lead.create({ data: { id: id("l", i), parentName: `PH GDT ${i}`, phone, status: "DA_DANG_KY", centerId: CS1 } });
    await db.leadChild.create({ data: { id: id("be", i), leadId: id("l", i), fullName: `Bé GDT ${i}` } });
    await db.student.create({ data: { id: id("s", i), name: `Bé GDT ${i}`, leadId: id("l", i), leadChildId: id("be", i), centerId: CS1, parentPhone: phone } });
    await db.enrollment.create({
      data: { id: id("e", i), studentId: id("s", i), classId: LOP, courseId: KHOA, status: "ACTIVE", listPrice: 10_560_000, tuition: 10_560_000, finalPrice: 10_560_000, leadChildId: id("be", i), centerId: CS1 },
    });
    await db.order.create({
      data: {
        id: id("o", i), code: MA[i]!, type: "COURSE", status: "COMPLETED", customerName: `PH GDT ${i}`, customerPhone: phone, subtotal: 10_560_000, discountAmount: 1_584_000, discountPercent: 15,
        totalAmount: TONG, leadId: id("l", i), leadChildId: id("be", i), centerId: CS1,
      },
    });
    await db.orderItem.create({
      data: { id: id("it", i), orderId: id("o", i), type: "COURSE_ENROLLMENT", itemName: "Sata3", quantity: 1, unitPrice: 10_560_000, totalPrice: 10_560_000, metadata: { courseId: KHOA, leadChildId: id("be", i) } },
    });
    // Payment tách đợt (4.476.000 + 4.500.000) — hình dạng của đơn thật có hai khoản.
    for (const [k, so] of [["a", 4_476_000], ["b", 4_500_000]] as const) {
      await db.payment.create({
        data: { id: id(`p${k}`, i), orderId: id("o", i), orderItemId: id("it", i), amount: so, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1 },
      });
    }
    await db.paymentRequest.create({ data: { id: id("pr", i), orderId: id("o", i), centerId: CS1, installmentNo: 0, amountDue: TONG } });
    await db.bankTransaction.create({
      data: { id: id("bt", i), provider: "SEPAY", providerTxnId: `${P}txn${i}`, amount: TONG, transferredAt: NGAY_THU, status: "MATCHED", centerId: CS1 },
    });
    await db.paymentAllocation.create({ data: { bankTransactionId: id("bt", i), paymentRequestId: id("pr", i), amount: TONG } });
  }
}

let demNonce = 0;
const CG = (kh: KeHoachGanDanhTinh, o: Partial<TuyChinhCongGhi> = {}): DauVaoCongGhi => {
  const nonce = o.nonce ?? `9d70${String(++demNonce).padStart(28, "0")}`;
  nonceDaDung.push(nonce);
  return dungCongGhiThu(WORKFLOW_WAVE1.ganDanhTinhDon, kh.dongDauRa, { now: MOC, ...o, nonce }).cong;
};
const nhap = (kh: KeHoachGanDanhTinh, congGhi: DauVaoCongGhi, o: Partial<DauVaoGhiGanDanhTinh> = {}): DauVaoGhiGanDanhTinh => ({
  maDon: MA, soDuyet: kh.ghi.length, ghiDuoc: true, actor: ACTOR_GAN_DANH_TINH, luotChay: LUOT, congGhi, ...o,
});
const kehoach = () => docKeHoachGanDanhTinh(db, MA);
const daLienKet = async () => ({
  order: await db.order.count({ where: { id: { startsWith: P }, studentId: { not: null } } }),
  dongStudent: await db.orderItem.count({ where: { id: { startsWith: `${P}it` }, studentId: { not: null } } }),
  dongEnrollment: await db.orderItem.count({ where: { id: { startsWith: `${P}it` }, enrollmentId: { not: null } } }),
});
const khongGhiGi = async () => expect(await daLienKet()).toEqual({ order: 0, dongStudent: 0, dongEnrollment: 0 });
const soClaim = () => db.auditLog.count({ where: { id: { in: nonceDaDung.map((n) => `wg:${n}`) } } });
const soAudit = (action: string) => db.auditLog.count({ where: { action, OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9400001" } }] } });

describe.skipIf(!RUN_DB_TESTS)("[GDD-DB] gắn danh tính 6 đơn — Postgres thật", () => {
  beforeEach(async () => {
    await dung();
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[GDD-DB-00] fixture đúng hình dạng: 6 đơn chưa gắn, kế hoạch SẴN SÀNG GHI 6, không lỗi (đối chứng dương cho mọi ca dưới)", async () => {
    await khongGhiGi();
    const kh = await kehoach();
    expect(kh.loi).toEqual([]);
    expect(kh.ghi).toHaveLength(6);
    expect(kh.ghi.map((g) => g.code)).toEqual(MA);
    for (let i = 0; i < 6; i++) expect(kh.ghi[i]).toMatchObject({ orderItemId: id("it", i), studentId: id("s", i), enrollmentId: id("e", i) });
    expect(await db.payment.count({ where: { orderId: { startsWith: P }, enrollmentId: { not: null } } })).toBe(0);
  });

  it("[GDD-DB-01] GHI: đúng 3 cột/đơn; Payment, tổng đơn, giá + giảm giá ghi danh, leadId KHÔNG đổi; audit trước/sau + dấu vết lượt + claim nonce", async () => {
    const truoc = await anhChupBatBien(db, MA);
    const payTruoc = await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } });
    const gdTruoc = await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const kh = await kehoach();
    const r = await ghiGanDanhTinh(db, nhap(kh, CG(kh)));
    expect(r).toMatchObject({ daGhi: 6, daGanHet: true, keHoachSha: kh.sha });

    for (let i = 0; i < 6; i++) {
      const o = await db.order.findUniqueOrThrow({ where: { id: id("o", i) }, include: { items: true } });
      expect(o.studentId).toBe(id("s", i));
      expect(o.items[0]).toMatchObject({ studentId: id("s", i), enrollmentId: id("e", i) });
      expect(o.totalAmount).toBe(TONG);
      expect(o.leadId).toBe(id("l", i));
    }
    // Bất biến: so từng dòng (không chỉ sha) — Payment, ghi danh.
    expect(await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(payTruoc);
    expect(await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(gdTruoc);
    expect(await anhChupBatBien(db, MA)).toBe(truoc);

    expect(await soAudit("GAN_DANH_TINH_DON")).toBe(6);
    expect(await soAudit("GAN_DANH_TINH_DON_LUOT_CHAY")).toBe(1);
    expect(await soClaim()).toBe(1);
    const a = await db.auditLog.findFirstOrThrow({ where: { action: "GAN_DANH_TINH_DON", entityId: id("o", 2) } });
    expect(a.oldValues).toMatchObject({ studentId: null, orderItemId: id("it", 2), orderItemStudentId: null, orderItemEnrollmentId: null });
    expect(a.newValues).toMatchObject({ studentId: id("s", 2), orderItemStudentId: id("s", 2), orderItemEnrollmentId: id("e", 2) });
    const luot = await db.auditLog.findFirstOrThrow({ where: { action: "GAN_DANH_TINH_DON_LUOT_CHAY" } });
    expect(luot.newValues).toMatchObject({ expectedCount: 6, actualCount: 6, khop: true, keHoachSha: kh.sha });
  });

  it("[GDD-DB-03] IDEMPOTENT: chạy lại sau khi ghi ⇒ 0 dòng ghi, KHÔNG qua cổng, KHÔNG claim, KHÔNG audit thêm — kể cả khi không có artifact", async () => {
    const kh = await kehoach();
    await ghiGanDanhTinh(db, nhap(kh, CG(kh)));
    const truocAudit = await db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9400001" } }] } });
    const claim = await soClaim();
    const ky2 = await kehoach();
    expect(ky2.daGanHet).toBe(true);
    expect(ky2.ghi).toEqual([]);
    const congRong: DauVaoCongGhi = { artifact: null, publicKeyPem: "", keyIdTinCay: "", moiTruong: "", ownerIdentities: null, now: MOC, runRef: "x" };
    const r = await ghiGanDanhTinh(db, nhap(ky2, congRong, { soDuyet: 0 }));
    expect(r).toMatchObject({ daGhi: 0, daGanHet: true });
    expect(await db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9400001" } }] } })).toBe(truocAudit);
    expect(await soClaim()).toBe(claim);
  });

  it("[GDD-DB-04] CỔNG KÝ: thiếu artifact / ký cho workflow khác / ký cho dòng khác / sai môi trường / khoá không ghim ⇒ từ chối TRƯỚC phép ghi đầu tiên, 0 đơn được gắn, 0 claim", async () => {
    const kh = await kehoach();
    const cong0 = CG(kh);
    const CASES: Array<[string, DauVaoCongGhi, string]> = [
      ["thiếu artifact", { ...cong0, artifact: null }, "THIEU_ARTIFACT"],
      ["workflow khác", CG(kh, { workflowKy: WORKFLOW_WAVE1.noiDon }), "SAI_WORKFLOW"],
      ["dòng khác", CG(kh, { rowsKy: kh.dongDauRa.slice(0, 5) }), "LECH_DIGEST"],
      ["môi trường", CG(kh, { moiTruongKy: "prod" }), "SAI_MOI_TRUONG"],
      ["chưa ghim khoá", { ...cong0, keyIdTinCay: "" }, "KHOA_KHONG_KHOP"],
    ];
    for (const [ten, cong, ma] of CASES) {
      const e = await ghiGanDanhTinh(db, nhap(kh, cong)).then(() => null, (x: unknown) => x);
      expect(e, ten).toBeInstanceOf(CongGhiTuChoi);
      expect((e as CongGhiTuChoi).ma, ten).toBe(ma);
      await khongGhiGi();
    }
    expect(await soClaim()).toBe(0);
    expect(await soAudit("GAN_DANH_TINH_DON")).toBe(0);
  });

  it("[GDD-DB-05] FAIL-CLOSED: MỘT đơn lệch (Payment thiếu 1đ) ⇒ không đơn nào trong 6 được gắn, không claim", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await db.payment.update({ where: { id: id("pb", 3) }, data: { amount: 4_499_999 } });
    const e = await ghiGanDanhTinh(db, nhap(kh, cong)).then(() => null, (x: unknown) => x);
    expect(String(e)).toMatch(/DỪNG/);
    expect(String(e)).toMatch(/TIEN_PAYMENT_LECH/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[GDD-DB-06] TRANSACTION TOÀN LÔ: lỗi ở đơn cuối (trigger ném khi UPDATE dòng đơn #5) ⇒ 5 đơn đã ghi trước đó cũng LÙI; claim lùi theo", async () => {
    await db.$executeRawUnsafe(`CREATE FUNCTION gdd_boom() RETURNS trigger AS $f$ BEGIN RAISE EXCEPTION 'GDD_BOOM'; END $f$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER gdd_boom_trg BEFORE UPDATE ON "OrderItem" FOR EACH ROW WHEN (NEW.id = '${id("it", 5)}') EXECUTE FUNCTION gdd_boom()`);
    const kh = await kehoach();
    const e = await ghiGanDanhTinh(db, nhap(kh, CG(kh))).then(() => null, (x: unknown) => x);
    expect(String(e)).toMatch(/GDD_BOOM/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
    expect(await soAudit("GAN_DANH_TINH_DON")).toBe(0);
    expect(await soAudit("GAN_DANH_TINH_DON_LUOT_CHAY")).toBe(0);
  });

  it("[GDD-DB-07] TRÔI TRẠNG THÁI giữa kế hoạch và ghi (đơn #3 vừa bị gắn học viên khác; một ghi danh bị dòng đơn khác trỏ vào) ⇒ cổng TRONG tx bắt, cả lô lùi", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await db.order.update({ where: { id: id("o", 3) }, data: { studentId: id("s", 0) } });
    let e = await db.$transaction((tx) => ghiGanDanhTinhTrongTx(tx, nhap(kh, cong))).then(() => null, (x: unknown) => x);
    expect(String(e)).toMatch(/TRANG_THAI_GAN_LECH/);
    await db.order.update({ where: { id: id("o", 3) }, data: { studentId: null } });
    await khongGhiGi();

    await db.orderItem.create({ data: { id: `${P}it-khac`, orderId: id("o", 4), type: "COURSE_ENROLLMENT", itemName: "dòng lạ", quantity: 1, unitPrice: 1, totalPrice: 1, enrollmentId: id("e", 2) } });
    const kh2 = await kehoach();
    expect(kh2.dung).toBe(true);
    e = await db.$transaction((tx) => ghiGanDanhTinhTrongTx(tx, nhap(kh, CG(kh)))).then(() => null, (x: unknown) => x);
    expect(String(e)).toMatch(/GHI_DANH_DA_BI_DUNG|SO_DONG_KHONG_DUNG/);
    await db.orderItem.delete({ where: { id: `${P}it-khac` } });
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[GDD-DB-08] SAI --expect (5 thay vì 6) / thiếu quyền ghi / kế hoạch DỪNG ⇒ từ chối TRƯỚC khi mở transaction ghi", async () => {
    const kh = await kehoach();
    await expect(ghiGanDanhTinh(db, nhap(kh, CG(kh), { soDuyet: 5 }))).rejects.toThrow(/≠ kế hoạch/);
    await expect(ghiGanDanhTinh(db, nhap(kh, CG(kh), { soDuyet: null }))).rejects.toThrow(/đòi --expect/);
    await expect(ghiGanDanhTinh(db, nhap(kh, CG(kh), { ghiDuoc: false }))).rejects.toThrow(/không có quyền UPDATE/);
    await expect(ghiGanDanhTinh(db, nhap(kh, CG(kh), { ghiDuoc: null }))).rejects.toThrow(/Không kiểm được/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[GDD-DB-09] BẤT BIẾN: nếu phép ghi VÔ TÌNH kéo theo đổi Payment.enrollmentId (trigger giả lập tác dụng phụ) ⇒ ảnh chụp sau ≠ trước ⇒ throw, cả lô lùi", async () => {
    await db.$executeRawUnsafe(
      `CREATE FUNCTION gdd_leak() RETURNS trigger AS $f$ BEGIN UPDATE "Payment" SET "enrollmentId" = NEW."enrollmentId" WHERE "orderItemId" = NEW.id; RETURN NEW; END $f$ LANGUAGE plpgsql`,
    );
    await db.$executeRawUnsafe(`CREATE TRIGGER gdd_leak_trg AFTER UPDATE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION gdd_leak()`);
    const kh = await kehoach();
    const e = await ghiGanDanhTinh(db, nhap(kh, CG(kh))).then(() => null, (x: unknown) => x);
    expect(String(e)).toMatch(/Ảnh chụp bất biến/);
    await khongGhiGi();
    expect(await db.payment.count({ where: { orderId: { startsWith: P }, enrollmentId: { not: null } } })).toBe(0);
    expect(await soClaim()).toBe(0);
  });

  it("[GDD-DB-10] REPLAY: dùng lại ĐÚNG artifact đã dùng (đưa dữ liệu về chưa gắn) ⇒ DA_DUNG, 0 đơn được gắn lần hai", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await ghiGanDanhTinh(db, nhap(kh, cong));
    // Đưa về «chưa gắn» để kế hoạch lại ra 6 dòng — giữ nguyên claim `wg:<nonce>` đã có.
    await db.orderItem.updateMany({ where: { id: { startsWith: `${P}it` } }, data: { studentId: null, enrollmentId: null } });
    await db.order.updateMany({ where: { id: { startsWith: P } }, data: { studentId: null } });
    const kh2 = await kehoach();
    expect(kh2.dongDauRa).toEqual(kh.dongDauRa);
    const e = await ghiGanDanhTinh(db, nhap(kh2, cong)).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(CongGhiTuChoi);
    expect((e as CongGhiTuChoi).ma).toBe("DA_DUNG");
    await khongGhiGi();
  });

  it("[GDD-DB-11] KIỂM SAU GHI: trước ghi ⇒ chưa đạt; sau ghi ⇒ cả lô đúng + Payment chưa gắn ghi danh = 0", async () => {
    const truoc = await kiemSauGhiGanDanhTinh(db, MA);
    expect(truoc.keHoach.daGanHet).toBe(false);
    const kh = await kehoach();
    await ghiGanDanhTinh(db, nhap(kh, CG(kh)));
    const sau = await kiemSauGhiGanDanhTinh(db, MA);
    expect(sau.keHoach.dung).toBe(false);
    expect(sau.keHoach.daGanHet).toBe(true);
    expect(sau.paymentDaGanGhiDanh).toBe(0);
    // Nếu ai đó gắn Payment vào ghi danh (việc của PHASE B), kiểm sau ghi phải THẤY.
    await db.payment.update({ where: { id: id("pa", 0) }, data: { enrollmentId: id("e", 0) } });
    expect((await kiemSauGhiGanDanhTinh(db, MA)).paymentDaGanGhiDanh).toBe(1);
  });
});
