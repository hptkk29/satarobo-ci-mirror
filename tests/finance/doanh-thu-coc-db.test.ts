// tests/finance/doanh-thu-coc-db.test.ts — [COCDB-*] TIỀN CỌC KHÔNG PHẢI DOANH THU cho tới khi đơn trả đủ, trên Postgres THẬT (07/11/2026).
//
// Gọi THẲNG ba hàm báo cáo thật (`getDailyRevenue` · `getRevenueByLeadChild` · `getFunnelCounts`) chứ không chỉ dựng `where`: lưới nối dây (đọc cờ cọc → điều kiện →
// ngày gom) nằm ở chính các hàm ấy, và một test chỉ nhìn `where` không thấy được khi ai đó gỡ dòng gom ngày.
//
// Chủ dự án 07/11: «đơn có cọc thì bấm nút rồi chọn số tiền cọc; cọc loại khỏi doanh thu; tới khi khách thanh toán full thì gom cọc + thanh toán đợt sau lại rồi cho ra
// thành doanh thu». Hình dạng: đơn 10.752.000đ, cọc 3.000.000đ (tháng 10) + phần còn lại 7.752.000đ.
//
//   A  cọc, CHƯA trả đủ — chỉ có khoản cọc 3tr                         ⇒ KHÔNG ở đâu cả
//   B  cọc, ĐÃ trả đủ ngày 20/11 — cọc 3tr (10/10) + còn lại 7.752.000đ ⇒ KHÔNG ở tháng 10; ở tháng 11 ĐỦ 10.752.000đ, vào ngày 20/11
//   C  kế hoạch ĐỢT CŨ (hai phiếu, không nhật ký cọc) 1tr             ⇒ doanh thu theo khoản, tháng 10 (BGĐ 02/11: KHÔNG phải cọc)
//   D  có nhật ký cọc nhưng phiếu đợt 1 đã VOID, 0,5tr                 ⇒ không phải cọc, tháng 10
// Chạy: `pnpm test:finance-db`. KHÔNG `resetDb()`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { getDailyRevenue } from "@/lib/reports/revenue-daily";
import { getRevenueByLeadChild } from "@/lib/reports/revenue-by-child";
import { getFunnelCounts } from "@/lib/crm/funnel-query";
import { docDonCoc } from "@/lib/finance/doanh-thu-coc";
import { shiftDayKey, vnDayStartUtc } from "@/lib/students/birthday-dates";

