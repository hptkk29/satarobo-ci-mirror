"use client";

import { useState } from "react";
import { doManhMatKhau } from "@/lib/auth/do-manh-mat-khau";

// Ô mật khẩu CHÉP từ artifact: `.pw > input.inp + button` (con mắt) và `.meter` đo độ mạnh (chỉ gợi ý — luật thật ở máy chủ).
// aria-label của nút là "Hiện ký tự"/"Ẩn ký tự" (không phải "…mật khẩu"): e2e dùng getByLabel("Mật khẩu") và nút không được khớp theo.
export function OMatKhau({
  id,
  value,
  onChange,
  autoComplete,
  invalid,
  disabled,
  placeholder,
  hienDoManh = false,
  ghiChuDoManh = "nên có chữ hoa, số và ký tự đặc biệt",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  hienDoManh?: boolean;
  ghiChuDoManh?: string;
}) {
  const [hien, setHien] = useState(false);
  const dm = doManhMatKhau(value);
  return (
    <>
      <div className="pw">
        <input
          id={id}
          className="inp"
          type={hien ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder ?? "••••••••"}
          value={value}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" onClick={() => setHien((v) => !v)} aria-label={hien ? "Ẩn ký tự" : "Hiện ký tự"} aria-pressed={hien}>
          {hien ? (
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
      {hienDoManh ? (
        <>
          <div className="meter" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className={i <= dm.diem ? `on${dm.diem}` : ""}></span>
            ))}
          </div>
          <span style={{ fontSize: "13px", color: "var(--muted)" }} role="status">
            {dm.nhan} · {ghiChuDoManh}
          </span>
        </>
      ) : null}
    </>
  );
}
