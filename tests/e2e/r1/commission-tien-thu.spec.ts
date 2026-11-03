/**
 * Hoa hồng trên TIỀN ĐÃ THU (chốt 27/08/2026) — chạy trên Postgres LOCAL thật.
 *
 * Bộ thuần ở `lib/crm/commission-thuc-thu.test.ts` đã phủ phép tính. Bộ này phủ đúng
 * những thứ CHỈ DB mới lộ ra:
 *   • `WHERE_THUC_THU` có thật sự lọc đúng trên SQL không (PENDING bị loại; gốc và dòng
 *     điều chỉnh DELTA thì CẢ HAI cùng được cộng — xem [HH-TT-6]);
 *   • bút toán hoàn do CHÍNH `refundPayment()` sinh ra có khớp với thứ engine mong đợi;
 *   • CHỐT LẠI KỲ có cộng đôi không — rủi ro chính, vì khoá unique KHÔNG che đường này.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { assertTestDb } from "../../e2e/_helpers/seed";
import { chotKyHoaHong } from "../../../lib/crm/commission-run";
import { refundPayment } from "../../../lib/finance/payment";

const ACC = { id: "acc-hh", name: "Kế toán" };
const SALE = "u-sale-chot";
const ADMIN = "u-sale-admin";

const KY_1 = "2026-06";
const KY_2 = "2026-07";
const NGAY_KY_1 = new Date("2026-06-10T09:00:00+07:00");
const NGAY_KY_2 = new Date("2026-07-08T09:00:00+07:00");

let leadId = "";
let orderId = "";

/** Tổng tiền một tầng trong một kỳ (gồm cả dòng âm). */
async function tienTang(period: string, tier: string): Promise<number> {
  const rows = await db.commissionLine.findMany({
    where: { tier, statement: { period } },
    select: { amount: true },
  });
  return rows.reduce((s, r) => s + r.amount, 0);
}

async function soDong(period: string): Promise<number> {
  return db.commissionLine.count({ where: { statement: { period } } });
}

/** Ghi 1 khoản đã được kế toán xác nhận. */
async function thuTien(amount: number, paidDate: Date) {
  return db.payment.create({
    data: { orderId, amount, method: "chuyen-khoan", paidDate, accountantStatus: "CONFIRMED" },
  });
}

