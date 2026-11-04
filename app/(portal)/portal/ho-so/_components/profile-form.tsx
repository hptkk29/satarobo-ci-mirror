"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  updateParentName,
  changeParentPassword,
  requestParentPhoneChangeOtp,
  confirmParentPhoneChangeAction,
} from "../actions";

const inputCls =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none";

export function ProfileForm({
  email,
  phone,
  initialName,
}: {
  email: string;
  phone: string;
  initialName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [savingName, startName] = useTransition();

  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [cf, setCf] = useState("");
  const [savingPw, startPw] = useTransition();

  // AUTH-SĐT P6 — đổi SĐT đăng nhập: 2 bước, mã gửi tới SỐ MỚI.
  const [newPhone, setNewPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneStep, setPhoneStep] = useState<"idle" | "verify">("idle");
  const [savingPhone, startPhone] = useTransition();

  function sendPhoneOtp() {
    startPhone(async () => {
      const res = await requestParentPhoneChangeOtp(newPhone);
      if (res.ok) {
        toast.success("Đã gửi mã tới số mới qua Zalo.");
        setPhoneStep("verify");
      } else toast.error(res.error ?? "Lỗi gửi mã");
    });
  }

  function confirmPhone() {
    startPhone(async () => {
      const res = await confirmParentPhoneChangeAction({
        newPhone,
        code: phoneCode,
      });
      if (res.ok) {
        toast.success("Đã đổi số điện thoại đăng nhập.");
        setPhoneStep("idle");
        setNewPhone("");
        setPhoneCode("");
        router.refresh();
      } else toast.error(res.error ?? "Lỗi đổi số điện thoại");
    });
  }

  function saveName() {
    startName(async () => {
      const res = await updateParentName(name);
      if (res.ok) {
        toast.success("Đã cập nhật tên");
        router.refresh();
      } else toast.error(res.error ?? "Lỗi");
    });
  }

  function savePw() {
    startPw(async () => {
      const res = await changeParentPassword({
        currentPassword: cur,
        newPassword: nw,
        confirmPassword: cf,
      });
      if (res.ok) {
        // tokenVersion đã tăng — mọi phiên (kể cả phiên này) sẽ bị đá ở lần
        // request sau. Chủ động đưa qua /dang-xuat để dọn cookie sạch rồi đăng
        // nhập lại bằng mật khẩu mới, thay vì để văng giữa chừng khó hiểu.
        toast.success("Đã đổi mật khẩu — đăng nhập lại bằng mật khẩu mới");
        setTimeout(() => {
          window.location.assign("/dang-xuat?reason=password-changed");
        }, 1200);
      } else toast.error(res.error ?? "Lỗi đổi mật khẩu");
    });
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-neutral-700">
          Thông tin tài khoản
        </h2>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            Số điện thoại đăng nhập
          </span>
          <input
            value={phone || "— chưa có —"}
            disabled
            className={`${inputCls} bg-neutral-50`}
          />
        </label>
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            Email{" "}
            <span className="font-normal text-neutral-500">
              (kênh dự phòng)
            </span>
          </span>
          <input
            value={email || "— chưa có —"}
            disabled
            className={`${inputCls} bg-neutral-50`}
          />
        </label>
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            Tên hiển thị
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </label>
        <button
          type="button"
          onClick={saveName}
          disabled={savingName}
          className="mt-3 rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-60"
        >
          Lưu
        </button>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-neutral-700">
          Đổi số điện thoại đăng nhập
        </h2>
        <p className="mb-3 text-xs leading-relaxed text-neutral-500">
          Mã xác thực gửi tới <strong className="font-medium">số mới</strong> —
          quý phụ huynh cần đang giữ số đó. Sau khi đổi, đăng nhập bằng số mới.
        </p>
        <div className="space-y-3">
          <input
            type="text"
            inputMode="tel"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            disabled={phoneStep === "verify" || savingPhone}
            placeholder="Số điện thoại mới"
            className={inputCls}
          />
          {phoneStep === "verify" && (
            <input
              inputMode="numeric"
              value={phoneCode}
              onChange={(e) =>
                setPhoneCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="Mã 6 số vừa nhận"
              className={`${inputCls} tracking-[0.3em]`}
            />
          )}
        </div>
        {phoneStep === "idle" ? (
          <button
            type="button"
            onClick={sendPhoneOtp}
            disabled={savingPhone || !newPhone.trim()}
            className="mt-3 rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-60"
          >
            {savingPhone ? "Đang gửi…" : "Gửi mã tới số mới"}
          </button>
        ) : (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={confirmPhone}
              disabled={savingPhone || phoneCode.length !== 6}
              className="rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-60"
            >
              {savingPhone ? "Đang đổi…" : "Xác nhận đổi số"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPhoneStep("idle");
                setPhoneCode("");
              }}
              disabled={savingPhone}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-60"
            >
              Huỷ
            </button>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-neutral-700">
          Đổi mật khẩu
        </h2>
        <div className="space-y-3">
          <input
            type="password"
            value={cur}
            onChange={(e) => setCur(e.target.value)}
            placeholder="Mật khẩu hiện tại"
            className={inputCls}
          />
          <input
            type="password"
            value={nw}
            onChange={(e) => setNw(e.target.value)}
            placeholder="Mật khẩu mới (≥ 8 ký tự)"
            className={inputCls}
          />
          <input
            type="password"
            value={cf}
            onChange={(e) => setCf(e.target.value)}
            placeholder="Xác nhận mật khẩu mới"
            className={inputCls}
          />
        </div>
        <button
          type="button"
          onClick={savePw}
          disabled={savingPw}
          className="mt-3 rounded-lg bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white hover:bg-purple-800 disabled:opacity-60"
        >
          Đổi mật khẩu
        </button>
      </section>
    </div>
  );
}
