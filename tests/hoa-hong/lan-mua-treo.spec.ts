// @vitest-environment node
/**
 * [LMT-DB-*] — ĐO HOLD DO LỊCH SỬ MUA CHƯA CHỐT (`lib/hoa-hong/lan-mua-treo-doc.ts`, script `scripts/hoa-hong/do-lan-mua-treo.ts`). Postgres THẬT, engine thật.
 *
 * Câu hỏi của chủ dự án (§5): «189 dòng đơn dev chưa có thanh toán dương và chưa huỷ ⇒ giữ HOLD an toàn, không đoán — người vận hành phải NHÌN ĐƯỢC số này». Spec này chứng minh:
 *   [LMT-DB-01] ba tầng số khớp sự thật dựng sẵn: tầng 1 (đơn chưa thu, theo trạng thái) · tầng 2 (SQL — cận trên, KHÔNG nhỏ hơn số chính xác) · tầng 3 (chạy bộ phân loại — số thật bị giữ).
 *   [LMT-DB-02] đơn ghi bù: hold BACKFILL_ORDER_TIME_UNVERIFIED đếm riêng; coverage của dấu «giờ tạo chưa kiểm chứng».
 *   [LMT-DB-03] số của SQL = số của một bản cài đặt ĐỘC LẬP bằng Prisma (luật: câu SQL in cho người vận hành lệch luật mà không ai bắt là mù).
 *   [LMT-DB-04] câu SQL IN RA (văn bản, không tham số) chạy được NGUYÊN VĂN và cho đúng số của hàm đo.
 *   [LMT-DB-05] CHỈ ĐỌC: chạy trong transaction READ ONLY được; ghi trong đó bị Postgres từ chối; số dòng các bảng không đổi.
 *
 * Khoanh vùng theo `centerId` của kịch bản (DB test còn dữ liệu spec khác); riêng [LMT-DB-04] đo TOÀN DB và so SQL in ra với hàm đo cùng phạm vi.
 *
 * Chạy: `pnpm test:hoa-hong-db` hoặc `vitest run -c vitest.db.config.ts tests/hoa-hong/lan-mua-treo.spec.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 180_000 });

import { db } from "../../lib/db";
import { createBackfillOrderPaymentInTx } from "../../lib/crm/backfill-order";
import { confirmPayment } from "../../lib/finance/payment";
import { WHERE_THUC_THU } from "../../lib/finance/thuc-thu";
import { cauSqlInRa, docLanMuaTreo } from "../../lib/hoa-hong/lan-mua-treo-doc";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb } from "../e2e/_helpers/seed";
import { D, donKichBan, dungBe, dungKichBan, tienVe, type Be, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[LMT] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const RULES = [
  { vai: "SALE", rate: 0.09 },
  { vai: "SALE", rate: 0.02, loai: "RENEWAL" as const },
];
const cuaToi: KichBan[] = [];
const DO = { toiDaViDu: 50, tranSoDong: 100_000 } as const;

/** Lần mua THÊM của cùng học viên (đơn + ghi danh + một dòng học phí), trạng thái đơn tuỳ chọn. */
async function lanMuaThem(k: KichBan, be: Be, ten: string, ngayDon: Date, status: "PENDING_PAYMENT" | "CONFIRMED" | "COMPLETED" | "CANCELLED" = "CONFIRMED"): Promise<Be> {
  const id = `${k.ma}-${ten}`;
  const khoa = await db.course.create({ data: { id: `${id}-khoa`, name: `Sata 4 ${id}`, slug: `${id}-sata4`, totalSessions: 48 } });
  const lop = await db.class.create({ data: { id: `${id}-lop`, name: `Lớp ${id}`, courseId: khoa.id, centerId: k.centerId } });
  const enr = await db.enrollment.create({ data: { id: `${id}-gd`, studentId: be.studentId, classId: lop.id, courseId: khoa.id, centerId: k.centerId, status: "ACTIVE", createdAt: ngayDon } });
  const order = await db.order.create({
    data: { id: `${id}-don`, code: `${id}-don`.toUpperCase(), type: "COURSE", status, customerName: "PH", customerPhone: k.lead?.phone ?? "0990000001", totalAmount: 10_000_000, centerId: k.centerId, leadId: k.lead?.id ?? null, createdAt: ngayDon },
  });
  const item = await db.orderItem.create({
    data: { id: `${id}-oi`, orderId: order.id, type: "COURSE_ENROLLMENT", itemName: `Học phí ${ten}`, quantity: 1, unitPrice: 10_000_000, totalPrice: 10_000_000, studentId: be.studentId, enrollmentId: enr.id, createdAt: ngayDon },
  });
  return { studentId: be.studentId, enrollmentId: enr.id, orderId: order.id, orderItemId: item.id };
}