test.describe("[HH-TT] hoa hồng theo tiền đã thu", () => {
  test.beforeEach(async () => {
    assertTestDb();
    await db.commissionLine.deleteMany({});
    await db.commissionStatement.deleteMany({});
    await db.commissionRateConfig.deleteMany({}); // rỗng ⇒ dùng DEFAULT_RATES (Sale 4%)
    await db.payment.deleteMany({});
    await db.order.deleteMany({});
    await db.lead.deleteMany({});

    const lead = await db.lead.create({
      data: {
        parentName: "Phụ huynh Test",
        phone: "0900000001",
        convertedById: SALE, // người CHỐT CUỐI → tầng SALE 4%
        adminId: ADMIN, // Sale Admin bàn giao → tầng SALE_ADMIN 1%
      },
    });
    leadId = lead.id;
    const order = await db.order.create({
      data: {
        code: `ORD-HHTT-${Date.now()}`,
        type: "COURSE",
        customerName: "Phụ huynh Test",
        customerPhone: "0900000001",
        totalAmount: 20_000_000, // hợp đồng 20 triệu — CỐ Ý không dùng để tính hoa hồng
        leadId,
      },
    });
    orderId = order.id;
  });

  test("[HH-TT-1] đóng một phần: 4% × TIỀN ĐÃ THU, không phải × giá hợp đồng", async () => {
    await thuTien(5_000_000, NGAY_KY_1);

    const kq = await chotKyHoaHong(ACC, { period: KY_1 });

    // Hợp đồng 20tr nhưng mới đóng 5tr ⇒ 4% × 5tr = 200k (không phải 800k).
    expect(await tienTang(KY_1, "SALE")).toBe(200_000);
    expect(await tienTang(KY_1, "SALE_ADMIN")).toBe(50_000);
    expect(kq.soButToan).toBe(1);

    // QC + QL TT của cơ sở này CHƯA khai người hưởng ⇒ KHÔNG sinh dòng, và số tiền
    // treo được BÁO RA (hành vi giữ nguyên sau 27/08 — xem [HH-TT-8]).
    expect(await tienTang(KY_1, "QC")).toBe(0);
    expect(await tienTang(KY_1, "QL_TT")).toBe(0);
    expect(kq.chuaCoNguoiHuong.QC).toBe(50_000); // 1% × 5tr
    expect(kq.chuaCoNguoiHuong.QL_TT).toBe(100_000); // 2% × 5tr
  });

  /**
   * [HH-TT-8] 27/08/2026 — KHAI NGƯỜI HƯỞNG THÌ SỐ TREO PHẢI VỀ 0.
   *
   * Đây là tiêu chí nghiệm thu của đợt này: trước đó chỉ 5/8 phần trăm chảy được.
   * Phần thuần đã có ở `lib/crm/commission-run.test.ts`; ca này phủ đúng khúc CHỈ DB
   * mới lộ: `chotKyHoaHong` có thật sự ĐỌC bảng phân công và nối được cơ sở của bút
   * toán với dòng phân công hay không.
   */
  test("[HH-TT-8] khai QC + Quản lý TT → hai tầng sinh dòng thật, treo về 0", async () => {
    const center = await db.center.upsert({
      where: { slug: "cs-hoa-hong-test" },
      update: {},
      create: { name: "CS Hoa Hồng Test", slug: "cs-hoa-hong-test", address: "1 Test", city: "Đà Nẵng" },
    });
    const qc = await db.user.upsert({
      where: { email: "qc-hoahong@test.local" },
      update: {},
      create: { name: "QC Test", email: "qc-hoahong@test.local", role: "MARKETING" },
    });
    const ql = await db.user.upsert({
      where: { email: "qltt-hoahong@test.local" },
      update: {},
      create: { name: "QL TT Test", email: "qltt-hoahong@test.local", role: "CENTER_MANAGER" },
    });
    await db.centerCommissionAssignee.deleteMany({ where: { centerId: center.id } });
    for (const [role, userId] of [
      ["QC", qc.id],
      ["QL_TT", ql.id],
    ] as const) {
      await db.centerCommissionAssignee.create({
        data: {
          centerId: center.id,
          role,
          userId,
          // Hiệu lực TRƯỚC kỳ đang chốt — người hưởng được soi tại mốc xác nhận thu tiền.
          effectiveFrom: new Date("2026-01-01T00:00:00+07:00"),
        },
      });
    }
    await db.order.update({ where: { id: orderId }, data: { centerId: center.id } });

    const p = await thuTien(5_000_000, NGAY_KY_1);
    await db.payment.update({
      where: { id: p.id },
      data: { centerId: center.id, confirmedAt: NGAY_KY_1 },
    });

    const kq = await chotKyHoaHong(ACC, { period: KY_1 });

    expect(await tienTang(KY_1, "QC")).toBe(50_000); // 1% × 5tr
    expect(await tienTang(KY_1, "QL_TT")).toBe(100_000); // 2% × 5tr
    expect(kq.chuaCoNguoiHuong).toEqual({});
    expect(kq.treoTheoCoSo).toEqual([]);
    // Σ cả kỳ = ĐÚNG 8% — đây là lần đầu tiên toàn bộ pool chảy được.
    expect(
      (await db.commissionLine.findMany({ where: { statement: { period: KY_1 } }, select: { amount: true } }))
        .reduce((s, r) => s + r.amount, 0),
    ).toBe(400_000);
  });

  test("[HH-TT-2] nhiều đợt cùng kỳ + vắt qua hai tháng", async () => {
    await thuTien(5_000_000, NGAY_KY_1);
    await thuTien(3_000_000, new Date("2026-06-25T09:00:00+07:00"));
    await thuTien(2_000_000, NGAY_KY_2); // đợt cuối rơi sang tháng 7

    await chotKyHoaHong(ACC, { period: KY_1 });
    await chotKyHoaHong(ACC, { period: KY_2 });

    expect(await tienTang(KY_1, "SALE")).toBe(320_000); // 4% × 8tr
    expect(await tienTang(KY_2, "SALE")).toBe(80_000); // 4% × 2tr
    // Hai đợt trong tháng 6 gộp thành MỘT dòng SALE, không phải hai.
    expect(await db.commissionLine.count({ where: { tier: "SALE", statement: { period: KY_1 } } })).toBe(1);
  });

  test("[HH-TT-3] khoản PENDING chưa phải tiền thật → không sinh hoa hồng", async () => {
    await db.payment.create({
      data: { orderId, amount: 9_000_000, method: "tien-mat", paidDate: NGAY_KY_1, accountantStatus: "PENDING" },
    });

    const kq = await chotKyHoaHong(ACC, { period: KY_1 });
    expect(kq.soButToan).toBe(0);
    expect(await soDong(KY_1)).toBe(0);
  });

  test("[HH-TT-4] hoàn TOÀN BỘ ở tháng SAU: kỳ cũ bất động, kỳ hoàn sinh dòng âm", async () => {
    const goc = await thuTien(10_000_000, NGAY_KY_1);
    await chotKyHoaHong(ACC, { period: KY_1 });
    expect(await tienTang(KY_1, "SALE")).toBe(400_000);

    // Dùng CHÍNH hàm hoàn tiền của sản phẩm — để test bắt được nếu nó đổi cách ghi sổ.
    const res = await refundPayment({ paymentId: goc.id, confirmedById: ACC.id, reason: "PH xin rút" });
    expect(res.ok).toBe(true);
    // `refundPayment` ghi paidDate = NOW; dời về tháng 7 để mô phỏng "hoàn ở kỳ sau"
    // một cách TẤT ĐỊNH (không phụ thuộc đồng hồ máy chạy test). Dấu, trạng thái và
    // `adjustmentOfId` vẫn là thứ hàm thật sinh ra — chỉ ngày là do test đặt.
    const butToanHoan = await db.payment.findFirst({ where: { adjustmentOfId: goc.id } });
    expect(butToanHoan?.amount).toBe(-10_000_000);
    expect(butToanHoan?.accountantStatus).toBe("REFUNDED");
    await db.payment.update({ where: { id: butToanHoan!.id }, data: { paidDate: NGAY_KY_2 } });

    await chotKyHoaHong(ACC, { period: KY_2 });

    // Kỳ 6 KHÔNG đổi (đã trả lương rồi), kỳ 7 thu hồi đúng bằng phần đã trả.
    expect(await tienTang(KY_1, "SALE")).toBe(400_000);
    expect(await tienTang(KY_2, "SALE")).toBe(-400_000);
    const claw = await db.commissionLine.findFirst({
      where: { tier: "SALE", statement: { period: KY_2 } },
    });
    expect(claw?.isClawback).toBe(true);
    expect(claw?.note).toContain(goc.id); // truy nguyên về khoản gốc
    expect(claw?.leadId).toBe(leadId);
  });

  test("[HH-TT-5] hoàn MỘT PHẦN trong cùng kỳ → còn lại đúng phần chưa hoàn", async () => {
    const goc = await thuTien(10_000_000, NGAY_KY_1);
    const res = await refundPayment({
      paymentId: goc.id,
      confirmedById: ACC.id,
      reason: "hoàn một phần",
      amount: 4_000_000,
    });
    expect(res.ok).toBe(true);
    const hoan = await db.payment.findFirst({ where: { adjustmentOfId: goc.id } });
    await db.payment.update({ where: { id: hoan!.id }, data: { paidDate: NGAY_KY_1 } });

    await chotKyHoaHong(ACC, { period: KY_1 });

    expect(await tienTang(KY_1, "SALE")).toBe(240_000); // 4% × (10tr − 4tr)
    // Vẫn thấy CẢ HAI vế — không bù trừ im lặng thành một dòng.
    expect(await db.commissionLine.count({ where: { tier: "SALE", statement: { period: KY_1 } } })).toBe(2);
  });

  test("[HH-TT-6] điều chỉnh khoản thu → gốc + delta ra số đúng, không cộng đôi", async () => {
    const goc = await thuTien(10_000_000, NGAY_KY_1);

    // 🔴 ĐỔI MÔ HÌNH 07/09/2026 (`payment_type_tach_khoi_status`), áp khi hợp nhất
    // `main` → `test` ngày 16/09.
    //   TRƯỚC: bút toán điều chỉnh mang trạng thái `ADJUSTED` và SỐ ĐÚNG (6tr), bản gốc
    //     giữ 10tr ⇒ `WHERE_THUC_THU` phải LOẠI gốc, không thì hoa hồng ăn 16tr.
    //   NAY: nó là dòng `CONFIRMED` + `paymentType = "ADJUSTMENT"` mang PHẦN CHÊNH LỆCH
    //     (−4tr), bản gốc giữ nguyên, phép cộng lấy CẢ HAI ⇒ 10tr − 4tr = 6tr.
    // Con số hoa hồng KHÔNG đổi (240k); thứ đổi là SỐ BÚT TOÁN. Loại nhầm bản gốc bây
    // giờ là đếm THIẾU đúng phần vừa sửa — ngược hẳn lỗi cũ.
    //
    // ⚠️ Dựng dòng delta THẲNG bằng `payment.create` thay vì gọi `adjustPayment`: hàm đó
    // nay đòi khoản thu phải gắn `enrollmentId` (để kiểm trần học phí) — ràng buộc nghiệp
    // vụ KHÁC, không phải thứ ca này đo. Ca này hỏi đúng một câu: phép cộng thực thu ở
    // tầng SQL có lấy đủ gốc + delta không. Cổng trần học phí đã có
    // `tests/finance/dieu-chinh.test.ts` phủ riêng.
    // Các trường dưới chép đúng những gì `adjustPayment` ghi (lib/finance/payment.ts).
    await db.payment.create({
      data: {
        orderId,
        amount: -4_000_000,
        method: "chuyen-khoan",
        paidDate: NGAY_KY_1,
        accountantStatus: "CONFIRMED",
        paymentType: "ADJUSTMENT",
        adjustmentOfId: goc.id,
        confirmedAt: NGAY_KY_1,
      },
    });

    const kq = await chotKyHoaHong(ACC, { period: KY_1 });
    expect(kq.soButToan).toBe(2); // gốc + dòng điều chỉnh, cả hai cùng sống
    expect(await tienTang(KY_1, "SALE")).toBe(240_000); // 4% × (10tr − 4tr)
  });

  test("[HH-TT-7] CHỐT LẠI KỲ HAI LẦN — không cộng đôi, bảng kê trùng khít", async () => {
    // Rủi ro chính của cả đợt. Khoá `@@unique(statementId, tier, recipientId,
    // enrollmentId)` KHÔNG che được đường này (enrollmentId NULL, mà NULL ≠ NULL
    // trong UNIQUE của Postgres) — thứ chống trùng là deleteMany+createMany trong
    // cùng transaction của `setStatementLines`.
    await thuTien(5_000_000, NGAY_KY_1);
    await thuTien(3_000_000, new Date("2026-06-20T09:00:00+07:00"));

    await chotKyHoaHong(ACC, { period: KY_1 });
    const lan1 = await db.commissionLine.findMany({
      where: { statement: { period: KY_1 } },
      orderBy: [{ tier: "asc" }, { recipientId: "asc" }],
      select: { tier: true, recipientId: true, amount: true, isClawback: true, leadId: true, note: true },
    });

    await chotKyHoaHong(ACC, { period: KY_1 });
    await chotKyHoaHong(ACC, { period: KY_1 }); // lần thứ ba cho chắc
    const lan3 = await db.commissionLine.findMany({
      where: { statement: { period: KY_1 } },
      orderBy: [{ tier: "asc" }, { recipientId: "asc" }],
      select: { tier: true, recipientId: true, amount: true, isClawback: true, leadId: true, note: true },
    });

    expect(lan3).toEqual(lan1);
    expect(await tienTang(KY_1, "SALE")).toBe(320_000); // KHÔNG phải 960k
    expect(await soDong(KY_1)).toBe(lan1.length);
  });

  test("[HH-TT-8] chốt lại KHÔNG xoá dòng hoa hồng GV dạy Trial của cùng kỳ", async () => {
    // Tầng TRIAL_TEACHER nằm ngoài pool 8% và được sinh từng dòng lúc convert, KHÔNG
    // tính lại theo kỳ. `setStatementLines` phải chừa nó ra, nếu không mỗi lần kế toán
    // chốt kỳ Sale là giáo viên mất hoa hồng.
    await thuTien(5_000_000, NGAY_KY_1);
    await chotKyHoaHong(ACC, { period: KY_1 });

    const stmt = await db.commissionStatement.findUnique({ where: { period: KY_1 } });
    await db.commissionLine.create({
      data: {
        statementId: stmt!.id,
        tier: "TRIAL_TEACHER",
        recipientId: "u-giao-vien",
        amount: 120_000,
        enrollmentId: "enr-gia-dinh",
      },
    });

    await chotKyHoaHong(ACC, { period: KY_1 });

    expect(await tienTang(KY_1, "TRIAL_TEACHER")).toBe(120_000);
    expect(await tienTang(KY_1, "SALE")).toBe(200_000);
  });

  test("[HH-TT-9] kỳ đã APPROVED → từ chối chốt lại (phải REOPEN)", async () => {
    await thuTien(5_000_000, NGAY_KY_1);
    await chotKyHoaHong(ACC, { period: KY_1 });
    await db.commissionStatement.update({ where: { period: KY_1 }, data: { status: "APPROVED" } });

    await expect(chotKyHoaHong(ACC, { period: KY_1 })).rejects.toThrow(/APPROVED|REOPEN/i);
    // Số của kỳ đã duyệt không suy suyển.
    expect(await tienTang(KY_1, "SALE")).toBe(200_000);
  });

  test("[HH-TT-11] nhiều lead cùng một người chốt → nhiều dòng, KHÔNG vướng khoá unique", async () => {
    // Các dòng 4 tầng Sale đều để `enrollmentId = NULL`. Nếu Postgres coi NULL = NULL
    // trong UNIQUE(statementId, tier, recipientId, enrollmentId) thì `createMany` sẽ
    // ném P2002 ngay khi một người chốt hai phiếu trong cùng kỳ. Test này chốt hành vi
    // đó lại — và cũng là bằng chứng vì sao khoá ấy KHÔNG dùng để chống trùng được.
    await thuTien(5_000_000, NGAY_KY_1);

    const lead2 = await db.lead.create({
      data: { parentName: "PH hai", phone: "0900000002", convertedById: SALE, adminId: ADMIN },
    });
    const order2 = await db.order.create({
      data: {
        code: `ORD-HHTT2-${Date.now()}`,
        type: "COURSE",
        customerName: "PH hai",
        customerPhone: "0900000002",
        leadId: lead2.id,
      },
    });
    await db.payment.create({
      data: {
        orderId: order2.id,
        amount: 3_000_000,
        method: "tien-mat",
        paidDate: NGAY_KY_1,
        accountantStatus: "CONFIRMED",
      },
    });

    await chotKyHoaHong(ACC, { period: KY_1 });

    // Hai dòng SALE riêng cho cùng một người chốt — tách theo lead.
    const sale = await db.commissionLine.findMany({
      where: { tier: "SALE", recipientId: SALE, statement: { period: KY_1 } },
    });
    expect(sale).toHaveLength(2);
    expect(sale.map((l) => l.leadId).sort()).toEqual([leadId, lead2.id].sort());
    expect(await tienTang(KY_1, "SALE")).toBe(320_000); // 4% × 8tr

    // Và chốt lại vẫn không cộng đôi khi có nhiều lead.
    await chotKyHoaHong(ACC, { period: KY_1 });
    expect(await tienTang(KY_1, "SALE")).toBe(320_000);
  });

  test("[HH-TT-12] đơn không gắn phiếu (khách vãng lai) → không sinh hoa hồng, nhưng BÁO RA", async () => {
    const orderLe = await db.order.create({
      data: {
        code: `ORD-LE-${Date.now()}`,
        type: "COURSE",
        customerName: "Khách vãng lai",
        customerPhone: "0900000009",
      },
    });
    await db.payment.create({
      data: {
        orderId: orderLe.id,
        amount: 7_000_000,
        method: "tien-mat",
        paidDate: NGAY_KY_1,
        accountantStatus: "CONFIRMED",
      },
    });

    const kq = await chotKyHoaHong(ACC, { period: KY_1 });

    expect(await soDong(KY_1)).toBe(0); // không biết trả ai ⇒ không trả
    expect(kq.thucThuKhongCoLead).toBe(7_000_000); // nhưng không nuốt con số
  });

  test("[HH-TT-10] kỳ sai định dạng → ném sớm, không đụng bảng kê", async () => {
    await expect(chotKyHoaHong(ACC, { period: "2026-13" })).rejects.toThrow();
    await expect(chotKyHoaHong(ACC, { period: "thang-6" })).rejects.toThrow();
    expect(await db.commissionStatement.count()).toBe(0);
  });
});
