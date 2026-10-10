// tests/finance/bao-luu-nhac-no.test.ts — BẢO LƯU × NHẮC NỢ SỔ CŨ (`OrderInstallment`). PHIÊN 1.
//
// Chạy: `pnpm test:finance-db`. `pnpm test:unit` trần sẽ SKIP (thiếu `ALLOW_DB_RESET=1`).
//
// ─────────────────────────────────────────────────────────────────────────────
// LỖ CẦN VÁ (đo ở Phiên 0, 07/10/2026)
//
// F2 · US-18 AC2 chỉ tha quá hạn cho SỔ MỚI (`PaymentRequest`): cron `nhac-no-theo-con` và
// `payment-reconcile` gọi `locDotCuaConDangBaoLuu`. Còn cron `debt-reminder` + hai hàm nhắc của
// `lib/finance/debt.ts` đọc SỔ CŨ (`OrderInstallment`) và KHÔNG biết bảo lưu. Hàm dời hạn
// `apDungDoiHanBaoLuu` thì chỉ dời `PaymentRequest.dueDate`, không dời `OrderInstallment.dueDate`.
// Hệ quả: phụ huynh có kế hoạch trả góp cũ, con đang bảo lưu, vẫn nhận chuông "Công nợ quá hạn",
// ZNS và email nhắc đóng tiền.
//
// ⚠️ Bộ này viết TRƯỚC bản vá và phải ĐỎ trên mã cũ (luật 14). Mỗi ca có ĐỐI CHỨNG DƯƠNG: "đơn
// của bé không bảo lưu VẪN bị nhắc" — thiếu nó, một cron hỏng hoàn toàn cũng làm ca "không nhắc
// bé bảo lưu" xanh vì lý do sai (CLAUDE.md luật 11).
//
// Ngày của cron `GET` là đồng hồ thật (route không nhận `now`): ngày đến hạn đặt ở 2020 nên nó
// luôn quá hạn; ngày bắt đầu bảo lưu đặt ở 2019 nên luôn "đã bắt đầu". Hai hàm có `now` thì
// truyền `NOW` cố định.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { remindOverdueInstallments, remindOverdueSingleOrders } from "@/lib/finance/debt";
import { GET as cronDebtReminder } from "@/app/api/cron/debt-reminder/route";

