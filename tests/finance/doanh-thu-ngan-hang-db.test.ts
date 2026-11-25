// tests/finance/doanh-thu-ngan-hang-db.test.ts — [DTDB-*] DOANH THU ≠ THỰC THU trên Postgres THẬT (07/11/2026).
//
// Quyết định BGĐ 01–02/11: tiền ĐÃ vào ngân hàng là doanh thu, không chờ kế toán xác nhận. `WHERE_DOANH_THU` là bản SQL của `coBangChungNganHang`;
// `contains` thô nên phải kiểm trên DB thật rằng (a) mỗi loại ghi chú rơi đúng phía, (b) tổng `aggregate` KHỚP tổng cộng từ dòng qua hàm thuần
// (báo cáo vẽ biểu đồ từ dòng, ô tổng lấy từ aggregate — lệch là hai con số cạnh nhau nói hai điều), (c) `WHERE_THUC_THU` CŨ không đổi nghĩa.
//
// Fixture mang HÌNH DẠNG CA THẬT: đơn 8.976.000đ, đợt 1 1.000.000đ đã xác nhận, đợt 2 7.976.000đ qua webhook SePay còn CHỜ xác nhận.
// Chạy: `pnpm test:finance-db` (hoặc `vitest run -c vitest.db.config.ts tests/finance/doanh-thu-ngan-hang-db.test.ts`). KHÔNG `resetDb()`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { WHERE_DOANH_THU, WHERE_THUC_THU, butToanThucThu, coBangChungNganHang } from "@/lib/finance/thuc-thu";
import { gatewayMarker, installmentMarker, maGiaoDichMarker } from "@/lib/finance/payment-markers";

