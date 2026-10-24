// lib/payments/summary.ts — FL-R2 (E2-LEAD / item 2)
// Tóm tắt thanh toán của 1 lead cho trang chi tiết lead + trang chốt đơn:
// đã nộp / tổng phải thu / còn thiếu + điều kiện chốt (khớp guard convertLeadV2).
import { scopedDb } from "@/lib/db-scope";
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { dotSapThu } from "@/lib/payments/trang-thai-dot";

export type LeadPaymentSummary = {
  /** Đã nộp = Σ Payment.amount (saleStatus=RECORDED) trên các đơn của lead. */
  paid: number;
  /** Tổng phải thu = Σ Order.totalAmount (chưa xoá) của lead. */
  total: number;
  /** Còn thiếu = max(0, total - paid). */
  remaining: number;
  /** Số khoản Sale đã ghi nhận. */
  recordedCount: number;
  /** Lead đã có ≥1 đơn hàng (để phân biệt "chưa có đơn" với "miễn phí"). */
  hasOrder: boolean;
  /** Học bổng toàn phần = có đơn nhưng tổng phải thu = 0. */
  scholarshipFull: boolean;
  /** Đủ điều kiện chốt ghi danh (guard: có khoản ghi nhận HOẶC miễn phí toàn phần). */
  eligible: boolean;
  /**
   * ĐƠN CỦA LEAD, để trang lead bấm SANG được (15/09/2026).
   *
   * Chủ dự án: *"khi khách hàng đến để đóng đợt 2 thì sale vào lead đó rồi bấm sang
   * hoá đơn để cung cấp mã QR đóng đợt 2 cho KH."* Trước bản này card thanh toán của
   * lead BIẾT là đã có đơn (`hasOrder`) nhưng không có đường nào tới đơn đó — sale
   * phải sang danh sách đơn rồi tự tìm theo tên.
   */
  donHang: Array<{
    id: string;
    code: string;
    totalAmount: number;
    /** Σ `Payment` (trục B) của ĐÚNG đơn này. */
    daThu: number;
    conThieu: number;
    /**
     * Đợt CHƯA thu xong gần nhất — để nút nói đúng việc sale sắp làm
     * ("Đóng đợt 2 · 3.000.000đ") thay vì một chữ "Xem đơn" vô nghĩa.
     *
     * ⚠️ Đọc `PaymentRequest.status` chứ KHÔNG tự cộng lại allocation:
     * `recomputeRequestStatuses` là nơi duy nhất quyết định PENDING/PARTIAL/PAID, và
     * dựng phép tính thứ hai ở đây là đẻ ra một con số thứ hai để lệch.
     */
    dotKeTiep: { soDot: number; conThieu: number } | null;
  }>;
};

/**
 * Đọc tóm tắt thanh toán qua scopedDb (cách ly cơ sở). KHÔNG coi "lead chưa có đơn"
 * là miễn phí — `scholarshipFull` chỉ true khi đã có đơn mà tổng = 0.
 *
 * S2 — cách ly đi qua quan hệ ĐƠN (Order là SCOPED_MODEL) thay vì scope thẳng trên
 * Payment.centerId. Lý do: Payment.centerId có thể null (đơn thủ công không gắn cơ sở)
 * → nếu scope thẳng trên Payment, non-SUPER_ADMIN sẽ MẤT khoản hợp lệ (card hiển thị 0
 * dù guard convert đếm được — lệch nhau, gốc rễ "bonus null-center"). Đếm Payment NESTED
 * dưới Order đã-trong-scope ⇒ bao gồm cả khoản centerId=null thuộc đơn của lead, và vẫn
 * cách ly cơ sở vì Order top-level đã bị inject `centerId IN visibleCenters`.
 */
