"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle, ArrowRight } from "lucide-react";
import { SATA_ROBO_PHONE } from "@/lib/locations";

// Hide on legacy course landings (they have their own floating CTAs).
const HIDDEN_PREFIXES = ["/khoa-hoc/laptrinhrobot", "/khoa-hoc/luyenthirobosim", "/admin", "/login"];

export function FloatingCta() {
  const pathname = usePathname();
  if (pathname && HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <div className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-40 hidden lg:flex flex-col items-end gap-3 pointer-events-none">
      {/* Zalo chat — MỘT nút cho cả công ty (trước 24/09/2026 là 1 nút mỗi cơ sở) */}
      <a
        href={SATA_ROBO_PHONE.zalo}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat Zalo Sata Robo"
        className="relative pointer-events-auto group inline-flex h-14 items-center gap-2 rounded-full bg-[#0068FF] pl-4 pr-5 text-white shadow-2xl shadow-blue-500/40 hover:shadow-blue-500/60 hover:scale-105 active:scale-95 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none"
      >
        <MessageCircle className="h-6 w-6 relative shrink-0" />
        <span className="text-sm font-bold leading-tight">Chat Zalo</span>
      </a>

      {/* Primary CTA pill */}
      <Link
        href="/lien-he?free-trial=true"
        className="cta-pulse cta-shine pointer-events-auto inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-5 py-3 text-sm font-bold text-white hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:outline-none"
      >
        Học thử 1-1 miễn phí
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
