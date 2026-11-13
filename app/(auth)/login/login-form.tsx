"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, signIn } from "next-auth/react";
import { toast } from "sonner";
import { AlertTriangle, Ban } from "lucide-react";
import { loginSchema } from "@/lib/validators/auth";
import { LOI_MANG, LOI_PHIEN, loiTuKetQuaSignIn } from "@/lib/auth/loi-dang-nhap";
import { sanitizeCallbackUrl } from "@/lib/auth/route-policy";

// Biểu mẫu đăng nhập — markup CHÉP từ artifact "Login" (`<form>` + `.fld` + `.pw` + nút `.btn-acc`; tiêu đề/thẻ do `page.tsx` dựng).
// GIỮ NGUYÊN luồng Auth.js signIn + callbackUrl + cảnh báo phiên + link kích hoạt tài khoản (phụ huynh mới).
//
// KHÔNG vẽ những thứ artifact có mà luồng thật không có: "Ghi nhớ đăng nhập" (không có tuỳ chọn phiên nào để ghi nhớ), "hoặc" + nút
// Google / Passkey (không có nhà cung cấp nào), "Đăng ký phụ huynh" (không có tự đăng ký — tài khoản phụ huynh do trung tâm cấp rồi
// KÍCH HOẠT ở /kich-hoat, nên dòng cuối nói "Phụ huynh mới? Kích hoạt tài khoản").
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
    let loi: string | null;
    try {
      const result = await signIn("credentials", {
        identifier: parsed.data.identifier,
        password: parsed.data.password,
        redirect: false,
      });
      loi = loiTuKetQuaSignIn(result);
      // signIn báo OK nhưng trình duyệt có THẬT SỰ giữ cookie phiên không? Trình duyệt nhúng
      // của Zalo/Facebook hay nuốt cookie: không kiểm thì router.push bị proxy đá ngược về
      // /login, form hiện lại y nguyên — người dùng bấm lại, và lần thứ 6 chạm giới hạn
      // 5 lượt/phút mới thấy "sai mật khẩu" (đo từ báo cáo 23/10).
      if (!loi && !(await getSession())?.user) loi = LOI_PHIEN;
    } catch {
      loi = LOI_MANG;
    }
    setLoading(false);
    if (loi) {
      toast.error(loi);
      setError(loi);
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <>
      {reason === "session-invalidated" && (
        <div role="alert" style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "0 0 14px", padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(245,158,11,.55)", background: "rgba(245,158,11,.12)", fontSize: 14 }}>
          <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: "#d97706" }} />
          <div>
            <b>Phiên đăng nhập đã hết hạn.</b> Tài khoản vừa được cập nhật (vai trò, mật khẩu hoặc quyền). Vui lòng đăng nhập lại.
          </div>
        </div>
      )}
      {reason === "session-disabled" && (
        <div role="alert" style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "0 0 14px", padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(239,68,68,.45)", background: "rgba(239,68,68,.1)", fontSize: 14 }}>
          <Ban size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: "#ef4444" }} />
          <div>
            <b>Tài khoản đã bị vô hiệu hoá.</b> Liên hệ admin nếu cần hỗ trợ.
          </div>
        </div>
      )}

      <form style={{ display: "grid", gap: "14px" }} onSubmit={submit} aria-labelledby="login-title" noValidate>
        <div className="fld">
          <label htmlFor="identifier">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"></path>
            </svg>{" "}
            Số điện thoại hoặc email
          </label>
          {/* inputMode="email" (không phải "tel" dù ưu tiên SĐT): bàn phím tel trên mobile KHÔNG có chữ cái → nhân sự/GV không gõ nổi email. */}
          <input
            id="identifier"
            className="inp"
            type="text"
            inputMode="email"
            required
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="VD: 09xx xxx xxx"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        </div>
        <div className="fld">
          <label htmlFor="password" style={{ justifyContent: "space-between" }}>
            <span style={{ display: "flex", gap: "7px", alignItems: "center" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>{" "}
              Mật khẩu
            </span>
            {/* AUTH-SĐT P6 — lối vào duy nhất của /quen-mat-khau. */}
            <Link href="/quen-mat-khau" style={{ fontSize: "13px" }} title="Quên mật khẩu">
              Quên mật khẩu?
            </Link>
          </label>
          <div className="pw">
            <input
              id="password"
              className="inp"
              type={show ? "text" : "password"}
              required
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Ẩn ký tự" : "Hiện ký tự"} aria-pressed={show}>
              {show ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M1 1l22 22"></path>
                  <path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"></path>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              )}
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#ef4444" }}>
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-acc" disabled={loading} style={{ width: "100%", minHeight: "54px", fontSize: "16px" }}>
          Đăng nhập{" "}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 17L17 7M8 7h9v9"></path>
          </svg>
        </button>
      </form>
      <p style={{ margin: "18px 0 0", textAlign: "center", color: "var(--muted)" }}>
        Phụ huynh mới?{" "}
        <Link href="/kich-hoat" style={{ fontWeight: "700" }} title="Kích hoạt tài khoản">
          Kích hoạt tài khoản
        </Link>
      </p>
    </>
  );
}
