// lib/orders/ke-hoach-da-bo.ts — "KẾ HOẠCH THANH TOÁN CHIA ĐỢT ĐÃ BỊ BỎ" — câu từ chối và vị từ DUY NHẤT, THUẦN,
// cho CẢ máy chủ (tạo đơn · sửa kế hoạch trên đơn đã có) LẪN màn hình (ghi chú thay cho khối kế hoạch). Hai nơi hỏi
// một câu, không thể nói hai điều (luật 12: nút/ô nói thật).
//
// ── QUYẾT ĐỊNH [chủ dự án, 20/10/2026, trong chat] ───────────────────────────────────────────────────────────────
// *"bỏ phần kế hoạch thanh toán luôn đi, bây giờ mỗi lần đóng là 1 lần thanh toán độc lập, mức giảm theo chính sách
// khác nhau tuỳ thời điểm đó. nên bỏ phần kế hoạch này luôn đi"*.
//
// Hệ quả: MỌI đơn (cờ phạm vi học bật hay tắt) không còn lập kế hoạch nhiều đợt / thu cọc / nhắc công nợ theo đợt.
// Đơn thường có đúng MỘT phiếu thu toàn đơn (`ensureFullOrderRequest`); thu một phần vẫn ghi qua "Ghi nhận thanh toán".
//
// ── CÒN LẠI (đừng gỡ khi dọn) ────────────────────────────────────────────────────────────────────────────────────
//   · Đợt CŨ của đơn đã có: vẫn xem được, vẫn xuất QR, vẫn ghi nhận thanh toán, vẫn `markInstallmentPaid`.
//   · `recordInstallmentPlan` ở mức thư viện (`lib/orders/installments.ts`): `convert-lead-v2`, `backfill-order`,
//     `ghi-giao-dich-cu` và các bộ test tiền vẫn gọi lõi này — CỐ Ý không đụng; cổng nằm ở tầng ACTION.
//   · `taoDotChoCon*`: tạo phiếu thu cho MỘT em — không phải "kế hoạch" mức đơn; chưa có quyết định gỡ.

/** Câu từ chối (máy chủ) và ghi chú thay cho khối kế hoạch (màn hình) — MỘT chuỗi để hai nơi không thể nói lệch nhau. */
export const LY_DO_DA_BO_KE_HOACH_DOT =
  "Đã bỏ kế hoạch thanh toán chia đợt: mỗi lần đóng là một phiếu thu riêng, không lập kế hoạch nhiều đợt hay thu cọc theo kế hoạch.";

/**
 * Payload tạo đơn có khai kế hoạch đợt không? Có ⇒ trả câu từ chối; không (thiếu, `null`, `[]`) ⇒ `null`.
 *
 * Nhận `unknown[]` chứ không phải kiểu đợt: client CŨ vẫn gửi đúng hình dạng cũ, và schema cố ý giữ trường này để
 * lời gọi cũ đến được ĐÂY thay vì bị `z.object` lặng lẽ gỡ khoá (mất đợt mà không lỗi nào báo).
 */
export function lyDoTuChoiKeHoachDot(keHoachDot: readonly unknown[] | null | undefined): string | null {
  return keHoachDot != null && keHoachDot.length > 0 ? LY_DO_DA_BO_KE_HOACH_DOT : null;
}
