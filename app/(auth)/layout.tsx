"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { DaiLinkPhapLy } from "@/components/public/dai-link-phap-ly";
import { CookieConsent } from "@/components/public/cookie-consent";
import "./auth.css";

// Cổng đăng nhập "Waves" (port từ AuthenUI). Sáng/Tối TỰ QUẢN qua class .dark trên
// .auth-root (localStorage 'auth-theme') — không cần ThemeProvider toàn cục, không
// đụng phần còn lại của app.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(localStorage.getItem("auth-theme") === "dark"), []);
  const toggle = () =>
    setDark((d) => {
      const next = !d;
      localStorage.setItem("auth-theme", next ? "dark" : "light");
      return next;
    });

  return (
    <div className={cn("auth-root", dark && "dark")}>
      {/* Sóng nền */}
      <svg className="bg-waves" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="wave-grad-1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" className="wave-stop-1a" /><stop offset="100%" className="wave-stop-1b" /></linearGradient>
          <linearGradient id="wave-grad-2" x1="0" y1="0" x2="1" y2="0.8"><stop offset="0%" className="wave-stop-2a" /><stop offset="100%" className="wave-stop-2b" /></linearGradient>
          <linearGradient id="wave-grad-3" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0%" className="wave-stop-3a" /><stop offset="100%" className="wave-stop-3b" /></linearGradient>
          <linearGradient id="wave-grad-4" x1="0" y1="0.2" x2="1" y2="0.8"><stop offset="0%" className="wave-stop-4a" /><stop offset="100%" className="wave-stop-4b" /></linearGradient>
        </defs>
        <path className="wave wave-1" fill="url(#wave-grad-1)" d="M0,620 C120,580 200,650 360,590 C520,530 600,610 720,570 C840,530 960,620 1080,560 C1200,500 1320,600 1440,550 L1440,900 L0,900 Z" />
        <path className="wave wave-2" fill="url(#wave-grad-2)" d="M0,700 C100,660 180,720 300,680 C420,640 520,710 660,670 C800,630 900,700 1040,660 C1180,620 1300,700 1440,660 L1440,900 L0,900 Z" />
        <path className="wave wave-3" fill="url(#wave-grad-3)" d="M0,760 C80,730 160,770 280,740 C400,710 480,760 600,730 C720,700 840,760 960,730 C1080,700 1200,760 1320,730 C1380,715 1420,740 1440,730 L1440,900 L0,900 Z" />
        <path className="wave wave-4" fill="url(#wave-grad-4)" d="M0,810 C100,790 180,820 280,800 C380,780 460,810 560,795 C660,780 760,810 860,795 C960,780 1060,810 1160,795 C1260,780 1360,808 1440,795 L1440,900 L0,900 Z" />
      </svg>

      <svg className="bg-blobs" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
        <circle className="blob blob-1" cx="200" cy="150" r="180" />
        <circle className="blob blob-2" cx="1250" cy="300" r="220" />
        <circle className="blob blob-3" cx="700" cy="100" r="120" />
      </svg>

      <button className="theme-toggle" type="button" onClick={toggle} aria-label="Đổi giao diện sáng/tối" title="Đổi giao diện sáng/tối">
        {dark ? <Sun width={20} height={20} /> : <Moon width={20} height={20} />}
      </button>

      {/* Thẻ của trang — `.auth-main` chiếm phần còn lại của khung và căn thẻ ở giữa (auth.css). */}
      <main className="auth-main">{children}</main>

      {/* Dải link pháp lý — bắt buộc cho hồ sơ BCT: `/kich-hoat` là màn thu số điện thoại /
          email của phụ huynh và là màn được chụp ảnh trong file hướng dẫn, nhưng nhóm route
          này trước đây không có chân trang nào.
          ⚠️ NẰM TRONG DÒNG, dưới thẻ — KHÔNG `position: fixed` (nợ kỹ thuật #25, 28/09/2026).
          Bản trước ghim nó ở đáy khung nhìn để khỏi sửa bố cục flex-giữa của `.auth-root`; thẻ nào
          cao hơn khung nhìn thì dải link ĐÈ lên nội dung thẻ ở mọi vị trí cuộn — đúng khu nút bấm
          chính của thẻ. Nay `.auth-root` là cột: `.auth-main` (thẻ) + `.auth-footer` (dải).
          Lưới: tests/e2e/a0/auth-bo-cuc.spec.ts [BC-03]. */}
      <footer className="auth-footer">
        <DaiLinkPhapLy />
      </footer>

      {/* Xem chú thích ở app/(legacy)/layout.tsx: banner trước đây vắng mặt ở nhóm này,
          trong đó có /kich-hoat — màn thu số điện thoại/email của phụ huynh. */}
      <CookieConsent />
    </div>
  );
}
