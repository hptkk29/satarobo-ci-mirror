// lib/payments/summary.test.ts — K3 (PAY-DEDUP): tổng "đã nộp" đọc từ 1 nguồn,
// không cộng đôi khi có bút toán điều chỉnh (Payment auto cũ đã soft-delete).
import { describe, it, expect } from "vitest";
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { getLeadPaymentSummary } from "./summary";
import type { scopedDb } from "@/lib/db-scope";

/**
 * Hình dạng ĐÚNG NHƯ Prisma trả về cho câu `select` trong `getLeadPaymentSummary`.
 *
 * ⚠️ Trước 15/09/2026 type này thiếu `id`/`code`/`paymentRequests`, và fixture thiếu
 * theo. Khi `donHang[]` được thêm vào summary thì 4 ca ĐỎ với
 * `TypeError: Cannot read properties of undefined (reading '0')` — không phải vì mã
 * sai mà vì FIXTURE KHÔNG MANG HÌNH DẠNG DỮ LIỆU THẬT (luật fixture, CLAUDE.md).
 *
 * ⚠️ ĐÃ CÂN NHẮC rồi bỏ cách vá `o.paymentRequests ?? []` trong mã sản phẩm: Prisma
 * LUÔN trả quan hệ đã `select`, nên `?? []` chỉ che được đúng một ca — ai đó gỡ mất
 * `select` — mà đó lại chính là ca `tsc` đang bắt giúp. Thêm phòng thủ ở đó là tự bịt
 * mắt mình.
 */
type OrderRow = {
  id: string;
  code: string;
  totalAmount: number;
  payments: { amount: number }[];
  paymentRequests: {
    installmentNo: number;
    amountDue: number;
    allocations: { amount: number }[];
  }[];
  /**
   * 15/09/2026 — THÊM. Cột kế hoạch của từng đợt là sổ DUY NHẤT biết tới tiền mặt:
   * `PaymentRequest.status` suy từ `PaymentAllocation`, mà tiền mặt không sinh
   * allocation (`bankTransactionId` bắt buộc). Fixture thiếu cột này thì không kiểm
   * được đúng ca đã làm thẻ lead mời "Đóng đợt 1" cho đợt đã thu xong.
   */
  installments: { soDot: number; status: string }[];
  /**
   * 02/10/2026 — THÊM. Trang lead nay ẨN đơn đã huỷ không còn giữ đồng nào (`boQua`
   * trong `summary.ts`). Fixture thiếu cột này thì luật đó không kiểm được, và
   * `status` undefined sẽ lặng lẽ KHÔNG khớp "CANCELLED" ⇒ ca xanh vì lý do sai.
   * Cùng bài học với `installments` ở trên.
   */
  status: string;
};
type Captured = { where?: Record<string, unknown>; select?: Record<string, unknown> };

/** Dựng một dòng đơn với mặc định tối thiểu — ca nào cần đợt thì tự truyền vào. */
function don(o: Partial<OrderRow> & { totalAmount: number }): OrderRow {
  return {
    id: o.id ?? "don1",
    code: o.code ?? "ORD-260915-000001",
    totalAmount: o.totalAmount,
    payments: o.payments ?? [],
    paymentRequests: o.paymentRequests ?? [],
    installments: o.installments ?? [],
    // Mặc định CONFIRMED: phần lớn ca cũ không quan tâm trạng thái, và một mặc định
    // "đang sống" giữ cho chúng đo đúng thứ chúng vốn đo.
    status: o.status ?? "CONFIRMED",
  };
}

/** sdb giả: trả fixture như DB sau khi filter — đồng thời bắt args để assert bộ lọc. */
function fakeSdb(orders: OrderRow[], captured: Captured = {}) {
  return {
    order: {
      findMany: async (args: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
        captured.where = args.where;
        captured.select = args.select;
        return orders;
      },
    },
  } as unknown as ReturnType<typeof scopedDb>;
}

