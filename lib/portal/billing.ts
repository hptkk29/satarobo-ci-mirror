import "server-only";
import { db } from "@/lib/db";
import { KHOAN_DA_DONG, laKhoanDaDong, tongDaDong, computeEnrollmentDebt } from "@/lib/finance/debt";
import { xepPhieuThuVaDieuChinh } from "@/lib/portal/phieu-thu";

// =============================================================================
// PORTAL BILLING — Phase NHÓM 3
// Đơn hàng/học phí của các con (read-only). Lọc theo Student.parentUserId.
// =============================================================================

export type OrderRow = {
  id: string;
  code: string;
  type: string;
  status: string;
  totalAmount: number;
  paidAt: string | null;
  createdAt: string;
  studentName: string | null;
  items: string[];
};

export async function getParentOrders(parentUserId: string): Promise<OrderRow[]> {
  const children = await db.student.findMany({
    where: { parentUserId, deletedAt: null },
    select: { id: true },
  });
  const childIds = children.map((c) => c.id);
  if (childIds.length === 0) return [];

  const orders = await db.order.findMany({
    where: { studentId: { in: childIds }, deletedAt: null }, // FIX-C3
    select: {
      id: true,
      code: true,
      type: true,
      status: true,
      totalAmount: true,
      paidAt: true,
      createdAt: true,
      student: { select: { name: true } },
      items: { select: { itemName: true }, take: 10 },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return orders.map((o) => ({
    id: o.id,
    code: o.code,
    type: o.type,
    status: o.status,
    totalAmount: o.totalAmount,
    paidAt: o.paidAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    studentName: o.student?.name ?? null,
    items: o.items.map((i) => i.itemName),
  }));
}

// =============================================================================
// R7-04 — PH chỉ thấy khoản đã được KẾ TOÁN XÁC NHẬN (accountantStatus=CONFIRMED).
// Khoản Sale mới ghi nhận (PENDING) KHÔNG hiện cho phụ huynh (AC1).
// =============================================================================

/**
 * Nhãn DỰ PHÒNG cho `Payment.method` (DB lưu mã thô + "auto" từ lib/finance/payment.ts).
 *
 * ⚠️ Từ 30/08/2026 đây KHÔNG còn là danh sách đầy đủ. Danh mục phương thức nay nằm trong
 * DB và mỗi cơ sở có thể có phương thức riêng với mã riêng ("BANK_CS1"…), nên bảng cứng
 * này không thể biết hết. Dùng `getPaymentMethodLabels()` bên dưới để có bảng ĐẦY ĐỦ;
 * bảng cứng chỉ đỡ cho mã đã ngừng dùng và cho "auto".
 */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "Tiền mặt",
  BANK_TRANSFER: "Chuyển khoản",
  VNPAY: "VNPAY",
  TINGEE: "Tingee",
  COD: "COD",
  auto: "Tự động",
  // 06/09 — mã do HỆ THỐNG tự sinh, không có trong danh mục `PaymentMethod` nên trước
  // đây rơi thẳng ra giao diện dưới dạng mã trần. Phụ huynh đọc được chữ "backfill"
  // trong lịch sử đóng tiền của con mình.
  //
  // `backfill` = khoản đã thu TRƯỚC khi lên hệ thống, nhập bù lúc chuyển dữ liệu
  // (lib/crm/backfill-order.ts:112). Không phải một cách thanh toán, nên nhãn phải nói
  // đúng bản chất chứ đừng bịa ra "Chuyển khoản".
  backfill: "Đã thu trước khi lên hệ thống",
};

/**
 * Bảng mã → nhãn ĐẦY ĐỦ cho trang Học phí của phụ huynh: danh mục DB đè lên bảng cứng.
 *
 * VÌ SAO CẦN: phụ huynh của CS1 đóng tiền bằng phương thức "BANK_CS1"; không có bảng này
 * thì trang Học phí in ra đúng chữ "BANK_CS1" — một mã nội bộ, phụ huynh không hiểu.
 *
 * ⚠️ Cố ý đọc `db` TRẦN, không qua `scopedDb`: actor PARENT không đứng ở đâu trong cây
 * OrgUnit nên không có `visibleCenterIds` (xem RELATIONSHIP_ROLE_CODES trong
 * lib/auth/actor.ts) — scope ở đây sẽ trả rỗng và mọi nhãn rơi về mã trần. An toàn vì
 * thứ lấy ra chỉ là (mã, tên) của danh mục, KHÔNG có số tài khoản nào: tài khoản ngân
 * hàng nằm ở IntegrationConfig, không ở bảng này. Và mỗi phụ huynh chỉ nhìn thấy nhãn
 * của những khoản thu CỦA CHÍNH HỌ — đường lọc khoản thu không đổi.
 */
export async function getPaymentMethodLabels(): Promise<Record<string, string>> {
  const rows = await db.paymentMethod.findMany({
    select: { code: true, name: true },
  });
  return {
    ...PAYMENT_METHOD_LABEL,
    ...Object.fromEntries(rows.map((r) => [r.code, r.name])),
  };
}

export type ConfirmedPaymentRow = {
  id: string;
  orderId: string;
  orderCode: string | null;
  enrollmentId: string | null;
  studentName: string | null;
  amount: number;
  method: string;
  paidDate: string;
  confirmedAt: string | null;
  receiptCode: string | null;
  /** `PAYMENT` = phiếu thu · `ADJUSTMENT` = bút toán điều chỉnh (mang DELTA, có thể âm). */
  paymentType: string;
  /** Với dòng ADJUSTMENT: id phiếu thu gốc mà nó đang sửa. */
  adjustmentOfId: string | null;
  /**
   * Lý do điều chỉnh — CHỈ có ở dòng ADJUSTMENT.
   *
   * ⚠️ `Payment.note` của phiếu thu THƯỜNG chứa ghi chú nội bộ và marker máy sinh
   * (`[auto:order-confirm]`, `[auto:order-installment:dot2]`…). Không bao giờ đổ nguyên
   * `note` ra cổng phụ huynh; chỉ dòng điều chỉnh mới có `note` do người nhập, và nội
   * dung của nó chính là lý do phải in cho phụ huynh đọc.
   */
  lyDoDieuChinh: string | null;
  /** Phiếu gốc đã bị điều chỉnh ≥1 lần → gắn nhãn; số tiền GIỮ NGUYÊN. */
  daBiDieuChinh: boolean;
};

/** Resolve childIds: nhận sẵn mảng studentIds, hoặc tra theo parentUserId. */
async function resolveChildIds(
  client: typeof db,
  parentUserIdOrStudentIds: string | string[],
): Promise<string[]> {
  if (Array.isArray(parentUserIdOrStudentIds)) return parentUserIdOrStudentIds;
  const children = await client.student.findMany({
    where: { parentUserId: parentUserIdOrStudentIds, deletedAt: null },
    select: { id: true },
  });
  return children.map((c) => c.id);
}

/**
 * Khoản thanh toán ĐÃ XÁC NHẬN của các con (read-only, cho portal — AC1: chỉ CONFIRMED).
 * Dùng db trần: ràng buộc theo childIds là cổng sở hữu; PARENT actor không có center-role
 * nên KHÔNG center-scope (scopedDb sẽ lọc rỗng). `client` mặc định db.
 */
export async function getParentConfirmedPayments(
  client: typeof db,
  parentUserIdOrStudentIds: string | string[],
): Promise<ConfirmedPaymentRow[]> {
  const childIds = await resolveChildIds(client, parentUserIdOrStudentIds);
  if (childIds.length === 0) return [];

  const payments = await client.payment.findMany({
    where: {
      ...KHOAN_DA_DONG,
      enrollment: { studentId: { in: childIds }, deletedAt: null },
    },
    select: {
      id: true,
      orderId: true,
      amount: true,
      method: true,
      paidDate: true,
      confirmedAt: true,
      enrollmentId: true,
      paymentType: true,
      adjustmentOfId: true,
      note: true,
      order: { select: { code: true } },
      enrollment: { select: { student: { select: { name: true } } } },
      receipts: {
        where: { status: "ACTIVE", deletedAt: null }, // FIX-C3

        select: { code: true },
        orderBy: { issuedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { paidDate: "desc" },
    take: 200,
  });

  // Xếp bút toán điều chỉnh ngay dưới phiếu thu gốc + gắn nhãn cho phiếu gốc.
  // KHÔNG đụng `amount` của bất kỳ dòng nào — xem lib/portal/phieu-thu.ts.
  return xepPhieuThuVaDieuChinh(
    payments.map((p) => ({
      id: p.id,
      orderId: p.orderId,
      orderCode: p.order?.code ?? null,
      enrollmentId: p.enrollmentId,
      studentName: p.enrollment?.student?.name ?? null,
      amount: p.amount,
      method: p.method,
      paidDate: p.paidDate.toISOString(),
      confirmedAt: p.confirmedAt?.toISOString() ?? null,
      receiptCode: p.receipts[0]?.code ?? null,
      paymentType: p.paymentType,
      adjustmentOfId: p.adjustmentOfId,
      lyDoDieuChinh: p.paymentType === "ADJUSTMENT" ? (p.note?.trim() || null) : null,
      daBiDieuChinh: false, // hàm xếp sẽ đặt lại
    })),
  );
}

// =============================================================================
// R7-04 — TRANG HỌC PHÍ PORTAL (P0): nguồn sự thật = Payment 2 tầng, KHÔNG đọc Order cũ.
// Học phí mỗi ghi danh = finalPrice (snapshot tại convert) − Σ Payment(CONFIRMED).
// PARENT không có center-role → cổng sở hữu là studentId thuộc parentUserId (db trần).
// =============================================================================

export type EnrollmentBillingRow = {
  enrollmentId: string;
  status: string;
  studentName: string | null;
  className: string | null;
  finalPrice: number;
  confirmedPaid: number;
  /** finalPrice − confirmedPaid; có thể âm (đóng thừa). */
  outstanding: number;
  /**
   * D5/G.6 — chỉ dấu TRẠNG THÁI (KHÔNG lộ số tiền, giữ AC1): số khoản đang chờ kế
   * toán xác nhận / số khoản bị từ chối, để PH biết có hoạt động đang xử lý.
   */
  pendingCount: number;
  rejectedCount: number;
};

export type ParentBilling = {
  enrollments: EnrollmentBillingRow[];
  /** Lịch sử biên lai đã được kế toán xác nhận. */
  receipts: ConfirmedPaymentRow[];
  totals: { tuition: number; paid: number; outstanding: number };
  /** D5/G.6 — tổng chỉ dấu trạng thái (không kèm số tiền). */
  flags: { pendingCount: number; rejectedCount: number };
};

/**
 * Tổng hợp học phí + công nợ + biên lai cho phụ huynh, từ Payment 2 tầng (R7-04).
 * Chỉ tính ghi danh đã chốt giá (finalPrice != null tại convert R7-05). Chỉ tính
 * Payment accountantStatus=CONFIRMED (AC1: khoản Sale mới ghi nhận chưa hiện).
 */
export async function getParentBilling(parentUserId: string): Promise<ParentBilling> {
  const empty: ParentBilling = {
    enrollments: [],
    receipts: [],
    totals: { tuition: 0, paid: 0, outstanding: 0 },
    flags: { pendingCount: 0, rejectedCount: 0 },
  };
  const childIds = await resolveChildIds(db, parentUserId);
  if (childIds.length === 0) return empty;

  const enrollments = await db.enrollment.findMany({
    where: { studentId: { in: childIds }, finalPrice: { not: null }, deletedAt: null }, // FIX-C3
    select: {
      id: true,
      status: true,
      finalPrice: true,
      tuition: true,
      student: { select: { name: true } },
      class: { select: { name: true } },
      // CHỈ lấy số tiền của khoản CONFIRMED; PENDING/REJECTED chỉ lấy trạng thái để
      // ĐẾM (không kèm amount) — giữ AC1: không lộ số tiền khoản chưa xác nhận cho PH.
      // FIX-C3: nested include không auto-scope → tự lọc payment đã xóa mềm.
      payments: { where: { deletedAt: null }, select: { accountantStatus: true, amount: true } },
    },
    orderBy: { enrolledAt: "desc" },
    take: 100,
  });

  const rows: EnrollmentBillingRow[] = enrollments.map((e) => {
    const finalPrice = e.finalPrice ?? e.tuition ?? 0;
    const daDong = e.payments.filter(laKhoanDaDong);
    const confirmedPaid = tongDaDong(daDong);
    const pendingCount = e.payments.filter((p) => p.accountantStatus === "PENDING").length;
    const rejectedCount = e.payments.filter((p) => p.accountantStatus === "REJECTED").length;
    return {
      enrollmentId: e.id,
      status: e.status,
      studentName: e.student?.name ?? null,
      className: e.class?.name ?? null,
      finalPrice,
      confirmedPaid,
      outstanding: computeEnrollmentDebt(finalPrice, daDong, e.status),
      pendingCount,
      rejectedCount,
    };
  });

  const receipts = await getParentConfirmedPayments(db, childIds);

  const totals = rows.reduce(
    (acc, r) => {
      acc.tuition += r.finalPrice;
      acc.paid += r.confirmedPaid;
      acc.outstanding += Math.max(0, r.outstanding);
      return acc;
    },
    { tuition: 0, paid: 0, outstanding: 0 },
  );

  const flags = rows.reduce(
    (acc, r) => {
      acc.pendingCount += r.pendingCount;
      acc.rejectedCount += r.rejectedCount;
      return acc;
    },
    { pendingCount: 0, rejectedCount: 0 },
  );

  return { enrollments: rows, receipts, totals, flags };
}
