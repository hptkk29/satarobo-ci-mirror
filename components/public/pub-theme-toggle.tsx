"use client";

import { useEffect, useState } from "react";
import { datChuDe, dongBoChuDeDaLuu, type PubTheme } from "@/components/public/pub-theme";

/** Nút đổi sáng/tối ở thanh trên. Trạng thái đọc từ class của `.sr-pub` (script chống nháy đã đặt). */
export function PubThemeToggle() {
  const [theme, setTheme] = useState<PubTheme>("light");

  useEffect(() => {
    dongBoChuDeDaLuu();
    const root = document.querySelector<HTMLElement>(".sr-pub");
    if (!root) return;
    const doc = () => setTheme(root.classList.contains("theme-dark") ? "dark" : "light");
    doc();
    const mo = new MutationObserver(doc);
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  const label = theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối";
  return (
    <button
      type="button"
      onClick={() => datChuDe(theme === "dark" ? "light" : "dark")}
      aria-label={label}
      title={label}
      style={{
        width: 44,
        height: 44,
        borderRadius: 12,
        border: "1.5px solid var(--line2)",
        background: "transparent",
        color: "var(--text)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {theme === "dark" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