describe("getLeadPaymentSummary (K3 PAY-DEDUP)", () => {
  it("[K3-DoD] 1 đơn 10tr trả 2 đợt (6tr + 4tr RECORDED) → đã nộp 10tr, còn thiếu 0, đủ điều kiện chốt", async () => {
    const s = await getLeadPaymentSummary(
      fakeSdb([don({ totalAmount: 10_000_000, payments: [{ amount: 6_000_000 }, { amount: 4_000_000 }] })]),
      "lead1",
    );
    expect(s).toEqual({
      paid: 10_000_000,
      total: 10_000_000,
      remaining: 0,
      recordedCount: 2,
      hasOrder: true,
      scholarshipFull: false,
      eligible: true,
      // `donHang[]` thêm 15/09/2026 — card lead cần đường sang đơn. Giữ `toEqual`
      // (không đổi sang `toMatchObject`): ca này là hợp đồng ĐẦY ĐỦ của hàm, và nới
      // nó thành khớp-một-phần là mất khả năng phát hiện một trường mọc thêm im lặng.
      donHang: [
        {
          id: "don1",
          code: "ORD-260915-000001",
          totalAmount: 10_000_000,
          daThu: 10_000_000,
          conThieu: 0,
          dotKeTiep: null,
        },
      ],
    });
  });

  it("[LEAD-LINK] đợt kế tiếp = đợt CÒN NỢ nhỏ nhất, trừ đúng phần đã rót", async () => {
    // Đây là con số in lên NÚT ở card lead ("Đóng đợt 2 · 3.000.000đ"), nên nó phải
    // đúng: sale đọc nó rồi nói số đó cho khách đang đứng trước mặt.
    //
    // Đợt 2 có `amountDue` 4tr và đã rót 1tr ⇒ còn thiếu 3tr. Lấy `amountDue` trần là
    // đòi khách 4tr lần nữa; quên `installmentNo > 0` là in ra "đợt 0".
    const s = await getLeadPaymentSummary(
      fakeSdb([
        don({
          totalAmount: 10_000_000,
          payments: [{ amount: 6_000_000 }],
          paymentRequests: [
            { installmentNo: 2, amountDue: 4_000_000, allocations: [{ amount: 1_000_000 }] },
          ],
        }),
      ]),
      "lead1",
    );
    expect(s.donHang).toHaveLength(1);
    expect(s.donHang[0]!.dotKeTiep).toEqual({ soDot: 2, conThieu: 3_000_000 });
    expect(s.donHang[0]!.conThieu).toBe(4_000_000);
  });

  it("[LEAD-LINK] câu tra lấy ĐỦ MỌI ĐỢT + cột kế hoạch, KHÔNG lọc PENDING", async () => {
    // ⚠️ CA NÀY ĐẢO CHIỀU SO VỚI BẢN CŨ [15/09/2026].
    //
    // Bản cũ ghim đúng `status: { in: ["PENDING","PARTIAL"] }` + `take: 1`, với lý lẽ "chỉ
    // PENDING/PARTIAL là còn nợ". Lý lẽ đó SAI với tiền mặt: `PaymentRequest.status` chỉ
    // suy từ `PaymentAllocation`, mà tiền mặt không bao giờ sinh allocation
    // (`bankTransactionId` là cột bắt buộc). Sale thu đợt 1 bằng tiền mặt ⇒ phiếu đợt 1
    // vẫn PENDING ⇒ nút ở thẻ lead mời "Đóng đợt 1" cho đợt đã thu xong. Đo được trên
    // ORD-260915-000006 và …007.
    //
    // Nay câu tra phải mang về ĐỦ dữ kiện của cả hai sổ; việc chọn đợt nào là của
    // `dotSapThu` (`lib/payments/trang-thai-dot.ts`, thuần + đã cấy lỗi).
    //
    // `installmentNo > 0` thì GIỮ: phiếu số 0 là "thu toàn đơn", không phải một đợt — bỏ
    // nó là in ra "đợt 0" trên nút.
    const captured: Captured = {};
    await getLeadPaymentSummary(fakeSdb([], captured), "lead1");
    const pr = (captured.select?.paymentRequests ?? {}) as {
      where?: Record<string, unknown>;
      take?: number;
      orderBy?: unknown;
    };
    expect(pr.where).toEqual({ installmentNo: { gt: 0 } });
    expect(pr.take).toBeUndefined();
    expect(pr.orderBy).toEqual({ installmentNo: "asc" });
    // Không có cột kế hoạch thì không có cách nào biết tới tiền mặt.
    expect(captured.select?.installments).toEqual({ select: { soDot: true, status: true } });
  });

  it("[LEAD-LINK] đợt sale THU TIỀN MẶT không còn bị mời đóng lại", async () => {
    // Đúng hiện trạng ORD-260915-000007: đợt 1 sale đánh dấu tay (phiếu vẫn PENDING vì
    // không có allocation), đợt 2 tiền về qua QR. Đợt sắp thu phải là ĐỢT 3.
    const s = await getLeadPaymentSummary(
      fakeSdb([
        don({
          totalAmount: 18_468_000,
          payments: [{ amount: 2_000_000 }, { amount: 2_617_000 }],
          paymentRequests: [
            { installmentNo: 1, amountDue: 2_000_000, allocations: [] },
            { installmentNo: 2, amountDue: 2_617_000, allocations: [{ amount: 2_617_000 }] },
            { installmentNo: 3, amountDue: 4_617_000, allocations: [] },
          ],
          installments: [
            { soDot: 1, status: "PAID" },
            { soDot: 2, status: "PENDING" },
            { soDot: 3, status: "PENDING" },
          ],
        }),
      ]),
      "lead1",
    );
    // Phép cũ trả đợt 1 · 2.000.000đ — một đợt đã thu xong.
    expect(s.donHang[0]!.dotKeTiep).toEqual({ soDot: 3, conThieu: 4_617_000 });
  });

  it("[K3-DoD] điều chỉnh đợt 1 (6tr→5tr): Payment auto cũ đã soft-delete, chỉ còn khoản mới → tổng 9tr, KHÔNG cộng đôi", async () => {
    // Sau recordInstallmentPlan lần 2, DB chỉ trả về khoản active: đợt1 mới 5tr + đợt2 4tr.
    const s = await getLeadPaymentSummary(
      fakeSdb([don({ totalAmount: 10_000_000, payments: [{ amount: 5_000_000 }, { amount: 4_000_000 }] })]),
      "lead1",
    );
    expect(s.paid).toBe(9_000_000); // KHÔNG phải 15tr (6+5+4) — khoản cũ không được đếm
    expect(s.remaining).toBe(1_000_000);
    expect(s.recordedCount).toBe(2);
  });

  it("[K3-guard] query nested Payment PHẢI lọc đúng điều kiện TRỤC B (chặn đếm khoản soft-deleted/chưa ghi nhận)", async () => {
    const captured: Captured = {};
    await getLeadPaymentSummary(fakeSdb([], captured), "lead1");
    expect(captured.where).toEqual({ leadId: "lead1", deletedAt: null });
    const paymentsSelect = (captured.select as { payments: { where: unknown } }).payments;
    // So với CHÍNH hằng dùng chung, không chép lại hình dạng bằng tay: 14/09 trục B đổi
    // từ `saleStatus: "RECORDED"` sang `{ in: ["RECORDED", "COLLECT_CONFIRMED"] }` (xem
    // lib/finance/ghi-nhan.ts — `COLLECT_CONFIRMED` là bước ĐI SAU nên lọc bằng dấu `=`
    // làm tiền rụng khỏi sổ). Ca này chép tay nên nó đỏ theo, và mọi lần đổi sau cũng
    // sẽ bắt sửa lại ở đây mà chẳng thêm bảo đảm gì. Chốt của ca vẫn nguyên: truy vấn
    // KHÔNG được bỏ điều kiện lọc.
    expect(paymentsSelect.where).toEqual(KHOAN_DA_GHI_NHAN);
    expect(paymentsSelect.where).toMatchObject({ deletedAt: null });
  });

  it("học bổng toàn phần: có đơn, tổng 0đ, chưa có khoản → vẫn eligible", async () => {
    const s = await getLeadPaymentSummary(fakeSdb([don({ totalAmount: 0, payments: [] })]), "lead1");
    expect(s.scholarshipFull).toBe(true);
    expect(s.eligible).toBe(true);
    expect(s.paid).toBe(0);
  });

  it("chưa có đơn → KHÔNG coi là miễn phí, không eligible", async () => {
    const s = await getLeadPaymentSummary(fakeSdb([]), "lead1");
    expect(s.hasOrder).toBe(false);
    expect(s.scholarshipFull).toBe(false);
    expect(s.eligible).toBe(false);
  });

  it("nộp thừa (paid > total) → remaining kẹp 0, không âm", async () => {
    const s = await getLeadPaymentSummary(
      fakeSdb([don({ totalAmount: 5_000_000, payments: [{ amount: 6_000_000 }] })]),
      "lead1",
    );
    expect(s.remaining).toBe(0);
  });
});

