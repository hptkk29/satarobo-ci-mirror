// tests/finance/bao-luu-qua-han.test.ts — K19 (vòng 3): SỐ NGÀY QUÁ HẠN TRỪ THỜI GIAN BẢO LƯU, trên Postgres THẬT. Chạy: `pnpm test:finance-db`.
//
// Công thức + lý do: `lib/bao-luu/qua-han-tru-bao-luu.ts`. Mã trước bản vá (A6 vòng 2) đóng băng bằng `min(hôm nay, ngày bắt đầu) − hạn` nên SAU phục học nó trả số theo đồng hồ thật:
// ca (a) ra 42 thay vì 12; ca (b) ra 30 thay vì 0 và còn CHẶN phục học oan (đợt tới hạn giữa kỳ nghỉ). Ngày TUYỆT ĐỐI, `now` truyền vào (luật 19).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { docKhoanDenHan } from "@/lib/bao-luu/ngu-canh-db";
import { chanDuyetVeNo } from "@/lib/bao-luu/hoso";
import { docKhoangTheoDon, docKhoangTheoDong, soNgayQuaHanTruBaoLuu } from "@/lib/bao-luu/qua-han-tru-bao-luu-db";
import { locDonDangBaoLuu } from "@/lib/bao-luu/dang-bao-luu-db";
import { gomTuoiNo } from "@/lib/finance/tuoi-no";
import { docNhaQuaHan } from "@/lib/finance/qua-han-db";

