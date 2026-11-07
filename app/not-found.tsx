import { Header } from "@/components/public/header";
import { SiteFooter } from "@/components/sections/site-footer";
import { FloatingCta } from "@/components/public/floating-cta";
import { CookieConsent } from "@/components/public/cookie-consent";
import { PubRoot } from "@/components/public/pub-root";
import { Khoi404 } from "@/components/not-found/khoi-404";
import { ChiHienOHostCongKhai } from "@/components/not-found/host-cong-khai";
import { isDiscEnabled } from "@/lib/flags";

export const metadata = { title: "Không tìm thấy trang" };

// Trang 404 toàn site theo artifact "Sata Robo — Website mới" — dùng cho URL KHÔNG khớp route nào
// (không có layout nhóm nên tự bọc `<PubRoot>` + thanh trên + chân trang). Khi `notFound()` bắn từ một
// trang public thì `app/(public)/not-found.tsx` lo (layout nhóm đã có khung). Link "về trang chính" tuỳ
// theo subdomain đang truy cập — chọn ở TRÌNH DUYỆT; ở admin / giáo viên / cổng PH khung tiếp thị ẩn đi.
//
// ⛔ KHÔNG import `next/headers` / `cookies()` ở đây [lỗi 500 slug lạ, 30/10/2026]: trang này được render
// trong ngữ cảnh TĨNH khi `notFound()` bắn từ route ISR (`/tin-tuc/<x>`, `/tuyen-dung/<x>`, `/vinh-danh/<x>`),
// và một API động ở đó làm cả route lỗi "Page changed from static to dynamic at runtime" ⇒ 500.
// Lưới: lib/routing/dich-den-404.test.ts ([NF404-W1]).
export default function NotFound() {
  const discEnabled = isDiscEnabled();
  return (
    <PubRoot>
      <ChiHienOHostCongKhai>
        <Header discEnabled={discEnabled} />
      </ChiHienOHostCongKhai>
      <main id="noi-dung" style={{ flex: "1 1 auto" }}>
        <Khoi404 />
      </main>
      <ChiHienOHostCongKhai>
        <SiteFooter />
        <FloatingCta discEnabled={discEnabled} />
      </ChiHienOHostCongKhai>
      <CookieConsent />
    </PubRoot>
  );
}
