// [QSN-DB-*] «Đơn đã xuất hoá đơn chưa» trên Postgres THẬT — phần đọc của luật sửa người mua (06/11/2026).
// Luật thuần ở `lib/finance/hoa-don/quyen-sua-nguoi-mua.test.ts`; ở đây chứng minh `docDonDaXuatHoaDon` đọc ĐÚNG bảng, KHÔNG phụ thuộc phạm vi của người xem
// (cổng khoá phải fail-closed), và thấy mọi trạng thái hoá đơn thật.
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { docDonDaXuatHoaDon } from "@/lib/finance/hoa-don/quyen-sua-nguoi-mua";

if (!RUN_DB_TESTS) console.warn(`[QSN-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-qsn-";
const CS = `${T}center`;
const DON = `${T}don`;
const DON2 = `${T}don-2`;

async function don() {
  await db.hoaDonDienTu.deleteMany({ where: { orderId: { in: [DON, DON2] } } });
  await db.order.deleteMany({ where: { id: { in: [DON, DON2] } } });
  await db.center.deleteMany({ where: { id: CS } });
}

const hoaDon = (orderId: string, trangThai: "NHAP" | "DA_XAC_NHAN" | "THAY_THE" | "KHONG_XUAT" | "DANG_PHAT_HANH" | "LOI_PHAT_HANH", lyDo: string | null = null) =>
  db.hoaDonDienTu.create({
    data: {
      orderId,
      centerId: CS,
      trangThai,
      tongTien: 1_000_000,
      taoBoiId: `${T}ke-toan`,
      lyDo,
      // THAY_THE đòi đủ ba cột huỷ (CHECK ở DB).
      ...(trangThai === "THAY_THE" ? { huyLyDo: "đã huỷ fixture", huyBoiId: `${T}ke-toan`, huyLuc: new Date("2026-11-06T00:00:00Z") } : {}),
    },
  });

describe.skipIf(!RUN_DB_TESTS)("[QSN-DB] đơn đã xuất hoá đơn chưa — Postgres thật", () => {
  beforeEach(async () => {
    await don();
    await db.center.create({ data: { id: CS, code: "FXQSN", name: "Cơ sở fixture QSN", slug: `${T}co-so`, address: "1 Fixture" } });
    for (const id of [DON, DON2]) {
      await db.order.create({
        data: { id, code: `ORD-QSN-${id.slice(-1)}`, type: "COURSE", status: "CONFIRMED", customerName: "PH QSN", customerPhone: "0999000777", totalAmount: 1_000_000, centerId: CS, createdById: `${T}sale` },
      });
    }
  });
  afterAll(don);

  it("[QSN-DB-01] đơn chưa có hoá đơn nào ⇒ chưa xuất", async () => {
    expect(await docDonDaXuatHoaDon(DON)).toBe(false);
  });

  it("[QSN-DB-02] mỗi trạng thái KHOÁ (NHAP · DANG_PHAT_HANH · DA_XAC_NHAN · KHONG_XUAT «đã xuất ngoài hệ thống») ⇒ đã xuất", async () => {
    for (const [t, lyDo] of [["NHAP", null], ["DANG_PHAT_HANH", null], ["DA_XAC_NHAN", null], ["KHONG_XUAT", "Đã xuất ngoài hệ thống"]] as const) {
      await db.hoaDonDienTu.deleteMany({ where: { orderId: DON } });
      await hoaDon(DON, t, lyDo);
      expect(await docDonDaXuatHoaDon(DON), t).toBe(true);
    }
  });

  it("[QSN-DB-03] ĐỐI CHỨNG ÂM: LOI_PHAT_HANH · THAY_THE (đã huỷ) · KHONG_XUAT vì lý do khác ⇒ KHÔNG khoá (còn đường sửa lỗi / làm lại)", async () => {
    for (const [t, lyDo] of [["LOI_PHAT_HANH", null], ["THAY_THE", "đã huỷ"], ["KHONG_XUAT", "Khách không lấy hoá đơn"]] as const) {
      await db.hoaDonDienTu.deleteMany({ where: { orderId: DON } });
      await hoaDon(DON, t, lyDo);
      expect(await docDonDaXuatHoaDon(DON), t).toBe(false);
    }
  });

  it("[QSN-DB-04] hoá đơn của đơn KHÁC không làm đơn này thành «đã xuất» (đọc theo đúng orderId)", async () => {
    await hoaDon(DON2, "DA_XAC_NHAN");
    expect(await docDonDaXuatHoaDon(DON)).toBe(false);
    expect(await docDonDaXuatHoaDon(DON2)).toBe(true);
  });

  it("[QSN-DB-05] một đơn có cả bản lỗi lẫn bản đã chốt ⇒ khoá (chỉ cần MỘT hoá đơn đã xuất)", async () => {
    await hoaDon(DON, "LOI_PHAT_HANH");
    await hoaDon(DON, "DA_XAC_NHAN");
    expect(await docDonDaXuatHoaDon(DON)).toBe(true);
  });
});
