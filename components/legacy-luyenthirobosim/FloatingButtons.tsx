"use client";

import useScrollPosition from "./_hooks/useScrollPosition";
import { trackAndRedirect } from "./_utils/tracking";
import { SATA_ROBO_PHONE } from "@/lib/locations";

export default function FloatingButtons() {
  const scrollY = useScrollPosition();
  const isVisible = scrollY > 600;

  return (
    <div
      className={`lp-floating${isVisible ? " lp-floating--visible" : ""}`}
      aria-label="Đăng ký nhanh"
    >
      <button
        onClick={() => trackAndRedirect("R1", "floating_R1")}
        className="lp-floating__btn lp-floating__btn--r1 cta-shine"
        aria-label="Đăng ký Khoá R1 cho Tiểu học — 490.000đ"
      >
        🟦 Đăng ký R1
      </button>
      <button
        onClick={() => trackAndRedirect("R2", "floating_R2")}
        className="lp-floating__btn lp-floating__btn--r2 cta-shine"
        aria-label="Đăng ký Khoá R2 cho THCS — 490.000đ"
      >
        🟪 Đăng ký R2
      </button>
      <a
        href={SATA_ROBO_PHONE.zalo}
        target="_blank"
        rel="noopener noreferrer"
        className="lp-floating__btn lp-floating__btn--zalo"
        aria-label="Chat Zalo Sata Robo"
      >
        💬 Zalo
      </a>
    </div>
  );
}
