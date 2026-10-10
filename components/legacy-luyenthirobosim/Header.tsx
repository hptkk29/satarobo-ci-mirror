"use client";

import { useState } from "react";
import Image from "next/image";
import useScrollPosition from "./_hooks/useScrollPosition";
import { trackAndRedirect } from "./_utils/tracking";

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollY = useScrollPosition();
  const isScrolled = scrollY > 60;
  const isBarHidden = scrollY > 150;

  return (
    <header
      className={[
        "lp-header",
        isScrolled ? "lp-header--scrolled" : "",
        isBarHidden ? "lp-header--bar-hidden" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="banner"
    >
      <div className="container lp-header__inner">
        <a href="/" className="lp-header__logo" aria-label="Sata Robo — Trang chủ">
          <Image
            src="/brand/logo-satarobo.jpg"
            alt="Logo Sata Robo"
            width={80}
            height={48}
            className="h-12 w-auto object-contain"
          />
        </a>

        <nav className="lp-header__nav" aria-label="Điều hướng chính">
          <a href="#pain" className="lp-header__link">Vấn đề</a>
          <a href="#courses" className="lp-header__link">Khoá học</a>
          <a href="#roadmap" className="lp-header__link">Lộ trình</a>
          <a href="#faq" className="lp-header__link">FAQ</a>
          <button
            onClick={() => trackAndRedirect("R1", "header_R1")}
            className="btn btn-r1 btn-sm cta-shine"
            aria-label="Đăng ký Khoá R1 cho Tiểu học"
          >
            Đăng Ký R1
          </button>
          <button
            onClick={() => trackAndRedirect("R2", "header_R2")}
            className="btn btn-r2 btn-sm cta-shine"
            aria-label="Đăng ký Khoá R2 cho THCS"
          >
            Đăng Ký R2
          </button>
        </nav>

        <button
          className={`hamburger${menuOpen ? " open" : ""}`}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? "Đóng menu" : "Mở menu"}
          aria-expanded={menuOpen}
        >
          <span /><span /><span />
        </button>
      </div>

      {menuOpen && (
        <nav className="lp-header__mobile-nav" aria-label="Điều hướng mobile">
          <a href="#pain" className="lp-header__mobile-link" onClick={() => setMenuOpen(false)}>Vấn đề</a>
          <a href="#courses" className="lp-header__mobile-link" onClick={() => setMenuOpen(false)}>Khoá học</a>
          <a href="#roadmap" className="lp-header__mobile-link" onClick={() => setMenuOpen(false)}>Lộ trình</a>
          <a href="#faq" className="lp-header__mobile-link" onClick={() => setMenuOpen(false)}>FAQ</a>
          <button
            onClick={() => {
              trackAndRedirect("R1", "header_R1");
              setMenuOpen(false);
            }}
            className="btn btn-r1 cta-shine"
          >
            🟦 Đăng ký BẢNG R1 — 490k
          </button>
          <button
            onClick={() => {
              trackAndRedirect("R2", "header_R2");
              setMenuOpen(false);
            }}
            className="btn btn-r2 cta-shine"
          >
            🟪 Đăng ký BẢNG R2 — 490k
          </button>
        </nav>
      )}
    </header>
  );
}
