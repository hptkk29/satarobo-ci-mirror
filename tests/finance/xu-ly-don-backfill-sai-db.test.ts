// tests/finance/xu-ly-don-backfill-sai-db.test.ts — [XDS-DB-*] «PHASE X · xử lý đơn backfill SAI ORD-260913-000041» trên Postgres THẬT: đọc → kế hoạch → cổng Wave 1 → ghi → kiểm sau ghi.
//
// Chạy:  pnpm test:finance-db   (hoặc `vitest run -c vitest.db.config.ts tests/finance/xu-ly-don-backfill-sai-db.test.ts`). `pnpm test:unit` trần SKIP — log «SKIP» nghĩa là CHƯA kiểm gì.
// Khoá EPHEMERAL sinh lúc chạy; môi trường `test`. Fixture tiền tố `XDS_`; KHÔNG `resetDb()`. Lõi DB đọc HAI mã đơn CỨNG (đơn sai + đơn đúng) nên fixture mang đúng hai mã đó (cột `code` unique; DB test sạch).
// Fixture «hình dạng thật» (đo PROD 27/10/2026): đơn ĐÚNG = COMPLETED, ghi danh ACTIVE, 2 khoản CONFIRMED có giao dịch ngân hàng MATCHED + 1 khoản PENDING đã xoá mềm; đơn SAI = CONFIRMED, MỘT dòng đơn chưa gắn học viên/ghi danh,
// 2 khoản PENDING `backfill` (1.000.000 + 9.424.000) đang gắn NHẦM vào ghi danh của đơn đúng; không phiếu thu, không phân bổ, không Receipt/hoá đơn/hoa hồng.
//
// Ánh xạ yêu cầu owner (27/10/2026) → ca:
//   dry-run mặc định, in phụ thuộc ⇒ [00]   |   transaction + chỉ đổi đúng 3 dòng, đơn đúng/ngân hàng/Receipt nguyên ⇒ [01]   |   idempotent ⇒ [02]   |   owner-signed artifact ⇒ [03] [09]
//   fail nếu lệch audit / phụ thuộc ⇒ [04]   |   rollback toàn lô ⇒ [05] [08]   |   không mất Payment thật của đơn đúng, không external live Payment trên ghi danh đích ⇒ [01] [10]
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dungCongGhiThu, type TuyChinhCongGhi } from "@/tests/_helpers/cong-ghi-wave1";
import { CongGhiTuChoi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import { MA_DON_DUNG, MA_DON_SAI, TONG_DON_SAI, type KeHoachXuLy } from "@/lib/nguon/xu-ly-don-backfill-sai";
import {
  ACTOR_XU_LY_DON_SAI,
  anhChupBatBienXuLy,
  docDuLieuXuLy,
  docKeHoachXuLy,
  ghiXuLy,
  ghiXuLyTrongTx,
  kiemSauGhiXuLy,
  type DauVaoGhiXuLy,
} from "@/lib/nguon/xu-ly-don-backfill-sai-db";

if (!RUN_DB_TESTS) console.warn(`[XDS-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const P = "XDS_";
const CS1 = `${P}cs1`;
const KHOA = `${P}khoa`;
const LOP = `${P}lop`;
const MOC = new Date("2026-10-27T03:00:00.000Z");
const NGAY_THU = new Date("2026-08-15T00:00:00.000Z");
const LUOT = { batDauLuc: MOC, nguonChay: { actor: "a", triggeringActor: "b", runId: "9830001", runAttempt: "1" } } as const;
const nonceDaDung: string[] = [];

async function don() {
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: P } }, { id: { in: nonceDaDung.map((n) => `wg:${n}`) } }, { entityId: { startsWith: "luot:9830001" } }] } });
  for (const t of ["boom", "leak"]) {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS xds_${t}_trg ON "Payment"`);
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS xds_${t}_trg ON "Order"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS xds_${t}()`);
  }
  await db.orderStatusHistory.deleteMany({ where: { orderId: { startsWith: P } } });
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
  await db.class.deleteMany({ where: { id: { in: [LOP, `${P}lop2`] } } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.center.deleteMany({ where: { id: CS1 } });
}

const ID = { oSai: `${P}o_sai`, oDung: `${P}o_dung`, itSai: `${P}it_sai`, itDung: `${P}it_dung`, enr: `${P}e0`, kA: `${P}k_a`, kB: `${P}k_b` };

async function dung() {
  await don();
  await db.center.create({ data: { id: CS1, name: "Cơ sở XDS 1", slug: `${P}cs-1`, address: "x" } });
  await db.course.create({ data: { id: KHOA, name: "Sata3 XDS", slug: `${P}sata3`, totalSessions: 48 } });
  await db.class.create({ data: { id: LOP, name: "Lớp XDS", courseId: KHOA } });
  await db.lead.create({ data: { id: `${P}l0`, parentName: "PH XDS", phone: "0988000001", status: "DA_DANG_KY", centerId: CS1 } });
  await db.leadChild.create({ data: { id: `${P}be0`, leadId: `${P}l0`, fullName: "Bé XDS" } });
  await db.student.create({ data: { id: `${P}s0`, name: "Bé XDS", leadId: `${P}l0`, leadChildId: `${P}be0`, centerId: CS1, parentPhone: "0988000001" } });
  await db.enrollment.create({
    data: { id: ID.enr, studentId: `${P}s0`, classId: LOP, courseId: KHOA, status: "ACTIVE", leadChildId: `${P}be0`, centerId: CS1, listPrice: 13_440_000, discountType: "PERCENT", discountAmount: 2_016_000, tuition: 11_424_000, finalPrice: 11_424_000 },
  });

  // ĐƠN ĐÚNG
  await db.order.create({
    data: { id: ID.oDung, code: MA_DON_DUNG, type: "COURSE", status: "COMPLETED", customerName: "PH XDS", customerPhone: "0988000001", subtotal: 13_440_000, discountAmount: 2_016_000, totalAmount: 11_424_000, leadId: `${P}l0`, centerId: CS1, studentId: `${P}s0` },
  });
  await db.orderItem.create({
    data: { id: ID.itDung, orderId: ID.oDung, type: "COURSE_ENROLLMENT", itemName: "Khoá XDS", quantity: 1, unitPrice: 13_440_000, totalPrice: 13_440_000, metadata: { courseId: KHOA }, studentId: `${P}s0`, enrollmentId: ID.enr },
  });
  await db.paymentRequest.create({ data: { id: `${P}pr_dung`, orderId: ID.oDung, centerId: CS1, installmentNo: 1, amountDue: 9_424_000 } });
  await db.bankTransaction.create({ data: { id: `${P}bt_dung`, provider: "SEPAY", providerTxnId: `${P}txn_dung`, amount: 9_424_000, transferredAt: NGAY_THU, status: "MATCHED", centerId: CS1 } });
  await db.paymentAllocation.create({ data: { bankTransactionId: `${P}bt_dung`, paymentRequestId: `${P}pr_dung`, amount: 9_424_000 } });
  await db.payment.create({
    data: { id: `${P}d_1`, orderId: ID.oDung, orderItemId: ID.itDung, enrollmentId: null, amount: 9_424_000, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1, note: `[auto:sepay:${P}txn_dung]` },
  });
  await db.payment.create({
    data: { id: `${P}d_2`, orderId: ID.oDung, orderItemId: ID.itDung, enrollmentId: null, amount: 2_000_000, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1 },
  });
  await db.payment.create({
    data: { id: `${P}d_xoa`, orderId: ID.oDung, orderItemId: ID.itDung, enrollmentId: null, amount: 2_000_000, method: "auto", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "PENDING", centerId: CS1, deletedAt: new Date("2026-10-04T10:00:00Z") },
  });

  // ĐƠN SAI (backfill) — hai khoản PENDING gắn NHẦM vào ghi danh của đơn đúng
  await db.order.create({
    data: { id: ID.oSai, code: MA_DON_SAI, type: "COURSE", status: "CONFIRMED", customerName: "PH XDS", customerPhone: "0988000001", subtotal: TONG_DON_SAI, totalAmount: TONG_DON_SAI, leadId: `${P}l0`, centerId: CS1, studentId: `${P}s0` },
  });
  await db.orderItem.create({ data: { id: ID.itSai, orderId: ID.oSai, type: "COURSE_ENROLLMENT", itemName: "Khoá XDS (backfill)", quantity: 1, unitPrice: TONG_DON_SAI, totalPrice: TONG_DON_SAI } });
  await db.payment.create({
    data: { id: ID.kA, orderId: ID.oSai, orderItemId: ID.itSai, enrollmentId: ID.enr, amount: 1_000_000, method: "backfill", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "PENDING", centerId: CS1, note: "Nhập liệu ban đầu [backfill-import]" },
  });
  await db.payment.create({
    data: { id: ID.kB, orderId: ID.oSai, orderItemId: ID.itSai, enrollmentId: ID.enr, amount: 9_424_000, method: "backfill", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "PENDING", centerId: CS1, note: "Nhập liệu ban đầu [backfill-import]" },
  });
}

let demNonce = 0;
const CG = (kh: KeHoachXuLy, o: Partial<TuyChinhCongGhi> = {}): DauVaoCongGhi => {
  const nonce = o.nonce ?? `7d41${String(++demNonce).padStart(28, "0")}`;
  nonceDaDung.push(nonce);
  return dungCongGhiThu(WORKFLOW_WAVE1.xuLyDonBackfillSai, kh.dongDauRa, { now: MOC, ...o, nonce }).cong;
};
const nhap = (kh: KeHoachXuLy, congGhi: DauVaoCongGhi, o: Partial<DauVaoGhiXuLy> = {}): DauVaoGhiXuLy => ({ soDuyet: kh.ghi.length, ghiDuoc: true, actor: ACTOR_XU_LY_DON_SAI, luotChay: LUOT, congGhi, ...o });
const kehoach = () => docKeHoachXuLy(db);
const thuLoi = (p: Promise<unknown>) => p.then(() => null, (x: unknown) => x);
const soClaim = () => db.auditLog.count({ where: { id: { in: nonceDaDung.map((n) => `wg:${n}`) } } });
const soAudit = (action: string) => db.auditLog.count({ where: { action, OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9830001" } }] } });
const khoanSai = () => db.payment.findMany({ where: { orderId: ID.oSai }, orderBy: { id: "asc" } });
const donSai = () => db.order.findUniqueOrThrow({ where: { id: ID.oSai } });
const khongGhiGi = async () => {
  expect((await donSai()).status, "đơn sai vẫn CONFIRMED").toBe("CONFIRMED");
  for (const k of await khoanSai()) {
    expect(k.deletedAt, k.id).toBeNull();
    expect(k.enrollmentId, k.id).toBe(ID.enr);
  }
  expect(await db.orderStatusHistory.count({ where: { orderId: ID.oSai } })).toBe(0);
};
const chupDung = async () => ({
  don: await db.order.findUniqueOrThrow({ where: { id: ID.oDung }, include: { items: { orderBy: { id: "asc" } } } }),
  khoan: await db.payment.findMany({ where: { orderId: ID.oDung }, orderBy: { id: "asc" } }),
  ghiDanh: await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } }),
  nganHang: await db.bankTransaction.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } }),
  phanBo: await db.paymentAllocation.findMany({ where: { bankTransactionId: { startsWith: P } }, orderBy: { id: "asc" } }),
  phieu: await db.paymentRequest.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } }),
});

describe.skipIf(!RUN_DB_TESTS)("[XDS-DB] xử lý đơn backfill sai — Postgres thật", () => {
  beforeEach(async () => {
    await dung();
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[XDS-DB-00] fixture đúng hình dạng: kế hoạch SẴN SÀNG GHI 3 dòng, không lỗi, MỌI phụ thuộc = 0, ghi danh đích do DB đọc ra (đối chứng dương)", async () => {
    await khongGhiGi();
    const du = await docDuLieuXuLy(db);
    expect(du.donDung?.enrollmentId).toBe(ID.enr);
    expect(Object.values(du.phuThuoc).every((n) => n === 0)).toBe(true);
    expect(Object.keys(du.phuThuoc).length).toBeGreaterThanOrEqual(20);
    expect(du.khoanSai).toHaveLength(2);
    const kh = await kehoach();
    expect(kh.loi).toEqual([]);
    expect(kh.trangThai).toBe("CHUA_XU_LY");
    expect(kh.ghi).toHaveLength(3);
    expect(kh.enrollmentDich).toBe(ID.enr);
    expect(kh.soPhuThuocKhac0).toBe(0);
  });

  it("[XDS-DB-01] GHI: 2 khoản xoá mềm + gỡ liên kết, đơn CANCELLED + 1 dòng lịch sử; số tiền/trạng thái kế toán/ngày thu/ghi chú KHÔNG đổi; ĐƠN ĐÚNG, ghi danh, ngân hàng, phân bổ, phiếu NGUYÊN VẸN; KHÔNG Receipt; audit + lượt + claim", async () => {
    const dungTruoc = await chupDung();
    const saiTruoc = await khoanSai();
    const dongSaiTruoc = await db.orderItem.findMany({ where: { orderId: ID.oSai } });
    const anhTruoc = await anhChupBatBienXuLy(db);
    const kh = await kehoach();
    const r = await ghiXuLy(db, nhap(kh, CG(kh)));
    expect(r).toMatchObject({ daGhi: 3, daXuLy: true, keHoachSha: kh.sha });

    // đơn sai
    const sai = await donSai();
    expect(sai.status).toBe("CANCELLED");
    expect(sai.deletedAt).toBeNull(); // KHÔNG dùng Order.deletedAt
    expect(sai.totalAmount).toBe(TONG_DON_SAI);
    const sau = await khoanSai();
    expect(sau).toHaveLength(2); // KHÔNG xoá cứng
    const bo = <T extends Record<string, unknown>>(x: T) => Object.fromEntries(Object.entries(x).filter(([k]) => !["deletedAt", "enrollmentId", "updatedAt"].includes(k)));
    expect(sau.map(bo)).toEqual(saiTruoc.map(bo));
    for (const k of sau) {
      expect(k.deletedAt?.toISOString(), k.id).toBe(MOC.toISOString());
      expect(k.enrollmentId, k.id).toBeNull();
    }
    expect(await db.orderItem.findMany({ where: { orderId: ID.oSai } })).toEqual(dongSaiTruoc);
    const ls = await db.orderStatusHistory.findMany({ where: { orderId: ID.oSai } });
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ fromStatus: "CONFIRMED", toStatus: "CANCELLED", changedByUserId: null });

    // đơn đúng + mọi thứ khác: y nguyên
    expect(await chupDung()).toEqual(dungTruoc);
    expect(await anhChupBatBienXuLy(db)).toBe(anhTruoc);
    expect(await db.receipt.count({ where: { paymentId: { startsWith: P } } })).toBe(0);
    expect(await db.payment.count({ where: { orderId: ID.oDung, deletedAt: null } })).toBe(2);
    expect(await db.payment.count({ where: { orderId: ID.oDung, deletedAt: { not: null } } })).toBe(1);

    // audit
    expect(await soAudit("UPDATE")).toBe(3);
    expect(await soAudit("WAVE_X_XU_LY_DON_SAI_LUOT_CHAY")).toBe(1);
    expect(await soClaim()).toBe(1);
    const a = await db.auditLog.findFirstOrThrow({ where: { action: "UPDATE", entityId: ID.kB } });
    expect(a.oldValues).toEqual({ deletedAt: null, enrollmentId: ID.enr });
    expect(a.newValues).toMatchObject({ enrollmentId: null, soTien: 9_424_000, maDon: MA_DON_SAI, source: "wave-x-xu-ly-don-backfill-sai" });
    const luot = await db.auditLog.findFirstOrThrow({ where: { action: "WAVE_X_XU_LY_DON_SAI_LUOT_CHAY" } });
    expect(luot.newValues).toMatchObject({ expectedCount: 3, actualCount: 3, khop: true, keHoachSha: kh.sha });
  });

  it("[XDS-DB-02] IDEMPOTENT: chạy lại sau khi ghi ⇒ 0 dòng ghi, KHÔNG qua cổng, KHÔNG claim, KHÔNG audit thêm — kể cả khi không có artifact", async () => {
    const kh = await kehoach();
    await ghiXuLy(db, nhap(kh, CG(kh)));
    const truocAudit = await db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9830001" } }] } });
    const claim = await soClaim();
    const ky2 = await kehoach();
    expect(ky2.daXuLy).toBe(true);
    expect(ky2.ghi).toEqual([]);
    expect(ky2.sha).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    const congRong: DauVaoCongGhi = { artifact: null, publicKeyPem: "", keyIdTinCay: "", moiTruong: "", ownerIdentities: null, now: MOC, runRef: "x" };
    const r = await ghiXuLy(db, nhap(ky2, congRong, { soDuyet: 0 }));
    expect(r).toMatchObject({ daGhi: 0, daXuLy: true });
    expect(await db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:9830001" } }] } })).toBe(truocAudit);
    expect(await soClaim()).toBe(claim);
    expect(await db.orderStatusHistory.count({ where: { orderId: ID.oSai } })).toBe(1);
  });

  it("[XDS-DB-03] CỔNG KÝ: thiếu artifact / ký cho workflow KHÁC (C-A · C-B · C-C) / dòng khác / sai môi trường / khoá không ghim ⇒ từ chối TRƯỚC phép ghi đầu tiên, không ghi gì, 0 claim", async () => {
    const kh = await kehoach();
    const cong0 = CG(kh);
    const CASES: Array<[string, DauVaoCongGhi, string]> = [
      ["thiếu artifact", { ...cong0, artifact: null }, "THIEU_ARTIFACT"],
      ["workflow C-A", CG(kh, { workflowKy: WORKFLOW_WAVE1.waveCGanDanhTinh }), "SAI_WORKFLOW"],
      ["workflow C-B", CG(kh, { workflowKy: WORKFLOW_WAVE1.waveCSuaGia }), "SAI_WORKFLOW"],
      ["workflow C-C (artifact gắn khoản KHÔNG dùng được ở đây)", CG(kh, { workflowKy: WORKFLOW_WAVE1.waveCGanPayment }), "SAI_WORKFLOW"],
      ["dòng khác (plan SHA lệch)", CG(kh, { rowsKy: kh.dongDauRa.slice(0, 2) }), "LECH_DIGEST"],
      ["môi trường", CG(kh, { moiTruongKy: "prod" }), "SAI_MOI_TRUONG"],
      ["chưa ghim khoá", { ...cong0, keyIdTinCay: "" }, "KHOA_KHONG_KHOP"],
    ];
    for (const [ten, cong, ma] of CASES) {
      const e = await thuLoi(ghiXuLy(db, nhap(kh, cong)));
      expect(e, ten).toBeInstanceOf(CongGhiTuChoi);
      expect((e as CongGhiTuChoi).ma, ten).toBe(ma);
      await khongGhiGi();
    }
    expect(await soClaim()).toBe(0);
    expect(await soAudit("UPDATE")).toBe(0);
  });

  it.each([
    ["đơn sai KHÔNG còn CONFIRMED", async () => { await db.order.update({ where: { id: ID.oSai }, data: { status: "PENDING_PAYMENT" } }); }, "DON_SAI_TRANG_THAI"],
    ["tổng đơn sai trôi", async () => { await db.order.update({ where: { id: ID.oSai }, data: { totalAmount: TONG_DON_SAI + 1 } }); }, "DON_SAI_TONG_LECH"],
    ["đơn sai đã xoá mềm", async () => { await db.order.update({ where: { id: ID.oSai }, data: { deletedAt: new Date("2026-10-01T00:00:00Z") } }); }, "DON_SAI_DA_XOA_MEM"],
    ["đơn sai KHÁC học viên", async () => {
      await db.student.create({ data: { id: `${P}s1`, name: "HV khác", centerId: CS1, parentPhone: "0988000002" } });
      await db.order.update({ where: { id: ID.oSai }, data: { studentId: `${P}s1` } });
    }, "DON_SAI_KHAC_HOC_VIEN"],
    ["khoản đã được kế toán XÁC NHẬN (có thể là tiền thật)", async () => { await db.payment.update({ where: { id: ID.kA }, data: { accountantStatus: "CONFIRMED" } }); }, "KHOAN_KHONG_PHAI_BACKFILL"],
    ["khoản không phải method backfill", async () => { await db.payment.update({ where: { id: ID.kB }, data: { method: "sepay" } }); }, "KHOAN_KHONG_PHAI_BACKFILL"],
    ["thêm khoản thứ ba vào đơn sai", async () => { await db.payment.create({ data: { id: `${P}k_c`, orderId: ID.oSai, orderItemId: ID.itSai, amount: 5, method: "backfill", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "PENDING", centerId: CS1, enrollmentId: ID.enr } }); }, "TAP_KHOAN_LECH"],
    ["khoản gắn ghi danh KHÁC", async () => {
      await db.class.create({ data: { id: `${P}lop2`, name: "Lớp XDS 2", courseId: KHOA } });
      await db.enrollment.create({ data: { id: `${P}e1`, studentId: `${P}s0`, classId: `${P}lop2`, courseId: KHOA, status: "ACTIVE", centerId: CS1 } });
      await db.payment.update({ where: { id: ID.kA }, data: { enrollmentId: `${P}e1` } });
    }, "KHOAN_GAN_SAI"],
    ["dòng đơn sai đã gắn ghi danh", async () => { await db.orderItem.update({ where: { id: ID.itSai }, data: { enrollmentId: ID.enr } }); }, "DONG_DON_LECH"],
    ["đã có PHIẾU THU (PaymentRequest) trên đơn sai", async () => { await db.paymentRequest.create({ data: { id: `${P}pr_sai`, orderId: ID.oSai, centerId: CS1, installmentNo: 1, amountDue: 100 } }); }, "CO_PHU_THUOC"],
    ["đã có RECEIPT trên một khoản sai", async () => { await db.receipt.create({ data: { id: `${P}rc`, code: `${P}RCP`, paymentId: ID.kA } }); }, "CO_PHU_THUOC"],
    ["đơn sai có bút toán điều chỉnh trỏ vào khoản", async () => { await db.payment.create({ data: { id: `${P}k_adj`, orderId: ID.oDung, orderItemId: ID.itDung, amount: -1, method: "cash", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "PENDING", centerId: CS1, adjustmentOfId: ID.kA, paymentType: "ADJUSTMENT" } }); }, "CO_PHU_THUOC"],
    ["xử lý DỞ: một khoản đã xoá mềm, đơn còn CONFIRMED", async () => { await db.payment.update({ where: { id: ID.kA }, data: { deletedAt: MOC, enrollmentId: null } }); }, "TRANG_THAI_LAI"],
  ])("[XDS-DB-04] FAIL-CLOSED: %s ⇒ KHÔNG ghi gì, không claim", async (_ten, lamHong, ma) => {
    const kh0 = await kehoach();
    const cong = CG(kh0);
    await lamHong();
    const truoc = await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } });
    const orderTruoc = await donSai();
    const kh = await kehoach();
    expect(kh.dung).toBe(true);
    expect(kh.loi.map((x) => x.ma)).toContain(ma);
    expect(kh.ghi).toEqual([]);
    const e = await thuLoi(ghiXuLy(db, nhap(kh0, cong)));
    expect(String(e)).toMatch(/DỪNG/);
    expect(String(e)).toContain(ma);
    expect(await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(truoc);
    expect(await donSai()).toEqual(orderTruoc);
    expect(await db.orderStatusHistory.count({ where: { orderId: ID.oSai } })).toBe(0);
    expect(await soClaim()).toBe(0);
    expect(await soAudit("UPDATE")).toBe(0);
  });

  it("[XDS-DB-05] TRANSACTION TOÀN LÔ: lỗi ở phép ghi CUỐI (trigger ném khi UPDATE đơn sai) ⇒ hai khoản đã xoá mềm trước đó cũng LÙI; claim lùi theo; không dòng lịch sử", async () => {
    await db.$executeRawUnsafe(`CREATE FUNCTION xds_boom() RETURNS trigger AS $f$ BEGIN RAISE EXCEPTION 'XDS_BOOM'; END $f$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER xds_boom_trg BEFORE UPDATE ON "Order" FOR EACH ROW WHEN (NEW.id = '${ID.oSai}') EXECUTE FUNCTION xds_boom()`);
    const kh = await kehoach();
    const e = await thuLoi(ghiXuLy(db, nhap(kh, CG(kh))));
    expect(String(e)).toMatch(/XDS_BOOM/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
    expect(await soAudit("UPDATE")).toBe(0);
    expect(await soAudit("WAVE_X_XU_LY_DON_SAI_LUOT_CHAY")).toBe(0);
  });

  it("[XDS-DB-06] TRÔI giữa kế hoạch và ghi (một khoản vừa được kế toán xác nhận sau khi đã ký) ⇒ cổng TRONG tx bắt, cả lô lùi, không claim", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await db.payment.update({ where: { id: ID.kB }, data: { accountantStatus: "CONFIRMED" } });
    const e = await thuLoi(db.$transaction((tx) => ghiXuLyTrongTx(tx, nhap(kh, cong))));
    expect(String(e)).toMatch(/KHOAN_KHONG_PHAI_BACKFILL|DỪNG/);
    await db.payment.update({ where: { id: ID.kB }, data: { accountantStatus: "PENDING" } });
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[XDS-DB-07] SAI --expect / thiếu --expect / thiếu quyền ghi ⇒ từ chối TRƯỚC khi mở transaction ghi", async () => {
    const kh = await kehoach();
    await expect(ghiXuLy(db, nhap(kh, CG(kh), { soDuyet: 2 }))).rejects.toThrow(/≠ kế hoạch/);
    await expect(ghiXuLy(db, nhap(kh, CG(kh), { soDuyet: null }))).rejects.toThrow(/đòi --expect/);
    await expect(ghiXuLy(db, nhap(kh, CG(kh), { ghiDuoc: false }))).rejects.toThrow(/không có quyền UPDATE/);
    await expect(ghiXuLy(db, nhap(kh, CG(kh), { ghiDuoc: null }))).rejects.toThrow(/Không kiểm được/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[XDS-DB-08] BẤT BIẾN: nếu phép ghi VÔ TÌNH kéo theo đổi số tiền một khoản của ĐƠN ĐÚNG (trigger giả lập tác dụng phụ) ⇒ ảnh chụp sau ≠ trước ⇒ throw, cả lô lùi", async () => {
    await db.$executeRawUnsafe(
      `CREATE FUNCTION xds_leak() RETURNS trigger AS $f$ BEGIN UPDATE "Payment" SET note = 'sửa' WHERE id = '${P}d_2'; RETURN NEW; END $f$ LANGUAGE plpgsql`,
    );
    await db.$executeRawUnsafe(`CREATE TRIGGER xds_leak_trg BEFORE UPDATE ON "Order" FOR EACH ROW WHEN (NEW.id = '${ID.oSai}') EXECUTE FUNCTION xds_leak()`);
    const kh = await kehoach();
    const e = await thuLoi(ghiXuLy(db, nhap(kh, CG(kh))));
    expect(String(e)).toMatch(/Ảnh chụp bất biến/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
    expect((await db.payment.findUniqueOrThrow({ where: { id: `${P}d_2` } })).note).toBeNull();
  });

  it("[XDS-DB-09] REPLAY nonce: dùng lại ĐÚNG artifact đã dùng (khôi phục đơn về trạng thái chưa xử lý) ⇒ DA_DUNG, không xử lý lần hai", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await ghiXuLy(db, nhap(kh, cong));
    await db.orderStatusHistory.deleteMany({ where: { orderId: ID.oSai } });
    await db.order.update({ where: { id: ID.oSai }, data: { status: "CONFIRMED" } });
    await db.payment.updateMany({ where: { orderId: ID.oSai }, data: { deletedAt: null, enrollmentId: ID.enr } });
    const kh2 = await kehoach();
    expect(kh2.dongDauRa).toEqual(kh.dongDauRa);
    const e = await thuLoi(ghiXuLy(db, nhap(kh2, cong)));
    expect(e).toBeInstanceOf(CongGhiTuChoi);
    expect((e as CongGhiTuChoi).ma).toBe("DA_DUNG");
    await khongGhiGi();
  });

  it("[XDS-DB-10] KIỂM SAU GHI: trước ghi ⇒ chưa đạt; sau ghi ⇒ ĐẠT (đơn sai CANCELLED · 0 khoản sống · 0 Payment ngoài trên ghi danh đích · đơn đúng còn 2 sống + 1 xoá mềm); mất một khoản thật của đơn đúng ⇒ KHÔNG đạt", async () => {
    const truoc = await kiemSauGhiXuLy(db);
    expect(truoc.dat).toBe(false);
    expect(truoc.khoanSaiSong).toBe(2);
    expect(truoc.khoanNgoaiTrenGhiDanhDich).toBe(2);
    const kh = await kehoach();
    await ghiXuLy(db, nhap(kh, CG(kh)));
    const sau = await kiemSauGhiXuLy(db);
    expect(sau).toMatchObject({ dat: true, donSaiTrangThai: "CANCELLED", khoanSaiSong: 0, khoanNgoaiTrenGhiDanhDich: 0, khoanDungSong: 2, khoanDungXoaMem: 1 });
    expect(sau.keHoach.daXuLy).toBe(true);
    // đối chứng âm: một khoản THẬT của đơn đúng biến mất ⇒ kiểm sau phải bắt
    await db.payment.update({ where: { id: `${P}d_2` }, data: { deletedAt: MOC } });
    const hong = await kiemSauGhiXuLy(db);
    expect(hong.dat).toBe(false);
    expect(hong.khoanDungSong).toBe(1);
  });
});
