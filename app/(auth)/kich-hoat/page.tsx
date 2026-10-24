import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ActivateForm } from "./activate-form";

export const metadata: Metadata = { title: "Kích hoạt tài khoản" };

// Card "Waves" (đồng bộ login) — nền sóng + căn giữa do (auth)/layout.tsx dựng;
// KHÔNG bọc min-h-screen/bg riêng (gây khối xám kéo dài toàn màn hình).
export default function ActivatePage() {
  return (
    <div className="my-form">
      <Link href="/login" className="my-form__back" aria-label="Về trang đăng nhập" title="Về trang đăng nhập">
        <ArrowLeft />
      </Link>
      <div className="login-welcome-row">
        <Image
          src="/brand/logo-satarobo.png"
          alt="Sata Robo"
          width={484}
          height={280}
          priority
          className="mx-auto mb-4 block h-16 w-auto object-contain"
        />
        <h1>Kích hoạt tài khoản</h1>
        <p>Dành cho phụ huynh mới nhận tài khoản từ trung tâm.</p>
      </div>

      <ActivateForm />

      <div className="my-form__actions">
        <div className="my-form__row">
          <span>
            Đã có mật khẩu? <a href="/login" title="Đăng nhập">Đăng nhập</a>
          </span>
        </div>
      </div>
    </div>
  );
}