// ── [LEAD-HUY] Đơn ĐÃ HUỶ trên trang lead ────────────────────────────────────────────
//
// Chủ dự án 02/10/2026: *"các đơn đã huỷ thì không hiển thị trong trang chi tiết lead
// nữa"*. Ca thật: một lead bị tạo nhầm 3 đơn liền rồi huỷ cả ba, mà thẻ thanh toán của
// lead vẫn cộng chúng vào "tổng phải thu".
//
// ⚠️ Luật có HAI vế, và mấy ca dưới đây tồn tại để vế thứ hai không bị gỡ: đơn huỷ mà
// VẪN giữ khoản đã ghi nhận thì PHẢI hiện — đó là bất thường (thiếu lượt hoàn tiền, hoặc
// ghi nhầm đơn), và ẩn nó đi là xoá tín hiệu duy nhất báo ra.
describe("[LEAD-HUY] đơn đã huỷ trên trang lead", () => {
  it("[LEAD-HUY-01] đơn huỷ KHÔNG có khoản nào → biến mất khỏi mọi con số", async () => {
    const s = await getLeadPaymentSummary(
      fakeSdb([don({ id: "huy", totalAmount: 12_768_000, status: "CANCELLED" })]),
      "lead1",
    );
    expect(s.total).toBe(0);
    expect(s.hasOrder).toBe(false);
    expect(s.donHang).toEqual([]);
  });

  it("[LEAD-HUY-02] ĐỐI CHỨNG DƯƠNG — đơn huỷ CÓ khoản đã ghi nhận thì VẪN hiện", async () => {
    // Không có ca này thì [LEAD-HUY-01] vẫn ĐẠT khi ai đó siết thành "ẩn MỌI đơn huỷ",
    // và 8.976.000đ tiền thật biến mất khỏi màn mà không ca nào đỏ.
    const s = await getLeadPaymentSummary(
      fakeSdb([
        don({
          id: "huy-co-tien",
          totalAmount: 8_976_000,
          status: "CANCELLED",
          payments: [{ amount: 8_976_000 }],
        }),
      ]),
      "lead1",
    );
    expect(s.hasOrder).toBe(true);
    expect(s.paid).toBe(8_976_000);
    expect(s.donHang.map((d) => d.id)).toEqual(["huy-co-tien"]);
  });

  it("[LEAD-HUY-03] đơn huỷ rỗng nằm CẠNH đơn sống → chỉ đơn sống còn lại", async () => {
    const s = await getLeadPaymentSummary(
      fakeSdb([
        don({ id: "huy", code: "ORD-260930-000001", totalAmount: 12_768_000, status: "CANCELLED" }),
        don({ id: "song", code: "ORD-260930-000004", totalAmount: 12_768_000, payments: [{ amount: 1_000_000 }] }),
      ]),
      "lead1",
    );
    expect(s.total).toBe(12_768_000);
    expect(s.paid).toBe(1_000_000);
    expect(s.donHang.map((d) => d.id)).toEqual(["song"]);
  });

  it("[LEAD-HUY-04] REFUNDED KHÔNG bị ẩn — đó là vòng tiền có thật", async () => {
    const s = await getLeadPaymentSummary(
      fakeSdb([don({ id: "hoan", totalAmount: 5_000_000, status: "REFUNDED" })]),
      "lead1",
    );
    expect(s.hasOrder).toBe(true);
    expect(s.donHang.map((d) => d.id)).toEqual(["hoan"]);
  });

  it("[LEAD-HUY-05] câu tra PHẢI select `status` — thiếu là luật thành no-op im lặng", async () => {
    // `status` undefined không bao giờ bằng "CANCELLED" ⇒ `boQua` luôn false ⇒ không ẩn
    // gì cả, mà mọi ca trên VẪN xanh vì fixture tự khai `status`. Ghim ở tầng câu tra.
    const captured: Captured = {};
    await getLeadPaymentSummary(fakeSdb([], captured), "lead1");
    expect(captured.select?.status).toBe(true);
  });
});
