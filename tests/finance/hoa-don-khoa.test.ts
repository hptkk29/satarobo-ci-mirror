// Ca [HDK-*] — CỔNG HOÁ ĐƠN trong các đường ghi tiền của `lib/finance/payment.ts` + luồng lưu kế
// hoạch cũ (docs/ke-toan-hoa-don/PLAN.md §5), trên Postgres THẬT.
//
// Luật: khoản đang nằm trong hoá đơn (NHAP / DA_XAC_NHAN / KHONG_XUAT, `hieuLuc`) thì
//   · `rejectPayment`, `updatePendingPayment` (đổi tiền / phương thức / ngày) ⇒ CHẶN, không ghi gì;
//   · gắn ghi danh (`ganGhiDanhChoKhoanCuaDon`, `linkRecordedPaymentsToEnrollments`) ⇒ ĐƯỢC nếu
//     GIỮ NGUYÊN số tiền (một con), BỎ QUA nếu phải TÁCH tiền;
//   · luồng lưu kế hoạch cũ ⇒ BỎ QUA khoản đang khoá khi xoá mềm lời khai.
// Cổng LUÔN chạy — không hỏi cờ `billing.hoaDonEnabled` (DB test không có dòng cờ ⇒ cờ TẮT).
// Mỗi ca "chặn" đi kèm ĐỐI CHỨNG DƯƠNG: cùng khoản, KHÔNG hoá đơn ⇒ làm được.
//
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { ganGhiDanhChoKhoanCuaDon, rejectPayment, updatePendingPayment } from "@/lib/finance/payment";
import { KHOA_HOA_DON } from "@/lib/finance/hoa-don/feature";
import { installmentMarker } from "@/lib/finance/payment-markers";
import { KHOA_CONG_TAC } from "@/lib/finance/feature";
import { recordInstallmentPlan } from "@/lib/orders/installments";

