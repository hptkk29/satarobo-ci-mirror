// tests/finance/doi-khoa.test.ts — F4 · US-20 trên Postgres THẬT.
//
// Chạy: `pnpm test:finance-db`. `pnpm test:unit` trần sẽ SKIP (thiếu `ALLOW_DB_RESET=1`).
//
// Hình dạng fixture = TS-41 (`docs/thanh-toan-linh-hoat/05-TestScenarios…`):
//   *"Bình học 20 buổi, đổi sang khoá giả định 600.000 (tổng). Kỳ vọng: ghi danh cũ STOPPED,
//   dư 1.000.000; ghi danh mới nhận 600.000 (còn nợ 0); ví +400.000; phí dừng 0 dù chính
//   sách có phí."*
//
// ─────────────────────────────────────────────────────────────────────────────
// THỨ BỘ NÀY KIỂM MÀ TEST THUẦN KHÔNG KIỂM ĐƯỢC
//
//   · NĂM phép ghi có chạy trong MỘT transaction không — và quan trọng hơn: hỏng ở bước
//     cuối có CUỘN NGƯỢC cả bốn bước trước không (luật rollback: `return` không cuộn ngược);
//   · dòng mới có được gắn `enrollmentId` không — không có thì khoản tiền chuyển sang nó
//     KHÔNG BAO GIỜ xuất được phiếu thu (`confirmPayment` từ chối);
//   · ghi danh cũ có sang `TRANSFERRED` và trỏ `transferredToId` đúng không;
//   · đợt chưa đóng của khoá cũ có bị VOID không, và đợt "còn thiếu" của khoá mới có đúng số;
//   · tiền có đi đúng ba ngả (sang dòng mới · yêu cầu hoàn · còn thiếu) và tổng có khớp.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { doiKhoaChoCon, xemTruocDoiKhoa } from "@/lib/finance/doi-khoa-db";
import { noTheoCon } from "@/lib/finance/debt";

