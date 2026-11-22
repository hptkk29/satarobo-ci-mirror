"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { OMatKhau } from "@/components/public/xac-thuc/o-mat-khau";
import { OtpSauO } from "@/components/public/xac-thuc/otp-sau-o";
import { useBuoc } from "@/components/public/xac-thuc/buoc-xac-thuc";
import { requestPasswordResetOtp, resetPassword } from "./_actions";

// Markup CHÉP từ artifact "Forgot" (h1 + `.fld` + `.otp` + `.linkbtn` + `.pw` + `.meter` + `.success`); thanh bước do trang dựng.
// Luồng thật GIỮ NGUYÊN: mã OTP + mật khẩu mới được xác nhận CÙNG LÚC (verifyAndConsumeOtp nguyên tử — QĐ P0-a), nên mã và mật khẩu mới
// nằm chung MỘT màn (bước 2). Artifact tách thành hai màn và có ô "Nhập lại mật khẩu mới" — máy chủ không có chỗ ghi tương ứng
// (e2e chỉ điền một ô) nên không vẽ ô nhập lại.
const ICON_NGUOI = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
    <circle cx="9" cy="7" r="4"></circle>
    <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"></path>
  </svg>
);
const ICON_KHIEN = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
  </svg>
);

export function ResetForm() {
  const router = useRouter();
  const { datBuoc } = useBuoc();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"identify" | "verify" | "done">("identify");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    datBuoc(step === "identify" ? 1 : step === "verify" ? 2 : 3);
  }, [step, datBuoc]);

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

  if (step === "done") {
    return (
      <div className="success">
        <div className="burst">
          <PubAnh id="42d4d66e4311582de0d03b3122bb7b04" alt="" sizes="170px" />
        </div>
        <h1>
          Đổi mật khẩu <span className="grad">thành công!</span>
        </h1>
        <p style={{ margin: "0", color: "var(--muted)" }}>
          Mật khẩu đã được đặt lại. Mọi thiết bị đang đăng nhập đã bị đăng xuất — hãy đăng nhập lại bằng mật khẩu mới.
        </p>
        <button type="button" className="btn btn-acc" onClick={() => router.push("/login")} style={{ width: "100%", minHeight: "52px" }}>
          Đến trang đăng nhập
        </button>
      </div>
    );
  }

  return (
    <>
      {step === "identify" ? (
        <>
          <h1>
            Quên <span className="grad">mật khẩu?</span>
          </h1>
          <p style={{ margin: "6px 0 18px", color: "var(--muted)" }}>Nhận mã xác thực qua Zalo hoặc email để đặt lại mật khẩu.</p>
        </>
      ) : (
        <>
          <h1>
            Nhập <span className="grad">mã xác minh</span>
          </h1>
          <p style={{ margin: "6px 0 16px", color: "var(--muted)" }}>
            Mã 6 số đã gửi tới <b style={{ color: "var(--text)" }}>{identifier}</b>.
          </p>
        </>
      )}

      <div style={{ display: "grid", gap: "14px" }}>
        <div className="fld">
          <label htmlFor="qm-id">{ICON_NGUOI} Số điện thoại hoặc email</label>
          {/* inputMode="email" chứ không phải "tel" — xem ghi chú ở /login (P3). */}
          <input
            id="qm-id"
            className="inp"
            type="text"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            disabled={step === "verify" || pending}
            placeholder="VD: 09xx xxx xxx"
          />
        </div>

        {step === "identify" && (
          <>
            <button type="button" className="btn btn-acc" onClick={sendOtp} disabled={pending || !identifier} style={{ width: "100%", minHeight: "54px", fontSize: "16px" }}>
              {pending ? "Đang gửi…" : "Gửi mã đặt lại"}
            </button>
            {/* Bù cho việc bịt oracle liệt kê (P0 §3.4): hệ thống luôn trả cùng một câu nên không nói được "tài khoản không tồn tại / chưa kích hoạt". */}
            <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
              Vì lý do bảo mật, hệ thống luôn báo đã gửi mã. Nếu tài khoản <b style={{ color: "var(--text)" }}>chưa được kích hoạt</b>, hãy dùng{" "}
              <Link href="/kich-hoat" style={{ fontWeight: "700" }} title="Kích hoạt tài khoản">
                Kích hoạt tài khoản
              </Link>{" "}
              thay vì màn này. Không nhận được mã sau vài phút, xin liên hệ trung tâm.
            </p>
          </>
        )}

        {step === "verify" && (
          <>
            {/* Mã + mật khẩu mới nằm CÙNG màn — ràng buộc của QĐ P0-a (verifyAndConsumeOtp nguyên tử, không có bước trung gian). */}
            <OtpSauO value={code} onChange={setCode} nhan="Mã OTP (6 số gửi qua Zalo hoặc email)" />
            <p style={{ margin: "0", fontSize: "14px", color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>
              {cooldown > 0 ? (
                <span>
                  Gửi lại sau{" "}
                  <b className="mono" style={{ color: "var(--accT)" }}>
                    {cooldown}s
                  </b>
                </span>
              ) : (
                <button type="button" className="linkbtn" onClick={resend} disabled={pending}>
                  Gửi lại mã
                </button>
              )}
              <button
                type="button"
                className="linkbtn"
                onClick={() => {
                  setStep("identify");
                  setCode("");
                  setPassword("");
                  setCooldown(0);
                }}
              >
                ← Đổi tài khoản
              </button>
            </p>
            <div className="fld">
              <label htmlFor="qm-mk">{ICON_KHIEN} Mật khẩu mới (≥ 8 ký tự)</label>
              <OMatKhau id="qm-mk" value={password} onChange={setPassword} autoComplete="new-password" placeholder="Ít nhất 8 ký tự" hienDoManh ghiChuDoManh="" />
            </div>
            <button
              type="button"
              className="btn btn-acc"
              onClick={submit}
              disabled={pending || code.length !== 6 || password.length < 8}
              style={{ width: "100%", minHeight: "54px", fontSize: "16px" }}
            >
              {pending ? "Đang đặt lại…" : "Đặt lại mật khẩu"}
            </button>
          </>
        )}
      </div>
      <p style={{ margin: "18px 0 0", textAlign: "center", color: "var(--muted)" }}>
        Nhớ ra rồi?{" "}
        <Link href="/login" style={{ fontWeight: "700" }} title="Đăng nhập">
          Quay lại đăng nhập
        </Link>
      </p>
    </>
  );
}