/** Bé mới + đơn đầu `dau` (trạng thái tuỳ chọn). */
async function beVoiDon(k: KichBan, ten: string, ngay: Date, status: "PENDING_PAYMENT" | "CONFIRMED" | "COMPLETED" | "CANCELLED") {
  const be = await dungBe(k, ten, { tongTien: 10_000_000, ngayDon: ngay });
  await db.order.update({ where: { id: be.orderId }, data: { status } });
  return be;
}

async function nhapDonGhiBu(k: KichBan, be: Be, p: { ngayThu: Date; ngayNhap: Date }) {
  const ket = await db.$transaction((tx) =>
    createBackfillOrderPaymentInTx(tx, {
      actor: { id: k.ketToanA.id, name: "Kế toán A fixture" },
      lead: { id: k.lead!.id, centerId: k.centerId, parentName: "PH", phone: k.lead!.phone, email: null },
      paid: { amount: 10_000_000, paidDate: p.ngayThu, items: [{ itemName: "Học phí ghi bù", unitPrice: 10_000_000 }] },
    }),
  );
  if (!ket.created || !ket.paymentId) throw new Error("backfill không tạo được khoản");
  const pay = await db.payment.findUniqueOrThrow({ where: { id: ket.paymentId }, select: { orderId: true } });
  const item = await db.orderItem.findFirstOrThrow({ where: { orderId: pay.orderId }, select: { id: true } });
  await db.order.update({ where: { id: pay.orderId }, data: { createdAt: p.ngayNhap } });
  await db.auditLog.updateMany({ where: { module: "finance", entityType: "Payment", action: "CREATE", entityId: ket.paymentId }, data: { createdAt: p.ngayNhap } });
  const id = `${k.ma}-e`;
  const khoa = await db.course.create({ data: { id: `${id}-khoa`, name: `Sata 2 ${id}`, slug: `${id}-sata2`, totalSessions: 48 } });
  const lop = await db.class.create({ data: { id: `${id}-lop`, name: `Lớp ${id}`, courseId: khoa.id, centerId: k.centerId } });
  const gd = await db.enrollment.create({ data: { id: `${id}-gd`, studentId: be.studentId, classId: lop.id, courseId: khoa.id, centerId: k.centerId, status: "ACTIVE", createdAt: p.ngayNhap } });
  await db.orderItem.update({ where: { id: item.id }, data: { studentId: be.studentId, enrollmentId: gd.id } });
  await db.payment.update({ where: { id: ket.paymentId }, data: { enrollmentId: gd.id, orderItemId: item.id } });
  expect((await confirmPayment({ paymentId: ket.paymentId, confirmedById: k.ketToanB.id })).ok).toBe(true);
  return { orderId: pay.orderId };
}

const demBang = async () => ({
  order: await db.order.count(),
  payment: await db.payment.count(),
  audit: await db.auditLog.count(),
  st: await db.studentTransaction.count(),
  hold: await db.commissionHold.count(),
});

