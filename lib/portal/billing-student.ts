import "server-only";
import { db } from "@/lib/db";
import { laKhoanDaDong, tongDaDong, computeEnrollmentDebt } from "@/lib/finance/debt";
import { getParentConfirmedPayments, type ConfirmedPaymentRow } from "@/lib/portal/billing";

// Portal v2 — học phí & công nợ của 1 con đang chọn (per-child).
// Quy ước AC1: chỉ tính Payment accountantStatus=CONFIRMED (giống getParentBilling).
// PENDING/REJECTED chỉ ĐẾM làm chỉ dấu trạng thái (D5/G.6) — KHÔNG lộ số tiền.

/** Công nợ theo TỪNG ghi danh (con học nhiều khóa → mỗi khóa một dòng, không gộp nhãn). */
export type StudentBillingRow = {
  enrollmentId: string;
  courseName: string | null;
  className: string | null;
  finalPrice: number;
  paid: number;
  outstanding: number;
  /**
   * Ghi danh CHƯA CHỐT HỌC PHÍ (`finalPrice` và `tuition` đều rỗng) — thường là ghi danh
   * tạo thẳng ở /admin/enrollments, không đi qua luồng convert.
   *
   * Phải nói ra thay vì in "0 đ": số 0 đọc như "khoá này miễn phí" hoặc "đã đóng đủ",
   * cả hai đều sai. Trước 06/09 những dòng này bị lọc mất hẳn nên trang báo "Đã thanh
   * toán đủ" ngay bên trên danh sách phiếu thu thật của chính ghi danh đó.
   */
  chuaChotGia: boolean;
};

export type StudentBilling = {
  courseName: string | null;
  className: string | null;
  tuition: number;
  paid: number;
  outstanding: number;
  nextDueDate: string | null;
  rows: StudentBillingRow[];
  receipts: ConfirmedPaymentRow[];
  /**
   * D5/G.6 — chỉ dấu TRẠNG THÁI (KHÔNG lộ số tiền, giữ AC1): số khoản đang chờ kế
   * toán xác nhận / số khoản bị từ chối, để PH biết có hoạt động đang xử lý.
   */
  pendingCount: number;
  rejectedCount: number;
};

export async function getStudentBilling(studentId: string): Promise<StudentBilling> {
  const enrollments = await db.enrollment.findMany({
    // 06/09 — BỎ `finalPrice: { not: null }`. Ghi danh tạo thẳng ở /admin/enrollments
    // không đi qua luồng convert nên không bao giờ có `finalPrice`; lọc như cũ là cả
    // dòng học phí biến mất, và trang báo "Đã thanh toán 0 đ · Công nợ 0 đ · Đã thanh
    // toán đủ" ngay bên trên danh sách phiếu thu THẬT của chính ghi danh đó.
    // Dòng dưới đã có sẵn `finalPrice ?? tuition ?? 0` nên không cần bộ lọc này.
    where: { studentId, deletedAt: null }, // FIX-C3
    orderBy: { enrolledAt: "desc" },
    select: {
      id: true,
      status: true,
      finalPrice: true,
      tuition: true,
      class: { select: { classCode: true } },
      course: { select: { name: true } },
      // FIX-C3: nested include không auto-scope → tự lọc payment đã xóa mềm.
      payments: { where: { deletedAt: null }, select: { accountantStatus: true, amount: true } },
    },
  });

  let tuition = 0;
  let paid = 0;
  let pendingCount = 0;
  let rejectedCount = 0;
  const rows: StudentBillingRow[] = enrollments.map((e) => {
    const chuaChotGia = e.finalPrice == null && e.tuition == null;
    const finalPrice = e.finalPrice ?? e.tuition ?? 0;
    const daDong = e.payments.filter(laKhoanDaDong);
    const rowPaid = tongDaDong(daDong);
    tuition += finalPrice;
    paid += rowPaid;
    pendingCount += e.payments.filter((p) => p.accountantStatus === "PENDING").length;
    rejectedCount += e.payments.filter((p) => p.accountantStatus === "REJECTED").length;
    return {
      enrollmentId: e.id,
      courseName: e.course?.name ?? null,
      className: e.class?.classCode ?? null,
      finalPrice,
      paid: rowPaid,
      outstanding: chuaChotGia ? 0 : Math.max(0, computeEnrollmentDebt(finalPrice, daDong, e.status)),
      chuaChotGia,
    };
  });
  // Tổng công nợ = Σ clamp TỪNG DÒNG (khớp getParentBilling lib/portal/billing.ts):
  // khoản đóng THỪA của ghi danh này KHÔNG được bù trừ công nợ ghi danh khác —
  // clamp ở mức tổng làm HeroMetric lệch với chính danh sách "Khoản cần thanh toán".
  const outstanding = rows.reduce((s, r) => s + r.outstanding, 0);

  const [receipts, due] = await Promise.all([
    getParentConfirmedPayments(db, [studentId]),
    // Chỉ tìm "kỳ đến hạn" khi CÒN công nợ: OrderInstallment chỉ flip PAID qua
    // markInstallmentPaid — kế toán confirm Payment 2 tầng KHÔNG flip installment,
    // nên hết nợ mà vẫn hiện ô đỏ "Kỳ đến hạn" là mâu thuẫn trên cùng trang.
    outstanding > 0
      ? db.orderInstallment.findFirst({
          // FIX-C3 + đơn huỷ/hoàn: installment của order đã xoá mềm / CANCELLED / REFUNDED
          // vẫn PENDING trong DB → phải loại, tránh hiện "hạn đóng" ma (khớp lib/finance/debt.ts).
          where: {
            status: "PENDING",
            dueDate: { not: null },
            order: { studentId, deletedAt: null, status: { notIn: ["CANCELLED", "REFUNDED"] } },
          },
          orderBy: { dueDate: "asc" },
          select: { dueDate: true },
        })
      : Promise.resolve(null),
  ]);

  const first = enrollments[0];
  return {
    courseName: first?.course?.name ?? null,
    className: first?.class?.classCode ?? null,
    tuition,
    paid,
    outstanding,
    nextDueDate: due?.dueDate?.toISOString() ?? null,
    rows,
    receipts,
    pendingCount,
    rejectedCount,
  };
}
