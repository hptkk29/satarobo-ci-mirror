"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { OTichChinhSach } from "@/components/public/o-tich-chinh-sach";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { OMatKhau } from "@/components/public/xac-thuc/o-mat-khau";
import { OtpSauO } from "@/components/public/xac-thuc/otp-sau-o";
import { useBuoc } from "@/components/public/xac-thuc/buoc-xac-thuc";
import { requestActivationOtp, activateAccount } from "./_actions";

// Markup CHÉP từ artifact "Activate" (h1 + `.otp` + `.linkbtn` + `.btn-acc` + `.success`); thanh bước 1·2·3 do trang dựng (BuocProvider).
// GIỮ NGUYÊN luồng thật: bước 1 nhập SĐT/email + ô tích chính sách (BCT) → gửi mã; bước 2 mã OTP + mật khẩu (2 ô) → kích hoạt; bước 3 xong.
//
// KHÔNG vẽ "Nhận mã qua: Zalo / SMS / Email" (`.pill-tabs`): hệ thống tự chọn kênh (Zalo, hoặc email) — không có lựa chọn nào của người dùng
// để ghi. Artifact chỉ có bước nhập mã; bước 1 (nhập SĐT/email) và bước đặt mật khẩu dùng lại đúng các lớp `.fld`/`.inp`/`.pw`/`.meter`.
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

