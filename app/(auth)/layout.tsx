import { PubRoot } from "@/components/public/pub-root";
import { CookieConsent } from "@/components/public/cookie-consent";

// Nhóm (auth) — đăng nhập / kích hoạt / quên mật khẩu / nhận bài DISC / đổi mật khẩu — dùng NGÔN NGỮ THỊ GIÁC
// CỦA TRANG CÔNG KHAI (artifact "Sata Robo — Website mới"): token + font + chủ đề sáng/tối đến từ `PubRoot`
// (mặc định SÁNG, khoá `sata-theme` như phần còn lại của site công khai). Khung hai cột + thẻ + dải link pháp
// lý do `KhungAuth` dựng trong từng trang.
//
// Dải link pháp lý nằm TRONG DÒNG dưới thẻ (không `position: fixed`) — nợ kỹ thuật #25, lưới [BC-03].
// CookieConsent: màn kích hoạt thu SĐT/email của phụ huynh nên banner phải có ở nhóm này (xem app/(legacy)/layout.tsx).
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <PubRoot>
      {children}
      <CookieConsent />
    </PubRoot>
  );
}
