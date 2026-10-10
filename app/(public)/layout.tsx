import { Header } from "@/components/public/header";
import { SiteFooter } from "@/components/sections/site-footer";
import { FloatingCta } from "@/components/public/floating-cta";
import { StickyMobileCta } from "@/components/sections/sticky-mobile-cta";
import { PopupHocThu11 } from "@/components/public/popup-hoc-thu-1-1";
import { CookieConsent } from "@/components/public/cookie-consent";
import { AttributionCapture } from "@/components/public/attribution-capture";

// F-UI-4 wiring:
// - <SiteFooter /> thay <Footer /> cũ (giữ file cũ ở components/public/
//   để rollback nếu cần — không import nữa).
// - <FloatingCta /> giờ desktop-only (lg:flex); <StickyMobileCta />
//   bottom bar full-width chỉ mobile (lg:hidden) — không đè nhau.
// - PopupHocThu11 (popup mời đặt buổi học thử 1-1 miễn phí) dùng z-[110] để
//   override drawer (z-50) + sticky mobile CTA (z-40); popup tự tắt trên
//   /lien-he và tự tắt ngoài cửa sổ chương trình trong @/lib/uu-dai.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Giữ nguồn khách (?ref= affiliate + UTM) qua các lần chuyển trang — form
          đăng ký ở trang bất kỳ mới gửi kèm được. */}
      <AttributionCapture />
      <Header />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      <FloatingCta />
      <StickyMobileCta />
      <PopupHocThu11 />
      <CookieConsent />
    </>
  );
}