describe.skipIf(!RUN_DB_TESTS)("[LMT-DB] đo hold do lịch sử mua chưa chốt", () => {
  beforeAll(() => {
    assertTestDb();
  });
  afterAll(async () => {
    await donKichBan(cuaToi);
  }, 60_000);

  /** Kịch bản 4 học viên: S1 (chưa thu, còn sống) · S2 (COMPLETED chưa thu) · S3 (đã huỷ) · S4 (có tiền lệ chắc + một đơn chưa thu). */
  async function dungBonHocVien() {
    const k = await dungKichBan("lmt1", { rules: RULES });
    cuaToi.push(k);
    // S1: A1 PENDING_PAYMENT (chưa thu) tạo trước; B1 thu sau ⇒ B1 bị giữ PREVIOUS_PURCHASE_UNRESOLVED.
    const a1 = await beVoiDon(k, "s1a", D("2026-10-01"), "PENDING_PAYMENT");
    const b1 = await lanMuaThem(k, a1, "s1b", D("2026-10-05"));
    await tienVe(k, b1, { soTien: 10_000_000, ngay: D("2026-10-10") });
    // S2: A2 COMPLETED nhưng chưa từng thu (không huỷ được); B2 thu ⇒ B2 bị giữ.
    const a2 = await beVoiDon(k, "s2a", D("2026-10-01"), "COMPLETED");
    const b2 = await lanMuaThem(k, a2, "s2b", D("2026-10-05"));
    await tienVe(k, b2, { soTien: 10_000_000, ngay: D("2026-10-10") });
    // S3: A3 ĐÃ HUỶ (chưa từng thu) ⇒ LOẠI; B3 thu ⇒ NEW, KHÔNG bị giữ, và A3 không nằm trong tầng 1.
    const a3 = await beVoiDon(k, "s3a", D("2026-10-01"), "CANCELLED");
    const b3 = await lanMuaThem(k, a3, "s3b", D("2026-10-05"));
    await tienVe(k, b3, { soTien: 10_000_000, ngay: D("2026-10-10") });
    // S4: ACU đã thu (tiền lệ CHẮC), A4 chưa thu còn sống, B4 thu ⇒ RENEWAL (không giữ) — nhưng SQL cận trên vẫn đếm B4.
    const acu = await beVoiDon(k, "s4c", D("2026-09-01"), "CONFIRMED");
    await tienVe(k, acu, { soTien: 10_000_000, ngay: D("2026-09-05") });
    const a4 = await lanMuaThem(k, acu, "s4a", D("2026-10-01"), "PENDING_PAYMENT");
    expect(a4.orderItemId).toBeTruthy();
    const b4 = await lanMuaThem(k, acu, "s4b", D("2026-10-05"));
    await tienVe(k, b4, { soTien: 10_000_000, ngay: D("2026-10-10") });
    return { k, a1, b1, a2, b2, a3, b3, acu, a4, b4 };
  }

  it("[LMT-DB-01] ba tầng số khớp sự thật dựng sẵn; tầng 2 (SQL) là CẬN TRÊN ≥ tầng 3 (bộ phân loại), và ca RENEWAL-vì-có-tiền-lệ-chắc phân biệt hai tầng", async () => {
    const c = await dungBonHocVien();
    const kq = await docLanMuaTreo(db, { centerId: c.k.centerId, ...DO });

    // Tầng 1 — đơn còn sống & chưa thu dương: A1 + A4 (PENDING_PAYMENT) và A2 (COMPLETED). A3 (huỷ) và mọi đơn đã thu KHÔNG vào.
    expect(kq.dongChuaThuChuaHuy.tong).toBe(3);
    expect(Object.fromEntries(kq.dongChuaThuChuaHuy.theoTrangThai.map((t) => [t.trangThai, t.soDong]))).toEqual({ PENDING_PAYMENT: 2, COMPLETED: 1 });

    // Tầng 3 — bộ phân loại: chỉ B1 và B2 bị giữ (B3: tiền lệ bị loại ⇒ NEW; B4: có tiền lệ chắc ⇒ RENEWAL).
    expect(kq.chinhXac.lanMuaTruocChuaChot).toMatchObject({ soDong: 2, soHocVien: 2, soKhoanThu: 2, soTienThu: 20_000_000 });
    expect(kq.chinhXac.lanMuaTruocChuaChot.viDu.map((v) => v.maDon).sort()).toEqual([`${c.k.ma}-s1b-don`.toUpperCase(), `${c.k.ma}-s2b-don`.toUpperCase()]);
    const vi1 = kq.chinhXac.lanMuaTruocChuaChot.viDu.find((v) => v.maDon.endsWith("S1B-DON"));
    expect(vi1?.donVuongMac).toEqual([`${c.k.ma}-s1a-don`.toUpperCase() + " [PENDING_PAYMENT]"]);
    expect(kq.chinhXac.thuTuMuaChuaKiem).toMatchObject({ soDong: 0, soHocVien: 0 });
    // Ví dụ CHỈ có mã đơn + trạng thái — không id học viên, không tên, không SĐT.
    const json = JSON.stringify(kq);
    expect(json).not.toContain(c.b1.studentId);
    expect(json).not.toContain(c.k.lead!.phone);

    // Tầng 2 — SQL là cận trên: đếm cả B4 (có tiền lệ chắc nên thật ra không bị giữ).
    expect(kq.ungVien.PREVIOUS_PURCHASE_UNRESOLVED).toEqual({ soHocVien: 3, soDong: 3 });
    expect(kq.ungVien.PREVIOUS_PURCHASE_UNRESOLVED.soDong).toBeGreaterThanOrEqual(kq.chinhXac.lanMuaTruocChuaChot.soDong);
    expect(kq.ungVien.BACKFILL_ORDER_TIME_UNVERIFIED).toEqual({ soHocVien: 0, soDong: 0 });
  });

  it("[LMT-DB-02] đơn ghi bù nhập SAU khi B được tạo: hold BACKFILL_ORDER_TIME_UNVERIFIED đếm RIÊNG (2 dòng, 1 học viên), không lẫn PREVIOUS_PURCHASE_UNRESOLVED; coverage của dấu tăng đúng 1", async () => {
    const k = await dungKichBan("lmt2", { rules: RULES });
    cuaToi.push(k);
    const truoc = await docLanMuaTreo(db, { centerId: k.centerId, ...DO });
    const khoiDau = (await db.$queryRaw<{ ghi_bu: number }[]>(Prisma.sql`SELECT count(DISTINCT p."orderId")::int AS ghi_bu FROM "AuditLog" a JOIN "Payment" p ON p.id = a."entityId" WHERE a."module"='finance' AND a."action"='CREATE' AND a."entityType"='Payment' AND a."newValues"->>'source'='bulk-convert-backfill'`))[0]!.ghi_bu;
    expect(truoc.donChuaKiem.ghiBu).toBe(khoiDau);

    const beB = await dungBe(k, "b", { tongTien: 10_000_000, ngayDon: D("2026-10-10") });
    await tienVe(k, beB, { soTien: 10_000_000, ngay: D("2026-10-15") });
    await nhapDonGhiBu(k, beB, { ngayThu: D("2026-01-20"), ngayNhap: D("2026-10-12") });

    const kq = await docLanMuaTreo(db, { centerId: k.centerId, ...DO });
    expect(kq.chinhXac.thuTuMuaChuaKiem).toMatchObject({ soDong: 2, soHocVien: 1, soKhoanThu: 2, soTienThu: 20_000_000 });
    expect(kq.chinhXac.lanMuaTruocChuaChot).toMatchObject({ soDong: 0, soHocVien: 0 });
    expect(kq.ungVien.BACKFILL_ORDER_TIME_UNVERIFIED).toEqual({ soHocVien: 1, soDong: 2 });
    expect(kq.donChuaKiem.ghiBu).toBe(khoiDau + 1);
    // Ví dụ nêu CHÉO đơn vướng: dòng của B vướng đơn ghi bù và ngược lại.
    const viDu = kq.chinhXac.thuTuMuaChuaKiem.viDu;
    expect(viDu).toHaveLength(2);
    for (const v of viDu) expect(v.donVuongMac).toHaveLength(1);
  });

  it("[LMT-DB-06] đối chứng DƯƠNG của [LMT-DB-02]: đơn ghi bù được máy chủ nhận TRƯỚC khi B được tạo (nhập 08/10 < tạo B 10/10) ⇒ thứ tự CHẮC ⇒ KHÔNG hold BACKFILL_ORDER_TIME_UNVERIFIED, cả ở tầng chính xác lẫn tầng SQL (cận trên cũng 0 vì SQL phân biệt «đơn đứng SAU là đơn chưa kiểm chứng»)", async () => {
    const k = await dungKichBan("lmt6", { rules: RULES });
    cuaToi.push(k);
    const beB = await dungBe(k, "b", { tongTien: 10_000_000, ngayDon: D("2026-10-10") });
    await tienVe(k, beB, { soTien: 10_000_000, ngay: D("2026-10-15") });
    await nhapDonGhiBu(k, beB, { ngayThu: D("2026-01-20"), ngayNhap: D("2026-10-08") });
    const kq = await docLanMuaTreo(db, { centerId: k.centerId, ...DO });
    expect(kq.ungVien.BACKFILL_ORDER_TIME_UNVERIFIED).toEqual({ soHocVien: 0, soDong: 0 });
    expect(kq.chinhXac.thuTuMuaChuaKiem).toMatchObject({ soDong: 0, soHocVien: 0 });
    expect(kq.chinhXac.lanMuaTruocChuaChot).toMatchObject({ soDong: 0 });
  });

  it("[LMT-DB-03] số của SQL (tầng 1) = một bản cài đặt ĐỘC LẬP bằng Prisma — cùng định nghĩa «đơn còn sống, chưa có khoản thực thu dương»", async () => {
    const c = await dungBonHocVien();
    const kq = await docLanMuaTreo(db, { centerId: c.k.centerId, ...DO });
    const dongs = await db.orderItem.findMany({
      where: {
        type: { in: ["COURSE_ENROLLMENT", "COURSE_PACKAGE"] },
        order: { centerId: c.k.centerId, status: { not: "CANCELLED" }, payments: { none: { ...WHERE_THUC_THU, amount: { gt: 0 } } } },
      },
      select: { order: { select: { status: true } } },
    });
    const doc: Record<string, number> = {};
    for (const d of dongs) doc[d.order.status] = (doc[d.order.status] ?? 0) + 1;
    expect(Object.fromEntries(kq.dongChuaThuChuaHuy.theoTrangThai.map((t) => [t.trangThai, t.soDong]))).toEqual(doc);
    expect(kq.dongChuaThuChuaHuy.tong).toBe(dongs.length);
  });

  it("[LMT-DB-04] câu SQL IN RA (văn bản, dán là chạy) chạy NGUYÊN VĂN và cho đúng số của hàm đo cùng phạm vi (TOÀN DB)", async () => {
    await dungBonHocVien();
    const toanDb = await docLanMuaTreo(db, { ...DO });
    const sqls = cauSqlInRa();
    expect(sqls.map((s) => s.ten.slice(0, 2))).toEqual(["1.", "2.", "3.", "4."]);
    for (const s of sqls) {
      expect(s.sql, s.ten).not.toMatch(/\$\d|\?\?/); // không còn tham số — in ra là dán chạy được
      // bỏ literal trước khi tìm từ khoá: 'CREATE' là GIÁ TRỊ của AuditLog.action, không phải lệnh.
      expect(s.sql.replace(/'[^']*'/g, "''"), s.ten).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE)\b/i);
    }
    const chay = <T>(s: string) => db.$queryRaw<T[]>(Prisma.raw(s));
    const c1 = await chay<{ trang_thai: string; so_dong: number }>(sqls[0]!.sql);
    expect(Object.fromEntries(c1.map((r) => [r.trang_thai, r.so_dong]))).toEqual(Object.fromEntries(toanDb.dongChuaThuChuaHuy.theoTrangThai.map((t) => [t.trangThai, t.soDong])));
    const [c2] = await chay<{ so_hoc_vien: number; so_dong: number }>(sqls[1]!.sql);
    expect(c2).toEqual({ so_hoc_vien: toanDb.ungVien.PREVIOUS_PURCHASE_UNRESOLVED.soHocVien, so_dong: toanDb.ungVien.PREVIOUS_PURCHASE_UNRESOLVED.soDong });
    const [c3] = await chay<{ so_hoc_vien: number; so_dong: number }>(sqls[2]!.sql);
    expect(c3).toEqual({ so_hoc_vien: toanDb.ungVien.BACKFILL_ORDER_TIME_UNVERIFIED.soHocVien, so_dong: toanDb.ungVien.BACKFILL_ORDER_TIME_UNVERIFIED.soDong });
    const [c4] = await chay<{ ghi_bu: number; nhap_cu: number }>(sqls[3]!.sql);
    expect(c4).toEqual({ ghi_bu: toanDb.donChuaKiem.ghiBu, nhap_cu: toanDb.donChuaKiem.nhapCu });
  });

  it("[LMT-DB-05] CHỈ ĐỌC: đo trong transaction READ ONLY chạy được và số dòng các bảng không đổi; một lệnh ghi trong cùng transaction bị Postgres từ chối", async () => {
    const c = await dungBonHocVien();
    const truoc = await demBang();
    const kq = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return docLanMuaTreo(tx, { centerId: c.k.centerId, ...DO });
      },
      { timeout: 120_000 },
    );
    expect(kq.chinhXac.lanMuaTruocChuaChot.soDong).toBe(2);
    expect(await demBang()).toEqual(truoc);

    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.order.updateMany({ where: { id: c.a1.orderId }, data: { internalNote: "không được ghi" } });
      }),
    ).rejects.toThrow(/read-only|chỉ đọc/i);
    expect((await db.order.findUniqueOrThrow({ where: { id: c.a1.orderId }, select: { internalNote: true } })).internalNote).not.toBe("không được ghi");
  });
});
