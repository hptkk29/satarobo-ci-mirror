// Ca [POS1-VA-UI-04] — bong bóng kết quả của panel Import POS KHÔNG được đè lên panel. THUẦN.
//
// Rà đối kháng 06/10/2026: bản vá đầu đặt `top-center` khi màn < 640px và `bottom-left` khi ≥ 640px.
// Đo bằng hình học thật của sonner 2.0.7 (`dist/styles.css` + `index.mjs`):
//   · ≤ 600px: `@media (max-width:600px)` ép toaster RỘNG HẾT màn và gỡ vị trí ngang ⇒ `top-center`
//     y hệt `top-right` cũ — đè tiêu đề + chữ hướng dẫn của panel (panel phủ trọn màn ở 375px);
//   · 601–639px: toast 356px nằm giữa trên một panel `w-full` ⇒ vẫn đè header;
//   · 640–~907px: `bottom-left` chiếm x∈[24, 380], panel `sm:max-w-lg` chiếm x∈[W−512, W] ⇒ CHỒNG.
// Luật nay: chỉ bắn toast khi có chỗ trống thật ở bên trái panel; không có ⇒ không toast (khối "Kết
// quả import" trong panel đã nói kết quả).
import { describe, it, expect } from "vitest";
import { KHOANG_HO, LE_TOAST, RONG_PANEL, RONG_TOAST, viTriToastPanel } from "./vi-tri-toast";

describe("[POS1-VA-UI-04] viTriToastPanel — toast chỉ hiện khi KHÔNG chạm panel", () => {
  it("[POS1-VA-UI-04a] hằng số khớp sonner 2.0.7 + panel `sm:max-w-lg`", () => {
    expect(RONG_TOAST).toBe(356);
    expect(LE_TOAST).toBe(24);
    expect(RONG_PANEL).toBe(512);
  });

  it("[POS1-VA-UI-04b] 375 / 600 / 639 / 768 / 890px ⇒ KHÔNG toast; 1280px ⇒ góc trái dưới", () => {
    for (const w of [375, 600, 639, 640, 768, 890]) expect(viTriToastPanel(w), `${w}px`).toBeNull();
    expect(viTriToastPanel(1280)).toBe("bottom-left");
  });

  it("[POS1-VA-UI-04c] biên: toast phải kết thúc trước mép trái panel ít nhất KHOANG_HO", () => {
    const nguong = LE_TOAST + RONG_TOAST + KHOANG_HO + RONG_PANEL;
    expect(viTriToastPanel(nguong - 1)).toBeNull();
    expect(viTriToastPanel(nguong)).toBe("bottom-left");
    // Mọi bề rộng cho ra toast thì toast không chồng panel.
    for (let w = 320; w <= 1920; w += 1) {
      if (viTriToastPanel(w) === null) continue;
      expect(LE_TOAST + RONG_TOAST, `${w}px`).toBeLessThanOrEqual(w - RONG_PANEL - KHOANG_HO);
    }
  });
});