if (!RUN_DB_TESTS) console.warn(`[DTDB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const T = "fx-dtdb-";
const CS = `${T}cs`;
const DON = `${T}don`;
const PAID = new Date("2699-11-06T03:00:00Z");

type Ca = { id: string; amount: number; status: "PENDING" | "CONFIRMED" | "REJECTED" | "REFUNDED"; note: string | null; adj?: string; xoa?: boolean; tinh: boolean; vi: string };

/** Mỗi dòng ghi rõ VÌ SAO nó được / không được tính — bảng này là đặc tả. */
const CA: Ca[] = [
  { id: "p-xn", amount: 1_000_000, status: "CONFIRMED", note: gatewayMarker("sepay", "FT-DOT1"), tinh: true, vi: "đã xác nhận (thực thu cũ)" },
  { id: "p-cho-ck", amount: 7_976_000, status: "PENDING", note: gatewayMarker("sepay", "FT26310040803067"), tinh: true, vi: "CHỜ xác nhận nhưng webhook ngân hàng đã đẩy tiền vào (ca đợt 2)" },
  { id: "p-cho-gantay", amount: 500_000, status: "PENDING", note: "[gan-tay:bt-thuc-1]", tinh: true, vi: "CHỜ xác nhận, kế toán đã gắn giao dịch ngân hàng" },
  { id: "p-cho-tay", amount: 300_000, status: "PENDING", note: "khách đưa tiền mặt", tinh: false, vi: "tiền mặt Sale tự khai — chưa có bằng chứng ngân hàng" },
  { id: "p-cho-null", amount: 200_000, status: "PENDING", note: null, tinh: false, vi: "không ghi chú" },
  { id: "p-cho-dot", amount: 3_000_000, status: "PENDING", note: installmentMarker(1), tinh: false, vi: "khoản kế hoạch TỰ SINH, không phải tiền về" },
  { id: "p-cho-maGd", amount: 700_000, status: "PENDING", note: maGiaoDichMarker("FT26000000000002"), tinh: false, vi: "mã giao dịch do NGƯỜI GÕ khai — chưa phải bằng chứng" },
  { id: "p-cho-lichsu", amount: 900_000, status: "PENDING", note: "[backfill-import]", tinh: false, vi: "nhập lịch sử" },
  { id: "p-tuchoi", amount: 4_000_000, status: "REJECTED", note: gatewayMarker("sepay", "FT-TUCHOI"), tinh: false, vi: "kế toán TỪ CHỐI — kể cả có marker webhook" },
  { id: "p-xoa", amount: 2_000_000, status: "PENDING", note: gatewayMarker("sepay", "FT-XOA"), xoa: true, tinh: false, vi: "đã xoá mềm" },
  { id: "p-dao", amount: -1_000_000, status: "PENDING", note: gatewayMarker("sepay", "FT-DAO"), adj: "p-xn", tinh: false, vi: "bút toán đảo PENDING" },
  { id: "p-hoan", amount: -1_000_000, status: "REFUNDED", note: null, adj: "p-xn", tinh: true, vi: "hoàn tiền (số âm) — vẫn trừ như cũ" },
  // Ca đo trên PROD 07/11 (ORD-261004-000007): gốc PENDING có marker gắn tay bị «đảo để tách khoản», hai phần tách cũng bị đảo ⇒ ròng 0.
  { id: "p-tach-goc", amount: 5_016_000, status: "PENDING", note: "[gan-tay:bt-tach]", tinh: false, vi: "gốc đã bị ĐẢO để tách khoản — ròng 0, KHÔNG được tính" },
  { id: "p-tach-dao", amount: -5_016_000, status: "PENDING", note: "Đảo để tách khoản cho 2 bé [tach:x]", adj: "p-tach-goc", tinh: false, vi: "bút toán đảo (PENDING)" },
  { id: "p-tach-a", amount: 2_640_000, status: "PENDING", note: "[gan-tay:bt-tach]", tinh: false, vi: "phần tách A — đã bị đảo lại" },
  { id: "p-tach-a-dao", amount: -2_640_000, status: "PENDING", note: "Đảo bút toán [gan-tay:bt-tach]", adj: "p-tach-a", tinh: false, vi: "đảo phần tách A" },
  { id: "p-tach-b", amount: 2_376_000, status: "PENDING", note: "[gan-tay:bt-tach]", tinh: false, vi: "phần tách B — đã bị đảo lại" },
  { id: "p-tach-b-dao", amount: -2_376_000, status: "PENDING", note: "Đảo bút toán [gan-tay:bt-tach]", adj: "p-tach-b", tinh: false, vi: "đảo phần tách B" },
];

async function don() {
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.center.deleteMany({ where: { id: CS } });
}

describe.skipIf(!RUN_DB_TESTS)("[DTDB] doanh thu = thực thu + tiền đã vào ngân hàng chưa xác nhận — Postgres thật", () => {
  beforeAll(async () => {
    await don();
    await db.center.create({ data: { id: CS, name: "CS fixture DTDB", slug: `${T}cs`, address: "x" } });
    await db.order.create({ data: { id: DON, code: "ORD-269926-000777", type: "COURSE", status: "CONFIRMED", customerName: "PH", customerPhone: "0999000555", totalAmount: 8_976_000, centerId: CS } });
    for (const c of CA) {
      await db.payment.create({
        data: {
          id: `${T}${c.id}`, orderId: DON, amount: c.amount, method: "BANK_TRANSFER", paidDate: PAID, saleStatus: "RECORDED", accountantStatus: c.status, note: c.note, centerId: CS,
          adjustmentOfId: c.adj ? `${T}${c.adj}` : null, paymentType: c.adj ? "ADJUSTMENT" : "PAYMENT", deletedAt: c.xoa ? new Date() : null,
        },
      });
    }
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  const theoDon = { orderId: DON };

  it("[DTDB-01] mỗi loại ghi chú rơi ĐÚNG phía: danh sách dòng mà WHERE_DOANH_THU trả = đúng các ca khai `tinh: true`", async () => {
    const rows = await db.payment.findMany({ where: { ...WHERE_DOANH_THU, ...theoDon }, select: { id: true } });
    const co = rows.map((r) => r.id.replace(T, "")).sort();
    const mong = CA.filter((c) => c.tinh).map((c) => c.id).sort();
    expect(co).toEqual(mong);
  });

  it("[DTDB-02] tổng aggregate (ô «tổng») == tổng cộng từ DÒNG qua hàm thuần (biểu đồ) — hai con số cạnh nhau không được nói hai điều", async () => {
    const [agg, rows] = await Promise.all([
      db.payment.aggregate({ where: { ...WHERE_DOANH_THU, ...theoDon }, _sum: { amount: true } }),
      db.payment.findMany({ where: { ...WHERE_DOANH_THU, ...theoDon }, select: { id: true, amount: true, accountantStatus: true, adjustmentOfId: true, note: true } }),
    ]);
    const tuDong = butToanThucThu(rows.map((r) => ({ ...r, accountantStatus: r.accountantStatus as string, coBangChungNganHang: coBangChungNganHang(r.note) }))).reduce((s, r) => s + r.amount, 0);
    // 1.000.000 + 7.976.000 + 500.000 − 1.000.000 (hoàn)
    expect(agg._sum.amount).toBe(8_476_000);
    expect(tuDong).toBe(8_476_000);
  });

  it("[DTDB-03] ca thật: đợt 2 7.976.000đ chưa xác nhận ĐÃ nằm trong doanh thu, nhưng KHÔNG nằm trong thực thu cũ", async () => {
    const dot2 = `${T}p-cho-ck`;
    const [dt, tt] = await Promise.all([
      db.payment.count({ where: { ...WHERE_DOANH_THU, id: dot2 } }),
      db.payment.count({ where: { ...WHERE_THUC_THU, id: dot2 } }),
    ]);
    expect(dt).toBe(1);
    expect(tt).toBe(0);
  });

  it("[DTDB-04] WHERE_THUC_THU CŨ không đổi nghĩa: chỉ CONFIRMED + REFUNDED (công nợ / hoa hồng / cổng phụ huynh dựa vào nó)", async () => {
    const rows = await db.payment.findMany({ where: { ...WHERE_THUC_THU, ...theoDon }, select: { id: true } });
    expect(rows.map((r) => r.id.replace(T, "")).sort()).toEqual(["p-hoan", "p-xn"]);
  });

  it("[DTDB-05] khoản kế toán xác nhận SAU đó vẫn tính ĐÚNG MỘT LẦN; bị từ chối thì rơi ra", async () => {
    const id = `${T}p-cho-ck`;
    const tong = async () => (await db.payment.aggregate({ where: { ...WHERE_DOANH_THU, ...theoDon }, _sum: { amount: true } }))._sum.amount;
    expect(await tong()).toBe(8_476_000);
    await db.payment.update({ where: { id }, data: { accountantStatus: "CONFIRMED" } });
    expect(await tong()).toBe(8_476_000); // không cộng đôi
    await db.payment.update({ where: { id }, data: { accountantStatus: "REJECTED" } });
    expect(await tong()).toBe(8_476_000 - 7_976_000);
    await db.payment.update({ where: { id }, data: { accountantStatus: "PENDING" } }); // trả lại
  });
});
