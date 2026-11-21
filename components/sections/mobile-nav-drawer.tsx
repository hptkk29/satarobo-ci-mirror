"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { GIO_LAM_VIEC } from "@/components/public/gio-lam-viec";
import { chenNhomGoc, mucGocDangDung, type MucNhom } from "@/lib/public/goc-gia-dinh";
import type { CoCongThongTin } from "@/lib/cong-thong-tin/nav";
import { BieuTuongGoc } from "@/components/public/goc-bieu-tuong";

// Menu điện thoại (≤1180px) của giao diện public mới: nút ☰ trong thanh trên + bảng `.mnav`
// xổ xuống NGAY dưới thanh trên (artifact "Website mới"). Là nửa mobile của `components/public/header.tsx`
// nên mọi hành động chính của header phải có mặt ở đây (ca [PUBLIC-NAV-T02]).
//
// Khác bản cũ (ngăn kéo phải, portal ra <body>): `.mnav` là `position: absolute` bên trong header dính
// — không còn con `position: fixed` nào bị `backdrop-filter` của header bóp hộp chứa, nên không cần portal.
interface NavItem {
  label: string;
  href: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Trang chủ", href: "/" },
  { label: "Về chúng tôi", href: "/ve-chung-toi" },
  { label: "Khoá học", href: "/khoa-hoc" },
  // Ẩn tạm theo hồ sơ BCT mục 4 — trang 404 bằng app/(public)/hoc-cu/layout.tsx.
  // Bỏ comment CÙNG LÚC với mục tương ứng ở components/public/header.tsx, nếu không ca
  // [PUBLIC-NAV-T02] sẽ đỏ vì hai cây điều hướng lệch nhau.
  // { label: "Học cụ", href: "/hoc-cu" },
  { label: "Tin tức", href: "/tin-tuc" },
  { label: "Tuyển dụng", href: "/tuyen-dung" },
  { label: "Liên hệ", href: "/lien-he" },
];

export function MobileNavDrawer({ discEnabled = false, congThongTin }: { discEnabled?: boolean; congThongTin?: CoCongThongTin } = {}) {
  const navItems = chenNhomGoc(NAV_ITEMS, discEnabled, congThongTin);
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname() ?? "";

  useEffect(() => setMounted(true), []);
  useEffect(() => setIsOpen(false), [pathname]);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setIsOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // SSR + lần render đầu trả false (HTML khớp lúc hydrate); sau khi gắn mới đánh dấu mục đang đứng.
  const isActive = (href: string) => {
    if (!mounted) return false;
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label={isOpen ? "Đóng menu" : "Mở menu"}
        aria-expanded={isOpen}
        aria-controls="menu-dt"
        className="mbtn"
        style={{ cursor: "pointer", width: 44, height: 44, borderRadius: 12, border: "1.5px solid var(--line2)", background: "transparent", color: "var(--text)", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d={isOpen ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} />
        </svg>
      </button>

      {isOpen && (
        <div className="mnav" id="menu-dt" role="dialog" aria-label="Menu điều hướng">
          <nav className="wrap mnav-in" aria-label="Menu trên điện thoại">
            <div className="mnav-links">
              {navItems.map((item) => {
                if ("nhom" in item) return <NhomGocTrongMenu key="goc-gia-dinh" item={item} dangO={(href) => mounted && mucGocDangDung(pathname, href)} />;
                const on = isActive(item.href);
                return (
                  <Link key={item.href} href={item.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
                    {item.label}
                  </Link>
                );
              })}
            </div>
            <div className="mnav-cta">
              <Link href="/login" rel="nofollow" className="btn btn-line">
                Đăng nhập
              </Link>
              <Link href="/lien-he?free-trial=true" className="btn btn-acc">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
                </svg>
                Đặt học thử
              </Link>
            </div>
            <div className="mnav-hot">
              <span>Tư vấn {GIO_LAM_VIEC}</span>
              <a href={`tel:${SATA_ROBO_PHONE.tho}`}>{SATA_ROBO_PHONE.hien}</a>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}

/** Nhóm «Góc gia đình» trong menu điện thoại: tiêu đề nhóm + các lối vào luôn hiện sẵn (menu có chỗ, không cần bấm mở thêm). */
function NhomGocTrongMenu({ item, dangO }: { item: MucNhom; dangO: (href: string) => boolean }) {
  return (
    <div className="mnav-nhom" role="group" aria-label={item.label} data-testid="goc-menu">
      <span className="mnav-nhom-t" aria-hidden="true">
        {item.label}
      </span>
      {item.nhom.map((m) => {
        const on = dangO(m.href);
        return (
          <Link key={m.ma} href={m.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined} data-testid={`goc-menu-${m.ma}`}>
            <span className="mnav-nhom-bt">
              <BieuTuongGoc ma={m.ma} />
            </span>
            <span style={{ flexGrow: 1 }}>{m.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
