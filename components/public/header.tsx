"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { chenNhomGoc } from "@/lib/public/goc-gia-dinh";
import type { CoCongThongTin } from "@/lib/cong-thong-tin/nav";
import { MobileNavDrawer } from "@/components/sections/mobile-nav-drawer";
import { PubThemeToggle } from "@/components/public/pub-theme-toggle";
import { NhomGocGiaDinh } from "@/components/public/nhom-goc-gia-dinh";

// Thanh trên của giao diện public mới (artifact "Website mới"). Thanh ngang (≥1181px) ở đây; menu điện
// thoại (.mnav) là `MobileNavDrawer` — hai danh sách cùng đi qua `chenNhomGoc` và có lưới canh trôi
// ([PUBLIC-NAV-T02], [GOC-WIRE-*]). DISC · Tủ sách · Sức khỏe gom thành MỘT mục «Góc gia đình» (10/11/2026), chèn theo cờ
// do layout truyền xuống — cờ là prop BẮT BUỘC (luật 11: quên truyền = mục menu biến mất, không lỗi nào báo).
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

const ICON_GUI = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
  </svg>
);

export function Header({ discEnabled, congThongTin }: { discEnabled: boolean; congThongTin: CoCongThongTin }) {
  const navLinks = chenNhomGoc(NAV_LINKS, discEnabled, congThongTin);
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // SSR + lần render đầu đều trả false để HTML khớp lúc hydrate (trang chủ là ISR).
  const isActive = (href: string) => {
    if (!mounted || !pathname) return false;
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  };

  const phone = SATA_ROBO_PHONE;
  return (
    <header style={{ position: "sticky", top: 0, zIndex: 50, background: "var(--glass)", backdropFilter: "blur(14px)", borderBottom: "1px solid var(--line)" }}>
      <nav className="nav wrap" aria-label="Menu chính">
        <Link href="/" aria-label="Sata Robo — Trang chủ" style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          <Image
            src="/pub/7f3174f1b3c85f9cd78c9295c2624fe4.png"
            alt="Logo Sata Robo"
            width={52}
            height={52}
            priority
            style={{ width: 52, height: 52, display: "block", borderRadius: 999, boxShadow: "0 4px 14px rgba(0,0,0,.18)" }}
          />
        </Link>
        <div className="nav-links">
          {navLinks.map((l) => {
            if ("nhom" in l) return <NhomGocGiaDinh key="goc-gia-dinh" nhan={l.label} nhom={l.nhom} />;
            const on = isActive(l.href);
            return (
              <Link key={l.href} href={l.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
                {l.label}
              </Link>
            );
          })}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <a href={`tel:${phone.tho}`} className="mono hide-md" style={{ fontSize: 13, color: "var(--text)", textDecoration: "none", display: "inline-flex", gap: 6, alignItems: "center" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
            </svg>
            {phone.hien}
          </a>
          <PubThemeToggle />
          <Link href="/login" rel="nofollow" className="btn btn-line hide-sm" style={{ minHeight: 44, padding: "0 16px" }}>
            Đăng nhập
          </Link>
          <Link href="/lien-he?free-trial=true" className="btn btn-acc" style={{ minHeight: 44, padding: "0 16px" }}>
            {ICON_GUI}
            <span>Đặt buổi học thử</span>
          </Link>
          <MobileNavDrawer discEnabled={discEnabled} congThongTin={congThongTin} />
        </div>
      </nav>
    </header>
  );
}
