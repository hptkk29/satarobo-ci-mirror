// tests/finance/gan-dong-don-theo-khoan-db.test.ts — [GDK-DB-*] «gắn dòng đơn ↔ ghi danh theo khoản thu đã gắn» trên Postgres THẬT: đọc → kế hoạch → cổng Wave 1 → ghi → kiểm sau ghi.
//
// Chạy:  pnpm test:finance-db   (hoặc `vitest run -c vitest.db.config.ts tests/finance/gan-dong-don-theo-khoan-db.test.ts`). `pnpm test:unit` trần SKIP — log «SKIP» nghĩa là CHƯA kiểm gì.
// Khoá EPHEMERAL sinh lúc chạy; môi trường `test`. Fixture tiền tố `GDK_`; KHÔNG `resetDb()`; mọi hàm DB nhận PHẠM VI = hai mục fixture (không phải mã thật).
// Fixture mang HÌNH DẠNG của ca thật: hai đơn nhập tay (không lead/bé), Payment `backfill` ĐÃ gắn dòng đơn + ghi danh, KHÔNG phiếu thu, KHÔNG phân bổ ngân hàng, dòng đơn chưa gắn.
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dungCongGhiThu, type TuyChinhCongGhi } from "@/tests/_helpers/cong-ghi-wave1";
import { WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import { ACTOR_GAN_DONG, anhChupBatBienGanDong, docKeHoachGanDong, ghiGanDong, ghiGanDongTrongTx, kiemSauGhiGanDong, type DauVaoGhiGanDong } from "@/lib/nguon/gan-dong-don-theo-khoan-db";
import type { KeHoachGanDong, MucPhamVi } from "@/lib/nguon/gan-dong-don-theo-khoan";

if (!RUN_DB_TESTS) console.warn(`[GDK-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const P = "GDK_";
const CS1 = `${P}cs1`;
const KHOA = `${P}khoa`;
const LOP = `${P}lop`;
const HV = `${P}hv`;
const GD = `${P}gd`;
const PV: readonly MucPhamVi[] = [
  { code: `${P}ORD-1`, orderItemId: `${P}it1`, studentId: HV, enrollmentId: GD, tongDon: 4_000_000 },
  { code: `${P}ORD-2`, orderItemId: `${P}it2`, studentId: HV, enrollmentId: GD, tongDon: 3_920_000 },
];
const MOC = new Date("2026-11-02T03:00:00.000Z");
const NGAY_THU = new Date("2026-08-30T00:00:00.000Z");
const LUOT = { batDauLuc: MOC, nguonChay: { actor: "a", triggeringActor: "b", runId: "9500001", runAttempt: "1" } } as const;
const nonceDaDung: string[] = [];

async function don() {
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: P } }, { id: { in: nonceDaDung.map((n) => `wg:${n}`) } }, { entityId: { startsWith: "luot:9500001" } }] } });
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS gdk_boom_trg ON "OrderItem"`);
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS gdk_leak_trg ON "OrderItem"`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS gdk_boom()`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS gdk_leak()`);
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { startsWith: P } } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { startsWith: P } } });
  await db.payment.deleteMany({ where: { orderId: { startsWith: P } } });
  await db.orderItem.deleteMany({ where: { orderId: { startsWith: P } } });
  await db.order.deleteMany({ where: { id: { startsWith: P } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: P } } });
  await db.student.deleteMany({ where: { id: { startsWith: P } } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.center.deleteMany({ where: { id: CS1 } });
}

async function dung() {
  await don();
  await db.center.create({ data: { id: CS1, name: "Cơ sở GDK", slug: `${P}cs-1`, address: "x" } });
  await db.course.create({ data: { id: KHOA, name: "Sata3 — Ươm Mầm Tài Năng", slug: `${P}sata3`, totalSessions: 48 } });
  await db.class.create({ data: { id: LOP, name: "Lớp GDK", courseId: KHOA } });
  await db.student.create({ data: { id: HV, name: "HV GDK", centerId: CS1 } });
  await db.enrollment.create({ data: { id: GD, studentId: HV, classId: LOP, courseId: KHOA, status: "ACTIVE", listPrice: 10_560_000, tuition: 10_560_000, finalPrice: 10_560_000, centerId: CS1 } });
  for (const [i, pv] of PV.entries()) {
    const n = i + 1;
    await db.order.create({
      data: { id: `${P}o${n}`, code: pv.code, type: "COURSE", status: "CONFIRMED", customerName: "PH GDK", customerPhone: "0981000000", subtotal: pv.tongDon, totalAmount: pv.tongDon, studentId: HV, centerId: CS1 },
    });
    await db.orderItem.create({ data: { id: pv.orderItemId, orderId: `${P}o${n}`, type: "COURSE_ENROLLMENT", itemName: "Sata 3", quantity: 1, unitPrice: pv.tongDon, totalPrice: pv.tongDon } });
    await db.payment.create({
      data: { id: `${P}p${n}`, orderId: `${P}o${n}`, orderItemId: pv.orderItemId, enrollmentId: GD, amount: pv.tongDon, method: "backfill", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1 },
    });
  }
}

let demNonce = 0;
const CG = (kh: KeHoachGanDong, o: Partial<TuyChinhCongGhi> = {}): DauVaoCongGhi => {
  const nonce = o.nonce ?? `9e30${String(++demNonce).padStart(28, "0")}`;
  nonceDaDung.push(nonce);
  return dungCongGhiThu(WORKFLOW_WAVE1.ganDongDonTheoKhoan, kh.dongDauRa, { now: MOC, ...o, nonce }).cong;
};
const nhap = (kh: KeHoachGanDong, congGhi: DauVaoCongGhi, o: Partial<DauVaoGhiGanDong> = {}): DauVaoGhiGanDong => ({
  phamVi: PV, soDuyet: kh.ghi.length, ghiDuoc: true, actor: ACTOR_GAN_DONG, luotChay: LUOT, congGhi, ...o,
});
const kehoach = () => docKeHoachGanDong(db, PV);
const daGan = () => db.orderItem.count({ where: { orderId: { startsWith: P }, OR: [{ studentId: { not: null } }, { enrollmentId: { not: null } }] } });
const soClaim = () => db.auditLog.count({ where: { id: { in: nonceDaDung.map((n) => `wg:${n}`) } } });
const soAudit = (action: string) => db.auditLog.count({ where: { action, OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9500001" } }] } });

describe.skipIf(!RUN_DB_TESTS)("[GDK-DB] gắn dòng đơn theo khoản thu — Postgres thật", () => {
  beforeEach(async () => {
    await dung();
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[GDK-DB-00] fixture đúng hình dạng ca thật: 2 dòng chưa gắn, kế hoạch SẴN SÀNG GHI 2, không lỗi, 0 phiếu thu, 0 phân bổ (đối chứng dương cho mọi ca dưới)", async () => {
    expect(await daGan()).toBe(0);
    const kh = await kehoach();
    expect(kh.loi).toEqual([]);
    expect(kh.ghi.map((g) => [g.code, g.orderItemId, g.studentId, g.enrollmentId])).toEqual(PV.map((p) => [p.code, p.orderItemId, HV, GD]));
    expect(await db.paymentRequest.count({ where: { orderId: { startsWith: P } } })).toBe(0);
    expect(await db.paymentAllocation.count({ where: { paymentRequest: { orderId: { startsWith: P } } } })).toBe(0);
  });

  it("[GDK-DB-01] GHI: đúng 2 cột/dòng; Order, Payment, ghi danh KHÔNG đổi; KHÔNG tạo PaymentRequest/Payment mới; audit trước/sau + dấu vết lượt + claim nonce", async () => {
    const truoc = await anhChupBatBienGanDong(db, PV);
    const orderTruoc = await db.order.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const payTruoc = await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } });
    const gdTruoc = await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const kh = await kehoach();
    const r = await ghiGanDong(db, nhap(kh, CG(kh)));
    expect(r).toMatchObject({ daGhi: 2, daGanHet: true, keHoachSha: kh.sha });

    for (const pv of PV) {
      const it = await db.orderItem.findUniqueOrThrow({ where: { id: pv.orderItemId } });
      expect(it).toMatchObject({ studentId: HV, enrollmentId: GD });
    }
    expect(await db.order.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(orderTruoc);
    expect(await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(payTruoc);
    expect(await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(gdTruoc);
    expect(await anhChupBatBienGanDong(db, PV)).toBe(truoc);
    expect(await db.payment.count({ where: { orderId: { startsWith: P } } })).toBe(2);
    expect(await db.paymentRequest.count({ where: { orderId: { startsWith: P } } })).toBe(0);

    expect(await soAudit("GAN_DONG_DON_THEO_KHOAN")).toBe(2);
    expect(await soAudit("GAN_DONG_DON_THEO_KHOAN_LUOT_CHAY")).toBe(1);
    expect(await soClaim()).toBe(1);
    const a = await db.auditLog.findFirstOrThrow({ where: { action: "GAN_DONG_DON_THEO_KHOAN", entityId: `${P}o2` } });
    expect(a.oldValues).toMatchObject({ orderItemId: PV[1]!.orderItemId, orderItemStudentId: null, orderItemEnrollmentId: null });
    expect(a.newValues).toMatchObject({ orderItemStudentId: HV, orderItemEnrollmentId: GD });
    const luot = await db.auditLog.findFirstOrThrow({ where: { action: "GAN_DONG_DON_THEO_KHOAN_LUOT_CHAY" } });
    expect(luot.newValues).toMatchObject({ expectedCount: 2, actualCount: 2, khop: true, keHoachSha: kh.sha });
  });

  it("[GDK-DB-02] IDEMPOTENT: chạy lại sau khi ghi ⇒ 0 dòng ghi, KHÔNG claim, KHÔNG audit thêm; kiểm sau ghi PASS (0 phiếu thu, 0 phân bổ, 2 khoản, tổng giữ nguyên)", async () => {
    const kh = await kehoach();
    const congKhac = CG(kh); // artifact HỢP LỆ về khuôn nhưng KHÔNG được dùng: lượt chạy lại không có gì để duyệt nên không được chạm tới nó
    await ghiGanDong(db, nhap(kh, CG(kh)));
    const auditTruoc = await db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9500001" } }] } });
    const claim = await soClaim();
    const ky2 = await kehoach();
    expect(ky2.ghi).toEqual([]);
    expect(ky2.daGanHet).toBe(true);
    const r2 = await ghiGanDong(db, nhap(ky2, congKhac, { soDuyet: 0 }));
    expect(r2.daGhi).toBe(0);
    expect(await soClaim()).toBe(claim);
    expect(await db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9500001" } }] } })).toBe(auditTruoc);
    const s = await kiemSauGhiGanDong(db, PV);
    expect(s).toMatchObject({ soKhoanSong: 2, tongKhoanSong: 7_920_000, soPhieuThu: 0, soPhanBo: 0 });
    expect(s.keHoach.daGanHet).toBe(true);
  });

  it("[GDK-DB-03] CỔNG KÝ: artifact ký cho dòng khác / đã dùng một lần / thiếu ⇒ từ chối TRƯỚC phép ghi đầu tiên, không ghi gì, không claim", async () => {
    const kh = await kehoach();
    // ký trên đầu ra KHÁC (một dòng) ⇒ lệch digest + số dòng
    await expect(ghiGanDong(db, nhap(kh, CG(kh, { rowsKy: kh.dongDauRa.slice(0, 1) })))).rejects.toThrow();
    expect(await daGan()).toBe(0);
    expect(await soClaim()).toBe(0);
    // REPLAY: artifact đúng dùng được MỘT lần
    const nonce = "9e30aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await ghiGanDong(db, nhap(kh, CG(kh, { nonce })));
    await db.orderItem.updateMany({ where: { orderId: { startsWith: P } }, data: { studentId: null, enrollmentId: null } });
    const kh2 = await kehoach();
    await expect(ghiGanDong(db, nhap(kh2, CG(kh2, { nonce })))).rejects.toThrow();
    expect(await daGan()).toBe(0);
  });

  it("[GDK-DB-04] TRANSACTION TOÀN LÔ: lỗi ở dòng cuối (trigger ném khi UPDATE dòng đơn #2) ⇒ dòng #1 đã ghi cũng LÙI; claim + audit lùi theo", async () => {
    await db.$executeRawUnsafe(`CREATE FUNCTION gdk_boom() RETURNS trigger AS $f$ BEGIN RAISE EXCEPTION 'GDK_BOOM'; END $f$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER gdk_boom_trg BEFORE UPDATE ON "OrderItem" FOR EACH ROW WHEN (NEW.id = '${PV[1]!.orderItemId}') EXECUTE FUNCTION gdk_boom()`);
    const kh = await kehoach();
    const e = await ghiGanDong(db, nhap(kh, CG(kh))).then(() => null, (x: unknown) => x);
    expect(String(e)).toMatch(/GDK_BOOM/);
    expect(await daGan()).toBe(0);
    expect(await soClaim()).toBe(0);
    expect(await soAudit("GAN_DONG_DON_THEO_KHOAN")).toBe(0);
    expect(await soAudit("GAN_DONG_DON_THEO_KHOAN_LUOT_CHAY")).toBe(0);
  });

  it("[GDK-DB-05] TRÔI TRẠNG THÁI giữa kế hoạch và ghi (một khoản vừa bị gỡ khỏi ghi danh; một dòng đơn lạ trỏ vào ghi danh) ⇒ cổng TRONG tx bắt, cả lô lùi", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await db.payment.update({ where: { id: `${P}p2` }, data: { enrollmentId: null } });
    const e1 = await db.$transaction((tx) => ghiGanDongTrongTx(tx, nhap(kh, cong))).then(() => null, (x: unknown) => x);
    expect(String(e1)).toMatch(/PAYMENT_KHONG_GAN_GHI_DANH/);
    await db.payment.update({ where: { id: `${P}p2` }, data: { enrollmentId: GD } });
    expect(await daGan()).toBe(0);

    await db.orderItem.create({ data: { id: `${P}it-la`, orderId: `${P}o1`, type: "COURSE_ENROLLMENT", itemName: "dòng lạ", quantity: 1, unitPrice: 1, totalPrice: 1, enrollmentId: GD } });
    const kh2 = await kehoach();
    expect(kh2.dung).toBe(true);
    expect(kh2.loi.map((l) => l.ma)).toEqual(expect.arrayContaining(["DONG_TRO_NGOAI_PHAM_VI"]));
    const e2 = await db.$transaction((tx) => ghiGanDongTrongTx(tx, nhap(kh, CG(kh)))).then(() => null, (x: unknown) => x);
    expect(String(e2)).toMatch(/DONG_TRO_NGOAI_PHAM_VI|SO_DONG_KHONG_DUNG/);
    await db.orderItem.delete({ where: { id: `${P}it-la` } });
    expect(await daGan()).toBe(0);
    expect(await soClaim()).toBe(0);
  });

  it("[GDK-DB-06] SAI --expect (1 thay vì 2) / thiếu quyền ghi / không truyền --expect ⇒ từ chối TRƯỚC khi mở transaction ghi", async () => {
    const kh = await kehoach();
    await expect(ghiGanDong(db, nhap(kh, CG(kh), { soDuyet: 1 }))).rejects.toThrow(/≠ kế hoạch/);
    await expect(ghiGanDong(db, nhap(kh, CG(kh), { soDuyet: null }))).rejects.toThrow(/đòi --expect/);
    await expect(ghiGanDong(db, nhap(kh, CG(kh), { ghiDuoc: false }))).rejects.toThrow(/không có quyền UPDATE/);
    await expect(ghiGanDong(db, nhap(kh, CG(kh), { ghiDuoc: null }))).rejects.toThrow(/Không kiểm được/);
    expect(await daGan()).toBe(0);
    expect(await soClaim()).toBe(0);
  });

  it("[GDK-DB-07] BẤT BIẾN: nếu phép ghi VÔ TÌNH kéo theo đổi Payment (trigger giả lập tác dụng phụ) ⇒ ảnh chụp sau ≠ trước ⇒ throw, cả lô lùi", async () => {
    await db.$executeRawUnsafe(`CREATE FUNCTION gdk_leak() RETURNS trigger AS $f$ BEGIN UPDATE "Payment" SET method = 'doi-ngam' WHERE "orderItemId" = NEW.id; RETURN NEW; END $f$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER gdk_leak_trg AFTER UPDATE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION gdk_leak()`);
    const kh = await kehoach();
    await expect(ghiGanDong(db, nhap(kh, CG(kh)))).rejects.toThrow(/Ảnh chụp bất biến/);
    expect(await daGan()).toBe(0);
    expect(await db.payment.count({ where: { orderId: { startsWith: P }, method: "doi-ngam" } })).toBe(0);
    expect(await soClaim()).toBe(0);
  });

  it("[GDK-DB-08] FAIL-CLOSED theo bằng chứng: ghi danh không ACTIVE / tổng khoản lệch tổng đơn / học viên có 2 ghi danh ⇒ kế hoạch DỪNG và ghi từ chối", async () => {
    const congHopLe = CG(await kehoach()); // dựng TRƯỚC khi làm hỏng dữ liệu: kế hoạch dừng không có dòng nào để ký
    await db.enrollment.update({ where: { id: GD }, data: { status: "WITHDREW" } });
    let kh = await kehoach();
    expect(kh.dung).toBe(true);
    expect(kh.loi.map((l) => l.ma)).toContain("GHI_DANH_KHONG_ACTIVE");
    await expect(ghiGanDong(db, nhap(kh, congHopLe, { soDuyet: 2 }))).rejects.toThrow(/DỪNG/);
    await db.enrollment.update({ where: { id: GD }, data: { status: "ACTIVE" } });

    await db.payment.update({ where: { id: `${P}p1` }, data: { amount: 3_999_999 } });
    kh = await kehoach();
    expect(kh.loi.map((l) => l.ma)).toContain("TIEN_PAYMENT_LECH");
    await db.payment.update({ where: { id: `${P}p1` }, data: { amount: 4_000_000 } });

    await db.enrollment.create({ data: { id: `${P}gd2`, studentId: HV, classId: LOP, courseId: KHOA, status: "ACTIVE", listPrice: 1, tuition: 1, finalPrice: 1, centerId: CS1 } }).catch(() => undefined);
    kh = await kehoach();
    // Có thể bị chỉ mục «một ghi danh sống / học viên-lớp» chặn tạo; nếu tạo được thì PHẢI dừng vì NHIEU_GHI_DANH.
    if ((await db.enrollment.count({ where: { studentId: HV, deletedAt: null } })) > 1) expect(kh.loi.map((l) => l.ma)).toContain("NHIEU_GHI_DANH");
    expect(await daGan()).toBe(0);
  });
});