if (!RUN_DB_TESTS) console.warn(`[KQH-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-kqh-";
const CS = `${T}cs`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const HV = `${T}hv`;
const GD = `${T}gd`;
const GD2 = `${T}gd2`;
const KHOA2 = `${T}khoa2`;
const LOP2 = `${T}lop2`;
const DON = `${T}don`;
const OI = `${T}oi`;
const NGAY = 86_400_000;
const ngay = (s: string) => new Date(`${s}T00:00:00+07:00`);
const cong = (d: Date, n: number) => new Date(d.getTime() + n * NGAY);

const HAN = ngay("2026-06-01");
const BAT_DAU = cong(HAN, 12); // quá hạn 12 ngày lúc bắt đầu bảo lưu
const PHUC_HOC = cong(BAT_DAU, 30);

async function don() {
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.orderInstallment.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.studentReserve.deleteMany({ where: { studentId: HV } });
  await db.enrollment.deleteMany({ where: { id: { in: [GD, GD2] } } });
  await db.class.deleteMany({ where: { id: { in: [LOP, LOP2] } } });
  await db.course.deleteMany({ where: { id: { in: [KHOA, KHOA2] } } });
  await db.student.deleteMany({ where: { id: HV } });
  await db.center.deleteMany({ where: { id: CS } });
}

/** Hồ sơ đã KẾT THÚC (phục học) cho ghi danh GD: [BAT_DAU, PHUC_HOC]. */
const hoSoDaPhucHoc = (o: object = {}) =>
  db.studentReserve.create({
    data: {
      studentId: HV, enrollmentId: GD, reason: "fx", createdByName: "x", centerId: CS, status: "ENDED", isActive: false,
      approvedAt: BAT_DAU, startedAt: BAT_DAU, endedAt: PHUC_HOC, ...o,
    },
  });

async function dungFixture() {
  await don();
  await db.center.create({ data: { id: CS, name: "CS KQH", slug: CS, address: "x" } });
  await db.course.create({ data: { id: KHOA, name: "Sata 3 KQH", slug: KHOA, totalSessions: 48 } });
  await db.course.create({ data: { id: KHOA2, name: "RoboSim KQH", slug: KHOA2, totalSessions: 12 } });
  await db.class.create({ data: { id: LOP, name: "Lớp KQH", courseId: KHOA, centerId: CS } });
  await db.class.create({ data: { id: LOP2, name: "Lớp 2 KQH", courseId: KHOA2, centerId: CS } });
  await db.student.create({ data: { id: HV, name: "An KQH", centerId: CS } });
  await db.enrollment.create({ data: { id: GD, studentId: HV, classId: LOP, courseId: KHOA, status: "ACTIVE", centerId: CS } });
  await db.enrollment.create({ data: { id: GD2, studentId: HV, classId: LOP2, courseId: KHOA2, status: "ACTIVE", centerId: CS } });
  await db.order.create({
    data: { id: DON, code: "ORD-KQH-1", type: "COURSE", status: "PENDING_PAYMENT", studentId: HV, customerName: "PH", customerPhone: "0900000019", totalAmount: 6_000_000, centerId: CS },
  });
  await db.orderItem.create({
    data: { id: OI, orderId: DON, type: "COURSE_ENROLLMENT", itemName: "Sata 3", quantity: 1, unitPrice: 6_000_000, totalPrice: 6_000_000, enrollmentId: GD, studentId: HV },
  });
  await db.orderInstallment.create({ data: { orderId: DON, soDot: 2, amount: 3_000_000, status: "PENDING", dueDate: HAN } });
}

/** Tuổi nợ /cong-no của đơn tại `now` — ĐÚNG đường mà trang chạy (cùng ba lời gọi). */
async function tuoiNo(now: Date) {
  const orders = await db.order.findMany({
    where: { id: DON },
    select: { id: true, installments: { where: { status: "PENDING" }, select: { amount: true, dueDate: true } } },
  });
  const [khoang, dang] = await Promise.all([docKhoangTheoDon([DON], now), locDonDangBaoLuu([DON], now)]);
  return gomTuoiNo(orders, khoang, dang, now);
}

describe.skipIf(!RUN_DB_TESTS)("[KQH-DB] số ngày quá hạn trừ thời gian bảo lưu", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[KQH-DB-01] (a) tuổi nợ /cong-no: quá hạn 12 ngày → bảo lưu 30 ngày → phục học hôm nay ⇒ nhóm 8–30 (12 ngày); sau 5 ngày ⇒ vẫn 8–30 (17); đối chứng KHÔNG hồ sơ ⇒ >30", async () => {
    await hoSoDaPhucHoc();
    expect((await tuoiNo(PHUC_HOC)).tong["8-30"]).toBe(3_000_000);
    expect((await tuoiNo(PHUC_HOC)).tong[">30"]).toBe(0);
    expect((await tuoiNo(cong(PHUC_HOC, 5))).tong["8-30"]).toBe(3_000_000);
    await db.studentReserve.deleteMany({ where: { studentId: HV } });
    expect((await tuoiNo(PHUC_HOC)).tong[">30"]).toBe(3_000_000); // không bảo lưu: 42 ngày ⇒ >30
  });

  it("[KQH-DB-02] đang bảo lưu: đóng băng 12 ngày (nhóm 8–30) kèm nhãn 'đang bảo lưu'; tổng mọi nhóm không đổi", async () => {
    await hoSoDaPhucHoc({ status: "ACTIVE", isActive: true, endedAt: null });
    const r = await tuoiNo(cong(BAT_DAU, 20));
    expect(r.tong["8-30"]).toBe(3_000_000);
    expect(r.dangBaoLuu["8-30"]).toBe(3_000_000);
    expect(Object.values(r.tong).reduce((a, b) => a + b, 0)).toBe(3_000_000);
  });

  it("[KQH-DB-03] (b) đợt tới hạn GIỮA kỳ nghỉ: lúc phục học 'chưa quá hạn'; 5 ngày sau là nhóm 1–7", async () => {
    await db.orderInstallment.updateMany({ where: { orderId: DON }, data: { dueDate: cong(BAT_DAU, 10) } });
    await hoSoDaPhucHoc();
    expect((await tuoiNo(PHUC_HOC)).tong.none).toBe(3_000_000);
    expect((await tuoiNo(cong(PHUC_HOC, 5))).tong["1-7"]).toBe(3_000_000);
  });

  it("[KQH-DB-04] (c) hai lần bảo lưu không chồng nhau: trừ cả hai", async () => {
    await hoSoDaPhucHoc({ startedAt: cong(HAN, 5), endedAt: cong(HAN, 15) }); // 10 ngày
    await hoSoDaPhucHoc({ startedAt: cong(HAN, 40), endedAt: cong(HAN, 70) }); // 30 ngày
    expect(await soNgayQuaHanTruBaoLuu(HAN, cong(HAN, 100), GD)).toBe(60); // 100 − 10 − 30
    expect(await soNgayQuaHanTruBaoLuu(HAN, cong(HAN, 70), GD)).toBe(30); // 70 − 10 − 30
  });

  it("[KQH-DB-05] hàm dùng chung theo chữ chủ dự án `soNgayQuaHanTruBaoLuu(hanDot, homNay, enrollmentId)`: 12 → 17; hồ sơ của GHI DANH KHÁC không trừ cho ghi danh còn đi học", async () => {
    await hoSoDaPhucHoc();
    expect(await soNgayQuaHanTruBaoLuu(HAN, PHUC_HOC, GD)).toBe(12);
    expect(await soNgayQuaHanTruBaoLuu(HAN, cong(PHUC_HOC, 5), GD)).toBe(17);
    expect(await soNgayQuaHanTruBaoLuu(HAN, PHUC_HOC, GD2)).toBe(42); // GD2 chưa từng nghỉ ⇒ đồng hồ thật
    expect(await soNgayQuaHanTruBaoLuu(HAN, PHUC_HOC, "khong-co-gd")).toBe(42);
  });

  it("[KQH-DB-06] cổng nợ khi PHỤC HỌC: đợt quá hạn từ TRƯỚC khi nghỉ vẫn chặn (12 ngày > 0); đợt tới hạn giữa kỳ nghỉ KHÔNG chặn (0 ngày)", async () => {
    await hoSoDaPhucHoc({ status: "RESUME_PENDING", isActive: true, endedAt: null });
    let khoan = await docKhoanDenHan(db, { enrollmentId: GD, studentId: HV, now: PHUC_HOC });
    expect(chanDuyetVeNo(khoan, 0, PHUC_HOC)).toMatch(/quá 12 ngày/);
    await db.orderInstallment.updateMany({ where: { orderId: DON }, data: { dueDate: cong(BAT_DAU, 10) } });
    khoan = await docKhoanDenHan(db, { enrollmentId: GD, studentId: HV, now: PHUC_HOC });
    expect(chanDuyetVeNo(khoan, 0, PHUC_HOC)).toBeNull();
  });

  it("[KQH-DB-07] sổ MỚI (PaymentRequest): `docKhoangTheoDong` trả khoảng của bé; danh sách quá hạn theo nhà bỏ đợt 0 ngày và đếm đúng ngày của đợt còn lại", async () => {
    await hoSoDaPhucHoc();
    expect((await docKhoangTheoDong([OI], PHUC_HOC)).get(OI)).toHaveLength(1);
    await db.paymentRequest.create({ data: { orderId: DON, orderItemId: OI, centerId: CS, installmentNo: 1, amountDue: 1_000_000, dueDate: HAN, status: "PENDING" } }); // 12 ngày
    await db.paymentRequest.create({ data: { orderId: DON, orderItemId: OI, centerId: CS, installmentNo: 2, amountDue: 1_000_000, dueDate: cong(BAT_DAU, 10), status: "PENDING" } }); // giữa kỳ ⇒ 0
    const r = await docNhaQuaHan({ now: PHUC_HOC });
    const nha = r.nha.find((n) => n.orderId === DON);
    expect(nha?.con[0]?.soDot).toBe(1);
    expect(nha?.soNgayQuaNhieuNhat).toBe(12);
    expect(nha?.tongConThieu).toBe(1_000_000);
  });
});
