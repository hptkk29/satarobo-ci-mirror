"use client";

import { useEffect, useLayoutEffect } from "react";
import Script from "next/script";

/**
 * Nạp NGUYÊN VĂN `public/pub/fx.js` (lớp hiệu ứng "robotics" của artifact: hiện dần khi cuộn qua IntersectionObserver,
 * data-fx-off, chế độ nhẹ `html.fx-lite`, thanh tiến độ, spotlight thẻ…). KHÔNG viết lại, không tách thành hook.
 * Đặt trong `app/(public)/layout.tsx` và `app/(auth)/layout.tsx` (qua `PubRoot`).
 *
 * ⚠️ fx.js là script TOÀN CỤC dùng một lần (`window.__sataFx`), quét cả `document` bằng MutationObserver: chữ h1/h2 bị xáo ký tự
 * ("decrypt"), số bị đếm lên, con trỏ ngắm + tia lửa khi bấm, thẻ `.card` có viền HUD, `li` trong thẻ bị ẩn tới khi cuộn… Nếu
 * khách đi từ trang public/đăng nhập sang cổng phụ huynh / học viên / admin bằng ĐIỀU HƯỚNG MỀM thì script vẫn sống và phá giao diện
 * ở đó (03/11/2026: tiêu đề cổng phụ huynh hiện `O<>#` — chủ dự án yêu cầu bỏ hiệu ứng chạy chữ ở site phụ huynh + học viên).
 * fx.js không có hàm tắt, nên khi PubRoot bị gỡ khỏi trang (rời khỏi nhóm route public/auth) ta TẢI LẠI trang một lần: trang mới
 * không nạp fx.js. Hai nhóm public ↔ auth thay nhau trong cùng một lượt điều hướng nên lúc kiểm vẫn còn một `.sr-pub` ⇒ không tải lại.
 */
/**
 * Chặn hiệu ứng «xáo ký tự» (decrypt) của fx.js trên tiêu đề (04/11/2026, chủ dự án: «bỏ hiệu ứng load chữ này»). fx.js thay chữ h1/h2 bằng ký tự ngẫu nhiên `01<>/#{}[]=+*ROBO`
 * trong ~0,6–1 giây MỖI tiêu đề (22 nhịp × 28ms bằng setTimeout) và ghi đè nodeValue liên tục ⇒ chữ nhấp nháy, chậm, và có lúc người dùng chụp được tiêu đề đang là rác.
 * fx.js KHÔNG có công tắc, nhưng `decrypt()` bỏ qua phần tử đã có `data-fx-dec` — nên đánh dấu `done` TRƯỚC khi nó chạy (useLayoutEffect chạy trước khi script
 * afterInteractive tải xong) và cho cả tiêu đề thêm sau khi điều hướng mềm (MutationObserver). Hiệu ứng thay thế là CSS thuần ở phan-bo-sung.css (`pub-tieu-de`).
 */
function danhDauTieuDe(goc: ParentNode) {
  goc.querySelectorAll<HTMLElement>("h1, h2").forEach((el) => {
    if (!el.dataset.fxDec) el.dataset.fxDec = "done";
  });
}

export function PubFx() {
  useLayoutEffect(() => {
    danhDauTieuDe(document);
    const mo = new MutationObserver((ds) => {
      for (const d of ds) {
        d.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          if ((n.tagName === "H1" || n.tagName === "H2") && !n.dataset.fxDec) n.dataset.fxDec = "done";
          danhDauTieuDe(n);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      // Hoãn một nhịp: StrictMode (dev) gỡ rồi gắn lại ngay, và điều hướng giữa hai nhóm có PubRoot thì gốc mới đã có mặt.
      window.setTimeout(() => {
        const w = window as Window & { __sataFx?: number };
        if (w.__sataFx && !document.querySelector(".sr-pub")) window.location.reload();
      }, 60);
    };
  }, []);
  return <Script src="/pub/fx.js" strategy="afterInteractive" />;
}
