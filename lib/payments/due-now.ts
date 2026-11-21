// lib/payments/due-now.ts — "SỐ TIỀN CẦN THU NGAY" của một đơn.
//
// Luồng chốt 03/08: tạo đơn → chọn đóng 1 đợt hoặc 2 đợt → hiện QR → khách quét →
// SePay báo về → hệ thống TỰ xác nhận. Mắt xích gãy trước bản vá: cả QR lẫn ngưỡng
// đối khớp SePay đều lấy `order.totalAmount`, nên khách chọn 2 đợt và đóng đợt 1
// (nhỏ hơn tổng) thì QR in sai số tiền, còn webhook xếp giao dịch vào diện
// "trả thiếu → xử lý tay" ⇒ không bao giờ tự xác nhận.
//
// Định nghĩa dùng CHUNG cho 2 chỗ đó (phải cùng một con số, lệch là QR in một
// đằng còn máy đối khớp một nẻo):
//   • Có kế hoạch 2 đợt và đợt 1 CHƯA thu  → số tiền đợt 1.
//   • Không có kế hoạch / đợt 1 đã thu     → phần còn thiếu của cả đơn.
// THUẦN — không chạm DB, test được trực tiếp.
//
// ⚠️ 13/09/2026 — điều kiện "kế hoạch còn hiệu lực" đã DỜI sang
// `lib/payments/installment-plan.ts` (dùng chung với `markInstallmentPaid`) và đã ĐẢO:
// `PENDING_APPROVAL` nay CÓ hiệu lực. Lý do đầy đủ nằm trong file đó — đọc trước khi
// sửa lại, vì đây là chỗ quyết định số tiền in lên QR cho khách.

import { isInstallmentPlanActive } from "@/lib/payments/installment-plan";

export type InstallmentLike = {
  soDot: number;
  amount: number;
  status: string; // "PENDING" | "PAID" | ...
};

export type DueNowInput = {
  totalAmount: number;
  /** Tổng đã ghi nhận (Payment RECORDED còn hiệu lực) của đơn. */
  paidAmount: number;
  installments: InstallmentLike[];
  /**
   * Trạng thái duyệt kế hoạch trả góp. `null` = đơn không cần duyệt.
   * Chỉ `REJECTED` làm kế hoạch mất hiệu lực — xem `isInstallmentPlanActive`.
   */
  installmentApprovalStatus?: string | null;
};

export type DueNow = {
  /** Số tiền in lên QR + ngưỡng đối khớp SePay. */
  amount: number;
  /** Nhãn giải thích cho người dùng ("Đợt 1" / "Toàn bộ đơn" / "Còn thiếu"). */
  label: string;
  /** Đợt đang chờ thu (nếu đang theo kế hoạch 2 đợt) — webhook dùng để đánh dấu PAID. */
  soDot: number | null;
};

export function computeDueNow(input: DueNowInput): DueNow {
  const total = Math.max(0, Math.round(input.totalAmount));
  const paid = Math.max(0, Math.round(input.paidAmount));
  const remaining = Math.max(0, total - paid);

  const planActive = isInstallmentPlanActive(input.installmentApprovalStatus);
  const plan = planActive
    ? [...input.installments].sort((a, b) => a.soDot - b.soDot)
    : [];

  // Đợt chưa thu SỚM NHẤT — đó chính là khoản khách phải quét QR đóng bây giờ.
  const nextUnpaid = plan.find((i) => i.status !== "PAID" && i.amount > 0);
  if (nextUnpaid) {
    return {
      amount: nextUnpaid.amount,
      label: `Đợt ${nextUnpaid.soDot}`,
      soDot: nextUnpaid.soDot,
    };
  }

  return {
    amount: remaining,
    label: paid > 0 ? "Còn thiếu" : "Toàn bộ đơn",
    soDot: null,
  };
}