if (!RUN_DB_TESTS) console.warn(`[BL1-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-bl1-";
const CENTER = `${T}center`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const NOW = new Date("2026-06-17T08:00:00.000Z");
const HAN_CU = new Date("2020-01-10T00:00:00.000Z");
const DON_CU = new Date("2020-01-01T00:00:00.000Z");
const BAT_DAU_BAO_LUU = new Date("2019-12-01T00:00:00.000Z");
const CRON_SECRET = "bl1-cron-secret-0123456789abcdef0123456789";

type Be = { hs: string; gd: string };
const be = (ten: string): Be => ({ hs: `${T}hs-${ten}`, gd: `${T}gd-${ten}` });
const BE = {
  /** Đang bảo lưu (lượt còn hiệu lực). */
  nghi: be("nghi"),
  /** Không bảo lưu — đối chứng dương. */
  hoc: be("hoc"),
  /** Từng bảo lưu nhưng ĐÃ HỌC LẠI (lượt đã đóng) — phải được nhắc lại như thường. */
  hocLai: be("hoclai"),
  /** Bé thứ hai của đơn hai bé: không bảo lưu. */
  hoc2: be("hoc2"),
};
const MAIL = (k: string) => `${T}${k}@test.local`;
const SDT = (k: string) => `09${String(Math.abs(hash(k))).padStart(8, "0").slice(0, 8)}`;
/**
 * SĐT phụ huynh của MỘT BÉ — dùng cho cả `Student.parentPhone` lẫn `Order.customerPhone`.
 *
 * ⚠️ Phải KHỚP nhau: cổng A3 ("đơn mang tên con nhà khác", `lib/orders/don-nhiem.ts`) chặn gửi
 * nhắc nợ ra ngoài khi SĐT trên đơn không khớp SĐT phụ huynh của bé gắn vào đơn. Bản fixture
 * đầu để trống `parentPhone` ⇒ cổng nuốt MỌI đơn có `studentId`, kể cả đối chứng dương, và hai
 * ca "không nhắc bé bảo lưu" xanh vì lý do sai. Chính ca `[BL1-DB-02]` đỏ trên mã cũ đã lộ ra.
 */
const SDT_BE = (b: Be) => SDT(b.hs);
function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

const DON = {
  tgNghi: `${T}don-tg-nghi`,
  tgHoc: `${T}don-tg-hoc`,
  tgHocLai: `${T}don-tg-hoclai`,
  tgHaiBe: `${T}don-tg-haibe`,
  leNghi: `${T}don-le-nghi`,
  leHoc: `${T}don-le-hoc`,
};
const tatCaDon = Object.values(DON);
const tatCaBe = Object.values(BE);
/** Bé mà mỗi đơn thu hộ — quyết định SĐT trên đơn (xem `SDT_BE`). Đơn hai bé không khai bé nào. */
const BE_CUA_DON: Record<string, Be | null> = {
  [DON.tgNghi]: BE.nghi,
  [DON.leNghi]: BE.nghi,
  [DON.tgHoc]: BE.hoc,
  [DON.leHoc]: BE.hoc,
  [DON.tgHocLai]: BE.hocLai,
  [DON.tgHaiBe]: null,
};
const sdtDon = (orderId: string) => {
  const b = BE_CUA_DON[orderId];
  return b ? SDT_BE(b) : SDT(orderId);
};

async function don() {
  const phones = [...new Set(tatCaDon.map((d) => sdtDon(d)))];
  await db.notification.deleteMany({ where: { studentId: { in: tatCaBe.map((b) => b.hs) } } });
  await db.zaloMessageLog.deleteMany({ where: { toPhone: { in: phones } } });
  await db.emailQueue.deleteMany({
    where: {
      OR: [
        { contextId: { in: [...tatCaDon, ...phones] } },
        { toEmail: { startsWith: `${T}` } },
      ],
    },
  });
  await db.orderInstallment.deleteMany({ where: { orderId: { in: tatCaDon } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: tatCaDon } } });
  await db.order.deleteMany({ where: { id: { in: tatCaDon } } });
  await db.studentReserve.deleteMany({ where: { studentId: { in: tatCaBe.map((b) => b.hs) } } });
  await db.enrollment.deleteMany({ where: { id: { in: tatCaBe.map((b) => b.gd) } } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { in: tatCaBe.map((b) => b.hs) } } });
  await db.center.deleteMany({ where: { id: CENTER } });
}

async function taoDon(opts: {
  id: string;
  studentId: string | null;
  items: { id: string; enrollmentId: string | null; studentId?: string | null }[];
  tragop: boolean;
}) {
  await db.order.create({
    data: {
      id: opts.id,
      code: `ORD-BL1-${opts.id.slice(T.length)}`.toUpperCase(),
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture BL1",
      customerPhone: sdtDon(opts.id),
      customerEmail: MAIL(opts.id.slice(T.length)),
      totalAmount: 6_000_000,
      centerId: CENTER,
      studentId: opts.studentId,
      createdAt: DON_CU,
    },
  });
  for (const it of opts.items) {
    await db.orderItem.create({
      data: {
        id: it.id,
        orderId: opts.id,
        type: "COURSE_ENROLLMENT",
        itemName: "Sata 3 fixture BL1",
        quantity: 1,
        unitPrice: 6_000_000,
        totalPrice: 6_000_000,
        enrollmentId: it.enrollmentId,
        studentId: it.studentId ?? null,
      },
    });
  }
  if (opts.tragop) {
    await db.orderInstallment.create({
      data: { orderId: opts.id, soDot: 2, amount: 3_000_000, status: "PENDING", dueDate: HAN_CU },
    });
  }
}

async function dungFixture() {
  await don();
  await db.center.create({
    data: { id: CENTER, name: "Cơ sở fixture BL1", slug: `${T}cs`, address: "114 Hoàng Diệu" },
  });
  await db.course.create({
    data: { id: KHOA, name: "Sata 3 fixture BL1", slug: `${T}sata-3`, totalSessions: 48 },
  });
  await db.class.create({ data: { id: LOP, name: "Lớp BL1", courseId: KHOA } });
  for (const b of tatCaBe) {
    await db.student.create({
      data: { id: b.hs, name: `Bé ${b.hs}`, centerId: CENTER, parentPhone: SDT_BE(b) },
    });
    await db.enrollment.create({
      data: { id: b.gd, studentId: b.hs, classId: LOP, courseId: KHOA, status: "ACTIVE" },
    });
  }

  // Bé NGHỈ: lượt còn hiệu lực. Bé HỌC LẠI: lượt đã đóng.
  await db.studentReserve.create({
    data: {
      studentId: BE.nghi.hs,
      reason: "Fixture BL1",
      startedAt: BAT_DAU_BAO_LUU,
      expectedEndAt: new Date("2699-01-01T00:00:00Z"),
      createdByName: "fixture",
      isActive: true,
    },
  });
  await db.studentReserve.create({
    data: {
      studentId: BE.hocLai.hs,
      reason: "Fixture BL1 — đã học lại",
      startedAt: BAT_DAU_BAO_LUU,
      endedAt: new Date("2019-12-20T00:00:00Z"),
      createdByName: "fixture",
      isActive: false,
    },
  });

  await taoDon({ id: DON.tgNghi, studentId: BE.nghi.hs, items: [{ id: `${T}oi-tg-nghi`, enrollmentId: BE.nghi.gd }], tragop: true });
  await taoDon({ id: DON.tgHoc, studentId: BE.hoc.hs, items: [{ id: `${T}oi-tg-hoc`, enrollmentId: BE.hoc.gd }], tragop: true });
  await taoDon({ id: DON.tgHocLai, studentId: BE.hocLai.hs, items: [{ id: `${T}oi-tg-hoclai`, enrollmentId: BE.hocLai.gd }], tragop: true });
  // Đơn HAI bé: một bé bảo lưu, một bé đang học ⇒ đợt thu của đơn VẪN đúng hạn với bé kia.
  await taoDon({
    id: DON.tgHaiBe,
    studentId: null,
    items: [
      { id: `${T}oi-haibe-1`, enrollmentId: BE.nghi.gd },
      { id: `${T}oi-haibe-2`, enrollmentId: BE.hoc2.gd },
    ],
    tragop: true,
  });
  await taoDon({ id: DON.leNghi, studentId: BE.nghi.hs, items: [{ id: `${T}oi-le-nghi`, enrollmentId: BE.nghi.gd }], tragop: false });
  await taoDon({ id: DON.leHoc, studentId: BE.hoc.hs, items: [{ id: `${T}oi-le-hoc`, enrollmentId: BE.hoc.gd }], tragop: false });
}

const emailNhacNo = (orderId: string, loai: "DEBT_REMINDER_ORDER" = "DEBT_REMINDER_ORDER") =>
  db.emailQueue.count({ where: { contextType: loai, contextId: orderId } });
const lastReminder = async (orderId: string) =>
  (await db.orderInstallment.findFirst({ where: { orderId }, select: { lastReminderAt: true } }))
    ?.lastReminderAt ?? null;

describe.skipIf(!RUN_DB_TESTS)("[BL1-DB] bảo lưu × nhắc nợ sổ cũ", () => {
  beforeEach(async () => {
    await dungFixture();
  });
  afterAll(async () => {
    if (RUN_DB_TESTS) await don();
  });

  it("[BL1-DB-00] fixture: đúng 4 đơn trả góp + 2 đơn lẻ, và lượt của bé NGHỈ còn hiệu lực (kiểm chính fixture)", async () => {
    expect(await db.orderInstallment.count({ where: { orderId: { in: tatCaDon } } })).toBe(4);
    expect(await db.studentReserve.count({ where: { studentId: BE.nghi.hs, isActive: true, endedAt: null } })).toBe(1);
    expect(await db.studentReserve.count({ where: { studentId: BE.hocLai.hs, isActive: true } })).toBe(0);
  });

  describe("remindOverdueInstallments (email nhắc đợt trả góp)", () => {
    it("[BL1-DB-01] đơn của bé ĐANG BẢO LƯU ⇒ KHÔNG nhắc, KHÔNG đặt lastReminderAt", async () => {
      await remindOverdueInstallments({ now: NOW });
      expect(await emailNhacNo(DON.tgNghi)).toBe(0);
      expect(await lastReminder(DON.tgNghi)).toBeNull();
    });

    it("[BL1-DB-02] ĐỐI CHỨNG DƯƠNG: bé không bảo lưu vẫn bị nhắc đúng như cũ", async () => {
      await remindOverdueInstallments({ now: NOW });
      expect(await emailNhacNo(DON.tgHoc)).toBe(1);
      expect((await lastReminder(DON.tgHoc))?.toISOString()).toBe(NOW.toISOString());
    });

    it("[BL1-DB-03] bé ĐÃ HỌC LẠI (lượt đã đóng) ⇒ nhắc lại như thường — bảo lưu không tha vĩnh viễn", async () => {
      await remindOverdueInstallments({ now: NOW });
      expect(await emailNhacNo(DON.tgHocLai)).toBe(1);
    });

    it("[BL1-DB-04] đơn HAI bé mà chỉ MỘT bé bảo lưu ⇒ VẪN nhắc (bé kia còn đang học và đang nợ)", async () => {
      await remindOverdueInstallments({ now: NOW });
      expect(await emailNhacNo(DON.tgHaiBe)).toBe(1);
    });
  });

  describe("remindOverdueSingleOrders (email nhắc đơn lẻ)", () => {
    it("[BL1-DB-05] đơn lẻ của bé ĐANG BẢO LƯU ⇒ KHÔNG nhắc", async () => {
      await remindOverdueSingleOrders({ now: NOW });
      expect(await emailNhacNo(DON.leNghi)).toBe(0);
    });

    it("[BL1-DB-06] ĐỐI CHỨNG DƯƠNG: đơn lẻ của bé không bảo lưu vẫn bị nhắc", async () => {
      await remindOverdueSingleOrders({ now: NOW });
      expect(await emailNhacNo(DON.leHoc)).toBe(1);
    });
  });

  describe("cron GET /api/cron/debt-reminder (chuông 'Công nợ quá hạn' + ZNS/email đợt 2)", () => {
    const chay = async () => {
      process.env.CRON_SECRET = CRON_SECRET;
      const res = await cronDebtReminder(
        new NextRequest("http://localhost/api/cron/debt-reminder", {
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        }),
      );
      expect(res.status).toBe(200);
    };
    const chuong = (studentId: string) =>
      db.notification.count({ where: { studentId, title: "Công nợ quá hạn" } });
    const zns = (orderId: string) => db.zaloMessageLog.count({ where: { toPhone: sdtDon(orderId) } });

    it("[BL1-DB-07] bé ĐANG BẢO LƯU ⇒ KHÔNG chuông quá hạn, KHÔNG ZNS/email, KHÔNG lastReminderAt", async () => {
      await chay();
      expect(await chuong(BE.nghi.hs)).toBe(0);
      expect(await zns(DON.tgNghi)).toBe(0);
      expect(await lastReminder(DON.tgNghi)).toBeNull();
    });

    it("[BL1-DB-08] ĐỐI CHỨNG DƯƠNG: bé không bảo lưu vẫn có chuông + ZNS + lastReminderAt", async () => {
      await chay();
      expect(await chuong(BE.hoc.hs)).toBe(1);
      expect(await zns(DON.tgHoc)).toBe(1);
      expect(await lastReminder(DON.tgHoc)).not.toBeNull();
    });

    it("[BL1-DB-09] bé ĐÃ HỌC LẠI vẫn có chuông (lượt đã đóng không tha)", async () => {
      await chay();
      expect(await chuong(BE.hocLai.hs)).toBe(1);
    });
  });
});
