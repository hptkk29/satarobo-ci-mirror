"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Phone, ArrowRight, LogIn } from "lucide-react";
import { usePathname } from "next/navigation";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { MobileNavDrawer } from "@/components/sections/mobile-nav-drawer";

const NAV_LINKS = [
  { label: "Trang chủ", href: "/" },
  { label: "Về chúng tôi", href: "/ve-chung-toi" },
  { label: "Khoá học", href: "/khoa-hoc" },
  // Ẩn tạm theo hồ sơ BCT mục 4 (sản phẩm không công khai giá + không đặt hàng được) —
  // trang 404 bằng app/(public)/hoc-cu/layout.tsx. Bỏ comment khi bật lại.
  // { label: "Học cụ", href: "/hoc-cu" },
  { label: "Tin tức", href: "/tin-tuc" },
  // Hidden temporarily — re-enable along with /vinh-danh pages when ready.
  // { label: "Vinh danh", href: "/vinh-danh" },
  { label: "Tuyển dụng", href: "/tuyen-dung" },
  { label: "Liên hệ", href: "/lien-he" },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Server-side + first client render đều return false để SSR markup khớp
  // hydration → tránh React mismatch (homepage static với revalidate=60,
  // pathname mismatch lúc hydrate đổi class + thêm span underline cho
  // active link). Sau khi mounted, isActive trả về kết quả thật.
  const isActive = (href: string) => {
    if (!mounted) return false;
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  };

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-white/90 backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.04)] border-b border-neutral-200/60"
          : "bg-white/60 backdrop-blur border-b border-transparent"
      }`}
    >
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        {/* Logo */}
        <Link
          href="/"
          aria-label="Sata Robo — Trang chủ"
          className="flex items-center focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:outline-none rounded-md"
        >
          <Image
            src="/brand/logo-satarobo.jpg"
            alt="Sata Robo"
            width={160}
            height={48}
            priority
            className="h-9 w-auto object-contain"
          />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-1">
          {NAV_LINKS.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative px-3 py-2 text-sm font-semibold rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:outline-none ${
                  active
                    ? "text-orange-600"
                    : "text-neutral-600 hover:text-orange-600 hover:bg-orange-50/60"
                }`}
              >
                {link.label}
                {active && (
                  <span className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-gradient-to-r from-orange-500 to-purple-600" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Desktop CTA — MỘT số cho cả công ty (trước 24/09/2026 là 2 số, 2 cơ sở) */}
        <div className="hidden lg:flex items-center gap-3">
          <div className="hidden xl:flex flex-col gap-0.5">
            <a
              href={`tel:${SATA_ROBO_PHONE.tho}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-600 hover:text-orange-600 transition-colors"
            >
              <Phone className="h-3.5 w-3.5" />
              {SATA_ROBO_PHONE.hien}
            </a>
          </div>
          <Link
            href="/lien-he?free-trial=true"
            className="cta-pulse cta-shine inline-flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-4 py-2 rounded-xl hover:-translate-y-0.5 transition-transform duration-200 focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:outline-none"
          >
            Đặt buổi học thử
            <ArrowRight className="h-4 w-4" />
          </Link>
          {/* Đăng nhập — tím thương hiệu nhạt hơn (violet-500), cỡ chữ = nút tư vấn */}
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 bg-violet-500 hover:bg-violet-600 text-white text-sm font-bold px-4 py-2 rounded-xl shadow-lg shadow-violet-500/30 hover:shadow-xl hover:shadow-violet-500/40 hover:-translate-y-0.5 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:outline-none"
          >
            <LogIn className="h-4 w-4" />
            Đăng nhập
          </Link>
        </div>

        {/* Mobile: F-UI-4 drawer (replaced shadcn Sheet) */}
        <MobileNavDrawer />
      </div>
    </header>
  );
}
