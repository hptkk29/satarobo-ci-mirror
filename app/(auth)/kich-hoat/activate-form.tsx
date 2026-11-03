"use client";

import { useState, useEffect, useTransition } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { OTichChinhSach } from "@/components/public/o-tich-chinh-sach";
import { requestActivationOtp, activateAccount } from "./_actions";

export function ActivateForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"identify" | "verify" | "done">("identify");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  // ĐẶT MẬT KHẨU 2 BƯỚC (04/09, chủ dự án). Trước đó chỉ có MỘT ô password và
  // không có cách nào nhìn lại đã gõ gì: phụ huynh gõ sai một ký tự là kích hoạt xong
  // với mật khẩu mình không biết, phải đi đặt lại — mà mã OTP thì đã tiêu.
  const [password2, setPassword2] = useState("");
  // Mỗi ô MỘT con mắt riêng, bật/tắt độc lập (chủ dự án 04/09): mở ô trên để đọc
  // lại chuỗi vừa đặt trong khi ô dưới vẫn che, hoặc ngược lại.
  const [hienMk1, setHienMk1] = useState(false);
  const [hienMk2, setHienMk2] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  // Hồ sơ BCT mục 3 — mặc định CHƯA tích (ảnh minh hoạ vẽ ô vuông rỗng).
  const [dongYCsbm, setDongYCsbm] = useState(false);

  // Đếm ngược cooldown gửi lại.
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

  // Hai ô khớp nhau chưa — Tính Ở ĐÂY (không rải trong JSX) để nút bấm và dòng báo
  // lỗi không thể nói ngược nhau.
  const duMinh = password.length >= 8;
  const khopNhau = password2.length > 0 && password === password2;
  const lechMk = password2.length > 0 && password !== password2;

  const inputCls =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none";

  if (step === "done") {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-gray-600">
          Tài khoản đã được kích hoạt. Đăng nhập bằng số điện thoại (hoặc email) và mật khẩu vừa đặt.
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
        {/* AUTH-SĐT P5 — cùng lựa chọn với ô định danh ở /login (P3):
            inputMode="email" chứ KHÔNG phải "tel". Bàn phím tel trên mobile
            không có chữ cái nên phụ huynh dùng email sẽ không gõ nổi. */}
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
          {/* Hồ sơ BCT mục 3 — ảnh minh hoạ chụp ĐÚNG màn này.
              Đặt ở BƯỚC 1 (không phải bước nhập mã) vì dữ liệu cá nhân của phụ huynh bắt
              đầu rời trình duyệt ngay khi bấm "Gửi mã kích hoạt". */}
          <OTichChinhSach
            checked={dongYCsbm}
            onChange={(e) => setDongYCsbm(e.target.checked)}
            disabled={pending}
            wrapperClassName="text-gray-500"
          />
          <button
            type="button"
            onClick={sendOtp}
            disabled={pending || !identifier || !dongYCsbm}
            className="w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
          >
            {pending ? "Đang gửi…" : "Gửi mã kích hoạt"}
          </button>
          {/* AUTH-SĐT P0 §3.4 — bù cho việc bịt oracle liệt kê tài khoản: hệ thống
              luôn trả cùng một câu nên không còn nói được "tài khoản đã kích hoạt".
              Dòng tĩnh này thay thế thông điệp đó (chốt 29/07). */}
          <p className="text-xs leading-relaxed text-gray-500">
            Vì lý do bảo mật, hệ thống luôn báo đã gửi mã. Nếu tài khoản của quý phụ huynh{" "}
            <strong className="font-medium text-gray-600">đã kích hoạt trước đó</strong>, vui lòng đăng
            nhập bằng mật khẩu đã đặt. Không nhận được mã sau vài phút, xin liên hệ trung tâm.
          </p>
        </>
      )}

      {step === "verify" && (
        <>
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
            <span className="mb-1 block text-xs font-medium text-gray-500">Đặt mật khẩu (≥ 8 ký tự)</span>
            <OMatKhau
              value={password}
              onChange={setPassword}
              hien={hienMk1}
              onToggle={() => setHienMk1((v) => !v)}
              inputCls={inputCls}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Nhập lại mật khẩu</span>
            <OMatKhau
              value={password2}
              onChange={setPassword2}
              hien={hienMk2}
              onToggle={() => setHienMk2((v) => !v)}
              inputCls={`${inputCls} ${lechMk ? "border-red-400" : ""}`}
              invalid={lechMk}
            />
            {lechMk && (
              <span className="mt-1 block text-xs text-red-600">
                Hai lần nhập chưa giống nhau.
              </span>
            )}
          </label>
          <button
            type="button"
            onClick={activate}
            disabled={pending || code.length !== 6 || !duMinh || !khopNhau}
            className="w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
          >
            {pending ? "Đang kích hoạt…" : "Kích hoạt & đặt mật khẩu"}
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

/**
 * Ô mật khẩu kèm con mắt riêng của nó.
 *
 * Tách ra vì hai ô giống hệt nhau trừ trạng thái ẩn/hiện — chép hai lần thì lần sửa
 * sau chỉ đụng một bản, đúng kiểu lệch mà người dùng không bao giờ báo vì nó chỉ
 * là "ô kia không bấm được".
 */
function OMatKhau({
  value,
  onChange,
  hien,
  onToggle,
  inputCls,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  hien: boolean;
  onToggle: () => void;
  inputCls: string;
  invalid?: boolean;
}) {
  return (
    <div className="relative">
      <input
        type={hien ? "text" : "password"}
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        className={`${inputCls} pr-10`}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={hien ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
        aria-pressed={hien}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-gray-400 hover:text-gray-600 focus-visible:outline-2 focus-visible:outline-orange-400"
      >
        {hien ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
