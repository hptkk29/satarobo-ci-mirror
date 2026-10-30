// ĐƠN PHÍ HỌC BÙ — chỉ đóng MỘT lần, xuất QR luôn, KHÔNG có kế hoạch thanh toán (chủ dự án
// 29/09/2026). Hàm THUẦN dùng chung cho cổng máy chủ (`recordInstallmentPlan`) và màn đơn hàng
// (ẩn khối kế hoạch) — hai nơi hỏi một câu, không thể nói hai điều.
export function laDonPhiHocBu(items: readonly { type: string }[]): boolean {
  return items.length > 0 && items.every((i) => i.type === "MAKEUP_FEE");
}

export const LY_DO_KHONG_TRA_GOP_PHI_BU = "Đơn phí học bù chỉ đóng một lần — không lập kế hoạch thanh toán.";
