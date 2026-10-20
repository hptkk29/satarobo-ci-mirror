"use client";

import { useEffect } from "react";

/**
 * Fix bug: Next.js 16 App Router + Chrome bfcache đôi khi mất CSS link tags
 * khi user nhấn nút Back từ một route group khác (VD: /khoa-hoc/laptrinhrobot
 * (legacy group) -> /khoa-hoc (public group) -> Back -> CSS biến mất).
 *
 * Workaround: phát hiện bfcache restore qua PageTransitionEvent.persisted,
 * force reload trang để re-download CSS chunks.
 *
 * Reload chỉ trigger khi browser thực sự restore từ bfcache (event.persisted
 * = true), không ảnh hưởng navigation thông thường.
 */
export function BfcacheReloadFix() {
  useEffect(() => {
    const handler = (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.location.reload();
      }
    };
    window.addEventListener("pageshow", handler);
    return () => window.removeEventListener("pageshow", handler);
  }, []);

  return null;
}
