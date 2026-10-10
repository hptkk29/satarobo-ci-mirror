import type { OrderStatus, OrderType } from "@prisma/client";

// State machine: allowed transitions per status
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ["PENDING_PAYMENT", "CANCELLED"],
  PENDING_PAYMENT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "CANCELLED"],
  COMPLETED: ["REFUNDED"],
  CANCELLED: [], // terminal
  REFUNDED: [], // terminal
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  DRAFT: "Nháp",
  PENDING_PAYMENT: "Chờ thanh toán",
  CONFIRMED: "Đã xác nhận đơn", // Q4: KHÔNG dùng "TT" — đây là trạng thái ĐƠN (sale chốt),
  // KHÔNG phải kế toán xác nhận tiền vào ngân hàng (Payment.accountantStatus). Tiến độ trả
  // góp hiển thị riêng qua deriveInstallmentBadge ("Đã đóng đợt 1"), thu tiền qua /payments.
  COMPLETED: "Hoàn tất",
  CANCELLED: "Đã huỷ",
  REFUNDED: "Đã hoàn tiền",
};

export const ORDER_STATUS_BADGE_COLOR: Record<OrderStatus, string> = {
  DRAFT: "gray",
  PENDING_PAYMENT: "yellow",
  CONFIRMED: "blue",
  COMPLETED: "green",
  CANCELLED: "red",
  REFUNDED: "purple",
};

// ─── Badge suy diễn: tiến độ trả góp 2 đợt ───────────────────────────────────
// KHÔNG thêm giá trị OrderStatus enum mới (tránh migration + sửa toàn state machine).
// Tính từ các dòng OrderInstallment có sẵn để hiển thị "Đã đóng đợt 1" ở cái nhìn nhanh.
export type InstallmentBadgeInput = { soDot: number; status: "PENDING" | "PAID" };

export type InstallmentBadge = {
  label: string;
  color: "emerald" | "amber";
};

/**
 * Suy ra badge tiến độ trả góp 2 đợt từ các dòng installment:
 *  - có đợt 2 & đợt 1 PAID & đợt 2 PENDING  → "Đã đóng đợt 1" (emerald)
 *  - có đợt 2 & đợt 1 chưa PAID             → "Trả góp 2 đợt" (amber)
 *  - còn lại (1 đợt / cả 2 đã đóng)         → null (trạng thái đơn đã đủ thông tin)
 */
export function deriveInstallmentBadge(
  installments: InstallmentBadgeInput[],
): InstallmentBadge | null {
  const dot1 = installments.find((i) => i.soDot === 1);
  const dot2 = installments.find((i) => i.soDot === 2);
  if (!dot2) return null; // không phải kế hoạch 2 đợt
  if (dot2.status === "PENDING") {
    return dot1?.status === "PAID"
      ? { label: "Đã đóng đợt 1", color: "emerald" }
      : { label: "Trả góp 2 đợt", color: "amber" };
  }
  return null; // cả 2 đợt PAID → đơn đã đủ, không cần badge
}

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  COURSE: "Khoá học",
  PACKAGE: "Gói combo",
  EXAM: "Kỳ thi",
  PRODUCT: "Sản phẩm",
  COMBO: "Combo",
};