if (!RUN_DB_TESTS) console.warn(`[DKD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-dkd-";
const ACTOR = { id: `${T}actor`, name: "Sale fixture DKD" };
const CENTER = `${T}center`;
const KHOA_CU = `${T}khoa-cu`;
const KHOA_MOI = `${T}khoa-moi`;
const KHOA_DAT = `${T}khoa-dat`;
const LOP_CU = `${T}lop-cu`;
const LOP_MOI = `${T}lop-moi`;
const LOP_DAT = `${T}lop-dat`;
const LOP_DAY = `${T}lop-day`;
const HS = `${T}hs`;
const GD_CU = `${T}gd-cu`;
const DON = `${T}don`;
const OI_CU = `${T}oi-cu`;

/** Khoá cũ: 40 buổi × 100.000 = 4.000.000. Bé học 20 buổi ⇒ đã dùng 2.000.000. */
const GIA_CU = 4_000_000;
const SO_BUOI_CU = 40;
const DON_GIA_CU = GIA_CU / SO_BUOI_CU;
/** Bé đã đóng 3.000.000 ⇒ dư 1.000.000 sau quyết toán — đúng TS-41. */
const DA_DONG = 3_000_000;
/** Khoá mới RẺ: 600.000 tổng (TS-41 gọi là "khoá giả định"). */
const GIA_MOI = 600_000;
/** Khoá ĐẮT: 5.000.000 — dùng cho nhánh "còn thiếu thành đợt". */
const GIA_DAT = 5_000_000;
const TRAN_PHAN_TRAM = 50;

/** Buổi 1..40, mỗi tuần một buổi, bắt đầu 2699-01-06. */
const NGAY_BUOI = (i: number) => new Date(Date.UTC(2699, 0, 6 + i * 7, 12, 30, 0));
const BUOI = (n: number) => `${T}buoi-${n}`;
/** Buổi cuối bé học = buổi 20. */
const BUOI_CUOI = BUOI(20);
/** Mốc "bây giờ" — sau buổi 20, trước buổi 21. Luật 19: test không đọc đồng hồ thật. */
const MOC = new Date(Date.UTC(2699, 0, 6 + 20 * 7, 0, 0, 0));

async function don() {
  await db.auditLog.deleteMany({
    where: { OR: [{ entityType: "Order", entityId: DON }, { actorId: ACTOR.id }] },
  });
  await db.refundRequest.deleteMany({ where: { orderItem: { orderId: DON } } });
  await db.refundRequest.deleteMany({
    where: { enrollment: { studentId: { in: [HS, `${T}hs-khac`] } } },
  });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.bankTransaction.deleteMany({ where: { id: `${T}txn` } });
  await db.qrSession.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  // ⚠️ Dọn ghi danh của CẢ HAI học viên. Bản đầu chỉ dọn của `HS` và bé "chiếm chỗ" ở lớp
  // đầy ở lại — `Enrollment_classId_fkey` là RESTRICT nên `class.deleteMany` nổ, và 17/18 ca
  // đỏ vì một lỗi DỌN chứ không vì mã sai.
  const HOC_VIEN = [HS, `${T}hs-khac`];
  await db.enrollmentAuditLog.deleteMany({
    where: { enrollment: { studentId: { in: HOC_VIEN } } },
  });
  await db.enrollment.deleteMany({ where: { studentId: { in: HOC_VIEN } } });
  await db.classSession.deleteMany({ where: { classId: LOP_CU } });
  await db.class.deleteMany({ where: { id: { in: [LOP_CU, LOP_MOI, LOP_DAT, LOP_DAY] } } });
  await db.student.deleteMany({ where: { id: { in: HOC_VIEN } } });
  await db.course.deleteMany({ where: { id: { in: [KHOA_CU, KHOA_MOI, KHOA_DAT] } } });
  await db.center.deleteMany({ where: { id: CENTER } });
}

async function dungFixture() {
  await don();
  await db.center.create({
    data: { id: CENTER, name: "Cơ sở fixture DKD", slug: `${T}cs`, address: "211 Nguyễn Hữu Thọ" },
  });
  await db.course.create({
    data: { id: KHOA_CU, name: "Sata 3 fixture DKD", slug: `${T}s3`, price: GIA_CU, totalSessions: SO_BUOI_CU },
  });
  await db.course.create({
    data: { id: KHOA_MOI, name: "Khoá ngắn fixture DKD", slug: `${T}ngan`, price: GIA_MOI, totalSessions: 6 },
  });
  await db.course.create({
    data: { id: KHOA_DAT, name: "Sata 5 fixture DKD", slug: `${T}s5`, price: GIA_DAT, totalSessions: 48 },
  });
  await db.class.create({
    data: { id: LOP_CU, name: "Lớp cũ DKD", courseId: KHOA_CU, centerId: CENTER, maxStudents: 12 },
  });
  await db.class.create({
    data: { id: LOP_MOI, name: "Lớp ngắn DKD", courseId: KHOA_MOI, centerId: CENTER, maxStudents: 12 },
  });
  await db.class.create({
    data: { id: LOP_DAT, name: "Lớp Sata 5 DKD", courseId: KHOA_DAT, centerId: CENTER, maxStudents: 12 },
  });
  // Lớp ĐÃ ĐẦY — sức chứa 1, đã có 1 bé khác.
  await db.class.create({
    data: { id: LOP_DAY, name: "Lớp đầy DKD", courseId: KHOA_MOI, centerId: CENTER, maxStudents: 1 },
  });

  await db.classSession.createMany({
    data: Array.from({ length: SO_BUOI_CU }, (_, i) => ({
      id: BUOI(i + 1),
      classId: LOP_CU,
      date: NGAY_BUOI(i),
      status: "SCHEDULED" as const,
    })),
  });

  await db.student.create({ data: { id: HS, name: "Bé Bình DKD", centerId: CENTER } });
  await db.enrollment.create({
    data: {
      id: GD_CU,
      studentId: HS,
      classId: LOP_CU,
      courseId: KHOA_CU,
      centerId: CENTER,
      status: "ACTIVE",
    },
  });
  // Một bé KHÁC chiếm chỗ duy nhất của lớp đầy.
  await db.student.create({ data: { id: `${T}hs-khac`, name: "Bé chiếm chỗ", centerId: CENTER } });
  await db.enrollment.create({
    data: {
      id: `${T}gd-khac`,
      studentId: `${T}hs-khac`,
      classId: LOP_DAY,
      courseId: KHOA_MOI,
      centerId: CENTER,
      status: "ACTIVE",
    },
  });

  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269922-000004",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture DKD",
      customerPhone: "0999000925",
      subtotal: GIA_CU,
      discountAmount: 0,
      totalAmount: GIA_CU,
      centerId: CENTER,
    },
  });
  await db.orderItem.create({
    data: {
      id: OI_CU,
      orderId: DON,
      type: "COURSE_ENROLLMENT",
      itemName: "Bé Bình DKD",
      quantity: 1,
      unitPrice: GIA_CU,
      totalPrice: GIA_CU,
      discountAmount: 0,
      enrollmentId: GD_CU,
    },
  });

  // Đã đóng 3.000.000 — tiền THẬT ở cả hai sổ.
  await db.payment.create({
    data: {
      id: `${T}pay`,
      orderId: DON,
      orderItemId: OI_CU,
      enrollmentId: GD_CU,
      amount: DA_DONG,
      method: "BANK_TRANSFER",
      accountantStatus: "CONFIRMED",
      paidDate: NGAY_BUOI(0),
      centerId: CENTER,
    },
  });
  // Một đợt CHƯA ĐÓNG của khoá cũ — phải bị VOID khi đổi khoá.
  await db.paymentRequest.create({
    data: {
      id: `${T}pr-con-lai`,
      orderId: DON,
      orderItemId: OI_CU,
      centerId: CENTER,
      installmentNo: 1,
      amountDue: GIA_CU - DA_DONG,
      dueDate: NGAY_BUOI(30),
      status: "PENDING",
    },
  });
}

const doi = (them: Record<string, unknown> = {}) =>
  doiKhoaChoCon({
    orderId: DON,
    orderItemId: OI_CU,
    targetClassId: LOP_MOI,
    buoiCuoiId: BUOI_CUOI,
    unitPriceMoi: GIA_MOI,
    lyDo: "Bé hoàn thành Sata 3, chuyển sang khoá ngắn",
    tranPhanTram: TRAN_PHAN_TRAM,
    actor: ACTOR,
    now: MOC,
    ...them,
  });

describe.skipIf(!RUN_DB_TESTS)("[DKD] đổi khoá / đổi lớp", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[DKD-00] fixture đúng hình dạng TS-41: 40 buổi, đã đóng 3tr, còn một đợt chưa thu", async () => {
    // Ca kiểm chính FIXTURE. Thiếu nó thì mọi ca dưới có thể xanh vì không có tiền, không
    // có buổi, hoặc không có đợt nào để VOID.
    expect(await db.classSession.count({ where: { classId: LOP_CU } })).toBe(SO_BUOI_CU);
    const so = await noTheoCon(DON);
    expect(so.con[0]!.daThu).toBe(DA_DONG);
    expect(so.con[0]!.phaiThu).toBe(GIA_CU);
    expect(await db.paymentRequest.count({ where: { orderItemId: OI_CU, status: "PENDING" } })).toBe(1);
    // Đơn giá buổi phải tròn — fixture cố ý chọn 40 buổi để phép quyết toán không làm tròn.
    expect(DON_GIA_CU).toBe(100_000);
  });

  it("[DKD-01] TS-41: dư 1.000.000 → chuyển 600.000, hoàn 400.000, khoá mới hết nợ", async () => {
    const r = await doi();
    expect(r.ok, `ok=false: ${!r.ok ? r.error : ""}`).toBe(true);
    if (!r.ok) return;

    expect(r.soBuoiDaDung).toBe(20);
    expect(r.giaTriDaDung).toBe(2_000_000);
    expect(r.daChuyen).toBe(600_000);
    expect(r.phanVuot).toBe(400_000);
    expect(r.dotConThieuId, "khoá mới hết nợ ⇒ không tạo đợt nào").toBeNull();

    const so = await noTheoCon(DON);
    const cu = so.con.find((c) => c.orderItemId === OI_CU)!;
    const moi = so.con.find((c) => c.orderItemId === r.newOrderItemId)!;
    // Dòng CŨ: phải thu nay là giá trị đã dùng, và đã thu tụt đúng phần chuyển đi + hoàn.
    expect(cu.phaiThu, "phải thu của dòng cũ = phần đã học").toBe(2_000_000);
    expect(moi.phaiThu).toBe(GIA_MOI);
    expect(moi.daThu, "dòng mới nhận đúng 600.000").toBe(GIA_MOI);
    expect(moi.conNo, "khoá mới còn nợ 0").toBe(0);
  });

  it("[DKD-02] dòng mới CÓ ghi danh — nếu không, tiền chuyển sang nó là tiền chết", async () => {
    // ⚠️ `confirmPayment` từ chối khoản chưa gắn ghi danh (*"không thể sinh phiếu thu"*).
    // Đây là lý do phép chuyển lớp phải nằm TRONG transaction tiền, chứ không phải một việc
    // học vụ làm sau.
    const r = await doi();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dongMoi = await db.orderItem.findUniqueOrThrow({ where: { id: r.newOrderItemId } });
    expect(dongMoi.enrollmentId).toBe(r.newEnrollmentId);

    // Và khoản tiền vừa rót vào dòng mới cũng mang ghi danh ấy.
    const khoanVao = await db.payment.findFirst({
      where: { orderItemId: r.newOrderItemId, amount: { gt: 0 } },
      select: { enrollmentId: true, amount: true },
    });
    expect(khoanVao?.amount).toBe(GIA_MOI);
    expect(khoanVao?.enrollmentId, "khoản vào phải gắn ghi danh MỚI").toBe(r.newEnrollmentId);
  });

  it("[DKD-03] ghi danh cũ sang TRANSFERRED và trỏ đúng ghi danh mới", async () => {
    const r = await doi();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cu = await db.enrollment.findUniqueOrThrow({ where: { id: GD_CU } });
    expect(cu.status).toBe("TRANSFERRED");
    expect(cu.transferredToId).toBe(r.newEnrollmentId);
    const moi = await db.enrollment.findUniqueOrThrow({ where: { id: r.newEnrollmentId } });
    expect(moi.classId).toBe(LOP_MOI);
    expect(moi.courseId).toBe(KHOA_MOI);
    expect(moi.status).toBe("CONFIRMED");
  });

  it("[DKD-04] đợt CHƯA ĐÓNG của khoá cũ bị VOID — không đòi tiền một khoá đã bỏ", async () => {
    const r = await doi();
    expect(r.ok).toBe(true);
    const dot = await db.paymentRequest.findUniqueOrThrow({ where: { id: `${T}pr-con-lai` } });
    expect(dot.status).toBe("VOID");
  });

  it("[DKD-05] khoá mới ĐẮT hơn ⇒ chuyển hết dư, phần còn thiếu thành MỘT đợt (AC3)", async () => {
    const r = await doi({ targetClassId: LOP_DAT, unitPriceMoi: GIA_DAT });
    expect(r.ok, `ok=false: ${!r.ok ? r.error : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.daChuyen).toBe(1_000_000);
    expect(r.phanVuot).toBe(0);
    expect(r.dotConThieuId).not.toBeNull();

    const dot = await db.paymentRequest.findUniqueOrThrow({ where: { id: r.dotConThieuId! } });
    expect(dot.amountDue).toBe(GIA_DAT - 1_000_000);
    expect(dot.orderItemId).toBe(r.newOrderItemId);
    expect(dot.status).toBe("PENDING");

    const so = await noTheoCon(DON);
    const moi = so.con.find((c) => c.orderItemId === r.newOrderItemId)!;
    expect(moi.conNo).toBe(GIA_DAT - 1_000_000);
    expect(moi.tongDotDangMo, "đợt mở khớp đúng phần còn nợ").toBe(GIA_DAT - 1_000_000);
  });

  it("[DKD-06] phần vượt học phí mới ⇒ một yêu cầu HOÀN chờ kế toán", async () => {
    const r = await doi();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const hoan = await db.refundRequest.findFirst({
      where: { orderItemId: OI_CU },
      select: { proposedAmount: true, status: true },
    });
    expect(hoan?.proposedAmount).toBe(400_000);
    expect(hoan?.status).toBe("PENDING");
  });

  it("[DKD-07] TIỀN KHÔNG BỐC HƠI: tổng đã về của đơn giữ nguyên qua lượt đổi", async () => {
    // ⚠️ Bất biến quan trọng nhất của cả bộ. Phép đổi khoá dịch tiền giữa hai dòng và đặt
    // một yêu cầu hoàn — không lượt nào trong đó được làm tổng tiền ĐÃ VỀ của đơn đổi.
    // Yêu cầu hoàn mới chỉ là một tờ đề nghị; tiền chỉ rời đơn khi kế toán duyệt.
    const truoc = await noTheoCon(DON);
    const r = await doi();
    expect(r.ok).toBe(true);
    const sau = await noTheoCon(DON);
    expect(sau.tongDaThu, "tổng đã thu của ĐƠN không nhúc nhích").toBe(truoc.tongDaThu);
    expect(sau.chuaGanCon).toBe(truoc.chuaGanCon);
  });

  it("[DKD-08] xem trước nói ĐÚNG số sẽ xảy ra — so với lượt ghi thật", async () => {
    // Canh thứ không lưới nào khác canh: xem trước và lượt ghi phải chạy CÙNG một phép tính.
    const xem = await xemTruocDoiKhoa({
      orderId: DON,
      orderItemId: OI_CU,
      targetClassId: LOP_MOI,
      buoiCuoiId: BUOI_CUOI,
      unitPriceMoi: GIA_MOI,
      tranPhanTram: TRAN_PHAN_TRAM,
      now: MOC,
    });
    expect(xem.ok).toBe(true);
    if (!xem.ok) return;
    expect(xem.data.loi).toBeNull();
    expect(xem.data.soBuoiDaDung).toBe(20);
    expect(xem.data.ke.du).toBe(1_000_000);
    expect(xem.data.ke.chuyenSangMoi).toBe(600_000);
    expect(xem.data.ke.phanVuot).toBe(400_000);
    // Khoá mới 6 buổi × 100.000 ⇒ 1.000.000 tương đương 6 buổi (kẹp bởi học phí mới).
    expect(xem.data.ke.tuongDuongBuoi).toBe(10);

    const ghi = await doi();
    expect(ghi.ok).toBe(true);
    if (!ghi.ok) return;
    expect(ghi.daChuyen).toBe(xem.data.ke.chuyenSangMoi);
    expect(ghi.phanVuot).toBe(xem.data.ke.phanVuot);
    expect(ghi.giaTriDaDung).toBe(xem.data.giaTriDaDung);
  });

  it("[DKD-09] xem trước KHÔNG ghi một dòng nào", async () => {
    const dem = async () => ({
      dong: await db.orderItem.count({ where: { orderId: DON } }),
      ghiDanh: await db.enrollment.count({ where: { studentId: HS } }),
      dot: await db.paymentRequest.count({ where: { orderId: DON } }),
      khoan: await db.payment.count({ where: { orderId: DON } }),
    });
    const truoc = await dem();
    await xemTruocDoiKhoa({
      orderId: DON,
      orderItemId: OI_CU,
      targetClassId: LOP_MOI,
      buoiCuoiId: BUOI_CUOI,
      unitPriceMoi: GIA_MOI,
      tranPhanTram: TRAN_PHAN_TRAM,
      now: MOC,
    });
    expect(await dem()).toEqual(truoc);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[DKD] cổng — và CUỘN NGƯỢC khi từ chối giữa chừng", () => {
  beforeEach(dungFixture);
  afterAll(don);

  /** Ảnh chụp mọi thứ phép đổi khoá có thể chạm. Dùng để chứng minh cuộn ngược SẠCH. */
  const anhChup = async () => ({
    dong: await db.orderItem.count({ where: { orderId: DON } }),
    ghiDanh: await db.enrollment.count({ where: { studentId: HS } }),
    ghiDanhCuStatus: (await db.enrollment.findUniqueOrThrow({ where: { id: GD_CU } })).status,
    dot: await db.paymentRequest.count({ where: { orderId: DON } }),
    dotVoid: await db.paymentRequest.count({ where: { orderId: DON, status: "VOID" } }),
    khoan: await db.payment.count({ where: { orderId: DON } }),
    hoan: await db.refundRequest.count({ where: { orderItemId: OI_CU } }),
  });

  it("[DKD-10] LỚP ĐÍCH ĐẦY ⇒ từ chối, và CUỘN NGƯỢC sạch", async () => {
    // ⚠️ Ca đắt nhất của bộ. Phép từ chối này xảy ra ở BƯỚC 1 của năm bước, nhưng
    // `chuyenLopTrongTx` đã có thể ghi vài dòng trước khi phát hiện. `return` trong callback
    // `$transaction` KHÔNG cuộn ngược (luật rollback) — chỉ `throw` mới cuộn. Ca này chứng
    // minh đường đó đi bằng `throw`.
    const truoc = await anhChup();
    const r = await doi({ targetClassId: LOP_DAY });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("đã đủ học sinh");
    expect(await anhChup(), "không một dòng nào được để lại").toEqual(truoc);
  });

  it("[DKD-11] lớp đích TRÙNG lớp đang học ⇒ chặn TRƯỚC mọi phép ghi", async () => {
    const truoc = await anhChup();
    const r = await doi({ targetClassId: LOP_CU });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("trùng lớp");
    expect(await anhChup()).toEqual(truoc);
  });

  it("[DKD-12] hạ giá THẤP HƠN niêm yết của khoá mới ⇒ chặn, không ghi gì", async () => {
    const truoc = await anhChup();
    const r = await doi({ unitPriceMoi: GIA_MOI - 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("THẤP HƠN giá niêm yết");
    expect(await anhChup()).toEqual(truoc);
  });

  it("[DKD-13] THIẾU LÝ DO ⇒ chặn, không ghi gì", async () => {
    const truoc = await anhChup();
    const r = await doi({ lyDo: "   " });
    expect(r.ok).toBe(false);
    expect(await anhChup()).toEqual(truoc);
  });

  it("[DKD-14] bé ĐÃ DỪNG HỌC ⇒ chặn", async () => {
    await db.orderItem.update({ where: { id: OI_CU }, data: { status: "STOPPED" } });
    const r = await doi();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("đã dừng học");
  });

  it("[DKD-15] bé CHƯA XẾP LỚP ⇒ chặn, và nói đúng nguyên nhân", async () => {
    await db.orderItem.update({ where: { id: OI_CU }, data: { enrollmentId: null } });
    const r = await doi();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("chưa được xếp lớp");
  });

  it("[DKD-16] đơn ĐÃ HUỶ / ĐÃ HOÀN ⇒ chặn", async () => {
    for (const status of ["CANCELLED", "REFUNDED", "DRAFT"] as const) {
      await db.order.update({ where: { id: DON }, data: { status } });
      const r = await doi();
      expect(r.ok, status).toBe(false);
    }
  });

  it("[DKD-17] nhật ký ghi ĐỦ hai đầu của phép đổi", async () => {
    const r = await doi();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const vet = await db.auditLog.findFirst({
      where: { entityType: "Order", entityId: DON, action: "DOI_KHOA_CHO_CON" },
    });
    expect(vet, "phải ghi AuditLog cho đơn").not.toBeNull();
    const moi = vet!.newValues as {
      enrollmentId: string;
      giaTriDaDung: number;
      ke: { chuyenSangMoi: number; phanVuot: number };
    };
    expect(moi.enrollmentId).toBe(r.newEnrollmentId);
    expect(moi.giaTriDaDung).toBe(2_000_000);
    expect(moi.ke.chuyenSangMoi).toBe(600_000);

    // Và lịch sử ghi danh cũng phải có cả hai đầu — đó là sổ mà học vụ đọc.
    const lichSu = await db.enrollmentAuditLog.findMany({
      where: { enrollmentId: { in: [GD_CU, r.newEnrollmentId] } },
      select: { enrollmentId: true, toStatus: true },
    });
    expect(lichSu.map((x) => x.toStatus).sort()).toEqual(["CONFIRMED", "TRANSFERRED"]);
  });
});
