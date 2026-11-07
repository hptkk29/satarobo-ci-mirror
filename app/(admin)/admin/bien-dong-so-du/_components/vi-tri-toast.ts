// app/(admin)/admin/bien-dong-so-du/_components/vi-tri-toast.ts — bong bóng kết quả của panel Import POS
// đặt ở đâu để KHÔNG đè lên panel. THUẦN (không DOM — component truyền `window.innerWidth`).
//
// Rà đối kháng 06/10/2026 (`[POS1-VA-UI-04]`): bản vá đầu chọn theo một mốc 640px và bỏ qua hình học
// của sonner 2.0.7 — ở ≤ 600px sonner ép toast RỘNG HẾT màn (`@media (max-width:600px)` trong
// `dist/styles.css`), nên `top-center` y hệt `top-right` cũ và đè tiêu đề + chữ hướng dẫn; ở
// 640–907px toast góc trái dưới (x∈[24, 380]) chồng lên panel `sm:max-w-lg` (x∈[W−512, W]).
// Luật nay: chỉ bắn toast khi có chỗ trống THẬT bên trái panel; không có ⇒ không toast — khối
// "Kết quả import" trong panel đã nói kết quả.

/** `TOAST_WIDTH` của sonner 2.0.7 (`dist/index.mjs`). */
export const RONG_TOAST = 356;
/** `VIEWPORT_OFFSET` của sonner 2.0.7 cho màn > 600px. */
export const LE_TOAST = 24;
/** Panel `sm:max-w-lg` (32rem). */
export const RONG_PANEL = 512;
/** Khoảng hở tối thiểu giữa mép phải toast và mép trái panel. */
export const KHOANG_HO = 16;

export function viTriToastPanel(rongManHinh: number): "bottom-left" | null {
  // ≤ 600px: sonner bỏ vị trí ngang, toast rộng hết màn ⇒ không có chỗ nào không đè panel (w-full).
  if (rongManHinh <= 600) return null;
  return LE_TOAST + RONG_TOAST + KHOANG_HO <= rongManHinh - RONG_PANEL ? "bottom-left" : null;
}
