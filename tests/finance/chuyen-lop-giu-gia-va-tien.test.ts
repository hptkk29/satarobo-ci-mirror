// tests/finance/chuyen-lop-giu-gia-va-tien.test.ts — [CLG-*] CHUYỂN LỚP CÙNG KHOÁ: GIÁ + KHOẢN THU + DÒNG ĐƠN ĐI THEO GHI DANH MỚI, trên Postgres THẬT (P7-G2, 27/10/2026).
//
// Chạy:  pnpm test:finance-db   (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET). `pnpm test:unit` trần SKIP — log «SKIP» nghĩa là CHƯA kiểm gì.
// Gọi THẲNG `chuyenLopTrongTx` / `approveTransfer` — mã THẬT: transaction, khoá hàng, mang giá. Fixture tổng hợp tiền tố `fx-clg-`, KHÔNG dữ liệu thật; KHÔNG `resetDb()`; mỗi ca tự dựng lại (chạy MỘT MÌNH vẫn xanh — luật 18).
//
// Luật đang khoá (lib/enrollments/di-theo-gia-va-tien.ts):
//   cùng khoá ⇒ năm cột giá + mọi Payment chưa xoá + dòng đơn đi từ ghi danh cũ sang ghi danh mới; Receipt + CommissionLine ở NGUYÊN ghi danh cũ; không Payment/Order mới; tổng giá và tổng tiền không đổi;
//   khác khoá / F4 (`KHONG_DOI`) ⇒ không dời; ghi danh cũ có bảo lưu ⇒ không dời + để dấu vết; hai lượt chuyển cùng một ghi danh ⇒ chỉ một thành công; lỗi giữa chừng ⇒ cuộn ngược sạch.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { ChuyenLopError, chuyenLopTrongTx } from "@/lib/enrollments/chuyen-lop";
import { approveTransfer } from "@/lib/transfer/service";
import { KHOAN_DA_XAC_NHAN } from "@/lib/finance/debt";

