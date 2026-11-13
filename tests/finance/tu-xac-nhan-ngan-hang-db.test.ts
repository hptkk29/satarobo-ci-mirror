// tests/finance/tu-xac-nhan-ngan-hang-db.test.ts — [TXBDB-*] TỰ XÁC NHẬN khoản tiền đã về ngân hàng, trên Postgres THẬT (08/11/2026).
//
// Gọi THẲNG `chayTuXacNhanKhoanNganHang` (cái cron gọi) chứ không chỉ hàm thuần: thứ cần chứng minh nằm ở dây nối — công tắc theo cơ sở → câu chọn khoản (dùng CHUNG nhánh
// với báo cáo doanh thu) → lõi xác nhận chung → phiếu thu + sự kiện + vết. Fixture mang HÌNH DẠNG CA THẬT (khoản webhook SePay chờ xác nhận) cạnh các khoản KHÔNG được động tới.
//
//   cơ sở BẬT   : kit-web (webhook, đơn KIT)            ⇒ XÁC NHẬN + 1 phiếu thu + 1 sự kiện + 1 vết `TU_XAC_NHAN_NGAN_HANG`
//                 kit-gan-tay (kế toán gắn giao dịch)   ⇒ XÁC NHẬN
//                 kit-tien-mat / kit-ma-gd              ⇒ GIỮ (không có bằng chứng ngân hàng)
//                 kh-web (đơn KHOÁ HỌC, chưa ghi danh)  ⇒ GIỮ (THIEU_GHI_DANH — không đoán ghi danh hộ)
//                 kit-tu-ghi (recordedById = người xác nhận) ⇒ GIỮ (cổng «người ghi ≠ người xác nhận» của lõi, KHÔNG bị ép qua)
//                 kit-tu-choi (REJECTED)                ⇒ không phải ứng viên
//   cơ sở TẮT   : tat-web (webhook)                     ⇒ GIỮ (CO_SO_TAT)
// Chạy: `pnpm test:finance-db`. KHÔNG `resetDb()`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { chayTuXacNhanKhoanNganHang, NGUOI_XAC_NHAN_TU_DONG } from "@/lib/finance/tu-xac-nhan-ngan-hang";
import { gatewayMarker, maGiaoDichMarker } from "@/lib/finance/payment-markers";
import { markerGanTay } from "@/lib/finance/ghi-tien-don";
import { WHERE_DOANH_THU } from "@/lib/finance/thuc-thu";