export function ActivateForm() {
  const router = useRouter();
  const { datBuoc } = useBuoc();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"identify" | "verify" | "done">("identify");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  // ĐẶT MẬT KHẨU 2 BƯỚC (04/09, chủ dự án): gõ sai một ký tự là kích hoạt xong với mật khẩu mình không biết, mà mã OTP thì đã tiêu.
  const [password2, setPassword2] = useState("");
  const [cooldown, setCooldown] = useState(0);
  // Hồ sơ BCT mục 3 — mặc định CHƯA tích (ảnh minh hoạ vẽ ô vuông rỗng).
  const [dongYCsbm, setDongYCsbm] = useState(false);

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
      const res = await requestActivationOtp(identifier);
      if (res.ok) {
        toast.success("Đã gửi mã kích hoạt qua Zalo hoặc email (nếu hợp lệ).");
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

  function activate() {
    startTransition(async () => {
      const res = await activateAccount({ identifier, code, password });
      if (res.ok) {
        toast.success("Kích hoạt thành công! Bạn có thể đăng nhập.");
        setStep("done");
      } else toast.error(res.error ?? "Lỗi kích hoạt");
    });
  }

  // Hai ô khớp nhau chưa — tính Ở ĐÂY (không rải trong JSX) để nút bấm và dòng báo lỗi không thể nói ngược nhau.
  const duMinh = password.length >= 8;
  const khopNhau = password2.length > 0 && password === password2;
  const lechMk = password2.length > 0 && password !== password2;

  if (step === "done") {
    return (
      <div className="success">
        <div className="burst">
          <PubAnh id="da847c40d631e0b7a535a73c3172ac50" alt="" sizes="170px" />
        </div>
        <h1>
          Tài khoản <span className="grad">đã sẵn sàng!</span>
        </h1>
        <p style={{ margin: "0", color: "var(--muted)" }}>Tài khoản đã được kích hoạt. Đăng nhập bằng số điện thoại (hoặc email) và mật khẩu vừa đặt.</p>
        <button type="button" className="btn btn-acc" onClick={() => router.push("/login")} style={{ width: "100%", minHeight: "52px" }}>
          Đến trang đăng nhập
        </button>
      </div>
    );
  }

  return (
    <>
      <h1>
        Kích hoạt <span className="grad">tài khoản</span>
      </h1>
      {step === "identify" ? (
        <p style={{ margin: "6px 0 18px", color: "var(--muted)" }}>Dành cho phụ huynh mới nhận tài khoản từ trung tâm.</p>
      ) : (
        <p style={{ margin: "6px 0 14px", color: "var(--muted)" }}>
          Nhập mã 6 số Sata Robo vừa gửi tới <b style={{ color: "var(--text)" }}>{identifier}</b> qua Zalo hoặc email.
        </p>
      )}

      <div style={{ display: "grid", gap: "14px" }}>
        <div className="fld">
          <label htmlFor="kh-id">
            {ICON_NGUOI} Số điện thoại hoặc Email
          </label>
          {/* AUTH-SĐT P5 — cùng lựa chọn với ô định danh ở /login (P3): inputMode="email" chứ KHÔNG phải "tel" (bàn phím tel
              không có chữ cái nên phụ huynh dùng email sẽ không gõ nổi). */}
          <input
            id="kh-id"
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
            placeholder="0905123456"
          />
        </div>

        {step === "identify" && (
          <>
            {/* Hồ sơ BCT mục 3 — ảnh minh hoạ chụp ĐÚNG màn này. Đặt ở BƯỚC 1 vì dữ liệu cá nhân của phụ huynh bắt đầu rời trình duyệt
                ngay khi bấm "Gửi mã kích hoạt". */}
            <OTichChinhSach checked={dongYCsbm} onChange={(e) => setDongYCsbm(e.target.checked)} disabled={pending} wrapperClassName="" />
            <button
              type="button"
              onClick={sendOtp}
              disabled={pending || !identifier || !dongYCsbm}
              className="btn btn-acc"
              style={{ width: "100%", minHeight: "54px", fontSize: "16px" }}
            >
              {pending ? "Đang gửi…" : "Gửi mã kích hoạt"}
            </button>
            {/* AUTH-SĐT P0 §3.4 — bù cho việc bịt oracle liệt kê tài khoản: hệ thống luôn trả cùng một câu nên không còn nói được
                "tài khoản đã kích hoạt". Dòng tĩnh này thay thế thông điệp đó (chốt 29/07). */}
            <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
              Vì lý do bảo mật, hệ thống luôn báo đã gửi mã. Nếu tài khoản của quý phụ huynh <b style={{ color: "var(--text)" }}>đã kích hoạt trước đó</b>, vui lòng đăng nhập
              bằng mật khẩu đã đặt. Không nhận được mã sau vài phút, xin liên hệ trung tâm.
            </p>
          </>
        )}

        {step === "verify" && (
          <>
            <OtpSauO value={code} onChange={setCode} nhan="Mã OTP (6 số gửi qua Zalo hoặc email)" />
            <p style={{ margin: "0", fontSize: "14px", color: "var(--muted)", display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
              <span>Chưa nhận được mã?</span>
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
            </p>
            <div className="fld">
              <label htmlFor="kh-mk1">
                {ICON_KHIEN} Đặt mật khẩu (≥ 8 ký tự)
              </label>
              <OMatKhau id="kh-mk1" value={password} onChange={setPassword} autoComplete="new-password" hienDoManh />
            </div>
            <div className="fld">
              <label htmlFor="kh-mk2">
                {ICON_KHIEN} Nhập lại mật khẩu
              </label>
              <OMatKhau id="kh-mk2" value={password2} onChange={setPassword2} autoComplete="new-password" invalid={lechMk} />
              {lechMk && (
                <span role="alert" style={{ fontSize: "13px", fontWeight: 700, color: "#ef4444" }}>
                  Hai lần nhập chưa giống nhau.
                </span>
              )}
            </div>
            <button
              type="button"
              className="btn btn-acc"
              onClick={activate}
              disabled={pending || code.length !== 6 || !duMinh || !khopNhau}
              style={{ width: "100%", minHeight: "54px", fontSize: "16px" }}
            >
              {pending ? "Đang kích hoạt…" : "Kích hoạt & đặt mật khẩu"}
            </button>
            <p style={{ margin: "0", textAlign: "center", fontSize: "14px", color: "var(--muted)" }}>
              Nhập sai số điện thoại?{" "}
              <button
                type="button"
                className="linkbtn"
                onClick={() => {
                  setStep("identify");
                  setCode("");
                  setPassword("");
                  setPassword2("");
                  setCooldown(0);
                }}
              >
                Đổi số
              </button>
            </p>
          </>
        )}
      </div>
      <p style={{ margin: "18px 0 0", textAlign: "center", color: "var(--muted)" }}>
        Đã có mật khẩu?{" "}
        <Link href="/login" style={{ fontWeight: "700" }} title="Đăng nhập">
          Đăng nhập
        </Link>
      </p>
    </>
  );
}
