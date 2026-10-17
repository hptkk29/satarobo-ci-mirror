// Ca [KTT-*] — khoản của đơn KIT / THI (Order.type PRODUCT · EXAM) xác nhận được KHÔNG cần ghi danh,
// trên Postgres THẬT. Chủ dự án chốt 29/09/2026.
//
// Trước bản này: `xacNhanKhoanTrongTx` ném CHUA_GHI_DANH cho MỌI khoản thiếu `enrollmentId` và
// `Receipt.enrollmentId` NOT NULL ⇒ tiền kit/thi đã về mà khoản chờ mãi, bước chốt hoá đơn để nó CHỜ.
//   · PRODUCT / EXAM ⇒ CONFIRMED + đúng MỘT phiếu thu mang `enrollmentId = null` (bấm đôi vẫn một).
//   · COURSE thiếu ghi danh ⇒ VẪN bị chặn (đối chứng dương: cổng cũ không bị gỡ nhầm).
//   · Chốt hoá đơn đơn kit ⇒ hoá đơn DA_XAC_NHAN + khoản CONFIRMED + đúng một phiếu thu.
//
// Không literal trạng thái tiền: xác nhận so bằng `KHOAN_DA_XAC_NHAN.accountantStatus`, trạng thái ghi
// nhận của sale lấy từ `SALE_STATUS_DA_GHI_NHAN`. Bộ này KHÔNG gọi `resetDb()`: tự dựng, tự dọn theo tiền tố.
import { afterAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { chotHoaDon } from "@/lib/finance/hoa-don/chot-hoa-don";
import { COT_NGUOI_MUA } from "@/lib/finance/hoa-don/ghi-hoa-don";
import { nguoiMuaChoDon } from "@/lib/finance/hoa-don/nguoi-mua";
import { adjustPayment, confirmPayment } from "@/lib/finance/payment";
import { onPaymentConfirmed } from "@/lib/_handlers/r7-notifications";
import { KHOAN_DA_XAC_NHAN } from "@/lib/finance/debt";
import { SALE_STATUS_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";

if (!RUN_DB_TESTS) console.warn(`[KTT] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-ktt-";
const CS = `${T}center`;
const DON = `${T}don`;
const DONG = `${T}dong`;
const HD = `${T}hd`;
const P = `${T}p`;
const KT = { id: `${T}ke-toan`, name: "Kế toán fixture KTT" };
const SALE = `${T}sale`;
const HV = `${T}hv`;
const NOW = new Date("2699-09-29T08:00:00Z");
const DA_XAC_NHAN = KHOAN_DA_XAC_NHAN.accountantStatus;
const DA_GHI_NHAN = SALE_STATUS_DA_GHI_NHAN[0]!;

const KT_CS = {
  userId: KT.id,
  isSuperAdmin: false,
  grantsAllow: new Set<string>(),
  permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope: [CS] }],
} as unknown as Actor;

async function don() {
  await db.notification.deleteMany({ where: { dedupeKey: `payment.confirmed:${P}` } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: DON } });
  await db.receipt.deleteMany({ where: { paymentId: { startsWith: T } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { contains: T } } });
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.payment.deleteMany({ where: { orderId: DON, adjustmentOfId: { not: null } } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.student.deleteMany({ where: { id: HV } });
  await db.center.deleteMany({ where: { id: CS } });
}

async function dungFixture(type: "PRODUCT" | "EXAM" | "COURSE") {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở fixture KTT", slug: `${T}co-so`, address: "211 Nguyễn Hữu Thọ" } });
  await db.student.create({ data: { id: HV, name: "Bé KTT", centerId: CS } });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269929-000301",
      type,
      status: "CONFIRMED",
      customerName: "PH KTT",
      customerPhone: "0999000777",
      totalAmount: 1_500_000,
      centerId: CS,
      studentId: HV,
    },
  });
  await db.orderItem.create({
    data: {
      id: DONG,
      orderId: DON,
      type: type === "PRODUCT" ? "PRODUCT" : type === "EXAM" ? "EXAM_REGISTRATION" : "COURSE_ENROLLMENT",
      itemName: type === "PRODUCT" ? "Bộ kit Sata 4" : type === "EXAM" ? "Lệ phí thi RoboSim" : "Sata 4",
      unitPrice: 1_500_000,
      totalPrice: 1_500_000,
    },
  });
  // Khoản KHÔNG gắn ghi danh — đúng hình dạng khoản kit/thi thật (đơn không có ghi danh nào).
  await db.payment.create({
    data: {
      id: P,
      orderId: DON,
      amount: 1_500_000,
      method: "CASH",
      paidDate: new Date("2699-09-28T03:00:00Z"),
      saleStatus: DA_GHI_NHAN,
      accountantStatus: "PENDING",
      enrollmentId: null,
      recordedById: SALE,
      centerId: CS,
    },
  });
}

describe.skipIf(!RUN_DB_TESTS)("[KTT] xác nhận khoản đơn kit/thi không cần ghi danh — Postgres thật", () => {
  afterAll(don);

  for (const type of ["PRODUCT", "EXAM"] as const) {
    it(`[KTT-01-${type}] confirmPayment ⇒ ${DA_XAC_NHAN} + đúng MỘT phiếu thu enrollmentId = null (bấm đôi vẫn một)`, async () => {
      await dungFixture(type);
      const kq = await confirmPayment({ paymentId: P, confirmedById: KT.id });
      expect(kq).toMatchObject({ ok: true, alreadyConfirmed: false });

      const p = await db.payment.findUniqueOrThrow({ where: { id: P } });
      expect(p.accountantStatus).toBe(DA_XAC_NHAN);
      const phieu = await db.receipt.findMany({ where: { paymentId: P } });
      expect(phieu).toHaveLength(1);
      expect(phieu[0]!.enrollmentId).toBeNull();
      expect(phieu[0]!.code).toMatch(/^RCP-/);

      const lai = await confirmPayment({ paymentId: P, confirmedById: KT.id });
      expect(lai).toMatchObject({ ok: true, alreadyConfirmed: true });
      expect(await db.receipt.count({ where: { paymentId: P } })).toBe(1);
    });
  }

  it("[KTT-02] đối chứng: đơn COURSE thiếu ghi danh ⇒ VẪN bị chặn, khoản CHỜ, không phiếu", async () => {
    await dungFixture("COURSE");
    const kq = await confirmPayment({ paymentId: P, confirmedById: KT.id });
    expect(kq).toMatchObject({ ok: false });
    expect(JSON.stringify(kq)).toMatch(/ghi danh/);
    expect((await db.payment.findUniqueOrThrow({ where: { id: P } })).accountantStatus).toBe("PENDING");
    expect(await db.receipt.count({ where: { paymentId: P } })).toBe(0);
  });

  it("[KTT-03] chốt hoá đơn của đơn KIT ⇒ hoá đơn DA_XAC_NHAN + khoản xác nhận + đúng một phiếu thu", async () => {
    await dungFixture("PRODUCT");
    await db.hoaDonDienTu.create({
      data: {
        id: HD,
        orderId: DON,
        centerId: CS,
        trangThai: "NHAP",
        kyHieu: "1C26TSR",
        soHoaDon: "951",
        ngayPhatHanh: new Date("2026-09-28T00:00:00Z"),
        tepPdfKey: `hoa-don/CS1/2026/${DON}/u.pdf`,
        tepPdfTen: "hd.pdf",
        emailNhan: null,
        guiEmailKhach: false,
        tongTien: 1_500_000,
        taoBoiId: KT.id,
        khoan: { create: [{ paymentId: P, soTien: 1_500_000 }] },
      },
    });
    const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD }, select: { updatedAt: true } });
    const donHt = await db.order.findUniqueOrThrow({ where: { id: DON }, select: COT_NGUOI_MUA });
    const kq = await chotHoaDon({
      nguoiChot: KT,
      actor: KT_CS,
      orderId: DON,
      hoaDonId: HD,
      now: NOW,
      phienBan: hd.updatedAt,
      emailDuKien: nguoiMuaChoDon(donHt).email,
    });

    expect(kq.conCho).toEqual([]);
    expect(kq.daXacNhan.map((x) => x.paymentId)).toEqual([P]);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("DA_XAC_NHAN");
    expect((await db.payment.findUniqueOrThrow({ where: { id: P } })).accountantStatus).toBe(DA_XAC_NHAN);
    const phieu = await db.receipt.findMany({ where: { paymentId: P } });
    expect(phieu).toHaveLength(1);
    expect(phieu[0]!.enrollmentId).toBeNull();
  });
});

// ─── Ba chỗ CÒN SÓT sau bản nối đầu (29/09/2026) — cùng luật `thieuGhiDanh` / `donCanGhiDanh` ───
describe.skipIf(!RUN_DB_TESTS)("[KTT-ADJ] điều chỉnh khoản kit/thi đã xác nhận — Postgres thật", () => {
  afterAll(don);

  for (const type of ["PRODUCT", "EXAM"] as const) {
    it(`[KTT-04-${type}] adjustPayment ⇒ sinh bút toán delta, enrollmentId = null, trần = tổng ĐƠN`, async () => {
      await dungFixture(type);
      expect(await confirmPayment({ paymentId: P, confirmedById: KT.id })).toMatchObject({ ok: true });
      const goc = await db.payment.findUniqueOrThrow({ where: { id: P }, select: { updatedAt: true } });

      const kq = await adjustPayment({
        paymentId: P,
        correctAmount: 1_400_000,
        reason: "Nhập thừa 100k",
        actorId: KT.id,
        expectedUpdatedAt: goc.updatedAt,
      });
      expect(kq).toMatchObject({ ok: true, delta: -100_000 });
      const adj = await db.payment.findMany({ where: { adjustmentOfId: P } });
      expect(adj).toHaveLength(1);
      expect(adj[0]!.enrollmentId).toBeNull();
      expect(adj[0]!.orderId).toBe(DON);
      expect(adj[0]!.amount).toBe(-100_000);

      // Trần cấp ĐƠN: tổng đã đóng của đơn không vượt `Order.totalAmount` (1.500.000đ).
      const vuot = await adjustPayment({ paymentId: P, correctAmount: 1_600_000, reason: "thử vượt", actorId: KT.id });
      expect(vuot).toMatchObject({ ok: false });
      expect(JSON.stringify(vuot)).toMatch(/vượt/);
      expect(await db.payment.count({ where: { adjustmentOfId: P } })).toBe(1);
      const veKhong = await adjustPayment({ paymentId: P, correctAmount: 0, reason: "về 0", actorId: KT.id });
      expect(veKhong).toMatchObject({ ok: true, delta: -1_400_000 });
      expect(await db.payment.count({ where: { adjustmentOfId: P } })).toBe(2);
    });
  }

  it("[KTT-04b] đối chứng: đơn COURSE thiếu ghi danh ⇒ VẪN không điều chỉnh được, không sinh dòng nào", async () => {
    await dungFixture("COURSE");
    // COURSE thiếu ghi danh không qua được confirmPayment ⇒ dựng trạng thái đã xác nhận trực tiếp.
    await db.payment.update({ where: { id: P }, data: { accountantStatus: DA_XAC_NHAN } });
    const kq = await adjustPayment({ paymentId: P, correctAmount: 1_400_000, reason: "thử", actorId: KT.id });
    expect(kq).toMatchObject({ ok: false });
    expect(JSON.stringify(kq)).toMatch(/ghi danh/);
    expect(await db.payment.count({ where: { adjustmentOfId: P } })).toBe(0);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[KTT-NOTI] báo phụ huynh khi khoản kit/thi được xác nhận — Postgres thật", () => {
  afterAll(don);

  async function suKienXacNhan() {
    const ev = await db.domainEvent.findFirstOrThrow({ where: { dedupeKey: `payment.confirmed:${P}` } });
    return { id: ev.id, type: ev.type, payload: ev.payloadJson as Record<string, unknown> };
  }

  for (const type of ["PRODUCT", "EXAM"] as const) {
    it(`[KTT-05-${type}] payment.confirmed ⇒ đúng MỘT thông báo cho học viên CỦA ĐƠN, nêu tên dòng đơn`, async () => {
      await dungFixture(type);
      expect(await confirmPayment({ paymentId: P, confirmedById: KT.id })).toMatchObject({ ok: true });
      const ev = await suKienXacNhan();
      await onPaymentConfirmed(ev);
      await onPaymentConfirmed(ev); // phát lại ⇒ vẫn một (dedupeKey như cũ)

      const ds = await db.notification.findMany({ where: { dedupeKey: `payment.confirmed:${P}` } });
      expect(ds).toHaveLength(1);
      expect(ds[0]!.studentId).toBe(HV);
      expect(ds[0]!.centerId).toBe(CS);
      expect(ds[0]!.body).toContain(type === "PRODUCT" ? "Bộ kit Sata 4" : "Lệ phí thi RoboSim");
      expect(ds[0]!.body).toMatch(/RCP-/);
    });
  }

  it("[KTT-05b] đối chứng: đơn COURSE không có ghi danh ⇒ KHÔNG sinh thông báo (giữ hành vi cũ)", async () => {
    await dungFixture("COURSE");
    await onPaymentConfirmed({
      id: `${T}ev`,
      type: "payment.confirmed",
      payload: { paymentId: P, enrollmentId: null, orderId: DON, amount: 1_500_000, receiptCode: "RCP-X" },
    });
    expect(await db.notification.count({ where: { dedupeKey: `payment.confirmed:${P}` } })).toBe(0);
  });
});
