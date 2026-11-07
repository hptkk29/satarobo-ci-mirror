import type { Metadata } from "next";
import { Suspense } from "react";
import { KhungXacThuc } from "@/components/public/xac-thuc/khung-xac-thuc";
import { TranhDangNhap } from "@/components/public/xac-thuc/tranh-dangnhap";
import { LoginForm } from "./login-form";

// Trang đăng nhập không lập chỉ mục (artifact: robots noindex, follow).
export const metadata: Metadata = {
  title: "Đăng nhập",
  description: "Đăng nhập tài khoản Sata Robo để xem lịch học, tiến độ và học phí của con.",
  alternates: { canonical: "https://satarobo.vn/login" },
  robots: { index: false, follow: true },
};

// Giao diện CHÉP từ artifact "Login" (CSS: app/(public)/pub-design/xac-thuc.css). Tiêu đề nằm ở server để lưới [BC-03] / smoke
// thấy heading ngay cả khi biểu mẫu chưa hydrate. Biểu mẫu (client) giữ nguyên luồng Auth.js signIn.
export default function LoginPage() {
  return (
    <KhungXacThuc tranh={<TranhDangNhap />}>
      <span className="tag">Đăng nhập</span>
      <h1 id="login-title" style={{ marginTop: "12px" }}>
        Chào mừng <span className="grad">trở lại!</span>
      </h1>
      <p style={{ margin: "6px 0 18px", color: "var(--muted)" }}>Đăng nhập để xem lịch học, bài tập và tiến độ của con.</p>
      <Suspense fallback={<div style={{ minHeight: 280 }} />}>
        <LoginForm />
      </Suspense>
    </KhungXacThuc>
  );
}
