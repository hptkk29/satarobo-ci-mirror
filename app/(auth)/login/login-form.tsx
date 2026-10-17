"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { AtSign, Lock, Eye, EyeOff, Loader2, AlertTriangle, Ban, ArrowLeft } from "lucide-react";
import { loginSchema } from "@/lib/validators/auth";
import { sanitizeCallbackUrl } from "@/lib/auth/route-policy";

// Form "Waves" (port AuthenUI) — ĐÃ BỎ đăng ký. Giữ nguyên luồng Auth.js signIn +
// callbackUrl + cảnh báo phiên + link kích hoạt tài khoản (phụ huynh mới).
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = sanitizeCallbackUrl(searchParams.get("callbackUrl") ?? "/dashboard");
  const reason = searchParams.get("reason");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ identifier, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Thông tin đăng nhập chưa hợp lệ.");
      return;
    }
    setError("");
    setLoading(true);
    const result = await signIn("credentials", {
      identifier: parsed.data.identifier,
      password: parsed.data.password,
      redirect: false,
    });
    setLoading(false);
    if (result?.error) {
      toast.error("Thông tin đăng nhập hoặc mật khẩu không đúng");
      setError("Thông tin đăng nhập hoặc mật khẩu không đúng.");
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <form className="my-form" onSubmit={submit} aria-labelledby="login-title" noValidate>
      <Link href="/" className="my-form__back" aria-label="Về trang chủ" title="Về trang chủ">
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
        <h1 id="login-title">Chào mừng trở lại</h1>
        <p>Đăng nhập vào hệ thống Sata Robo.</p>
      </div>

      {reason === "session-invalidated" && (
        <div className="auth-alert auth-alert--warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <b>Phiên đăng nhập đã hết hạn.</b> Tài khoản vừa được cập nhật (vai trò, mật khẩu hoặc quyền). Vui lòng đăng nhập lại.
          </div>
        </div>
      )}
      {reason === "session-disabled" && (
        <div className="auth-alert auth-alert--danger">
          <Ban className="mt-0.5 size-4 shrink-0" />
          <div>
            <b>Tài khoản đã bị vô hiệu hoá.</b> Liên hệ admin nếu cần hỗ trợ.
          </div>
        </div>
      )}

      <div className="input__wrapper">
        <AtSign className="input__icon" />
        {/* inputMode="email" (không phải "tel" dù ưu tiên SĐT): bàn phím tel
            trên mobile KHÔNG có chữ cái → nhân sự/GV không gõ nổi email. */}
        <input
          type="text"
          id="identifier"
          inputMode="email"
          className="input__field"
          placeholder=" "
          required
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
        />
        <label htmlFor="identifier" className="input__label">Số điện thoại hoặc Email</label>
      </div>

      <div className="input__wrapper">
        <Lock className="input__icon" />
        <input
          id="password"
          type={show ? "text" : "password"}
          className="input__field"
          placeholder=" "
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <label htmlFor="password" className="input__label">Mật khẩu</label>
        <button
          type="button"
          className="password-toggle"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Ẩn ký tự" : "Hiện ký tự"}
        >
          {show ? <EyeOff /> : <Eye />}
        </button>
      </div>

      {error && <span className="password-error visible">{error}</span>}

      <button type="submit" className="my-form__button" disabled={loading}>
        {loading && <Loader2 className="size-4 animate-spin" />}
        Đăng nhập
      </button>

      <div className="my-form__actions">
        <div className="my-form__row">
          <span>
            <span>Phụ huynh mới? </span>
            <a href="/kich-hoat" title="Kích hoạt tài khoản">Kích hoạt tài khoản</a>
          </span>
        </div>
        <div className="my-form__row">
          {/* AUTH-SĐT P6 — lối vào duy nhất của /quen-mat-khau. */}
          <span>
            <a href="/quen-mat-khau" title="Quên mật khẩu">Quên mật khẩu?</a>
          </span>
        </div>
      </div>
    </form>
  );
}
