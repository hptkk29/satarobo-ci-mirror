"use client";

import { useState } from "react";
import Image from "next/image";
import { Menu, X, MessageCircle } from "lucide-react";
import { SATA_ROBO_PHONE } from "@/lib/locations";

// Phase 4.UI.FIX.3 PART E — UPDATED mobile menu "4 cơ sở" → "2 cơ sở"

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMobileOpen(false);
  };

  return (
    <header className="relative z-[60] border-b border-gray-100 bg-white/95 shadow-sm backdrop-blur transition-all duration-300">
      <div className="container-site">
        <div className="flex items-center justify-between h-16 sm:h-18">
          <a href="/" className="flex items-center no-tap-highlight" aria-label="Sata Robo">
            <Image
              src="/brand/logo-satarobo.jpg"
              alt="Sata Robo"
              className="h-11 sm:h-14 w-auto object-contain"
              width={180}
              height={56}
            />
          </a>

          <nav className="hidden lg:flex items-center gap-7">
            <button onClick={() => scrollTo("roadmap")} className="text-sm font-semibold text-text-dark hover:text-primary-orange transition">Lộ trình</button>
            <button onClick={() => scrollTo("locations")} className="text-sm font-semibold text-text-dark hover:text-primary-orange transition">Các cơ sở</button>
            <button onClick={() => scrollTo("commitment")} className="text-sm font-semibold text-text-dark hover:text-primary-orange transition">Cam kết</button>
            <button onClick={() => scrollTo("gifts")} className="text-sm font-semibold text-text-dark hover:text-primary-orange transition">Quà tặng</button>
            <button onClick={() => scrollTo("faq")} className="text-sm font-semibold text-text-dark hover:text-primary-orange transition">FAQ</button>
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <a
              href={SATA_ROBO_PHONE.zalo}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold text-primary-purple border-2 border-primary-purple rounded-lg hover:bg-primary-purple hover:text-white transition"
            >
              <MessageCircle className="w-4 h-4" />
              Zalo
            </a>
            <button
              onClick={() => scrollTo("registration-form")}
              className="cta-pulse cta-shine px-4 py-2 bg-primary-orange text-white text-sm font-bold rounded-lg hover:bg-primary-orange-dark transition"
            >
              Học thử 1-1 miễn phí →
            </button>
          </div>

          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden p-2 text-text-dark"
            aria-label="Menu"
          >
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {mobileOpen && (
          <div className="lg:hidden py-4 border-t border-gray-100 animate-fade-in">
            <nav className="flex flex-col gap-1">
              <button onClick={() => scrollTo("roadmap")} className="text-left px-2 py-3 text-sm font-semibold text-text-dark hover:bg-soft-cream rounded-lg">Lộ trình 5 năm</button>
              <button onClick={() => scrollTo("locations")} className="text-left px-2 py-3 text-sm font-semibold text-text-dark hover:bg-soft-cream rounded-lg">2 cơ sở</button>
              <button onClick={() => scrollTo("commitment")} className="text-left px-2 py-3 text-sm font-semibold text-text-dark hover:bg-soft-cream rounded-lg">Cam kết minh bạch</button>
              <button onClick={() => scrollTo("gifts")} className="text-left px-2 py-3 text-sm font-semibold text-text-dark hover:bg-soft-cream rounded-lg">Quà tặng</button>
              <button onClick={() => scrollTo("faq")} className="text-left px-2 py-3 text-sm font-semibold text-text-dark hover:bg-soft-cream rounded-lg">FAQ</button>
              <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-gray-100">
                <a
                  href={SATA_ROBO_PHONE.zalo}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-3 text-center text-sm font-bold text-primary-purple border-2 border-primary-purple rounded-lg"
                >
                  💬 Chat Zalo
                </a>
                <button
                  onClick={() => scrollTo("registration-form")}
                  className="cta-pulse cta-shine px-4 py-3 bg-primary-orange text-white text-sm font-bold rounded-lg"
                >
                  🎯 Học thử 1-1 miễn phí →
                </button>
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