if (!RUN_DB_TESTS) console.warn(`[CLG] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const T = "fx-clg-";
const CS = `${T}cs`;
const KHOA = `${T}khoa`;
const KHOA_KHAC = `${T}khoa-khac`;
const LOP_A = `${T}lop-a`;
const LOP_B = `${T}lop-b`;
const LOP_C = `${T}lop-c`;
const LOP_KHAC = `${T}lop-khac`;
const HV = `${T}hv`;
const DON = `${T}don`;
const DONG = `${T}dong`;
const GD_A = `${T}gd-a`;
const ACTOR = { id: null, name: "fixture chuyển lớp" } as const;
const GIA = { listPrice: 5_280_000, discountType: "PERCENT", discountAmount: 264_000, tuition: 5_016_000, finalPrice: 5_016_000 };
const TRONG = { listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null };
const NGAY_THU = new Date("2026-09-20T03:00:00.000Z");
const TIEN = [2_508_000, 2_508_000] as const;
const TONG_TIEN = TIEN.reduce((s, x) => s + x, 0);

async function don() {
  const gdIds = (await db.enrollment.findMany({ where: { studentId: HV }, select: { id: true } })).map((e) => e.id);
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: T } }, { entityId: { in: gdIds } }] } });
  await db.enrollmentAuditLog.deleteMany({ where: { enrollmentId: { in: gdIds } } });
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS clg_boom_trg ON "Payment"`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS clg_boom()`);
  await boCham();
  await db.receipt.deleteMany({ where: { id: { startsWith: T } } });
  await db.commissionLine.deleteMany({ where: { id: { startsWith: T } } });
  await db.commissionStatement.deleteMany({ where: { id: { startsWith: T } } });
  await db.studentReserve.deleteMany({ where: { id: { startsWith: T } } });
  await db.studentTransferRequest.deleteMany({ where: { id: { startsWith: T } } });
  await db.payment.deleteMany({ where: { id: { startsWith: T } } });
  await db.orderItem.deleteMany({ where: { orderId: { startsWith: T } } });
  await db.order.deleteMany({ where: { id: { startsWith: T } } });
  await db.enrollment.updateMany({ where: { studentId: HV }, data: { transferredToId: null } });
  await db.enrollment.deleteMany({ where: { studentId: HV } });
  await db.student.deleteMany({ where: { id: HV } });
  await db.conversation.deleteMany({ where: { subjectType: "CLASS", subjectId: { in: [LOP_A, LOP_B, LOP_C, LOP_KHAC] } } });
  await db.class.deleteMany({ where: { id: { in: [LOP_A, LOP_B, LOP_C, LOP_KHAC] } } });
  await db.course.deleteMany({ where: { id: { in: [KHOA, KHOA_KHAC] } } });
  await db.center.deleteMany({ where: { id: CS } });
}

/** Làm CHẬM phép tạo ghi danh của học viên fixture (0,4 giây) để hai transaction THẬT SỰ chồng nhau — không có nó, lượt đầu xong trước khi lượt sau kịp bắt đầu và ca đồng thời xanh vì lý do sai. */
async function lamCham() {
  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION clg_cham() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.4); RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await db.$executeRawUnsafe(`CREATE TRIGGER clg_cham_trg BEFORE INSERT ON "Enrollment" FOR EACH ROW WHEN (NEW."studentId" = '${HV}') EXECUTE FUNCTION clg_cham()`);
}
async function boCham() {
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS clg_cham_trg ON "Enrollment"`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS clg_cham()`);
}

async function dung(o: { pending?: boolean; baoLuu?: boolean } = {}) {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở CLG", slug: `${T}cs`, address: "x" } });
  await db.course.create({ data: { id: KHOA, name: "Khoá CLG", slug: `${T}khoa`, totalSessions: 48, price: 10_560_000 } });
  await db.course.create({ data: { id: KHOA_KHAC, name: "Khoá khác CLG", slug: `${T}khoa-khac`, totalSessions: 48, price: 10_560_000 } });
  for (const [lop, khoa] of [[LOP_A, KHOA], [LOP_B, KHOA], [LOP_C, KHOA], [LOP_KHAC, KHOA_KHAC]] as const) {
    await db.class.create({ data: { id: lop, name: `Lớp ${lop}`, courseId: khoa, centerId: CS } });
  }
  await db.student.create({ data: { id: HV, name: "Học viên CLG", centerId: CS, parentPhone: "0988000099" } });
  await db.enrollment.create({ data: { id: GD_A, studentId: HV, classId: LOP_A, courseId: KHOA, status: "STUDYING", centerId: CS, ...GIA } });
  await db.order.create({
    data: { id: DON, code: `${T}ORD`, type: "COURSE", status: "PENDING_PAYMENT", customerName: "PH CLG", customerPhone: "0988000099", subtotal: 5_280_000, discountAmount: 264_000, totalAmount: 5_016_000, centerId: CS, createdAt: new Date("2026-09-17T03:00:00Z") },
  });
  await db.orderItem.create({
    data: { id: DONG, orderId: DON, type: "COURSE_ENROLLMENT", itemName: "Khoá CLG", quantity: 1, unitPrice: 5_280_000, totalPrice: 5_280_000, metadata: { courseId: KHOA }, enrollmentId: GD_A },
  });
  for (let k = 0; k < TIEN.length; k++) {
    await db.payment.create({
      data: {
        id: `${T}p${k}`, orderId: DON, orderItemId: DONG, amount: TIEN[k]!, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED",
        accountantStatus: k === 1 && o.pending ? "PENDING" : "CONFIRMED", centerId: CS, enrollmentId: GD_A,
      },
    });
  }
  await db.receipt.create({ data: { id: `${T}rc`, code: `${T}RCP-1`, enrollmentId: GD_A, paymentId: `${T}p0` } });
  await db.commissionStatement.create({ data: { id: `${T}st`, period: `${T}2026-10` } });
  await db.commissionLine.create({ data: { id: `${T}cl`, statementId: `${T}st`, recipientId: `${T}nguoi`, tier: "TRIAL_TEACHER", amount: 50_160, enrollmentId: GD_A } });
  if (o.baoLuu) await db.studentReserve.create({ data: { id: `${T}bl`, studentId: HV, enrollmentId: GD_A, reason: "fixture", createdByName: "fixture" } });
}

const chuyen = (cuId: string, lop: string, giaVaTien: "THEO_GHI_DANH" | "KHONG_DOI" = "THEO_GHI_DANH") =>
  db.$transaction((tx) => chuyenLopTrongTx(tx, { oldEnrollmentId: cuId, targetClassId: lop, reason: "fixture", actor: ACTOR, giaVaTien }));
const gia = (id: string) => db.enrollment.findUniqueOrThrow({ where: { id }, select: { listPrice: true, discountType: true, discountAmount: true, tuition: true, finalPrice: true } });
const khoanCua = (id: string) => db.payment.count({ where: { enrollmentId: id, deletedAt: null } });
const daThu = async (id: string) => (await db.payment.aggregate({ where: { enrollmentId: id, ...KHOAN_DA_XAC_NHAN }, _sum: { amount: true } }))._sum.amount ?? 0;
const demBang = async () => ({
  payment: await db.payment.count({ where: { orderId: DON } }),
  order: await db.order.count({ where: { id: { startsWith: T } } }),
  receipt: await db.receipt.count({ where: { id: { startsWith: T } } }),
  hoaHong: await db.commissionLine.count({ where: { id: { startsWith: T } } }),
});
/** Tổng giá và tổng tiền (xác nhận + mọi trạng thái) của MỌI ghi danh của học viên — phải đứng yên qua mọi lượt chuyển. */
const tong = async () => {
  const gd = await db.enrollment.aggregate({ where: { studentId: HV, deletedAt: null }, _sum: { finalPrice: true } });
  const ts = await db.payment.aggregate({ where: { orderId: DON, deletedAt: null }, _sum: { amount: true } });
  return { gia: gd._sum.finalPrice ?? 0, tien: ts._sum.amount ?? 0 };
};
const thuLoi = (p: Promise<unknown>) => p.then(() => null, (x: unknown) => x);

describe.skipIf(!RUN_DB_TESTS)("[CLG] chuyển lớp cùng khoá — giá + khoản thu + dòng đơn đi theo ghi danh mới", () => {
  beforeEach(async () => {
    await dung();
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[CLG-01] cùng khoá: giá, mọi khoản thu và dòng đơn sang ghi danh MỚI; ghi danh cũ về NULL; biên lai + hoa hồng ở nguyên ghi danh cũ; không Payment/Order mới; tổng và nợ không đổi", async () => {
    const truoc = { bang: await demBang(), tong: await tong(), no: GIA.finalPrice - (await daThu(GD_A)) };
    const kq = await chuyen(GD_A, LOP_B);
    expect(kq.giaVaTien).toMatchObject({ daDoi: true, soKhoan: 2, tongTien: TONG_TIEN, soDongDon: 1, giaDiTheo: true });
    const moi = kq.newEnrollmentId;
    expect(await gia(moi)).toEqual(GIA);
    expect(await gia(GD_A)).toEqual(TRONG);
    expect(await khoanCua(moi)).toBe(2);
    expect(await khoanCua(GD_A)).toBe(0);
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: DONG } })).enrollmentId).toBe(moi);
    // Chứng từ đứng yên.
    expect((await db.receipt.findUniqueOrThrow({ where: { id: `${T}rc` } })).enrollmentId).toBe(GD_A);
    expect((await db.commissionLine.findUniqueOrThrow({ where: { id: `${T}cl` } })).enrollmentId).toBe(GD_A);
    // Số tiền / ngày / trạng thái của từng khoản không đổi.
    for (let k = 0; k < TIEN.length; k++) {
      const p = await db.payment.findUniqueOrThrow({ where: { id: `${T}p${k}` } });
      expect([p.amount, p.paidDate.toISOString(), p.accountantStatus, p.saleStatus]).toEqual([TIEN[k], NGAY_THU.toISOString(), "CONFIRMED", "RECORDED"]);
    }
    expect(await demBang()).toEqual(truoc.bang);
    expect(await tong()).toEqual(truoc.tong);
    expect(GIA.finalPrice - (await daThu(moi))).toBe(truoc.no);
    // Dây nối cũ → mới còn đó; ghi danh cũ đã TRANSFERRED.
    expect(await db.enrollment.findUniqueOrThrow({ where: { id: GD_A }, select: { status: true, transferredToId: true } })).toEqual({ status: "TRANSFERRED", transferredToId: moi });
    // Dấu vết: mỗi khoản + hai ghi danh + dòng đơn.
    expect(await db.auditLog.count({ where: { action: "CHUYEN_LOP_DOI_KHOAN_THEO_GHI_DANH", entityId: { startsWith: T } } })).toBe(2);
    expect(await db.auditLog.count({ where: { action: "CHUYEN_LOP_DOI_GIA_THEO_GHI_DANH", entityId: { in: [GD_A, moi] } } })).toBe(2);
    expect(await db.auditLog.count({ where: { action: "CHUYEN_LOP_DOI_DONG_DON_THEO_GHI_DANH", entityId: DONG } })).toBe(1);
  });

  it("[CLG-02] chuỗi A→B→C: mỗi bước chỉ MỘT ghi danh giữ giá; tổng giá, tổng tiền, nợ đứng yên", async () => {
    const truoc = await tong();
    const b = (await chuyen(GD_A, LOP_B)).newEnrollmentId;
    const c = (await chuyen(b, LOP_C)).newEnrollmentId;
    expect(await gia(c)).toEqual(GIA);
    expect(await gia(b)).toEqual(TRONG);
    expect(await gia(GD_A)).toEqual(TRONG);
    expect([await khoanCua(c), await khoanCua(b), await khoanCua(GD_A)]).toEqual([2, 0, 0]);
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: DONG } })).enrollmentId).toBe(c);
    expect(await tong()).toEqual(truoc);
    expect(GIA.finalPrice - (await daThu(c))).toBe(0);
    const chuoi = await db.enrollment.findMany({ where: { id: { in: [GD_A, b] } }, select: { id: true, transferredToId: true } });
    expect(Object.fromEntries(chuoi.map((e) => [e.id, e.transferredToId]))).toEqual({ [GD_A]: b, [b]: c });
  });

  it("[CLG-03] khoản CHƯA xác nhận đi theo, nhưng KHÔNG tính vào đã thu (nợ giữ nguyên)", async () => {
    await dung({ pending: true });
    const noTruoc = GIA.finalPrice - (await daThu(GD_A));
    expect(noTruoc).toBe(TIEN[1]);
    const moi = (await chuyen(GD_A, LOP_B)).newEnrollmentId;
    expect(await khoanCua(moi)).toBe(2);
    expect(GIA.finalPrice - (await daThu(moi))).toBe(noTruoc);
  });

  it("[CLG-04] KHÁC KHOÁ (THEO_GHI_DANH) và F4 (KHONG_DOI): không dời gì", async () => {
    const khac = await chuyen(GD_A, LOP_KHAC);
    expect(khac.giaVaTien).toEqual({ daDoi: false, ma: "KHAC_KHOA" });
    expect(await gia(GD_A)).toEqual(GIA);
    expect(await khoanCua(GD_A)).toBe(2);
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: DONG } })).enrollmentId).toBe(GD_A);
    await dung();
    const f4 = await chuyen(GD_A, LOP_B, "KHONG_DOI");
    expect(f4.giaVaTien).toBeNull();
    expect(await gia(GD_A)).toEqual(GIA);
    expect(await gia(f4.newEnrollmentId)).toEqual(TRONG);
    expect(await khoanCua(GD_A)).toBe(2);
  });

  it("[CLG-05] ĐỒNG THỜI: hai lượt chuyển cùng một ghi danh sang hai lớp — đúng MỘT thành công, giá chỉ ở một ghi danh, không nợ nhân đôi", async () => {
    const truoc = await tong();
    await lamCham();
    const kq = await Promise.allSettled([chuyen(GD_A, LOP_B), chuyen(GD_A, LOP_C)]);
    await boCham();
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const loi = kq.find((k) => k.status === "rejected") as PromiseRejectedResult;
    expect(loi.reason).toBeInstanceOf(ChuyenLopError);
    const moi = await db.enrollment.findMany({ where: { studentId: HV, id: { not: GD_A }, deletedAt: null }, select: { id: true, finalPrice: true } });
    expect(moi).toHaveLength(1); // lượt thua cuộn ngược sạch: không để lại ghi danh mồ côi
    expect(moi[0]!.finalPrice).toBe(GIA.finalPrice);
    expect(await tong()).toEqual(truoc);
    expect(await khoanCua(moi[0]!.id)).toBe(2);
  });

  it("[CLG-06] IDEMPOTENT: chuyển lại ghi danh đã TRANSFERRED bị từ chối, không đổi gì", async () => {
    const moi = (await chuyen(GD_A, LOP_B)).newEnrollmentId;
    const truoc = { bang: await demBang(), tong: await tong() };
    expect(await thuLoi(chuyen(GD_A, LOP_C))).toBeInstanceOf(ChuyenLopError);
    expect(await demBang()).toEqual(truoc.bang);
    expect(await tong()).toEqual(truoc.tong);
    expect(await gia(moi)).toEqual(GIA);
    expect(await db.enrollment.count({ where: { studentId: HV } })).toBe(2);
  });

  it("[CLG-07] CHUYỂN NGƯỢC về lớp cũ: vẫn BỊ CHẶN (chỉ mục duy nhất + dòng TRANSFERRED là nguồn chuỗi), cuộn ngược sạch, giá/tiền ở ghi danh đang học", async () => {
    const b = (await chuyen(GD_A, LOP_B)).newEnrollmentId;
    const e = await thuLoi(chuyen(b, LOP_A));
    expect(e).toBeInstanceOf(ChuyenLopError);
    expect(String((e as Error).message)).toContain("đã có ghi danh ở lớp đích");
    expect(await db.enrollment.count({ where: { studentId: HV } })).toBe(2);
    expect(await gia(b)).toEqual(GIA);
    expect(await khoanCua(b)).toBe(2);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: b } })).status).not.toBe("TRANSFERRED");
  });

  it("[CLG-08] LỖI GIỮA CHỪNG (khoản thu bị chặn khi dời): cuộn ngược cả chuyển lớp — không ghi danh mới, ghi danh cũ còn STUDYING có giá + tiền", async () => {
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION clg_boom() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'clg boom'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER clg_boom_trg BEFORE UPDATE OF "enrollmentId" ON "Payment" FOR EACH ROW WHEN (OLD.id LIKE '${T}%') EXECUTE FUNCTION clg_boom()`);
    const truoc = await tong();
    expect(await thuLoi(chuyen(GD_A, LOP_B))).not.toBeNull();
    expect(await db.enrollment.count({ where: { studentId: HV } })).toBe(1);
    expect(await db.enrollment.findUniqueOrThrow({ where: { id: GD_A }, select: { status: true, transferredToId: true } })).toEqual({ status: "STUDYING", transferredToId: null });
    expect(await gia(GD_A)).toEqual(GIA);
    expect(await khoanCua(GD_A)).toBe(2);
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: DONG } })).enrollmentId).toBe(GD_A);
    expect(await tong()).toEqual(truoc);
    expect(await db.auditLog.count({ where: { entityId: { startsWith: T }, action: { startsWith: "CHUYEN_LOP_" } } })).toBe(0);
  });

  it("[CLG-09] ghi danh cũ có BẢO LƯU: chuyển lớp vẫn xong nhưng KHÔNG dời giá/tiền, và để dấu vết cho kế toán", async () => {
    await dung({ baoLuu: true });
    const kq = await chuyen(GD_A, LOP_B);
    expect(kq.giaVaTien).toEqual({ daDoi: false, ma: "CO_HOAN_TIEN_HOAC_BAO_LUU" });
    expect(await gia(GD_A)).toEqual(GIA);
    expect(await khoanCua(GD_A)).toBe(2);
    expect(await gia(kq.newEnrollmentId)).toEqual(TRONG);
    expect(await db.auditLog.count({ where: { action: "CHUYEN_LOP_KHONG_DI_THEO_GIA_VA_TIEN", entityId: GD_A } })).toBe(1);
  });

  it("[CLG-10] /chuyen-lop (approveTransfer): ghi `transferredToId`, giá + khoản thu + dòng đơn đi theo; duyệt LẠI bị từ chối, không đẻ ghi danh thứ hai", async () => {
    const req = await db.studentTransferRequest.create({ data: { id: `${T}yc`, studentId: HV, fromClassId: LOP_A, toClassId: LOP_B, fromCenterId: CS, toCenterId: CS, status: "PENDING", reason: "fixture" } });
    const truoc = await tong();
    expect(await approveTransfer(req.id, null, "ok")).toEqual({ ok: true });
    const moi = await db.enrollment.findFirstOrThrow({ where: { studentId: HV, classId: LOP_B, deletedAt: null }, select: { id: true } });
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD_A } })).transferredToId).toBe(moi.id);
    expect(await gia(moi.id)).toEqual(GIA);
    expect(await gia(GD_A)).toEqual(TRONG);
    expect(await khoanCua(moi.id)).toBe(2);
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: DONG } })).enrollmentId).toBe(moi.id);
    expect(await tong()).toEqual(truoc);
    // Duyệt lại + duyệt song song: không thêm ghi danh nào.
    const lai = await Promise.all([approveTransfer(req.id, null), approveTransfer(req.id, null)]);
    expect(lai.every((r) => r.ok === false)).toBe(true);
    expect(await db.enrollment.count({ where: { studentId: HV } })).toBe(2);
  });

  it("[CLG-11] /chuyen-lop: hai người duyệt CÙNG LÚC — đúng một lượt thắng, không nhân đôi giá", async () => {
    const req = await db.studentTransferRequest.create({ data: { id: `${T}yc`, studentId: HV, fromClassId: LOP_A, toClassId: LOP_B, fromCenterId: CS, toCenterId: CS, status: "PENDING", reason: "fixture" } });
    const truoc = await tong();
    await lamCham();
    const kq = await Promise.all([approveTransfer(req.id, null), approveTransfer(req.id, null)]);
    await boCham();
    expect(kq.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.enrollment.count({ where: { studentId: HV } })).toBe(2);
    expect(await tong()).toEqual(truoc);
  });
});