if (!RUN_DB_TESTS) console.warn(`[COCDB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-cocdb-";
const CS = `${T}cs`;
const ORD = { A: `${T}don-a`, B: `${T}don-b`, C: `${T}don-c`, D: `${T}don-d` } as const;
const SIEU: Actor = {
  userId: `${T}u`, isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [CS], visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
};
const NGAY_TRA_DU = new Date("2699-11-20T03:00:00.000Z");
const loc = (tu: string, den: string) => ({
  centerIds: [CS],
  isAllCenters: false,
  dateFrom: vnDayStartUtc(tu),
  dateTo: new Date(vnDayStartUtc(shiftDayKey(den, 1)).getTime() - 1),
  groupByCenter: false,
});
const THANG10 = loc("2699-10-01", "2699-10-31");
const THANG11 = loc("2699-11-01", "2699-11-30");
const CA_HAI = loc("2699-10-01", "2699-11-30");

async function don() {
  await db.auditLog.deleteMany({ where: { entityId: { in: Object.values(ORD) } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: Object.values(ORD) } } });
  await db.payment.deleteMany({ where: { orderId: { in: Object.values(ORD) } } });
  await db.order.deleteMany({ where: { id: { in: Object.values(ORD) } } });
  await db.center.deleteMany({ where: { id: CS } });
}

const taoDon = (id: string, code: string, total: number, o: { status?: "PENDING_PAYMENT" | "CONFIRMED"; paidAt?: Date } = {}) =>
  db.order.create({
    data: { id, code, type: "COURSE", status: o.status ?? "PENDING_PAYMENT", paidAt: o.paidAt ?? null, customerName: "PH", customerPhone: "0999000444", totalAmount: total, centerId: CS },
  });
const khoan = (id: string, orderId: string, amount: number, paidDate: string) =>
  db.payment.create({
    data: { id: `${T}${id}`, orderId, amount, method: "BANK_TRANSFER", paidDate: new Date(`${paidDate}T03:00:00.000Z`), saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS },
  });
const phieu = (orderId: string, no: number, amountDue: number, status: "PENDING" | "PAID" | "VOID") =>
  db.paymentRequest.create({ data: { orderId, installmentNo: no, amountDue, status, centerId: CS } });
const nhatKyCoc = (orderId: string, soTien: number) =>
  db.auditLog.create({ data: { actorName: "fixture", module: "orders", entityType: "Order", entityId: orderId, action: "THU_TRUOC_TAO", newValues: { soTien, conLai: 0 } } });

describe.skipIf(!RUN_DB_TESTS)("[COCDB] tiền cọc không phải doanh thu cho tới khi trả đủ — Postgres thật", () => {
  beforeAll(async () => {
    await don();
    await db.center.create({ data: { id: CS, name: "CS fixture COCDB", slug: `${T}cs`, address: "x" } });
    // A — cọc, chưa trả đủ
    await taoDon(ORD.A, "ORD-269926-000801", 10_752_000);
    await phieu(ORD.A, 1, 3_000_000, "PAID");
    await phieu(ORD.A, 2, 7_752_000, "PENDING");
    await nhatKyCoc(ORD.A, 3_000_000);
    await khoan("a-coc", ORD.A, 3_000_000, "2699-10-10");
    // B — cọc, trả đủ 20/11
    await taoDon(ORD.B, "ORD-269926-000802", 10_752_000, { status: "CONFIRMED", paidAt: NGAY_TRA_DU });
    await phieu(ORD.B, 1, 3_000_000, "PAID");
    await phieu(ORD.B, 2, 7_752_000, "PAID");
    await nhatKyCoc(ORD.B, 3_000_000);
    await khoan("b-coc", ORD.B, 3_000_000, "2699-10-10");
    await khoan("b-con-lai", ORD.B, 7_752_000, "2699-11-20");
    // C — kế hoạch đợt cũ, KHÔNG nhật ký cọc
    await taoDon(ORD.C, "ORD-269926-000803", 2_000_000);
    await phieu(ORD.C, 1, 1_000_000, "PAID");
    await phieu(ORD.C, 2, 1_000_000, "PENDING");
    await khoan("c-dot1", ORD.C, 1_000_000, "2699-10-12");
    // D — nhật ký cọc nhưng phiếu đợt 1 đã VOID
    await taoDon(ORD.D, "ORD-269926-000804", 5_000_000);
    await phieu(ORD.D, 1, 3_000_000, "VOID");
    await nhatKyCoc(ORD.D, 3_000_000);
    await khoan("d-le", ORD.D, 500_000, "2699-10-13");
  });
  afterAll(don);

  const tongNgay = async (f: ReturnType<typeof loc>) => {
    const r = await getDailyRevenue(SIEU, f);
    return { total: r.total, tongDiem: r.points.reduce((s, p) => s + p.revenue, 0), diem: Object.fromEntries(r.points.filter((p) => p.revenue !== 0).map((p) => [p.day, p.revenue])) };
  };

  it("[COCDB-00] đọc cờ cọc: A và B là đơn cọc (A chưa đủ, B đã đủ ngày 20/11); C (đợt cũ) và D (phiếu VOID) KHÔNG phải cọc", async () => {
    const coc = await docDonCoc(db);
    expect(coc.get(ORD.A)).toEqual({ orderId: ORD.A, daTraDu: false, ngayTraDu: null });
    expect(coc.get(ORD.B)).toEqual({ orderId: ORD.B, daTraDu: true, ngayTraDu: NGAY_TRA_DU });
    expect(coc.has(ORD.C)).toBe(false);
    expect(coc.has(ORD.D)).toBe(false);
  });

  it("[COCDB-01] THÁNG 10: chỉ C (1tr) + D (0,5tr). Cọc 3tr của A và của B KHÔNG vào; ô tổng == tổng các điểm biểu đồ", async () => {
    const r = await tongNgay(THANG10);
    expect(r.total).toBe(1_500_000);
    expect(r.tongDiem).toBe(1_500_000);
    expect(r.diem).toEqual({ "2699-10-12": 1_000_000, "2699-10-13": 500_000 });
  });

  it("[COCDB-02] THÁNG 11: đơn B trả đủ ⇒ cọc + phần còn lại GOM thành ĐỦ 10.752.000đ, vào NGÀY TRẢ ĐỦ 20/11 (cọc đóng tháng 10 không nằm ở tháng 10)", async () => {
    const r = await tongNgay(THANG11);
    expect(r.total).toBe(10_752_000);
    expect(r.tongDiem).toBe(10_752_000);
    expect(r.diem).toEqual({ "2699-11-20": 10_752_000 });
  });

  it("[COCDB-03] CẢ HAI THÁNG: mỗi đồng tính ĐÚNG MỘT lần (không cộng đôi giữa nhánh tiền thường và nhánh cọc); A vẫn bị giữ", async () => {
    const r = await tongNgay(CA_HAI);
    expect(r.total).toBe(12_252_000);
    expect(r.tongDiem).toBe(12_252_000);
  });

  it("[COCDB-04] báo cáo THEO BÉ: cùng luật (tháng 10 = 1,5tr; tháng 11 = 10.752.000đ)", async () => {
    expect((await getRevenueByLeadChild(SIEU, THANG10)).total).toBe(1_500_000);
    expect((await getRevenueByLeadChild(SIEU, THANG11)).total).toBe(10_752_000);
    expect((await getRevenueByLeadChild(SIEU, CA_HAI)).total).toBe(12_252_000);
  });

  it("[COCDB-05] ROAS (không cửa sổ ngày): loại đơn cọc CHƯA trả đủ (A), giữ B trả đủ + C + D", async () => {
    const f = await getFunnelCounts({ centerIds: [CS] });
    expect(f.revenue).toBe(12_252_000);
  });

  it("[COCDB-06] khách trả đủ SAU ĐÓ: A lên CONFIRMED + paidAt ⇒ cọc được gom và ra doanh thu vào ngày trả đủ; trước đó không có", async () => {
    expect((await tongNgay(THANG11)).total).toBe(10_752_000);
    await khoan("a-con-lai", ORD.A, 7_752_000, "2699-11-25");
    await db.paymentRequest.updateMany({ where: { orderId: ORD.A, installmentNo: 2 }, data: { status: "PAID" } });
    await db.order.update({ where: { id: ORD.A }, data: { status: "CONFIRMED", paidAt: new Date("2699-11-25T03:00:00.000Z") } });
    const r = await tongNgay(THANG11);
    expect(r.total).toBe(10_752_000 + 10_752_000);
    expect(r.diem["2699-11-25"]).toBe(10_752_000);
    expect((await tongNgay(THANG10)).total).toBe(1_500_000); // cọc của A vẫn KHÔNG nằm ở tháng 10
  });
});
