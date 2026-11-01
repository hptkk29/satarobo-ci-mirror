// Ca [TXN-DB-*] — AC5 (tách nhiệm vụ) trên Postgres THẬT: người GHI khoản không tự xác nhận khoản của mình.
//
// Sự cố F1: nút ✓ ở màn Thanh toán được vẽ cho chính người đã ghi khoản, trong khi lõi xác nhận từ chối
// (`TU_XAC_NHAN`). Nút nay do cờ `laNguoiGhi` điều khiển (test giao diện: `payments-client.nut-xac-nhan.test.tsx`);
// bộ này giữ phía MÁY CHỦ — cổng KHÔNG được nới hay bỏ khi sửa nút:
//   · TXN-DB-01 — người ghi tự xác nhận ⇒ bị từ chối bằng đúng câu AC5, khoản VẪN chờ, KHÔNG phiếu thu;
//   · TXN-DB-02 — ĐỐI CHỨNG DƯƠNG: cùng khoản đó, một kế toán KHÁC xác nhận ⇒ CONFIRMED + đúng một phiếu thu
//     (cổng không đóng nhầm cho người khác — kẻo ca 01 xanh vì "không ai xác nhận được cả");
//   · TXN-DB-03 — bước chốt hoá đơn: khoản do chính người chốt ghi ⇒ GIỮ CHỜ + nói lý do, hoá đơn vẫn chốt.
//
// Bộ này KHÔNG gọi `resetDb()`: tự dựng, tự dọn theo tiền tố `fx-txn-`.
import { afterAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { chotHoaDon } from "@/lib/finance/hoa-don/chot-hoa-don";
import { COT_NGUOI_MUA } from "@/lib/finance/hoa-don/ghi-hoa-don";
import { nguoiMuaChoDon } from "@/lib/finance/hoa-don/nguoi-mua";
import { confirmPayment } from "@/lib/finance/payment";
import { CAU_TU_XAC_NHAN } from "@/lib/finance/tu-xac-nhan";
import { KHOAN_DA_XAC_NHAN } from "@/lib/finance/debt";
import { SALE_STATUS_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";

if (!RUN_DB_TESTS) console.warn(`[TXN-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-txn-";
const CS = `${T}center`;
const DON = `${T}don`;
const DONG = `${T}dong`;
const HD = `${T}hd`;
const P = `${T}p`;
const NGUOI_GHI = { id: `${T}nguoi-ghi`, name: "Người ghi fixture TXN" };
const KE_TOAN_KHAC = { id: `${T}ke-toan-khac`, name: "Kế toán khác fixture TXN" };
const HV = `${T}hv`;
const NOW = new Date("2699-10-19T08:00:00Z");
const DA_XAC_NHAN = KHOAN_DA_XAC_NHAN.accountantStatus;
const DA_GHI_NHAN = SALE_STATUS_DA_GHI_NHAN[0]!;

const ACTOR_NGUOI_GHI = {
  userId: NGUOI_GHI.id,
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

/** Đơn KIT (PRODUCT: không đòi ghi danh) + MỘT khoản CHỜ do `NGUOI_GHI` ghi nhận. */
async function dungFixture() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở fixture TXN", slug: `${T}co-so`, address: "211 Nguyễn Hữu Thọ" } });
  await db.student.create({ data: { id: HV, name: "Bé TXN", centerId: CS } });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269929-000302",
      type: "PRODUCT",
      status: "CONFIRMED",
      customerName: "PH TXN",
      customerPhone: "0999000778",
      totalAmount: 1_500_000,
      centerId: CS,
      studentId: HV,
    },
  });
  await db.orderItem.create({
    data: { id: DONG, orderId: DON, type: "PRODUCT", itemName: "Bộ kit Sata 4", unitPrice: 1_500_000, totalPrice: 1_500_000 },
  });
  await db.payment.create({
    data: {
      id: P,
      orderId: DON,
      amount: 1_500_000,
      method: "CASH",
      paidDate: new Date("2699-10-18T03:00:00Z"),
      saleStatus: DA_GHI_NHAN,
      accountantStatus: "PENDING",
      enrollmentId: null,
      recordedById: NGUOI_GHI.id,
      centerId: CS,
    },
  });
}

describe.skipIf(!RUN_DB_TESTS)("[TXN-DB] người ghi không tự xác nhận khoản của mình — Postgres thật", () => {
  afterAll(don);

  it("[TXN-DB-01] người GHI tự xác nhận ⇒ từ chối bằng câu AC5, khoản VẪN chờ, KHÔNG phiếu thu", async () => {
    await dungFixture();
    const kq = await confirmPayment({ paymentId: P, confirmedById: NGUOI_GHI.id });
    expect(kq).toMatchObject({ ok: false, error: CAU_TU_XAC_NHAN });
    expect((await db.payment.findUniqueOrThrow({ where: { id: P } })).accountantStatus).toBe("PENDING");
    expect(await db.receipt.count({ where: { paymentId: P } })).toBe(0);
  });

  it("[TXN-DB-02] ĐỐI CHỨNG DƯƠNG: cùng khoản, kế toán KHÁC xác nhận ⇒ CONFIRMED + đúng một phiếu thu", async () => {
    await dungFixture();
    const kq = await confirmPayment({ paymentId: P, confirmedById: KE_TOAN_KHAC.id });
    expect(kq).toMatchObject({ ok: true, alreadyConfirmed: false });
    expect((await db.payment.findUniqueOrThrow({ where: { id: P } })).accountantStatus).toBe(DA_XAC_NHAN);
    expect(await db.receipt.count({ where: { paymentId: P } })).toBe(1);
  });

  it("[TXN-DB-03] chốt hoá đơn do CHÍNH người ghi bấm ⇒ khoản GIỮ CHỜ kèm lý do, hoá đơn vẫn chốt", async () => {
    await dungFixture();
    await db.hoaDonDienTu.create({
      data: {
        id: HD,
        orderId: DON,
        centerId: CS,
        trangThai: "NHAP",
        kyHieu: "1C26TSR",
        soHoaDon: "952",
        ngayPhatHanh: new Date("2026-09-28T00:00:00Z"),
        tepPdfKey: `hoa-don/CS1/2026/${DON}/u.pdf`,
        tepPdfTen: "hd.pdf",
        emailNhan: null,
        guiEmailKhach: false,
        tongTien: 1_500_000,
        taoBoiId: NGUOI_GHI.id,
        khoan: { create: [{ paymentId: P, soTien: 1_500_000 }] },
      },
    });
    const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD }, select: { updatedAt: true } });
    const donHt = await db.order.findUniqueOrThrow({ where: { id: DON }, select: COT_NGUOI_MUA });
    const kq = await chotHoaDon({
      nguoiChot: NGUOI_GHI,
      actor: ACTOR_NGUOI_GHI,
      orderId: DON,
      hoaDonId: HD,
      now: NOW,
      phienBan: hd.updatedAt,
      emailDuKien: nguoiMuaChoDon(donHt).email,
    });

    expect(kq.daXacNhan).toEqual([]);
    expect(kq.conCho).toHaveLength(1);
    expect(kq.conCho[0]!.paymentId).toBe(P);
    expect(kq.conCho[0]!.lyDo).toMatch(/chính bạn ghi nhận/);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("DA_XAC_NHAN");
    expect((await db.payment.findUniqueOrThrow({ where: { id: P } })).accountantStatus).toBe("PENDING");
    expect(await db.receipt.count({ where: { paymentId: P } })).toBe(0);
  });
});
