"use client";

import { useRef } from "react";

// Mã 6 số CHÉP từ artifact: `.otp` gồm 6 ô `input` (maxLength 1, `one-time-code`). Thêm hai thứ artifact không cần:
//  · dán / gõ cả chuỗi vào MỘT ô (kể cả `fill()` của e2e, gợi ý mã tự điền của điện thoại) ⇒ trải ra 6 ô;
//  · Backspace lùi về ô trước, ←/→ đổi ô.
// Ô đầu mang nhãn truy cập `nhan` ("Mã OTP (6 số gửi qua Zalo hoặc email)") để e2e/trình đọc màn hình tìm được; 5 ô còn lại "Chữ số n".
export function OtpSauO({ value, onChange, nhan, disabled }: { value: string; onChange: (v: string) => void; nhan: string; disabled?: boolean }) {
  const o = useRef<Array<HTMLInputElement | null>>([]);
  const chuSo = (i: number) => value[i] ?? "";
  const focus = (i: number) => o.current[Math.max(0, Math.min(5, i))]?.focus();

  function ghi(i: number, raw: string) {
    const so = raw.replace(/\D/g, "");
    if (!so) {
      onChange(value.slice(0, i) + value.slice(i + 1));
      return;
    }
    const mang = value.padEnd(6, " ").split("");
    for (let k = 0; k < so.length && i + k < 6; k++) mang[i + k] = so[k]!;
    onChange(mang.join("").replace(/ +$/g, "").replace(/ /g, ""));
    focus(Math.min(5, i + so.length));
  }

  return (
    <div className="otp">
      {Array.from({ length: 6 }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            o.current[i] = el;
          }}
          inputMode="numeric"
          maxLength={i === 0 ? 6 : 1}
          aria-label={i === 0 ? nhan : `Chữ số ${i + 1}`}
          autoComplete="one-time-code"
          value={chuSo(i)}
          disabled={disabled}
          onChange={(e) => ghi(i, e.target.value)}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (/\d/.test(t)) {
              e.preventDefault();
              ghi(i, t);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !chuSo(i) && i > 0) {
              e.preventDefault();
              onChange(value.slice(0, i - 1));
              focus(i - 1);
            } else if (e.key === "ArrowLeft") focus(i - 1);
            else if (e.key === "ArrowRight") focus(i + 1);
          }}
        />
      ))}
    </div>
  );
}
