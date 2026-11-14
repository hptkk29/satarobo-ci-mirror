import { Header } from "@/components/public/header";
import { SiteFooter } from "@/components/sections/site-footer";
import { FloatingCta } from "@/components/public/floating-cta";
import { PopupHocThu11 } from "@/components/public/popup-hoc-thu-1-1";
import { CookieConsent } from "@/components/public/cookie-consent";
import { AttributionCapture } from "@/components/public/attribution-capture";
import { PubRoot } from "@/components/public/pub-root";
// Cờ đọc ở SERVER rồi truyền xuống bằng prop — client không tự đoán cờ.
import { isDiscEnabled, isSucKhoeEnabled, isTuSachEnabled } from "@/lib/flags";
import { duLieuChatbot } from "@/lib/chatbot/loi-dan";

// Giao diện public mới (artifact "Sata Robo — Website mới", 02/11/2026): mọi trang trong nhóm
// này nằm trong `<PubRoot>` (class `.sr-pub`, chủ đề sáng/tối, ba font next/font). Token và
// class CHỈ có hiệu lực bên trong `.sr-pub` — xem docs/public-redesign/NEN-PUBLIC.md.
// - FloatingCta: cụm nút nổi (≥861px) + thanh đáy điện thoại (≤860px).
// - PopupHocThu11 (popup mời đặt buổi học thử 1-1 miễn phí) tự tắt trên /lien-he và ngoài
//   cửa sổ chương trình trong @/lib/uu-dai.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <PubRoot>
      {/* Giữ nguồn khách (?ref= affiliate + UTM) qua các lần chuyển trang — form
          đăng ký ở trang bất kỳ mới gửi kèm được. */}
      <AttributionCapture />
      <Header discEnabled={isDiscEnabled()} congThongTin={{ tuSach: isTuSachEnabled(), sucKhoe: isSucKhoeEnabled() }} />
      <main style={{ flex: "1 1 auto" }}>{children}</main>
      <SiteFooter />
      <FloatingCta discEnabled={isDiscEnabled()} congThongTin={{ tuSach: isTuSachEnabled(), sucKhoe: isSucKhoeEnabled() }} chatbot={duLieuChatbot()} />
      <PopupHocThu11 />
      <CookieConsent />
    </PubRoot>
  );
}
