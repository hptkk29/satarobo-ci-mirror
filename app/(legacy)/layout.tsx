// Phase 4.UI.FIX.3 — legacy route group bypasses the (public) layout
// (Header + Footer + FloatingCta) because legacy pages bring their own chrome.
import type { ReactNode } from "react";
import { AttributionCapture } from "@/components/public/attribution-capture";
import { CookieConsent } from "@/components/public/cookie-consent";

export default function LegacyLayout({ children }: { children: ReactNode }) {
  // Landing cũ cũng nhận link `?ref=` (2 domain cũ redirect về đây qua proxy.ts).
  return (
    <>
      <AttributionCapture />
      {children}
      {/* Banner đồng ý cookie — trước 21/09/2026 nó CHỈ có ở nhóm `(public)`, trong khi
          `<MetaPixel/>` và `<GA4/>` gắn ở layout GỐC (app/layout.tsx) và gác theo cờ
          `granted` của banner. Hệ quả trên HAI landing chạy quảng cáo: khách vào thẳng từ
          quảng cáo không có chỗ nào để đồng ý ⇒ vừa không được hỏi (hồ sơ BCT), vừa mất
          sạch đo lường chuyển đổi. */}
      <CookieConsent />
    </>
  );
}
