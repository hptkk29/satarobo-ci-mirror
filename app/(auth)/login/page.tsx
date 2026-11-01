import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Đăng nhập",
};

// Form "Waves" (AuthenUI) tự là card `.my-form`; nền sóng do (auth)/layout.tsx dựng.
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="my-form" style={{ minHeight: 340 }} />}>
      <LoginForm />
    </Suspense>
  );
}