if (!RUN_DB_TESTS) console.warn(`[TXBDB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-txbdb-";
const CS_BAT = `${T}cs-bat`;
const CS_TAT = `${T}cs-tat`;
const OU_BAT = `${T}ou-bat`;
const OU_TAT = `${T}ou-tat`;
const DON_KIT = `${T}don-kit`;
const DON_KH = `${T}don-kh`;
const DON_TAT = `${T}don-tat`;
const KHOA_CS = "payment.tuXacNhanNganHang";
const NOW = new Date("2699-11-08T03:00:00.000Z");
const PAID = new Date("2699-11-08T02:00:00.000Z");
const ids = (...k: string[]) => k.map((x) => `${T}${x}`);
const TAT_CA = ids("kit-web", "kit-gan-tay", "kit-tien-mat", "kit-ma-gd", "kh-web", "kit-tu-ghi", "kit-tu-choi", "tat-web", "kit-dao", "kit-goc-dao", "dua-1", "dua-2");

async function don() {
  await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: `payment.confirmed:${T}` } } });
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.receipt.deleteMany({ where: { paymentId: { startsWith: T } } });
  await db.payment.updateMany({ where: { orderId: { in: [DON_KIT, DON_KH, DON_TAT] } }, data: { adjustmentOfId: null } });
  await db.payment.deleteMany({ where: { orderId: { in: [DON_KIT, DON_KH, DON_TAT] } } });
  await db.order.deleteMany({ where: { id: { in: [DON_KIT, DON_KH, DON_TAT] } } });
  await db.systemSetting.deleteMany({ where: { key: KHOA_CS } });
  await db.centerSetting.deleteMany({ where: { orgUnitId: { in: [OU_BAT, OU_TAT] } } });
  await db.orgUnit.deleteMany({ where: { id: { in: [OU_BAT, OU_TAT] } } });
  await db.center.deleteMany({ where: { id: { in: [CS_BAT, CS_TAT] } } });
}

const taoDon = (id: string, code: string, type: "PRODUCT" | "COURSE", centerId: string, total: number) =>
  db.order.create({ data: { id, code, type, status: "PENDING_PAYMENT", customerName: "PH", customerPhone: "0999000777", totalAmount: total, centerId } });
const khoan = (k: string, orderId: string, centerId: string, amount: number, note: string | null, o: { status?: "PENDING" | "REJECTED"; recordedById?: string | null; adjustmentOfId?: string } = {}) =>
  db.payment.create({
    data: {
      id: `${T}${k}`, orderId, amount, method: "sepay", paidDate: PAID, saleStatus: "RECORDED", accountantStatus: o.status ?? "PENDING", note,
      recordedById: o.recordedById ?? null, centerId, adjustmentOfId: o.adjustmentOfId ?? null, paymentType: o.adjustmentOfId ? "ADJUSTMENT" : "PAYMENT",
    },
  });
const trangThai = async () => Object.fromEntries((await db.payment.findMany({ where: { id: { in: TAT_CA } }, select: { id: true, accountantStatus: true } })).map((p) => [p.id.replace(T, ""), p.accountantStatus as string]));

describe.skipIf(!RUN_DB_TESTS)("[TXBDB] tự xác nhận khoản tiền đã về ngân hàng — Postgres thật", () => {
  beforeAll(async () => {
    await don();
    await db.center.create({ data: { id: CS_BAT, code: "FXTXB", name: "CS bật TXB", slug: `${T}bat`, address: "x" } });
    await db.center.create({ data: { id: CS_TAT, code: "FXTXC", name: "CS tắt TXB", slug: `${T}tat`, address: "x" } });
    await db.orgUnit.create({ data: { id: OU_BAT, type: "CENTER", code: "FXTXB", name: "ĐV bật", centerId: CS_BAT, path: `/${OU_BAT}/`, depth: 1 } });
    await db.orgUnit.create({ data: { id: OU_TAT, type: "CENTER", code: "FXTXC", name: "ĐV tắt", centerId: CS_TAT, path: `/${OU_TAT}/`, depth: 1 } });
    await taoDon(DON_KIT, "ORD-269926-000901", "PRODUCT", CS_BAT, 50_000_000);
    await taoDon(DON_KH, "ORD-269926-000902", "COURSE", CS_BAT, 5_000_000);
    await taoDon(DON_TAT, "ORD-269926-000903", "PRODUCT", CS_TAT, 4_000_000);
    await khoan("kit-web", DON_KIT, CS_BAT, 7_976_000, `Tiền về qua SEPAY FT26310040803067 ${gatewayMarker("sepay", "FT26310040803067")}`);
    await khoan("kit-gan-tay", DON_KIT, CS_BAT, 1_000_000, `Gắn tay giao dịch SEPAY FT-GT ${markerGanTay("bt-fx-1")}`);
    await khoan("kit-tien-mat", DON_KIT, CS_BAT, 300_000, "khách đưa tiền mặt");
    await khoan("kit-ma-gd", DON_KIT, CS_BAT, 700_000, maGiaoDichMarker("FT26000000000002"));
    await khoan("kh-web", DON_KH, CS_BAT, 2_000_000, `Tiền về qua SEPAY FT-KH ${gatewayMarker("sepay", "FT-KH")}`);
    await khoan("kit-tu-ghi", DON_KIT, CS_BAT, 500_000, `Tiền về qua SEPAY FT-TG ${gatewayMarker("sepay", "FT-TG")}`, { recordedById: NGUOI_XAC_NHAN_TU_DONG });
    await khoan("kit-tu-choi", DON_KIT, CS_BAT, 400_000, `Tiền về qua SEPAY FT-TC ${gatewayMarker("sepay", "FT-TC")}`, { status: "REJECTED" });
    await khoan("tat-web", DON_TAT, CS_TAT, 1_500_000, `Tiền về qua SEPAY FT-TAT ${gatewayMarker("sepay", "FT-TAT")}`);
    // Khoản gốc đã bị «đảo để tách» bởi một dòng còn sống ⇒ KHÔNG phải ứng viên (cùng nhánh loại của doanh thu).
    await khoan("kit-goc-dao", DON_KIT, CS_BAT, 600_000, `Tiền về qua SEPAY FT-GD ${gatewayMarker("sepay", "FT-GD")}`);
    await khoan("kit-dao", DON_KIT, CS_BAT, -600_000, "Đảo để tách khoản", { adjustmentOfId: `${T}kit-goc-dao` });
  });
  afterAll(don);

  it("[TXBDB-01] công tắc TẮT ở mọi cơ sở ⇒ chạy không đổi gì: không khoản nào bị xác nhận, không phiếu thu, không sự kiện (hành vi cũ)", async () => {
    const kq = await chayTuXacNhanKhoanNganHang({ now: NOW });
    expect(kq.daXacNhan).toBe(0);
    expect(kq.boQua.CO_SO_TAT ?? 0).toBeGreaterThanOrEqual(1);
    expect(Object.values(await trangThai()).every((s) => s === "PENDING" || s === "REJECTED")).toBe(true);
    expect(await db.receipt.count({ where: { paymentId: { startsWith: T } } })).toBe(0);
    expect(await db.domainEvent.count({ where: { dedupeKey: { startsWith: `payment.confirmed:${T}` } } })).toBe(0);
  });

  it("[TXBDB-02] BẬT riêng một cơ sở ⇒ chỉ webhook + gắn tay của CƠ SỞ ĐÓ được xác nhận; tiền mặt / mã tự gõ / chưa ghi danh / người ghi=người xác nhận / cơ sở tắt đều GIỮ", async () => {
    await db.centerSetting.create({ data: { orgUnitId: OU_BAT, key: KHOA_CS, valueJson: true } });
    const kq = await chayTuXacNhanKhoanNganHang({ now: NOW });
    expect(kq.loi).toEqual([]);
    const tt = await trangThai();
    expect(tt["kit-web"]).toBe("CONFIRMED");
    expect(tt["kit-gan-tay"]).toBe("CONFIRMED");
    expect(tt["kit-tien-mat"]).toBe("PENDING");
    expect(tt["kit-ma-gd"]).toBe("PENDING");
    expect(tt["kh-web"]).toBe("PENDING");
    expect(tt["kit-tu-ghi"]).toBe("PENDING");
    expect(tt["kit-tu-choi"]).toBe("REJECTED");
    expect(tt["tat-web"]).toBe("PENDING");
    expect(tt["kit-goc-dao"]).toBe("PENDING"); // đã bị đảo ⇒ không phải ứng viên
    expect(kq.daXacNhan).toBe(2);
    expect(kq.boQua.THIEU_GHI_DANH).toBe(1);
    expect(kq.boQua.TU_XAC_NHAN).toBe(1);
  });

  it("[TXBDB-03] khoản được xác nhận mang ĐỦ dấu vết: người xác nhận = hệ thống, ĐÚNG MỘT phiếu thu, ĐÚNG MỘT sự kiện `payment.confirmed`, ĐÚNG MỘT vết TU_XAC_NHAN_NGAN_HANG", async () => {
    for (const k of ids("kit-web", "kit-gan-tay")) {
      const p = await db.payment.findUniqueOrThrow({ where: { id: k }, select: { confirmedById: true, confirmedAt: true } });
      expect(p.confirmedById).toBe(NGUOI_XAC_NHAN_TU_DONG);
      expect(p.confirmedAt?.getTime()).toBe(NOW.getTime());
      expect(await db.receipt.count({ where: { paymentId: k, status: "ACTIVE" } })).toBe(1);
      expect(await db.domainEvent.count({ where: { dedupeKey: `payment.confirmed:${k}` } })).toBe(1);
      expect(await db.auditLog.count({ where: { entityId: k, action: "TU_XAC_NHAN_NGAN_HANG" } })).toBe(1);
    }
    expect(await db.receipt.count({ where: { paymentId: { in: ids("kit-tien-mat", "kit-ma-gd", "kh-web", "kit-tu-ghi", "tat-web") } } })).toBe(0);
  });

  it("[TXBDB-04] chạy LẠI không sinh phiếu thứ hai (idempotent); hai lượt chạy CÙNG LÚC cho khoản mới vẫn chỉ MỘT phiếu thu", async () => {
    const lai = await chayTuXacNhanKhoanNganHang({ now: NOW });
    expect(lai.daXacNhan).toBe(0);
    expect(await db.receipt.count({ where: { paymentId: { startsWith: T } } })).toBe(2);

    await khoan("dua-1", DON_KIT, CS_BAT, 111_000, `Tiền về qua SEPAY FT-D1 ${gatewayMarker("sepay", "FT-D1")}`);
    const [a, b] = await Promise.all([chayTuXacNhanKhoanNganHang({ now: NOW }), chayTuXacNhanKhoanNganHang({ now: NOW })]);
    expect(a.loi).toEqual([]);
    expect(b.loi).toEqual([]);
    expect(await db.receipt.count({ where: { paymentId: `${T}dua-1` } })).toBe(1);
    expect(await db.domainEvent.count({ where: { dedupeKey: `payment.confirmed:${T}dua-1` } })).toBe(1);
  });

  it("[TXBDB-05] khoản KHÔNG được tự xác nhận vẫn tính DOANH THU đúng như trước, và khoản vừa được xác nhận vẫn tính ĐÚNG MỘT LẦN (không cộng đôi giữa nhánh «chờ» và «đã xác nhận»)", async () => {
    const tong = async (idList: string[]) => (await db.payment.aggregate({ where: { ...WHERE_DOANH_THU, id: { in: idList } }, _sum: { amount: true } }))._sum.amount ?? 0;
    // kit-web 7.976.000 + kit-gan-tay 1.000.000 + kh-web 2.000.000 + tat-web 1.500.000 + kit-tu-ghi 500.000 + dua-1 111.000 (webhook / gắn tay — có bằng chứng ngân hàng)
    expect(await tong(ids("kit-web", "kit-gan-tay", "kh-web", "tat-web", "kit-tu-ghi", "dua-1"))).toBe(7_976_000 + 1_000_000 + 2_000_000 + 1_500_000 + 500_000 + 111_000);
    expect(await tong(ids("kit-tien-mat", "kit-ma-gd", "kit-tu-choi"))).toBe(0);
  });
});