if (!RUN_DB_TESTS) console.warn(`[HDK] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-hdk-";
const CS = `${T}center`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const HS1 = `${T}hs1`;
const HS2 = `${T}hs2`;
const GD1 = `${T}gd1`;
const GD2 = `${T}gd2`;
const DON1 = `${T}don1`; // một con
const DON2 = `${T}don2`; // hai con — khoản phải TÁCH
const DON3 = `${T}don3`; // kế hoạch đợt LUỒNG CŨ — chỉ một lời khai đợt 1
const P_REJ = `${T}p-rej`;
const P_1CON = `${T}p-1con`;
const P_2CON = `${T}p-2con`;
const P_KHAI = `${T}p-khai`;
const KT = `${T}ke-toan`;

async function don() {
  const cacDon = [DON1, DON2, DON3];
  await db.hoaDonDienTu.deleteMany({ where: { orderId: { in: cacDon } } });
  await db.receipt.deleteMany({ where: { paymentId: { startsWith: T } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { contains: T } } });
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: T } } });
  // Lưu kế hoạch luồng cũ có thể đẻ lại lời khai (id không mang tiền tố fixture) kèm nhật ký của nó.
  const cacKhoan = await db.payment.findMany({ where: { orderId: { in: cacDon } }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { entityId: { in: cacKhoan.map((p) => p.id) } } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: cacDon } } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: cacDon } } });
  await db.orderInstallment.deleteMany({ where: { orderId: { in: cacDon } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: cacDon } } });
  await db.payment.deleteMany({ where: { orderId: { in: cacDon } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: cacDon } } });
  await db.order.deleteMany({ where: { id: { in: cacDon } } });
  await db.enrollment.deleteMany({ where: { id: { in: [GD1, GD2] } } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { in: [HS1, HS2] } } });
  await db.center.deleteMany({ where: { id: CS } });
}

async function dungFixture() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở fixture HDK", slug: `${T}co-so`, address: "211 Nguyễn Hữu Thọ" } });
  await db.course.create({ data: { id: KHOA, name: "Sata 4 fixture", slug: `${T}sata-4` } });
  await db.class.create({ data: { id: LOP, name: "Lớp fixture HDK", courseId: KHOA } });
  await db.student.create({ data: { id: HS1, name: "Bé Một HDK" } });
  await db.student.create({ data: { id: HS2, name: "Bé Hai HDK" } });
  await db.enrollment.create({ data: { id: GD1, studentId: HS1, classId: LOP, courseId: KHOA, finalPrice: 6_000_000 } });
  await db.enrollment.create({ data: { id: GD2, studentId: HS2, classId: LOP, courseId: KHOA, finalPrice: 4_000_000 } });

  const dungDon = (id: string, code: string, tong: number) =>
    db.order.create({
      data: { id, code, type: "COURSE", status: "CONFIRMED", customerName: "PH fixture HDK", customerPhone: "0999000777", totalAmount: tong, centerId: CS },
    });
  await dungDon(DON1, "ORD-269926-000101", 6_000_000);
  await dungDon(DON2, "ORD-269926-000102", 10_000_000);
  await dungDon(DON3, "ORD-269926-000103", 6_000_000);
  const dong = (id: string, orderId: string, studentId: string, tien: number) =>
    db.orderItem.create({
      data: { id, orderId, studentId, type: "COURSE_ENROLLMENT", itemName: id, quantity: 1, unitPrice: tien, totalPrice: tien },
    });
  await dong(`${T}it-1`, DON1, HS1, 6_000_000);
  await dong(`${T}it-2a`, DON2, HS1, 6_000_000);
  await dong(`${T}it-2b`, DON2, HS2, 4_000_000);

  const khoan = (id: string, orderId: string, amount: number, o: { enrollmentId?: string | null; accountantStatus?: "PENDING" | "CONFIRMED" } = {}) =>
    db.payment.create({
      data: {
        id,
        orderId,
        amount,
        method: "BANK_TRANSFER",
        paidDate: new Date("2699-09-26T03:00:00Z"),
        saleStatus: "RECORDED",
        accountantStatus: o.accountantStatus ?? "PENDING",
        enrollmentId: o.enrollmentId ?? null,
        centerId: CS,
      },
    });
  await khoan(P_REJ, DON1, 3_000_000, { enrollmentId: GD1, accountantStatus: "CONFIRMED" });
  await khoan(P_1CON, DON1, 3_000_000);
  await khoan(P_2CON, DON2, 5_000_000);
  // Lời khai đợt 1 do chính kế hoạch LUỒNG CŨ đẻ ra (`ensureOrderPaymentRecorded`) — hình dạng thật:
  // marker `[auto:order-installment:dot1]`, phương thức "auto", CHỜ kế toán, chưa gắn ghi danh, chưa phiếu thu.
  await db.payment.create({
    data: {
      id: P_KHAI,
      orderId: DON3,
      amount: 6_000_000,
      method: "auto",
      note: installmentMarker(1),
      paidDate: new Date("2699-09-26T03:00:00Z"),
      centerId: CS,
    },
  });
}

const khoa = (paymentId: string, orderId: string, soTien: number, trangThai: "NHAP" | "DA_XAC_NHAN" = "DA_XAC_NHAN") =>
  db.hoaDonDienTu.create({
    data: {
      id: `${T}hd-${paymentId}`,
      orderId,
      centerId: CS,
      trangThai,
      kyHieu: "1C26TSR",
      soHoaDon: "777",
      tongTien: soTien,
      taoBoiId: KT,
      khoan: { create: [{ paymentId, soTien }] },
    },
  });
const gan = (orderId: string) =>
  db.$transaction((tx) => ganGhiDanhChoKhoanCuaDon(tx, { orderId, actor: { id: KT, name: "KT" } }));
const goKhoa = (paymentId: string) => db.hoaDonDienTu.deleteMany({ where: { id: `${T}hd-${paymentId}` } });

describe.skipIf(!RUN_DB_TESTS)("[HDK] cổng hoá đơn trong đường ghi tiền — Postgres thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HDK-00] fixture: cờ màn hoá đơn KHÔNG có dòng ⇒ TẮT (cổng phải chạy khi cờ tắt)", async () => {
    expect(await db.systemSetting.findUnique({ where: { key: KHOA_HOA_DON } })).toBeNull();
  });

  it("[HDK-01] rejectPayment khoản đã có hoá đơn ⇒ CHẶN, nói đúng số hoá đơn, trạng thái giữ nguyên", async () => {
    await khoa(P_REJ, DON1, 3_000_000);
    const r = await rejectPayment({ paymentId: P_REJ, confirmedById: KT, reason: "Nhầm khoản thử" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("1C26TSR-777");
    expect((await db.payment.findUniqueOrThrow({ where: { id: P_REJ } })).accountantStatus).toBe("CONFIRMED");

    // Đối chứng dương: gỡ hoá đơn ⇒ từ chối được.
    await goKhoa(P_REJ);
    expect((await rejectPayment({ paymentId: P_REJ, confirmedById: KT, reason: "Nhầm khoản thử" })).ok).toBe(true);
  });

  it("[HDK-01b] hoá đơn đã bị THAY (dòng nối hết hiệu lực) KHÔNG giữ khoản ⇒ từ chối được", async () => {
    await db.hoaDonDienTu.create({
      data: {
        id: `${T}hd-cu`,
        orderId: DON1,
        centerId: CS,
        trangThai: "THAY_THE",
        huyLyDo: "Kế toán huỷ để xuất lại",
        huyBoiId: KT,
        huyLuc: new Date("2699-09-26T09:00:00Z"),
        kyHieu: "1C26TSR",
        soHoaDon: "776",
        tongTien: 3_000_000,
        taoBoiId: KT,
        khoan: { create: [{ paymentId: P_REJ, soTien: 3_000_000, hieuLuc: false }] },
      },
    });
    expect((await rejectPayment({ paymentId: P_REJ, confirmedById: KT, reason: "Nhầm khoản thử" })).ok).toBe(true);
  });

  it("[HDK-02] updatePendingPayment: đổi SỐ TIỀN ⇒ chặn; chỉ đổi GHI CHÚ ⇒ được", async () => {
    await khoa(P_1CON, DON1, 3_000_000, "NHAP");
    const doiTien = await updatePendingPayment({ paymentId: P_1CON, actorId: KT, amount: 2_500_000 });
    expect(doiTien.ok).toBe(false);
    expect(!doiTien.ok && doiTien.error).toContain("hoá đơn nháp");
    expect((await db.payment.findUniqueOrThrow({ where: { id: P_1CON } })).amount).toBe(3_000_000);

    const doiGhiChu = await updatePendingPayment({ paymentId: P_1CON, actorId: KT, note: "PH gọi xác nhận" });
    expect(doiGhiChu.ok).toBe(true);
  });

  it("[HDK-03] gắn ghi danh cho khoản đang khoá, MỘT con, GIỮ nguyên số ⇒ ĐƯỢC gắn", async () => {
    await khoa(P_1CON, DON1, 3_000_000);
    const r = await gan(DON1);
    expect(r.linked).toBe(1);
    const p = await db.payment.findUniqueOrThrow({ where: { id: P_1CON } });
    expect(p).toMatchObject({ enrollmentId: GD1, amount: 3_000_000 });
  });

  it("[HDK-04] khoản đang khoá mà phải TÁCH cho hai con ⇒ BỎ QUA; đối chứng: không khoá ⇒ tách", async () => {
    await khoa(P_2CON, DON2, 5_000_000);
    const r = await gan(DON2);
    expect(r).toMatchObject({ linked: 0, splitCreated: 0, boQua: 1 });
    expect(await db.payment.findUniqueOrThrow({ where: { id: P_2CON } })).toMatchObject({ enrollmentId: null, amount: 5_000_000 });
    expect(await db.payment.count({ where: { orderId: DON2 } })).toBe(1);

    await goKhoa(P_2CON);
    const r2 = await gan(DON2);
    expect(r2).toMatchObject({ linked: 1, splitCreated: 1 });
    const sau = await db.payment.findMany({ where: { orderId: DON2 }, select: { amount: true } });
    expect(sau.reduce((s, p) => s + p.amount, 0)).toBe(5_000_000);
  });

  // Ca HÀNH VI thay cho lưới ghim mã nguồn cũ (regex trên `where` của phép xoá mềm): đi qua ĐƯỜNG THẬT
  // `recordInstallmentPlan`. Trước bản vá, phép xoá mềm không nhìn hoá đơn ⇒ lời khai đã nằm trong hoá đơn
  // bị xoá mềm ⇒ tờ hoá đơn nói một khoản không còn trong sổ.
  it("[HDK-05] lưu kế hoạch LUỒNG CŨ: lời khai đợt 1 đang nằm trong bản NHÁP ⇒ KHÔNG bị xoá mềm; đối chứng: không khoá ⇒ bị xoá mềm", async () => {
    // Tiền đề: công tắc thu linh hoạt KHÔNG có dòng ⇒ TẮT ⇒ đúng luồng cũ (luồng mới không bao giờ xoá mềm).
    expect(await db.systemSetting.findUnique({ where: { key: KHOA_CONG_TAC } })).toBeNull();
    const luu = () => recordInstallmentPlan({ orderId: DON3, dots: [{ amount: 6_000_000, daThu: true, dueDate: null }], actorId: KT });
    // `deletedAt` khai TƯỜNG MINH trong `where` — không thì bộ lọc xoá mềm của `db` tự thêm `deletedAt: null`.
    const conSong = () => db.payment.count({ where: { id: P_KHAI, deletedAt: null } });
    const daXoaMem = () => db.payment.count({ where: { id: P_KHAI, deletedAt: { not: null } } });

    // `toMatchObject`, không `toEqual`: từ gộp nhánh SmartPOS (01/10/2026) kết quả mang thêm
    // `thongDiepPhieu` (lời báo phiếu gộp của cả nhà bị huỷ/đóng — luật 12). Ca này hỏi "lưu được";
    // `null` = fixture không có phiếu gộp nào bị chạm.
    await khoa(P_KHAI, DON3, 6_000_000, "NHAP");
    expect(await luu()).toMatchObject({ ok: true, thongDiepPhieu: null });
    expect(await conSong()).toBe(1);

    await goKhoa(P_KHAI);
    expect(await luu()).toMatchObject({ ok: true, thongDiepPhieu: null });
    expect(await daXoaMem()).toBe(1);
  });
});