export async function getLeadPaymentSummary(
  sdb: ReturnType<typeof scopedDb>,
  leadId: string,
): Promise<LeadPaymentSummary> {
  const orders = await sdb.order.findMany({
    where: { leadId, deletedAt: null },
    select: {
      id: true,
      code: true,
      // Cần cho luật "ẩn đơn đã huỷ" bên dưới — xem `boQua`.
      status: true,
      totalAmount: true,
      payments: {
        where: KHOAN_DA_GHI_NHAN,
        select: { amount: true },
      },
      // ⚠️ LẤY ĐỦ MỌI ĐỢT, không lọc PENDING và không `take: 1` [15/09/2026].
      //
      // Phép cũ (`PaymentRequest` PENDING/PARTIAL đầu tiên) MÙ VỚI TIỀN MẶT:
      // `PaymentRequest.status` chỉ suy từ `PaymentAllocation`, mà tiền mặt không bao giờ
      // sinh allocation (`bankTransactionId` bắt buộc). Sale thu đợt 1 bằng tiền mặt thì
      // phiếu đợt 1 vẫn PENDING, và thẻ này mời "Đóng đợt 1" cho một đợt đã thu xong — đo
      // được trên ORD-260915-000006 và …007.
      //
      // Nay đọc CẢ HAI SỔ rồi để `dotSapThu` quyết. Xem `lib/payments/trang-thai-dot.ts`.
      paymentRequests: {
        where: { installmentNo: { gt: 0 } },
        select: { installmentNo: true, amountDue: true, allocations: { select: { amount: true } } },
        orderBy: { installmentNo: "asc" },
      },
      installments: { select: { soDot: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // ── ĐƠN ĐÃ HUỶ: ẩn khỏi trang lead, NHƯNG CHỈ KHI NÓ KHÔNG CÒN GIỮ ĐỒNG NÀO ──────────
  //
  // Chủ dự án 02/10/2026: *"các đơn đã huỷ thì không hiển thị trong trang chi tiết lead
  // nữa"*. Ca thật: một lead bị tạo nhầm 3 đơn liền (ORD-260930-000001/2/3), huỷ cả ba,
  // và thẻ thanh toán của lead vẫn cộng chúng vào "tổng phải thu" — số trên màn thành vô
  // nghĩa, còn danh sách đơn thì toàn rác.
  //
  // ⚠️ VẾ THỨ HAI MỚI LÀ VẾ GIỮ CHO LUẬT NÀY KHÔNG GIẤU TIỀN. Đơn huỷ mà VẪN có khoản đã
  // ghi nhận là **bất thường phải thấy**, không phải thứ để dọn khỏi màn: tiền đã vào mà
  // đơn đã đóng ⇒ hoặc thiếu lượt hoàn tiền, hoặc ghi nhầm đơn. Chính `trangThaiDon` đã
  // gắn nhãn phụ *"Có khoản đã thu — kiểm tra hoàn tiền"* cho đúng ca này; ẩn nó đi là
  // xoá luôn tín hiệu duy nhất báo ra.
  //
  // `o.payments` đã được lọc bằng `KHOAN_DA_GHI_NHAN` ở câu tra, nên "rỗng" ở đây nghĩa
  // là **trục B không có đồng nào** — không phải "kế toán chưa xác nhận".
  //
  // REFUNDED **không** nằm trong luật này: đó là lịch sử hợp lệ (tiền đã về rồi đã trả
  // lại), và giấu nó là làm mất dấu một vòng tiền có thật.
  const boQua = (o: { status: string; payments: unknown[] }) =>
    o.status === "CANCELLED" && o.payments.length === 0;
  const donConHieuLuc = orders.filter((o) => !boQua(o));

  let total = 0;
  let paid = 0;
  let recordedCount = 0;
  for (const o of donConHieuLuc) {
    total += o.totalAmount;
    for (const p of o.payments) {
      paid += p.amount;
      recordedCount += 1;
    }
  }

  const hasOrder = donConHieuLuc.length > 0;
  const remaining = Math.max(0, total - paid);
  const scholarshipFull = hasOrder && total === 0;
  const eligible = recordedCount > 0 || scholarshipFull;

  const donHang = donConHieuLuc.map((o) => {
    const daThu = o.payments.reduce((s, x) => s + x.amount, 0);
    // Cột kế hoạch của từng đợt — sổ DUY NHẤT biết tiền mặt.
    const keHoachPaid = new Map(o.installments.map((i) => [i.soDot, i.status === "PAID"]));
    const sapThu = dotSapThu(
      o.paymentRequests.map((pr) => ({
        soDot: pr.installmentNo,
        amountDue: pr.amountDue,
        daRot: pr.allocations.reduce((t, a) => t + a.amount, 0),
        keHoachDaThu: keHoachPaid.get(pr.installmentNo) === true,
      })),
    );
    return {
      id: o.id,
      code: o.code,
      totalAmount: o.totalAmount,
      daThu,
      conThieu: Math.max(0, o.totalAmount - daThu),
      dotKeTiep: sapThu ? { soDot: sapThu.soDot, conThieu: sapThu.conThieu } : null,
    };
  });

  return {
    paid,
    total,
    remaining,
    recordedCount,
    hasOrder,
    scholarshipFull,
    eligible,
    donHang,
  };
}
