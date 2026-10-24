"use client";

// Ghi nguồn khách (?ref= affiliate + UTM + click-id) vào cookie first-party ngay khi
// khách vào site, để form đăng ký ở TRANG KHÁC vẫn gửi kèm được. Không render gì.
//
// Cố ý KHÔNG dùng `useSearchParams`: hook đó buộc phải bọc Suspense và kéo trang
// tĩnh sang dynamic rendering (public site có ngân sách LCP < 2.5s, ISR là thứ giữ
// được điểm đó). `usePathname` không có ràng buộc ấy; query đọc thẳng từ
// `window.location.search` trong effect.
//
// Hệ quả đã cân nhắc: link đổi MỖI query mà giữ nguyên path trong cùng phiên SPA
// (vd `/?ref=A` → `/?ref=B` không tải lại trang) sẽ không bắt lần đổi thứ hai.
// Link giới thiệu thật luôn tới dạng tải trang mới nên không chạm ca này.

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { captureAttribution } from "@/lib/marketing/attribution";

export function AttributionCapture() {
  const pathname = usePathname();

  useEffect(() => {
    captureAttribution();
  }, [pathname]);

  return null;
}
