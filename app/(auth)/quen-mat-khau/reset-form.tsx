"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { requestPasswordResetOtp, resetPassword } from "./_actions";

export function ResetForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"identify" | "verify" | "done">("identify");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  function sendOtp() {
    startTransition(async () => {
      const res = await requestPasswordResetOtp(identifier);
      if (res.ok) {
        toast.success("Đã gửi mã đặt lại qua Zalo hoặc email (nếu hợp lệ).");
        setStep("verify");
        setCooldown(res.cooldownSec ?? 60);
      } else {
        toast.error(res.error ?? "Lỗi gửi mã");
        if (res.cooldownSec) setCooldown(res.cooldownSec);
      }
    });
  }

  function resend() {
    if (cooldown > 0) return;
    sendOtp();
  }

  function submit() {
    startTransition(async () => {
      const res = await resetPassword({ identifier, code, password });
      if (res.ok) {
        toast.success("Đã đặt lại mật khẩu. Vui lòng đăng nhập lại.");
        setStep("done");
      } else toast.error(res.error ?? "Lỗi đặt lại mật khẩu");
    });
  }

  const inputCls =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none";

  if (step === "done") {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-gray-600">
          Mật khẩu đã được đặt lại. Mọi thiết bị đang đăng nhập đã bị đăng xuất — hãy đăng nhập
          lại bằng mật khẩu mới.
        </p>
        <button
          type="button"
          onClick={() => router.push("/login")}
          className="w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600"
        >
          Đến trang đăng nhập
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">
          Số điện thoại hoặc Email
        </span>
        {/* inputMode="email" chứ không phải "tel" — xem ghi chú ở /login (P3). */}
        <input
          type="text"
          inputMode="email"
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          disabled={step === "verify" || pending}
          placeholder="0905123456"
          className={inputCls}
        />
      </label>

      {step === "identify" && (
        <>
          <button
            type="button"
            onClick={sendOtp}
            disabled={pending || !identifier}
            className="w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
          >
            {pending ? "Đang gửi…" : "Gửi mã đặt lại"}
          </button>
          {/* Bù cho việc bịt oracle liệt kê (P0 §3.4): hệ thống luôn trả cùng một
              câu nên không nói được "tài khoản không tồn tại / chưa kích hoạt". */}
          <p className="text-xs leading-relaxed text-gray-500">
            Vì lý do bảo mật, hệ thống luôn báo đã gửi mã. Nếu tài khoản{" "}
            <strong className="font-medium text-gray-600">chưa được kích hoạt</strong>, hãy dùng{" "}
            <a href="/kich-hoat" className="underline" title="Kích hoạt tài khoản">
              Kích hoạt tài khoản
            </a>{" "}
            thay vì màn này. Không nhận được mã sau vài phút, xin liên hệ trung tâm.
          </p>
        </>
      )}

      {step === "verify" && (
        <>
          {/* Mã + mật khẩu mới nằm CÙNG màn — ràng buộc của QĐ P0-a
              (verifyAndConsumeOtp nguyên tử, không có bước trung gian). */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              Mã OTP (6 số gửi qua Zalo hoặc email)
            </span>
            <input
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
              className={`${inputCls} tracking-[0.4em]`}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              Mật khẩu mới (≥ 8 ký tự)
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
            />
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={pending || code.length !== 6 || password.length < 8}
            className="w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
          >
            {pending ? "Đang đặt lại…" : "Đặt lại mật khẩu"}
          </button>
          <button
            type="button"
            onClick={resend}
            disabled={cooldown > 0 || pending}
            className="w-full text-xs text-gray-500 hover:text-gray-700 disabled:opacity-60"
          >
            {cooldown > 0 ? `Gửi lại mã sau ${cooldown}s` : "Gửi lại mã"}
          </button>
        </>
      )}
    </div>
  );
}
